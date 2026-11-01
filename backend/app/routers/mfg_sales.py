"""Manufacturing Phase D: customer orders (own brand and contract manufacturing), finished-goods reservations,
store handover to Billing / Dispatch, dispatch.

Stock rule: reservation never moves stock; handover moves Finished Goods -> Billing / Dispatch store; the DISPATCH
posting is the single event that takes goods out of the plant (invoice / challan / e-way details are recorded on it),
so billing and dispatch can never deduct the same tins twice. Own-brand goods can be dispatched into a retail outlet's
stock, where the existing billing (POS / invoices) sells them.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.routers.mfg_setup import ADMIN, _audit, _rows
from app.services import mfg_stock_service as stk
from app.services.billing_service import _update_product_stock, _write_stock_ledger

router = APIRouter(prefix="/manufacturing/sales-orders", tags=["manufacturing customer orders"])
D0 = Decimal(0)

METRICS = """
  COALESCE((SELECT SUM(o.planned_qty) FROM mfg_orders o WHERE o.sales_order_id = so.id AND o.status <> 'CANCELLED'), 0) AS production_qty,
  COALESCE((SELECT SUM(o.completed_qty) FROM mfg_orders o WHERE o.sales_order_id = so.id AND o.status <> 'CANCELLED'), 0) AS finished_qty,
  COALESCE((SELECT SUM(x.approved_qty) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.sales_order_id = so.id), 0) AS qc_approved_qty,
  COALESCE((SELECT SUM(r.qty) FROM mfg_fg_reservations r WHERE r.sales_order_id = so.id), 0) AS reserved_qty,
  COALESCE((SELECT SUM(h.qty - h.returned_qty) FROM mfg_handovers h WHERE h.sales_order_id = so.id), 0) AS issued_qty,
  COALESCE((SELECT SUM(d.qty) FROM mfg_dispatches d WHERE d.sales_order_id = so.id AND d.invoice_no IS NOT NULL), 0) AS billed_qty,
  COALESCE((SELECT SUM(d.qty) FROM mfg_dispatches d WHERE d.sales_order_id = so.id), 0) AS dispatched_qty"""


def _cart(r: dict):
    upc = int(r["units_per_carton"])
    for k in ("ordered_qty", "reserved_qty", "issued_qty", "billed_qty", "dispatched_qty", "qc_approved_qty", "finished_qty"):
        c = stk.cartons(r[k], upc)
        r[k.replace("_qty", "_cartons")], r[k.replace("_qty", "_loose")] = c["cartons"], float(c["loose"])
    r["pending_qty"] = float(stk.d(r["ordered_qty"]) - stk.d(r["dispatched_qty"]))
    r["ready_for_billing_qty"] = float(stk.d(r["issued_qty"]) - stk.d(r["dispatched_qty"]))
    r["pending_production_qty"] = float(max(stk.d(r["ordered_qty"]) - stk.d(r["qc_approved_qty"]), D0))
    c = stk.cartons(r["pending_qty"], upc)
    r["pending_cartons"], r["pending_loose"] = c["cartons"], float(c["loose"])
    return r


async def _list(db, where: str, p: dict):
    rows = await _rows(db, f"""SELECT so.*, b.name AS brand, b.code AS brand_code, b.is_own_brand, c.name AS customer, c.gst_number,
        p.name AS product, p.item_code, UPPER(COALESCE(p.unit, 'PCS')) AS unit, s.spec_code, s.revision AS spec_rev, s.cap_colour, s.tin_size,
        ta.code AS artwork_code, ta.revision AS artwork_rev, {METRICS}
        FROM mfg_sales_orders so JOIN mfg_brands b ON b.id = so.brand_id LEFT JOIN customers c ON c.id = so.customer_id
        JOIN products p ON p.id = so.product_id LEFT JOIN mfg_pack_specs s ON s.id = so.spec_id LEFT JOIN mfg_artworks ta ON ta.id = s.tin_artwork_id
        WHERE {where} ORDER BY so.id DESC LIMIT 500""", p)
    return [_cart(r) for r in rows]


async def _so(db, sid, lock=False) -> dict:
    so = (await db.execute(text("SELECT * FROM mfg_sales_orders WHERE id = :i" + (" FOR UPDATE" if lock else "")), {"i": sid})).mappings().first()
    if not so:
        raise HTTPException(404, "Customer order not found")
    m = (await _list(db, "so.id = :i", {"i": sid}))[0]
    return {**dict(so), **m}


@router.get("")
async def list_orders(status: Optional[str] = None, search: str = "", db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _list(db, """(CAST(:s AS TEXT) IS NULL OR so.status = :s)
        AND (:q = '%%' OR so.so_no ILIKE :q OR so.customer_po_no ILIKE :q OR c.name ILIKE :q OR b.name ILIKE :q OR p.name ILIKE :q)""",
                       {"s": status, "q": f"%{search.strip()}%"})


async def free_fg(db, product_id: int, brand_id: int) -> list[dict]:
    """Finished Goods store stock by batch, less what is reserved for any order (oldest batch first)."""
    return await _rows(db, """SELECT m.batch_no, m.qty, m.qty - COALESCE(r.res, 0) AS free,
        (SELECT MIN(t.posted_at) FROM mfg_stock_txns t WHERE t.to_store_id = m.store_id AND t.product_id = m.product_id
            AND t.batch_no = m.batch_no AND t.brand_id = m.brand_id) AS since,
        (SELECT MAX(x.exp_date) FROM mfg_order_outputs x WHERE x.batch_no = m.batch_no AND x.product_id = m.product_id) AS exp_date
        FROM mfg_stock m LEFT JOIN (SELECT batch_no, SUM(qty) AS res FROM mfg_fg_reservations WHERE store_id = :fgs AND product_id = :p
            AND brand_id = :b GROUP BY 1) r ON r.batch_no = m.batch_no
        WHERE m.store_id = :fgs AND m.product_id = :p AND m.brand_id = :b AND m.qty > 0 ORDER BY exp_date NULLS LAST, since, m.batch_no""",
                       {"fgs": await stk.store(db, "FGS"), "p": product_id, "b": brand_id})


@router.get("/customer-ledger")
async def customer_ledger(customer_id: Optional[int] = None, from_date: Optional[date] = None, to_date: Optional[date] = None,
                          db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Customer-wise ledger: what each customer ordered, what was made, what was lost and where, what was handed over and dispatched."""
    orders = await _rows(db, f"""SELECT so.id, so.so_no, so.so_date, so.delivery_date, so.status, so.customer_po_no, so.units_per_carton, so.ordered_qty,
        so.customer_id, c.name AS customer, b.name AS brand, p.item_code, p.name AS product, UPPER(COALESCE(p.unit, 'PCS')) AS unit,
        COALESCE((SELECT SUM(o.planned_qty) FROM mfg_orders o WHERE o.sales_order_id = so.id AND o.status <> 'CANCELLED'), 0) AS planned_qty,
        COALESCE((SELECT SUM(x.good_qty) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.sales_order_id = so.id), 0) AS made_qty,
        COALESCE((SELECT SUM(x.rejected_qty + x.scrap_qty) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.sales_order_id = so.id), 0) AS rejected_qty,
        COALESCE((SELECT SUM(x.approved_qty) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.sales_order_id = so.id), 0) AS qc_approved_qty,
        COALESCE((SELECT SUM(x.qc_rejected_qty) FROM mfg_order_outputs x JOIN mfg_orders o ON o.id = x.mfg_order_id WHERE o.sales_order_id = so.id), 0) AS qc_rejected_qty,
        COALESCE((SELECT SUM(d.base_qty) FROM mfg_damages d JOIN mfg_orders o ON o.id = d.mfg_order_id WHERE o.sales_order_id = so.id AND d.status <> 'REJECTED'), 0) AS damaged_qty,
        COALESCE((SELECT SUM(h.qty) FROM mfg_handovers h WHERE h.sales_order_id = so.id), 0) AS handed_qty,
        COALESCE((SELECT SUM(h.returned_qty) FROM mfg_handovers h WHERE h.sales_order_id = so.id), 0) AS returned_qty,
        COALESCE((SELECT SUM(d.qty) FROM mfg_dispatches d WHERE d.sales_order_id = so.id), 0) AS dispatched_qty,
        (SELECT string_agg(o.order_no, ', ') FROM mfg_orders o WHERE o.sales_order_id = so.id AND o.status <> 'CANCELLED') AS production_orders
        FROM mfg_sales_orders so JOIN mfg_brands b ON b.id = so.brand_id LEFT JOIN customers c ON c.id = so.customer_id JOIN products p ON p.id = so.product_id
        WHERE (CAST(:c AS INT) IS NULL OR so.customer_id = :c) AND (CAST(:fd AS DATE) IS NULL OR so.so_date >= :fd) AND (CAST(:td AS DATE) IS NULL OR so.so_date <= :td)
        ORDER BY c.name, so.id""", {"c": customer_id, "fd": from_date, "td": to_date})
    ids = [o["id"] for o in orders]
    damages = await _rows(db, """SELECT o.sales_order_id, d.damage_no, d.stage, d.department, d.reason, d.base_qty AS qty, d.status, d.batch_no, o.order_no,
        TO_CHAR(d.created_at, 'DD Mon YYYY HH24:MI') AS recorded, d.remarks FROM mfg_damages d JOIN mfg_orders o ON o.id = d.mfg_order_id
        WHERE o.sales_order_id = ANY(:i) ORDER BY d.id""", {"i": ids})
    disp = await _rows(db, """SELECT d.sales_order_id, d.dispatch_no, d.dispatch_date, d.qty, d.invoice_no, d.challan_no, d.eway_bill, d.vehicle_no, d.transporter, d.ack_status
        FROM mfg_dispatches d WHERE d.sales_order_id = ANY(:i) ORDER BY d.id""", {"i": ids})
    for o in orders:
        D = stk.d
        o["to_make"] = float(max(D(o["ordered_qty"]) - D(o["made_qty"]), D0))
        o["lost_qty"] = float(D(o["rejected_qty"]) + D(o["damaged_qty"]) + D(o["qc_rejected_qty"]))
        o["in_dispatch_qty"] = float(D(o["handed_qty"]) - D(o["returned_qty"]) - D(o["dispatched_qty"]))
        o["pending_qty"] = float(D(o["ordered_qty"]) - D(o["dispatched_qty"]))
        o["shortfall_qty"] = float(max(D(o["ordered_qty"]) - D(o["qc_approved_qty"]), D0))
        why = []
        if o["to_make"] > 0:
            why.append(f"{o['to_make']:g} not yet made")
        for d in damages:
            if d["sales_order_id"] == o["id"] and d["status"] != "REJECTED":
                why.append(f"{d['qty']:g} damaged in {d['stage'] or d['department'] or 'production'} ({d['reason'] or 'no reason'}) - {d['damage_no']}")
        if o["rejected_qty"] > 0:
            why.append(f"{o['rejected_qty']:g} rejected / scrap at production")
        if o["qc_rejected_qty"] > 0:
            why.append(f"{o['qc_rejected_qty']:g} rejected at QC")
        if o["in_dispatch_qty"] > 0:
            why.append(f"{o['in_dispatch_qty']:g} in Billing / Dispatch, not yet dispatched")
        if o["qc_approved_qty"] > o["handed_qty"]:
            why.append(f"{o['qc_approved_qty'] - o['handed_qty']:g} approved but not yet issued to dispatch")
        o["why"] = why
        o["so_date"], o["delivery_date"] = str(o["so_date"]), str(o["delivery_date"] or "")
    for d in disp:
        d["dispatch_date"] = str(d["dispatch_date"])
    return {"orders": orders, "damages": damages, "dispatches": disp}


@router.get("/po-group")
async def po_group(customer_po_no: str, customer_id: Optional[int] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Every item of one customer PO with its progress."""
    return await _list(db, "so.customer_po_no = :po AND (CAST(:c AS INT) IS NULL OR so.customer_id = :c)", {"po": customer_po_no, "c": customer_id})


@router.get("/{sid}")
async def get_order(sid: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    so = await _so(db, sid)
    so["reservations"] = await _rows(db, "SELECT * FROM mfg_fg_reservations WHERE sales_order_id = :i AND qty > 0 ORDER BY id", {"i": sid})
    so["handovers"] = await _rows(db, """SELECT h.*, u.name AS issued_by_name, TO_CHAR(h.issued_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS issued
        FROM mfg_handovers h LEFT JOIN users u ON u.id = h.issued_by WHERE h.sales_order_id = :i ORDER BY h.id""", {"i": sid})
    so["dispatches"] = await _rows(db, """SELECT d.*, h.handover_no, h.batch_no, o.outlet_name, u.name AS created_by_name FROM mfg_dispatches d
        JOIN mfg_handovers h ON h.id = d.handover_id LEFT JOIN outlets o ON o.id = d.to_outlet_id LEFT JOIN users u ON u.id = d.created_by
        WHERE d.sales_order_id = :i ORDER BY d.id""", {"i": sid})
    so["production_orders"] = await _rows(db, """SELECT o.id, o.order_no, o.status, o.planned_qty, o.completed_qty,
        (SELECT COALESCE(SUM(approved_qty), 0) FROM mfg_order_outputs x WHERE x.mfg_order_id = o.id) AS approved_qty
        FROM mfg_orders o WHERE o.sales_order_id = :i ORDER BY o.id""", {"i": sid})
    so["print_jobs"] = await _rows(db, """SELECT id, job_no, status, qty_issued, accepted_qty, rejected_qty, damaged_qty FROM mfg_print_jobs
        WHERE sales_order_id = :i ORDER BY id""", {"i": sid})
    so["fg_stock"] = await free_fg(db, so["product_id"], so["brand_id"])
    return so


class so_in(BaseModel):
    spec_id: Optional[int] = None
    brand_id: Optional[int] = None
    product_id: Optional[int] = None
    customer_id: Optional[int] = None
    units_per_carton: Optional[int] = Field(None, ge=1)
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = "CTN"
    customer_po_no: Optional[str] = None
    customer_item_code: Optional[str] = None
    delivery_date: Optional[date] = None
    priority: str = "NORMAL"
    billing_requirement: Optional[str] = None
    dispatch_instructions: Optional[str] = None
    remarks: Optional[str] = None


async def _create(db, b: so_in, user) -> dict:
    """One customer-order line (one product). Does not commit - the caller does, so a multi-item PO is saved all-or-nothing."""
    if b.spec_id:
        sp = (await db.execute(text("SELECT * FROM mfg_pack_specs WHERE id = :s"), {"s": b.spec_id})).mappings().first()
        if not sp or sp["status"] != "APPROVED":
            raise HTTPException(400, "Choose an APPROVED packaging spec.")
        brand_id, product_id, upc = sp["brand_id"], sp["product_id"], b.units_per_carton or sp["units_per_carton"]
        if b.units_per_carton and b.units_per_carton != sp["units_per_carton"]:
            raise HTTPException(400, f"The packaging spec packs {sp['units_per_carton']} per carton — a different carton size needs its own spec.")
        item_code = b.customer_item_code or sp["customer_item_code"]
    else:
        if not (b.brand_id and b.product_id and b.units_per_carton):
            raise HTTPException(400, "Choose a packaging spec, or give brand, product and units per carton.")
        brand_id, product_id, upc, item_code = b.brand_id, b.product_id, b.units_per_carton, b.customer_item_code
    brand = (await db.execute(text("SELECT * FROM mfg_brands WHERE id = :b AND is_active"), {"b": brand_id})).mappings().first()
    if not brand:
        raise HTTPException(400, "The brand is inactive.")
    customer = brand["customer_id"] or b.customer_id
    if brand["customer_id"] and b.customer_id and b.customer_id != brand["customer_id"]:
        raise HTTPException(400, "This brand belongs to another customer.")
    if b.priority not in ("LOW", "NORMAL", "HIGH", "URGENT"):
        raise HTTPException(400, "Priority must be LOW, NORMAL, HIGH or URGENT.")
    qty = await stk.to_base(db, product_id, b.qty, b.unit, upc)
    no = await stk.next_doc(db, "SO")
    sid = (await db.execute(text("""INSERT INTO mfg_sales_orders (so_no, so_date, customer_id, brand_id, spec_id, product_id, customer_po_no, customer_item_code,
        units_per_carton, ordered_cartons, ordered_qty, delivery_date, priority, billing_requirement, dispatch_instructions, remarks, created_by, status)
        VALUES (:no, :day, :c, :b, :s, :p, :po, :ic, :upc, :ctn, :q, :dd, :pr, :br, :di, :rm, :u, 'PENDING_APPROVAL') RETURNING id"""),
        {"no": no, "day": stk.today(), "c": customer, "b": brand_id, "s": b.spec_id, "p": product_id, "po": b.customer_po_no, "ic": item_code, "upc": upc,
         "ctn": qty / upc, "q": qty, "dd": b.delivery_date, "pr": b.priority, "br": b.billing_requirement, "di": b.dispatch_instructions,
         "rm": b.remarks, "u": user.user_id})).scalar()
    c = stk.cartons(qty, upc)
    await _audit(db, user, "create_customer_order", sid, no, f"Customer order {no}: {c['cartons']} carton(s) + {c['loose'].normalize():f} "
                 f"@ {upc} = {qty.normalize():f} for {brand['name']}")
    return {"id": sid, "so_no": no, "ordered_qty": float(qty), "customer_id": customer}


@router.post("")
async def create_order(b: so_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    r = await _create(db, b, user)
    await db.commit()
    return r


class po_line(BaseModel):
    spec_id: int
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = "CTN"
    customer_item_code: Optional[str] = None
    delivery_date: Optional[date] = None
    remarks: Optional[str] = None


class po_in(BaseModel):
    customer_po_no: Optional[str] = None
    delivery_date: Optional[date] = None
    priority: str = "NORMAL"
    billing_requirement: Optional[str] = None
    dispatch_instructions: Optional[str] = None
    lines: list[po_line] = Field(min_length=1, max_length=100)


@router.post("/multi")
async def create_po(b: po_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """One customer PO with several items: one customer order per item (each is produced, reserved and dispatched on its own),
    all carrying the same customer PO number so they are shown, printed and invoiced together."""
    if len(b.lines) > 1 and not (b.customer_po_no or "").strip():
        raise HTTPException(400, "Enter the customer PO number - it is what ties the items of one PO together.")
    if len({l.spec_id for l in b.lines}) != len(b.lines):
        raise HTTPException(400, "The same packaging spec is on two lines - put the total quantity on one line.")
    made = []
    for l in b.lines:
        made.append(await _create(db, so_in(spec_id=l.spec_id, qty=l.qty, unit=l.unit, customer_po_no=(b.customer_po_no or "").strip() or None,
                                            customer_item_code=l.customer_item_code, delivery_date=l.delivery_date or b.delivery_date, priority=b.priority,
                                            billing_requirement=b.billing_requirement, dispatch_instructions=b.dispatch_instructions, remarks=l.remarks), user))
    if len({m["customer_id"] for m in made}) > 1:
        raise HTTPException(400, "All items of one PO must belong to the same customer.")
    await db.commit()
    return {"orders": made, "ids": [m["id"] for m in made], "so_nos": [m["so_no"] for m in made]}



class qty_in(BaseModel):
    qty: Optional[Decimal] = Field(None, gt=0)
    unit: Optional[str] = None


async def _need(so) -> Decimal:
    """Still to hand over, net of what is already reserved."""
    return stk.d(so["ordered_qty"]) - stk.d(so["issued_qty"]) - stk.d(so["reserved_qty"])


@router.post("/{sid}/reserve")
async def reserve(sid: int, b: qty_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Earmark free approved finished goods (same product AND brand) for this order. Physical stock does not move."""
    so = await _so(db, sid, lock=True)
    if so["status"] not in ("OPEN", "PARTIAL"):
        raise HTTPException(400, f"Order is {so['status'].lower()}.")
    await db.execute(text("SELECT pg_advisory_xact_lock(7002, :p)"), {"p": so["product_id"]})
    need = await _need(so)
    want = min(await stk.to_base(db, so["product_id"], b.qty, b.unit, so["units_per_carton"]), need) if b.qty else need
    if want <= 0:
        raise HTTPException(400, "Nothing left to reserve on this order.")
    fgs, got = await stk.store(db, "FGS"), D0
    for r in await free_fg(db, so["product_id"], so["brand_id"]):
        take = min(stk.d(r["free"]), want - got)
        if take <= 0:
            continue
        await db.execute(text("""INSERT INTO mfg_fg_reservations (sales_order_id, store_id, product_id, batch_no, brand_id, qty, created_by)
            VALUES (:s, :st, :p, :b, :br, :q, :u)"""), {"s": sid, "st": fgs, "p": so["product_id"], "b": r["batch_no"], "br": so["brand_id"],
                                                        "q": take, "u": user.user_id})
        got += take
    if got == 0:
        raise HTTPException(400, "No free approved finished goods of this product and brand. Other customers' stock is never reserved.")
    await _audit(db, user, "reserve_fg", sid, so["so_no"], f"{so['so_no']}: reserved {got.normalize():f} of {want.normalize():f}")
    await db.commit()
    return {"reserved": float(got), "short": float(want - got)}


@router.post("/{sid}/release")
async def release(sid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    so = await _so(db, sid, lock=True)
    await db.execute(text("UPDATE mfg_fg_reservations SET qty = 0 WHERE sales_order_id = :i"), {"i": sid})
    await _audit(db, user, "release_fg", sid, so["so_no"], f"{so['so_no']}: reservations released")
    await db.commit()
    return {"success": True}


class handover_in(BaseModel):
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = "CTN"
    received_by: str = Field(min_length=2, max_length=100)
    remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/{sid}/handover")
async def handover(sid: int, b: handover_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Store issue / pick list: Finished Goods -> Billing / Dispatch. Uses this order's reservation first, then free stock."""
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    so = await _so(db, sid, lock=True)
    if so["status"] not in ("OPEN", "PARTIAL"):
        raise HTTPException(400, f"Order is {so['status'].lower()}.")
    await db.execute(text("SELECT pg_advisory_xact_lock(7002, :p)"), {"p": so["product_id"]})
    q = await stk.to_base(db, so["product_id"], b.qty, b.unit, so["units_per_carton"])
    left = stk.d(so["ordered_qty"]) - stk.d(so["issued_qty"])
    if q > left:
        raise HTTPException(400, f"Only {left.normalize():f} of this order is still to be issued; you entered {q.normalize():f}.")
    fgs, dsp = await stk.store(db, "FGS"), await stk.store(db, "DSP")
    mine = {r["batch_no"]: r for r in await _rows(db, "SELECT batch_no, SUM(qty) AS qty FROM mfg_fg_reservations WHERE sales_order_id = :i AND qty > 0 GROUP BY 1",
                                                  {"i": sid})}
    plan, got = [], D0
    stock = await free_fg(db, so["product_id"], so["brand_id"])
    for own_first in (True, False):
        for r in stock:
            avail = stk.d(mine[r["batch_no"]]["qty"]) if own_first and r["batch_no"] in mine else (D0 if own_first else stk.d(r["free"]))
            take = min(avail, q - got)
            if take > 0:
                plan.append((r["batch_no"], take))
                got += take
    if got < q:
        raise HTTPException(400, f"Only {got.normalize():f} approved finished goods are available for this order (the rest is reserved for other "
                                 f"orders or not yet QC-approved); requested {q.normalize():f}.")
    no = await stk.next_doc(db, "HND")
    for batch, qty in plan:
        await stk.post(db, txn_type="HANDOVER", product_id=so["product_id"], qty_base=qty, from_store=fgs, to_store=dsp, user_id=user.user_id,
                       batch_no=batch, brand_id=so["brand_id"], unit_entered=b.unit, qty_entered=b.qty, ref_type="sales_order", ref_id=sid,
                       ref_no=so["so_no"], doc_no=no, remarks=f"Received by {b.received_by}. {b.remarks or ''}")
        await db.execute(text("""INSERT INTO mfg_handovers (handover_no, sales_order_id, product_id, batch_no, brand_id, qty, from_store_id, to_store_id,
            received_by, remarks, issued_by) VALUES (:no, :s, :p, :b, :br, :q, :f, :t, :rb, :rm, :u)"""),
            {"no": no, "s": sid, "p": so["product_id"], "b": batch, "br": so["brand_id"], "q": qty, "f": fgs, "t": dsp, "rb": b.received_by,
             "rm": b.remarks, "u": user.user_id})
    # consume this order's reservations on the batches handed over
    for batch, qty in plan:
        for r in (await db.execute(text("SELECT id, qty FROM mfg_fg_reservations WHERE sales_order_id = :s AND batch_no = :b AND qty > 0 ORDER BY id FOR UPDATE"),
                                   {"s": sid, "b": batch})).mappings().all():
            use = min(stk.d(r["qty"]), qty)
            await db.execute(text("UPDATE mfg_fg_reservations SET qty = qty - :q WHERE id = :i"), {"q": use, "i": r["id"]})
            qty -= use
            if qty <= 0:
                break
    c = stk.cartons(q, so["units_per_carton"])
    await _audit(db, user, "fg_handover", sid, no, f"{no} for {so['so_no']}: {c['cartons']} ctn + {c['loose'].normalize():f} = {q.normalize():f} "
                 f"handed to {b.received_by}")
    await db.commit()
    return {"handover_no": no, "qty": float(q), "cartons": c["cartons"], "loose": float(c["loose"]),
            "pending_qty": float(left - q)}


class link_in(BaseModel):
    received_by: str = Field(min_length=2, max_length=100)
    remarks: Optional[str] = None


@router.post("/{sid}/link-dispatch-stock")
async def link_dispatch_stock(sid: int, b: link_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Stock already sitting in Billing / Dispatch (moved by a department transfer) is linked to this order as a handover.
    No stock moves - only the link is recorded - and only quantity not already linked to an order is used."""
    so = await _so(db, sid, lock=True)
    if so["status"] not in ("OPEN", "PARTIAL"):
        raise HTTPException(400, f"Order is {so['status'].lower()}.")
    await db.execute(text("SELECT pg_advisory_xact_lock(7002, :p)"), {"p": so["product_id"]})
    fgs, dsp = await stk.store(db, "FGS"), await stk.store(db, "DSP")
    left = stk.d(so["ordered_qty"]) - stk.d(so["issued_qty"])
    rows = await _rows(db, """SELECT m.batch_no, m.qty - COALESCE((SELECT SUM(h.qty - h.dispatched_qty - h.returned_qty) FROM mfg_handovers h
            WHERE h.product_id = m.product_id AND h.batch_no = m.batch_no AND h.brand_id = m.brand_id AND h.to_store_id = m.store_id), 0) AS free
        FROM mfg_stock m WHERE m.store_id = :d AND m.product_id = :p AND m.brand_id = :b AND m.qty > 0 ORDER BY m.batch_no""",
                       {"d": dsp, "p": so["product_id"], "b": so["brand_id"]})
    no, got = await stk.next_doc(db, "HND"), D0
    for r in rows:
        take = min(stk.d(r["free"]), left - got)
        if take <= 0:
            continue
        await db.execute(text("""INSERT INTO mfg_handovers (handover_no, sales_order_id, product_id, batch_no, brand_id, qty, from_store_id, to_store_id,
            received_by, remarks, issued_by) VALUES (:no, :s, :p, :b, :br, :q, :f, :t, :rb, :rm, :u)"""),
            {"no": no, "s": sid, "p": so["product_id"], "b": r["batch_no"], "br": so["brand_id"], "q": take, "f": fgs, "t": dsp,
             "rb": b.received_by, "rm": b.remarks or "Linked from stock already in Billing / Dispatch", "u": user.user_id})
        got += take
    if got <= 0:
        raise HTTPException(400, "There is no unlinked stock of this item and brand in Billing / Dispatch.")
    await _audit(db, user, "fg_link_dispatch", sid, no, f"{no} for {so['so_no']}: {got.normalize():f} already in Billing / Dispatch linked to the order")
    await db.commit()
    return {"handover_no": no, "qty": float(got)}


class dispatch_in(BaseModel):
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = "CTN"
    invoice_no: Optional[str] = None
    challan_no: Optional[str] = None
    eway_bill: Optional[str] = None
    vehicle_no: Optional[str] = None
    transporter: Optional[str] = None
    lr_no: Optional[str] = None
    dispatch_date: Optional[date] = None
    to_outlet_id: Optional[int] = None
    remarks: Optional[str] = None
    request_key: Optional[str] = Field(None, max_length=60)


@router.post("/{sid}/dispatch")
async def dispatch(sid: int, b: dispatch_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """The one posting that takes goods out of the plant (Billing / Dispatch store). Only what was handed over can go."""
    if not await stk.once(db, b.request_key):
        return {"duplicate": True}
    so = await _so(db, sid, lock=True)
    if so["status"] not in ("OPEN", "PARTIAL"):
        raise HTTPException(400, f"Order is {so['status'].lower()}.")
    if not (b.invoice_no or b.challan_no):
        raise HTTPException(400, "Enter the invoice number or the delivery challan number.")
    day = b.dispatch_date or stk.today()
    if day > stk.today() or (day < stk.today() and user.role not in ADMIN):
        raise HTTPException(400, "Dispatch date must be today (only an administrator may record an earlier date).")
    if b.to_outlet_id and not so["is_own_brand"]:
        raise HTTPException(400, "Only own-brand goods can be dispatched into a retail outlet's stock.")
    if b.invoice_no and (await db.execute(text("""SELECT 1 FROM mfg_dispatches d JOIN mfg_sales_orders o ON o.id = d.sales_order_id
            WHERE d.invoice_no = :n AND d.sales_order_id <> :s
              AND NOT (:po IS NOT NULL AND o.customer_po_no = :po AND o.customer_id IS NOT DISTINCT FROM :c)"""),
                                          {"n": b.invoice_no, "s": sid, "po": so["customer_po_no"], "c": so["customer_id"]})).first():
        raise HTTPException(400, f"Invoice {b.invoice_no} is already used on another customer order.")
    q = await stk.to_base(db, so["product_id"], b.qty, b.unit, so["units_per_carton"])
    rows = (await db.execute(text("""SELECT * FROM mfg_handovers WHERE sales_order_id = :s AND qty - dispatched_qty - returned_qty > 0
        ORDER BY id FOR UPDATE"""), {"s": sid})).mappings().all()
    ready = sum((stk.d(r["qty"]) - stk.d(r["dispatched_qty"]) - stk.d(r["returned_qty"]) for r in rows), D0)
    if q > ready:
        raise HTTPException(400, f"Only {ready.normalize():f} has been handed over to Billing / Dispatch and not yet dispatched; "
                                 f"you entered {q.normalize():f}.")
    no, left = await stk.next_doc(db, "DSP"), q
    for r in rows:
        take = min(stk.d(r["qty"]) - stk.d(r["dispatched_qty"]) - stk.d(r["returned_qty"]), left)
        if take <= 0:
            continue
        await stk.post(db, txn_type="DISPATCH", product_id=so["product_id"], qty_base=take, from_store=r["to_store_id"], to_store=None,
                       user_id=user.user_id, batch_no=r["batch_no"], brand_id=r["brand_id"], ref_type="sales_order", ref_id=sid,
                       ref_no=b.invoice_no or b.challan_no, doc_no=no, remarks=b.remarks)
        if b.to_outlet_id:
            await db.execute(text("INSERT INTO outlet_stock (outlet_id, product_id, stock_qty) VALUES (:o, :p, 0) ON CONFLICT (outlet_id, product_id) DO NOTHING"),
                             {"o": b.to_outlet_id, "p": so["product_id"]})
            await _update_product_stock(db, so["product_id"], take, b.to_outlet_id)
            await _write_stock_ledger(db=db, product_id=so["product_id"], txn_type="mfg_receipt", qty=take, ref_id=sid, ref_type="mfg_dispatch",
                                      outlet_id=b.to_outlet_id, notes=f"{no} from plant ({so['so_no']})", user_id=user.user_id, batch_no=r["batch_no"])
        await db.execute(text("UPDATE mfg_handovers SET dispatched_qty = dispatched_qty + :q WHERE id = :i"), {"q": take, "i": r["id"]})
        await db.execute(text("""INSERT INTO mfg_dispatches (dispatch_no, sales_order_id, handover_id, qty, invoice_no, challan_no, eway_bill, vehicle_no,
            transporter, lr_no, dispatch_date, to_outlet_id, remarks, created_by)
            VALUES (:no, :s, :h, :q, :inv, :ch, :ew, :v, :t, :lr, :d, :o, :rm, :u)"""),
            {"no": no, "s": sid, "h": r["id"], "q": take, "inv": b.invoice_no, "ch": b.challan_no, "ew": b.eway_bill, "v": b.vehicle_no,
             "t": b.transporter, "lr": b.lr_no, "d": day, "o": b.to_outlet_id, "rm": b.remarks, "u": user.user_id})
        left -= take
    total = stk.d(so["dispatched_qty"]) + q
    await db.execute(text("UPDATE mfg_sales_orders SET status = :s WHERE id = :i"),
                     {"s": "COMPLETED" if total >= stk.d(so["ordered_qty"]) else "PARTIAL", "i": sid})
    await _audit(db, user, "dispatch", sid, no, f"{no} for {so['so_no']}: {q.normalize():f} dispatched (invoice {b.invoice_no or '-'}, "
                 f"challan {b.challan_no or '-'}, vehicle {b.vehicle_no or '-'})")
    await db.commit()
    return {"dispatch_no": no, "dispatched_total": float(total), "pending_qty": float(stk.d(so["ordered_qty"]) - total)}


class ack_in(BaseModel):
    ack_status: str = Field(pattern="^(RECEIVED|SHORT|DAMAGED)$")
    ack_note: Optional[str] = None


@router.put("/dispatches/{no}/ack")
async def acknowledge(no: str, b: ack_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    n = (await db.execute(text("UPDATE mfg_dispatches SET ack_status = :s, ack_note = :n, ack_at = NOW() WHERE dispatch_no = :d"),
                          {"s": b.ack_status, "n": b.ack_note, "d": no})).rowcount
    if not n:
        raise HTTPException(404, "Dispatch not found")
    await _audit(db, user, "dispatch_ack", 0, no, f"{no}: customer acknowledgement {b.ack_status} {b.ack_note or ''}")
    await db.commit()
    return {"success": True}


class return_in(BaseModel):
    qty: Decimal = Field(gt=0)
    unit: Optional[str] = "CTN"
    reason: str = Field(min_length=3, max_length=300)


@router.post("/{sid}/return-from-dispatch")
async def return_from_dispatch(sid: int, b: return_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Goods handed over but not dispatched go back to the Finished Goods store."""
    so = await _so(db, sid, lock=True)
    q = await stk.to_base(db, so["product_id"], b.qty, b.unit, so["units_per_carton"])
    rows = (await db.execute(text("""SELECT * FROM mfg_handovers WHERE sales_order_id = :s AND qty - dispatched_qty - returned_qty > 0
        ORDER BY id DESC FOR UPDATE"""), {"s": sid})).mappings().all()
    if q > sum((stk.d(r["qty"]) - stk.d(r["dispatched_qty"]) - stk.d(r["returned_qty"]) for r in rows), D0):
        raise HTTPException(400, "More than what is waiting in Billing / Dispatch for this order.")
    no, left = await stk.next_doc(db, "RET"), q
    for r in rows:
        take = min(stk.d(r["qty"]) - stk.d(r["dispatched_qty"]) - stk.d(r["returned_qty"]), left)
        if take <= 0:
            continue
        await stk.post(db, txn_type="DISPATCH_RETURN", product_id=r["product_id"], qty_base=take, from_store=r["to_store_id"], to_store=r["from_store_id"],
                       user_id=user.user_id, batch_no=r["batch_no"], brand_id=r["brand_id"], ref_type="sales_order", ref_id=sid, ref_no=so["so_no"],
                       doc_no=no, remarks=b.reason)
        await db.execute(text("UPDATE mfg_handovers SET returned_qty = returned_qty + :q WHERE id = :i"), {"q": take, "i": r["id"]})
        left -= take
    await _audit(db, user, "dispatch_return", sid, no, f"{no}: {q.normalize():f} back from Billing / Dispatch to Finished Goods — {b.reason}")
    await db.commit()
    return {"doc_no": no}


class reason_in(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


async def _end(db, sid, user, status: str, reason: str):
    so = await _so(db, sid, lock=True)
    if so["status"] not in ("OPEN", "PARTIAL"):
        raise HTTPException(400, f"Order is already {so['status'].lower()}.")
    if stk.d(so["issued_qty"]) > stk.d(so["dispatched_qty"]):
        raise HTTPException(400, "Goods are waiting in Billing / Dispatch for this order — dispatch them or return them to Finished Goods first.")
    if status == "CANCELLED" and stk.d(so["dispatched_qty"]) > 0:
        raise HTTPException(400, "Part of this order is dispatched; short-close it instead of cancelling.")
    await db.execute(text("UPDATE mfg_fg_reservations SET qty = 0 WHERE sales_order_id = :i"), {"i": sid})
    await db.execute(text("UPDATE mfg_sales_orders SET status = :s, close_note = :r WHERE id = :i"), {"s": status, "r": reason, "i": sid})
    await _audit(db, user, f"{status.lower()}_customer_order", sid, so["so_no"], f"{so['so_no']} {status.lower()}, reservations released: {reason}")
    await db.commit()
    return {"success": True}


@router.post("/{sid}/approve")
async def approve(sid: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _decide(db, sid, user, True, None)


@router.post("/{sid}/reject")
async def reject(sid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _decide(db, sid, user, False, b.reason)


async def _decide(db, sid, user, ok, reason):
    """Approve (-> OPEN) or reject a freshly punched order; for a PO with several items every PENDING line of that PO is decided together."""
    from app.routers.mfg_setup import _not_own
    so = (await db.execute(text("SELECT * FROM mfg_sales_orders WHERE id = :i"), {"i": sid})).mappings().first()
    if not so:
        raise HTTPException(404, "Customer order not found.")
    if so["status"] != "PENDING_APPROVAL":
        raise HTTPException(400, "This order is not waiting for approval.")
    _not_own(so["created_by"], user)
    ids = [r["id"] for r in await _rows(db, """SELECT id FROM mfg_sales_orders WHERE status = 'PENDING_APPROVAL' AND (id = :i OR (CAST(:po AS TEXT) IS NOT NULL AND customer_po_no = CAST(:po AS TEXT)
        AND customer_id IS NOT DISTINCT FROM CAST(:c AS INT) AND created_by = CAST(:u AS INT)))""", {"i": sid, "po": so["customer_po_no"], "c": so["customer_id"], "u": so["created_by"]})]
    await db.execute(text("""UPDATE mfg_sales_orders SET status = :s, approved_by = :u, approved_at = NOW(), reject_reason = :r WHERE id = ANY(:ids)"""),
                     {"s": "OPEN" if ok else "REJECTED", "u": user.user_id, "r": reason, "ids": ids})
    await _audit(db, user, "approve_customer_order" if ok else "reject_customer_order", sid, so["so_no"],
                 f"{len(ids)} order line(s) {'approved' if ok else 'rejected: ' + (reason or '')}")
    await db.commit()
    return {"success": True, "count": len(ids)}


@router.post("/{sid}/cancel")
async def cancel(sid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _end(db, sid, user, "CANCELLED", b.reason)


@router.post("/{sid}/finalize")
async def short_close(sid: int, b: reason_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _end(db, sid, user, "CLOSED", b.reason)
