"""
Central Batch & Expiry Management Service
Handles:
- Central Batch Registry (product_batches)
- Location-Wise Batch Stock Balances (product_batch_stock)
- FEFO (First Expiry, First Out) Allocation Engine
- Expiry Date Calculations and Validations
- Stock Movement Tracking across all modules
- Batch Status Management (Active, Near Expiry, Expired, Quarantined, Recalled, Closed)
"""
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy import select, update, func, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.batch import product_batch, product_batch_stock
from app.models.product import product as product_model
from app.models.invoice import stock_ledger


ZERO = Decimal("0.000")


def _to_decimal(val: Any) -> Decimal:
    if val is None:
        return Decimal("0.000")
    return Decimal(str(val))


def calculate_expiry_date(mfg: Optional[date], shelf_life_days: Optional[int]) -> Optional[date]:
    """Calculates expiry date from manufacturing date + shelf life in days."""
    if mfg and shelf_life_days and shelf_life_days > 0:
        return mfg + timedelta(days=shelf_life_days)
    return None


def get_batch_status(exp_date: Optional[date], alert_days: int = 60, current_status: str = "Active") -> str:
    """Computes dynamic status based on expiry date unless quarantined or recalled."""
    if current_status in ("Quarantined", "Recalled", "Closed"):
        return current_status
    if not exp_date:
        return current_status or "Active"
    
    today = date.today()
    if exp_date < today:
        return "Expired"
    if exp_date <= today + timedelta(days=alert_days):
        return "Near Expiry"
    return "Active"


async def get_or_create_batch(
    db: AsyncSession,
    product_id: int,
    batch_no: str,
    supplier_id: Optional[int] = None,
    supplier_batch_no: Optional[str] = None,
    mfg_date: Optional[date] = None,
    exp_date: Optional[date] = None,
    purchase_rate: Decimal = Decimal("0.00"),
    cost_price: Decimal = Decimal("0.00"),
    mrp: Decimal = Decimal("0.00"),
    selling_price: Decimal = Decimal("0.00"),
    barcode: Optional[str] = None,
    user_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> product_batch:
    """
    Retrieves an existing batch or creates a new one in the central product_batches register.
    Maintains batch identity and avoids accidental duplicate creation for identical batch & expiry.
    """
    clean_batch_no = batch_no.strip().upper() if batch_no else "DEFAULT"
    
    # Check if exact batch exists for product
    stmt = select(product_batch).where(
        product_batch.product_id == product_id,
        product_batch.batch_no == clean_batch_no
    )
    res = await db.execute(stmt)
    existing = res.scalar_one_or_none()

    if existing:
        # If dates are provided and existing had none, backfill
        updated = False
        if not existing.exp_date and exp_date:
            existing.exp_date = exp_date
            updated = True
        if not existing.mfg_date and mfg_date:
            existing.mfg_date = mfg_date
            updated = True
        if mrp > ZERO and existing.mrp <= ZERO:
            existing.mrp = mrp
            updated = True
        if selling_price > ZERO and existing.selling_price <= ZERO:
            existing.selling_price = selling_price
            updated = True
        if purchase_rate > ZERO and existing.purchase_rate <= ZERO:
            existing.purchase_rate = purchase_rate
            updated = True
        if cost_price > ZERO and existing.cost_price <= ZERO:
            existing.cost_price = cost_price
            updated = True
        
        # Refresh dynamic status
        existing.status = get_batch_status(existing.exp_date, 60, existing.status)
        if updated:
            existing.updated_at = datetime.now()
        await db.flush()
        return existing

    # Calculate status
    init_status = get_batch_status(exp_date, 60, "Active")

    new_batch = product_batch(
        product_id=product_id,
        batch_no=clean_batch_no,
        supplier_batch_no=supplier_batch_no.strip() if supplier_batch_no else None,
        supplier_id=supplier_id,
        mfg_date=mfg_date,
        exp_date=exp_date,
        first_receipt_date=date.today(),
        purchase_rate=purchase_rate,
        cost_price=cost_price,
        mrp=mrp,
        selling_price=selling_price,
        status=init_status,
        barcode=barcode,
        notes=notes,
        created_by=user_id,
    )
    db.add(new_batch)
    await db.flush()
    return new_batch


async def record_batch_movement(
    db: AsyncSession,
    batch_id: int,
    location_id: int,
    qty_delta: Decimal,
    movement_type: str,  # 'purchase', 'purchase_return', 'transfer_out', 'transfer_in', 'sale', 'sale_return', 'adjustment'
    product_id: Optional[int] = None,
    allow_negative: bool = False,
) -> product_batch_stock:
    """
    Updates location-wise batch stock balances (product_batch_stock).
    Delta: positive = stock added, negative = stock deducted.
    """
    delta = _to_decimal(qty_delta)
    
    # 1. Fetch batch to get product_id if not supplied
    batch_stmt = select(product_batch).where(product_batch.id == batch_id)
    batch_res = await db.execute(batch_stmt)
    batch_obj = batch_res.scalar_one_or_none()
    if not batch_obj:
        raise ValueError(f"Batch ID {batch_id} not found in central batch register")
    
    pid = product_id or batch_obj.product_id

    # 2. Lock or retrieve location-wise batch stock row
    stmt = select(product_batch_stock).where(
        product_batch_stock.batch_id == batch_id,
        product_batch_stock.location_id == location_id
    ).with_for_update()
    res = await db.execute(stmt)
    stock_row = res.scalar_one_or_none()

    if not stock_row:
        stock_row = product_batch_stock(
            batch_id=batch_id,
            product_id=pid,
            location_id=location_id,
            opening_qty=ZERO,
            received_qty=ZERO,
            sold_qty=ZERO,
            returned_qty=ZERO,
            transferred_in_qty=ZERO,
            transferred_out_qty=ZERO,
            adjusted_qty=ZERO,
            current_qty=ZERO,
            reserved_qty=ZERO,
        )
        db.add(stock_row)
        await db.flush()

    new_current = _to_decimal(stock_row.current_qty) + delta
    
    if not allow_negative and new_current < ZERO and delta < ZERO:
        raise ValueError(
            f"Insufficient batch stock for Batch '{batch_obj.batch_no}'. "
            f"Available: {stock_row.current_qty}, Requested deduction: {abs(delta)}"
        )

    # Update category counter
    mtype = movement_type.lower()
    if mtype in ("purchase", "grn"):
        stock_row.received_qty += delta
    elif mtype in ("purchase_return", "debit_note"):
        stock_row.returned_qty += abs(delta)
    elif mtype in ("sale", "invoice"):
        stock_row.sold_qty += abs(delta)
    elif mtype in ("sale_return", "credit_note"):
        stock_row.returned_qty -= delta  # returned back to stock
    elif mtype == "transfer_out":
        stock_row.transferred_out_qty += abs(delta)
    elif mtype == "transfer_in":
        stock_row.transferred_in_qty += delta
    elif mtype in ("adjustment", "stock_take"):
        stock_row.adjusted_qty += delta

    stock_row.current_qty = new_current
    stock_row.updated_at = datetime.now()
    await db.flush()
    return stock_row


async def allocate_fefo_batches(
    db: AsyncSession,
    product_id: int,
    location_id: int,
    required_qty: Decimal,
    allow_expired: bool = False,
) -> Tuple[List[Dict[str, Any]], Decimal]:
    """
    FEFO (First Expiry, First Out) Allocation Engine.
    Allocates available stock starting from earliest expiry date.
    Returns:
      (allocations: list of {batch_id, batch_no, exp_date, qty, mrp, selling_price, cost_price},
       unallocated_qty: Decimal)
    """
    req_qty = _to_decimal(required_qty)
    if req_qty <= ZERO:
        return [], ZERO

    today = date.today()

    # Query active batches with positive stock at this location
    stmt = (
        select(product_batch_stock, product_batch)
        .join(product_batch, product_batch_stock.batch_id == product_batch.id)
        .where(
            product_batch_stock.product_id == product_id,
            product_batch_stock.location_id == location_id,
            product_batch_stock.current_qty > ZERO,
            product_batch.status.in_(["Active", "Near Expiry"]) if not allow_expired else product_batch.status.notin_(["Quarantined", "Recalled", "Closed"])
        )
    )

    if not allow_expired:
        # Strict expiry filtering: exp_date must be >= today or null
        stmt = stmt.where(or_(product_batch.exp_date.is_(None), product_batch.exp_date >= today))

    # Order by expiry date ascending (FEFO), NULLS LAST
    stmt = stmt.order_by(
        product_batch.exp_date.asc().nulls_last(),
        product_batch.created_at.asc()
    )

    rows = (await db.execute(stmt)).all()

    allocations: List[Dict[str, Any]] = []
    remaining = req_qty

    for b_stock, b_info in rows:
        avail = _to_decimal(b_stock.current_qty)
        if avail <= ZERO:
            continue

        take = min(remaining, avail)
        allocations.append({
            "batch_id": b_info.id,
            "batch_no": b_info.batch_no,
            "mfg_date": b_info.mfg_date.isoformat() if b_info.mfg_date else None,
            "exp_date": b_info.exp_date.isoformat() if b_info.exp_date else None,
            "qty": take,
            "mrp": float(b_info.mrp),
            "selling_price": float(b_info.selling_price),
            "cost_price": float(b_info.cost_price),
            "status": b_info.status,
            "available_stock": float(avail),
        })
        remaining -= take
        if remaining <= ZERO:
            break

    return allocations, max(ZERO, remaining)


async def check_batch_sale_eligibility(
    db: AsyncSession,
    batch_id: int,
    location_id: int,
    qty_needed: Decimal,
    prod_override_allow_expired: bool = False,
) -> Tuple[bool, str]:
    """
    Validates if a specific batch can be sold:
    - Exists and belongs to location
    - Not quarantined, recalled, or closed
    - Not expired (unless authorized override)
    - Has sufficient stock
    """
    stmt = (
        select(product_batch, product_batch_stock)
        .join(product_batch_stock, product_batch.id == product_batch_stock.batch_id)
        .where(
            product_batch.id == batch_id,
            product_batch_stock.location_id == location_id
        )
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        return False, f"Batch ID {batch_id} not available at location {location_id}"

    b_info, b_stock = row
    if b_info.status in ("Quarantined", "Recalled"):
        return False, f"Batch '{b_info.batch_no}' is {b_info.status} and cannot be sold"
    if b_info.status == "Closed":
        return False, f"Batch '{b_info.batch_no}' is closed"

    today = date.today()
    if b_info.exp_date and b_info.exp_date < today:
        if not prod_override_allow_expired:
            return False, f"Batch '{b_info.batch_no}' expired on {b_info.exp_date.isoformat()} and is blocked from sale"

    if _to_decimal(b_stock.current_qty) < _to_decimal(qty_needed):
        return False, f"Insufficient stock in Batch '{b_info.batch_no}'. Available: {b_stock.current_qty}, Needed: {qty_needed}"

    return True, "OK"


async def migrate_legacy_opening_stock(
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Safely migrates legacy inventory for batch-controlled products without batch records.
    - Generates a standard opening batch 'BATCH-LEGACY-OPENING' with exp_date=None (never invents dates).
    - Initializes location-wise batch stock with opening_qty = current product stock.
    - Preserves exact reconciliation with the stock ledger and master stock.
    """
    from app.models.sync import outlet_stock

    # Find products that have batch tracking enabled or is_batch_required
    p_stmt = select(product_model).where(
        or_(
            product_model.has_batch_tracking == True,
            product_model.is_batch_required == True
        )
    )
    products = (await db.execute(p_stmt)).scalars().all()

    migrated_count = 0
    total_qty_migrated = Decimal("0.000")

    for p in products:
        # Check if product already has batches
        b_count_stmt = select(func.count(product_batch.id)).where(product_batch.product_id == p.id)
        b_count = (await db.execute(b_count_stmt)).scalar() or 0
        if b_count > 0:
            continue

        stock_val = _to_decimal(p.stock_qty)
        if stock_val <= ZERO:
            # Check outlet_stock
            os_stmt = select(func.sum(outlet_stock.stock_qty)).where(outlet_stock.product_id == p.id)
            os_val = (await db.execute(os_stmt)).scalar()
            stock_val = _to_decimal(os_val)

        if stock_val <= ZERO:
            continue

        # Create opening batch without inventing an expiry date
        batch_obj = await get_or_create_batch(
            db=db,
            product_id=p.id,
            batch_no="BATCH-LEGACY-OPENING",
            mfg_date=None,
            exp_date=None,
            purchase_rate=p.cost_price,
            cost_price=p.cost_price,
            mrp=p.mrp,
            selling_price=p.selling_price,
            user_id=user_id,
            notes="Opening batch created for legacy inventory migration",
        )

        # Allocate to default location 1 (HO / Main Warehouse)
        await record_batch_movement(
            db=db,
            batch_id=batch_obj.id,
            location_id=1,
            qty_delta=stock_val,
            movement_type="adjustment",
            product_id=p.id,
        )

        # Write opening stock ledger record
        entry = stock_ledger(
            product_id=p.id,
            txn_type="batch_legacy_migration",
            qty=stock_val,
            ref_id=batch_obj.id,
            ref_type="product_batches",
            outlet_id=1,
            batch_no=batch_obj.batch_no,
            batch_id=batch_obj.id,
            expiry_date=None,
            notes="Legacy stock migration into opening batch",
            created_by=user_id,
        )
        db.add(entry)

        migrated_count += 1
        total_qty_migrated += stock_val

    await db.flush()
    return {
        "success": True,
        "migrated_products": migrated_count,
        "total_qty_migrated": float(total_qty_migrated),
    }


async def update_batch_status(
    db: AsyncSession,
    batch_id: int,
    status: str,
    reason: Optional[str] = None
) -> Optional[product_batch]:
    """Updates batch status with optional audit note."""
    batch_obj = await db.get(product_batch, batch_id)
    if not batch_obj:
        return None
    batch_obj.status = status
    if reason:
        batch_obj.notes = f"{(batch_obj.notes or '').strip()} | Status changed to {status}: {reason}".strip(" |")
    batch_obj.updated_at = datetime.now()
    await db.flush()
    return batch_obj


async def get_batch_kpis(
    db: AsyncSession,
    location_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Calculates KPI summary metrics for central batch and expiry tracking."""
    today = date.today()
    d60 = today + timedelta(days=60)

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
    near_expiry_count = 0
    expired_count = 0
    quarantine_count = 0
    risk_cost = Decimal("0.00")

    for b, stock_sum in results:
        curr_stock = Decimal(str(stock_sum or 0))
        if b.status == "Quarantined":
            quarantine_count += 1
        elif b.status == "Expired" or (b.exp_date and b.exp_date < today):
            expired_count += 1
            if curr_stock > 0:
                risk_cost += curr_stock * b.cost_price
        else:
            active_count += 1
            if b.exp_date and b.exp_date <= d60:
                near_expiry_count += 1
                if curr_stock > 0:
                    risk_cost += curr_stock * b.cost_price

    return {
        "total_batches": total_batches,
        "active_batches": active_count,
        "near_expiry_batches": near_expiry_count,
        "expired_batches": expired_count,
        "quarantined_batches": quarantine_count,
        "stock_value_at_risk": float(risk_cost),
    }

