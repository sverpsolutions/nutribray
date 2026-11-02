"""Approved PO -> PDF -> vendor e-mail through the company's Microsoft 365 / Outlook mailbox (Microsoft Graph, app-only).

Server .env (never in git / database): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER (mailbox the mail is sent from).
The Azure app needs only the Mail.Send application permission (admin consent; can be limited to MS_SENDER with an
application access policy).

Outbox rows are the only way mail goes out: one row per PO approval (dedupe_key), retried with back-off on temporary errors
(throttling / 5xx / network), FAILED after max attempts or a permanent error. 'SENT' means Outlook accepted the message
for delivery (Graph 202) — it is not a delivery receipt.
"""
import asyncio
import base64
import logging
import os
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

import httpx
from fpdf import FPDF
from sqlalchemy import text

from app.core.database import async_session_factory

log = logging.getLogger("po_email")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_token: dict = {}


def configured() -> bool:
    return all(os.getenv(k) for k in ("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER"))


def valid_emails(s: Optional[str]) -> list[str]:
    return [e for e in (x.strip() for x in re.split(r"[;,]", s or "")) if EMAIL_RE.match(e)]


# ── PDF ───────────────────────────────────────────────────────────────────────
def _t(v) -> str:
    """fpdf core fonts are Latin-1: keep text printable (₹ -> Rs.)."""
    return str(v if v is not None else "").replace("₹", "Rs.").encode("latin-1", "replace").decode("latin-1")


async def po_data(db, po_id: int) -> dict:
    h = (await db.execute(text("""SELECT h.*, s.name AS vendor, s.email AS vendor_email, s.alt_email, s.gst_number AS vendor_gstin,
        s.address AS vendor_address, s.city AS vendor_city, s.phone AS vendor_phone, o.outlet_name AS deliver_to, o.address AS deliver_address,
        t.payment_terms, t.delivery_terms, u.name AS approved_by_name
        FROM po_headers h JOIN suppliers s ON s.id = h.supplier_id LEFT JOIN outlets o ON o.id = h.outlet_id
        LEFT JOIN supplier_po_terms t ON t.supplier_id = h.supplier_id LEFT JOIN users u ON u.id = h.approved_by WHERE h.id = :i"""),
        {"i": po_id})).mappings().first()
    if not h:
        raise ValueError("PO not found")
    items = (await db.execute(text("""SELECT p.item_code, p.name, p.hsn_code, COALESCE(NULLIF(i.order_qty, 0), i.qty) AS qty, i.rate, i.gst_percent,
        i.mrp, COALESCE(NULLIF(i.total, 0), i.amount) AS total FROM po_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = :i ORDER BY i.id"""),
        {"i": po_id})).mappings().all()
    terms = (await db.execute(text("SELECT title, description FROM po_terms_conditions WHERE po_id = :i ORDER BY sequence_no, id"), {"i": po_id})).mappings().all()
    co = (await db.execute(text("SELECT * FROM company_settings ORDER BY id LIMIT 1"))).mappings().first() or {}
    return {"h": dict(h), "items": [dict(i) for i in items], "terms": [dict(t) for t in terms], "co": dict(co)}


def build_pdf(d: dict) -> bytes:
    h, co = d["h"], d["co"]
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, _t(co.get("legal_name") or co.get("company_name") or co.get("brand_name") or "Company"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    for line in (co.get("ho_address"), f"GSTIN: {co.get('gstin') or '-'}   Phone: {co.get('ho_phone') or '-'}   Email: {co.get('ho_email') or '-'}"):
        if line:
            pdf.multi_cell(0, 4.5, _t(line), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, "PURCHASE ORDER", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    left = [f"PO No: {h['po_no']}", f"PO Date: {h['po_date']:%d-%m-%Y}", f"Expected delivery: {h['expected_date']:%d-%m-%Y}" if h["expected_date"] else "",
            f"Approved by: {h.get('approved_by_name') or '-'}"]
    right = [f"Vendor: {h['vendor']}", f"GSTIN: {h['vendor_gstin'] or '-'}", _t(f"{h['vendor_address'] or ''} {h['vendor_city'] or ''}").strip(),
             f"Deliver to: {h['deliver_to'] or 'Head Office'}"]
    for a, b in zip(left, right):
        pdf.cell(90, 5, _t(a))
        pdf.cell(0, 5, _t(b)[:95], new_x="LMARGIN", new_y="NEXT")
    if h.get("deliver_address"):
        pdf.cell(90, 5, "")
        pdf.multi_cell(0, 5, _t(h["deliver_address"])[:200], new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    cols = [("#", 8), ("Code", 22), ("Item", 62), ("HSN", 16), ("Qty", 16), ("Rate", 18), ("GST%", 12), ("MRP", 16), ("Amount", 20)]
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(230, 230, 230)
    for c, w in cols:
        pdf.cell(w, 6, c, border=1, fill=True, align="C")
    pdf.ln()
    pdf.set_font("Helvetica", "", 8)
    total = Decimal(0)
    for n, it in enumerate(d["items"], 1):
        amt = Decimal(str(it["total"] or 0))
        total += amt
        vals = [n, it["item_code"] or "", (it["name"] or "")[:40], it["hsn_code"] or "", f"{Decimal(str(it['qty'] or 0)).normalize():f}",
                f"{Decimal(str(it['rate'] or 0)):.2f}", f"{Decimal(str(it['gst_percent'] or 0)).normalize():f}", f"{Decimal(str(it['mrp'] or 0)):.2f}", f"{amt:.2f}"]
        for (c, w), v in zip(cols, vals):
            pdf.cell(w, 5.5, _t(v), border=1, align="R" if c in ("Qty", "Rate", "GST%", "MRP", "Amount", "#") else "L")
        pdf.ln()
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(sum(w for _, w in cols[:-1]), 6, "Total PO value (Rs.)", border=1, align="R")
    pdf.cell(cols[-1][1], 6, f"{Decimal(str(h['total_amount'] or total)):.2f}", border=1, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("Helvetica", "", 9)
    for label, val in (("Payment terms", h.get("payment_terms")), ("Delivery terms", h.get("delivery_terms")), ("Notes", h.get("notes"))):
        if val:
            pdf.multi_cell(0, 4.5, _t(f"{label}: {val}"), new_x="LMARGIN", new_y="NEXT")
    for t in d["terms"]:
        pdf.multi_cell(0, 4.5, _t(f"- {t['title']}{': ' + t['description'] if t['description'] else ''}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.cell(0, 5, _t(f"For {co.get('legal_name') or co.get('brand_name') or ''} — Authorised signatory"), align="R")
    return bytes(pdf.output())


def body_html(d: dict, signature: Optional[str]) -> str:
    h, co = d["h"], d["co"]
    rows = "".join(f"<tr><td>{_e(i['item_code'])}</td><td>{_e(i['name'])}</td><td align='right'>{Decimal(str(i['qty'] or 0)).normalize():f}</td>"
                   f"<td align='right'>{Decimal(str(i['rate'] or 0)):.2f}</td><td align='right'>{Decimal(str(i['gst_percent'] or 0)).normalize():f}%</td>"
                   f"<td align='right'>{Decimal(str(i['total'] or 0)):.2f}</td></tr>" for i in d["items"][:200])
    return f"""<p>Dear {_e(h['vendor'])},</p>
<p>Please find attached our approved Purchase Order <b>{_e(h['po_no'])}</b> dated {h['po_date']:%d-%m-%Y}.</p>
<p><b>Deliver to:</b> {_e(h['deliver_to'] or 'Head Office')}{'<br>' + _e(h['deliver_address']) if h.get('deliver_address') else ''}<br>
<b>Expected delivery:</b> {h['expected_date'].strftime('%d-%m-%Y') if h['expected_date'] else '-'}<br>
<b>Total PO value:</b> Rs. {Decimal(str(h['total_amount'] or 0)):.2f}<br>
<b>Payment terms:</b> {_e(h.get('payment_terms') or '-')}<br><b>Delivery terms:</b> {_e(h.get('delivery_terms') or '-')}</p>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px">
<tr><th>Code</th><th>Item</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>{rows}</table>
<p>Kindly confirm receipt and the delivery date.</p>
<p>{_e(signature or '')}<br>{_e(co.get('legal_name') or co.get('brand_name') or '')}<br>{_e(co.get('ho_address') or '')}<br>
Phone: {_e(co.get('ho_phone') or '-')} · Email: {_e(co.get('ho_email') or '-')}</p>"""


def _e(v) -> str:
    return str(v or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── outbox ────────────────────────────────────────────────────────────────────
async def enqueue(db, po_id: int, user_id: Optional[int], trigger: str = "APPROVAL") -> Optional[dict]:
    """Queue the vendor e-mail for a PO (inside the caller's transaction). Returns None when nothing should be sent."""
    st = (await db.execute(text("SELECT * FROM po_email_settings WHERE id = 1"))).mappings().first()
    if trigger == "APPROVAL" and not (st and st["auto_send"]):
        return None
    h = (await db.execute(text("""SELECT h.po_no, h.approval_status, h.approved_at, s.email, s.alt_email, s.name FROM po_headers h
        JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = :i"""), {"i": po_id})).mappings().first()
    if not h:
        raise ValueError("PO not found")
    if h["approval_status"] != "approved" and not (st and st["send_unapproved"]):
        raise ValueError(f"PO {h['po_no']} is not approved — it cannot be e-mailed to the vendor.")
    to = valid_emails(h["email"]) or valid_emails(h["alt_email"])
    if not to:
        raise ValueError(f"Vendor {h['name']} has no valid e-mail address in the Supplier Master.")
    key = f"po:{po_id}:{h['approved_at']:%Y%m%d%H%M%S}" if trigger == "APPROVAL" and h["approved_at"] else f"{trigger.lower()}:{po_id}:{uuid.uuid4().hex[:10]}"
    r = (await db.execute(text("""INSERT INTO po_email_outbox (po_id, po_no, to_email, cc, subject, dedupe_key, trigger, created_by)
        VALUES (:p, :no, :to, :cc, :s, :k, :t, :u) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id"""),
        {"p": po_id, "no": h["po_no"], "to": ", ".join(to), "cc": ", ".join(valid_emails(st["cc"] if st else None)) or None,
         "s": f"Purchase Order {h['po_no']}", "k": key, "t": trigger, "u": user_id})).scalar()
    return {"id": r, "duplicate": r is None, "to": to}


async def _graph_token(c: httpx.AsyncClient) -> str:
    if _token.get("exp", datetime.min) > datetime.utcnow() + timedelta(minutes=2):
        return _token["v"]
    r = await c.post(f"https://login.microsoftonline.com/{os.getenv('MS_TENANT_ID')}/oauth2/v2.0/token",
                     data={"client_id": os.getenv("MS_CLIENT_ID"), "client_secret": os.getenv("MS_CLIENT_SECRET"),
                           "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"})
    if r.status_code != 200:
        raise PermissionError(f"Microsoft sign-in failed ({r.status_code}): {r.json().get('error_description', '')[:200]}")
    j = r.json()
    _token.update(v=j["access_token"], exp=datetime.utcnow() + timedelta(seconds=int(j.get("expires_in", 3600))))
    return _token["v"]


async def send_one(row_id: int) -> str:
    """Send one outbox row. Returns its new status. Safe to call twice: the row is claimed with a status switch."""
    async with async_session_factory() as db:
        row = (await db.execute(text("""UPDATE po_email_outbox SET status = 'SENDING', attempts = attempts + 1
            WHERE id = :i AND status IN ('QUEUED','RETRY') RETURNING *"""), {"i": row_id})).mappings().first()
        await db.commit()
        if not row:
            return "SKIPPED"
        st = (await db.execute(text("SELECT * FROM po_email_settings WHERE id = 1"))).mappings().first()
        try:
            if not configured():
                raise PermissionError("Outlook (Microsoft Graph) is not configured on the server (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_SENDER).")
            d = await po_data(db, row["po_id"])
            pdf = build_pdf(d)
            msg = {"message": {"subject": row["subject"], "body": {"contentType": "HTML", "content": body_html(d, st["signature"] if st else None)},
                               "toRecipients": [{"emailAddress": {"address": a}} for a in valid_emails(row["to_email"])],
                               "ccRecipients": [{"emailAddress": {"address": a}} for a in valid_emails(row["cc"])],
                               "attachments": [{"@odata.type": "#microsoft.graph.fileAttachment", "name": f"{row['po_no']}.pdf",
                                                "contentType": "application/pdf", "contentBytes": base64.b64encode(pdf).decode()}]},
                   "saveToSentItems": True}
            if st and st["reply_to"] and valid_emails(st["reply_to"]):
                msg["message"]["replyTo"] = [{"emailAddress": {"address": valid_emails(st["reply_to"])[0]}}]
            async with httpx.AsyncClient(timeout=30) as c:
                tok = await _graph_token(c)
                r = await c.post(f"https://graph.microsoft.com/v1.0/users/{os.getenv('MS_SENDER')}/sendMail", json=msg,
                                 headers={"Authorization": f"Bearer {tok}", "client-request-id": str(uuid.uuid4())})
            if r.status_code == 202:
                status, err, ref = "SENT", None, r.headers.get("request-id")
            elif r.status_code in (429, 500, 502, 503, 504):
                status, err, ref = "RETRY", f"Outlook busy ({r.status_code}); will retry", None
            else:
                status, err, ref = "FAILED", f"Outlook refused ({r.status_code}): {r.text[:300]}", None
        except PermissionError as e:
            status, err, ref = "FAILED", str(e), None
        except (httpx.HTTPError, OSError) as e:
            status, err, ref = "RETRY", f"Network error: {type(e).__name__}", None
        except Exception as e:  # PDF / data problem: needs a person
            status, err, ref = "FAILED", f"{type(e).__name__}: {e}"[:300], None
        if status == "RETRY" and row["attempts"] >= (st["max_attempts"] if st else 5):
            status = "FAILED"
        await db.execute(text("""UPDATE po_email_outbox SET status = CAST(:s AS VARCHAR), last_error = :e, provider_ref = :r,
            sent_at = CASE WHEN CAST(:s AS VARCHAR) = 'SENT' THEN NOW() ELSE sent_at END,
            next_try_at = NOW() + (INTERVAL '1 minute' * POWER(2, LEAST(attempts, 8))) WHERE id = :i"""),
            {"s": status, "e": err, "r": ref, "i": row_id})
        await db.execute(text("""INSERT INTO audit_logs (module, action, record_id, record_no, description, user_id, user_name, created_at)
            VALUES ('purchase_order', 'po_email', :p, :no, :d, COALESCE(:u, 0), 'system', NOW())"""),
            {"p": row["po_id"], "no": row["po_no"], "d": f"PO e-mail to {row['to_email']}: {status}" + (f" — {err}" if err else ""), "u": row["created_by"]})
        await db.commit()
        return status


async def worker():
    """Background sender: due QUEUED / RETRY rows every 60 s (rows queued by a request are also sent right away)."""
    await asyncio.sleep(30)
    while True:
        try:
            async with async_session_factory() as db:
                ids = (await db.execute(text("SELECT id FROM po_email_outbox WHERE status IN ('QUEUED','RETRY') AND next_try_at <= NOW() ORDER BY id LIMIT 20"))).scalars().all()
            for i in ids:
                await send_one(i)
        except Exception:
            log.exception("po email worker")
        await asyncio.sleep(60)


if __name__ == "__main__":
    from datetime import date
    d = {"h": {"po_no": "PO-T-1", "po_date": date(2026, 10, 28), "expected_date": None, "vendor": "ABC Foods", "vendor_gstin": "07AAACG1234F1Z6",
               "vendor_address": "MG Road", "vendor_city": "Delhi", "deliver_to": "Store 1", "deliver_address": "CP", "total_amount": Decimal("1180"),
               "payment_terms": "30 days", "delivery_terms": "Door delivery", "notes": None, "approved_by_name": "Admin"},
         "items": [{"item_code": "A1", "name": "Tea ₹ 500g", "hsn_code": "0902", "qty": 10, "rate": 100, "gst_percent": 18, "mrp": 150, "total": 1180}],
         "terms": [{"title": "Quality", "description": "As per sample"}], "co": {"legal_name": "Nutribray", "gstin": "07AAACG1234F1Z6"}}
    b = build_pdf(d)
    assert b[:4] == b"%PDF" and len(b) > 1000
    assert valid_emails("a@b.com; bad, c@d.in") == ["a@b.com", "c@d.in"]
    assert "PO-T-1" in body_html(d, "Purchase team")
    print("po_email_service OK", len(b), "bytes")
