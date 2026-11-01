"""Vendor GSTIN lookup / verification, new items through a Purchase ID (approval), PO e-mail to the vendor (Outlook)."""
import asyncio
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import approval_service as aps
from app.services import item_request_service, po_email_service, vendor_gst
from app.services.auth_service import write_audit

gst = APIRouter(prefix="/suppliers", tags=["vendor gst"])
items = APIRouter(prefix="/item-requests", tags=["item requests"])
mail = APIRouter(prefix="/purchases/po-email", tags=["po email"])
routers = (gst, items, mail)


async def _rows(db, sql, p=None):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p or {})).mappings().all()]


# ── vendor GSTIN ──────────────────────────────────────────────────────────────
@gst.get("/gst/lookup")
async def gst_lookup(gstin: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """GSTIN check + (when configured) authorised GST provider details, and existing vendors with the same GSTIN / name."""
    r = await vendor_gst.lookup(gstin)
    r["existing"] = await _rows(db, """SELECT id, supplier_code, name, gst_number, gst_verify_status FROM suppliers
        WHERE UPPER(gst_number) = :g OR (CAST(:n AS TEXT) IS NOT NULL AND LOWER(name) = LOWER(:n)) LIMIT 10""",
        {"g": r["gstin"], "n": r.get("legal_name")})
    return r


class verify_in(BaseModel):
    gstin: Optional[str] = None
    manual: bool = False                     # details typed by the user (lookup unavailable): stored as MANUAL, never VERIFIED
    legal_name: Optional[str] = None
    trade_name: Optional[str] = None
    reg_status: Optional[str] = None
    taxpayer_type: Optional[str] = None
    address: Optional[str] = None


@gst.post("/{sid}/gst-verify")
async def gst_verify(sid: int, b: verify_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    s = (await db.execute(text("SELECT id, name, gst_number FROM suppliers WHERE id = :i FOR UPDATE"), {"i": sid})).mappings().first()
    if not s:
        raise HTTPException(404, "Supplier not found")
    g = (b.gstin or s["gst_number"] or "").strip().upper()
    other = (await db.execute(text("SELECT name FROM suppliers WHERE UPPER(gst_number) = :g AND id <> :i"), {"g": g, "i": sid})).scalar()
    if other:
        raise HTTPException(400, f"GSTIN {g} already belongs to supplier '{other}' — duplicate vendors are not allowed.")
    if b.manual:
        r = await vendor_gst.lookup(g)
        if not r["format_ok"]:
            raise HTTPException(400, r["message"])
        res = {"status": "MANUAL", "source": "Manual entry", "legal_name": b.legal_name, "trade_name": b.trade_name,
               "reg_status": b.reg_status, "taxpayer_type": b.taxpayer_type, "address": b.address}
    else:
        r = await vendor_gst.lookup(g)
        if r["status"] != "VERIFIED":
            await db.execute(text("UPDATE suppliers SET gst_verify_status = :s, gst_verified_at = NOW(), gst_verify_source = :src WHERE id = :i"),
                             {"s": "FAILED" if r["status"] in ("INVALID", "NOT_FOUND") else "UNVERIFIED", "src": r.get("source"), "i": sid})
            await db.commit()
            return r
        res = r
    await db.execute(text("""UPDATE suppliers SET gst_number = :g, gst_verify_status = :s, gst_verified_at = NOW(), gst_verify_source = :src,
        gst_legal_name = :ln, gst_trade_name = :tn, gst_reg_status = :rs, gst_taxpayer_type = :tt, gst_address = :ad WHERE id = :i"""),
        {"g": g, "s": res["status"], "src": res.get("source"), "ln": res.get("legal_name"), "tn": res.get("trade_name"), "rs": res.get("reg_status"),
         "tt": res.get("taxpayer_type"), "ad": res.get("address"), "i": sid})
    await write_audit(db=db, module="suppliers", action="gst_verify", record_id=sid, record_no=g,
                      description=f"Supplier {s['name']} GSTIN {g}: {res['status']} ({res.get('source')})", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {**r, "status": res["status"]} if not b.manual else {"status": "MANUAL", "gstin": g}


# ── new item through a Purchase ID ────────────────────────────────────────────
class item_req_in(BaseModel):
    purchase_ref: str = Field(min_length=3, max_length=40)
    reason: str = Field("New item needed for this purchase", min_length=3, max_length=300)
    product: dict


@items.post("")
async def request_item(b: item_req_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    ref = b.purchase_ref.strip()
    found = (await db.execute(text("""SELECT 'PO' AS t, id, outlet_id FROM po_headers WHERE po_no = :r
        UNION ALL SELECT 'GRN', id, outlet_id FROM unit_wise_purchases WHERE purchase_no = :r LIMIT 1"""), {"r": ref})).first()
    if not found:
        raise HTTPException(400, f"Purchase ID {ref} not found (enter a PO or GRN number).")
    prod = {k: v for k, v in b.product.items() if k not in ("stock_qty", "opening_stock", "opening_qty")}   # never stock
    dup = await item_request_service.duplicates(db, prod)
    if dup:
        raise HTTPException(400, "Duplicate item: " + "; ".join(dup) + ".")
    r = await aps.submit(db, request_type="ITEM_CREATION", user=user, reason=b.reason, outlet_id=found[2],
                         payload={"product": prod, "purchase_ref": ref}, summary=f"New item '{prod.get('name')}' for {found[0]} {ref}",
                         ref_type=found[0].lower(), ref_id=found[1], ref_no=ref, new_value={k: prod.get(k) for k in
                         ("name", "barcode", "category_id", "hsn_code", "gst_percent", "mrp", "selling_price", "cost_price", "wsp")})
    await db.commit()
    return r


@items.get("")
async def list_item_requests(status: Optional[str] = None, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await _rows(db, """SELECT a.id, a.request_no, a.status, a.ref_no AS purchase_ref, a.payload->'product'->>'name' AS name,
        a.payload->'product'->>'barcode' AS barcode, a.posted_ref AS item_code, a.decision_note, u.name AS requested_by,
        TO_CHAR(a.requested_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS requested
        FROM approval_requests a LEFT JOIN users u ON u.id = a.requested_by WHERE a.request_type = 'ITEM_CREATION'
          AND (CAST(:s AS TEXT) IS NULL OR a.status = :s) ORDER BY a.id DESC LIMIT 300""", {"s": status})


# ── PO e-mail ─────────────────────────────────────────────────────────────────
def kick(row_id: Optional[int]):
    if row_id:
        asyncio.create_task(po_email_service.send_one(row_id))


async def on_po_approved(db, po_id: int, user_id: Optional[int]) -> Optional[str]:
    """Called after a PO is approved (committed). Never blocks the approval: problems are reported and logged."""
    try:
        r = await po_email_service.enqueue(db, po_id, user_id, "APPROVAL")
        await db.commit()
    except ValueError as e:
        await db.rollback()
        await write_audit(db=db, module="purchase_order", action="po_email_skipped", record_id=po_id, description=str(e), user_id=user_id or 0)
        await db.commit()
        return f"Not e-mailed: {e}"
    if not r:
        return None
    kick(r["id"])
    return f"E-mail to {', '.join(r['to'])} queued" if not r["duplicate"] else "E-mail already queued for this approval"


@mail.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    st = dict((await db.execute(text("SELECT * FROM po_email_settings WHERE id = 1"))).mappings().one())
    import os
    return {**st, "outlook_configured": po_email_service.configured(), "sender": os.getenv("MS_SENDER") or None}


class mail_settings_in(BaseModel):
    auto_send: bool
    send_unapproved: bool = False
    cc: Optional[str] = None
    reply_to: Optional[str] = None
    max_attempts: int = Field(5, ge=1, le=10)
    signature: Optional[str] = None


@mail.put("/settings")
async def put_settings(b: mail_settings_in, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if user.role not in ("admin", "superadmin") and b.send_unapproved:
        raise HTTPException(403, "Only an administrator can allow e-mailing unapproved POs.")
    await db.execute(text("""UPDATE po_email_settings SET auto_send = :auto_send, send_unapproved = :send_unapproved, cc = :cc, reply_to = :reply_to,
        max_attempts = :max_attempts, signature = :signature, updated_by = :u, updated_at = NOW() WHERE id = 1"""), {**b.model_dump(), "u": user.user_id})
    await write_audit(db=db, module="purchase_order", action="po_email_settings", record_id=0, record_no="po_email_settings",
                      new_data=str(b.model_dump()), description="PO e-mail settings changed", user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"success": True}


@mail.get("/{po_id}")
async def po_emails(po_id: int, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    o = (await db.execute(text("SELECT outlet_id FROM po_headers WHERE id = :i"), {"i": po_id})).scalar()
    access.check_outlet(o)
    rows = await _rows(db, """SELECT e.*, u.name AS created_by_name, TO_CHAR(e.created_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS queued,
        TO_CHAR(e.sent_at + INTERVAL '5 hours 30 minutes', 'DD Mon YYYY HH24:MI') AS sent FROM po_email_outbox e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.po_id = :i ORDER BY e.id DESC""", {"i": po_id})
    return {"configured": po_email_service.configured(), "rows": rows}


@mail.post("/{po_id}/send")
async def send_now(po_id: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """Manual send / resend (Purchase Order → e-mail permission). A new outbox row each time, so a resend is deliberate."""
    o = (await db.execute(text("SELECT outlet_id FROM po_headers WHERE id = :i"), {"i": po_id})).scalar()
    access.check_outlet(o)
    if (await db.execute(text("SELECT 1 FROM po_email_outbox WHERE po_id = :i AND status IN ('QUEUED','SENDING','RETRY')"), {"i": po_id})).first():
        raise HTTPException(400, "An e-mail for this PO is already queued — wait for it or retry that one.")
    try:
        r = await po_email_service.enqueue(db, po_id, user.user_id, "MANUAL")
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    kick(r["id"])
    return {"queued": r["id"], "to": r["to"]}


@mail.post("/retry/{row_id}")
async def retry(row_id: int, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    n = (await db.execute(text("""UPDATE po_email_outbox SET status = 'RETRY', next_try_at = NOW(), attempts = 0
        WHERE id = :i AND status = 'FAILED' RETURNING po_no"""), {"i": row_id})).scalar()
    if not n:
        raise HTTPException(400, "Only a failed e-mail can be retried (a sent one is never sent twice by retry).")
    await write_audit(db=db, module="purchase_order", action="po_email_retry", record_id=row_id, record_no=n, description=f"Retry PO e-mail {n}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    kick(row_id)
    return {"success": True}
