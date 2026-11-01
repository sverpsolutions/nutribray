from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional, List, Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.batch import product_batch, product_batch_stock
from app.models.product import product as product_model
from app.models.party import supplier as supplier_model
from app.models.invoice import stock_ledger
from app.schemas.batch import (
    ProductBatchOut, BatchCreateIn, BatchStatusUpdateIn,
    BatchKPIsOut, BatchStockOut, BatchExpiryReportOut, BatchExpiryReportSummary
)
from app.services import batch_service
from app.services.auth_service import write_audit


router = APIRouter(prefix="/batches", tags=["batches"])


@router.get("/kpis", response_model=BatchKPIsOut)
async def get_batch_kpis(
    location_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Provides summary metrics for the Expiry & Near-Expiry Dashboard."""
    today = date.today()
    d5 = today + timedelta(days=5)
    d15 = today + timedelta(days=15)
    d7 = today + timedelta(days=7)
    d30 = today + timedelta(days=30)
    d60 = today + timedelta(days=60)
    d90 = today + timedelta(days=90)

    # Base query joined with stocks
    q = select(
        product_batch,
        func.coalesce(func.sum(product_batch_stock.current_qty), 0).label("stock_sum")
    ).outerjoin(
        product_batch_stock, product_batch.id == product_batch_stock.batch_id
    )
    if location_id:
        q = q.where(product_batch_stock.location_id == location_id)
    q = q.group_by(product_batch.id)

    results = (await db.execute(q)).all()

    total_batches = len(results)
    active_count = 0
    near_5d = 0
    near_15d = 0
    near_7d = 0
    near_30d = 0
    near_60d = 0
    near_90d = 0
    expired_count = 0
    quarantine_count = 0
    recall_count = 0
    total_stock_units = Decimal("0.000")
    risk_cost = Decimal("0.00")
    risk_mrp = Decimal("0.00")

    for b, stock_sum in results:
        curr_stock = Decimal(str(stock_sum or 0))
        total_stock_units += curr_stock

        if b.status == "Quarantined":
            quarantine_count += 1
        elif b.status == "Recalled":
            recall_count += 1
        elif b.exp_date and b.exp_date < today:
            expired_count += 1
            if curr_stock > 0:
                risk_cost += curr_stock * b.cost_price
                risk_mrp += curr_stock * b.mrp
        elif b.status == "Active" or (b.exp_date and b.exp_date >= today):
            active_count += 1
            if b.exp_date:
                if b.exp_date <= d5:
                    near_5d += 1
                if b.exp_date <= d15:
                    near_15d += 1
                if b.exp_date <= d7:
                    near_7d += 1
                if b.exp_date <= d30:
                    near_30d += 1
                if b.exp_date <= d60:
                    near_60d += 1
                if b.exp_date <= d90:
                    near_90d += 1
                if b.exp_date <= d90 and curr_stock > 0:
                    risk_cost += curr_stock * b.cost_price
                    risk_mrp += curr_stock * b.mrp

    return BatchKPIsOut(
        total_batches=total_batches,
        active_batches=active_count,
        near_expiry_5d=near_5d,
        near_expiry_15d=near_15d,
        near_expiry_7d=near_7d,
        near_expiry_30d=near_30d,
        near_expiry_60d=near_60d,
        near_expiry_90d=near_90d,
        expired_batches=expired_count,
        quarantined_batches=quarantine_count,
        recalled_batches=recall_count,
        total_stock_units=total_stock_units,
        value_at_risk_cost=risk_cost,
        value_at_risk_mrp=risk_mrp,
    )


@router.get("", response_model=List[ProductBatchOut])
async def list_batches(
    product_id: Optional[int] = None,
    location_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    days_to_expiry: Optional[int] = None,
    min_days: Optional[int] = None,
    max_days: Optional[int] = None,
    has_stock_only: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List batches in the Central Batch Master with filtering, searching, vendor contact details, and location balances."""
    today = date.today()
    q = (
        select(product_batch)
        .options(
            selectinload(product_batch.product_rel),
            selectinload(product_batch.supplier_rel),
            selectinload(product_batch.stocks)
        )
    )

    if product_id:
        q = q.where(product_batch.product_id == product_id)

    if supplier_id:
        q = q.where(
            or_(
                product_batch.supplier_id == supplier_id,
                and_(
                    product_batch.supplier_id.is_(None),
                    product_batch.product_id.in_(
                        select(product_model.id).where(product_model.supplier_id == supplier_id)
                    )
                )
            )
        )

    if status_filter:
        if status_filter == "Expired":
            q = q.where(or_(product_batch.status == "Expired", product_batch.exp_date < today))
        elif status_filter == "Near Expiry":
            q = q.where(and_(product_batch.exp_date >= today, product_batch.exp_date <= today + timedelta(days=60)))
        else:
            q = q.where(product_batch.status == status_filter)

    if days_to_expiry is not None:
        if days_to_expiry == 0:
            q = q.where(product_batch.exp_date < today)
        else:
            target_date = today + timedelta(days=days_to_expiry)
            q = q.where(and_(product_batch.exp_date >= today, product_batch.exp_date <= target_date))
    elif min_days is not None or max_days is not None:
        if min_days is not None:
            q = q.where(product_batch.exp_date >= today + timedelta(days=min_days))
        if max_days is not None:
            q = q.where(product_batch.exp_date <= today + timedelta(days=max_days))

    if search:
        s = f"%{search.strip()}%"
        q = q.join(product_model, product_batch.product_id == product_model.id).where(
            or_(
                product_batch.batch_no.ilike(s),
                product_batch.supplier_batch_no.ilike(s),
                product_model.name.ilike(s),
                product_model.item_code.ilike(s),
                product_batch.barcode.ilike(s),
            )
        )

    # Order by expiry date ascending (FEFO first)
    q = q.order_by(product_batch.exp_date.asc().nulls_last(), product_batch.id.desc())
    if not has_stock_only:
        q = q.offset((page - 1) * limit).limit(limit)

    batches = (await db.execute(q)).scalars().all()
    output: List[ProductBatchOut] = []

    # Cache for fallback supplier lookups
    supplier_cache: dict[int, Any] = {}

    for b in batches:
        # Calculate total stock across locations (or specific location)
        stocks_to_sum = [s for s in b.stocks if not location_id or s.location_id == location_id]
        total_curr = sum((s.current_qty for s in stocks_to_sum), Decimal("0.000"))

        if has_stock_only and total_curr <= Decimal("0.000"):
            continue

        days_left = None
        if b.exp_date:
            days_left = (b.exp_date - today).days

        # Dynamic status display
        dyn_status = batch_service.get_batch_status(b.exp_date, 60, b.status)

        # Supplier details resolution (direct batch supplier or fallback to product supplier)
        sup = b.supplier_rel
        if not sup and b.product_rel and b.product_rel.supplier_id:
            sid = b.product_rel.supplier_id
            if sid not in supplier_cache:
                supplier_cache[sid] = await db.get(supplier_model, sid)
            sup = supplier_cache.get(sid)

        sup_id = b.supplier_id or (sup.id if sup else None)
        sup_name = sup.name if sup else None
        sup_phone = (sup.phone or sup.alt_phone) if sup else None
        sup_contact = sup.contact_name if sup else None
        sup_code = sup.supplier_code if sup else None
        sup_email = sup.email if sup else None

        cost_val = round(total_curr * (b.cost_price or b.purchase_rate or Decimal("0.00")), 2)
        mrp_val = round(total_curr * (b.mrp or Decimal("0.00")), 2)

        output.append(ProductBatchOut(
            id=b.id,
            product_id=b.product_id,
            product_name=b.product_rel.name if b.product_rel else None,
            item_code=b.product_rel.item_code if b.product_rel else None,
            barcode=b.barcode or (b.product_rel.barcode if b.product_rel else None),
            category_name=b.product_rel.category if b.product_rel else None,
            brand_name=b.product_rel.brand if b.product_rel else None,
            batch_no=b.batch_no,
            supplier_batch_no=b.supplier_batch_no,
            supplier_id=sup_id,
            supplier_name=sup_name,
            supplier_phone=sup_phone,
            supplier_contact_name=sup_contact,
            supplier_code=sup_code,
            supplier_email=sup_email,
            mfg_date=b.mfg_date,
            exp_date=b.exp_date,
            first_receipt_date=b.first_receipt_date,
            purchase_rate=b.purchase_rate,
            cost_price=b.cost_price,
            mrp=b.mrp,
            selling_price=b.selling_price,
            status=dyn_status,
            notes=b.notes,
            total_stock=total_curr,
            location_stocks=[
                BatchStockOut.from_orm(s) for s in stocks_to_sum
            ],
            days_to_expiry=days_left,
            value_at_risk_cost=cost_val,
            value_at_risk_mrp=mrp_val,
            created_at=b.created_at,
            updated_at=b.updated_at,
        ))

    if has_stock_only:
        start_idx = (page - 1) * limit
        output = output[start_idx : start_idx + limit]

    return output


@router.get("/expiry-report", response_model=BatchExpiryReportOut)
async def get_batch_expiry_report(
    window: Optional[str] = Query("all", description="all, expired, 5, 15, 30, 45, 60, 90, custom"),
    custom_days: Optional[int] = Query(None, description="Custom number of days remaining to expiry"),
    supplier_id: Optional[int] = None,
    location_id: Optional[int] = None,
    has_stock_only: bool = False,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Dedicated Expiry Report endpoint with full vendor contact details (Phone, Contact Name),
    days left countdown, and financial value-at-risk totals for return/recall action.
    """
    today = date.today()
    days_param = None
    status_param = None

    if window == "expired":
        status_param = "Expired"
        days_param = 0
    elif window in ("5", "15", "30", "45", "60", "90"):
        days_param = int(window)
    elif window == "custom" and custom_days is not None:
        days_param = custom_days

    # Call list_batches to fetch rows
    all_rows = await list_batches(
        product_id=None,
        location_id=location_id,
        supplier_id=supplier_id,
        status_filter=status_param,
        search=search,
        days_to_expiry=days_param,
        has_stock_only=has_stock_only,
        page=1,
        limit=5000,
        db=db,
        _=None,
    )

    total_records = len(all_rows)
    total_stock = sum((r.total_stock for r in all_rows), Decimal("0.000"))
    total_cost = sum((r.value_at_risk_cost or Decimal("0.00") for r in all_rows), Decimal("0.00"))
    total_mrp = sum((r.value_at_risk_mrp or Decimal("0.00") for r in all_rows), Decimal("0.00"))

    exp_cnt = sum(1 for r in all_rows if (r.days_to_expiry is not None and r.days_to_expiry <= 0))
    n5_cnt = sum(1 for r in all_rows if (r.days_to_expiry is not None and 0 < r.days_to_expiry <= 5))
    n15_cnt = sum(1 for r in all_rows if (r.days_to_expiry is not None and 0 < r.days_to_expiry <= 15))
    n30_cnt = sum(1 for r in all_rows if (r.days_to_expiry is not None and 0 < r.days_to_expiry <= 30))

    # Paginate results
    page_val = int(page) if isinstance(page, (int, str)) and str(page).isdigit() else 1
    limit_val = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else 100
    start = (page_val - 1) * limit_val
    paged_data = all_rows[start : start + limit_val]

    summary = BatchExpiryReportSummary(
        total_records=total_records,
        total_stock_units=total_stock,
        total_cost_value=total_cost,
        total_mrp_value=total_mrp,
        expired_count=exp_cnt,
        next_5d_count=n5_cnt,
        next_15d_count=n15_cnt,
        next_30d_count=n30_cnt,
    )

    return BatchExpiryReportOut(
        summary=summary,
        data=paged_data,
        total=total_records,
        page=page_val,
        limit=limit_val,
    )


@router.get("/product/{product_id}/available")
async def get_available_product_batches(
    product_id: int,
    location_id: Optional[int] = Query(None),
    allow_expired: bool = False,
    include_zero_stock: bool = True,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    Returns available batches for POS / Billing / Transfers, sorted by FEFO (First Expiry, First Out).
    Uses outerjoin so registered product batches are always available for selection.
    """
    today = date.today()
    join_cond = product_batch.id == product_batch_stock.batch_id
    if location_id:
        join_cond = and_(join_cond, product_batch_stock.location_id == location_id)

    q = (
        select(
            product_batch,
            func.coalesce(func.sum(product_batch_stock.current_qty), Decimal("0.000")).label("avail_qty")
        )
        .outerjoin(product_batch_stock, join_cond)
        .where(product_batch.product_id == product_id)
        .group_by(product_batch.id)
    )

    if not allow_expired:
        q = q.where(
            product_batch.status.in_(["Active", "Near Expiry"]),
            or_(product_batch.exp_date.is_(None), product_batch.exp_date >= today)
        )
    else:
        q = q.where(product_batch.status.notin_(["Quarantined", "Recalled", "Closed"]))

    if not include_zero_stock:
        q = q.having(func.coalesce(func.sum(product_batch_stock.current_qty), 0) > 0)

    # Order by expiry date asc (FEFO), then id
    q = q.order_by(product_batch.exp_date.asc().nulls_last(), product_batch.id.asc())
    rows = (await db.execute(q)).all()

    return [
        {
            "batch_id": b.id,
            "batch_no": b.batch_no,
            "mfg_date": b.mfg_date.isoformat() if b.mfg_date else None,
            "exp_date": b.exp_date.isoformat() if b.exp_date else None,
            "purchase_rate": float(b.purchase_rate or 0),
            "cost_price": float(b.cost_price or 0),
            "mrp": float(b.mrp or 0),
            "selling_price": float(b.selling_price or 0),
            "available_qty": float(avail_qty),
            "status": b.status,
            "days_to_expiry": (b.exp_date - today).days if b.exp_date else None,
        }
        for b, avail_qty in rows
    ]


@router.post("", response_model=ProductBatchOut)
async def create_batch_manually(
    body: BatchCreateIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Manually create or register a batch with optional opening stock."""
    prod = await db.get(product_model, body.product_id)
    if not prod:
        raise HTTPException(404, "Product not found")

    batch_obj = await batch_service.get_or_create_batch(
        db=db,
        product_id=body.product_id,
        batch_no=body.batch_no,
        supplier_id=body.supplier_id,
        supplier_batch_no=body.supplier_batch_no,
        mfg_date=body.mfg_date,
        exp_date=body.exp_date,
        purchase_rate=body.purchase_rate or Decimal("0.00"),
        cost_price=body.cost_price or Decimal("0.00"),
        mrp=body.mrp or Decimal("0.00"),
        selling_price=body.selling_price or Decimal("0.00"),
        barcode=body.barcode,
        user_id=user.user_id,
        notes=body.notes,
    )

    if body.initial_qty and body.initial_qty > Decimal("0.000"):
        loc_id = body.initial_location_id or 1
        await batch_service.record_batch_movement(
            db=db,
            batch_id=batch_obj.id,
            location_id=loc_id,
            qty_delta=body.initial_qty,
            movement_type="adjustment",
            product_id=body.product_id,
        )
        # Also record in stock ledger
        entry = stock_ledger(
            product_id=body.product_id,
            txn_type="batch_opening",
            qty=body.initial_qty,
            ref_id=batch_obj.id,
            ref_type="batch_master",
            outlet_id=loc_id,
            batch_no=batch_obj.batch_no,
            batch_id=batch_obj.id,
            expiry_date=batch_obj.exp_date,
            notes="Opening batch entry created manually",
            created_by=user.user_id,
        )
        db.add(entry)

    await write_audit(
        db=db, module="batches", action="create_batch",
        record_id=batch_obj.id, record_no=batch_obj.batch_no,
        description=f"Batch {batch_obj.batch_no} created for product {prod.name}",
        user_id=user.user_id, user_name=user.username,
    )
    await db.commit()
    await db.refresh(batch_obj)

    return ProductBatchOut(
        id=batch_obj.id,
        product_id=batch_obj.product_id,
        product_name=prod.name,
        item_code=prod.item_code,
        barcode=batch_obj.barcode,
        batch_no=batch_obj.batch_no,
        supplier_batch_no=batch_obj.supplier_batch_no,
        supplier_id=batch_obj.supplier_id,
        mfg_date=batch_obj.mfg_date,
        exp_date=batch_obj.exp_date,
        first_receipt_date=batch_obj.first_receipt_date,
        purchase_rate=batch_obj.purchase_rate,
        cost_price=batch_obj.cost_price,
        mrp=batch_obj.mrp,
        selling_price=batch_obj.selling_price,
        status=batch_obj.status,
        notes=batch_obj.notes,
        total_stock=body.initial_qty or Decimal("0.000"),
        created_at=batch_obj.created_at,
        updated_at=batch_obj.updated_at,
    )


@router.patch("/{id}/status")
async def update_batch_status(
    id: int,
    body: BatchStatusUpdateIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Updates batch status (e.g. Quarantined, Recalled, Active, Closed) with reason."""
    batch_obj = await db.get(product_batch, id)
    if not batch_obj:
        raise HTTPException(404, "Batch not found")

    old_status = batch_obj.status
    batch_obj.status = body.status
    if body.reason:
        batch_obj.notes = f"{(batch_obj.notes or '').strip()} | Status changed to {body.status}: {body.reason}".strip(" |")
    batch_obj.updated_at = datetime.now()

    await write_audit(
        db=db, module="batches", action="update_status",
        record_id=batch_obj.id, record_no=batch_obj.batch_no,
        description=f"Batch {batch_obj.batch_no} status changed from {old_status} to {body.status}. Reason: {body.reason}",
        user_id=user.user_id, user_name=user.username,
    )
    await db.commit()
    return {"success": True, "batch_id": batch_obj.id, "new_status": batch_obj.status}


@router.post("/migrate-legacy")
async def trigger_legacy_stock_migration(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Triggers controlled migration of legacy stock into standard opening batches.
    Reconciles total quantities and ensures batch traceability for existing inventory.
    """
    res = await batch_service.migrate_legacy_opening_stock(db, user.user_id)
    await write_audit(
        db=db, module="batches", action="legacy_migration",
        record_id=0, record_no="MIGRATION",
        description=f"Legacy stock migrated: {res['migrated_products']} items, {res['total_qty_migrated']} units",
        user_id=user.user_id, user_name=user.username,
    )
    await db.commit()
    return res
