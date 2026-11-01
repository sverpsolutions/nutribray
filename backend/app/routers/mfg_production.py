"""Manufacturing Phase C: production on the department stores.

Production order (BOM + brand + packaging spec, optionally a customer order) -> approve (second person) ->
reserve materials (no stock is reserved twice) -> issue store -> Production WIP (partial issues allowed) ->
run report: consumed / damaged (scrap, pending approval) / unused returned / still in process, good output -> QC
quarantine, rejected output -> Rejected store -> finished-goods QC: approved -> Finished Goods store ->
finalize only when every issued unit is explained (or a manager approves the variance).

Per material:  issued = consumed + damaged + returned + written_off + in_process.
Also here: inward from a retail outlet / GRN location into a plant store, disposal of rejected / scrap stock,
damage register approvals and tolerances.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.routers.mfg_setup import ADMIN, _audit, _not_own, _rows
from app.services import mfg_stock_service as stk
from app.services.billing_service import _update_product_stock, _write_stock_ledger
from app.services.manufacturing_service import get_next_order_no

router = APIRouter(prefix="/manufacturing", tags=["manufacturing production"])
D0 = Decimal(0)
OPEN = ("DRAFT", "APPROVED", "MATERIAL_SHORTAGE", "READY", "IN_PRODUCTION", "AWAITING_QC", "PARTIALLY_COMPLETED")
IN_PROC = "(i.issued_qty - i.consumed_qty - i.damaged_qty - i.returned_qty - i.written_off_qty)"
USABLE = "SELECT id FROM mfg_stores WHERE usable AND is_active AND NOT is_wip"
REASONS = ("Production Damage", "Printing Defect", "Cap Damage", "Label Damage", "Filling Loss", "Spillage",
           "Rejected Finished Product", "Quality Rejection", "Missing / Loss", "Other Approved Reason")


def _mgr(user, what):
    if user.role not in ADMIN + ("manager",):
        raise HTTPException(403, f"Only a manager or administrator can {what}.")


async def _order(db, oid, lock=False):
    o = (await db.execute(text("SELECT * FROM mfg_orders WHERE id = :i AND stock_mode = 'DEPT'" + (" FOR UPDATE" if lock else "")),
                          {"i": oid})).mappings().first()
    if not o:
        raise HTTPException(404, "Production order not found")
    return o


async def free_stock(db, product_id: int, brand_id: int) -> tuple[Decimal, Decimal]:
    """(physical in usable stores, reserved by open production orders) for one item + brand."""
    phys = stk.d((await db.execute(text(f"SELECT SUM(qty) FROM mfg_stock WHERE product_id = :p AND brand_id = :b AND store_id IN ({USABLE})"),
                                   {"p": product_id, "b": brand_id})).scalar())
    resv = stk.d((await db.execute(text(f"""SELECT SUM(i.reserved_qty) FROM mfg_order_items i JOIN mfg_orders o ON o.id = i.mfg_order_id
        WHERE i.product_id = :p AND i.brand_id = :b AND o.stock_mode = 'DEPT' AND o.status IN {OPEN}"""), {"p": product_id, "b": brand_id})).scalar())
    return phys, resv


# ── production orders ─────────────────────────────────────────────────────────
class order_in(BaseModel):
    bom_id: int
    brand_id: int
    spec_id: Optional[int] = None
    sales_order_id: Optional[int] = None
    planned_qty: Decimal = Field(gt=0)
    unit: Optional[str] = None
    customer_po_no: Optional[str] = None
    planned_start_date: date
    planned_end_date: date
    supervisor_name: Optional[str] = None
    quality_requirements: Optional[str] = None
    notes: Optional[str] = None
    parent_order_id: Optional[int] = None


async def _create_order(db, b: order_in, user) -> dict:
    bom = (await db.execute(text("SELECT * FROM mfg_boms WHERE id = :i"), {"i": b.bom_id})).mappings().first()
    if not bom or bom["status"] != "APPROVED":
        raise HTTPException(400, "Choose an APPROVED bill of materials.")
    if bom["brand_id"] and bom["brand_id"] != b.brand_id:
        raise HTTPException(400, "This BOM is specific to another brand.")
    brand = (await db.execute(text("SELECT * FROM mfg_brands WHERE id = :b AND is_active"), {"b": b.brand_id})).mappings().first()
    if not brand:
        raise HTTPException(400, "Choose an active brand.")
    spec = None
    if b.spec_id:
        spec = (await db.execute(text("SELECT * FROM mfg_pack_specs WHERE id = :s"), {"s": b.spec_id})).mappings().first()
        if not spec or spec["status"] != "APPROVED" or spec["brand_id"] != b.brand_id or spec["product_id"] != bom["product_id"]:
            raise HTTPException(400, "The packaging spec must be APPROVED, for this brand and for the BOM's finished product.")
    if b.sales_order_id:
        so = (await db.execute(text("SELECT brand_id, product_id, status FROM mfg_sales_orders WHERE id = :s"), {"s": b.sales_order_id})).mappings().first()
        if not so or so["brand_id"] != b.brand_id or so["product_id"] != bom["product_id"] or so["status"] in ("PENDING_APPROVAL", "REJECTED", "CANCELLED", "CLOSED", "COMPLETED"):
            raise HTTPException(400, "The customer order is closed or is for another brand / product.")
    planned = await stk.to_base(db, bom["product_id"], b.planned_qty, b.unit, spec["units_per_carton"] if spec else None)
    from app.services import mfg_planning
    comps = await mfg_planning.requirements(db, dict(bom), planned, b.brand_id, dict(spec) if spec else None)   # same rules as planning
    no = await get_next_order_no(db, "MO-")
    oid = (await db.execute(text("""INSERT INTO mfg_orders (order_no, product_id, bom_id, planned_qty, completed_qty, rejected_qty, scrap_qty, unit,
        department, planned_start_date, planned_end_date, status, qc_status, estimated_cost, actual_cost, notes, created_by, stock_mode, brand_id,
        spec_id, sales_order_id, parent_order_id, customer_po_no, supervisor_name, quality_requirements)
        VALUES (:no, :p, :bom, :q, 0, 0, 0, (SELECT UPPER(COALESCE(unit, 'PCS')) FROM products WHERE id = :p), 'Production', :s, :e, 'DRAFT',
        'PENDING', 0, 0, :n, :u, 'DEPT', :br, :sp, :so, :par, :po, :sup, :qr) RETURNING id"""),
        {"no": no, "p": bom["product_id"], "bom": b.bom_id, "q": planned, "s": b.planned_start_date, "e": b.planned_end_date, "n": b.notes,
         "u": user.user_id, "br": b.brand_id, "sp": b.spec_id, "so": b.sales_order_id, "par": b.parent_order_id, "po": b.customer_po_no,
         "sup": b.supervisor_name, "qr": b.quality_requirements or (spec["quality_requirements"] if spec else None)})).scalar()
    for c in comps:
        await db.execute(text("""INSERT INTO mfg_order_items (mfg_order_id, product_id, material_type, required_qty, reserved_qty, issued_qty,
            consumed_qty, returned_qty, unit, cost_per_unit, total_cost, status, brand_id)
            VALUES (:o, :p, :t, :r, 0, 0, 0, 0, :u, :c, :tc, 'PENDING', :br)"""),
            {"o": oid, "p": c["product_id"], "t": c["material_type"], "r": c["required"], "u": c["unit"], "c": c["cost"],
             "tc": (c["cost"] * c["required"]).quantize(Decimal("0.01")), "br": c["brand_id"]})
    await _audit(db, user, "create_production_order", oid, no, f"Production order {no}: {planned.normalize():f} for brand {brand['name']}")
    return {"id": oid, "order_no": no}


@router.post("/prod/orders")
async def create_order(b: order_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    r = await _create_order(db, b, user)
    await db.commit()
    return r


@router.get("/prod/orders")
async def list_orders(status: Optional[str] = None, search: str = "", db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT o.id, o.order_no, o.status, o.planned_qty, o.completed_qty, o.rejected_qty, o.planned_start_date, o.planned_end_date,
        p.name AS product, p.item_code, b.name AS brand, b.is_own_brand, c.name AS customer, so.so_no, s.spec_code, s.units_per_carton,
        (SELECT COALESCE(SUM(approved_qty), 0) FROM mfg_order_outputs x WHERE x.mfg_order_id = o.id) AS approved_qty,
        (SELECT COUNT(*) FROM mfg_damages d WHERE d.mfg_order_id = o.id AND d.status = 'PENDING') AS pending_damages
        FROM mfg_orders o JOIN products p ON p.id = o.product_id LEFT JOIN mfg_brands b ON b.id = o.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN mfg_sales_orders so ON so.id = o.sales_order_id
        LEFT JOIN mfg_pack_specs s ON s.id = o.spec_id
        WHERE o.stock_mode = 'DEPT' AND (CAST(:s AS TEXT) IS NULL OR o.status = :s)
          AND (:q = '%%' OR o.order_no ILIKE :q OR p.name ILIKE :q OR b.name ILIKE :q OR so.so_no ILIKE :q)
        ORDER BY o.id DESC LIMIT 500""", {"s": status, "q": f"%{search.strip()}%"})


@router.get("/prod/orders/{oid}")
async def get_order(oid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    await _order(db, oid)
    head = (await _rows(db, """SELECT o.*, p.name AS product, p.item_code, b.name AS brand, b.is_own_brand, c.name AS customer, so.so_no,
        so.ordered_qty AS so_ordered_qty, s.spec_code, s.revision AS spec_rev, s.units_per_carton, s.tin_size, s.cap_colour, s.printing_colour,
        bo.bom_no, bo.batch_size, bo.expected_wastage_pct, par.order_no AS parent_order_no, u.name AS created_by_name, au.name AS approved_by_name
        FROM mfg_orders o JOIN products p ON p.id = o.product_id JOIN mfg_boms bo ON bo.id = o.bom_id LEFT JOIN mfg_brands b ON b.id = o.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN mfg_sales_orders so ON so.id = o.sales_order_id
        LEFT JOIN mfg_pack_specs s ON s.id = o.spec_id LEFT JOIN mfg_orders par ON par.id = o.parent_order_id
        LEFT JOIN users u ON u.id = o.created_by LEFT JOIN users au ON au.id = o.approved_by WHERE o.id = :i""", {"i": oid}))[0]
    items = await _rows(db, f"""SELECT i.*, {IN_PROC} AS in_process, p.name AS item, p.item_code, b.name AS brand,
        bi.quantity / NULLIF(bo.batch_size, 0) AS std_per_unit
        FROM mfg_order_items i JOIN products p ON p.id = i.product_id JOIN mfg_orders o ON o.id = i.mfg_order_id
        JOIN mfg_boms bo ON bo.id = o.bom_id LEFT JOIN LATERAL (SELECT quantity FROM mfg_bom_items x WHERE x.bom_id = o.bom_id
            AND x.product_id = i.product_id ORDER BY id LIMIT 1) bi ON TRUE
        LEFT JOIN mfg_brands b ON b.id = i.brand_id WHERE i.mfg_order_id = :i ORDER BY i.id""", {"i": oid})
    for it in items:
        phys, resv = await free_stock(db, it["product_id"], it["brand_id"])
        it["available"] = float(phys)
        it["free"] = float(phys - resv)
        need = stk.d(it["required_qty"]) - stk.d(it["issued_qty"]) - stk.d(it["reserved_qty"])
        it["shortage"] = float(max(need - max(phys - resv, D0), D0))
        it["locations"] = await _rows(db, f"""SELECT s.id AS store_id, s.code, s.name, m.batch_no, m.qty FROM mfg_stock m JOIN mfg_stores s ON s.id = m.store_id
            WHERE m.product_id = :p AND m.brand_id = :b AND m.qty > 0 AND m.store_id IN ({USABLE}) ORDER BY s.sort, m.batch_no""",
                                      {"p": it["product_id"], "b": it["brand_id"]})
        it["std_consumption"] = float(stk.d(it["std_per_unit"]) * stk.d(head["completed_qty"])) if it["std_per_unit"] is not None else None
    head["items"] = items
    head["outputs"] = await _rows(db, """SELECT x.*, x.good_qty - x.approved_qty - x.qc_rejected_qty AS qc_pending FROM mfg_order_outputs x
        WHERE x.mfg_order_id = :i ORDER BY x.id""", {"i": oid})
    head["damages"] = await _rows(db, """SELECT d.*, p.name AS item FROM mfg_damages d JOIN products p ON p.id = d.product_id
        WHERE d.mfg_order_id = :i ORDER BY d.id""", {"i": oid})
    head["children"] = await _rows(db, "SELECT id, order_no, planned_qty, status FROM mfg_orders WHERE parent_order_id = :i", {"i": oid})
    approved = sum(stk.d(x["approved_qty"]) for x in head["outputs"])
    target = stk.d(head["so_ordered_qty"]) if head["sales_order_id"] else stk.d(head["planned_qty"])
    head["approved_qty"] = float(approved)
    head["shortfall"] = float(max(stk.d(head["planned_qty"]) - stk.d(head["completed_qty"]), D0))
    head["unexplained"] = any(stk.d(i["in_process"]) != 0 for i in items)
    head["target_qty"] = float(target)
    return head


@router.post("/prod/orders/{oid}/approve")
async def approve_order(oid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = await _order(db, oid, lock=True)
    if o["status"] != "DRAFT":
        raise HTTPException(400, f"{o['order_no']} is {o['status'].lower()}.")
    _not_own(o["created_by"], user)
    await db.execute(text("UPDATE mfg_orders SET status = 'APPROVED', approved_by = :u, approved_at = NOW() WHERE id = :i"), {"u": user.user_id, "i": oid})
    await _audit(db, user, "approve_production_order", oid, o["order_no"], f"{o['order_no']} approved")
    await db.commit()
    return {"success": True}


@router.post("/prod/orders/{oid}/reserve")
async def reserve(oid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Reserve what is free for every material; the same stock is never reserved for two orders."""
    o = await _order(db, oid, lock=True)
    if o["status"] not in ("APPROVED", "MATERIAL_SHORTAGE", "READY", "IN_PRODUCTION"):
        raise HTTPException(400, "Approve the order first.")
    short = []
    for it in (await db.execute(text("SELECT * FROM mfg_order_items WHERE mfg_order_id = :i ORDER BY id FOR UPDATE"), {"i": oid})).mappings().all():
        await db.execute(text("SELECT pg_advisory_xact_lock(7001, :p)"), {"p": it["product_id"]})
        need = stk.d(it["required_qty"]) - stk.d(it["issued_qty"]) - stk.d(it["reserved_qty"])
        if need <= 0:
            continue
        phys, resv = await free_stock(db, it["product_id"], it["brand_id"])
        take = min(need, max(phys - resv, D0))
        if take > 0:
            await db.execute(text("UPDATE mfg_order_items SET reserved_qty = reserved_qty + :q, status = 'RESERVED' WHERE id = :i"), {"q": take, "i": it["id"]})
        if take < need:
            short.append({"product_id": it["product_id"], "short": float(need - take)})
    status = o["status"] if o["status"] == "IN_PRODUCTION" else ("MATERIAL_SHORTAGE" if short else "READY")
    await db.execute(text("UPDATE mfg_orders SET status = :s WHERE id = :i"), {"s": status, "i": oid})
    await _audit(db, user, "reserve_materials", oid, o["order_no"], f"Materials reserved; {len(short)} short")
    await db.commit()
    return {"status": status, "shortages": short}


class issue_line(BaseModel):
    order_item_id: int
    from_store_id: int
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = None
    batch_no: str = ""


class issue_in(BaseModel):
    lines: list[issue_line] = Field(min_length=1)
    received_by: Optional[str] = None
    remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/prod/orders/{oid}/issue")
async def issue(oid: int, b: issue_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Material issue slip: usable store -> Production WIP, of the brand the order needs (never another customer's)."""
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    o = await _order(db, oid, lock=True)
    if o["status"] not in ("APPROVED", "MATERIAL_SHORTAGE", "READY", "IN_PRODUCTION", "AWAITING_QC", "PARTIALLY_COMPLETED"):
        raise HTTPException(400, f"Materials cannot be issued to an order that is {o['status'].lower()}.")
    if not o["released_at"]:
        raise HTTPException(400, f"{o['order_no']} is not released for production — run the release check first.")
    usable = set((await db.execute(text(USABLE))).scalars().all())
    no = await stk.next_doc(db, "MIS")
    mwip = await stk.store(db, "MWIP")
    for n, ln in enumerate(b.lines):
        it = (await db.execute(text("SELECT * FROM mfg_order_items WHERE id = :i AND mfg_order_id = :o FOR UPDATE"),
                               {"i": ln.order_item_id, "o": oid})).mappings().first()
        if not it:
            raise HTTPException(400, "Material is not on this production order.")
        if ln.from_store_id not in usable:
            raise HTTPException(400, "Issue only from a usable store — WIP, QC, rejected and scrap stock cannot go to production.")
        q = await stk.to_base(db, it["product_id"], ln.qty, ln.unit)
        left = stk.d(it["required_qty"]) - stk.d(it["issued_qty"])
        if q > left:
            raise HTTPException(400, f"Issue of {q.normalize():f} is more than the {max(left, D0).normalize():f} still required by the BOM.")
        await db.execute(text("SELECT pg_advisory_xact_lock(7001, :p)"), {"p": it["product_id"]})
        phys, resv = await free_stock(db, it["product_id"], it["brand_id"])
        if q > stk.d(it["reserved_qty"]) + phys - resv:
            raise HTTPException(400, f"Only {(stk.d(it['reserved_qty']) + phys - resv).normalize():f} can be issued — the rest is reserved for other orders.")
        await stk.post(db, txn_type="MATERIAL_ISSUE", product_id=it["product_id"], qty_base=q, from_store=ln.from_store_id, to_store=mwip,
                       user_id=user.user_id, batch_no=ln.batch_no, brand_id=it["brand_id"], unit_entered=ln.unit, qty_entered=ln.qty,
                       ref_type="mfg_order", ref_id=oid, ref_no=o["order_no"], doc_no=no, remarks=f"Received by {b.received_by or '-'}. {b.remarks or ''}",
                       request_key=None)
        await db.execute(text("""UPDATE mfg_order_items SET issued_qty = issued_qty + :q, reserved_qty = GREATEST(reserved_qty - :q, 0),
            status = 'ISSUED' WHERE id = :i"""), {"q": q, "i": it["id"]})
    await db.execute(text("""UPDATE mfg_orders SET status = CASE WHEN status IN ('APPROVED','MATERIAL_SHORTAGE','READY') THEN 'IN_PRODUCTION' ELSE status END,
        actual_start_date = COALESCE(actual_start_date, NOW()) WHERE id = :i"""), {"i": oid})
    await _audit(db, user, "material_issue", oid, no, f"{no}: {len(b.lines)} material(s) issued to {o['order_no']}")
    await db.commit()
    return {"issue_no": no}


class damage_line(BaseModel):
    qty: Decimal = Field(gt=0)
    reason: str
    stage: Optional[str] = None
    operator: Optional[str] = None
    remarks: Optional[str] = None
    photo: Optional[str] = None


class material_result(BaseModel):
    order_item_id: int
    consumed: Decimal = Field(Decimal(0), ge=0)
    returned: Decimal = Field(Decimal(0), ge=0)
    return_store_id: Optional[int] = None
    damages: list[damage_line] = []


class run_in(BaseModel):
    good_qty: Decimal = Field(Decimal(0), ge=0)
    rejected_qty: Decimal = Field(Decimal(0), ge=0)
    batch_no: Optional[str] = None
    mfg_date: date
    exp_date: Optional[date] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    supervisor_name: Optional[str] = None
    remarks: Optional[str] = None
    materials: list[material_result] = []
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/prod/orders/{oid}/report")
async def run_report(oid: int, b: run_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Production run: material consumed / damaged / returned and finished output (good -> QC hold, rejected -> Rejected store)."""
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    o = await _order(db, oid, lock=True)
    if o["status"] not in ("IN_PRODUCTION", "AWAITING_QC", "PARTIALLY_COMPLETED"):
        raise HTTPException(400, "Issue materials before reporting production.")
    if b.exp_date and b.exp_date <= b.mfg_date:
        raise HTTPException(400, "Expiry date must be after the manufacturing date.")
    if b.good_qty + b.rejected_qty <= 0 and not b.materials:
        raise HTTPException(400, "Nothing to report.")
    mwip, scr, qcq, rej = [await stk.store(db, c) for c in ("MWIP", "SCR", "QCQ", "REJ")]
    usable = set((await db.execute(text(USABLE))).scalars().all())
    no = await stk.next_doc(db, "PRN")
    alerts = []
    for m in b.materials:
        it = (await db.execute(text(f"SELECT i.*, {IN_PROC} AS in_process FROM mfg_order_items i WHERE i.id = :i AND i.mfg_order_id = :o FOR UPDATE"),
                               {"i": m.order_item_id, "o": oid})).mappings().first()
        if not it:
            raise HTTPException(400, "Material is not on this production order.")
        dmg = sum((x.qty for x in m.damages), D0)
        if m.consumed + m.returned + dmg > stk.d(it["in_process"]):
            raise HTTPException(400, f"Material #{it['product_id']}: consumed + damaged + returned ({(m.consumed + m.returned + dmg).normalize():f}) "
                                     f"is more than the {stk.d(it['in_process']).normalize():f} in production.")
        common = dict(product_id=it["product_id"], user_id=user.user_id, brand_id=it["brand_id"], ref_type="mfg_order", ref_id=oid, ref_no=o["order_no"])
        if m.consumed > 0:
            await stk.drain(db, txn_type="CONSUME", qty_base=m.consumed, from_store=mwip, to_store=None, doc_no=no, **common)
        if m.returned > 0:
            to = m.return_store_id
            if to not in usable:
                raise HTTPException(400, "Unused material goes back to a usable store (choose it on the line).")
            await stk.drain(db, txn_type="MATERIAL_RETURN", qty_base=m.returned, from_store=mwip, to_store=to, doc_no=no,
                           remarks="Unused material returned (not damage)", **common)
        for x in m.damages:
            if x.reason not in REASONS:
                raise HTTPException(400, f"Damage reason must be one of: {', '.join(REASONS)}")
            r = await stk.record_damage(db, source="PRODUCTION", product_id=it["product_id"], qty=x.qty, reason=x.reason, held_store=scr,
                                        back_store=mwip, from_store=mwip, user_id=user.user_id, base_qty=it["issued_qty"], brand_id=it["brand_id"], batch_no=None,
                                        mfg_order_id=oid, order_item_id=it["id"], finished_id=o["product_id"], stage=x.stage,
                                        department="Production", operator=x.operator, remarks=x.remarks, photo=x.photo, ref_no=o["order_no"])
            if r["over_tolerance"]:
                alerts.append(f"{r['damage_no']}: {r['damage_pct']}% damage is above the {r['tolerance_pct']}% tolerance")
        await db.execute(text("""UPDATE mfg_order_items SET consumed_qty = consumed_qty + :c, returned_qty = returned_qty + :r,
            damaged_qty = damaged_qty + :d, status = 'CONSUMED' WHERE id = :i"""), {"c": m.consumed, "r": m.returned, "d": dmg, "i": it["id"]})
    out_id = None
    if b.good_qty + b.rejected_qty > 0:
        batch = (b.batch_no or "").strip() or await stk.next_doc(db, "FGB")
        out_no = await stk.next_doc(db, "OUT")
        for qty, to, typ in ((b.good_qty, qcq, "PRODUCE"), (b.rejected_qty, rej, "PRODUCE_REJECT")):
            if qty > 0:
                await stk.post(db, txn_type=typ, product_id=o["product_id"], qty_base=qty, from_store=None, to_store=to, user_id=user.user_id,
                               batch_no=batch, brand_id=o["brand_id"] or 0, ref_type="mfg_order", ref_id=oid, ref_no=o["order_no"], doc_no=out_no)
        out_id = (await db.execute(text("""INSERT INTO mfg_order_outputs (mfg_order_id, output_no, product_id, batch_no, good_qty, rejected_qty, scrap_qty,
            unit, mfg_date, exp_date, qc_status, qc_notes, created_by, brand_id, start_time, end_time, supervisor_name, approved_qty, qc_rejected_qty)
            VALUES (:o, :no, :p, :b, :g, :r, 0, :u, :md, :ed, 'PENDING', :k, :by, :br, :st, :et, :sup, 0, 0) RETURNING id"""),
            {"o": oid, "no": out_no, "p": o["product_id"], "b": batch, "g": b.good_qty, "r": b.rejected_qty, "u": o["unit"], "md": b.mfg_date,
             "ed": b.exp_date, "k": b.remarks, "by": user.user_id, "br": o["brand_id"] or 0,
             "st": b.start_time, "et": b.end_time, "sup": b.supervisor_name})).scalar()
        await db.execute(text("""UPDATE mfg_orders SET completed_qty = completed_qty + :g, rejected_qty = rejected_qty + :r, status = 'AWAITING_QC',
            production_batch_no = COALESCE(production_batch_no, :b) WHERE id = :i"""), {"g": b.good_qty, "r": b.rejected_qty, "b": batch, "i": oid})
    await _audit(db, user, "production_report", oid, no, f"{o['order_no']}: good {b.good_qty.normalize():f}, rejected {b.rejected_qty.normalize():f}; "
                 f"{len(b.materials)} material line(s)" + (f"; ALERT {'; '.join(alerts)}" if alerts else ""))
    await db.commit()
    return {"report_no": no, "output_id": out_id, "alerts": alerts}


class qc_in(BaseModel):
    approved_qty: Decimal = Field(Decimal(0), ge=0)
    rejected_qty: Decimal = Field(Decimal(0), ge=0)
    rework: bool = False
    remarks: Optional[str] = None


@router.post("/prod/outputs/{out_id}/qc/approve")
async def qc_output(out_id: int, b: qc_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Finished goods QC: approved -> Finished Goods store (available), rejected -> Rejected store; the rest stays on QC hold."""
    x = (await db.execute(text("SELECT x.*, o.order_no, o.planned_qty FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id "
                               "WHERE x.id = :i AND o.stock_mode = 'DEPT' FOR UPDATE OF x"), {"i": out_id})).mappings().first()
    if not x:
        raise HTTPException(404, "Production output not found")
    pend = stk.d(x["good_qty"]) - stk.d(x["approved_qty"]) - stk.d(x["qc_rejected_qty"])
    if b.approved_qty + b.rejected_qty <= 0 or b.approved_qty + b.rejected_qty > pend:
        raise HTTPException(400, f"Approve / reject up to the {pend.normalize():f} still on QC hold.")
    qcq, fgs, rej = [await stk.store(db, c) for c in ("QCQ", "FGS", "REJ")]
    common = dict(product_id=x["product_id"], user_id=user.user_id, batch_no=x["batch_no"], brand_id=x["brand_id"], ref_type="mfg_output",
                  ref_id=out_id, ref_no=x["order_no"])
    if b.approved_qty > 0:
        await stk.post(db, txn_type="QC_RELEASE", qty_base=b.approved_qty, from_store=qcq, to_store=fgs, remarks=b.remarks, **common)
    if b.rejected_qty > 0:
        await stk.post(db, txn_type="QC_REJECT", qty_base=b.rejected_qty, from_store=qcq, to_store=rej, remarks=b.remarks, **common)
    left = pend - b.approved_qty - b.rejected_qty
    approved = stk.d(x["approved_qty"]) + b.approved_qty
    st = ("APPROVED" if approved > 0 else "REJECTED") if left == 0 else ("REWORK" if b.rework else "PENDING")
    await db.execute(text("""UPDATE mfg_order_outputs SET approved_qty = approved_qty + :a, qc_rejected_qty = qc_rejected_qty + :r, qc_status = :s,
        qc_released_by = :u, qc_released_at = NOW() WHERE id = :i"""), {"a": b.approved_qty, "r": b.rejected_qty, "s": st, "u": user.user_id, "i": out_id})
    oid = x["mfg_order_id"]
    open_qc = (await db.execute(text("SELECT COUNT(*) FROM mfg_order_outputs WHERE mfg_order_id = :o AND qc_status IN ('PENDING','REWORK')"),
                                {"o": oid})).scalar()
    tot = stk.d((await db.execute(text("SELECT SUM(approved_qty) FROM mfg_order_outputs WHERE mfg_order_id = :o"), {"o": oid})).scalar())
    if not open_qc:
        await db.execute(text("UPDATE mfg_orders SET status = :s, qc_status = 'RELEASED' WHERE id = :o"),
                         {"s": "PARTIALLY_COMPLETED" if tot < stk.d(x["planned_qty"]) else "AWAITING_QC", "o": oid})
    await _audit(db, user, "fg_qc", out_id, x["output_no"], f"{x['order_no']} batch {x['batch_no']}: approved {b.approved_qty.normalize():f}, "
                 f"rejected {b.rejected_qty.normalize():f}, on hold {left.normalize():f}")
    await db.commit()
    return {"qc_status": st, "on_hold": float(left)}


class finalize_in(BaseModel):
    variance_reason: Optional[str] = Field(None, max_length=300)


@router.post("/prod/orders/{oid}/finalize")
async def finalize(oid: int, b: finalize_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Complete the order only when every issued unit is explained; a manager may write off the rest as an approved variance."""
    o = await _order(db, oid, lock=True)
    if o["status"] in ("COMPLETED", "CANCELLED", "DRAFT"):
        raise HTTPException(400, f"{o['order_no']} is {o['status'].lower()}.")
    if (await db.execute(text("SELECT 1 FROM mfg_damages WHERE mfg_order_id = :i AND status = 'PENDING'"), {"i": oid})).first():
        raise HTTPException(400, "Damage entries are awaiting approval — approve or reject them first.")
    if (await db.execute(text("SELECT 1 FROM mfg_order_outputs WHERE mfg_order_id = :i AND qc_status IN ('PENDING','REWORK')"), {"i": oid})).first():
        raise HTTPException(400, "Finished goods are still on QC hold.")
    rest = (await db.execute(text(f"SELECT i.*, {IN_PROC} AS in_process FROM mfg_order_items i WHERE i.mfg_order_id = :i AND {IN_PROC} <> 0 FOR UPDATE"),
                             {"i": oid})).mappings().all()
    if rest:
        if not b.variance_reason:
            raise HTTPException(400, f"{len(rest)} material(s) still have unexplained quantity in production. Report consumption / damage / "
                                     "return, or give a variance reason (manager).")
        _mgr(user, "approve a production variance")
        mwip = await stk.store(db, "MWIP")
        for it in rest:
            q = stk.d(it["in_process"])
            no = await stk.next_doc(db, "DMG")
            await stk.drain(db, txn_type="VARIANCE", product_id=it["product_id"], qty_base=q, from_store=mwip, to_store=None, user_id=user.user_id,
                           brand_id=it["brand_id"], ref_type="mfg_order", ref_id=oid, ref_no=o["order_no"], doc_no=no,
                           remarks=f"Approved variance: {b.variance_reason}")
            await db.execute(text("""INSERT INTO mfg_damages (damage_no, source, mfg_order_id, order_item_id, product_id, brand_id, qty, base_qty,
                damage_pct, reason, stage, department, remarks, status, decided_by, decided_at, created_by)
                VALUES (:no, 'PRODUCTION', :o, :it, :p, :br, :q, :bq, ROUND(CAST(:q AS NUMERIC) / NULLIF(CAST(:bq AS NUMERIC), 0) * 100, 3), 'Other Approved Reason', 'Closure',
                'Production', :r, 'APPROVED', :u, NOW(), :u)"""),
                {"no": no, "o": oid, "it": it["id"], "p": it["product_id"], "br": it["brand_id"], "q": q, "bq": it["issued_qty"],
                 "r": b.variance_reason, "u": user.user_id})
            await db.execute(text("UPDATE mfg_order_items SET written_off_qty = written_off_qty + :q WHERE id = :i"), {"q": q, "i": it["id"]})
    await db.execute(text("UPDATE mfg_order_items SET reserved_qty = 0 WHERE mfg_order_id = :i"), {"i": oid})
    await db.execute(text("UPDATE mfg_orders SET status = 'COMPLETED', actual_end_date = NOW(), close_note = :n WHERE id = :i"),
                     {"n": b.variance_reason, "i": oid})
    await _audit(db, user, "complete_production_order", oid, o["order_no"], f"{o['order_no']} completed" +
                 (f" with approved variance: {b.variance_reason}" if rest else " — fully reconciled"))
    await db.commit()
    return {"success": True}


class supp_in(BaseModel):
    qty: Optional[Decimal] = Field(None, gt=0)


@router.post("/prod/orders/{oid}/supplementary")
async def supplementary(oid: int, b: supp_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """New draft order for the shortfall (planned - good produced), same BOM / brand / spec / customer order."""
    o = await _order(db, oid)
    qty = b.qty or stk.d(o["planned_qty"]) - stk.d(o["completed_qty"])
    if qty <= 0:
        raise HTTPException(400, "No shortfall on this order.")
    r = await _create_order(db, order_in(bom_id=o["bom_id"], brand_id=o["brand_id"], spec_id=o["spec_id"], sales_order_id=o["sales_order_id"],
                                         planned_qty=qty, customer_po_no=o["customer_po_no"], planned_start_date=stk.today(),
                                         planned_end_date=max(stk.today(), o["planned_end_date"]), supervisor_name=o["supervisor_name"],
                                         notes=f"Supplementary to {o['order_no']} (shortfall)", parent_order_id=oid), user)
    await db.commit()
    return r


class reason_in(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/prod/orders/{oid}/cancel")
async def cancel(oid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = await _order(db, oid, lock=True)
    if o["status"] in ("COMPLETED", "CANCELLED"):
        raise HTTPException(400, f"{o['order_no']} is already {o['status'].lower()}.")
    if (await db.execute(text(f"SELECT 1 FROM mfg_order_items i WHERE i.mfg_order_id = :i AND {IN_PROC} <> 0"), {"i": oid})).first() \
            or (await db.execute(text("SELECT 1 FROM mfg_order_outputs WHERE mfg_order_id = :i"), {"i": oid})).first():
        raise HTTPException(400, "Material is in production or output was reported — return the material / finalize instead of cancelling.")
    await db.execute(text("UPDATE mfg_order_items SET reserved_qty = 0 WHERE mfg_order_id = :i"), {"i": oid})
    await db.execute(text("UPDATE mfg_orders SET status = 'CANCELLED', close_note = :r WHERE id = :i"), {"r": b.reason, "i": oid})
    await _audit(db, user, "cancel_production_order", oid, o["order_no"], f"{o['order_no']} cancelled, reservations released: {b.reason}")
    await db.commit()
    return {"success": True}


# ── damage register & tolerances ──────────────────────────────────────────────
@router.get("/damages")
async def damages(status: Optional[str] = None, source: Optional[str] = None, from_date: Optional[date] = None, to_date: Optional[date] = None,
                  db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT d.*, p.name AS item, p.item_code, b.name AS brand, o.order_no, j.job_no, u.name AS recorded_by, du.name AS decided_by_name,
        TO_CHAR(d.created_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS recorded_at
        FROM mfg_damages d JOIN products p ON p.id = d.product_id LEFT JOIN mfg_brands b ON b.id = d.brand_id
        LEFT JOIN mfg_orders o ON o.id = d.mfg_order_id LEFT JOIN mfg_print_jobs j ON j.id = d.print_job_id
        LEFT JOIN users u ON u.id = d.created_by LEFT JOIN users du ON du.id = d.decided_by
        WHERE (CAST(:s AS TEXT) IS NULL OR d.status = :s) AND (CAST(:src AS TEXT) IS NULL OR d.source = :src)
          AND (CAST(:fd AS DATE) IS NULL OR CAST(d.created_at + INTERVAL '5 hours 30 minutes' AS date) >= :fd)
          AND (CAST(:td AS DATE) IS NULL OR CAST(d.created_at + INTERVAL '5 hours 30 minutes' AS date) <= :td)
        ORDER BY d.id DESC LIMIT 1000""", {"s": status, "src": source, "fd": from_date, "td": to_date})


class decide_in(BaseModel):
    note: Optional[str] = Field(None, max_length=300)
    reason: Optional[str] = None


async def _damage(db, did):
    d = (await db.execute(text("SELECT * FROM mfg_damages WHERE id = :i FOR UPDATE"), {"i": did})).mappings().first()
    if not d:
        raise HTTPException(404, "Damage entry not found")
    if d["status"] != "PENDING":
        raise HTTPException(400, f"{d['damage_no']} is already {d['status'].lower()}.")
    return d


@router.post("/damages/{did}/approve")
async def approve_damage(did: int, b: decide_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    _mgr(user, "approve damage")
    d = await _damage(db, did)
    _not_own(d["created_by"], user)
    if b.reason and b.reason not in REASONS:
        raise HTTPException(400, "Unknown damage reason.")
    await db.execute(text("UPDATE mfg_damages SET status = 'APPROVED', reason = COALESCE(:r, reason), decided_by = :u, decided_at = NOW(), "
                          "decision_note = :n WHERE id = :i"), {"r": b.reason, "u": user.user_id, "n": b.note, "i": did})
    await _audit(db, user, "approve_damage", did, d["damage_no"], f"Damage {d['damage_no']} ({stk.d(d['qty']).normalize():f}) approved")
    await db.commit()
    return {"success": True}


@router.post("/damages/{did}/reject")
async def reject_damage(did: int, b: decide_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Not accepted as damage: the material goes back to where it came from and must be re-classified."""
    _mgr(user, "reject a damage claim")
    d = await _damage(db, did)
    if d["source"] == "PRINTING":
        raise HTTPException(400, "Printing damage is confirmed at the receipt inspection; approve it, or change the reason while approving.")
    kw = dict(txn_type="DAMAGE_REVERSAL", product_id=d["product_id"], qty_base=d["qty"], from_store=d["held_store_id"], to_store=d["back_store_id"],
              user_id=user.user_id, brand_id=d["brand_id"], ref_type="damage", ref_id=did, ref_no=d["damage_no"],
              remarks=f"Damage claim rejected: {b.note or ''}")
    if "," in d["batch_no"]:      # damage taken from several WIP batches
        await stk.drain(db, **kw)
    else:
        await stk.post(db, batch_no=d["batch_no"], **kw)
    if d["order_item_id"]:
        await db.execute(text("UPDATE mfg_order_items SET damaged_qty = damaged_qty - :q WHERE id = :i"), {"q": d["qty"], "i": d["order_item_id"]})
    await db.execute(text("UPDATE mfg_damages SET status = 'REJECTED', decided_by = :u, decided_at = NOW(), decision_note = :n WHERE id = :i"),
                     {"u": user.user_id, "n": b.note, "i": did})
    await _audit(db, user, "reject_damage", did, d["damage_no"], f"Damage {d['damage_no']} rejected — material back in production for re-classification")
    await db.commit()
    return {"success": True}


@router.get("/tolerances")
async def tolerances(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT t.*, p.name AS product, m.name AS material FROM mfg_tolerances t LEFT JOIN products p ON p.id = t.product_id
        LEFT JOIN products m ON m.id = t.material_id ORDER BY t.id""")


class tol_in(BaseModel):
    product_id: Optional[int] = None
    material_id: Optional[int] = None
    department: Optional[str] = None
    process: Optional[str] = None
    tolerance_pct: Decimal = Field(ge=0, le=100)
    is_active: bool = True


@router.put("/tolerances")
async def save_tolerances(rows: list[tol_in], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    _mgr(user, "change damage tolerances")
    await db.execute(text("DELETE FROM mfg_tolerances"))
    for t in rows:
        await db.execute(text("""INSERT INTO mfg_tolerances (product_id, material_id, department, process, tolerance_pct, is_active)
            VALUES (:product_id, :material_id, NULLIF(:department, ''), NULLIF(:process, ''), :tolerance_pct, :is_active)"""), t.model_dump())
    await _audit(db, user, "damage_tolerances", 0, "tolerances", f"{len(rows)} damage tolerance rule(s) saved")
    await db.commit()
    return {"success": True}


# ── inward from retail stock / disposal ───────────────────────────────────────
class inward_line(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = None
    batch_no: str = ""
    brand_id: int = 0


class inward_in(BaseModel):
    outlet_id: int
    to_store_id: int
    lines: list[inward_line] = Field(min_length=1)
    grn_ref: Optional[str] = None
    remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/stock/inward")
async def inward(b: inward_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Purchased material received by GRN at an outlet / warehouse moves into a plant store (choose QC / Quarantine when it
    must be inspected first). It leaves the outlet's stock at the same moment, so it is never counted twice."""
    kind = (await db.execute(text("SELECT kind FROM mfg_stores WHERE id = :s AND is_active"), {"s": b.to_store_id})).scalar()
    if kind not in ("RAW", "PACKAGING", "PLAIN_TIN", "PRINTED", "QC"):
        raise HTTPException(400, "Receive into the Raw Material, Packaging, Plain Tin, Printed Tin or QC / Quarantine store.")
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    no = await stk.next_doc(db, "INW")
    for n, ln in enumerate(b.lines):
        q = await stk.to_base(db, ln.product_id, ln.qty, ln.unit)
        have = stk.d((await db.execute(text("SELECT stock_qty FROM outlet_stock WHERE outlet_id = :o AND product_id = :p FOR UPDATE"),
                                       {"o": b.outlet_id, "p": ln.product_id})).scalar())
        if have < q:
            it = await stk.item(db, ln.product_id)
            raise HTTPException(400, f"Outlet has only {have.normalize():f} {it['unit']} of '{it['name']}'; cannot move {q.normalize():f} to the plant.")
        await _update_product_stock(db, ln.product_id, -q, b.outlet_id)
        await _write_stock_ledger(db=db, product_id=ln.product_id, txn_type="mfg_inward", qty=-q, ref_id=0, ref_type="mfg_inward",
                                  outlet_id=b.outlet_id, notes=f"{no} to plant store {kind} {b.grn_ref or ''}", user_id=user.user_id,
                                  batch_no=ln.batch_no or None)
        await stk.post(db, txn_type="INWARD", product_id=ln.product_id, qty_base=q, from_store=None, to_store=b.to_store_id, user_id=user.user_id,
                       batch_no=ln.batch_no, brand_id=ln.brand_id, unit_entered=ln.unit, qty_entered=ln.qty, ref_type="outlet",
                       ref_id=b.outlet_id, ref_no=b.grn_ref or no, doc_no=no, remarks=b.remarks,
                       request_key=None)
    await _audit(db, user, "plant_inward", b.outlet_id, no, f"{no}: {len(b.lines)} item(s) moved from outlet #{b.outlet_id} into plant store")
    await db.commit()
    return {"doc_no": no}


class dispose_in(BaseModel):
    store_id: int
    product_id: int
    qty: Decimal = Field(gt=0)
    batch_no: str = ""
    brand_id: int = 0
    action: str = Field(pattern="^(RETURN_TO_VENDOR|SCRAP_DISPOSAL)$")
    reason: str = Field(min_length=3, max_length=300)


@router.post("/stock/dispose")
async def dispose(b: dispose_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Rejected / scrap stock leaves the plant: returned to the vendor or disposed. Manager / admin only."""
    _mgr(user, "write off rejected or scrap stock")
    kind = (await db.execute(text("SELECT kind FROM mfg_stores WHERE id = :s"), {"s": b.store_id})).scalar()
    if kind not in ("REJECTED", "SCRAP"):
        raise HTTPException(400, "Only Rejected or Scrap store stock can be returned to a vendor or disposed.")
    r = await stk.post(db, txn_type=b.action, product_id=b.product_id, qty_base=b.qty, from_store=b.store_id, to_store=None, user_id=user.user_id,
                       batch_no=b.batch_no, brand_id=b.brand_id, ref_type="disposal", remarks=b.reason)
    await _audit(db, user, b.action.lower(), b.product_id, r["doc_no"], f"{b.action}: {b.qty.normalize():f} of item #{b.product_id} — {b.reason}")
    await db.commit()
    return r


# ── plant dashboard ───────────────────────────────────────────────────────────
@router.get("/plant-dashboard")
async def plant_dashboard(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    from app.routers.mfg_setup import _scope   # a department user sees the stock tiles of their own departments only
    sc = await _scope(db, user)
    by_kind = {r["kind"]: r for r in await _rows(db, """SELECT st.kind, COALESCE(SUM(m.qty), 0) AS qty,
        COALESCE(SUM(m.qty * COALESCE(p.cost_price, 0)), 0) AS value, COUNT(DISTINCT m.product_id) FILTER (WHERE m.qty > 0) AS items
        FROM mfg_stores st LEFT JOIN mfg_stock m ON m.store_id = st.id LEFT JOIN products p ON p.id = m.product_id
        WHERE (CAST(:a AS INT[]) IS NULL OR st.id = ANY(:a)) GROUP BY st.kind""", {"a": sc})}
    one = lambda sql, p=None: _rows(db, sql, p)  # noqa: E731
    today = (await one("""SELECT COALESCE(SUM(good_qty), 0) AS good, COALESCE(SUM(rejected_qty), 0) AS rejected FROM mfg_order_outputs
        WHERE CAST(created_at + INTERVAL '5 hours 30 minutes' AS date) = CAST(NOW() + INTERVAL '5 hours 30 minutes' AS date)"""))[0]
    dmg = (await one("""SELECT COALESCE(SUM(qty), 0) AS qty, COUNT(*) FILTER (WHERE over_tolerance) AS over FROM mfg_damages
        WHERE CAST(created_at + INTERVAL '5 hours 30 minutes' AS date) = CAST(NOW() + INTERVAL '5 hours 30 minutes' AS date)"""))[0]
    prod = {r["status"]: r["n"] for r in await one("SELECT status, COUNT(*) AS n FROM mfg_orders WHERE stock_mode = 'DEPT' GROUP BY 1")}
    so = (await one("""SELECT COUNT(*) FILTER (WHERE so.status IN ('OPEN','PARTIAL')) AS pending,
        COUNT(*) FILTER (WHERE so.status IN ('OPEN','PARTIAL') AND EXISTS (SELECT 1 FROM mfg_handovers h WHERE h.sales_order_id = so.id
            AND h.qty - h.dispatched_qty - h.returned_qty > 0)) AS ready_billing,
        COUNT(*) FILTER (WHERE so.status IN ('OPEN','PARTIAL') AND so.delivery_date < CURRENT_DATE) AS overdue
        FROM mfg_sales_orders so"""))[0]
    approvals = (await one("""SELECT (SELECT COUNT(*) FROM mfg_print_jobs WHERE status = 'PENDING_APPROVAL') AS print_jobs,
        (SELECT COUNT(*) FROM mfg_transfers WHERE status = 'PENDING') AS transfers,
        (SELECT COUNT(*) FROM mfg_sales_orders WHERE status = 'PENDING_APPROVAL') AS customer_orders,
        (SELECT COUNT(*) FROM mfg_damages WHERE status = 'PENDING') AS damages,
        (SELECT COUNT(*) FROM mfg_orders WHERE stock_mode = 'DEPT' AND status = 'DRAFT') AS production_orders,
        (SELECT COUNT(*) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.stock_mode = 'DEPT'
            AND x.qc_status IN ('PENDING','REWORK')) AS fg_qc,
        (SELECT COUNT(*) FROM mfg_print_jobs WHERE status IN ('ISSUED','PARTIAL') AND expected_return < CURRENT_DATE) AS overdue_printing"""))[0]
    printing = (await one("""SELECT COUNT(*) AS jobs, COALESCE(SUM(qty_issued - accepted_qty - rejected_qty - damaged_qty - lost_qty - returned_qty), 0) AS pending
        FROM mfg_print_jobs WHERE status IN ('ISSUED','PARTIAL')"""))[0]
    from app.services import mfg_planning
    plan = await mfg_planning.open_orders(db)
    lines = [l for o in plan for l in o["lines"]]
    low = (await one("""SELECT COUNT(*) AS n FROM products p WHERE p.item_type IN ('RM','PM') AND COALESCE(p.is_active, TRUE)
        AND COALESCE(p.reorder_level, p.min_stock, 0) > 0 AND COALESCE((SELECT SUM(m.qty) FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id
            WHERE m.product_id = p.id AND st.usable AND NOT st.is_wip), 0) < COALESCE(p.reorder_level, p.min_stock)"""))[0]
    grn = (await one("SELECT COUNT(*) AS n FROM unit_wise_purchases WHERE status = 'draft'"))[0]
    planning = {
        "open_orders": len(plan), "ready": sum(1 for o in plan if (o.get("overall") or {}).get("color") == "GREEN"),
        "with_shortage": sum(1 for o in plan if (o.get("overall") or {}).get("color") != "GREEN"), "blocked": sum(1 for o in plan if (o.get("overall") or {}).get("color") == "RED"),
        "rm_short": len({l["product_id"] for l in lines if l["item_type"] == "RM" and l["shortage"] > 0}),
        "pm_short": len({l["product_id"] for l in lines if l["item_type"] == "PM" and l["shortage"] > 0}),
        "awaiting_purchase": sum(1 for l in lines if l["purchase_suggested"] > 0 or l["status"] == "Awaiting Purchase"),
        "awaiting_transfer": sum(1 for l in lines if l["transfer_suggested"] > 0), "low_stock": low["n"], "pending_grn": grn["n"],
        "pending_transfers": approvals["transfers"],
    }
    k = lambda kind: float(by_kind.get(kind, {}).get("qty", 0))  # noqa: E731
    good, rej = float(today["good"]), float(today["rejected"])
    return {
        "stock": {kind: {"qty": float(v["qty"]), "value": float(v["value"]), "items": v["items"]} for kind, v in by_kind.items()},
        "cards": {
            "raw_material": k("RAW"), "packaging": k("PACKAGING"), "plain_tin": k("PLAIN_TIN"), "printing_wip": k("PRINTING_WIP"),
            "printing_jobs_open": printing["jobs"], "printing_pending": float(printing["pending"]), "printed_tin": k("PRINTED"),
            "production_pending": sum(prod.get(s, 0) for s in ("DRAFT", "APPROVED", "READY", "MATERIAL_SHORTAGE")),
            "production_in_progress": sum(prod.get(s, 0) for s in ("IN_PRODUCTION", "AWAITING_QC", "PARTIALLY_COMPLETED")),
            "material_shortages": prod.get("MATERIAL_SHORTAGE", 0), "today_good": good, "today_rejected": rej,
            "today_damage": float(dmg["qty"]), "today_over_tolerance": dmg["over"],
            "today_efficiency": round(good / (good + rej + float(dmg["qty"])) * 100, 2) if good + rej + float(dmg["qty"]) else None,
            "finished_goods": k("FINISHED"), "qc_pending": k("QC"), "rejected": k("REJECTED"), "scrap": k("SCRAP"), "production_wip": k("PRODUCTION_WIP"),
            "orders_pending": so["pending"], "orders_ready_billing": so["ready_billing"], "orders_overdue": so["overdue"], "dispatch_store": k("DISPATCH"),
        },
        "approvals": approvals,
        "planning": planning,
    }


# ── production release & variance reasons ─────────────────────────────────────
class release_in(BaseModel):
    override_reason: Optional[str] = Field(None, max_length=300)


async def _readiness(db, oid: int) -> dict:
    from app.services import mfg_planning
    o = dict(await _order(db, oid))
    bom = (await db.execute(text("SELECT * FROM mfg_boms WHERE id = :b"), {"b": o["bom_id"]})).mappings().first()
    problems = []
    today = stk.today()
    if not bom or bom["status"] != "APPROVED":
        problems.append("BOM is not approved")
    elif (bom["valid_from"] and bom["valid_from"] > today) or (bom["valid_to"] and bom["valid_to"] < today):
        problems.append(f"BOM {bom['bom_no']} r{bom['revision']} is not valid today ({bom['valid_from']} - {bom['valid_to'] or 'open'})")
    comps = [{"product_id": r["product_id"], "item_code": r["item_code"], "item": r["name"], "item_type": r["item_type"], "material_type": r["material_type"],
              "unit": r["unit"], "required": stk.d(r["required_qty"]), "theoretical": stk.d(r["required_qty"]), "brand_id": r["brand_id"],
              "cost": stk.d(r["cost_per_unit"])}
             for r in (await db.execute(text("""SELECT i.*, p.name, p.item_code, p.item_type FROM mfg_order_items i JOIN products p ON p.id = i.product_id
                 WHERE i.mfg_order_id = :o ORDER BY i.id"""), {"o": oid})).mappings()]
    if not comps:
        problems.append("Order has no materials")
    for c in comps:
        try:
            await stk.factor(db, c["product_id"], c["unit"])
        except HTTPException as e:
            problems.append(f"{c['item']}: {e.detail}")
    lines = await mfg_planning.check(db, comps, o)
    for ln in lines:
        if ln["status"] != "Available":
            problems.append(f"{ln['item']}: {ln['status']} - short {ln['shortage'].normalize():f} {ln['unit']}")
    return {"order_no": o["order_no"], "ready": not problems, "problems": problems, "lines": lines,
            "overall": mfg_planning.overall(lines) if lines else None, "released_at": o["released_at"],
            "override_reason": o["release_override_reason"]}


@router.get("/prod/orders/{oid}/readiness")
async def readiness(oid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _readiness(db, oid)


@router.post("/prod/orders/{oid}/production-release")
async def release(oid: int, b: release_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Release for production after the readiness check. A shortage can be overridden only with the override permission and a reason."""
    o = await _order(db, oid, lock=True)
    if o["status"] == "DRAFT":
        raise HTTPException(400, f"{o['order_no']} is a draft - approve it first.")
    if o["status"] in ("COMPLETED", "CANCELLED"):
        raise HTTPException(400, f"{o['order_no']} is {o['status'].lower()}.")
    if o["released_at"]:
        raise HTTPException(400, f"{o['order_no']} is already released.")
    r = await _readiness(db, oid)
    if not r["ready"]:
        if not b.override_reason:
            raise HTTPException(400, "Not ready for production: " + "; ".join(r["problems"]))
        perms = {"manufacturing.override"} if user.role in ADMIN else await access.effective_permissions(db, user.user_id, user.role, user.role_id)
        if "manufacturing.override" not in perms:
            raise HTTPException(403, "You do not have permission to override a production shortage.")
        bom_issues = [p for p in r["problems"] if p.startswith("BOM")]
        if bom_issues:
            raise HTTPException(400, "A BOM problem cannot be overridden: " + "; ".join(bom_issues))
    await db.execute(text("UPDATE mfg_orders SET released_at = NOW(), released_by = :u, release_override_reason = :r WHERE id = :i"),
                     {"u": user.user_id, "r": None if r["ready"] else b.override_reason, "i": oid})
    note = " - all materials available" if r["ready"] else f" WITH SHORTAGE OVERRIDE: {b.override_reason} | " + "; ".join(r["problems"])
    await _audit(db, user, "production_release" if r["ready"] else "production_release_override", oid, o["order_no"], f"{o['order_no']} released{note}")
    await db.commit()
    return {"released": True, "override": not r["ready"]}


class variance_line(BaseModel):
    order_item_id: int
    reason: str = Field("", max_length=300)


@router.put("/prod/orders/{oid}/variance-reasons")
async def variance_reasons(oid: int, rows: list[variance_line], db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    o = await _order(db, oid)
    for r in rows:
        await db.execute(text("UPDATE mfg_order_items SET variance_reason = :r WHERE id = :i AND mfg_order_id = :o"),
                         {"r": r.reason or None, "i": r.order_item_id, "o": oid})
    await _audit(db, user, "variance_reasons", oid, o["order_no"], f"{o['order_no']}: {len(rows)} variance reason(s) recorded")
    await db.commit()
    return {"success": True}
