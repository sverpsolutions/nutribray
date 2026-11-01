from datetime import datetime, date
from decimal import Decimal
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import func, select, text, update, case, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.models.stock_take import stock_take, stock_take_item, stock_take_item_batch
from app.models.product import product as product_model, product_barcode
from app.models.batch import product_batch, product_batch_stock
from app.models.outlet import outlet as outlet_model
from app.models.sync import outlet_stock
from app.services.auth_service import write_audit
from app.services.billing_service import _write_stock_ledger
from app.services import batch_service

router = APIRouter(prefix="/stock-take", tags=["stock-take"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class StockTakeCreateIn(BaseModel):
    location_id: int
    notes: str | None = None

class ScanSaveIn(BaseModel):
    stock_take_id: int
    product_id: int
    qty: Decimal

class EditCountIn(BaseModel):
    stock_take_id: int
    product_id: int
    qty: Decimal | None = None
    clear: bool = False

class BatchCountItemIn(BaseModel):
    batch_id: int | None = None
    batch_no: str
    mfg_date: str | None = None
    expiry_date: str | None = None
    system_qty: float = 0.0
    counted_qty: float
    reason: str | None = None

class SaveBatchesIn(BaseModel):
    stock_take_id: int
    product_id: int
    batches: list[BatchCountItemIn]

class FinalizeIn(BaseModel):
    adjust_stock: bool = True
    zero_uncounted: bool = False

class LookupIn(BaseModel):
    stock_take_id: int
    q: str


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _next_take_no(db: AsyncSession) -> str:
    year = date.today().year
    prefix = f"STK-{year}-"
    row = await db.execute(
        text("SELECT MAX(take_no) FROM stock_takes WHERE take_no LIKE :p"),
        {"p": prefix + "%"}
    )
    last = row.scalar()
    if last and len(last) >= 13:
        try:
            seq = int(last[-4:]) + 1
        except Exception:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:04d}"


# ── 1. List Stock Takes ───────────────────────────────────────────────────────
@router.get("")
@router.get("/")
async def list_stock_takes(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    status: str | None = Query(default=None),
    location_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    q = select(stock_take).where(*access.outlet_where(stock_take.location_id)).order_by(stock_take.id.desc())
    if location_id:
        q = q.where(stock_take.location_id == location_id)
    if status:
        q = q.where(stock_take.status == status)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db.execute(q.offset((page - 1) * per_page).limit(per_page))).scalars().all()

    # Check for in_progress take for user/location alert
    in_progress_alert = None
    ip_q = select(stock_take).where(stock_take.status == "in_progress", *access.outlet_where(stock_take.location_id))
    if location_id:
        ip_q = ip_q.where(stock_take.location_id == location_id)
    ip_take = (await db.execute(ip_q.order_by(stock_take.id.desc()).limit(1))).scalar_one_or_none()
    if ip_take:
        in_progress_alert = {
            "id": ip_take.id,
            "take_no": ip_take.take_no,
            "location_id": ip_take.location_id,
            "location_name": ip_take.location_name,
            "started_at": ip_take.started_at.strftime("%d %b %Y %H:%M") if ip_take.started_at else "",
            "counted_items": ip_take.counted_items,
            "total_items": ip_take.total_items,
        }

    out = []
    for r in rows:
        pct = round((r.counted_items / r.total_items * 100), 1) if r.total_items and r.total_items > 0 else 0
        out.append({
            "id": r.id,
            "take_no": r.take_no,
            "location_id": r.location_id,
            "location_name": r.location_name or f"Outlet #{r.location_id}",
            "status": r.status,
            "notes": r.notes,
            "started_by": r.started_by,
            "started_by_name": r.started_by_name or "System",
            "started_at": str(r.started_at) if r.started_at else "",
            "finalized_by": r.finalized_by,
            "finalized_by_name": r.finalized_by_name or "",
            "finalized_at": str(r.finalized_at) if r.finalized_at else "",
            "adjust_stock": r.adjust_stock,
            "total_items": r.total_items,
            "counted_items": r.counted_items,
            "progress_percent": pct,
        })

    return {
        "data": out,
        "total": total,
        "page": page,
        "per_page": per_page,
        "in_progress_alert": in_progress_alert,
    }


# ── 2. Start New Stock Take ───────────────────────────────────────────────────
@router.post("/create")
async def create_stock_take(
    body: StockTakeCreateIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    # 1. Resolve Location Name
    access.check_outlet(body.location_id)
    loc_res = await db.execute(text("SELECT outlet_name FROM outlets WHERE id = :id"), {"id": body.location_id})
    loc_row = loc_res.fetchone()
    loc_name = loc_row[0] if loc_row else f"Outlet #{body.location_id}"

    # 2. Cancel any active in_progress take for that location
    await db.execute(
        update(stock_take)
        .where(stock_take.location_id == body.location_id, stock_take.status == "in_progress")
        .values(status="cancelled", notes=func.concat(stock_take.notes, " [Auto-cancelled by new take]"))
    )

    take_no = await _next_take_no(db)

    # 3. Insert header
    st = stock_take(
        take_no=take_no,
        location_id=body.location_id,
        location_name=loc_name,
        status="in_progress",
        notes=body.notes,
        started_by=user.user_id,
        started_by_name=user.username,
        started_at=datetime.now(),
        adjust_stock=True,
        total_items=0,
        counted_items=0,
    )
    db.add(st)
    await db.flush()

    # 4. Pre-load all active products with frozen system_qty
    # Stock priority: outlet_stock if exists, else product.stock_qty
    sql_preload = text("""
        INSERT INTO stock_take_items (stock_take_id, product_id, product_name, item_code, unit, system_qty, counted_qty)
        SELECT 
            :take_id,
            p.id,
            p.name,
            p.item_code,
            COALESCE(p.unit, 'PCS'),
            COALESCE(os.stock_qty, p.stock_qty, 0),
            NULL
        FROM products p
        LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = :loc_id
        WHERE p.is_active = true
        ON CONFLICT (stock_take_id, product_id) DO NOTHING
    """)
    await db.execute(sql_preload, {"take_id": st.id, "loc_id": body.location_id})

    # Count inserted rows
    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(stock_take_item.stock_take_id == st.id)
    )
    total_items = c_res.scalar_one() or 0
    st.total_items = total_items

    await write_audit(
        db=db, module="inventory", action="start_stock_take",
        record_id=st.id, record_no=st.take_no,
        description=f"Started stock take {st.take_no} for location {loc_name} ({total_items} items)",
        user_id=user.user_id, user_name=user.username
    )
    await db.commit()
    return {"success": True, "id": st.id, "take_no": st.take_no, "total_items": total_items}


# ── 3. Get Stock Take Details ─────────────────────────────────────────────────
@router.get("/{id}")
async def get_stock_take(
    id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    st_res = await db.execute(select(stock_take).where(stock_take.id == id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")

    # Fetch items with cost_price and pricing from products
    stmt = (
        select(
            stock_take_item.id,
            stock_take_item.product_id,
            stock_take_item.product_name,
            stock_take_item.item_code,
            stock_take_item.unit,
            stock_take_item.system_qty,
            stock_take_item.counted_qty,
            stock_take_item.saved_at,
            product_model.barcode,
            product_model.cost_price,
            product_model.selling_price,
            product_model.mrp,
        )
        .join(product_model, stock_take_item.product_id == product_model.id, isouter=True)
        .where(stock_take_item.stock_take_id == id)
        .order_by(stock_take_item.id)
    )
    items_rows = (await db.execute(stmt)).all()

    # Pre-fetch batches for all items in this stock take
    batches_stmt = (
        select(stock_take_item_batch)
        .where(stock_take_item_batch.stock_take_id == id)
        .order_by(stock_take_item_batch.id)
    )
    all_stib = (await db.execute(batches_stmt)).scalars().all()
    batches_by_item = {}
    for b in all_stib:
        batches_by_item.setdefault(b.stock_take_item_id, []).append({
            "id": b.id,
            "batch_id": b.batch_id,
            "batch_no": b.batch_no,
            "mfg_date": str(b.mfg_date) if b.mfg_date else "",
            "expiry_date": str(b.expiry_date) if b.expiry_date else "",
            "system_qty": float(b.system_qty or 0),
            "counted_qty": float(b.counted_qty or 0),
            "variance": float(b.variance or 0),
            "reason": b.reason or "",
        })

    items_out = []
    items_with_variance = 0
    surplus_items = 0
    shortage_items = 0
    total_variance_value = Decimal("0")
    counted_count = 0

    for r in items_rows:
        sys_q = float(r.system_qty or 0)
        cnt_q = float(r.counted_qty) if r.counted_qty is not None else None
        cp = float(r.cost_price or 0)
        
        variance = None
        val_impact = 0.0

        if cnt_q is not None:
            counted_count += 1
            variance = round(cnt_q - sys_q, 3)
            val_impact = round(variance * cp, 2)
            if variance != 0:
                items_with_variance += 1
                if variance > 0:
                    surplus_items += 1
                else:
                    shortage_items += 1
                total_variance_value += Decimal(str(val_impact))

        items_out.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": r.product_name,
            "item_code": r.item_code,
            "barcode": r.barcode or "",
            "unit": r.unit or "PCS",
            "system_qty": sys_q,
            "counted_qty": cnt_q,
            "variance": variance,
            "value_impact": val_impact,
            "cost_price": cp,
            "selling_price": float(r.selling_price or 0),
            "mrp": float(r.mrp or 0),
            "saved_at": str(r.saved_at) if r.saved_at else None,
            "batches": batches_by_item.get(r.id, []),
        })

    return {
        "id": st.id,
        "take_no": st.take_no,
        "location_id": st.location_id,
        "location_name": st.location_name,
        "status": st.status,
        "notes": st.notes,
        "started_by": st.started_by,
        "started_by_name": st.started_by_name,
        "started_at": str(st.started_at) if st.started_at else "",
        "finalized_by": st.finalized_by,
        "finalized_by_name": st.finalized_by_name,
        "finalized_at": str(st.finalized_at) if st.finalized_at else "",
        "adjust_stock": st.adjust_stock,
        "total_items": st.total_items,
        "counted_items": counted_count,
        "not_yet_scanned": max(0, st.total_items - counted_count),
        "items_with_variance": items_with_variance,
        "surplus_items": surplus_items,
        "shortage_items": shortage_items,
        "total_variance_value": float(total_variance_value),
        "items": items_out,
    }


# ── 4. Product Lookup for Scanning ───────────────────────────────────────────
@router.post("/lookup")
@router.post("/lookup_ajax")
async def lookup_product_for_stock_take(
    body: LookupIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    q = body.q.strip()
    if not q:
        return {"success": True, "products": []}

    # Verify take is active
    st_res = await db.execute(select(stock_take).where(stock_take.id == body.stock_take_id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")

    # 1. Exact item_code match
    exact_code = (
        select(product_model)
        .where(func.lower(product_model.item_code) == q.lower(), product_model.is_active == True)
        .limit(1)
    )
    prod = (await db.execute(exact_code)).scalar_one_or_none()

    # 2. Exact barcode match
    if not prod:
        # Check barcodes table
        bc_match = (
            select(product_barcode.product_id)
            .where(func.lower(product_barcode.barcode) == q.lower())
            .limit(1)
        )
        bc_pid = (await db.execute(bc_match)).scalar_one_or_none()
        if bc_pid:
            prod = (await db.execute(select(product_model).where(product_model.id == bc_pid, product_model.is_active == True))).scalar_one_or_none()

    if not prod:
        # Check direct barcode on product
        prod = (await db.execute(
            select(product_model).where(
                (func.lower(product_model.barcode) == q.lower()) | (func.lower(product_model.barcode_crt) == q.lower()),
                product_model.is_active == True
            ).limit(1)
        )).scalar_one_or_none()

    found_prods = []
    if prod:
        found_prods = [prod]
    else:
        # 3. Multi-word any-order match
        words = q.split()
        conditions = [product_model.is_active == True]
        for w in words:
            term = f"%{w}%"
            conditions.append(
                product_model.name.ilike(term) |
                product_model.item_code.ilike(term) |
                product_model.barcode.ilike(term)
            )
        mw_stmt = select(product_model).where(*conditions).order_by(product_model.name).limit(8)
        found_prods = (await db.execute(mw_stmt)).scalars().all()

    # Attach stock_take_item counted_qty & system_qty and batches
    results = []
    for p in found_prods:
        sti_res = await db.execute(
            select(stock_take_item).where(
                stock_take_item.stock_take_id == body.stock_take_id,
                stock_take_item.product_id == p.id
            )
        )
        sti = sti_res.scalar_one_or_none()
        sys_q = float(sti.system_qty) if sti else float(p.stock_qty or 0)
        cnt_q = float(sti.counted_qty) if sti and sti.counted_qty is not None else None

        # Fetch batches for this product at this location
        b_stmt = (
            select(
                product_batch.id,
                product_batch.batch_no,
                product_batch.mfg_date,
                product_batch.exp_date,
                product_batch.status,
                func.coalesce(product_batch_stock.current_qty, 0).label("current_qty")
            )
            .outerjoin(
                product_batch_stock,
                (product_batch_stock.batch_id == product_batch.id) & (product_batch_stock.location_id == st.location_id)
            )
            .where(product_batch.product_id == p.id, product_batch.status != "Closed")
            .order_by(product_batch.exp_date.asc().nulls_last(), product_batch.id.asc())
        )
        b_rows = (await db.execute(b_stmt)).all()

        # Check existing counted batches in stock_take_item_batches
        counted_batch_map = {}
        if sti:
            stib_res = await db.execute(
                select(stock_take_item_batch).where(stock_take_item_batch.stock_take_item_id == sti.id)
            )
            for stib in stib_res.scalars().all():
                counted_batch_map[stib.batch_no.strip().upper()] = stib

        batches_out = []
        seen_batch_nos = set()
        for b in b_rows:
            b_no_up = (b.batch_no or "").strip().upper()
            seen_batch_nos.add(b_no_up)
            prev_stib = counted_batch_map.get(b_no_up)
            b_cnt = float(prev_stib.counted_qty) if prev_stib and prev_stib.counted_qty is not None else None
            b_reason = prev_stib.reason if prev_stib else ""
            batches_out.append({
                "batch_id": b.id,
                "batch_no": b.batch_no,
                "mfg_date": str(b.mfg_date) if b.mfg_date else "",
                "expiry_date": str(b.exp_date) if b.exp_date else "",
                "status": b.status or "Active",
                "system_qty": float(b.current_qty or 0),
                "counted_qty": b_cnt,
                "reason": b_reason or "",
            })

        # Also add any custom found batches recorded in stock_take_item_batches
        for b_no_up, stib in counted_batch_map.items():
            if b_no_up not in seen_batch_nos:
                batches_out.append({
                    "batch_id": stib.batch_id,
                    "batch_no": stib.batch_no,
                    "mfg_date": str(stib.mfg_date) if stib.mfg_date else "",
                    "expiry_date": str(stib.expiry_date) if stib.expiry_date else "",
                    "status": "Found Lot",
                    "system_qty": float(stib.system_qty or 0),
                    "counted_qty": float(stib.counted_qty or 0),
                    "reason": stib.reason or "",
                })

        results.append({
            "id": p.id,
            "name": p.name,
            "item_code": p.item_code,
            "barcode": p.barcode or "",
            "unit": p.unit or "PCS",
            "mrp": float(p.mrp or 0),
            "selling_price": float(p.selling_price or 0),
            "cost_price": float(p.cost_price or 0),
            "system_qty": sys_q,
            "counted_qty": cnt_q,
            "stock_qty": float(p.stock_qty or 0),
            "has_batch_tracking": bool(p.has_batch_tracking or len(batches_out) > 0),
            "has_expiry_tracking": bool(p.has_expiry_tracking),
            "batches": batches_out,
        })

    return {"success": True, "products": results}


# ── 5. Scan Save (Cumulative Add) ─────────────────────────────────────────────
@router.post("/scan-save")
@router.post("/scan_save_ajax")
async def scan_save(
    body: ScanSaveIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await access.check_products(db, [body.product_id])  # only items in your categories / groups
    st_res = await db.execute(select(stock_take).where(stock_take.id == body.stock_take_id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is not in progress — counts can no longer be changed")

    # Fetch product
    prod = (await db.execute(select(product_model).where(product_model.id == body.product_id))).scalar_one_or_none()
    if not prod:
        raise HTTPException(404, "Product not found")

    sti = (await db.execute(
        select(stock_take_item).where(
            stock_take_item.stock_take_id == body.stock_take_id,
            stock_take_item.product_id == body.product_id
        )
    )).scalar_one_or_none()

    if not sti:
        # Pre-load on the fly if missing
        sys_stock_res = await db.execute(
            select(outlet_stock.stock_qty).where(
                outlet_stock.outlet_id == st.location_id,
                outlet_stock.product_id == prod.id
            )
        )
        sys_q_val = sys_stock_res.scalar_one_or_none()
        sys_stock = Decimal(str(sys_q_val or prod.stock_qty or 0))

        sti = stock_take_item(
            stock_take_id=st.id,
            product_id=prod.id,
            product_name=prod.name,
            item_code=prod.item_code,
            unit=prod.unit or "PCS",
            system_qty=sys_stock,
            counted_qty=body.qty,
            saved_at=datetime.now(),
        )
        db.add(sti)
        st.total_items += 1
    else:
        # Cumulative ADDS to the count
        existing = Decimal(str(sti.counted_qty or 0)) if sti.counted_qty is not None else Decimal("0")
        sti.counted_qty = existing + Decimal(str(body.qty))
        sti.saved_at = datetime.now()

    await db.flush()

    # Recompute counted_items count
    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == st.id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    new_q = float(sti.counted_qty)
    sys_q = float(sti.system_qty)
    variance = round(new_q - sys_q, 3)

    await db.commit()
    return {
        "success": True,
        "new_qty": new_q,
        "system_qty": sys_q,
        "variance": variance,
        "counted_items": st.counted_items,
        "total_items": st.total_items,
    }


# ── 6. Edit Count (Set Exact or Clear) ─────────────────────────────────────────
@router.post("/edit-count")
@router.post("/edit_count_ajax")
async def edit_count(
    body: EditCountIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await access.check_products(db, [body.product_id])  # only items in your categories / groups
    st_res = await db.execute(select(stock_take).where(stock_take.id == body.stock_take_id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is not in progress — counts can no longer be changed")

    sti = (await db.execute(
        select(stock_take_item).where(
            stock_take_item.stock_take_id == body.stock_take_id,
            stock_take_item.product_id == body.product_id
        )
    )).scalar_one_or_none()
    if not sti:
        raise HTTPException(404, "Stock take line not found")

    old_cnt = sti.counted_qty
    if body.clear:
        sti.counted_qty = None
        sti.saved_at = None
    else:
        sti.counted_qty = Decimal(str(body.qty or 0))
        sti.saved_at = datetime.now()

    await db.flush()

    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == st.id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    new_q = float(sti.counted_qty) if sti.counted_qty is not None else None
    sys_q = float(sti.system_qty)
    variance = round(new_q - sys_q, 3) if new_q is not None else None

    # Audit log
    await write_audit(
        db=db, module="inventory", action="edit_stock_take_count",
        record_id=st.id, record_no=st.take_no,
        description=f"{st.take_no} · {sti.product_name} ({sti.item_code}): {old_cnt} → {new_q if new_q is not None else 'REMOVED'}",
        user_id=user.user_id, user_name=user.username
    )
    await db.commit()
    return {
        "success": True,
        "new_qty": new_q,
        "system_qty": sys_q,
        "variance": variance,
        "counted_items": st.counted_items,
    }


# ── 6B. Save Batch Counts (Batch-Level Physical Count) ────────────────────────
@router.post("/save-batches")
@router.post("/save_batches_ajax")
async def save_stock_take_batches(
    body: SaveBatchesIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await access.check_products(db, [body.product_id])  # only items in your categories / groups
    st_res = await db.execute(select(stock_take).where(stock_take.id == body.stock_take_id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is not in progress — counts can no longer be changed")

    prod = (await db.execute(select(product_model).where(product_model.id == body.product_id))).scalar_one_or_none()
    if not prod:
        raise HTTPException(404, "Product not found")

    sti = (await db.execute(
        select(stock_take_item).where(
            stock_take_item.stock_take_id == body.stock_take_id,
            stock_take_item.product_id == body.product_id
        )
    )).scalar_one_or_none()

    if not sti:
        sys_stock_res = await db.execute(
            select(outlet_stock.stock_qty).where(
                outlet_stock.outlet_id == st.location_id,
                outlet_stock.product_id == prod.id
            )
        )
        sys_q_val = sys_stock_res.scalar_one_or_none()
        sys_stock = Decimal(str(sys_q_val or prod.stock_qty or 0))

        sti = stock_take_item(
            stock_take_id=st.id,
            product_id=prod.id,
            product_name=prod.name,
            item_code=prod.item_code,
            unit=prod.unit or "PCS",
            system_qty=sys_stock,
            counted_qty=Decimal("0.000"),
            saved_at=datetime.now(),
        )
        db.add(sti)
        st.total_items += 1
        await db.flush()

    # Sum total counted across batches
    total_counted = Decimal("0.000")
    for b in body.batches:
        total_counted += Decimal(str(b.counted_qty or 0))

    sti.counted_qty = total_counted
    sti.saved_at = datetime.now()

    if len(body.batches) == 1:
        b0 = body.batches[0]
        sti.batch_id = b0.batch_id
        sti.batch_no = b0.batch_no
        try:
            sti.mfg_date = date.fromisoformat(b0.mfg_date) if b0.mfg_date else None
        except Exception:
            sti.mfg_date = None
        try:
            sti.expiry_date = date.fromisoformat(b0.expiry_date) if b0.expiry_date else None
        except Exception:
            sti.expiry_date = None
        sti.reason = b0.reason

    # Clear previous batch rows for this item and re-insert
    await db.execute(
        delete(stock_take_item_batch).where(stock_take_item_batch.stock_take_item_id == sti.id)
    )

    for b in body.batches:
        b_cnt = Decimal(str(b.counted_qty or 0))
        b_sys = Decimal(str(b.system_qty or 0))
        b_var = b_cnt - b_sys
        try:
            mfg_d = date.fromisoformat(b.mfg_date) if b.mfg_date else None
        except Exception:
            mfg_d = None
        try:
            exp_d = date.fromisoformat(b.expiry_date) if b.expiry_date else None
        except Exception:
            exp_d = None

        stib = stock_take_item_batch(
            stock_take_item_id=sti.id,
            stock_take_id=st.id,
            product_id=prod.id,
            batch_id=b.batch_id,
            batch_no=b.batch_no.strip(),
            mfg_date=mfg_d,
            expiry_date=exp_d,
            system_qty=b_sys,
            counted_qty=b_cnt,
            variance=b_var,
            reason=b.reason or None,
        )
        db.add(stib)

    await db.flush()

    # Recompute counted_items
    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == st.id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    new_q = float(sti.counted_qty)
    sys_q = float(sti.system_qty)
    variance = round(new_q - sys_q, 3)

    # Audit log
    batch_summary = ", ".join([f"{b.batch_no}: {b.counted_qty}" for b in body.batches])
    await write_audit(
        db=db, module="inventory", action="save_stock_take_batches",
        record_id=st.id, record_no=st.take_no,
        description=f"{st.take_no} · {sti.product_name}: {batch_summary} (Total Count: {new_q})",
        user_id=getattr(user, "user_id", getattr(user, "id", None)),
        user_name=getattr(user, "username", "system")
    )
    await db.commit()

    return {
        "success": True,
        "new_qty": new_q,
        "system_qty": sys_q,
        "variance": variance,
        "counted_items": st.counted_items,
        "total_items": st.total_items,
        "batches": [
            {
                "batch_id": b.batch_id,
                "batch_no": b.batch_no,
                "mfg_date": b.mfg_date,
                "expiry_date": b.expiry_date,
                "system_qty": b.system_qty,
                "counted_qty": b.counted_qty,
                "variance": round(b.counted_qty - b.system_qty, 3),
                "reason": b.reason or "",
            }
            for b in body.batches
        ]
    }


# ── 7. Zero Uncounted ─────────────────────────────────────────────────────────
@router.post("/zero-uncounted")
@router.post("/zero_uncounted_ajax")
async def zero_uncounted(
    stock_take_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    st_res = await db.execute(select(stock_take).where(stock_take.id == stock_take_id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is not in progress")

    await db.execute(
        update(stock_take_item)
        .where(stock_take_item.stock_take_id == stock_take_id, stock_take_item.counted_qty.is_(None))
        .values(counted_qty=Decimal("0.000"), saved_at=datetime.now())
    )

    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == st.id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    await db.commit()
    return {"success": True, "counted_items": st.counted_items}


# ── 8. Finalize Stock Take ────────────────────────────────────────────────────
@router.post("/finalize/{id}")
async def finalize_stock_take(
    id: int,
    body: FinalizeIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    st_res = await db.execute(select(stock_take).where(stock_take.id == id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is already finalized or cancelled")

    # If zero uncounted option selected
    if body.zero_uncounted:
        await db.execute(
            update(stock_take_item)
            .where(stock_take_item.stock_take_id == id, stock_take_item.counted_qty.is_(None))
            .values(counted_qty=Decimal("0.000"), saved_at=datetime.now())
        )

    # Fetch all counted items
    items_stmt = select(stock_take_item).where(
        stock_take_item.stock_take_id == id,
        stock_take_item.counted_qty.isnot(None)
    )
    items = (await db.execute(items_stmt)).scalars().all()

    if body.adjust_stock:
        # Pre-fetch all batch breakdowns for items in this stock take
        all_stib = (await db.execute(
            select(stock_take_item_batch).where(stock_take_item_batch.stock_take_id == id)
        )).scalars().all()
        batches_by_sti = {}
        for b in all_stib:
            batches_by_sti.setdefault(b.stock_take_item_id, []).append(b)

        for it in items:
            counted = it.counted_qty or Decimal("0")
            sys_q = it.system_qty or Decimal("0")
            variance = counted - sys_q
            item_batches = batches_by_sti.get(it.id, [])

            if variance != Decimal("0") or item_batches:
                # 1. Update location stock
                await db.execute(
                    text("""
                        INSERT INTO outlet_stock (outlet_id, product_id, stock_qty, updated_at)
                        VALUES (:oid, :pid, :qty, NOW())
                        ON CONFLICT (outlet_id, product_id)
                        DO UPDATE SET stock_qty = :qty, updated_at = NOW()
                    """),
                    {"oid": st.location_id, "pid": it.product_id, "qty": float(counted)}
                )

                # 2. Update master product stock
                if variance != Decimal("0"):
                    await db.execute(
                        text("UPDATE products SET stock_qty = stock_qty + :v WHERE id = :pid"),
                        {"v": float(variance), "pid": it.product_id}
                    )

                # 3. Batch stock adjustments
                if item_batches:
                    for b in item_batches:
                        b_var = b.variance if b.variance is not None else (b.counted_qty - b.system_qty)
                        if b_var != Decimal("0"):
                            txn_type = "adjustment_in" if b_var >= Decimal("0") else "adjustment_out"
                            actual_batch_id = b.batch_id
                            if not actual_batch_id:
                                pb = await batch_service.get_or_create_batch(
                                    db=db,
                                    product_id=it.product_id,
                                    batch_no=b.batch_no,
                                    mfg_date=b.mfg_date,
                                    exp_date=b.expiry_date,
                                    created_by=user.user_id,
                                )
                                actual_batch_id = pb.id
                                b.batch_id = pb.id

                            await batch_service.record_batch_movement(
                                db=db,
                                batch_id=actual_batch_id,
                                location_id=st.location_id,
                                qty_delta=b_var,
                                movement_type="stock_take_adjustment",
                                product_id=it.product_id,
                                allow_negative=True,
                            )

                            await _write_stock_ledger(
                                db,
                                it.product_id,
                                txn_type,
                                abs(b_var),
                                st.id,
                                "stock_take",
                                st.location_id,
                                f"Stock Take Batch Adjustment: {st.take_no} (Batch: {b.batch_no})",
                                user.user_id,
                                batch_no=b.batch_no,
                                batch_id=actual_batch_id,
                                expiry_date=b.expiry_date,
                            )
                else:
                    if variance != Decimal("0"):
                        txn_type = "adjustment_in" if variance >= Decimal("0") else "adjustment_out"
                        await _write_stock_ledger(
                            db,
                            it.product_id,
                            txn_type,
                            abs(variance),
                            st.id,
                            "stock_take",
                            st.location_id,
                            f"Stock Take Adjustment: {st.take_no}" + (f" (Batch: {it.batch_no})" if it.batch_no else ""),
                            user.user_id,
                            batch_no=it.batch_no,
                            batch_id=it.batch_id,
                            expiry_date=it.expiry_date,
                        )

                        if it.batch_id:
                            await batch_service.record_batch_movement(
                                db=db,
                                batch_id=it.batch_id,
                                location_id=st.location_id,
                                qty_delta=variance,
                                movement_type="stock_take_adjustment",
                                product_id=it.product_id,
                                allow_negative=True,
                            )

    st.status = "completed"
    st.adjust_stock = body.adjust_stock
    st.finalized_by = user.user_id
    st.finalized_by_name = user.username
    st.finalized_at = datetime.now()

    # Update counted_items total
    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == st.id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    await write_audit(
        db=db, module="inventory", action="finalize_stock_take",
        record_id=st.id, record_no=st.take_no,
        description=f"Finalized stock take {st.take_no} (adjust_stock={body.adjust_stock})",
        user_id=user.user_id, user_name=user.username
    )
    await db.commit()
    return {"success": True, "message": "Stock take finalized successfully", "status": "completed"}


# ── 9. Cancel Stock Take ──────────────────────────────────────────────────────
@router.post("/cancel/{id}")
async def cancel_stock_take(
    id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_role("admin", "manager")),
):
    st_res = await db.execute(select(stock_take).where(stock_take.id == id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Only in-progress stock takes can be cancelled")

    st.status = "cancelled"
    st.notes = (st.notes or "") + f" [Cancelled by {user.username}]"
    await write_audit(
        db=db, module="inventory", action="cancel_stock_take",
        record_id=st.id, record_no=st.take_no,
        description=f"Cancelled stock take {st.take_no}",
        user_id=user.user_id, user_name=user.username
    )
    await db.commit()
    return {"success": True, "message": "Stock take cancelled"}


def _parse_import_date(d_val: str | None) -> date | None:
    if not d_val:
        return None
    d_clean = str(d_val).strip()
    if not d_clean or d_clean in ("-", "—", "None", "null"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(d_clean, fmt).date()
        except ValueError:
            pass
    try:
        return date.fromisoformat(d_clean)
    except Exception:
        return None


class ImportRow(BaseModel):
    item_code: str
    qty: Decimal
    batch_no: str | None = None
    expiry_date: str | None = None
    mfg_date: str | None = None
    mrp: Decimal | None = None

class ImportBatchIn(BaseModel):
    items: list[ImportRow]

@router.post("/import/{id}")
async def import_counts(
    id: int,
    body: ImportBatchIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    st_res = await db.execute(select(stock_take).where(stock_take.id == id))
    st = st_res.scalar_one_or_none()
    if st:
        access.check_outlet(st.location_id)   # only stock takes at your locations
    if not st:
        raise HTTPException(404, "Stock take not found")
    if st.status != "in_progress":
        raise HTTPException(400, "Stock take is not in progress")

    not_found_codes = []
    invalid_codes = []
    duplicate_codes = []
    seen_keys = set()
    products_cleared_for_batches = set()
    applied_count = 0

    for row in body.items:
        code = str(row.item_code or "").strip()
        if not code:
            continue

        batch_str = str(row.batch_no or "").strip() if row.batch_no else None
        row_key = f"{code.lower()}::{batch_str.lower() if batch_str else ''}"

        if row_key in seen_keys:
            duplicate_codes.append(f"{code} (batch: {batch_str})" if batch_str else code)
        seen_keys.add(row_key)

        try:
            qty_val = Decimal(str(row.qty))
            if qty_val < Decimal("0"):
                invalid_codes.append(f"{code} (qty < 0)")
                continue
        except Exception:
            invalid_codes.append(f"{code} (invalid qty)")
            continue

        # Look up product: exact item_code -> barcode -> without leading zeros
        p = (await db.execute(
            select(product_model).where(func.lower(product_model.item_code) == code.lower(), product_model.is_active == True).limit(1)
        )).scalar_one_or_none()

        if not p:
            # Try barcode
            p = (await db.execute(
                select(product_model).where(
                    (func.lower(product_model.barcode) == code.lower()) | (func.lower(product_model.barcode_crt) == code.lower()),
                    product_model.is_active == True
                ).limit(1)
            )).scalar_one_or_none()

        if not p:
            # Try barcode table
            bc_res = await db.execute(
                select(product_barcode.product_id).where(func.lower(product_barcode.barcode) == code.lower()).limit(1)
            )
            bc_id = bc_res.scalar_one_or_none()
            if bc_id:
                p = (await db.execute(select(product_model).where(product_model.id == bc_id, product_model.is_active == True))).scalar_one_or_none()

        if not p and code.isdigit():
            # Try without leading zeros
            stripped = code.lstrip("0")
            if stripped:
                p = (await db.execute(
                    select(product_model).where(product_model.item_code == stripped, product_model.is_active == True).limit(1)
                )).scalar_one_or_none()

        if not p:
            not_found_codes.append(code)
            continue

        # Get or create stock_take_item
        sti = (await db.execute(
            select(stock_take_item).where(
                stock_take_item.stock_take_id == id,
                stock_take_item.product_id == p.id
            )
        )).scalar_one_or_none()

        if not sti:
            sys_stock_res = await db.execute(
                select(outlet_stock.stock_qty).where(
                    outlet_stock.outlet_id == st.location_id,
                    outlet_stock.product_id == p.id
                )
            )
            sys_val = sys_stock_res.scalar_one_or_none()
            sti = stock_take_item(
                stock_take_id=id,
                product_id=p.id,
                product_name=p.name,
                item_code=p.item_code,
                unit=p.unit or "PCS",
                system_qty=Decimal(str(sys_val or p.stock_qty or 0)),
                counted_qty=Decimal("0.000") if batch_str else qty_val,
                saved_at=datetime.now(),
            )
            db.add(sti)
            st.total_items += 1
            await db.flush()

        if batch_str:
            # Batch-level import
            if p.id not in products_cleared_for_batches:
                # First time seeing this product with batches in this import: clear old batches & reset count
                await db.execute(
                    delete(stock_take_item_batch).where(stock_take_item_batch.stock_take_item_id == sti.id)
                )
                sti.counted_qty = Decimal("0.000")
                products_cleared_for_batches.add(p.id)

            # Look up registered batch in product_batches
            pb_row = (await db.execute(
                select(product_batch).where(
                    product_batch.product_id == p.id,
                    func.lower(product_batch.batch_no) == batch_str.lower()
                ).limit(1)
            )).scalar_one_or_none()

            batch_id = pb_row.id if pb_row else None
            mfg_d = _parse_import_date(row.mfg_date) or (pb_row.mfg_date if pb_row else None)
            exp_d = _parse_import_date(row.expiry_date) or (pb_row.exp_date if pb_row else None)

            # Get system qty for this batch at this location
            b_sys = Decimal("0.000")
            if batch_id:
                pbs_q = (await db.execute(
                    select(product_batch_stock.current_qty).where(
                        product_batch_stock.batch_id == batch_id,
                        product_batch_stock.location_id == st.location_id
                    )
                )).scalar_one_or_none()
                if pbs_q is not None:
                    b_sys = Decimal(str(pbs_q))

            b_var = qty_val - b_sys

            stib = stock_take_item_batch(
                stock_take_item_id=sti.id,
                stock_take_id=st.id,
                product_id=p.id,
                batch_id=batch_id,
                batch_no=batch_str,
                mfg_date=mfg_d,
                expiry_date=exp_d,
                system_qty=b_sys,
                counted_qty=qty_val,
                variance=b_var,
                reason="Excel Import",
            )
            db.add(stib)

            # Accumulate into product total counted_qty
            sti.counted_qty = (sti.counted_qty or Decimal("0.000")) + qty_val
            sti.batch_no = batch_str
            sti.mfg_date = mfg_d
            sti.expiry_date = exp_d
            sti.saved_at = datetime.now()
        else:
            # Simple item-level count
            sti.counted_qty = qty_val
            sti.saved_at = datetime.now()

        applied_count += 1

    await db.flush()
    c_res = await db.execute(
        select(func.count(stock_take_item.id)).where(
            stock_take_item.stock_take_id == id,
            stock_take_item.counted_qty.isnot(None)
        )
    )
    st.counted_items = c_res.scalar_one() or 0

    await db.commit()
    return {
        "success": True,
        "applied_count": applied_count,
        "not_found_codes": not_found_codes,
        "invalid_codes": invalid_codes,
        "duplicate_codes": duplicate_codes,
        "counted_items": st.counted_items,
    }
