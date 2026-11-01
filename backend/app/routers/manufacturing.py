"""
FastAPI Router for Nutribray Manufacturing Module.
Prefix: /manufacturing
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Any, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, text

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role, current_user_dep
from app.models.company import CompanySetting
from app.models.product import product as product_model
from app.models.purchase import po_header, po_item
from app.models.manufacturing import (
    mfg_bom,
    mfg_bom_item,
    mfg_order,
    mfg_order_item,
    mfg_order_batch,
    mfg_order_output,
)
from app.schemas.manufacturing import (
    BomCreate,
    BomUpdate,
    BomOut,
    BomListOut,
    BomApprovalIn,
    MfgOrderCreate,
    MfgOrderUpdate,
    MfgOrderOut,
    MfgOrderListOut,
    ProductionPlanningOut,
    MaterialReserveIn,
    MaterialIssueIn,
    MaterialConsumeIn,
    MaterialReturnIn,
    ProductionOutputCreate,
    ProductionOutputOut,
    QcReleaseIn,
    BackwardTraceabilityOut,
    ForwardTraceabilityOut,
    ManufacturingDashboardOut,
)
from app.services import manufacturing_service
from app.services.auth_service import write_audit

router = APIRouter(prefix="/manufacturing", tags=["manufacturing"])
admin_or_supervisor = require_role("superadmin", "admin", "supervisor", "manager")


# ─── DASHBOARD ───────────────────────────────────────────────────────────────
@router.get("/dashboard", response_model=ManufacturingDashboardOut)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Manufacturing Dashboard summary metrics, status breakdowns and alerts."""
    return await manufacturing_service.get_manufacturing_dashboard(db)


@router.get("/fg-by-customer")
async def fg_by_customer(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Finished goods with the customer they are made for (item's own Customer field, else its packaging-spec customers) - for the BOM item picker."""
    rows = (await db.execute(text("""SELECT p.id, p.name, p.item_code, p.unit, COALESCE(NULLIF(p.manufacturer_name, ''), sc.c) AS customer
        FROM products p LEFT JOIN (SELECT s.product_id, string_agg(DISTINCT c.name, ', ') AS c FROM mfg_pack_specs s JOIN mfg_brands b ON b.id = s.brand_id
          JOIN customers c ON c.id = b.customer_id GROUP BY s.product_id) sc ON sc.product_id = p.id
        WHERE p.item_type = 'FG' AND p.is_active ORDER BY p.name"""))).mappings().all()
    return [dict(r) for r in rows]


# ─── BILL OF MATERIALS (BOM) ─────────────────────────────────────────────────
@router.get("/boms", response_model=List[BomListOut])
async def list_boms(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List all Bills of Materials with filtering and product information."""
    stmt = (
        select(mfg_bom, product_model.name.label("p_name"), product_model.item_code.label("p_code"), func.count(mfg_bom_item.id).label("i_cnt"), product_model.manufacturer_name.label("p_cust"))
        .join(product_model, mfg_bom.product_id == product_model.id)
        .outerjoin(mfg_bom_item, mfg_bom.id == mfg_bom_item.bom_id)
        .group_by(mfg_bom.id, product_model.name, product_model.item_code, product_model.manufacturer_name)
        .order_by(desc(mfg_bom.id))
    )
    if status:
        stmt = stmt.where(mfg_bom.status == status.upper())
    if product_id:
        stmt = stmt.where(mfg_bom.product_id == product_id)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(mfg_bom.bom_no.ilike(term), mfg_bom.bom_name.ilike(term), product_model.name.ilike(term)))

    rows = (await db.execute(stmt)).all()
    out = []
    # customers an item is made for: the item's own "Customer" field, else the customers of its approved packaging specs
    spec_cust = {r[0]: r[1] for r in (await db.execute(text("""SELECT s.product_id, string_agg(DISTINCT c.name, ', ') FROM mfg_pack_specs s
        JOIN mfg_brands b ON b.id = s.brand_id JOIN customers c ON c.id = b.customer_id GROUP BY s.product_id"""))).all()}
    for bom_rec, p_name, p_code, i_cnt, p_cust in rows:
        out.append({
            "customer_name": p_cust or spec_cust.get(bom_rec.product_id),
            "id": bom_rec.id,
            "bom_no": bom_rec.bom_no,
            "bom_name": bom_rec.bom_name,
            "product_id": bom_rec.product_id,
            "product_name": p_name,
            "item_code": p_code,
            "revision": bom_rec.revision,
            "version_label": bom_rec.version_label,
            "product_type": bom_rec.product_type,
            "batch_size": bom_rec.batch_size,
            "batch_unit": bom_rec.batch_unit,
            "expected_yield_pct": bom_rec.expected_yield_pct,
            "status": bom_rec.status,
            "total_cost": bom_rec.total_cost,
            "items_count": i_cnt or 0,
            "valid_from": bom_rec.valid_from,
            "valid_to": bom_rec.valid_to,
            "created_at": bom_rec.created_at,
        })
    return out


@router.post("/boms", response_model=BomOut)
async def create_bom(
    body: BomCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Create a new Bill of Materials in DRAFT status."""
    try:
        bom_obj = await manufacturing_service.create_bom(db=db, data=body, user_id=user.user_id)
        await write_audit(
            db=db,
            module="manufacturing",
            action="create_bom",
            record_id=bom_obj.id,
            record_no=bom_obj.bom_no,
            description=f"Created BOM {bom_obj.bom_no} for product #{bom_obj.product_id}",
            user_id=user.user_id,
            user_name=user.username,
        )
        return await get_bom(bom_id=bom_obj.id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/boms/{bom_id}", response_model=BomOut)
async def update_bom(bom_id: int, body: BomCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Edit a draft Bill of Materials (formula, batch size, costs and all its lines)."""
    try:
        bom_obj = await manufacturing_service.update_bom(db=db, bom_id=bom_id, data=body)
        await write_audit(db=db, module="manufacturing", action="update_bom", record_id=bom_obj.id, record_no=bom_obj.bom_no,
                          description=f"Edited BOM {bom_obj.bom_no}", user_id=user.user_id, user_name=user.username)
        return await get_bom(bom_id=bom_obj.id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/boms/{bom_id}", response_model=BomOut)
async def get_bom(
    bom_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get full details of a Bill of Materials including items and costs."""
    bom = await db.get(mfg_bom, bom_id)
    if not bom:
        raise HTTPException(404, "BOM not found")

    prod = await db.get(product_model, bom.product_id)
    items_out = []
    for it in bom.items:
        it_prod = await db.get(product_model, it.product_id)
        items_out.append({
            "id": it.id,
            "bom_id": it.bom_id,
            "product_id": it.product_id,
            "material_type": it.material_type,
            "quantity": it.quantity,
            "unit": it.unit,
            "wastage_pct": it.wastage_pct,
            "cost_per_unit": it.cost_per_unit,
            "total_cost": it.total_cost,
            "is_critical": it.is_critical,
            "sub_bom_id": it.sub_bom_id,
            "stage": it.stage,
            "sequence": it.sequence,
            "notes": it.notes,
            "product_name": it_prod.name if it_prod else "",
            "item_code": it_prod.item_code if it_prod else None,
            "barcode": it_prod.barcode if it_prod else None,
            "available_stock": it_prod.stock_qty if it_prod else Decimal("0.000"),
        })

    return {
        "id": bom.id,
        "bom_no": bom.bom_no,
        "bom_name": bom.bom_name,
        "product_id": bom.product_id,
        "product_name": prod.name if prod else "",
        "item_code": prod.item_code if prod else None,
        "revision": bom.revision,
        "version_label": bom.version_label,
        "product_type": bom.product_type,
        "batch_size": bom.batch_size,
        "batch_unit": bom.batch_unit,
        "expected_yield_pct": bom.expected_yield_pct,
        "tolerance_pct": bom.tolerance_pct,
        "expected_wastage_pct": bom.expected_wastage_pct,
        "valid_from": bom.valid_from,
        "valid_to": bom.valid_to,
        "status": bom.status,
        "approved_by": bom.approved_by,
        "approved_at": bom.approved_at,
        "approval_remarks": bom.approval_remarks,
        "labor_cost": bom.labor_cost,
        "overhead_cost": bom.overhead_cost,
        "total_cost": bom.total_cost,
        "notes": bom.notes,
        "created_by": bom.created_by,
        "created_at": bom.created_at,
        "updated_at": bom.updated_at,
        "items": items_out,
    }


@router.post("/boms/{bom_id}/approve", response_model=BomOut)
async def approve_bom_endpoint(
    bom_id: int,
    body: Optional[BomApprovalIn] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(admin_or_supervisor),
):
    """Approve or Reject a Bill of Materials."""
    body = body or BomApprovalIn()
    try:
        if body.action.upper() == "APPROVE":
            bom_obj = await manufacturing_service.approve_bom(db=db, bom_id=bom_id, user_id=user.user_id, remarks=body.remarks)
        else:
            bom_obj = await manufacturing_service.reject_bom(db=db, bom_id=bom_id, user_id=user.user_id, remarks=body.remarks)

        await write_audit(
            db=db,
            module="manufacturing",
            action=f"{body.action.lower()}_bom",
            record_id=bom_obj.id,
            record_no=bom_obj.bom_no,
            description=f"BOM {bom_obj.bom_no} {body.action.lower()}d: {body.remarks or ''}",
            user_id=user.user_id,
            user_name=user.username,
        )
        return await get_bom(bom_id=bom_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/boms/{bom_id}/clone-revision", response_model=BomOut)
async def clone_bom_endpoint(
    bom_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Create a new version/revision from an existing BOM."""
    try:
        new_bom = await manufacturing_service.clone_bom_revision(db=db, bom_id=bom_id, user_id=user.user_id)
        return await get_bom(bom_id=new_bom.id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── MANUFACTURING ORDERS ────────────────────────────────────────────────────
@router.get("/orders", response_model=List[MfgOrderListOut])
async def list_orders(
    status: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """List manufacturing orders with status, finished good SKU, and planned quantity."""
    stmt = (
        select(mfg_order, product_model.name.label("p_name"), product_model.item_code.label("p_code"), mfg_bom.bom_no)
        .join(product_model, mfg_order.product_id == product_model.id)
        .join(mfg_bom, mfg_order.bom_id == mfg_bom.id)
        .order_by(desc(mfg_order.id))
    )
    if status:
        stmt = stmt.where(mfg_order.status == status.upper())
    if product_id:
        stmt = stmt.where(mfg_order.product_id == product_id)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(mfg_order.order_no.ilike(term), product_model.name.ilike(term), mfg_order.production_batch_no.ilike(term)))

    rows = (await db.execute(stmt)).all()
    out = []
    for mo, p_name, p_code, b_no in rows:
        out.append({
            "id": mo.id,
            "order_no": mo.order_no,
            "product_id": mo.product_id,
            "product_name": p_name,
            "item_code": p_code,
            "bom_no": b_no,
            "planned_qty": mo.planned_qty,
            "completed_qty": mo.completed_qty,
            "unit": mo.unit,
            "department": mo.department,
            "planned_start_date": mo.planned_start_date,
            "planned_end_date": mo.planned_end_date,
            "status": mo.status,
            "qc_status": mo.qc_status,
            "production_batch_no": mo.production_batch_no,
            "created_at": mo.created_at,
        })
    return out


@router.post("/orders", response_model=MfgOrderOut)
async def create_order(
    body: MfgOrderCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Create a new Manufacturing Order from an approved BOM."""
    try:
        mo_obj = await manufacturing_service.create_mfg_order(db=db, data=body, user_id=user.user_id)
        await write_audit(
            db=db,
            module="manufacturing",
            action="create_order",
            record_id=mo_obj.id,
            record_no=mo_obj.order_no,
            description=f"Created Manufacturing Order {mo_obj.order_no} for {mo_obj.planned_qty} {mo_obj.unit}",
            user_id=user.user_id,
            user_name=user.username,
        )
        return await get_order(order_id=mo_obj.id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/{order_id}", response_model=MfgOrderOut)
async def get_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Get full details of a Manufacturing Order with items, batch allocations, and outputs."""
    order = await db.get(mfg_order, order_id)
    if not order:
        raise HTTPException(404, "Manufacturing Order not found")

    prod = await db.get(product_model, order.product_id)
    bom = await db.get(mfg_bom, order.bom_id)

    items_out = []
    for it in order.items:
        p = await db.get(product_model, it.product_id)
        cur_stk = p.stock_qty if p else Decimal("0.000")
        shortage = max(Decimal("0.000"), it.required_qty - cur_stk)
        items_out.append({
            "id": it.id,
            "mfg_order_id": it.mfg_order_id,
            "product_id": it.product_id,
            "product_name": p.name if p else "",
            "item_code": p.item_code if p else None,
            "barcode": p.barcode if p else None,
            "material_type": it.material_type,
            "required_qty": it.required_qty,
            "reserved_qty": it.reserved_qty,
            "issued_qty": it.issued_qty,
            "consumed_qty": it.consumed_qty,
            "returned_qty": it.returned_qty,
            "unit": it.unit,
            "cost_per_unit": it.cost_per_unit,
            "total_cost": it.total_cost,
            "status": it.status,
            "current_stock": cur_stk,
            "shortage_qty": shortage,
        })

    batches_out = []
    for ob in order.batches:
        p = await db.get(product_model, ob.product_id)
        batches_out.append({
            "id": ob.id,
            "mfg_order_id": ob.mfg_order_id,
            "mfg_order_item_id": ob.mfg_order_item_id,
            "product_id": ob.product_id,
            "product_name": p.name if p else "",
            "item_code": p.item_code if p else None,
            "batch_id": ob.batch_id,
            "batch_no": ob.batch_no,
            "expiry_date": ob.expiry_date,
            "reserved_qty": ob.reserved_qty,
            "issued_qty": ob.issued_qty,
            "consumed_qty": ob.consumed_qty,
            "returned_qty": ob.returned_qty,
            "status": ob.status,
        })

    outputs_out = []
    for out in order.outputs:
        p = await db.get(product_model, out.product_id)
        outputs_out.append({
            "id": out.id,
            "mfg_order_id": out.mfg_order_id,
            "output_no": out.output_no,
            "product_id": out.product_id,
            "product_name": p.name if p else "",
            "batch_id": out.batch_id,
            "batch_no": out.batch_no,
            "good_qty": out.good_qty,
            "rejected_qty": out.rejected_qty,
            "scrap_qty": out.scrap_qty,
            "unit": out.unit,
            "mfg_date": out.mfg_date,
            "exp_date": out.exp_date,
            "qc_status": out.qc_status,
            "qc_released_at": out.qc_released_at,
            "qc_released_by": out.qc_released_by,
            "qc_notes": out.qc_notes,
            "created_at": out.created_at,
        })

    return {
        "id": order.id,
        "order_no": order.order_no,
        "product_id": order.product_id,
        "product_name": prod.name if prod else "",
        "item_code": prod.item_code if prod else None,
        "bom_id": order.bom_id,
        "bom_no": bom.bom_no if bom else None,
        "bom_name": bom.bom_name if bom else None,
        "planned_qty": order.planned_qty,
        "completed_qty": order.completed_qty,
        "rejected_qty": order.rejected_qty,
        "scrap_qty": order.scrap_qty,
        "unit": order.unit,
        "plant_id": order.plant_id,
        "department": order.department,
        "source_warehouse_id": order.source_warehouse_id,
        "target_warehouse_id": order.target_warehouse_id,
        "production_batch_no": order.production_batch_no,
        "production_batch_id": order.production_batch_id,
        "planned_start_date": order.planned_start_date,
        "planned_end_date": order.planned_end_date,
        "actual_start_date": order.actual_start_date,
        "actual_end_date": order.actual_end_date,
        "status": order.status,
        "qc_status": order.qc_status,
        "qc_inspection_no": order.qc_inspection_no,
        "qc_remarks": order.qc_remarks,
        "qc_released_by": order.qc_released_by,
        "qc_released_at": order.qc_released_at,
        "estimated_cost": order.estimated_cost,
        "actual_cost": order.actual_cost,
        "supervisor_id": order.supervisor_id,
        "approved_by": order.approved_by,
        "approved_at": order.approved_at,
        "created_by": order.created_by,
        "notes": order.notes,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "items": items_out,
        "batches": batches_out,
        "outputs": outputs_out,
    }


@router.post("/orders/{order_id}/approve", response_model=MfgOrderOut)
async def approve_order_endpoint(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(admin_or_supervisor),
):
    """Approve a Manufacturing Order."""
    try:
        mo_obj = await manufacturing_service.approve_mfg_order(db=db, order_id=order_id, user_id=user.user_id)
        await write_audit(
            db=db,
            module="manufacturing",
            action="approve_order",
            record_id=mo_obj.id,
            record_no=mo_obj.order_no,
            description=f"Approved Manufacturing Order {mo_obj.order_no}",
            user_id=user.user_id,
            user_name=user.username,
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/orders/{order_id}/planning", response_model=ProductionPlanningOut)
async def get_order_planning(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Calculate requirements, stock availability, shortages and FEFO batch suggestions."""
    try:
        return await manufacturing_service.get_material_planning(db=db, order_id=order_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/reserve", response_model=MfgOrderOut)
async def reserve_order_materials(
    order_id: int,
    body: MaterialReserveIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Reserve specific batches for this order without double-deducting physical inventory."""
    try:
        await manufacturing_service.reserve_materials(
            db=db, order_id=order_id, reservations=body.reservations, user_id=user.user_id
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/issue", response_model=MfgOrderOut)
async def issue_order_materials(
    order_id: int,
    body: MaterialIssueIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Issue materials to the shop floor and deduct source stock via stock_ledger."""
    try:
        await manufacturing_service.issue_materials_to_production(
            db=db,
            order_id=order_id,
            issues=body.issues,
            user_id=user.user_id,
            transfer_to_department=body.transfer_to_department,
            notes=body.notes,
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/consume", response_model=MfgOrderOut)
async def consume_order_materials(
    order_id: int,
    body: MaterialConsumeIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Record actual material consumption in production."""
    try:
        await manufacturing_service.record_material_consumption(
            db=db, order_id=order_id, consumptions=body.consumptions, user_id=user.user_id, notes=body.notes
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/return", response_model=MfgOrderOut)
async def return_order_materials(
    order_id: int,
    body: MaterialReturnIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return unused materials back to warehouse and stock ledger."""
    try:
        await manufacturing_service.return_unused_materials(
            db=db, order_id=order_id, returns=body.returns, user_id=user.user_id, notes=body.notes
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/output", response_model=ProductionOutputOut)
async def record_output(
    order_id: int,
    body: ProductionOutputCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Record finished goods output and create product batch."""
    try:
        out_rec = await manufacturing_service.record_production_output(
            db=db, order_id=order_id, data=body, user_id=user.user_id
        )
        prod = await db.get(product_model, out_rec.product_id)
        return {
            "id": out_rec.id,
            "mfg_order_id": out_rec.mfg_order_id,
            "output_no": out_rec.output_no,
            "product_id": out_rec.product_id,
            "product_name": prod.name if prod else "",
            "batch_id": out_rec.batch_id,
            "batch_no": out_rec.batch_no,
            "good_qty": out_rec.good_qty,
            "rejected_qty": out_rec.rejected_qty,
            "scrap_qty": out_rec.scrap_qty,
            "unit": out_rec.unit,
            "mfg_date": out_rec.mfg_date,
            "exp_date": out_rec.exp_date,
            "qc_status": out_rec.qc_status,
            "qc_released_at": out_rec.qc_released_at,
            "qc_released_by": out_rec.qc_released_by,
            "qc_notes": out_rec.qc_notes,
            "created_at": out_rec.created_at,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/orders/{order_id}/outputs/{output_id}/qc-release", response_model=MfgOrderOut)
async def qc_release_endpoint(
    order_id: int,
    output_id: int,
    body: QcReleaseIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(admin_or_supervisor),
):
    """QC Gate: release good product into Finished Goods store or quarantine rejects."""
    try:
        await manufacturing_service.release_qc_production_output(
            db=db, order_id=order_id, output_id=output_id, data=body, user_id=user.user_id
        )
        return await get_order(order_id=order_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── BATCH TRACEABILITY (FORWARD & BACKWARD) ─────────────────────────────────
@router.get("/traceability/backward", response_model=BackwardTraceabilityOut)
async def backward_traceability(
    batch: str = Query(..., description="Finished product batch number or batch ID"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Backward Traceability: Finished Batch -> Order -> Raw Materials -> Suppliers & CoA."""
    try:
        return await manufacturing_service.get_backward_traceability(db=db, batch_identifier=batch)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/traceability/forward", response_model=ForwardTraceabilityOut)
async def forward_traceability(
    batch: str = Query(..., description="Raw material batch number or batch ID"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Forward Traceability: Raw Material Batch -> Orders -> Finished Batches -> Outlets & Invoices."""
    try:
        return await manufacturing_service.get_forward_traceability(db=db, batch_identifier=batch)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── PRODUCTION REPORTS ──────────────────────────────────────────────────────
@router.get("/reports/material-consumption")
async def report_material_consumption(
    order_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Planned vs Actual Consumption Variance Analysis."""
    stmt = (
        select(mfg_order_item, mfg_order.order_no, product_model.name.label("item_name"), product_model.item_code)
        .join(mfg_order, mfg_order_item.mfg_order_id == mfg_order.id)
        .join(product_model, mfg_order_item.product_id == product_model.id)
    )
    if order_id:
        stmt = stmt.where(mfg_order.id == order_id)
    if product_id:
        stmt = stmt.where(mfg_order_item.product_id == product_id)
    if start_date:
        stmt = stmt.where(mfg_order.planned_start_date >= start_date)
    if end_date:
        stmt = stmt.where(mfg_order.planned_start_date <= end_date)

    rows = (await db.execute(stmt)).all()
    results = []
    for it, ord_no, it_name, it_code in rows:
        var = it.consumed_qty - it.required_qty
        var_pct = (var / it.required_qty * Decimal("100")) if it.required_qty > 0 else Decimal("0.00")
        results.append({
            "order_no": ord_no,
            "product_id": it.product_id,
            "product_name": it_name,
            "item_code": it_code,
            "material_type": it.material_type,
            "required_qty": float(it.required_qty),
            "issued_qty": float(it.issued_qty),
            "consumed_qty": float(it.consumed_qty),
            "returned_qty": float(it.returned_qty),
            "variance": float(var),
            "variance_pct": float(var_pct),
            "unit": it.unit,
            "cost": float(it.total_cost),
        })
    return results


@router.get("/reports/wastage-yield")
async def report_wastage_yield(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Production Yield vs Standard Yield Variance Report."""
    stmt = (
        select(mfg_order, product_model.name.label("prod_name"), mfg_bom.expected_yield_pct)
        .join(product_model, mfg_order.product_id == product_model.id)
        .join(mfg_bom, mfg_order.bom_id == mfg_bom.id)
        .where(mfg_order.completed_qty > 0)
        .order_by(desc(mfg_order.id))
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    out = []
    for mo, p_name, exp_yield in rows:
        actual_yield = (mo.completed_qty / mo.planned_qty * Decimal("100")) if mo.planned_qty > 0 else Decimal("0.00")
        out.append({
            "order_no": mo.order_no,
            "product_name": p_name,
            "planned_qty": float(mo.planned_qty),
            "completed_qty": float(mo.completed_qty),
            "rejected_qty": float(mo.rejected_qty),
            "scrap_qty": float(mo.scrap_qty),
            "standard_yield_pct": float(exp_yield),
            "actual_yield_pct": float(actual_yield),
            "yield_variance_pct": float(actual_yield - exp_yield),
            "unit": mo.unit,
            "status": mo.status,
            "qc_status": mo.qc_status,
        })
    return out


# ─── reports used by the Production Reports page ─────────────────────────────
_LINES = """SELECT o.order_no, fg.name AS product_name, m.name AS material_name, m.item_code AS material_code, i.material_type,
        i.required_qty, i.issued_qty, i.consumed_qty, i.returned_qty, i.unit
    FROM mfg_order_items i JOIN mfg_orders o ON o.id = i.mfg_order_id JOIN products fg ON fg.id = o.product_id
    JOIN products m ON m.id = i.product_id"""


@router.get("/reports/consumption-variance")
async def report_consumption_variance(limit: int = Query(500, ge=1, le=5000), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """BOM requirement vs actual consumption per order and material (latest orders first)."""
    rows = (await db.execute(text(_LINES + " ORDER BY o.id DESC, i.id LIMIT :n"), {"n": limit})).mappings().all()
    out = []
    for r in rows:
        req, cons = Decimal(r["required_qty"] or 0), Decimal(r["consumed_qty"] or 0)
        out.append({**{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()},
                    "variance": float(cons - req), "variance_pct": float((cons - req) / req * 100) if req else None})
    return out


@router.get("/reports/production-yield")
async def report_production_yield(limit: int = Query(200, ge=1, le=2000), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Orders with output: good qty vs planned, rejected / scrap, standard vs actual yield (no figure is assumed)."""
    rows = (await db.execute(text("""SELECT o.order_no, p.name AS product_name, o.production_batch_no AS batch_no, o.planned_qty,
            o.completed_qty AS good_qty, o.rejected_qty, o.scrap_qty, o.unit, o.status, o.qc_status, b.expected_yield_pct
        FROM mfg_orders o JOIN products p ON p.id = o.product_id LEFT JOIN mfg_boms b ON b.id = o.bom_id
        WHERE o.completed_qty > 0 OR o.rejected_qty > 0 OR o.scrap_qty > 0 ORDER BY o.id DESC LIMIT :n"""), {"n": limit})).mappings().all()
    out = []
    for r in rows:
        d = {k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()}
        d["yield_pct"] = round(d["good_qty"] / d["planned_qty"] * 100, 2) if d["planned_qty"] else None
        d["yield_variance_pct"] = round(d["yield_pct"] - d["expected_yield_pct"], 2) if d["yield_pct"] is not None and d["expected_yield_pct"] is not None else None
        out.append(d)
    return out


@router.get("/reports/packaging-utilization")
async def report_packaging_utilization(limit: int = Query(500, ge=1, le=5000), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Packaging material lines: issued vs consumed vs returned; wastage = issued − consumed − returned."""
    rows = (await db.execute(text(_LINES + """ WHERE i.material_type = 'PACKAGING' OR m.item_type = 'PM' ORDER BY o.id DESC, i.id LIMIT :n"""), {"n": limit})).mappings().all()
    out = []
    for r in rows:
        iss, cons, ret = (Decimal(r[k] or 0) for k in ("issued_qty", "consumed_qty", "returned_qty"))
        out.append({**{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()},
                    "wastage_qty": float(max(iss - cons - ret, Decimal(0))), "efficiency_pct": round(float(cons / (iss - ret) * 100), 2) if iss - ret > 0 else None})
    return out


# ─── PURCHASE SHORTAGE INTEGRATION ───────────────────────────────────────────
@router.post("/create-shortage-po")
async def create_shortage_purchase_order(
    supplier_id: int,
    order_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Links material shortage directly to Purchase Order creation:
    Identifies shortages for a manufacturing order and creates a draft PO linked to mfg_order_id.
    """
    plan = await manufacturing_service.get_material_planning(db=db, order_id=order_id)
    shortage_items = [it for it in plan["requirements"] if it["shortage_qty"] > 0]
    if not shortage_items:
        raise HTTPException(400, "No material shortages found for this manufacturing order.")

    today_val = date.today()
    exp_date = today_val + timedelta(days=7)
    prefix = "PO-" + today_val.strftime("%Y%m%d")
    row = await db.execute(
        text("SELECT MAX(po_no) FROM po_headers WHERE po_no LIKE :p"),
        {"p": prefix + "%"}
    )
    last = row.scalar()
    seq = int(last[-4:]) + 1 if last else 1
    new_po_no = f"{prefix}{seq:04d}"

    po_hdr = po_header(
        po_no=new_po_no,
        supplier_id=supplier_id,
        po_date=today_val,
        expected_date=exp_date,
        delivery_days=7,
        status="draft",
        approval_status="draft",
        mfg_order_id=order_id,
        mfg_order_no=plan["order_no"],
        material_type="RAW_MATERIAL",
        notes=f"Auto-generated PO from Manufacturing Order #{plan['order_no']} shortage",
        created_by=user.user_id,
    )
    db.add(po_hdr)
    await db.flush()

    total_po_amt = Decimal("0.00")
    for s_it in shortage_items:
        prod = await db.get(product_model, s_it["product_id"])
        rate = prod.purchase_price or prod.cost_price or Decimal("0.00")
        line_tot = s_it["shortage_qty"] * rate
        total_po_amt += line_tot

        db.add(po_item(
            po_id=po_hdr.id,
            product_id=s_it["product_id"],
            qty=s_it["shortage_qty"],
            order_qty=s_it["shortage_qty"],
            rate=rate,
            gst_percent=prod.gst_percent or Decimal("0.00"),
            total=line_tot,
            amount=line_tot,
        ))

    po_hdr.total_amount = total_po_amt
    await db.commit()
    await db.refresh(po_hdr)

    return {
        "success": True,
        "po_id": po_hdr.id,
        "po_no": po_hdr.po_no,
        "items_count": len(shortage_items),
        "total_amount": float(total_po_amt),
    }
