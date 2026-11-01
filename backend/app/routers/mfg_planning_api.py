"""Order-wise material requirement / availability, allocation, transfer requests and purchase suggestions."""
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.routers.mfg_setup import _audit
from app.services import mfg_planning as mp
from app.services import mfg_planning_report as rp
from app.services import po_email_service as pe
from app.services import mfg_stock_service as stk

router = APIRouter(prefix="/manufacturing/planning", tags=["manufacturing planning"])


def _j(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dict):
        return {k: _j(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_j(x) for x in v]
    return v


class check_in(BaseModel):
    product_id: Optional[int] = None
    bom_id: Optional[int] = None
    sales_order_id: Optional[int] = None
    brand_id: Optional[int] = None
    spec_id: Optional[int] = None
    qty: Optional[Decimal] = Field(None, gt=0)
    unit: Optional[str] = None


@router.post("/check")
async def check(b: check_in, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Material availability for an order that is being entered (nothing is saved or reserved)."""
    if b.sales_order_id:
        so = (await db.execute(text("SELECT * FROM mfg_sales_orders WHERE id = :i"), {"i": b.sales_order_id})).mappings().first()
        if not so:
            raise HTTPException(404, "Customer order not found")
        b.product_id, b.brand_id, b.spec_id = so["product_id"], so["brand_id"], so["spec_id"]
        b.qty = b.qty or stk.d(so["ordered_qty"])
    if not b.qty:
        raise HTTPException(400, "Enter the quantity.")
    spec = (await db.execute(text("SELECT * FROM mfg_pack_specs WHERE id = :s"), {"s": b.spec_id})).mappings().first() if b.spec_id else None
    bom = None
    if b.bom_id:
        bom = (await db.execute(text("SELECT * FROM mfg_boms WHERE id = :b"), {"b": b.bom_id})).mappings().first()
        bom = dict(bom) if bom else None
    elif b.product_id:
        bom = await mp.bom_for(db, b.product_id, b.brand_id)
    if not bom:
        raise HTTPException(400, "No approved BOM valid today for this product / brand.")
    qty = await stk.to_base(db, bom["product_id"], b.qty, b.unit, spec["units_per_carton"] if spec else None)
    lines = await mp.check(db, await mp.requirements(db, bom, qty, b.brand_id, dict(spec) if spec else None))
    return _j({"bom": {"id": bom["id"], "bom_no": bom["bom_no"], "revision": bom["revision"]}, "qty": qty, "lines": lines, "overall": mp.overall(lines)})


@router.get("/open")
async def open_orders(order_by: str = "priority", db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """All open orders, each checked against what is left after higher-priority orders (no stock counted twice), plus totals per material."""
    orders = await mp.open_orders(db, "date" if order_by == "date" else "priority")
    tot: dict = {}
    for o in orders:
        for l in o["lines"]:
            k = (l["product_id"], l["brand_id"])
            t = tot.setdefault(k, {"product_id": l["product_id"], "item_code": l["item_code"], "item": l["item"], "item_type": l["item_type"],
                                   "unit": l["unit"], "brand_id": l["brand_id"], "required": Decimal(0), "plant": l["plant"], "reserved_all": l["reserved_all"],
                                   "warehouse": l["warehouse"], "qc_hold": l["qc_hold"], "pending_po": l["pending_po"], "po_eta": l["po_eta"],
                                   "shortage": Decimal(0), "orders": 0})
            t["required"] += l["net_required"]
            t["shortage"] += l["shortage"]
            t["orders"] += 1
    for t in tot.values():   # company-wide view: all usable plant stock vs everything still needed
        t["company_shortage"] = max(t["required"] - t["plant"], Decimal(0))
        t["after_warehouse"] = max(t["company_shortage"] - t["warehouse"], Decimal(0))
        t["to_buy"] = max(t["after_warehouse"] - t["qc_hold"] - t["pending_po"], Decimal(0))
    return _j({"orders": orders, "consolidated": sorted(tot.values(), key=lambda t: (-t["shortage"], t["item"]))})


class allocate_in(BaseModel):
    order_by: str = "priority"
    order_ids: Optional[list[int]] = None


@router.post("/allocate")
async def allocate(b: allocate_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Reserve materials for open production orders in priority (or production date) order."""
    from app.routers.mfg_production import reserve
    ids = [o["id"] for o in await mp.open_orders(db, b.order_by) if o["kind"] == "MO" and o["status"] in ("APPROVED", "MATERIAL_SHORTAGE", "READY", "IN_PRODUCTION")
           and (not b.order_ids or o["id"] in b.order_ids)]
    out = []
    for oid in ids:
        try:
            r = await reserve(oid, db, user)
            out.append({"order_id": oid, "status": r["status"], "short": len(r["shortages"])})
        except HTTPException as e:
            await db.rollback()
            out.append({"order_id": oid, "error": e.detail})
    return out


class line_in(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)


class transfer_req_in(BaseModel):
    lines: list[line_in] = Field(min_length=1)
    to_store_id: Optional[int] = None
    for_order_id: Optional[int] = None
    remarks: Optional[str] = None


@router.post("/transfer-request")
async def transfer_request(b: transfer_req_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Warehouse -> plant store transfer requests (one per warehouse). Nothing moves until another person approves the transfer."""
    by_wh: dict = {}
    for ln in b.lines:
        it = (await db.execute(text("SELECT id, name, item_type, default_store_id FROM products WHERE id = :p"), {"p": ln.product_id})).mappings().first()
        if not it:
            raise HTTPException(404, f"Item #{ln.product_id} not found")
        wh = await mp.warehouse_for(db, it["item_type"])
        if not wh:
            raise HTTPException(400, "Set the raw / packing material warehouse in Plant Settings first.")
        f = await mp.stock_facts(db, ln.product_id, 0, it["item_type"])
        if ln.qty > f["warehouse"]:
            raise HTTPException(400, f"Warehouse has only {f['warehouse'].normalize():f} of '{it['name']}' free (requested {ln.qty.normalize():f}).")
        to = b.to_store_id or it["default_store_id"] or await stk.store(db, "PMS" if it["item_type"] == "PM" else "RMS")
        by_wh.setdefault((wh, to), []).append(ln)
    made = []
    for (wh, to), lines in by_wh.items():
        no = await stk.next_doc(db, "TRF")
        tid = (await db.execute(text("""INSERT INTO mfg_transfers (transfer_no, from_store_id, from_outlet_id, to_store_id, remarks, requested_by, for_order_id)
            VALUES (:n, NULL, :w, :t, :r, :u, :o) RETURNING id"""), {"n": no, "w": wh, "t": to, "r": b.remarks or "Planning: warehouse to plant", "u": user.user_id,
                                                                   "o": b.for_order_id})).scalar()
        for ln in lines:
            await db.execute(text("""INSERT INTO mfg_transfer_lines (transfer_id, product_id, batch_no, brand_id, qty, unit_entered, qty_entered)
                VALUES (:t, :p, '', 0, :q, NULL, :q)"""), {"t": tid, "p": ln.product_id, "q": ln.qty})
        await _audit(db, user, "warehouse_transfer_request", tid, no, f"{no}: {len(lines)} item(s) requested from the warehouse")
        made.append(no)
    await db.commit()
    return {"transfers": made}


class purchase_line_in(line_in):
    rate: Optional[Decimal] = Field(None, ge=0)     # else the item's purchase price


class purchase_in(BaseModel):
    lines: list[purchase_line_in] = Field(min_length=1)
    supplier_id: Optional[int] = None       # else each item's preferred supplier
    expected_date: Optional[date] = None


@router.post("/purchase")
async def purchase(b: purchase_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Shortages -> draft purchase order(s) per supplier in the normal PO module (nothing is sent to a supplier)."""
    from app.routers.purchases import _next_po_no, create_po
    from app.schemas.purchase import po_create, po_item_in
    perms = set(access.ALL_SLUGS) if user.role in ("admin", "superadmin") else await access.effective_permissions(db, user.user_id, user.role, user.role_id)
    if "purchase_order.create" not in perms:
        raise HTTPException(403, "You need the Purchase Order → create permission.")
    groups: dict = {}
    for ln in b.lines:
        it = (await db.execute(text("SELECT id, name, item_type, supplier_id, COALESCE(NULLIF(purchase_price, 0), cost_price, 0) AS rate, gst_percent, mrp FROM products WHERE id = :p"),
                               {"p": ln.product_id})).mappings().first()
        sup = b.supplier_id or (it and it["supplier_id"])
        if not it or not sup:
            raise HTTPException(400, f"'{it['name'] if it else ln.product_id}' has no preferred supplier — choose the supplier.")
        groups.setdefault(sup, []).append((it, ln.qty, ln.rate))
    made = []
    for sup, rows in groups.items():
        wh = await mp.warehouse_for(db, rows[0][0]["item_type"])
        items = [po_item_in(product_id=it["id"], order_qty=q, rate=stk.d(r if r is not None else it["rate"]), gst_percent=stk.d(it["gst_percent"]), mrp=stk.d(it["mrp"])) for it, q, r in rows]
        body = po_create(po_no=await _next_po_no(db), supplier_id=sup, outlet_id=wh, po_date=stk.today(), expected_date=b.expected_date,
                         total_amount=sum((i.order_qty * i.rate * (1 + i.gst_percent / 100) for i in items), Decimal(0)).quantize(Decimal("0.01")),
                         notes="Draft from material shortage planning", status="draft", items=items)
        r = await create_po(body, db, user)
        made.append(r["po_no"])
    return {"purchase_orders": made, "status": "draft"}


async def _report(db, scope: str):
    d = await open_orders("priority", db)
    secs = rp.sections(d["orders"], d["consolidated"], scope)
    if not secs:
        raise HTTPException(404, "Nothing to export for that selection.")
    return await rp.company(db), secs


@router.get("/report")
async def report(scope: str = Query("all", pattern=r"^(all|totals|SO:\d+|MO:\d+)$"), fmt: str = Query("xlsx", pattern="^(xlsx|pdf)$"),
                 db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """Excel / PDF of the material requirement: one order, all open orders (a sheet / page per customer order) or the material totals."""
    co, secs = await _report(db, scope)
    name = f"material_requirement_{scope.replace(':', '_')}"
    if fmt == "pdf":
        return Response(rp.build_pdf(co, secs), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return Response(rp.build_xlsx(co, secs), media_type=rp.XLSX, headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})


class email_in(BaseModel):
    scope: str = Field("all", pattern=r"^(all|totals|SO:\d+|MO:\d+)$")
    to: str
    cc: Optional[str] = None
    subject: Optional[str] = None
    message: Optional[str] = None
    formats: list[str] = ["xlsx", "pdf"]


@router.post("/email")
async def email_report(b: email_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Mails the report (Excel and/or PDF attached) through the company Outlook mailbox."""
    to, cc = pe.valid_emails(b.to), pe.valid_emails(b.cc)
    if not to:
        raise HTTPException(400, "Enter a valid e-mail address.")
    co, secs = await _report(db, b.scope)
    files = []
    if "xlsx" in b.formats:
        files.append(("material_requirement.xlsx", rp.XLSX, rp.build_xlsx(co, secs)))
    if "pdf" in b.formats:
        files.append(("material_requirement.pdf", "application/pdf", rp.build_pdf(co, secs)))
    try:
        await rp.send_mail(to, cc, b.subject or f"{co} - material requirement", b.message or "Please find the material requirement attached.", files)
    except PermissionError as e:
        raise HTTPException(503, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    await _audit(db, user, "planning_report_email", 0, b.scope, f"Material requirement ({b.scope}) e-mailed to {', '.join(to)}")
    await db.commit()
    return {"sent_to": to}
