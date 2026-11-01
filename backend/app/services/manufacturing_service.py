"""
Nutribray Manufacturing Service.
Single Source of Truth: Integrates with existing Stock Ledger and Batch Service.
Enforces:
- Atomic database transactions
- No unauthorized negative stock
- Multi-stage lifecycle: Draft -> Approved -> Reserved -> Issued -> In Production -> QC Pending -> Released -> Completed
- Full forward and backward batch traceability
- Exact yield, scrap, and variance accounting
"""
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy import select, update, func, and_, or_, desc, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.company import CompanySetting
from app.models.product import product as product_model
from app.models.batch import product_batch, product_batch_stock
from app.models.purchase import po_header, po_item, purchase, purchase_item
from app.models.party import supplier
from app.models.outlet import outlet
from app.models.user import user
from app.models.invoice import stock_ledger, invoice, invoice_item
from app.models.sync import unit_wise_stock_transfer, unit_wise_stock_transfer_item
from app.models.manufacturing import (
    mfg_bom,
    mfg_bom_item,
    mfg_order,
    mfg_order_item,
    mfg_order_batch,
    mfg_order_output,
)
from app.services.billing_service import _write_stock_ledger, _update_product_stock
from app.services import batch_service
from app.services.auth_service import write_audit

ZERO = Decimal("0.000")
FOUR_ZERO = Decimal("0.0000")


def _to_dec(val: Any) -> Decimal:
    if val is None:
        return Decimal("0.000")
    return Decimal(str(val))


def _to_four(val: Any) -> Decimal:
    if val is None:
        return FOUR_ZERO
    return Decimal(str(val)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


# ─── NUMBER GENERATORS ────────────────────────────────────────────────────────
async def get_next_bom_no(db: AsyncSession) -> str:
    today_str = date.today().strftime("%Y%m%d")
    prefix = f"BOM-{today_str}-"
    res = await db.execute(
        select(func.count(mfg_bom.id)).where(mfg_bom.bom_no.like(f"{prefix}%"))
    )
    cnt = res.scalar() or 0
    return f"{prefix}{cnt + 1:04d}"


async def get_next_order_no(db: AsyncSession, prefix_override: Optional[str] = None) -> str:
    today_str = date.today().strftime("%Y%m%d")
    p = prefix_override or "MO-"
    full_p = f"{p}{today_str}-"
    res = await db.execute(
        select(func.count(mfg_order.id)).where(mfg_order.order_no.like(f"{full_p}%"))
    )
    cnt = res.scalar() or 0
    return f"{full_p}{cnt + 1:04d}"


async def get_next_batch_no(db: AsyncSession, product_id: int, prefix_override: Optional[str] = None) -> str:
    today_str = date.today().strftime("%Y%m%d")
    p = prefix_override or "BAT-"
    full_p = f"{p}{today_str}-{product_id}-"
    res = await db.execute(
        select(func.count(product_batch.id)).where(product_batch.batch_no.like(f"{full_p}%"))
    )
    cnt = res.scalar() or 0
    return f"{full_p}{cnt + 1:03d}"


async def get_next_output_no(db: AsyncSession) -> str:
    today_str = date.today().strftime("%Y%m%d")
    full_p = f"OUT-{today_str}-"
    res = await db.execute(
        select(func.count(mfg_order_output.id)).where(mfg_order_output.output_no.like(f"{full_p}%"))
    )
    cnt = res.scalar() or 0
    return f"{full_p}{cnt + 1:04d}"


# ─── BILL OF MATERIALS (BOM) SERVICES ─────────────────────────────────────────
async def _build_items(db: AsyncSession, data: Any):
    """Cost every BOM line; returns (line objects, total material cost)."""
    total_material_cost = Decimal("0.00")
    items_to_add = []

    for idx, it in enumerate(data.items, start=1):
        item_prod = await db.get(product_model, it.product_id)
        if not item_prod:
            raise ValueError(f"BOM line item product ID {it.product_id} does not exist.")

        # Unit cost fallback
        unit_cost = _to_dec(it.cost_per_unit)
        if unit_cost <= ZERO:
            unit_cost = _to_dec(item_prod.cost_price or item_prod.purchase_price)

        line_qty = _to_dec(it.quantity)
        line_cost = (line_qty * unit_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_material_cost += line_cost

        items_to_add.append(
            mfg_bom_item(
                product_id=it.product_id,
                material_type=it.material_type,
                quantity=line_qty,
                unit=it.unit or item_prod.unit or "KG",
                wastage_pct=_to_dec(it.wastage_pct),
                cost_per_unit=unit_cost,
                total_cost=line_cost,
                is_critical=it.is_critical,
                sub_bom_id=it.sub_bom_id,
                stage=it.stage or "Mixing",
                sequence=it.sequence or idx,
                notes=it.notes,
                round_up=getattr(it, "round_up", False),
                preferred_store_id=getattr(it, "preferred_store_id", None),
            )
        )

    return items_to_add, total_material_cost


async def create_bom(db: AsyncSession, data: Any, user_id: Optional[int]) -> mfg_bom:
    # 1. Verify finished/semi-finished product exists
    prod = await db.get(product_model, data.product_id)
    if not prod:
        raise ValueError(f"Product with ID {data.product_id} does not exist.")

    bom_number = data.bom_no or await get_next_bom_no(db)

    items_to_add, total_material_cost = await _build_items(db, data)

    bom_obj = mfg_bom(
        bom_no=bom_number,
        bom_name=data.bom_name,
        product_id=data.product_id,
        revision=data.revision or 1,
        version_label=data.version_label or "v1.0",
        product_type=data.product_type or "FINISHED",
        batch_size=_to_dec(data.batch_size),
        batch_unit=data.batch_unit or prod.unit or "PCS",
        expected_yield_pct=_to_dec(data.expected_yield_pct or 100.00),
        tolerance_pct=_to_dec(data.tolerance_pct or 2.00),
        expected_wastage_pct=_to_dec(data.expected_wastage_pct or 0.00),
        valid_from=data.valid_from,
        valid_to=data.valid_to,
        status="DRAFT",
        labor_cost=_to_dec(data.labor_cost),
        overhead_cost=_to_dec(data.overhead_cost),
        total_cost=total_material_cost + _to_dec(data.labor_cost) + _to_dec(data.overhead_cost),
        notes=data.notes,
        created_by=user_id,
    )
    bom_obj.items = items_to_add
    db.add(bom_obj)
    await db.commit()
    await db.refresh(bom_obj)
    return bom_obj


async def approve_bom(db: AsyncSession, bom_id: int, user_id: int, remarks: Optional[str] = None) -> mfg_bom:
    bom_obj = await db.get(mfg_bom, bom_id)
    if not bom_obj:
        raise ValueError("BOM not found")
    bom_obj.status = "APPROVED"
    bom_obj.approved_by = user_id
    bom_obj.approved_at = datetime.now()
    bom_obj.approval_remarks = remarks
    await db.commit()
    await db.refresh(bom_obj)
    return bom_obj


async def reject_bom(db: AsyncSession, bom_id: int, user_id: int, remarks: Optional[str] = None) -> mfg_bom:
    bom_obj = await db.get(mfg_bom, bom_id)
    if not bom_obj:
        raise ValueError("BOM not found")
    bom_obj.status = "REJECTED"
    bom_obj.approved_by = user_id
    bom_obj.approved_at = datetime.now()
    bom_obj.approval_remarks = remarks
    await db.commit()
    await db.refresh(bom_obj)
    return bom_obj


async def clone_bom_revision(db: AsyncSession, bom_id: int, user_id: int) -> mfg_bom:
    """Creates a new draft revision of an existing BOM (e.g. revision 2, v2.0)."""
    orig = await db.get(mfg_bom, bom_id)
    if not orig:
        raise ValueError("Original BOM not found")

    # Find highest revision for this product
    res = await db.execute(
        select(func.max(mfg_bom.revision)).where(mfg_bom.product_id == orig.product_id)
    )
    max_rev = res.scalar() or orig.revision
    new_rev = max_rev + 1

    new_bom_no = f"{orig.bom_no.split('-r')[0]}-r{new_rev}"
    new_bom = mfg_bom(
        bom_no=new_bom_no,
        bom_name=f"{orig.bom_name} (Rev {new_rev})",
        product_id=orig.product_id,
        revision=new_rev,
        version_label=f"v{new_rev}.0",
        product_type=orig.product_type,
        batch_size=orig.batch_size,
        batch_unit=orig.batch_unit,
        expected_yield_pct=orig.expected_yield_pct,
        tolerance_pct=orig.tolerance_pct,
        expected_wastage_pct=orig.expected_wastage_pct,
        valid_from=date.today(),
        status="DRAFT",
        labor_cost=orig.labor_cost,
        overhead_cost=orig.overhead_cost,
        total_cost=orig.total_cost,
        notes=f"Cloned from BOM #{orig.bom_no}",
        created_by=user_id,
    )

    new_items = []
    for item in orig.items:
        new_items.append(
            mfg_bom_item(
                product_id=item.product_id,
                material_type=item.material_type,
                quantity=item.quantity,
                unit=item.unit,
                wastage_pct=item.wastage_pct,
                cost_per_unit=item.cost_per_unit,
                total_cost=item.total_cost,
                is_critical=item.is_critical,
                sub_bom_id=item.sub_bom_id,
                stage=item.stage,
                sequence=item.sequence,
                notes=item.notes,
                round_up=item.round_up,
                preferred_store_id=item.preferred_store_id,
            )
        )
    new_bom.items = new_items
    db.add(new_bom)
    await db.commit()
    await db.refresh(new_bom)
    return new_bom


# ─── MANUFACTURING ORDER SERVICES ─────────────────────────────────────────────
async def create_mfg_order(db: AsyncSession, data: Any, user_id: Optional[int]) -> mfg_order:
    # 1. Validate BOM
    bom = await db.get(mfg_bom, data.bom_id)
    if not bom:
        raise ValueError(f"BOM ID {data.bom_id} not found.")

    # Check Company Settings if BOM approval is required
    settings = (await db.execute(select(CompanySetting).order_by(CompanySetting.id))).scalars().first()
    require_approval = settings.require_bom_approval if settings else True

    if require_approval and bom.status != "APPROVED":
        raise ValueError(f"Only APPROVED BOMs can be used for manufacturing orders. Current BOM status: {bom.status}")

    # 2. Check Product
    prod = await db.get(product_model, data.product_id)
    if not prod:
        raise ValueError(f"Finished product ID {data.product_id} not found.")

    order_number = await get_next_order_no(db, settings.mfg_order_number_prefix if settings else "MO-")
    planned_qty = _to_dec(data.planned_qty)
    scale_factor = planned_qty / bom.batch_size

    # 3. Compute material requirements from BOM items
    order_items_to_add = []
    estimated_material_cost = Decimal("0.00")

    for b_item in bom.items:
        # Quantity required = (BOM item qty * scale_factor) * (1 + wastage_pct / 100)
        base_req = b_item.quantity * scale_factor
        wastage_adj = base_req * (_to_dec(b_item.wastage_pct) / Decimal("100"))
        total_req = _to_four(base_req + wastage_adj)

        unit_cost = _to_dec(b_item.cost_per_unit)
        line_cost = (total_req * unit_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        estimated_material_cost += line_cost

        order_items_to_add.append(
            mfg_order_item(
                product_id=b_item.product_id,
                material_type=b_item.material_type,
                required_qty=total_req,
                reserved_qty=FOUR_ZERO,
                issued_qty=FOUR_ZERO,
                consumed_qty=FOUR_ZERO,
                returned_qty=FOUR_ZERO,
                unit=b_item.unit,
                cost_per_unit=unit_cost,
                total_cost=line_cost,
                status="PENDING",
            )
        )

    # Total estimated cost
    total_est = estimated_material_cost + (bom.labor_cost * scale_factor) + (bom.overhead_cost * scale_factor)

    order_obj = mfg_order(
        order_no=order_number,
        product_id=data.product_id,
        bom_id=data.bom_id,
        planned_qty=planned_qty,
        completed_qty=ZERO,
        rejected_qty=ZERO,
        scrap_qty=ZERO,
        unit=data.unit or prod.unit or "PCS",
        plant_id=data.plant_id or (settings.production_store_id if settings else None),
        department=data.department or "Production",
        source_warehouse_id=data.source_warehouse_id or (settings.raw_material_warehouse_id if settings else None),
        target_warehouse_id=data.target_warehouse_id or (settings.finished_goods_warehouse_id if settings else None),
        planned_start_date=data.planned_start_date,
        planned_end_date=data.planned_end_date,
        status="DRAFT",
        qc_status="PENDING",
        estimated_cost=total_est.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        actual_cost=Decimal("0.00"),
        notes=data.notes,
        created_by=user_id,
    )
    order_obj.items = order_items_to_add

    db.add(order_obj)
    await db.commit()
    await db.refresh(order_obj)
    return order_obj


async def approve_mfg_order(db: AsyncSession, order_id: int, user_id: int) -> mfg_order:
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")
    if order.status != "DRAFT":
        raise ValueError(f"Cannot approve order in status '{order.status}'")

    order.status = "APPROVED"
    order.approved_by = user_id
    order.approved_at = datetime.now()
    await db.commit()
    await db.refresh(order)
    return order


# ─── MATERIAL PLANNING, SHORTAGES & RESERVATIONS ─────────────────────────────
async def get_material_planning(db: AsyncSession, order_id: int) -> Dict[str, Any]:
    """
    Computes material requirements vs current available stock across warehouses.
    Provides FEFO batch suggestions for eligible batches with QC release.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")

    prod = await db.get(product_model, order.product_id)

    requirements = []
    shortage_count = 0

    for item in order.items:
        p = await db.get(product_model, item.product_id)
        current_stock = _to_dec(p.stock_qty if p else 0)
        req_qty = item.required_qty
        shortage = max(ZERO, req_qty - current_stock)
        if shortage > ZERO:
            shortage_count += 1

        # Query active batches for this product using FEFO (earliest expiry first)
        loc_id = order.source_warehouse_id or 1
        batch_q = (
            select(product_batch_stock, product_batch)
            .join(product_batch, product_batch_stock.batch_id == product_batch.id)
            .where(
                product_batch_stock.product_id == item.product_id,
                product_batch_stock.location_id == loc_id,
                product_batch_stock.current_qty > ZERO,
                product_batch.status.in_(["Active", "Near Expiry"]),
                product_batch.qc_status.in_(["Active", "Released", "RELEASED", "NOT_REQUIRED"]),
            )
            .order_by(
                product_batch.exp_date.asc().nulls_last(),
                product_batch.mfg_date.asc().nulls_last(),
                product_batch_stock.current_qty.desc(),
            )
        )
        batch_rows = (await db.execute(batch_q)).all()

        suggested = []
        rem_needed = req_qty
        for st_row, b_row in batch_rows:
            avail = _to_dec(st_row.current_qty) - _to_dec(st_row.reserved_qty)
            if avail <= ZERO:
                continue
            alloc = min(rem_needed, avail)
            suggested.append({
                "batch_id": b_row.id,
                "batch_no": b_row.batch_no,
                "expiry_date": b_row.exp_date,
                "available_qty": avail,
                "allocated_qty": alloc,
            })
            rem_needed -= alloc
            if rem_needed <= ZERO:
                break

        requirements.append({
            "product_id": item.product_id,
            "product_name": p.name if p else f"Item #{item.product_id}",
            "item_code": p.item_code if p else None,
            "material_type": item.material_type,
            "required_qty": req_qty,
            "unit": item.unit,
            "available_stock": current_stock,
            "shortage_qty": shortage,
            "suggested_batches": suggested,
        })

    return {
        "mfg_order_id": order.id,
        "order_no": order.order_no,
        "product_id": order.product_id,
        "product_name": prod.name if prod else "",
        "planned_qty": order.planned_qty,
        "unit": order.unit,
        "requirements": requirements,
        "has_shortage": shortage_count > 0,
        "total_shortage_items": shortage_count,
    }


async def reserve_materials(db: AsyncSession, order_id: int, reservations: List[Any], user_id: int) -> mfg_order:
    """
    Reserves batches for an order without double deducting physical inventory.
    Increments product_batch_stock.reserved_qty and records mfg_order_batches.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")
    if order.status not in ("APPROVED", "RESERVED"):
        raise ValueError(f"Cannot reserve materials for order in status '{order.status}'")

    loc_id = order.source_warehouse_id or 1

    for res in reservations:
        qty_to_reserve = _to_dec(res.qty)
        if qty_to_reserve <= ZERO:
            continue

        item = await db.get(mfg_order_item, res.order_item_id)
        if not item or item.mfg_order_id != order.id:
            raise ValueError(f"Order item {res.order_item_id} does not belong to this order.")

        # Lock batch stock row
        st_row = (await db.execute(
            select(product_batch_stock).where(
                product_batch_stock.batch_id == res.batch_id,
                product_batch_stock.location_id == loc_id,
            ).with_for_update()
        )).scalar_one_or_none()

        if not st_row:
            raise ValueError(f"No stock found for Batch ID {res.batch_id} at location {loc_id}")

        avail = _to_dec(st_row.current_qty) - _to_dec(st_row.reserved_qty)
        if avail < qty_to_reserve:
            raise ValueError(
                f"Insufficient available stock in Batch '{res.batch_no}' to reserve {qty_to_reserve}. "
                f"Available: {avail}"
            )

        # Update batch stock reservation
        st_row.reserved_qty += qty_to_reserve

        # Add or update mfg_order_batches
        ob_row = (await db.execute(
            select(mfg_order_batch).where(
                mfg_order_batch.mfg_order_id == order.id,
                mfg_order_batch.mfg_order_item_id == item.id,
                mfg_order_batch.batch_id == res.batch_id,
            )
        )).scalar_one_or_none()

        if ob_row:
            ob_row.reserved_qty += qty_to_reserve
        else:
            db.add(mfg_order_batch(
                mfg_order_id=order.id,
                mfg_order_item_id=item.id,
                product_id=res.product_id,
                batch_id=res.batch_id,
                batch_no=res.batch_no,
                expiry_date=res.expiry_date,
                reserved_qty=qty_to_reserve,
                status="RESERVED",
            ))

        item.reserved_qty += qty_to_reserve
        item.status = "RESERVED"

    order.status = "RESERVED"
    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(order)
    return order


async def issue_materials_to_production(
    db: AsyncSession,
    order_id: int,
    issues: List[Any],
    user_id: int,
    transfer_to_department: Optional[str] = None,
    notes: Optional[str] = None,
) -> mfg_order:
    """
    Issues reserved or specified materials to the shop floor.
    - Releases reservation from product_batch_stock.reserved_qty
    - Deducts from source warehouse stock
    - Writes atomic stock_ledger movement: 'material_issue'
    - Updates MO status to IN_PRODUCTION
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")
    if order.status not in ("APPROVED", "RESERVED", "ISSUED", "IN_PRODUCTION"):
        raise ValueError(f"Cannot issue materials for order in status '{order.status}'")

    loc_id = order.source_warehouse_id or 1

    for iss in issues:
        qty_to_issue = _to_dec(iss.qty)
        if qty_to_issue <= ZERO:
            continue

        item = await db.get(mfg_order_item, iss.order_item_id)
        if not item or item.mfg_order_id != order.id:
            raise ValueError(f"Order item {iss.order_item_id} invalid.")

        batch_obj = await db.get(product_batch, iss.batch_id)
        if not batch_obj:
            raise ValueError(f"Batch {iss.batch_id} not found.")

        # Check QC status: QC must not be quarantined or pending release
        if batch_obj.qc_status in ("Pending_QC", "Quarantined", "Rejected"):
            raise ValueError(
                f"Batch '{batch_obj.batch_no}' is on QC hold ({batch_obj.qc_status}). "
                f"Materials on QC hold cannot be issued to production."
            )

        # 1. Deduct batch stock from source location
        stock_row = await batch_service.record_batch_movement(
            db=db,
            batch_id=batch_obj.id,
            location_id=loc_id,
            qty_delta=-qty_to_issue,
            movement_type="transfer_out",
            product_id=item.product_id,
            allow_negative=False,
        )

        # If it was reserved, reduce reserved_qty
        if stock_row.reserved_qty >= qty_to_issue:
            stock_row.reserved_qty -= qty_to_issue

        # 2. Update master product stock
        await _update_product_stock(db, item.product_id, -qty_to_issue)

        # 3. Post to single source of truth: stock_ledger
        await _write_stock_ledger(
            db=db,
            product_id=item.product_id,
            txn_type="material_issue",
            qty=-qty_to_issue,
            ref_id=order.id,
            ref_type="mfg_order",
            outlet_id=loc_id,
            notes=f"Issued to {order.order_no} ({order.department})",
            user_id=user_id,
            batch_no=batch_obj.batch_no,
            batch_id=batch_obj.id,
            expiry_date=batch_obj.exp_date,
        )

        # 4. Update order items & batch records
        item.issued_qty += qty_to_issue
        item.status = "ISSUED"

        ob_row = (await db.execute(
            select(mfg_order_batch).where(
                mfg_order_batch.mfg_order_id == order.id,
                mfg_order_batch.mfg_order_item_id == item.id,
                mfg_order_batch.batch_id == batch_obj.id,
            )
        )).scalar_one_or_none()

        if ob_row:
            ob_row.issued_qty += qty_to_issue
            ob_row.status = "ISSUED"
        else:
            db.add(mfg_order_batch(
                mfg_order_id=order.id,
                mfg_order_item_id=item.id,
                product_id=item.product_id,
                batch_id=batch_obj.id,
                batch_no=batch_obj.batch_no,
                expiry_date=batch_obj.exp_date,
                issued_qty=qty_to_issue,
                status="ISSUED",
            ))

    order.status = "IN_PRODUCTION"
    if not order.actual_start_date:
        order.actual_start_date = datetime.now()
    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(order)
    return order


async def record_material_consumption(
    db: AsyncSession,
    order_id: int,
    consumptions: List[Any],
    user_id: int,
    notes: Optional[str] = None,
) -> mfg_order:
    """
    Records actual consumption during production for accurate yield/scrap calculation.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")

    for con in consumptions:
        qty_consumed = _to_dec(con.qty)
        if qty_consumed <= ZERO:
            continue

        item = await db.get(mfg_order_item, con.order_item_id)
        if not item or item.mfg_order_id != order.id:
            raise ValueError(f"Order item {con.order_item_id} invalid.")

        item.consumed_qty += qty_consumed
        item.status = "CONSUMED"

        ob_row = (await db.execute(
            select(mfg_order_batch).where(
                mfg_order_batch.mfg_order_id == order.id,
                mfg_order_batch.mfg_order_item_id == item.id,
                mfg_order_batch.batch_id == con.batch_id,
            )
        )).scalar_one_or_none()

        if ob_row:
            ob_row.consumed_qty += qty_consumed
            ob_row.status = "CONSUMED"

    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(order)
    return order


async def return_unused_materials(
    db: AsyncSession,
    order_id: int,
    returns: List[Any],
    user_id: int,
    notes: Optional[str] = None,
) -> mfg_order:
    """
    Returns unconsumed materials back to warehouse inventory.
    Restores batch stock balance and records stock_ledger 'material_return'.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")

    loc_id = order.source_warehouse_id or 1

    for ret in returns:
        qty_returned = _to_dec(ret.qty)
        if qty_returned <= ZERO:
            continue

        item = await db.get(mfg_order_item, ret.order_item_id)
        if not item or item.mfg_order_id != order.id:
            raise ValueError(f"Order item {ret.order_item_id} invalid.")

        batch_obj = await db.get(product_batch, ret.batch_id)
        if not batch_obj:
            raise ValueError(f"Batch {ret.batch_id} not found.")

        # 1. Restore batch stock in warehouse
        await batch_service.record_batch_movement(
            db=db,
            batch_id=batch_obj.id,
            location_id=loc_id,
            qty_delta=qty_returned,
            movement_type="transfer_in",
            product_id=item.product_id,
        )

        # 2. Restore master product stock
        await _update_product_stock(db, item.product_id, qty_returned)

        # 3. Post to stock_ledger
        await _write_stock_ledger(
            db=db,
            product_id=item.product_id,
            txn_type="material_return",
            qty=qty_returned,
            ref_id=order.id,
            ref_type="mfg_order",
            outlet_id=loc_id,
            notes=f"Unused return from {order.order_no}: {ret.reason or ''}",
            user_id=user_id,
            batch_no=batch_obj.batch_no,
            batch_id=batch_obj.id,
            expiry_date=batch_obj.exp_date,
        )

        item.returned_qty += qty_returned

        ob_row = (await db.execute(
            select(mfg_order_batch).where(
                mfg_order_batch.mfg_order_id == order.id,
                mfg_order_batch.mfg_order_item_id == item.id,
                mfg_order_batch.batch_id == batch_obj.id,
            )
        )).scalar_one_or_none()

        if ob_row:
            ob_row.returned_qty += qty_returned

    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(order)
    return order


# ─── PRODUCTION OUTPUT & FINISHED GOODS QC RELEASE ───────────────────────────
async def record_production_output(
    db: AsyncSession,
    order_id: int,
    data: Any,
    user_id: int,
) -> mfg_order_output:
    """
    Records production output (good quantity, rejects, scrap).
    Generates finished product batch in central register (product_batches).
    If QC is required, puts batch on QC hold.
    If QC is not required, immediately posts to Finished Goods warehouse and stock ledger.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")

    settings = (await db.execute(select(CompanySetting).order_by(CompanySetting.id))).scalars().first()
    require_qc = settings.require_qc_release if settings else True

    good_qty = _to_dec(data.good_qty)
    rej_qty = _to_dec(data.rejected_qty)
    scr_qty = _to_dec(data.scrap_qty)

    prod = await db.get(product_model, order.product_id)

    # 1. Generate or associate production batch
    batch_prefix = settings.batch_number_prefix if settings else "BAT-"
    batch_no_str = data.batch_no or await get_next_batch_no(db, order.product_id, batch_prefix)

    exp_date_val = data.exp_date
    if not exp_date_val and data.mfg_date and prod.shelf_life_days and prod.shelf_life_days > 0:
        exp_date_val = data.mfg_date + timedelta(days=prod.shelf_life_days)

    initial_qc = "Pending_QC" if require_qc else "Active"

    batch_rec = await batch_service.get_or_create_batch(
        db=db,
        product_id=order.product_id,
        batch_no=batch_no_str,
        mfg_date=data.mfg_date,
        exp_date=exp_date_val,
        cost_price=order.estimated_cost / order.planned_qty if order.planned_qty > 0 else Decimal("0.00"),
        mrp=_to_dec(prod.mrp),
        selling_price=_to_dec(prod.selling_price),
        user_id=user_id,
        notes=f"Produced in {order.order_no}",
    )
    batch_rec.batch_type = "FINISHED_PRODUCT"
    batch_rec.mfg_order_id = order.id
    batch_rec.bom_id = order.bom_id
    batch_rec.qc_status = initial_qc
    if not require_qc:
        batch_rec.qc_release_date = date.today()
        batch_rec.qc_released_by = user_id

    # 2. Create output record
    output_no_str = await get_next_output_no(db)
    output_rec = mfg_order_output(
        mfg_order_id=order.id,
        output_no=output_no_str,
        product_id=order.product_id,
        batch_id=batch_rec.id,
        batch_no=batch_no_str,
        good_qty=good_qty,
        rejected_qty=rej_qty,
        scrap_qty=scr_qty,
        unit=data.unit or order.unit,
        mfg_date=data.mfg_date,
        exp_date=exp_date_val,
        qc_status=initial_qc,
        qc_notes=data.notes,
        created_by=user_id,
    )
    db.add(output_rec)

    # 3. Update order totals
    order.completed_qty += good_qty
    order.rejected_qty += rej_qty
    order.scrap_qty += scr_qty
    order.production_batch_no = batch_no_str
    order.production_batch_id = batch_rec.id

    fg_loc = order.target_warehouse_id or (settings.finished_goods_warehouse_id if settings else 1) or 1

    # If QC is NOT required, post directly to finished goods inventory
    if not require_qc:
        await batch_service.record_batch_movement(
            db=db,
            batch_id=batch_rec.id,
            location_id=fg_loc,
            qty_delta=good_qty,
            movement_type="purchase",
            product_id=order.product_id,
        )
        await _update_product_stock(db, order.product_id, good_qty)
        await _write_stock_ledger(
            db=db,
            product_id=order.product_id,
            txn_type="production_output",
            qty=good_qty,
            ref_id=order.id,
            ref_type="mfg_order",
            outlet_id=fg_loc,
            notes=f"Finished goods receipt from {order.order_no} (Batch {batch_no_str})",
            user_id=user_id,
            batch_no=batch_no_str,
            batch_id=batch_rec.id,
            expiry_date=exp_date_val,
        )
        order.status = "COMPLETED"
        order.actual_end_date = datetime.now()
    else:
        order.status = "QC_PENDING"
        order.qc_status = "PENDING"

    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(output_rec)
    return output_rec


async def release_qc_production_output(
    db: AsyncSession,
    order_id: int,
    output_id: int,
    data: Any,
    user_id: int,
) -> mfg_order_output:
    """
    Quality Control Release Gate:
    - Verifies inspection result (RELEASE, REJECT, QUARANTINE)
    - If RELEASED: adds accepted good quantity to finished goods warehouse & posts production_output to stock_ledger.
    - If REJECTED: moves rejected stock to quarantine/reject store.
    - Updates MO status to COMPLETED.
    """
    order = await db.get(mfg_order, order_id)
    if not order:
        raise ValueError("Manufacturing Order not found")

    output_rec = await db.get(mfg_order_output, output_id)
    if not output_rec or output_rec.mfg_order_id != order.id:
        raise ValueError("Production output record not found")

    decision = data.decision.upper()
    accepted = _to_dec(data.accepted_qty) if data.accepted_qty is not None else output_rec.good_qty
    rejected = _to_dec(data.rejected_qty) if data.rejected_qty is not None else output_rec.rejected_qty

    settings = (await db.execute(select(CompanySetting).order_by(CompanySetting.id))).scalars().first()
    fg_loc = order.target_warehouse_id or (settings.finished_goods_warehouse_id if settings else 1) or 1
    quarantine_loc = (settings.quarantine_store_id if settings else 1) or 1

    batch_obj = await db.get(product_batch, output_rec.batch_id) if output_rec.batch_id else None

    if decision == "RELEASE":
        output_rec.qc_status = "RELEASED"
        output_rec.good_qty = accepted
        output_rec.rejected_qty = rejected
        output_rec.qc_released_at = datetime.now()
        output_rec.qc_released_by = user_id
        output_rec.qc_notes = data.remarks

        if batch_obj:
            batch_obj.qc_status = "Active"
            batch_obj.status = "Active"
            batch_obj.qc_release_date = date.today()
            batch_obj.qc_released_by = user_id
            batch_obj.qc_notes = data.remarks

            # Post released inventory into Finished Goods warehouse
            await batch_service.record_batch_movement(
                db=db,
                batch_id=batch_obj.id,
                location_id=fg_loc,
                qty_delta=accepted,
                movement_type="purchase",
                product_id=order.product_id,
            )

        # Update product master inventory
        await _update_product_stock(db, order.product_id, accepted)

        # Single source of truth: stock ledger
        await _write_stock_ledger(
            db=db,
            product_id=order.product_id,
            txn_type="production_output",
            qty=accepted,
            ref_id=order.id,
            ref_type="mfg_order",
            outlet_id=fg_loc,
            notes=f"QC Release: {accepted} units into FG store. Insp #{data.inspection_no or ''}",
            user_id=user_id,
            batch_no=output_rec.batch_no,
            batch_id=output_rec.batch_id,
            expiry_date=output_rec.exp_date,
        )

        order.status = "COMPLETED"
        order.qc_status = "RELEASED"
        order.qc_inspection_no = data.inspection_no
        order.qc_remarks = data.remarks
        order.qc_released_by = user_id
        order.qc_released_at = datetime.now()
        order.actual_end_date = datetime.now()

    elif decision == "REJECT":
        output_rec.qc_status = "REJECTED"
        output_rec.qc_released_at = datetime.now()
        output_rec.qc_released_by = user_id
        output_rec.qc_notes = data.remarks

        if batch_obj:
            batch_obj.qc_status = "Rejected"
            batch_obj.status = "Quarantined"
            batch_obj.qc_notes = f"QC REJECTED: {data.remarks}"

        # Write rejected scrap ledger
        await _write_stock_ledger(
            db=db,
            product_id=order.product_id,
            txn_type="wastage_scrap",
            qty=ZERO,
            ref_id=order.id,
            ref_type="mfg_order",
            outlet_id=quarantine_loc,
            notes=f"QC Rejected: {output_rec.good_qty} units failed QC. Reason: {data.remarks}",
            user_id=user_id,
            batch_no=output_rec.batch_no,
            batch_id=output_rec.batch_id,
        )
        order.status = "COMPLETED"
        order.qc_status = "REJECTED"
        order.qc_inspection_no = data.inspection_no
        order.qc_remarks = data.remarks

    order.updated_at = datetime.now()
    await db.commit()
    await db.refresh(output_rec)
    return output_rec


# ─── BATCH TRACEABILITY ENGINE ────────────────────────────────────────────────
async def get_backward_traceability(db: AsyncSession, batch_identifier: str) -> Dict[str, Any]:
    """
    Backward Traceability (Genealogy):
    Given a finished product batch number or ID, finds:
    - Manufacturing Order & BOM version
    - Exact Raw Material and Packaging lots consumed
    - Their Suppliers, Purchase Orders, GRN numbers, receipt dates, and CoA attachments.
    """
    # 1. Find finished batch
    clean_id = batch_identifier.strip().upper()
    b_stmt = select(product_batch).where(
        or_(
            product_batch.batch_no == clean_id,
            product_batch.id == (int(clean_id) if clean_id.isdigit() else -1)
        )
    )
    b_res = await db.execute(b_stmt)
    f_batch = b_res.scalars().first()
    if not f_batch:
        raise ValueError(f"Batch '{batch_identifier}' not found in registry")

    # 2. Find output and manufacturing order
    out_q = select(mfg_order_output).where(mfg_order_output.batch_id == f_batch.id)
    out_rec = (await db.execute(out_q)).scalars().first()

    order = None
    if out_rec:
        order = await db.get(mfg_order, out_rec.mfg_order_id)
    elif f_batch.mfg_order_id:
        order = await db.get(mfg_order, f_batch.mfg_order_id)

    if not order:
        raise ValueError(f"Batch '{f_batch.batch_no}' was not produced from a Manufacturing Order.")

    bom = await db.get(mfg_bom, order.bom_id)
    f_prod = await db.get(product_model, order.product_id)
    sup_user = await db.get(user, order.supervisor_id) if order.supervisor_id else None

    # 3. Find consumed source batches from mfg_order_batches
    raw_sources = []
    pack_sources = []

    ob_stmt = select(mfg_order_batch).where(mfg_order_batch.mfg_order_id == order.id)
    ob_rows = (await db.execute(ob_stmt)).scalars().all()

    for ob in ob_rows:
        src_batch = await db.get(product_batch, ob.batch_id)
        src_prod = await db.get(product_model, ob.product_id)
        supp = await db.get(supplier, src_batch.supplier_id) if src_batch and src_batch.supplier_id else None

        # Trace to GRN receipt item
        grn_item_q = select(purchase_item, purchase).join(purchase, purchase_item.purchase_id == purchase.id).where(
            purchase_item.batch_id == ob.batch_id
        ).order_by(purchase.id.desc())
        grn_res = (await db.execute(grn_item_q)).first()

        grn_no = None
        grn_date = None
        po_no = None
        coa_file = None
        qc_st = src_batch.qc_status if src_batch else "Active"

        if grn_res:
            p_item, p_hdr = grn_res
            grn_no = p_hdr.purchase_no
            grn_date = p_hdr.invoice_date
            coa_file = p_item.coa_attachment
            if p_hdr.po_id:
                po_row = await db.get(po_header, p_hdr.po_id)
                po_no = po_row.po_no if po_row else None

        order_item = await db.get(mfg_order_item, ob.mfg_order_item_id)
        mat_type = order_item.material_type if order_item else "RAW_MATERIAL"

        src_info = {
            "batch_id": ob.batch_id,
            "batch_no": ob.batch_no,
            "product_id": ob.product_id,
            "product_name": src_prod.name if src_prod else f"Item #{ob.product_id}",
            "material_type": mat_type,
            "qty_used": ob.consumed_qty if ob.consumed_qty > ZERO else ob.issued_qty,
            "unit": src_prod.unit if src_prod else "KG",
            "supplier_id": supp.id if supp else None,
            "supplier_name": supp.name if supp else None,
            "supplier_batch_no": src_batch.supplier_batch_no if src_batch else None,
            "grn_no": grn_no,
            "grn_date": grn_date,
            "po_no": po_no,
            "coa_attachment": coa_file,
            "qc_status": qc_st,
        }

        if mat_type == "PACKAGING":
            pack_sources.append(src_info)
        else:
            raw_sources.append(src_info)

    return {
        "finished_batch_id": f_batch.id,
        "finished_batch_no": f_batch.batch_no,
        "product_id": order.product_id,
        "product_name": f_prod.name if f_prod else "",
        "mfg_order_id": order.id,
        "order_no": order.order_no,
        "bom_id": order.bom_id,
        "bom_no": bom.bom_no if bom else "",
        "bom_version": bom.version_label if bom else "v1.0",
        "output_qty": out_rec.good_qty if out_rec else order.completed_qty,
        "unit": order.unit,
        "mfg_date": out_rec.mfg_date if out_rec else order.planned_start_date,
        "exp_date": f_batch.exp_date,
        "qc_status": f_batch.qc_status,
        "qc_inspection_no": order.qc_inspection_no,
        "supervisor_name": sup_user.name if sup_user else None,
        "raw_materials_used": raw_sources,
        "packaging_materials_used": pack_sources,
    }


async def get_forward_traceability(db: AsyncSession, batch_identifier: str) -> Dict[str, Any]:
    """
    Forward Traceability:
    Given a raw-material or packaging batch, identifies:
    - All Manufacturing Orders that consumed this batch
    - All Finished Good Batches produced from it
    - All Outlets/Warehouses transferred to
    - All Invoices/Customers sold to (Recall management).
    """
    clean_id = batch_identifier.strip().upper()
    b_stmt = select(product_batch).where(
        or_(
            product_batch.batch_no == clean_id,
            product_batch.id == (int(clean_id) if clean_id.isdigit() else -1)
        )
    )
    b_res = await db.execute(b_stmt)
    src_batch = b_res.scalars().first()
    if not src_batch:
        raise ValueError(f"Batch '{batch_identifier}' not found in registry")

    src_prod = await db.get(product_model, src_batch.product_id)
    supp = await db.get(supplier, src_batch.supplier_id) if src_batch.supplier_id else None

    # Find GRN
    grn_q = select(purchase_item, purchase).join(purchase, purchase_item.purchase_id == purchase.id).where(
        purchase_item.batch_id == src_batch.id
    )
    grn_res = (await db.execute(grn_q)).first()
    grn_no = grn_res[1].purchase_no if grn_res else None
    receipt_date = grn_res[1].invoice_date if grn_res else src_batch.first_receipt_date
    rec_qty = grn_res[0].qty if grn_res else ZERO

    # Current stock
    stk_res = await db.execute(
        select(func.coalesce(func.sum(product_batch_stock.current_qty), 0)).where(
            product_batch_stock.batch_id == src_batch.id
        )
    )
    cur_stock = stk_res.scalar() or ZERO

    # Find affected Manufacturing Orders
    mob_q = select(mfg_order_batch).where(mfg_order_batch.batch_id == src_batch.id)
    mob_rows = (await db.execute(mob_q)).scalars().all()

    affected_orders = []
    seen_orders = set()

    for mob in mob_rows:
        if mob.mfg_order_id in seen_orders:
            continue
        seen_orders.add(mob.mfg_order_id)

        m_order = await db.get(mfg_order, mob.mfg_order_id)
        if not m_order:
            continue

        f_prod = await db.get(product_model, m_order.product_id)

        # Finished batches for this order
        outputs = (await db.execute(
            select(mfg_order_output).where(mfg_order_output.mfg_order_id == m_order.id)
        )).scalars().all()

        for out in outputs:
            # Check transfers of this finished batch
            trf_items = (await db.execute(
                select(unit_wise_stock_transfer_item, unit_wise_stock_transfer)
                .join(unit_wise_stock_transfer, unit_wise_stock_transfer_item.transfer_id == unit_wise_stock_transfer.id)
                .where(unit_wise_stock_transfer_item.batch_id == out.batch_id)
            )).all()

            outlets_transferred = []
            for t_item, t_hdr in trf_items:
                to_o = await db.get(outlet, t_hdr.to_outlet_id)
                outlets_transferred.append({
                    "transfer_no": t_hdr.transfer_no,
                    "date": str(t_hdr.transfer_date),
                    "outlet_name": to_o.outlet_name if to_o else f"Outlet #{t_hdr.to_outlet_id}",
                    "qty": float(t_item.qty),
                })

            # Check customer sales of this finished batch
            inv_items = (await db.execute(
                select(invoice_item, invoice)
                .join(invoice, invoice_item.invoice_id == invoice.id)
                .where(invoice_item.batch_id == out.batch_id)
            )).all()

            invoices_sold = []
            for i_item, i_hdr in inv_items:
                invoices_sold.append({
                    "invoice_no": i_hdr.invoice_no,
                    "date": str(i_hdr.invoice_date),
                    "customer_name": getattr(i_hdr, "customer_name", "Retail Customer"),
                    "qty": float(i_item.qty),
                })

            affected_orders.append({
                "mfg_order_id": m_order.id,
                "order_no": m_order.order_no,
                "finished_product_id": m_order.product_id,
                "finished_product_name": f_prod.name if f_prod else "",
                "finished_batch_id": out.batch_id or 0,
                "finished_batch_no": out.batch_no,
                "qty_produced": out.good_qty,
                "unit": out.unit,
                "mfg_date": out.mfg_date,
                "exp_date": out.exp_date,
                "qc_status": out.qc_status,
                "outlets_transferred_to": outlets_transferred,
                "invoices_sold_to": invoices_sold,
            })

    return {
        "source_batch_id": src_batch.id,
        "source_batch_no": src_batch.batch_no,
        "product_id": src_batch.product_id,
        "product_name": src_prod.name if src_prod else "",
        "material_type": src_batch.batch_type,
        "supplier_name": supp.name if supp else None,
        "grn_no": grn_no,
        "receipt_date": receipt_date,
        "total_received_qty": rec_qty,
        "current_batch_stock": cur_stock,
        "affected_orders": affected_orders,
    }


# ─── DASHBOARD & METRICS ─────────────────────────────────────────────────────
async def get_manufacturing_dashboard(db: AsyncSession) -> Dict[str, Any]:
    # Counts
    total_orders = (await db.execute(select(func.count(mfg_order.id)))).scalar() or 0
    in_prod = (await db.execute(select(func.count(mfg_order.id)).where(mfg_order.status == "IN_PRODUCTION"))).scalar() or 0
    completed = (await db.execute(select(func.count(mfg_order.id)).where(mfg_order.status == "COMPLETED"))).scalar() or 0
    qc_pending = (await db.execute(select(func.count(mfg_order.id)).where(mfg_order.status == "QC_PENDING"))).scalar() or 0
    active_boms = (await db.execute(select(func.count(mfg_bom.id)).where(mfg_bom.status == "APPROVED"))).scalar() or 0

    # Recent orders
    recent_q = select(mfg_order).order_by(mfg_order.id.desc()).limit(8)
    recent_rows = (await db.execute(recent_q)).scalars().all()
    recent_orders = []
    for ro in recent_rows:
        p = await db.get(product_model, ro.product_id)
        b = await db.get(mfg_bom, ro.bom_id)
        recent_orders.append({
            "id": ro.id,
            "order_no": ro.order_no,
            "product_id": ro.product_id,
            "product_name": p.name if p else "",
            "item_code": p.item_code if p else None,
            "bom_no": b.bom_no if b else None,
            "planned_qty": ro.planned_qty,
            "completed_qty": ro.completed_qty,
            "unit": ro.unit,
            "department": ro.department,
            "planned_start_date": ro.planned_start_date,
            "planned_end_date": ro.planned_end_date,
            "status": ro.status,
            "qc_status": ro.qc_status,
            "production_batch_no": ro.production_batch_no,
            "created_at": ro.created_at,
        })

    # Raw material low stock alerts
    low_rm_q = select(product_model).where(
        or_(product_model.is_raw_material == True, product_model.category == "Raw Material"),
        product_model.stock_qty <= product_model.min_stock,
        product_model.is_active == True,
    ).limit(10)
    low_rms = (await db.execute(low_rm_q)).scalars().all()
    low_stock_list = [{
        "id": rm.id,
        "name": rm.name,
        "item_code": rm.item_code,
        "stock_qty": float(rm.stock_qty or 0),
        "min_stock": float(rm.min_stock or 0),
        "unit": rm.unit,
    } for rm in low_rms]

    return {
        "total_orders_count": total_orders,
        "active_in_production_count": in_prod,
        "completed_orders_count": completed,
        "pending_qc_count": qc_pending,
        "active_boms_count": active_boms,
        "total_material_shortages_count": len(low_stock_list),
        "recent_orders": recent_orders,
        "low_stock_raw_materials": low_stock_list,
    }


async def update_bom(db: AsyncSession, bom_id: int, data: Any) -> mfg_bom:
    """Edit a BOM that is still a draft (or was rejected); approved ones are changed by making a revision."""
    bom_obj = await db.get(mfg_bom, bom_id)
    if not bom_obj:
        raise ValueError("BOM not found")
    if bom_obj.status not in ("DRAFT", "REJECTED"):
        raise ValueError(f"A {bom_obj.status.lower()} BOM cannot be edited. Click Revise to make a new version.")
    items, material = await _build_items(db, data)
    bom_obj.bom_name = data.bom_name
    bom_obj.batch_size = _to_dec(data.batch_size)
    bom_obj.batch_unit = data.batch_unit or bom_obj.batch_unit
    bom_obj.expected_yield_pct = _to_dec(data.expected_yield_pct or 100.00)
    bom_obj.tolerance_pct = _to_dec(data.tolerance_pct or 2.00)
    bom_obj.expected_wastage_pct = _to_dec(data.expected_wastage_pct or 0.00)
    bom_obj.labor_cost = _to_dec(data.labor_cost)
    bom_obj.overhead_cost = _to_dec(data.overhead_cost)
    bom_obj.total_cost = material + bom_obj.labor_cost + bom_obj.overhead_cost
    bom_obj.notes = data.notes
    if bom_obj.status == "REJECTED":
        bom_obj.status = "DRAFT"
    bom_obj.items = items
    await db.commit()
    await db.refresh(bom_obj)
    return bom_obj
