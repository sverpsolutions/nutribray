"""Material requirement & availability planning for production / customer orders (raw + packing materials).

requirements(): BOM x quantity (+ wastage), converted to each item's base unit; components flagged round_up are rounded up
                per order (21 cartons, not 20.83) — everything else keeps its decimals.
availability(): per component, all from posted stock (never hard-coded):
   plant usable   = usable plant stores (RMS / PMS / printed / FG…) of the right brand; WIP, QC, rejected, scrap never count
   reserved       = held by OTHER open production orders (this order's own reservation stays available to it)
   qc_hold        = in QC / quarantine (needs approval before use)
   warehouse      = stock at the configured raw / packing material warehouse outlet(s), less transfer requests already
                    raised from there; general (unbranded) items only
   pending PO     = approved, not yet received PO quantity — shown as expected supply, never as stock
 Suggestions: first transfer from the warehouse, then QC release, then pending POs, and only the rest is a purchase
 (rounded up to the supplier pack / minimum order quantity).
open_orders(): all open orders allocated in priority / date order against one pool, so the same stock is never offered twice.
"""
import math
from datetime import date
from decimal import ROUND_CEILING, Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text

from app.services import mfg_stock_service as stk

D = stk.d
USABLE = "SELECT id FROM mfg_stores WHERE usable AND is_active AND NOT is_wip"
OPEN = ("DRAFT", "APPROVED", "MATERIAL_SHORTAGE", "READY", "IN_PRODUCTION", "AWAITING_QC", "PARTIALLY_COMPLETED")
STATUS_ORDER = ["Available", "Awaiting Warehouse Transfer", "Awaiting Quality Approval", "Awaiting Purchase", "Partially Available", "Short"]


async def bom_for(db, product_id: int, brand_id: Optional[int], on: Optional[date] = None) -> Optional[dict]:
    """Approved BOM valid on the date: the brand's own BOM first, else the general one, newest revision."""
    r = (await db.execute(text("""SELECT * FROM mfg_boms WHERE product_id = :p AND status = 'APPROVED'
        AND (valid_from IS NULL OR valid_from <= :d) AND (valid_to IS NULL OR valid_to >= :d) AND (brand_id IS NULL OR brand_id = :b)
        ORDER BY (brand_id IS NOT NULL) DESC, revision DESC, id DESC LIMIT 1"""), {"p": product_id, "b": brand_id, "d": on or stk.today()})).mappings().first()
    return dict(r) if r else None


async def requirements(db, bom: dict, qty: Decimal, brand_id: Optional[int], spec: Optional[dict] = None) -> list[dict]:
    if bom.get("status") != "APPROVED":
        raise HTTPException(400, f"BOM {bom['bom_no']} is not approved.")
    own = {spec[k] for k in ("printed_tin_item_id", "cap_item_id", "label_item_id", "carton_item_id")} - {None} if spec else set()
    foreign = {r[0]: r[1] for r in (await db.execute(text("""SELECT x.item, b.name FROM mfg_pack_specs s JOIN mfg_brands b ON b.id = s.brand_id,
        LATERAL (VALUES (s.printed_tin_item_id), (s.cap_item_id), (s.label_item_id), (s.carton_item_id)) x(item)
        WHERE s.brand_id <> COALESCE(:b, 0) AND s.status = 'APPROVED' AND x.item IS NOT NULL"""), {"b": brand_id})).all()}
    items = (await db.execute(text("""SELECT i.*, p.name, p.item_code, p.item_type, UPPER(COALESCE(p.unit, 'PCS')) AS base_unit
        FROM mfg_bom_items i JOIN products p ON p.id = i.product_id WHERE i.bom_id = :b ORDER BY i.sequence, i.id"""), {"b": bom["id"]})).mappings().all()
    if not items:
        raise HTTPException(400, f"BOM {bom['bom_no']} has no components.")
    if any(i["sub_bom_id"] == bom["id"] or i["product_id"] == bom["product_id"] for i in items):
        raise HTTPException(400, f"BOM {bom['bom_no']} uses its own product — circular BOM.")
    scale = D(qty) / D(bom["batch_size"] or 1)
    out = []
    for it in items:
        if it["product_id"] in foreign and it["product_id"] not in own:
            raise HTTPException(400, f"'{it['name']}' is {foreign[it['product_id']]}'s packaging — choose this brand's BOM / packaging spec.")
        gross = D(it["quantity"]) * scale * (1 + D(it["wastage_pct"]) / 100)
        try:
            base = await stk.to_base(db, it["product_id"], gross, it["unit"]) if gross > 0 else Decimal(0)
        except HTTPException as e:
            raise HTTPException(400, f"Unit problem on '{it['name']}': {e.detail}")
        # whole units (cartons, tins) per order: round up, ignoring arithmetic dust below 0.0001 (24 x 1/24 = 1, not 2)
        req = (base - Decimal("0.0001")).to_integral_value(rounding=ROUND_CEILING) if it["round_up"] else base.quantize(Decimal("0.0001"))
        out.append({"bom_item_id": it["id"], "product_id": it["product_id"], "item_code": it["item_code"], "item": it["name"],
                    "item_type": it["item_type"], "material_type": it["material_type"], "unit": it["base_unit"],
                    "per_unit": D(it["quantity"]) / D(bom["batch_size"] or 1), "bom_unit": it["unit"], "wastage_pct": D(it["wastage_pct"]),
                    "theoretical": base.quantize(Decimal("0.0001")), "required": req, "round_up": it["round_up"],
                    "brand_id": (brand_id or 0) if it["product_id"] in own else 0, "preferred_store_id": it["preferred_store_id"],
                    "cost": D(it["cost_per_unit"])})
    return out


async def warehouses(db) -> dict:
    r = (await db.execute(text("SELECT raw_material_warehouse_id, packaging_material_warehouse_id FROM company_settings ORDER BY id LIMIT 1"))).first()
    return {"RM": r[0] if r else None, "PM": (r[1] or r[0]) if r else None}


async def warehouse_for(db, item_type: str) -> Optional[int]:
    w = await warehouses(db)
    return w["PM"] if item_type == "PM" else w["RM"] or w["PM"]


async def stock_facts(db, product_id: int, brand_id: int, item_type: str) -> dict:
    p = {"p": product_id, "b": brand_id}
    phys = D((await db.execute(text(f"SELECT SUM(qty) FROM mfg_stock WHERE product_id = :p AND brand_id = :b AND store_id IN ({USABLE})"), p)).scalar())
    resv = D((await db.execute(text(f"""SELECT SUM(i.reserved_qty) FROM mfg_order_items i JOIN mfg_orders o ON o.id = i.mfg_order_id
        WHERE i.product_id = :p AND i.brand_id = :b AND o.stock_mode = 'DEPT' AND o.status IN {OPEN}"""), p)).scalar())
    qc = D((await db.execute(text("""SELECT SUM(m.qty) FROM mfg_stock m JOIN mfg_stores s ON s.id = m.store_id WHERE s.kind = 'QC'
        AND m.product_id = :p AND m.brand_id = :b"""), p)).scalar())
    wh_id = await warehouse_for(db, item_type) if brand_id == 0 else None
    wh = wh_pend = Decimal(0)
    if wh_id:
        wh = D((await db.execute(text("SELECT stock_qty FROM outlet_stock WHERE outlet_id = :o AND product_id = :p"), {"o": wh_id, "p": product_id})).scalar())
        wh_pend = D((await db.execute(text("""SELECT SUM(l.qty) FROM mfg_transfer_lines l JOIN mfg_transfers t ON t.id = l.transfer_id
            WHERE t.from_outlet_id = :o AND t.status = 'PENDING' AND l.product_id = :p"""), {"o": wh_id, "p": product_id})).scalar())
    po = (await db.execute(text("""SELECT SUM(GREATEST(COALESCE(NULLIF(i.order_qty, 0), i.qty) - COALESCE(i.received_qty, 0), 0)) AS qty, MIN(h.expected_date) AS eta
        FROM po_items i JOIN po_headers h ON h.id = i.po_id WHERE i.product_id = :p AND h.approval_status = 'approved'
          AND h.status NOT IN ('cancelled', 'completed', 'closed')"""), {"p": product_id})).mappings().one()
    pr = (await db.execute(text("SELECT supplier_id, purchase_pack_qty, min_order_qty, reorder_level, min_stock FROM products WHERE id = :p"), p)).mappings().one()
    return {"plant": phys, "reserved_all": resv, "qc_hold": qc, "warehouse_id": wh_id, "warehouse": max(wh - wh_pend, Decimal(0)),
            "warehouse_requested": wh_pend, "pending_po": D(po["qty"]), "po_eta": po["eta"], **dict(pr)}


def judge(need: Decimal, free: Decimal, f: dict) -> dict:
    """Status and suggestions for one component (pure; see __main__)."""
    short = max(need - max(free, Decimal(0)), Decimal(0))
    transfer = min(short, f["warehouse"])
    after_t = short - transfer
    qc = min(after_t, f["qc_hold"])
    rest = after_t - qc
    covered_by_po = min(rest, f["pending_po"])
    buy = max(rest - f["pending_po"], Decimal(0))
    if buy > 0:
        pack = D(f.get("purchase_pack_qty")) or Decimal(1)
        buy = Decimal(math.ceil(buy / pack)) * pack
        if f.get("min_order_qty") and buy < D(f["min_order_qty"]):
            buy = D(f["min_order_qty"])
    if short == 0:
        st = "Available"
    elif rest == 0 and qc == 0:
        st = "Awaiting Warehouse Transfer"
    elif rest == 0:
        st = "Awaiting Quality Approval"
    elif rest - covered_by_po == 0:
        st = "Awaiting Purchase"
    elif free > 0:
        st = "Partially Available"
    else:
        st = "Short"
    return {"available": max(free, Decimal(0)), "shortage": short, "transfer_suggested": transfer, "qc_release": qc, "pending_cover": covered_by_po,
            "purchase_suggested": buy, "after_transfer_shortage": after_t, "status": st}


def overall(rows: list[dict]) -> dict:
    sts = {r["status"] for r in rows}
    if sts <= {"Available"}:
        return {"color": "GREEN", "label": "Fully Ready for Production"}
    if sts & {"Short", "Partially Available"}:
        return {"color": "RED", "label": "Material Shortage — cannot produce"}
    return {"color": "AMBER", "label": "Needs transfer / quality release / incoming purchase"}


async def check(db, comps: list[dict], order: Optional[dict] = None, pool: Optional[dict] = None) -> list[dict]:
    """Availability for one order. `pool` (open_orders) holds the free plant stock left after higher-priority orders."""
    own = {}
    if order:
        own = {(r["product_id"], r["brand_id"]): r for r in (await db.execute(text(
            "SELECT product_id, brand_id, required_qty, reserved_qty, issued_qty FROM mfg_order_items WHERE mfg_order_id = :o"), {"o": order["id"]})).mappings()}
    out = []
    for c in comps:
        k = (c["product_id"], c["brand_id"])
        f = await stock_facts(db, c["product_id"], c["brand_id"], c["item_type"])
        mine = own.get(k)
        issued = D(mine["issued_qty"]) if mine else Decimal(0)
        my_res = D(mine["reserved_qty"]) if mine else Decimal(0)
        need = max(D(c["required"]) - issued, Decimal(0))
        if pool is not None:
            pool.setdefault(k, f["plant"] - f["reserved_all"])
            take = min(max(pool[k], Decimal(0)), max(need - my_res, Decimal(0)))
            pool[k] -= take
            free = my_res + take
        else:
            free = my_res + (f["plant"] - f["reserved_all"])
        j = judge(need, free, f)
        out.append({**c, **{k2: v for k2, v in f.items() if k2 not in ("supplier_id",)}, "supplier_id": f["supplier_id"], "issued": issued,
                    "reserved_for_order": my_res, "net_required": need, "reserved_other": f["reserved_all"] - my_res, **j})
    return out


async def open_orders(db, priority: str = "priority") -> list[dict]:
    """Every open production order + open customer orders not yet planned, allocated in priority / date order."""
    orders = [dict(r) for r in (await db.execute(text(f"""SELECT o.id, 'MO' AS kind, o.order_no, o.product_id, p.name AS product, o.brand_id, o.spec_id,
        o.bom_id, o.planned_qty AS qty, o.planned_start_date AS need_by, o.priority, o.status, o.released_at, so.so_no, c.name AS customer, so.id AS so_id
        FROM mfg_orders o JOIN products p ON p.id = o.product_id LEFT JOIN mfg_sales_orders so ON so.id = o.sales_order_id
        LEFT JOIN customers c ON c.id = so.customer_id WHERE o.stock_mode = 'DEPT' AND o.status IN {OPEN}
        UNION ALL
        SELECT so.id, 'SO', so.so_no, so.product_id, p.name, so.brand_id, so.spec_id, NULL, so.ordered_qty, so.delivery_date,
               CASE so.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 5 ELSE 7 END, so.status, NULL, so.so_no, c.name, so.id
        FROM mfg_sales_orders so JOIN products p ON p.id = so.product_id LEFT JOIN customers c ON c.id = so.customer_id
        WHERE so.status IN ('OPEN','PARTIAL') AND NOT EXISTS (SELECT 1 FROM mfg_orders o WHERE o.sales_order_id = so.id AND o.status <> 'CANCELLED')"""))).mappings()]
    key = (lambda o: (o["need_by"] or date.max, o["priority"], o["id"])) if priority == "date" else (lambda o: (o["priority"], o["need_by"] or date.max, o["id"]))
    orders.sort(key=key)
    pool: dict = {}
    for o in orders:
        try:
            if o["kind"] == "MO":
                comps = [{"product_id": r["product_id"], "item_code": r["item_code"], "item": r["name"], "item_type": r["item_type"],
                          "material_type": r["material_type"], "unit": r["unit"], "required": D(r["required_qty"]), "theoretical": D(r["required_qty"]),
                          "brand_id": r["brand_id"], "cost": D(r["cost_per_unit"])} for r in (await db.execute(text("""SELECT i.*, p.name, p.item_code, p.item_type
                          FROM mfg_order_items i JOIN products p ON p.id = i.product_id WHERE i.mfg_order_id = :o ORDER BY i.id"""), {"o": o["id"]})).mappings()]
                bom = (await db.execute(text("SELECT bom_no, revision FROM mfg_boms WHERE id = :b"), {"b": o["bom_id"]})).mappings().first()
                o["bom"] = f"{bom['bom_no']} r{bom['revision']}" if bom else None
                o["lines"] = await check(db, comps, o, pool)
            else:
                bom = await bom_for(db, o["product_id"], o["brand_id"])
                if not bom:
                    o["lines"], o["error"] = [], "No approved BOM for this product / brand"
                    continue
                spec = (await db.execute(text("SELECT * FROM mfg_pack_specs WHERE id = :s"), {"s": o["spec_id"]})).mappings().first() if o["spec_id"] else None
                o["bom"] = f"{bom['bom_no']} r{bom['revision']}"
                o["lines"] = await check(db, await requirements(db, bom, D(o["qty"]), o["brand_id"], dict(spec) if spec else None), None, pool)
        except HTTPException as e:
            o["lines"], o["error"] = [], e.detail
        o["overall"] = overall(o["lines"]) if o["lines"] else {"color": "RED", "label": o.get("error") or "No components"}
    return orders


if __name__ == "__main__":
    base = {"warehouse": Decimal(0), "qc_hold": Decimal(0), "pending_po": Decimal(0), "purchase_pack_qty": None, "min_order_qty": None}
    j = judge(Decimal(500), Decimal(450), {**base, "warehouse": Decimal(100)})      # test 3: 50 from warehouse
    assert j["transfer_suggested"] == 50 and j["after_transfer_shortage"] == 0 and j["status"] == "Awaiting Warehouse Transfer"
    j = judge(Decimal(500), Decimal(400), {**base, "pending_po": Decimal(100)})      # test 4: PO covers, nothing to buy
    assert j["shortage"] == 100 and j["purchase_suggested"] == 0 and j["status"] == "Awaiting Purchase"
    j = judge(Decimal(21), Decimal(15), {**base, "purchase_pack_qty": Decimal(10)})  # 6 short -> one pack of 10
    assert j["shortage"] == 6 and j["purchase_suggested"] == 10 and j["status"] == "Partially Available"
    assert judge(Decimal(500), Decimal(500), base)["status"] == "Available"
    assert overall([{"status": "Available"}, {"status": "Awaiting Purchase"}])["color"] == "AMBER"
    assert overall([{"status": "Available"}, {"status": "Short"}])["color"] == "RED"
    q = Decimal("0.04166667")
    assert (24 * q - Decimal("0.0001")).to_integral_value(rounding=ROUND_CEILING) == 1                  # 24 tins = 1 carton
    assert (500 * q - Decimal("0.0001")).to_integral_value(rounding=ROUND_CEILING) == 21 and round(500 * q, 4) == Decimal("20.8333")
    print("mfg_planning OK")
