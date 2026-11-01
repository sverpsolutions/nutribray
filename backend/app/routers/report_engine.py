"""Report engine (NCG reports port): every report is one function registered with @report(...).

GET  /reports/x                → catalog (title, group, filters) for the Report Center
GET  /reports/x/{key}          → {columns, rows, sections?, notes?}; totals are added on the screen
GET  /reports/x/gstr1/json     → GSTR-1 JSON for the GST offline tool / portal upload
GET  /reports/x/tally/xml      → Tally XML (sales or purchase vouchers)
POST /reports/x/gst2b_recon    → GSTR-2B JSON vs purchase register

Every query goes through _where(): the chosen outlet, the user's outlets and (for item reports) the user's
categories / groups from User Management. Bill-level reports refuse category-limited users, like the rest.
"""
import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import access
from app.core.database import get_db
from app.core.dependencies import get_current_user

router = APIRouter(prefix="/reports/x", tags=["reports"], dependencies=[Depends(get_current_user)])

REPORTS: dict[str, dict] = {}
ACTIVE = "i.status <> 'cancelled'"
SALE = f"i.invoice_type <> 'return' AND {ACTIVE}"
RET = f"i.invoice_type = 'return' AND {ACTIVE}"
ITEM_JOIN = "JOIN products p ON p.id = ii.product_id"
UQC = {"PCS": "NOS", "NOS": "NOS", "KG": "KGS", "KGS": "KGS", "GM": "GMS", "GMS": "GMS", "LTR": "LTR", "L": "LTR",
       "ML": "MLT", "BOX": "BOX", "PKT": "PAC", "PAC": "PAC", "DOZ": "DOZ", "MTR": "MTR", "BTL": "BTL", "CTN": "CTN"}


@dataclass
class F:
    fd: date
    td: date
    outlet_id: Optional[int]
    category_id: Optional[int]
    brand_id: Optional[int]
    supplier_id: Optional[int]
    search: str
    month: Optional[str]
    user_id: Optional[int] = None


def report(key, title, group, module, filters=("date", "outlet"), note="", bill_level=False, download=None, upload=False):
    def deco(fn):
        REPORTS[key] = dict(key=key, title=title, group=group, module=module, filters=list(filters), note=note,
                            bill_level=bill_level, download=download, upload=upload, fn=fn)
        return fn
    return deco


def col(key, label, kind="text"):
    return {"key": key, "label": label, "type": kind}   # text | num | qty | money | pct | date


def _where(f: F, p: dict, outlet_col="i.outlet_id", prod: Optional[str] = None) -> str:
    sql = ""
    if f.outlet_id:
        sql += f" AND {outlet_col} = :oid"
        p["oid"] = f.outlet_id
    sql += access.outlet_filter(outlet_col, p)
    if prod:
        sql += access.product_filter(prod, p)
        if f.category_id:
            sql += f" AND {prod}.category_id = :cat"
            p["cat"] = f.category_id
        if f.brand_id:
            sql += f" AND {prod}.brand_id = :brand"
            p["brand"] = f.brand_id
    return sql


def _month(f: F) -> tuple[date, date]:
    """GST reports run on a return period (YYYY-MM); default = last month."""
    if f.month and re.fullmatch(r"\d{4}-\d{2}", f.month):
        y, m = map(int, f.month.split("-"))
    else:
        last = date.today().replace(day=1) - timedelta(days=1)
        y, m = last.year, last.month
    start = date(y, m, 1)
    end = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
    return start, end


async def _rows(db, sql, p):
    return [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in (await db.execute(text(sql), p)).mappings().all()]


async def _company_state(db) -> str:
    return (await db.execute(text("SELECT COALESCE(NULLIF(state_code, ''), LEFT(gstin, 2), '') FROM company_settings ORDER BY id LIMIT 1"))).scalar() or ""


POS = "COALESCE(NULLIF(c.state_code, ''), NULLIF(LEFT(c.gst_number, 2), ''), :cs)"
REGD = "(c.gst_number IS NOT NULL AND LENGTH(TRIM(c.gst_number)) = 15)"


# ═══ GST pack ════════════════════════════════════════════════════════════════

@report("gstr1_b2b", "GSTR-1 · B2B invoices (4A)", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="Sales to GST-registered customers, rate-wise per invoice as the GST portal needs.", download="gstr1")
async def gstr1_b2b(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td, "cs": await _company_state(db)}
    rows = await _rows(db, f"""
        SELECT c.gst_number AS gstin, c.name AS customer, i.invoice_no, i.invoice_date, {POS} AS pos,
               i.total_amount AS invoice_value, ii.gst_percent AS rate, SUM(ii.taxable_amt) AS taxable,
               SUM(ii.igst_amount) AS igst, SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {SALE} AND {REGD} {_where(f, p)}
        GROUP BY c.gst_number, c.name, i.id, i.invoice_no, i.invoice_date, c.state_code, i.total_amount, ii.gst_percent
        ORDER BY i.invoice_date, i.invoice_no, ii.gst_percent""", p)
    return {"columns": [col("gstin", "GSTIN"), col("customer", "Customer"), col("invoice_no", "Invoice no"), col("invoice_date", "Date", "date"),
                        col("pos", "Place of supply"), col("invoice_value", "Invoice value", "money"), col("rate", "Rate %", "pct"),
                        col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")],
            "rows": rows, "notes": [f"Return period {fd:%b %Y}"]}


@report("gstr1_b2cl", "GSTR-1 · B2C Large (5)", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="Inter-state sales to unregistered buyers above ₹1,00,000 per invoice.")
async def gstr1_b2cl(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td, "cs": await _company_state(db)}
    rows = await _rows(db, f"""
        SELECT i.invoice_no, i.invoice_date, {POS} AS pos, i.total_amount AS invoice_value, ii.gst_percent AS rate,
               SUM(ii.taxable_amt) AS taxable, SUM(ii.igst_amount) AS igst
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {SALE} AND NOT {REGD} AND i.total_amount > 100000
          AND ({POS} <> :cs OR i.is_interstate) {_where(f, p)}
        GROUP BY i.id, i.invoice_no, i.invoice_date, c.state_code, c.gst_number, i.total_amount, ii.gst_percent
        ORDER BY i.invoice_date""", p)
    return {"columns": [col("invoice_no", "Invoice no"), col("invoice_date", "Date", "date"), col("pos", "Place of supply"),
                        col("invoice_value", "Invoice value", "money"), col("rate", "Rate %", "pct"), col("taxable", "Taxable", "money"),
                        col("igst", "IGST", "money")], "rows": rows}


@report("gstr1_b2cs", "GSTR-1 · B2C Small (7)", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="All other sales to unregistered buyers, net of their returns, by place of supply and rate.")
async def gstr1_b2cs(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td, "cs": await _company_state(db)}
    rows = await _rows(db, f"""
        SELECT {POS} AS pos, CASE WHEN {POS} = :cs AND NOT i.is_interstate THEN 'Intra-state' ELSE 'Inter-state' END AS supply,
               ii.gst_percent AS rate,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.taxable_amt) AS taxable,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.igst_amount) AS igst,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.cgst_amount) AS cgst,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.sgst_amount) AS sgst
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} AND NOT {REGD}
          AND NOT (i.invoice_type <> 'return' AND i.total_amount > 100000 AND ({POS} <> :cs OR i.is_interstate)) {_where(f, p)}
        GROUP BY 1, 2, 3 ORDER BY 1, 3""", p)
    return {"columns": [col("pos", "Place of supply"), col("supply", "Supply"), col("rate", "Rate %", "pct"), col("taxable", "Taxable", "money"),
                        col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], "rows": rows}


@report("gstr1_cdnr", "GSTR-1 · Credit notes to registered (9B)", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="Sales returns / credit notes issued to GST-registered customers.")
async def gstr1_cdnr(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td, "cs": await _company_state(db)}
    rows = await _rows(db, f"""
        SELECT c.gst_number AS gstin, c.name AS customer, i.invoice_no AS note_no, i.invoice_date AS note_date,
               i.ref_invoice_no AS original_invoice, {POS} AS pos, i.total_amount AS note_value, ii.gst_percent AS rate,
               SUM(ii.taxable_amt) AS taxable, SUM(ii.igst_amount) AS igst, SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {RET} AND {REGD} {_where(f, p)}
        GROUP BY c.gst_number, c.name, i.id, i.invoice_no, i.invoice_date, i.ref_invoice_no, c.state_code, i.total_amount, ii.gst_percent
        ORDER BY i.invoice_date""", p)
    return {"columns": [col("gstin", "GSTIN"), col("customer", "Customer"), col("note_no", "Credit note"), col("note_date", "Date", "date"),
                        col("original_invoice", "Original invoice"), col("pos", "Place of supply"), col("note_value", "Note value", "money"),
                        col("rate", "Rate %", "pct"), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"),
                        col("cgst", "CGST", "money"), col("sgst", "SGST", "money")], "rows": rows}


@report("hsn_sales", "HSN summary · Sales (GSTR-1 Table 12)", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="HSN-wise outward supplies net of returns, split B2B / B2C as required from 2025.")
async def hsn_sales(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td}
    rows = await _rows(db, f"""
        SELECT COALESCE(NULLIF(ii.hsn_code, ''), 'NA') AS hsn, CASE WHEN {REGD} THEN 'B2B' ELSE 'B2C' END AS supply,
               UPPER(COALESCE(ii.unit, 'PCS')) AS unit, ii.gst_percent AS rate,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.qty) AS qty,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.taxable_amt) AS taxable,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.igst_amount) AS igst,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.cgst_amount) AS cgst,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.sgst_amount) AS sgst,
               SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.total) AS total_value
        FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} {_where(f, p)}
        GROUP BY 1, 2, 3, 4 ORDER BY 2, 1, 4""", p)
    for r in rows:
        r["uqc"] = UQC.get(r.pop("unit"), "OTH")
    return {"columns": [col("supply", "B2B / B2C"), col("hsn", "HSN"), col("uqc", "UQC"), col("rate", "Rate %", "pct"), col("qty", "Qty", "qty"),
                        col("taxable", "Taxable", "money"), col("igst", "IGST", "money"), col("cgst", "CGST", "money"),
                        col("sgst", "SGST", "money"), col("total_value", "Total value", "money")], "rows": rows}


async def _purchase_tax(db, f: F, fd, td):
    """Purchase register with the GST split (purchases store total GST; IGST when the supplier is in another state)."""
    p = {"fd": fd, "td": td, "cs": await _company_state(db)}
    st = "COALESCE(NULLIF(s.state_code, ''), NULLIF(LEFT(s.gst_number, 2), ''), :cs)"
    return await _rows(db, f"""
        SELECT 'GRN' AS doc, g.purchase_no AS doc_no, g.invoice_no, g.invoice_date, s.name AS supplier, s.gst_number AS gstin,
               g.taxable_amount AS taxable,
               CASE WHEN {st} <> :cs THEN g.total_gst ELSE 0 END AS igst,
               CASE WHEN {st} = :cs THEN ROUND(g.total_gst / 2, 2) ELSE 0 END AS cgst,
               CASE WHEN {st} = :cs THEN g.total_gst - ROUND(g.total_gst / 2, 2) ELSE 0 END AS sgst,
               g.total_amount AS total
        FROM unit_wise_purchases g JOIN suppliers s ON s.id = g.supplier_id
        WHERE g.invoice_date BETWEEN :fd AND :td AND g.status NOT IN ('draft', 'cancelled') {_where(f, p, "g.outlet_id")}
        UNION ALL
        SELECT 'Debit note', r.prn_no, r.ref_purchase_no, r.return_date, s.name, s.gst_number,
               -r.taxable_amount, -r.igst_amount, -r.cgst_amount, -r.sgst_amount, -r.total_amount
        FROM unit_wise_purchase_returns r JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.return_date BETWEEN :fd AND :td AND COALESCE(r.status, '') <> 'cancelled' {_where(f, p, "r.outlet_id")}
        ORDER BY 4, 2""", p)


@report("itc_register", "GSTR-2 · Purchase / ITC register", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="Input tax credit from GRNs, less debit notes (purchase returns). Supplier state decides IGST vs CGST+SGST.")
async def itc_register(db, f: F):
    fd, td = _month(f)
    return {"columns": [col("doc", "Type"), col("doc_no", "Doc no"), col("invoice_no", "Supplier invoice"), col("invoice_date", "Date", "date"),
                        col("supplier", "Supplier"), col("gstin", "GSTIN"), col("taxable", "Taxable", "money"), col("igst", "IGST", "money"),
                        col("cgst", "CGST", "money"), col("sgst", "SGST", "money"), col("total", "Total", "money")],
            "rows": await _purchase_tax(db, f, fd, td)}


@report("hsn_purchase", "HSN summary · Purchase", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True)
async def hsn_purchase(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td}
    rows = await _rows(db, f"""
        SELECT COALESCE(NULLIF(gi.hsn_code, ''), 'NA') AS hsn, gi.gst_percent AS rate, SUM(gi.qty + COALESCE(gi.free_qty, 0)) AS qty,
               SUM(COALESCE(gi.taxable_amount, gi.taxable_amt)) AS taxable, SUM(gi.gst_amount) AS gst, SUM(gi.total) AS total_value
        FROM unit_wise_purchases g JOIN unit_wise_purchase_items gi ON gi.purchase_id = g.id
        WHERE g.invoice_date BETWEEN :fd AND :td AND g.status NOT IN ('draft', 'cancelled') {_where(f, p, "g.outlet_id")}
        GROUP BY 1, 2 ORDER BY 1, 2""", p)
    return {"columns": [col("hsn", "HSN"), col("rate", "Rate %", "pct"), col("qty", "Qty", "qty"), col("taxable", "Taxable", "money"),
                        col("gst", "GST", "money"), col("total_value", "Total value", "money")], "rows": rows}


@report("gstr3b", "GSTR-3B summary", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True,
        note="Outward tax (3.1) less eligible ITC (4) = net tax. Check against the portal before filing.")
async def gstr3b(db, f: F):
    fd, td = _month(f)
    p = {"fd": fd, "td": td}
    s = (await _rows(db, f"""
        SELECT
          COALESCE(SUM(sg * ii.taxable_amt) FILTER (WHERE ii.gst_percent > 0), 0) AS t_taxable,
          COALESCE(SUM(sg * ii.igst_amount), 0) AS t_igst, COALESCE(SUM(sg * ii.cgst_amount), 0) AS t_cgst,
          COALESCE(SUM(sg * ii.sgst_amount), 0) AS t_sgst,
          COALESCE(SUM(sg * ii.taxable_amt) FILTER (WHERE ii.gst_percent = 0), 0) AS nil_taxable
        FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id,
             LATERAL (SELECT CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END AS sg) x
        WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} {_where(f, p)}""", p))[0]
    itc = await _purchase_tax(db, f, fd, td)
    ig, cg, sg = (sum(r[k] or 0 for r in itc) for k in ("igst", "cgst", "sgst"))
    rows = [
        {"section": "3.1(a)", "description": "Outward taxable supplies (net of returns)", "taxable": s["t_taxable"],
         "igst": s["t_igst"], "cgst": s["t_cgst"], "sgst": s["t_sgst"]},
        {"section": "3.1(c)", "description": "Nil-rated / exempt supplies", "taxable": s["nil_taxable"], "igst": 0, "cgst": 0, "sgst": 0},
        {"section": "4(A)(5)", "description": "ITC — all other (GRNs less debit notes)", "taxable": sum(r["taxable"] or 0 for r in itc),
         "igst": ig, "cgst": cg, "sgst": sg},
    ]
    net = {k: round(rows[0][k] - rows[2][k], 2) for k in ("igst", "cgst", "sgst")}
    rows.append({"section": "6.1", "description": "Net tax payable (before cross-utilisation & cash ledger)", "taxable": None, **net})
    for r in rows:
        r["total_tax"] = round(sum(r[k] or 0 for k in ("igst", "cgst", "sgst")), 2)
    return {"columns": [col("section", "Table"), col("description", "Description"), col("taxable", "Taxable", "money"),
                        col("igst", "IGST", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money"),
                        col("total_tax", "Total tax", "money")], "rows": rows, "no_totals": True, "notes": [f"Return period {fd:%b %Y}"]}


@report("gst2b_recon", "GSTR-2B reconciliation", "GST Returns", "rep_gst", ("month", "outlet"), bill_level=True, upload=True,
        note="Upload the GSTR-2B JSON downloaded from the GST portal; it is matched against your GRNs by supplier GSTIN + invoice number.")
async def gst2b_recon(db, f: F, b2b: Optional[list] = None):
    fd, td = _month(f)
    books = [r for r in await _purchase_tax(db, f, fd, td) if r["doc"] == "GRN"]
    if b2b is None:
        return {"columns": [col("status", "Status")], "rows": [], "notes": ["Choose the GSTR-2B JSON file for this month and press Run."]}
    norm = lambda s: re.sub(r"[^A-Z0-9]", "", str(s or "").upper()).lstrip("0")
    key = lambda gstin, inv: (str(gstin or "").upper(), norm(inv))
    mine = {key(r["gstin"], r["invoice_no"]): r for r in books}
    rows, seen = [], set()
    for sup in b2b:
        for inv in sup.get("inv", []):
            k = key(sup.get("ctin"), inv.get("inum"))
            tax = sum(float(it.get(x, 0) or 0) for it in inv.get("items", []) for x in ("igst", "cgst", "sgst"))
            taxable = sum(float(it.get("txval", 0) or 0) for it in inv.get("items", []))
            b = mine.get(k)
            seen.add(k)
            if not b:
                status = "Only in 2B (not entered)"
            else:
                btax = (b["igst"] or 0) + (b["cgst"] or 0) + (b["sgst"] or 0)
                status = "Matched" if abs(btax - tax) <= 1 and abs((b["taxable"] or 0) - taxable) <= 1 else "Amount mismatch"
            rows.append({"status": status, "gstin": sup.get("ctin"), "supplier": sup.get("trdnm") or (b or {}).get("supplier"),
                         "invoice_no": inv.get("inum"), "invoice_date": inv.get("dt"), "taxable_2b": taxable, "tax_2b": tax,
                         "taxable_books": (b or {}).get("taxable"), "tax_books": ((b["igst"] or 0) + (b["cgst"] or 0) + (b["sgst"] or 0)) if b else None})
    for k, b in mine.items():
        if k not in seen:
            rows.append({"status": "Only in books (supplier not filed)", "gstin": b["gstin"], "supplier": b["supplier"], "invoice_no": b["invoice_no"],
                         "invoice_date": b["invoice_date"], "taxable_2b": None, "tax_2b": None, "taxable_books": b["taxable"],
                         "tax_books": (b["igst"] or 0) + (b["cgst"] or 0) + (b["sgst"] or 0)})
    rows.sort(key=lambda r: (r["status"] != "Matched", r["status"], str(r["supplier"])))
    return {"columns": [col("status", "Status"), col("gstin", "GSTIN"), col("supplier", "Supplier"), col("invoice_no", "Invoice no"),
                        col("invoice_date", "Date"), col("taxable_2b", "Taxable (2B)", "money"), col("tax_2b", "Tax (2B)", "money"),
                        col("taxable_books", "Taxable (books)", "money"), col("tax_books", "Tax (books)", "money")], "rows": rows}


# ═══ Daily operations ════════════════════════════════════════════════════════

@report("day_end", "Day-end metrics", "Daily Operations", "rep_sales", ("date", "outlet"), bill_level=True,
        note="One line per outlet per day: bills, sales, returns, discounts, collections by mode, cash short / excess.")
async def day_end(db, f: F):
    p = {"fd": f.fd, "td": f.td}
    w = _where(f, p)
    rows = await _rows(db, f"""
        WITH s AS (
          SELECT i.outlet_id, i.invoice_date AS day,
                 COUNT(*) FILTER (WHERE i.invoice_type <> 'return') AS bills,
                 COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_type <> 'return'), 0) AS sales,
                 COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_type = 'return'), 0) AS returns,
                 COALESCE(SUM(i.discount + COALESCE(i.cd_amount, 0)) FILTER (WHERE i.invoice_type <> 'return'), 0) AS discount,
                 COALESCE(SUM(i.total_gst) FILTER (WHERE i.invoice_type <> 'return'), 0) AS gst,
                 COALESCE(SUM(i.due_amount) FILTER (WHERE i.invoice_type <> 'return'), 0) AS credit,
                 MIN(i.invoice_datetime) AS first_bill, MAX(i.invoice_datetime) AS last_bill
          FROM unit_wise_invoices i WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} {w} GROUP BY 1, 2),
        pm AS (
          SELECT i.outlet_id, py.payment_date AS day,
                 COALESCE(SUM(py.amount) FILTER (WHERE LOWER(py.payment_mode) = 'cash'), 0) AS cash,
                 COALESCE(SUM(py.amount) FILTER (WHERE LOWER(py.payment_mode) = 'card'), 0) AS card,
                 COALESCE(SUM(py.amount) FILTER (WHERE LOWER(py.payment_mode) = 'upi'), 0) AS upi,
                 COALESCE(SUM(py.amount) FILTER (WHERE LOWER(py.payment_mode) NOT IN ('cash', 'card', 'upi')), 0) AS other
          FROM unit_wise_payments py JOIN unit_wise_invoices i ON i.id = py.invoice_id
          WHERE py.payment_date BETWEEN :fd AND :td {w} GROUP BY 1, 2)
        SELECT s.day, o.outlet_name AS outlet, s.bills, s.sales, s.returns, s.sales - s.returns AS net_sales,
               CASE WHEN s.bills > 0 THEN ROUND(s.sales / s.bills, 2) END AS avg_bill, s.discount, s.gst,
               COALESCE(pm.cash, 0) AS cash, COALESCE(pm.card, 0) AS card, COALESCE(pm.upi, 0) AS upi, COALESCE(pm.other, 0) AS other,
               s.credit, TO_CHAR(s.first_bill, 'HH24:MI') AS first_bill, TO_CHAR(s.last_bill, 'HH24:MI') AS last_bill,
               d.status AS day_status, COALESCE(d.total_shortage, 0) AS shortage, COALESCE(d.total_excess, 0) AS excess
        FROM s JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN pm ON pm.outlet_id = s.outlet_id AND pm.day = s.day
        LEFT JOIN business_days d ON d.outlet_id = s.outlet_id AND d.business_date = s.day
        ORDER BY s.day DESC, o.outlet_name""", p)
    return {"columns": [col("day", "Date", "date"), col("outlet", "Outlet"), col("bills", "Bills", "num"), col("sales", "Sales", "money"),
                        col("returns", "Returns", "money"), col("net_sales", "Net sales", "money"), col("avg_bill", "Avg bill", "money"),
                        col("discount", "Discount", "money"), col("gst", "GST", "money"), col("cash", "Cash", "money"), col("card", "Card", "money"),
                        col("upi", "UPI", "money"), col("other", "Other", "money"), col("credit", "Credit", "money"),
                        col("first_bill", "First bill"), col("last_bill", "Last bill"), col("day_status", "Day"),
                        col("shortage", "Short", "money"), col("excess", "Excess", "money")], "rows": rows}


@report("counter_summary", "Counter / cashier summary", "Daily Operations", "rep_sales", ("date", "outlet"), bill_level=True,
        note="Every cashier shift: bills, sales, collections by mode, expected vs counted cash.")
async def counter_summary(db, f: F):
    p = {"fd": f.fd, "td": f.td}
    rows = await _rows(db, f"""
        SELECT s.business_date AS day, o.outlet_name AS outlet, u.name AS cashier, s.terminal_no AS counter, 'Shift ' || COALESCE(s.shift_no, 1) || ' · ' || s.shift_name AS shift,
               TO_CHAR(s.opened_at, 'HH24:MI') AS opened, TO_CHAR(s.closed_at, 'HH24:MI') AS closed, s.status,
               (SELECT COUNT(*) FROM unit_wise_invoices i WHERE i.shift_id = s.id AND {SALE}) AS bills,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM unit_wise_invoices i WHERE i.shift_id = s.id AND {SALE}) AS sales,
               (SELECT COALESCE(SUM(i.total_amount), 0) FROM unit_wise_invoices i WHERE i.shift_id = s.id AND {RET}) AS returns,
               (SELECT COALESCE(SUM(amount), 0) FROM unit_wise_payments WHERE shift_id = s.id AND LOWER(payment_mode) = 'cash') AS cash,
               (SELECT COALESCE(SUM(amount), 0) FROM unit_wise_payments WHERE shift_id = s.id AND LOWER(payment_mode) = 'card') AS card,
               (SELECT COALESCE(SUM(amount), 0) FROM unit_wise_payments WHERE shift_id = s.id AND LOWER(payment_mode) = 'upi') AS upi,
               s.opening_cash, s.expected_cash, s.actual_cash, COALESCE(s.short_amount, 0) AS short, COALESCE(s.excess_amount, 0) AS excess
        FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id LEFT JOIN outlets o ON o.id = s.outlet_id
        WHERE s.business_date BETWEEN :fd AND :td {_where(f, p, "s.outlet_id")}
        ORDER BY s.business_date DESC, o.outlet_name, s.opened_at""", p)
    return {"columns": [col("day", "Date", "date"), col("outlet", "Outlet"), col("cashier", "Cashier"), col("counter", "Counter"),
                        col("shift", "Shift"), col("opened", "Opened"), col("closed", "Closed"), col("status", "Status"),
                        col("bills", "Bills", "num"), col("sales", "Sales", "money"), col("returns", "Returns", "money"),
                        col("cash", "Cash", "money"), col("card", "Card", "money"), col("upi", "UPI", "money"),
                        col("opening_cash", "Opening cash", "money"), col("expected_cash", "Expected cash", "money"),
                        col("actual_cash", "Counted cash", "money"), col("short", "Short", "money"), col("excess", "Excess", "money")], "rows": rows}


@report("stock_grid", "Stock location grid", "Daily Operations", "rep_stock", ("outlet", "category", "brand", "search"),
        note="Current stock of every item in every outlet side by side.")
async def stock_grid(db, f: F):
    p = {"q": f"%{f.search.strip()}%"}
    data = await _rows(db, f"""
        SELECT p.id, p.item_code, p.name, COALESCE(c.name, p.category) AS category, os.outlet_id, os.stock_qty, COALESCE(p.cost_price, 0) AS cost
        FROM outlet_stock os JOIN products p ON p.id = os.product_id LEFT JOIN item_categories c ON c.id = p.category_id
        WHERE (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR p.barcode ILIKE :q) {_where(f, p, "os.outlet_id", "p")}
        ORDER BY p.name""", p)
    outs = sorted({d["outlet_id"] for d in data})
    names = dict((await db.execute(text("SELECT id, COALESCE(NULLIF(short_name, ''), unit_code, outlet_name) FROM outlets WHERE id = ANY(:o)"),
                                   {"o": outs or [0]})).all())
    items: dict[int, dict] = {}
    for d in data:
        r = items.setdefault(d["id"], {"item_code": d["item_code"], "name": d["name"], "category": d["category"], "total": 0, "cost": d["cost"]})
        r[f"o{d['outlet_id']}"] = d["stock_qty"]
        r["total"] += d["stock_qty"] or 0
    rows = list(items.values())
    for r in rows:
        r["value"] = round(r["total"] * r.pop("cost"), 2)
    return {"columns": [col("item_code", "Code"), col("name", "Item"), col("category", "Category")]
            + [col(f"o{o}", names.get(o, f"#{o}"), "qty") for o in outs] + [col("total", "Total", "qty"), col("value", "Value at cost", "money")],
            "rows": rows}


@report("purchase_items", "Purchase item-wise register", "Daily Operations", "rep_purchase", ("date", "outlet", "category", "brand", "supplier", "search"))
async def purchase_items(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%", "sup": f.supplier_id}
    rows = await _rows(db, f"""
        SELECT g.invoice_date, g.purchase_no AS grn_no, g.invoice_no, s.name AS supplier, o.outlet_name AS outlet,
               p.item_code, p.name AS item, gi.hsn_code AS hsn, gi.qty, COALESCE(gi.free_qty, 0) AS free_qty, gi.price AS rate,
               COALESCE(gi.taxable_amount, gi.taxable_amt) AS taxable, gi.gst_percent AS gst_rate, gi.gst_amount AS gst, gi.total,
               gi.batch_no, gi.expiry_date, g.status
        FROM unit_wise_purchases g JOIN unit_wise_purchase_items gi ON gi.purchase_id = g.id
        JOIN products p ON p.id = gi.product_id JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN outlets o ON o.id = g.outlet_id
        WHERE g.invoice_date BETWEEN :fd AND :td AND g.status <> 'cancelled'
          AND (CAST(:sup AS INT) IS NULL OR g.supplier_id = :sup)
          AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR g.invoice_no ILIKE :q) {_where(f, p, "g.outlet_id", "p")}
        ORDER BY g.invoice_date DESC, g.purchase_no""", p)
    return {"columns": [col("invoice_date", "Date", "date"), col("grn_no", "GRN"), col("invoice_no", "Supplier invoice"),
                        col("supplier", "Supplier"), col("outlet", "Outlet"), col("item_code", "Code"), col("item", "Item"), col("hsn", "HSN"),
                        col("qty", "Qty", "qty"), col("free_qty", "Free", "qty"), col("rate", "Rate", "money"), col("taxable", "Taxable", "money"),
                        col("gst_rate", "GST %", "pct"), col("gst", "GST", "money"), col("total", "Total", "money"),
                        col("batch_no", "Batch"), col("expiry_date", "Expiry", "date"), col("status", "Status")], "rows": rows}


@report("po_grn_variance", "PO vs GRN variance", "Daily Operations", "rep_purchase", ("date", "outlet", "supplier", "search"),
        note="What was ordered against what was received: pending quantity, fill rate and rate difference per PO line.")
async def po_grn_variance(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%", "sup": f.supplier_id}
    rows = await _rows(db, f"""
        SELECT h.po_no, h.po_date, s.name AS supplier, o.outlet_name AS outlet, p.item_code, p.name AS item,
               COALESCE(NULLIF(pi.order_qty, 0), pi.qty) AS ordered, COALESCE(pi.received_qty, 0) AS received,
               GREATEST(COALESCE(NULLIF(pi.order_qty, 0), pi.qty) - COALESCE(pi.received_qty, 0), 0) AS pending,
               CASE WHEN COALESCE(NULLIF(pi.order_qty, 0), pi.qty) > 0
                    THEN ROUND(100 * COALESCE(pi.received_qty, 0) / COALESCE(NULLIF(pi.order_qty, 0), pi.qty), 1) END AS fill_pct,
               pi.rate AS po_rate, g.grn_rate, CASE WHEN g.grn_rate IS NOT NULL THEN ROUND(g.grn_rate - pi.rate, 2) END AS rate_diff,
               g.grns, h.status
        FROM po_items pi JOIN po_headers h ON h.id = pi.po_id JOIN products p ON p.id = pi.product_id
        JOIN suppliers s ON s.id = h.supplier_id LEFT JOIN outlets o ON o.id = h.outlet_id
        LEFT JOIN (SELECT gi.po_item_id, ROUND(SUM(gi.price * gi.qty) / NULLIF(SUM(gi.qty), 0), 2) AS grn_rate,
                          STRING_AGG(DISTINCT g.purchase_no, ', ') AS grns
                   FROM unit_wise_purchase_items gi JOIN unit_wise_purchases g ON g.id = gi.purchase_id
                   WHERE gi.po_item_id IS NOT NULL AND g.status <> 'cancelled' GROUP BY gi.po_item_id) g ON g.po_item_id = pi.id
        WHERE h.po_date BETWEEN :fd AND :td AND h.status NOT IN ('draft', 'cancelled')
          AND (CAST(:sup AS INT) IS NULL OR h.supplier_id = :sup)
          AND (:q = '%%' OR p.name ILIKE :q OR h.po_no ILIKE :q) {_where(f, p, "h.outlet_id", "p")}
        ORDER BY h.po_date DESC, h.po_no, p.name""", p)
    return {"columns": [col("po_no", "PO"), col("po_date", "PO date", "date"), col("supplier", "Supplier"), col("outlet", "Outlet"),
                        col("item_code", "Code"), col("item", "Item"), col("ordered", "Ordered", "qty"), col("received", "Received", "qty"),
                        col("pending", "Pending", "qty"), col("fill_pct", "Fill %", "pct"), col("po_rate", "PO rate", "money"),
                        col("grn_rate", "GRN rate", "money"), col("rate_diff", "Rate diff", "money"), col("grns", "GRNs"), col("status", "PO status")],
            "rows": rows}


# ═══ Category, brand & control ═══════════════════════════════════════════════

async def _performance(db, f: F, by: str):
    p = {"fd": f.fd, "td": f.td}
    grp = {"category": "COALESCE(c.name, p.category, 'Uncategorised')", "brand": "COALESCE(b.name, p.brand, 'No brand')"}[by]
    stock_out = "os.outlet_id = ANY(:mine)" if access.allowed_outlets() is not None or f.outlet_id else "TRUE"
    p["mine"] = [f.outlet_id] if f.outlet_id else (access.allowed_outlets() or [0])
    return await _rows(db, f"""
        WITH sold AS (
          SELECT ii.product_id, SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.qty) AS qty,
                 SUM(CASE WHEN i.invoice_type = 'return' THEN -1 ELSE 1 END * ii.taxable_amt) AS sales
          FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id {ITEM_JOIN}
          WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} {_where(f, p, "i.outlet_id", "p")} GROUP BY 1),
        stk AS (SELECT product_id, SUM(stock_qty) AS stock FROM outlet_stock os WHERE {stock_out} GROUP BY 1)
        SELECT {grp} AS name, COUNT(DISTINCT p.id) FILTER (WHERE sold.qty IS NOT NULL) AS items_sold,
               COALESCE(SUM(sold.qty), 0) AS qty, COALESCE(SUM(sold.sales), 0) AS sales,
               COALESCE(SUM(sold.qty * COALESCE(NULLIF(p.basic_cost, 0), p.cost_price / (1 + COALESCE(p.gst_percent, 0) / 100))), 0) AS cost,
               COALESCE(SUM(stk.stock), 0) AS stock_qty, COALESCE(SUM(stk.stock * p.cost_price), 0) AS stock_value
        FROM products p LEFT JOIN item_categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN stk ON stk.product_id = p.id
        WHERE (sold.product_id IS NOT NULL OR stk.product_id IS NOT NULL) {access.product_filter("p", p)}
        GROUP BY 1 ORDER BY sales DESC""", p)


def _perf_out(rows, label):
    for r in rows:
        r["margin"] = round((r["sales"] or 0) - (r["cost"] or 0), 2)
        r["margin_pct"] = round(100 * r["margin"] / r["sales"], 1) if r["sales"] else None
    return {"columns": [col("name", label), col("items_sold", "Items sold", "num"), col("qty", "Qty sold", "qty"),
                        col("sales", "Sales (taxable)", "money"), col("cost", "Cost", "money"), col("margin", "Margin", "money"),
                        col("margin_pct", "Margin %", "pct"), col("stock_qty", "Stock qty", "qty"), col("stock_value", "Stock value", "money")],
            "rows": rows}


@report("category_perf", "Category performance", "Category & Control", "rep_sales", ("date", "outlet", "category"),
        note="Sales, margin and current stock per category, net of returns.")
async def category_perf(db, f: F):
    return _perf_out(await _performance(db, f, "category"), "Category")


@report("brand_perf", "Brand performance", "Category & Control", "rep_sales", ("date", "outlet", "category", "brand"),
        note="Sales, margin and current stock per brand, net of returns.")
async def brand_perf(db, f: F):
    return _perf_out(await _performance(db, f, "brand"), "Brand")


@report("discount_report", "Discount report", "Category & Control", "rep_sales", ("date", "outlet", "search"), bill_level=True,
        note="Bills that carried item / scheme discounts or cash discount (CD).")
async def discount_report(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""
        SELECT i.invoice_date, i.invoice_no, o.outlet_name AS outlet, c.name AS customer, u.name AS cashier,
               i.subtotal AS gross, i.discount AS item_discount, COALESCE(i.cd_amount, 0) AS cd_amount, i.cd_percent,
               i.discount + COALESCE(i.cd_amount, 0) AS total_discount,
               CASE WHEN i.subtotal > 0 THEN ROUND(100 * (i.discount + COALESCE(i.cd_amount, 0)) / i.subtotal, 1) END AS disc_pct,
               i.total_amount AS bill_amount, SUBSTRING(i.notes FROM 'Schemes: ([^\\n]*)') AS schemes
        FROM unit_wise_invoices i LEFT JOIN outlets o ON o.id = i.outlet_id LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.created_by
        WHERE i.invoice_date BETWEEN :fd AND :td AND {SALE} AND (i.discount > 0 OR COALESCE(i.cd_amount, 0) > 0)
          AND (:q = '%%' OR i.invoice_no ILIKE :q OR c.name ILIKE :q) {_where(f, p)}
        ORDER BY total_discount DESC""", p)
    return {"columns": [col("invoice_date", "Date", "date"), col("invoice_no", "Bill"), col("outlet", "Outlet"), col("customer", "Customer"),
                        col("cashier", "Cashier"), col("gross", "Gross", "money"), col("item_discount", "Item / scheme disc", "money"),
                        col("cd_percent", "CD %", "pct"), col("cd_amount", "CD", "money"), col("total_discount", "Total discount", "money"),
                        col("disc_pct", "Disc %", "pct"), col("bill_amount", "Bill amount", "money"), col("schemes", "Schemes")], "rows": rows}


@report("credit_sales", "Credit sales & dues", "Category & Control", "rep_finance", ("date", "outlet", "search"), bill_level=True,
        note="Bills with money still due, oldest first, with days outstanding against the customer's credit days.")
async def credit_sales(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%", "today": date.today()}
    rows = await _rows(db, f"""
        SELECT i.invoice_date, i.invoice_no, o.outlet_name AS outlet, c.name AS customer, c.phone, i.total_amount AS bill_amount,
               i.paid_amount, i.due_amount, CAST(:today AS date) - i.invoice_date AS days, c.credit_days,
               CASE WHEN c.credit_days IS NOT NULL AND CAST(:today AS date) - i.invoice_date > c.credit_days THEN 'Overdue' ELSE 'Within terms' END AS state
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN outlets o ON o.id = i.outlet_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {SALE} AND i.due_amount > 0
          AND (:q = '%%' OR i.invoice_no ILIKE :q OR c.name ILIKE :q OR c.phone ILIKE :q) {_where(f, p)}
        ORDER BY i.invoice_date""", p)
    return {"columns": [col("invoice_date", "Date", "date"), col("invoice_no", "Bill"), col("outlet", "Outlet"), col("customer", "Customer"),
                        col("phone", "Phone"), col("bill_amount", "Bill", "money"), col("paid_amount", "Paid", "money"),
                        col("due_amount", "Due", "money"), col("days", "Days", "num"), col("credit_days", "Credit days", "num"),
                        col("state", "Status")], "rows": rows}


@report("price_override", "Price override report", "Category & Control", "rep_sales", ("date", "outlet", "category", "search"),
        note="Lines sold below the item's standard selling price without a discount or scheme — rate changed at the counter.")
async def price_override(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""
        SELECT i.invoice_date, i.invoice_no, o.outlet_name AS outlet, u.name AS cashier, p.item_code, p.name AS item, p.mrp,
               p.selling_price AS standard_price, ROUND(ii.total / NULLIF(ii.qty, 0), 2) AS sold_price, ii.qty,
               ROUND(p.selling_price - ii.total / NULLIF(ii.qty, 0), 2) AS diff_per_unit,
               ROUND((p.selling_price - ii.total / NULLIF(ii.qty, 0)) * ii.qty, 2) AS loss
        FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id {ITEM_JOIN}
        LEFT JOIN outlets o ON o.id = i.outlet_id LEFT JOIN users u ON u.id = i.created_by
        WHERE i.invoice_date BETWEEN :fd AND :td AND {SALE} AND ii.qty > 0 AND COALESCE(ii.disc_val, 0) = 0
          AND COALESCE(i.cd_percent, 0) = 0 AND p.selling_price > 0 AND ii.total > 0
          AND ii.total / ii.qty < p.selling_price - 0.5
          AND (:q = '%%' OR p.name ILIKE :q OR i.invoice_no ILIKE :q) {_where(f, p, "i.outlet_id", "p")}
        ORDER BY loss DESC""", p)
    return {"columns": [col("invoice_date", "Date", "date"), col("invoice_no", "Bill"), col("outlet", "Outlet"), col("cashier", "Cashier"),
                        col("item_code", "Code"), col("item", "Item"), col("mrp", "MRP", "money"), col("standard_price", "Standard price", "money"),
                        col("sold_price", "Sold at", "money"), col("qty", "Qty", "qty"), col("diff_per_unit", "Diff / unit", "money"),
                        col("loss", "Loss", "money")], "rows": rows}


@report("negative_stock", "Negative stock audit", "Category & Control", "rep_stock", ("outlet", "category", "search"),
        note="Items below zero at an outlet, with the last sale and last GRN — usually stock sold before its GRN was entered.")
async def negative_stock(db, f: F):
    p = {"q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""
        SELECT o.outlet_name AS outlet, p.item_code, p.name AS item, COALESCE(c.name, p.category) AS category, os.stock_qty,
               (SELECT MAX(sl.created_at) FROM stock_ledger sl WHERE sl.product_id = p.id AND sl.outlet_id = os.outlet_id AND sl.qty < 0) AS last_out,
               (SELECT MAX(sl.created_at) FROM stock_ledger sl WHERE sl.product_id = p.id AND sl.outlet_id = os.outlet_id
                  AND sl.txn_type = 'purchase') AS last_grn,
               ROUND(os.stock_qty * COALESCE(p.cost_price, 0), 2) AS value
        FROM outlet_stock os JOIN products p ON p.id = os.product_id JOIN outlets o ON o.id = os.outlet_id
        LEFT JOIN item_categories c ON c.id = p.category_id
        WHERE os.stock_qty < 0 AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q) {_where(f, p, "os.outlet_id", "p")}
        ORDER BY os.stock_qty""", p)
    for r in rows:
        for k in ("last_out", "last_grn"):
            r[k] = (r[k] + timedelta(hours=5, minutes=30)).strftime("%d %b %Y %H:%M") if r[k] else None   # stored UTC
    return {"columns": [col("outlet", "Outlet"), col("item_code", "Code"), col("item", "Item"), col("category", "Category"),
                        col("stock_qty", "Stock", "qty"), col("last_out", "Last sale / out"), col("last_grn", "Last GRN"),
                        col("value", "Value at cost", "money")], "rows": rows}


@report("supplier_scorecard", "Supplier scorecard", "Category & Control", "rep_purchase", ("date", "outlet", "supplier"),
        note="Per supplier: orders, fill rate, on-time delivery, lead time, purchases and returns.")
async def supplier_scorecard(db, f: F):
    p = {"fd": f.fd, "td": f.td, "sup": f.supplier_id}
    rows = await _rows(db, f"""
        WITH po AS (
          SELECT h.supplier_id, COUNT(DISTINCT h.id) AS pos, SUM(COALESCE(NULLIF(pi.order_qty, 0), pi.qty)) AS ordered,
                 SUM(COALESCE(pi.received_qty, 0)) AS received
          FROM po_headers h JOIN po_items pi ON pi.po_id = h.id
          WHERE h.po_date BETWEEN :fd AND :td AND h.status NOT IN ('draft', 'cancelled') {_where(f, p, "h.outlet_id")} GROUP BY 1),
        grn AS (
          SELECT g.supplier_id, COUNT(*) AS grns, SUM(g.total_amount) AS purchase_value,
                 AVG(g.invoice_date - h.po_date) FILTER (WHERE h.id IS NOT NULL) AS lead_days,
                 COUNT(*) FILTER (WHERE h.id IS NOT NULL) AS po_grns,
                 COUNT(*) FILTER (WHERE h.id IS NOT NULL AND (h.expected_date IS NULL OR g.invoice_date <= h.expected_date)) AS on_time
          FROM unit_wise_purchases g LEFT JOIN po_headers h ON h.id = g.po_id
          WHERE g.invoice_date BETWEEN :fd AND :td AND g.status NOT IN ('draft', 'cancelled') {_where(f, p, "g.outlet_id")} GROUP BY 1),
        ret AS (
          SELECT r.supplier_id, SUM(r.total_amount) AS returns
          FROM unit_wise_purchase_returns r WHERE r.return_date BETWEEN :fd AND :td AND COALESCE(r.status, '') <> 'cancelled'
            {_where(f, p, "r.outlet_id")} GROUP BY 1)
        SELECT s.name AS supplier, s.gst_number AS gstin, COALESCE(po.pos, 0) AS pos, COALESCE(po.ordered, 0) AS ordered,
               COALESCE(po.received, 0) AS received,
               CASE WHEN po.ordered > 0 THEN ROUND(100 * po.received / po.ordered, 1) END AS fill_pct,
               COALESCE(grn.grns, 0) AS grns, COALESCE(grn.purchase_value, 0) AS purchase_value, COALESCE(ret.returns, 0) AS returns,
               CASE WHEN grn.purchase_value > 0 THEN ROUND(100 * COALESCE(ret.returns, 0) / grn.purchase_value, 1) END AS return_pct,
               ROUND(grn.lead_days, 1) AS lead_days,
               CASE WHEN grn.po_grns > 0 THEN ROUND(100.0 * grn.on_time / grn.po_grns, 1) END AS on_time_pct
        FROM suppliers s LEFT JOIN po ON po.supplier_id = s.id LEFT JOIN grn ON grn.supplier_id = s.id LEFT JOIN ret ON ret.supplier_id = s.id
        WHERE (po.supplier_id IS NOT NULL OR grn.supplier_id IS NOT NULL OR ret.supplier_id IS NOT NULL)
          AND (CAST(:sup AS INT) IS NULL OR s.id = :sup)
        ORDER BY purchase_value DESC""", p)
    return {"columns": [col("supplier", "Supplier"), col("gstin", "GSTIN"), col("pos", "POs", "num"), col("ordered", "Ordered", "qty"),
                        col("received", "Received", "qty"), col("fill_pct", "Fill %", "pct"), col("grns", "GRNs", "num"),
                        col("purchase_value", "Purchases", "money"), col("returns", "Returns", "money"), col("return_pct", "Return %", "pct"),
                        col("lead_days", "Lead days", "num"), col("on_time_pct", "On time %", "pct")], "rows": rows}


@report("transfer_register", "Stock transfer register", "Category & Control", "rep_stock", ("date", "outlet", "search"),
        note="Transfers sent or received by your outlets: items, quantity, value, received and short.")
async def transfer_register(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    mine = [f.outlet_id] if f.outlet_id else access.allowed_outlets()
    w = ""
    if mine is not None:
        p["mine"] = mine or [0]
        w = " AND (t.from_outlet_id = ANY(:mine) OR t.to_outlet_id = ANY(:mine))"
    rows = await _rows(db, f"""
        SELECT t.transfer_date, t.transfer_no, fo.outlet_name AS from_outlet, tt.outlet_name AS to_outlet, t.status,
               COUNT(ti.id) AS items, COALESCE(SUM(ti.qty), 0) AS qty, SUM(ti.received_qty) AS received_qty,
               CASE WHEN COUNT(ti.received_qty) > 0 THEN SUM(ti.qty) - SUM(COALESCE(ti.received_qty, 0)) END AS short_qty,
               COALESCE(SUM(ti.total_val), 0) AS value, t.received_at
        FROM unit_wise_stock_transfers t LEFT JOIN unit_wise_stock_transfer_items ti ON ti.transfer_id = t.id
        LEFT JOIN outlets fo ON fo.id = t.from_outlet_id LEFT JOIN outlets tt ON tt.id = t.to_outlet_id
        WHERE t.transfer_date BETWEEN :fd AND :td AND (:q = '%%' OR t.transfer_no ILIKE :q) {w}
        GROUP BY t.id, fo.outlet_name, tt.outlet_name ORDER BY t.transfer_date DESC, t.transfer_no""", p)
    return {"columns": [col("transfer_date", "Date", "date"), col("transfer_no", "Transfer"), col("from_outlet", "From"), col("to_outlet", "To"),
                        col("status", "Status"), col("items", "Items", "num"), col("qty", "Qty sent", "qty"), col("received_qty", "Received", "qty"),
                        col("short_qty", "Short", "qty"), col("value", "Value", "money"), col("received_at", "Received on", "date")], "rows": rows}


@report("tally_vouchers", "Tally export", "Accounts", "rep_finance", ("date", "outlet"), bill_level=True, download="tally",
        note="Sales vouchers ready for Tally. Download the XML and import it in Tally (Gateway → Import → Vouchers).")
async def tally_vouchers(db, f: F):
    rows = await _tally_rows(db, f)
    return {"columns": [col("invoice_date", "Date", "date"), col("invoice_no", "Voucher no"), col("party", "Party ledger"),
                        col("taxable", "Sales", "money"), col("cgst", "CGST", "money"), col("sgst", "SGST", "money"),
                        col("igst", "IGST", "money"), col("round_off", "Round off", "money"), col("total", "Total", "money")], "rows": rows}


async def _tally_rows(db, f: F):
    p = {"fd": f.fd, "td": f.td}
    return await _rows(db, f"""
        SELECT i.invoice_date, i.invoice_no, CASE WHEN i.due_amount > 0 THEN c.name ELSE 'Cash' END AS party,
               i.taxable_amount AS taxable, i.cgst_amount AS cgst, i.sgst_amount AS sgst, i.igst_amount AS igst,
               COALESCE(i.round_off, 0) AS round_off, i.total_amount AS total, i.invoice_type
        FROM unit_wise_invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND {ACTIVE} {_where(f, p)} ORDER BY i.invoice_date, i.invoice_no""", p)


# ═══ Audit & Compliance ══════════════════════════════════════════════════════
# audit_logs.created_at is stored in UTC; dates are filtered and shown in Indian time.
IST = "(a.created_at + INTERVAL '5 hours 30 minutes')"


def _audit_where(f: F, p: dict, ts: str = IST, user_col: str = "a.user_id") -> str:
    p.update(fd=f.fd, td=f.td, q=f"%{f.search.strip()}%", uid=f.user_id)
    return f" AND CAST({ts} AS date) BETWEEN :fd AND :td AND (CAST(:uid AS INT) IS NULL OR {user_col} = :uid)"


AUDIT_COLS = [col("at", "Date & time"), col("user_name", "User"), col("role", "Role"), col("module", "Module"),
              col("action", "Action"), col("record_no", "Record"), col("description", "Details"), col("ip_address", "IP")]


@report("audit_trail", "Audit Log (Full)", "Audit & Compliance", "audit", ("date", "user", "search"),
        note="Every recorded action — who did what, when, from which IP. Search matches module, action, record or description.")
async def audit_trail(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT TO_CHAR({IST}, 'DD Mon YYYY HH24:MI:SS') AS at, COALESCE(u.name, a.user_name) AS user_name, u.role,
               a.module, a.action, a.record_no, a.description, a.ip_address
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE TRUE {_audit_where(f, p)}
          AND (:q = '%%' OR a.module ILIKE :q OR a.action ILIKE :q OR a.record_no ILIKE :q OR a.description ILIKE :q)
        ORDER BY a.created_at DESC LIMIT 5000""", p)
    return {"columns": AUDIT_COLS, "rows": rows, "notes": ["Latest 5,000 entries for the filter"] if len(rows) == 5000 else []}


@report("user_activity", "User Activity Summary", "Audit & Compliance", "audit", ("date", "user"),
        note="Per user: logins, failed logins, creates, edits, approvals, cancellations / deletes, blocked attempts and last activity.")
async def user_activity(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT COALESCE(u.name, MAX(a.user_name)) AS user_name, u.username, u.role, o.outlet_name AS outlet,
               COUNT(*) FILTER (WHERE a.module = 'auth' AND a.action = 'login') AS logins,
               COUNT(*) FILTER (WHERE a.action = 'login_failed') AS failed_logins,
               COUNT(*) FILTER (WHERE a.action ILIKE '%create%' OR a.action ILIKE 'start%' OR a.action ILIKE '%open') AS creates,
               COUNT(*) FILTER (WHERE a.action ILIKE '%update%' OR a.action ILIKE '%edit%' OR a.action ILIKE 'toggle%') AS edits,
               COUNT(*) FILTER (WHERE a.action ILIKE '%approve%' OR a.action ILIKE 'finalize%' OR a.action ILIKE '%close') AS approvals,
               COUNT(*) FILTER (WHERE a.action ILIKE '%cancel%' OR a.action ILIKE '%delete%' OR a.action ILIKE 'deactivate%') AS cancels_deletes,
               COUNT(*) FILTER (WHERE a.module = 'security') AS blocked,
               COUNT(*) AS total_actions, COUNT(DISTINCT a.module) AS modules,
               TO_CHAR(MAX({IST}), 'DD Mon YYYY HH24:MI') AS last_activity
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN outlets o ON o.id = u.outlet_id
        WHERE TRUE {_audit_where(f, p)}
        GROUP BY u.id, u.name, u.username, u.role, o.outlet_name ORDER BY total_actions DESC""", p)
    return {"columns": [col("user_name", "User"), col("username", "Username"), col("role", "Role"), col("outlet", "Default outlet"),
                        col("logins", "Logins", "num"), col("failed_logins", "Failed logins", "num"), col("creates", "Creates", "num"),
                        col("edits", "Edits", "num"), col("approvals", "Approvals / closes", "num"), col("cancels_deletes", "Cancels / deletes", "num"),
                        col("blocked", "Blocked attempts", "num"), col("total_actions", "Total actions", "num"), col("modules", "Modules used", "num"),
                        col("last_activity", "Last activity")], "rows": rows}


@report("login_history", "Login History", "Audit & Compliance", "audit", ("date", "user", "search"),
        note="Every login and failed login with time and IP. Repeated failures for one user can mean someone is guessing the password.")
async def login_history(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT TO_CHAR({IST}, 'DD Mon YYYY HH24:MI:SS') AS at, COALESCE(u.name, a.user_name) AS user_name, u.username, u.role,
               CASE WHEN a.action = 'login' THEN 'Success' ELSE 'Failed' END AS result,
               CASE WHEN a.action = 'login' THEN '' ELSE SPLIT_PART(a.description, ': ', 2) END AS reason, a.ip_address
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.module = 'auth' AND a.action IN ('login', 'login_failed') {_audit_where(f, p)}
          AND (:q = '%%' OR a.ip_address ILIKE :q OR u.name ILIKE :q OR u.username ILIKE :q)
        ORDER BY a.created_at DESC LIMIT 5000""", p)
    return {"columns": [col("at", "Date & time"), col("user_name", "User"), col("username", "Username"), col("role", "Role"),
                        col("result", "Result"), col("reason", "Reason"), col("ip_address", "IP")], "rows": rows}


@report("security_denials", "Blocked Access Attempts", "Audit & Compliance", "audit", ("date", "user", "search"),
        note="Requests refused by User Management: a screen, outlet, category or action the user is not allowed.")
async def security_denials(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT TO_CHAR({IST}, 'DD Mon YYYY HH24:MI:SS') AS at, COALESCE(u.name, a.user_name) AS user_name, u.role,
               SPLIT_PART(a.description, ': ', 1) AS request,
               SUBSTRING(a.description FROM POSITION(': ' IN a.description) + 2) AS reason, a.ip_address
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.module = 'security' {_audit_where(f, p)}
          AND (:q = '%%' OR a.description ILIKE :q OR u.name ILIKE :q)
        ORDER BY a.created_at DESC LIMIT 5000""", p)
    return {"columns": [col("at", "Date & time"), col("user_name", "User"), col("role", "Role"), col("request", "Request"),
                        col("reason", "Why it was refused"), col("ip_address", "IP")], "rows": rows}


@report("permission_changes", "Permission Changes", "Audit & Compliance", "audit", ("date", "user", "search"),
        note="Every change to a user's role, status, outlets, categories, groups or permissions, and to role templates.")
async def permission_changes(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT TO_CHAR({IST}, 'DD Mon YYYY HH24:MI:SS') AS at,
               CASE WHEN a.user_id = 0 THEN 'Role template' ELSE u.name END AS user_name,
               a.changed_by_name AS changed_by, a.summary, a.ip_address
        FROM user_permission_audit a LEFT JOIN users u ON u.id = a.user_id
        WHERE TRUE {_audit_where(f, p)}
          AND (:q = '%%' OR a.summary ILIKE :q OR u.name ILIKE :q OR a.changed_by_name ILIKE :q)
        ORDER BY a.created_at DESC LIMIT 5000""", p)
    return {"columns": [col("at", "Date & time"), col("user_name", "User changed"), col("changed_by", "Changed by"),
                        col("summary", "What changed"), col("ip_address", "IP")], "rows": rows}


SENSITIVE = ("(a.action ILIKE '%delete%' OR a.action ILIKE '%cancel%' OR a.action ILIKE '%approve%' OR a.action ILIKE 'deactivate%' "
             "OR a.action ILIKE '%password%' OR a.action ILIKE 'finalize%' OR a.action ILIKE '%adjust%' OR a.action = 'day_close' "
             "OR a.action ILIKE '%reopen%' OR a.module IN ('company', 'users') OR a.action ILIKE '%price%')")


@report("sensitive_actions", "Sensitive Actions", "Audit & Compliance", "audit", ("date", "user", "search"),
        note="Deletes, cancellations, approvals, stock adjustments, day close / reopen, password resets, price and company-setting changes.")
async def sensitive_actions(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT TO_CHAR({IST}, 'DD Mon YYYY HH24:MI:SS') AS at, COALESCE(u.name, a.user_name) AS user_name, u.role,
               a.module, a.action, a.record_no, a.description, a.ip_address
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE {SENSITIVE} {_audit_where(f, p)}
          AND (:q = '%%' OR a.module ILIKE :q OR a.action ILIKE :q OR a.record_no ILIKE :q OR a.description ILIKE :q)
        ORDER BY a.created_at DESC LIMIT 5000""", p)
    return {"columns": AUDIT_COLS, "rows": rows}


@report("activity_by_module", "Activity by Module", "Audit & Compliance", "audit", ("date", "user"),
        note="How often each action happens in each module, and how many users did it.")
async def activity_by_module(db, f: F):
    p: dict = {}
    rows = await _rows(db, f"""
        SELECT a.module, a.action, COUNT(*) AS times, COUNT(DISTINCT a.user_id) AS users,
               TO_CHAR(MIN({IST}), 'DD Mon YYYY HH24:MI') AS first_seen, TO_CHAR(MAX({IST}), 'DD Mon YYYY HH24:MI') AS last_seen
        FROM audit_logs a WHERE TRUE {_audit_where(f, p)}
        GROUP BY a.module, a.action ORDER BY times DESC""", p)
    return {"columns": [col("module", "Module"), col("action", "Action"), col("times", "Times", "num"), col("users", "Users", "num"),
                        col("first_seen", "First"), col("last_seen", "Last")], "rows": rows}

# ═══ endpoints ═══════════════════════════════════════════════════════════════

access.register_paths({f"/reports/x/{k}": r["module"] for k, r in REPORTS.items()}
                      | {"/reports/x/gstr1/json": "rep_gst", "/reports/x/tally/xml": "rep_finance"})


def _filters(from_date, to_date, outlet_id, category_id, brand_id, supplier_id, search, month, user_id=None) -> F:
    td = to_date or date.today()
    return F(from_date or td.replace(day=1), td, outlet_id, category_id, brand_id, supplier_id, search or "", month, user_id)


async def _run(key, db, f, **extra):
    r = REPORTS.get(key)
    if not r:
        raise HTTPException(404, "Unknown report")
    if r["bill_level"]:
        access.require_whole_bill_access()
    access.check_outlet(f.outlet_id)
    out = await r["fn"](db, f, **extra)
    return {"key": key, "title": r["title"], **out}


@router.get("")
async def catalog():
    return [{k: v for k, v in r.items() if k != "fn"} for r in REPORTS.values()]


@router.get("/gstr1/json")
async def gstr1_json(month: Optional[str] = None, outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    """GSTR-1 in the GSTN offline-tool / portal JSON layout (b2b, b2cl, b2cs, cdnr, hsn)."""
    access.require_whole_bill_access()
    f = _filters(None, None, outlet_id, None, None, None, "", month)
    fd, _ = _month(f)
    gstin = (await db.execute(text("SELECT gstin FROM company_settings ORDER BY id LIMIT 1"))).scalar() or ""
    rnd = lambda v: round(float(v or 0), 2)
    dt = lambda d: d.strftime("%d-%m-%Y")
    b2b: dict[str, dict] = {}
    for r in (await gstr1_b2b(db, f))["rows"]:
        inv = b2b.setdefault(r["gstin"], {"ctin": r["gstin"], "inv": {}})["inv"].setdefault(r["invoice_no"], {
            "inum": r["invoice_no"], "idt": dt(r["invoice_date"]), "val": rnd(r["invoice_value"]), "pos": r["pos"], "rchrg": "N",
            "inv_typ": "R", "itms": []})
        inv["itms"].append({"num": len(inv["itms"]) + 1, "itm_det": {"rt": rnd(r["rate"]), "txval": rnd(r["taxable"]), "iamt": rnd(r["igst"]),
                                                                     "camt": rnd(r["cgst"]), "samt": rnd(r["sgst"]), "csamt": 0}})
    b2cl: dict[str, dict] = {}
    for r in (await gstr1_b2cl(db, f))["rows"]:
        inv = b2cl.setdefault(r["pos"], {"pos": r["pos"], "inv": {}})["inv"].setdefault(r["invoice_no"], {
            "inum": r["invoice_no"], "idt": dt(r["invoice_date"]), "val": rnd(r["invoice_value"]), "itms": []})
        inv["itms"].append({"num": len(inv["itms"]) + 1, "itm_det": {"rt": rnd(r["rate"]), "txval": rnd(r["taxable"]), "iamt": rnd(r["igst"]), "csamt": 0}})
    cdnr: dict[str, dict] = {}
    for r in (await gstr1_cdnr(db, f))["rows"]:
        nt = cdnr.setdefault(r["gstin"], {"ctin": r["gstin"], "nt": {}})["nt"].setdefault(r["note_no"], {
            "ntty": "C", "nt_num": r["note_no"], "nt_dt": dt(r["note_date"]), "val": rnd(r["note_value"]), "pos": r["pos"],
            "rchrg": "N", "inv_typ": "R", "itms": []})
        nt["itms"].append({"num": len(nt["itms"]) + 1, "itm_det": {"rt": rnd(r["rate"]), "txval": rnd(r["taxable"]), "iamt": rnd(r["igst"]),
                                                                   "camt": rnd(r["cgst"]), "samt": rnd(r["sgst"]), "csamt": 0}})
    hsn = (await hsn_sales(db, f))["rows"]
    hsn_rows = lambda kind: [{"num": n + 1, "hsn_sc": h["hsn"], "uqc": h["uqc"], "qty": rnd(h["qty"]), "rt": rnd(h["rate"]),
                              "txval": rnd(h["taxable"]), "iamt": rnd(h["igst"]), "camt": rnd(h["cgst"]), "samt": rnd(h["sgst"]), "csamt": 0}
                             for n, h in enumerate(x for x in hsn if x["supply"] == kind)]
    out = {
        "gstin": gstin, "fp": fd.strftime("%m%Y"), "version": "GST3.2", "hash": "hash",
        "b2b": [{"ctin": v["ctin"], "inv": list(v["inv"].values())} for v in b2b.values()],
        "b2cl": [{"pos": v["pos"], "inv": list(v["inv"].values())} for v in b2cl.values()],
        "b2cs": [{"sply_ty": "INTRA" if r["supply"] == "Intra-state" else "INTER", "pos": r["pos"], "typ": "OE", "rt": rnd(r["rate"]),
                  "txval": rnd(r["taxable"]), "iamt": rnd(r["igst"]), "camt": rnd(r["cgst"]), "samt": rnd(r["sgst"]), "csamt": 0}
                 for r in (await gstr1_b2cs(db, f))["rows"]],
        "cdnr": [{"ctin": v["ctin"], "nt": list(v["nt"].values())} for v in cdnr.values()],
        "hsn": {"hsn_b2b": hsn_rows("B2B"), "hsn_b2c": hsn_rows("B2C")},
    }
    return Response(json.dumps(out, default=str, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="GSTR1_{gstin}_{fd:%m%Y}.json"'})


@router.get("/tally/xml")
async def tally_xml(from_date: Optional[date] = None, to_date: Optional[date] = None, outlet_id: Optional[int] = None,
                    db: AsyncSession = Depends(get_db)):
    access.require_whole_bill_access()
    access.check_outlet(outlet_id)
    f = _filters(from_date, to_date, outlet_id, None, None, None, "", None)
    company = (await db.execute(text("SELECT COALESCE(legal_name, brand_name, 'Company') FROM company_settings ORDER BY id LIMIT 1"))).scalar()
    amt = lambda v: f"{float(v or 0):.2f}"
    vouchers = []
    for r in await _tally_rows(db, f):
        ret = r["invoice_type"] == "return"
        vt, sign = ("Credit Note", -1) if ret else ("Sales", 1)
        led = lambda name, value, debit: (f"<ALLLEDGERENTRIES.LIST><LEDGERNAME>{escape(name)}</LEDGERNAME>"
                                          f"<ISDEEMEDPOSITIVE>{'Yes' if debit else 'No'}</ISDEEMEDPOSITIVE>"
                                          f"<AMOUNT>{amt(-value if debit else value)}</AMOUNT></ALLLEDGERENTRIES.LIST>")
        parts = [led(r["party"] or "Cash", r["total"], not ret), led("Sales Account", r["taxable"], ret)]
        for name, k in (("Output CGST", "cgst"), ("Output SGST", "sgst"), ("Output IGST", "igst")):
            if r[k]:
                parts.append(led(name, r[k], ret))
        if r["round_off"]:
            parts.append(led("Round Off", r["round_off"] * sign, ret))
        vouchers.append(f'<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="{vt}" ACTION="Create">'
                        f'<DATE>{r["invoice_date"]:%Y%m%d}</DATE><VOUCHERTYPENAME>{vt}</VOUCHERTYPENAME>'
                        f'<VOUCHERNUMBER>{escape(r["invoice_no"])}</VOUCHERNUMBER><PARTYLEDGERNAME>{escape(r["party"] or "Cash")}</PARTYLEDGERNAME>'
                        f'{"".join(parts)}</VOUCHER></TALLYMESSAGE>')
    xml = ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC>'
           f'<REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>{escape(company)}</SVCURRENTCOMPANY></STATICVARIABLES>'
           f'</REQUESTDESC><REQUESTDATA>{"".join(vouchers)}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
    return Response(xml, media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="tally_sales_{f.fd:%Y%m%d}_{f.td:%Y%m%d}.xml"'})


@router.get("/{key}")
async def run_report(key: str, from_date: Optional[date] = None, to_date: Optional[date] = None, outlet_id: Optional[int] = None,
                     category_id: Optional[int] = None, brand_id: Optional[int] = None, supplier_id: Optional[int] = None,
                     search: str = "", month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"), user_id: Optional[int] = None,
                     db: AsyncSession = Depends(get_db)):
    return await _run(key, db, _filters(from_date, to_date, outlet_id, category_id, brand_id, supplier_id, search, month, user_id))


@router.post("/gst2b_recon")
async def gst2b_upload(file: UploadFile = File(...), month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
                       outlet_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    if (file.size or 0) > 20 * 1024 * 1024:
        raise HTTPException(400, "The file is larger than 20 MB.")
    try:
        doc = json.loads(await file.read())
    except Exception:
        raise HTTPException(400, "That is not a JSON file. Download GSTR-2B as JSON from the GST portal.")
    data = doc.get("data", doc)
    b2b = (data.get("docdata") or {}).get("b2b") or data.get("b2b") or []
    if not isinstance(b2b, list):
        raise HTTPException(400, "No B2B invoices found in this file.")
    return await _run("gst2b_recon", db, _filters(None, None, outlet_id, None, None, None, "", month), b2b=b2b)


if __name__ == "__main__":  # self-check: python -m app.routers.report_engine
    assert _month(F(date.today(), date.today(), None, None, None, None, "", "2026-02")) == (date(2026, 2, 1), date(2026, 2, 28))
    assert _month(F(date.today(), date.today(), None, None, None, None, "", "2025-12")) == (date(2025, 12, 1), date(2025, 12, 31))
    assert len(REPORTS) >= 20 and all(r["module"] in {k for k, *_ in access.MODULES} for r in REPORTS.values())
    print("report_engine OK", len(REPORTS), "reports")
