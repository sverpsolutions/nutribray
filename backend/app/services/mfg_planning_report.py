"""Material-requirement report (Excel / PDF / e-mail) built from the same data as the Material Planning screen.

A report is a list of sections; each section is one customer order (customer, order no, product, qty, due, BOM in the heading
and its material lines underneath) or the all-orders material totals. Excel = one sheet per section, PDF = one page per section.
"""
import base64
import io
import os
import uuid
from datetime import datetime
from decimal import Decimal

import httpx
from fpdf import FPDF
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import text

from app.services import po_email_service as pe

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TYPE = {"RM": "Raw", "PM": "Packing", "FG": "Finished", "SFG": "Semi", "CONS": "Consumable", "OTH": "Other"}
LINE_COLS = ["Code", "Material", "Type", "Required", "Unit", "Plant stock", "Available", "Shortage", "Warehouse", "PO pending", "To buy", "Status"]
TOTAL_COLS = ["Code", "Material", "Type", "Orders", "Total required", "Unit", "Plant stock", "Warehouse", "PO pending", "Still to buy"]


def n(v) -> float:
    return round(float(v or 0), 3)


async def company(db) -> str:
    r = (await db.execute(text("SELECT mfg_company_name, legal_name, brand_name FROM company_settings ORDER BY id LIMIT 1"))).mappings().first() or {}
    return r.get("mfg_company_name") or r.get("legal_name") or r.get("brand_name") or "Nutribay"


def _line(l: dict) -> list:
    return [l["item_code"], l["item"], TYPE.get(l["item_type"], l["item_type"]), n(l["net_required"]), l["unit"], n(l["plant"]), n(l["available"]),
            n(l["shortage"]) or "", n(l["warehouse"]), n(l["pending_po"]) or "", n(l["purchase_suggested"]) or "", l["status"]]


def sections(orders: list[dict], consolidated: list[dict], scope: str) -> list[dict]:
    """scope: 'all' (every open order + totals), 'totals' (material totals only) or 'SO:<id>' / 'MO:<id>' (one order)."""
    out = []
    if scope in ("all", "totals"):
        out.append({"name": "All materials", "title": "Material requirement - all open orders", "meta": [("Open orders", len(orders))],
                    "cols": TOTAL_COLS,
                    "rows": [[t["item_code"], t["item"], TYPE.get(t["item_type"], t["item_type"]), t["orders"], n(t["required"]), t["unit"], n(t["plant"]),
                              n(t["warehouse"]), n(t["pending_po"]), n(t["to_buy"]) or ""] for t in consolidated]})
    if scope != "totals":
        for o in orders:
            if scope != "all" and scope != f"{o['kind']}:{o['id']}":
                continue
            out.append({"name": o["order_no"], "title": f"Material requirement - {o['order_no']}",
                        "meta": [("Customer", o.get("customer") or "Own stock"), ("Order no", o["order_no"]), ("Product", o["product"]),
                                 ("Order quantity (units)", n(o["qty"])), ("Due date", str(o.get("need_by") or "-")), ("Priority", o.get("priority")),
                                 ("BOM", o.get("bom") or "-"), ("Overall", (o.get("overall") or {}).get("label", ""))],
                        "cols": LINE_COLS, "rows": [_line(l) for l in o["lines"]]})
    return out


def build_xlsx(co: str, secs: list[dict]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    for s in secs:
        nm = "".join(c for c in s["name"] if c not in '[]:*?/\\')[:28] or "Sheet"
        while nm in used:
            nm = nm[:25] + str(len(used))
        used.add(nm)
        ws = wb.create_sheet(nm)
        ws["A1"] = co
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = s["title"]
        ws["A2"].font = Font(bold=True, size=12)
        ws["A3"] = "Generated " + datetime.now().strftime("%d-%m-%Y %H:%M")
        r = 5
        for k, v in s["meta"]:
            ws.cell(row=r, column=1, value=k).font = Font(bold=True)
            ws.cell(row=r, column=2, value=v)
            r += 1
        r += 1
        for i, c in enumerate(s["cols"], 1):
            h = ws.cell(row=r, column=i, value=c)
            h.font = Font(bold=True, color="FFFFFF")
            h.fill = PatternFill("solid", fgColor="4F46E5")
            h.alignment = Alignment(horizontal="center", wrap_text=True)
        for row in s["rows"]:
            r += 1
            for i, v in enumerate(row, 1):
                ws.cell(row=r, column=i, value=v)
        for i, c in enumerate(s["cols"], 1):
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = 38 if c in ("Material", "Item") else max(12, len(c) + 3)
        ws.freeze_panes = ws.cell(row=r - len(s["rows"]), column=1) if s["rows"] else None
    if not wb.sheetnames:
        wb.create_sheet("Empty")
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def build_pdf(co: str, secs: list[dict]) -> bytes:
    pdf = FPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(True, 12)
    for s in secs:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 8, pe._t(co), ln=1)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, pe._t(s["title"]), ln=1)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 5, "Generated " + datetime.now().strftime("%d-%m-%Y %H:%M"), ln=1)
        pdf.ln(1)
        for k, v in s["meta"]:
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(48, 5, pe._t(k))
            pdf.set_font("Helvetica", "", 9)
            pdf.cell(0, 5, pe._t(str(v).replace('—', '-').replace('–', '-')), ln=1)
        pdf.ln(2)
        cols = s["cols"]
        w = [30 if c == "Code" else 62 if c in ("Material", "Item") else 40 if c == "Status" else 28 if c in ("Brand", "Reason", "Remarks") else 19 for c in cols]
        scale = 277 / sum(w)
        w = [x * scale for x in w]
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(79, 70, 229)
        pdf.set_text_color(255, 255, 255)
        for c, x in zip(cols, w):
            pdf.cell(x, 6, pe._t(c), border=1, fill=True, align="C")
        pdf.ln()
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 8)
        for row in s["rows"]:
            for v, x, c in zip(row, w, cols):
                txt = pe._t(str(v).replace('—', '-').replace('–', '-'))
                lim = int(x / 1.55)
                pdf.cell(x, 5.5, txt[:lim], border=1, align="L" if c in ("Code", "Material", "Item", "Status", "Type", "Unit", "Brand", "Batch", "Reason", "Remarks") else "R")
            pdf.ln()
    if not secs:
        pdf.add_page()
        pdf.cell(0, 8, "No open orders.")
    return bytes(pdf.output())


async def send_mail(to: list[str], cc: list[str], subject: str, body: str, files: list[tuple[str, str, bytes]]) -> None:
    """Outlook / Microsoft Graph, the same mailbox the PO e-mails use. Raises PermissionError when it is not configured."""
    if not pe.configured():
        raise PermissionError("E-mail is not configured on the server (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_SENDER).")
    msg = {"message": {"subject": subject, "body": {"contentType": "Text", "content": body},
                       "toRecipients": [{"emailAddress": {"address": a}} for a in to],
                       "ccRecipients": [{"emailAddress": {"address": a}} for a in cc],
                       "attachments": [{"@odata.type": "#microsoft.graph.fileAttachment", "name": nm, "contentType": ct,
                                        "contentBytes": base64.b64encode(data).decode()} for nm, ct, data in files]}, "saveToSentItems": True}
    async with httpx.AsyncClient(timeout=40) as c:
        tok = await pe._graph_token(c)
        r = await c.post(f"https://graph.microsoft.com/v1.0/users/{os.getenv('MS_SENDER')}/sendMail", json=msg,
                         headers={"Authorization": f"Bearer {tok}", "client-request-id": str(uuid.uuid4())})
    if r.status_code != 202:
        raise RuntimeError(f"Outlook refused the mail ({r.status_code}): {r.text[:200]}")
