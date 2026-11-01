"""
Report Center BI — All report endpoints
Workflow: UI → GET /api/v1/reports/<name> → DB query → JSON → UI
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from app.core.dependencies import get_current_user
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core import access
from app.utils.search import word_match_sql

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_user)])


def _fmt(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _d(s: Optional[str], fallback: date) -> date:
    """Convert ISO date string to date object; return fallback if None."""
    if s:
        return date.fromisoformat(s)
    return fallback


# ── helpers ──────────────────────────────────────────────────────────────────

async def _outlets(db: AsyncSession):
    params: dict = {}
    r = await db.execute(text("SELECT id, outlet_name FROM outlets WHERE TRUE" + access.outlet_filter("id", params) + " ORDER BY id"), params)
    return [{"id": row[0], "name": row[1]} for row in r.fetchall()]


# ══════════════════════════════════════════════════════════════════════════════
# 1. Sales Report
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/sales")
async def sales_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())

    where = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        where += " AND i.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("i.outlet_id", params)

    # summary
    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                        AS total_invoices,
            COALESCE(SUM(i.total_amount + i.discount), 0) AS gross_sales,
            COALESCE(SUM(i.discount), 0)    AS total_discount,
            COALESCE(SUM(CASE WHEN i.taxable_amount > 0 THEN i.taxable_amount ELSE (i.total_amount - i.total_gst) END), 0) AS taxable,
            COALESCE(SUM(i.total_gst), 0)   AS total_gst,
            COALESCE(SUM(i.total_amount), 0) AS net_sales,
            COALESCE(SUM(i.paid_amount), 0) AS collected,
            COALESCE(SUM(i.due_amount), 0)  AS outstanding
        FROM unit_wise_invoices i {where}
    """), params)
    s = sumq.fetchone()

    # rows
    rowq = await db.execute(text(f"""
        SELECT
            i.id, o.outlet_name, i.invoice_no, i.invoice_type,
            i.invoice_date, i.subtotal, i.discount, i.taxable_amount,
            i.total_gst, i.total_amount, i.paid_amount, i.due_amount,
            i.payment_mode, i.status
        FROM unit_wise_invoices i
        LEFT JOIN outlets o ON o.id = i.outlet_id
        {where}
        ORDER BY i.invoice_date DESC, i.id DESC
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    return {
        "summary": {
            "total_invoices": int(s[0] or 0),
            "gross_sales":    _fmt(s[1]),
            "total_discount": _fmt(s[2]),
            "taxable":        _fmt(s[3]),
            "total_gst":      _fmt(s[4]),
            "net_sales":      _fmt(s[5]),
            "collected":      _fmt(s[6]),
            "outstanding":    _fmt(s[7]),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 2. Purchase Report
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/purchase")
async def purchase_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())

    where = "WHERE p.invoice_date BETWEEN :fd AND :td"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        where += " AND p.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("p.outlet_id", params)

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                         AS total_purchases,
            COALESCE(SUM(p.total_amount), 0) AS total_amount
        FROM unit_wise_purchases p {where}
    """), params)
    s = sumq.fetchone()

    rowq = await db.execute(text(f"""
        SELECT
            p.id, o.outlet_name, p.purchase_no, p.invoice_no,
            p.invoice_date, p.total_amount, p.status,
            sp.name AS supplier_name
        FROM unit_wise_purchases p
        LEFT JOIN outlets  o  ON o.id  = p.outlet_id
        LEFT JOIN suppliers sp ON sp.id = p.supplier_id
        {where}
        ORDER BY p.invoice_date DESC, p.id DESC
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    return {
        "summary": {
            "total_purchases": int(s[0] or 0),
            "total_amount":    _fmt(s[1]),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 3. Stock Report (QOH)
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/stock")
async def stock_report(
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    where = "WHERE os.stock_qty > 0"
    params: dict = {}
    where += " AND os.product_id IN (SELECT p.id FROM products p WHERE TRUE" + access.product_filter("p", params) + ")"
    if outlet_id:
        where += " AND os.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("os.outlet_id", params)

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(DISTINCT os.product_id)      AS skus,
            COALESCE(SUM(os.stock_qty), 0)     AS total_qty
        FROM outlet_stock os {where}
    """), params)
    s = sumq.fetchone()

    rowq = await db.execute(text(f"""
        SELECT
            os.outlet_id, o.outlet_name,
            os.product_id, p.item_code, p.name AS item_name,
            p.category, p.brand,
            os.stock_qty AS current_stock,
            os.updated_at AS last_sync
        FROM outlet_stock os
        LEFT JOIN outlets  o ON o.id = os.outlet_id
        LEFT JOIN products p ON p.id = os.product_id
        {where}
        ORDER BY o.outlet_name, p.name
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    return {
        "summary": {
            "total_skus": int(s[0] or 0),
            "total_qty":  _fmt(s[1]),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 4. Profit & Loss
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/pl")
async def pl_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_unrestricted()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())

    w_sales = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type = 'retail' AND i.status <> 'cancelled'"
    w_rtn   = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type = 'return' AND i.status <> 'cancelled'"
    w_purch = "WHERE p.invoice_date BETWEEN :fd AND :td"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        w_sales += " AND i.outlet_id = :oid"
        w_rtn   += " AND i.outlet_id = :oid"
        w_purch += " AND p.outlet_id = :oid"
        params["oid"] = outlet_id

    sq = (await db.execute(text(f"SELECT COALESCE(SUM(total_amount),0), COALESCE(SUM(total_gst),0), COALESCE(SUM(discount),0) FROM unit_wise_invoices i {w_sales}"), params)).fetchone()
    rq = (await db.execute(text(f"SELECT COALESCE(SUM(total_amount),0) FROM unit_wise_invoices i {w_rtn}"), params)).fetchone()
    pq = (await db.execute(text(f"SELECT COALESCE(SUM(total_amount),0) FROM unit_wise_purchases p {w_purch}"), params)).fetchone()

    gross_sales   = _fmt(sq[0])
    total_gst_out = _fmt(sq[1])
    total_disc    = _fmt(sq[2])
    returns       = _fmt(rq[0])
    purchases     = _fmt(pq[0])

    net_sales     = gross_sales - returns
    net_excl_gst  = net_sales - total_gst_out
    gross_profit  = net_excl_gst - purchases
    gp_pct        = round((gross_profit / net_excl_gst * 100), 2) if net_excl_gst else 0

    # monthly breakdown
    monthly = await db.execute(text(f"""
        SELECT
            TO_CHAR(i.invoice_date, 'Mon YYYY') AS month,
            COALESCE(SUM(i.total_amount), 0)    AS sales,
            COALESCE(SUM(i.total_gst), 0)       AS gst,
            COALESCE(SUM(i.discount), 0)        AS discount
        FROM unit_wise_invoices i
        WHERE i.invoice_date BETWEEN :fd AND :td
          AND i.invoice_type = 'retail' AND i.status <> 'cancelled'
        GROUP BY TO_CHAR(i.invoice_date, 'Mon YYYY'), DATE_TRUNC('month', i.invoice_date)
        ORDER BY DATE_TRUNC('month', i.invoice_date)
    """), params)
    monthly_rows = monthly.fetchall()

    return {
        "summary": {
            "gross_sales":   gross_sales,
            "sales_returns": returns,
            "net_sales":     net_sales,
            "net_excl_gst":  net_excl_gst,
            "total_gst_out": total_gst_out,
            "total_discount": total_disc,
            "cost_of_goods": purchases,
            "gross_profit":  gross_profit,
            "gp_percent":    gp_pct,
        },
        "monthly": [{"month": r[0], "sales": _fmt(r[1]), "gst": _fmt(r[2]), "discount": _fmt(r[3])} for r in monthly_rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 5. GST Report
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/gst")
async def gst_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())

    where = "WHERE invoice_date BETWEEN :fd AND :td AND invoice_type != 'return' AND status <> 'cancelled'"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        where += " AND outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("outlet_id", params)

    # item-level GST slab breakdown
    slab_q = await db.execute(text(f"""
        SELECT
            ii.gst_percent                      AS slab,
            COUNT(DISTINCT i.id)                AS invoices,
            COALESCE(SUM(ii.taxable_amt), 0)    AS taxable,
            COALESCE(SUM(ii.cgst_amount), 0)    AS cgst,
            COALESCE(SUM(ii.sgst_amount), 0)    AS sgst,
            COALESCE(SUM(ii.igst_amount), 0)    AS igst,
            COALESCE(SUM(ii.cgst_amount + ii.sgst_amount + ii.igst_amount), 0) AS total_gst
        FROM unit_wise_invoice_items ii
        JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        {where}
        GROUP BY ii.gst_percent
        ORDER BY ii.gst_percent
    """), params)
    slabs = slab_q.fetchall()

    # summary totals
    tot_q = await db.execute(text(f"""
        SELECT
            COALESCE(SUM(taxable_amount), 0),
            COALESCE(SUM(cgst_amount), 0),
            COALESCE(SUM(sgst_amount), 0),
            COALESCE(SUM(igst_amount), 0),
            COALESCE(SUM(total_gst), 0)
        FROM unit_wise_invoices {where}
    """), params)
    t = tot_q.fetchone()

    return {
        "summary": {
            "taxable_amount": _fmt(t[0]),
            "cgst":           _fmt(t[1]),
            "sgst":           _fmt(t[2]),
            "igst":           _fmt(t[3]),
            "total_gst":      _fmt(t[4]),
        },
        "slabs": [
            {
                "slab": str(r[0]) + "%",
                "invoices": int(r[1] or 0),
                "taxable": _fmt(r[2]),
                "cgst": _fmt(r[3]),
                "sgst": _fmt(r[4]),
                "igst": _fmt(r[5]),
                "total_gst": _fmt(r[6]),
            }
            for r in slabs
        ],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 6. Outstanding Dues
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/outstanding")
async def outstanding_report(
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    where = "WHERE i.due_amount > 0 AND i.status != 'cancelled'"
    params: dict = {}
    if outlet_id:
        where += " AND i.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("i.outlet_id", params)

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                      AS total_invoices,
            COALESCE(SUM(i.total_amount),0) AS total_billed,
            COALESCE(SUM(i.paid_amount),0)  AS total_paid,
            COALESCE(SUM(i.due_amount),0)   AS total_due
        FROM unit_wise_invoices i {where}
    """), params)
    s = sumq.fetchone()

    rowq = await db.execute(text(f"""
        SELECT
            i.id, o.outlet_name, i.invoice_no, i.invoice_date,
            i.total_amount, i.paid_amount, i.due_amount,
            i.payment_mode, i.status,
            (CURRENT_DATE - i.invoice_date) AS days_overdue
        FROM unit_wise_invoices i
        LEFT JOIN outlets o ON o.id = i.outlet_id
        {where}
        ORDER BY i.due_amount DESC
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    return {
        "summary": {
            "total_invoices": int(s[0] or 0),
            "total_billed":   _fmt(s[1]),
            "total_paid":     _fmt(s[2]),
            "total_due":      _fmt(s[3]),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 7. Payment Collection (Media Report)
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/payments")
async def payment_collection_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())

    where = "WHERE b.bill_date BETWEEN :fd AND :td"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        where += " AND b.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("b.outlet_id", params)

    # by paymode
    modeq = await db.execute(text(f"""
        SELECT
            UPPER(b.paymode)              AS paymode,
            COUNT(*)                      AS transactions,
            COALESCE(SUM(b.pay_amount),0) AS total_amount
        FROM bill_wise_sales_summary b {where}
        GROUP BY UPPER(b.paymode)
        ORDER BY SUM(b.pay_amount) DESC
    """), params)
    modes = modeq.fetchall()

    # daily trend with outlet name
    dailyq = await db.execute(text(f"""
        SELECT
            b.bill_date,
            o.outlet_name,
            COALESCE(SUM(b.pay_amount),0) AS total,
            COUNT(DISTINCT b.bill_no)     AS bills
        FROM bill_wise_sales_summary b
        LEFT JOIN outlets o ON o.id = b.outlet_id
        {where}
        GROUP BY b.bill_date, o.outlet_name
        ORDER BY b.bill_date DESC, o.outlet_name
    """), params)
    daily = dailyq.fetchall()

    # by outlet (new)
    outletq = await db.execute(text(f"""
        SELECT
            o.outlet_name,
            COUNT(*)                      AS transactions,
            COALESCE(SUM(b.pay_amount),0) AS total_amount
        FROM bill_wise_sales_summary b
        LEFT JOIN outlets o ON o.id = b.outlet_id
        {where}
        GROUP BY o.outlet_name
        ORDER BY SUM(b.pay_amount) DESC
    """), params)
    by_outlet = outletq.fetchall()

    total = sum(_fmt(r[2]) for r in modes)

    return {
        "summary": {
            "total_collected": total,
            "payment_modes":   len(modes),
            "outlets_count":   len(by_outlet),
        },
        "by_mode": [
            {
                "paymode":      r[0],
                "transactions": int(r[1] or 0),
                "amount":       _fmt(r[2]),
                "pct":          round(_fmt(r[2]) / total * 100, 1) if total else 0,
            }
            for r in modes
        ],
        "by_outlet": [
            {
                "outlet":       r[0],
                "transactions": int(r[1] or 0),
                "amount":       _fmt(r[2]),
                "pct":          round(_fmt(r[2]) / total * 100, 1) if total else 0,
            }
            for r in by_outlet
        ],
        "daily": [{"date": str(r[0]), "outlet": r[1], "total": _fmt(r[2]), "bills": int(r[3] or 0)} for r in daily],
        "outlets": await _outlets(db),
    }


@router.get("/payments-matrix")
async def payment_matrix_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())
    params: dict = {"fd": fd, "td": td, "oid": outlet_id}
    ow = " AND (CAST(:oid AS INT) IS NULL OR b.outlet_id = :oid)" + access.outlet_filter("b.outlet_id", params)
    # synced outlet POS bills + bills made in nutribay itself (their payments)
    src = f"""(SELECT outlet_id, bill_date, paymode, pay_amount FROM bill_wise_sales_summary
               UNION ALL
               SELECT i.outlet_id, py.payment_date, py.payment_mode, py.amount
               FROM unit_wise_payments py JOIN unit_wise_invoices i ON i.id = py.invoice_id)"""

    # 1. Get all payment modes present in the period
    modes_q = await db.execute(text(f"""
        SELECT DISTINCT UPPER(b.paymode) as mode
        FROM {src} b
        WHERE b.bill_date BETWEEN :fd AND :td {ow}
        ORDER BY mode
    """), params)
    modes = [r[0] for r in modes_q.fetchall()]

    # 2. Get outlet-wise totals for each mode using a cross-tab style query (or just group by and pivot in Python)
    data_q = await db.execute(text(f"""
        SELECT
            o.outlet_name,
            UPPER(b.paymode) as mode,
            SUM(b.pay_amount) as total
        FROM {src} b
        JOIN outlets o ON o.id = b.outlet_id
        WHERE b.bill_date BETWEEN :fd AND :td {ow}
        GROUP BY o.outlet_name, UPPER(b.paymode)
        ORDER BY o.outlet_name, mode
    """), params)
    rows = data_q.fetchall()

    # 3. Pivot the data in Python
    matrix = {}
    for outlet_name, mode, total in rows:
        if outlet_name not in matrix:
            matrix[outlet_name] = {m: 0.0 for m in modes}
            matrix[outlet_name]["total"] = 0.0
        matrix[outlet_name][mode] = _fmt(total)
        matrix[outlet_name]["total"] += _fmt(total)

    # Convert to list for frontend
    result_rows = []
    for name, values in matrix.items():
        row = {"outlet": name}
        row.update(values)
        result_rows.append(row)

    # Sort by total descending
    result_rows.sort(key=lambda x: x["total"], reverse=True)

    # Grand totals
    grand_totals = {m: sum(row.get(m, 0) for row in result_rows) for m in modes}
    grand_totals["total"] = sum(row["total"] for row in result_rows)

    return {
        "modes": modes,
        "rows": result_rows,
        "grand_totals": grand_totals,
        "period": {"from": str(fd), "to": str(td)},
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 8. Hourly Sales Analysis
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/hourly")
async def hourly_sales_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today())
    td = _d(to_date,   date.today())

    where = "WHERE invoice_date BETWEEN :fd AND :td AND invoice_type != 'return' AND status <> 'cancelled' AND invoice_datetime IS NOT NULL"
    params: dict = {"fd": fd, "td": td}
    if outlet_id:
        where += " AND outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("outlet_id", params)

    hourq = await db.execute(text(f"""
        SELECT
            EXTRACT(HOUR FROM invoice_datetime)  AS hour,
            COUNT(*)                              AS bills,
            COALESCE(SUM(total_amount), 0)        AS sales,
            COALESCE(AVG(total_amount), 0)        AS avg_bill
        FROM unit_wise_invoices
        {where}
        GROUP BY EXTRACT(HOUR FROM invoice_datetime)
        ORDER BY hour
    """), params)
    hours = hourq.fetchall()

    max_sales = max((_fmt(r[2]) for r in hours), default=1)

    # ── Matrix calculations ──
    where_matrix = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled' AND i.invoice_datetime IS NOT NULL"
    if outlet_id:
        where_matrix += " AND i.outlet_id = :oid"
    where_matrix += access.outlet_filter("i.outlet_id", params)

    matrixq = await db.execute(text(f"""
        SELECT
            COALESCE(o.outlet_name, 'Unknown')    AS outlet_name,
            EXTRACT(HOUR FROM i.invoice_datetime) AS hour,
            COALESCE(SUM(i.total_amount), 0)      AS sales
        FROM unit_wise_invoices i
        LEFT JOIN outlets o ON o.id = i.outlet_id
        {where_matrix}
        GROUP BY o.outlet_name, EXTRACT(HOUR FROM i.invoice_datetime)
        ORDER BY o.outlet_name, hour
    """), params)
    matrix_rows = matrixq.fetchall()

    unique_hours = sorted(list(set(int(r[1] or 0) for r in matrix_rows)))

    matrix_dict = {}
    for r in matrix_rows:
        out_name = str(r[0] or "Unknown")
        hr = int(r[1] or 0)
        sales = _fmt(r[2])
        if out_name not in matrix_dict:
            matrix_dict[out_name] = {
                "outlet_name": out_name,
                "hourly_sales": {},
                "total_sales": 0.0
            }
        matrix_dict[out_name]["hourly_sales"][hr] = sales
        matrix_dict[out_name]["total_sales"] += sales

    matrix_list = []
    for out_name, val in matrix_dict.items():
        matrix_list.append({
            "outlet_name": out_name,
            "hourly_sales": {str(k): v for k, v in val["hourly_sales"].items()},
            "total_sales": round(val["total_sales"], 2)
        })

    hourly_totals = {}
    for hr in unique_hours:
        hourly_totals[str(hr)] = round(sum(val["hourly_sales"].get(hr, 0.0) for val in matrix_dict.values()), 2)

    grand_total = round(sum(val["total_sales"] for val in matrix_dict.values()), 2)

    return {
        "hours": [
            {
                "hour":     int(r[0] or 0),
                "label":    f"{int(r[0] or 0):02d}:00",
                "bills":    int(r[1] or 0),
                "sales":    _fmt(r[2]),
                "avg_bill": round(_fmt(r[3]), 2),
                "pct":      round(_fmt(r[2]) / max_sales * 100, 1) if max_sales else 0,
            }
            for r in hours
        ],
        "matrix": {
            "unique_hours": unique_hours,
            "rows": matrix_list,
            "hourly_totals": hourly_totals,
            "grand_total": grand_total
        },
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 9. Hierarchy Sales Analysis (Outlet × Date)
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/hierarchy")
async def hierarchy_report(
    from_date: str  = Query(default=None),
    to_date:   str  = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_unrestricted()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())
    params: dict = {"fd": fd, "td": td}

    # by outlet
    outq = await db.execute(text("""
        SELECT
            o.outlet_name,
            COUNT(i.id)                    AS bills,
            COALESCE(SUM(i.total_amount),0) AS sales,
            COALESCE(SUM(i.due_amount),0)   AS outstanding,
            COALESCE(SUM(i.total_gst),0)    AS gst
        FROM unit_wise_invoices i
        JOIN outlets o ON o.id = i.outlet_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'
        GROUP BY o.outlet_name
        ORDER BY SUM(i.total_amount) DESC
    """), params)
    outlets = outq.fetchall()

    # daily by outlet
    dailyq = await db.execute(text("""
        SELECT
            i.invoice_date,
            o.outlet_name,
            COUNT(i.id)                    AS bills,
            COALESCE(SUM(i.total_amount),0) AS sales
        FROM unit_wise_invoices i
        JOIN outlets o ON o.id = i.outlet_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'
        GROUP BY i.invoice_date, o.outlet_name
        ORDER BY i.invoice_date, o.outlet_name
    """), params)
    daily = dailyq.fetchall()

    return {
        "by_outlet": [
            {
                "outlet":      r[0],
                "bills":       int(r[1] or 0),
                "sales":       _fmt(r[2]),
                "outstanding": _fmt(r[3]),
                "gst":         _fmt(r[4]),
            }
            for r in outlets
        ],
        "daily": [
            {
                "date":   str(r[0]),
                "outlet": r[1],
                "bills":  int(r[2] or 0),
                "sales":  _fmt(r[3]),
            }
            for r in daily
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# 10. Stock Ledger
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/ledger")
async def stock_ledger_report(
    outlet_id: Optional[int] = Query(default=None),
    search:    str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    where = "WHERE 1=1"
    params: dict = {}
    if outlet_id:
        where += " AND os.outlet_id = :oid"
        params["oid"] = outlet_id
    where += access.outlet_filter("os.outlet_id", params) + access.product_filter("p", params)
    if search:
        sql, sp = word_match_sql(search, ["p.item_code", "p.name"])
        where += f" AND {sql}"
        params.update(sp)

    rowq = await db.execute(text(f"""
        SELECT
            o.outlet_name,
            p.item_code,
            p.name                               AS item_name,
            p.category,
            p.brand,
            os.stock_qty                         AS current_stock,
            p.selling_price                      AS sale_price,
            (os.stock_qty * COALESCE(p.cost_price, 0)) AS stock_value,
            os.updated_at                        AS last_sync
        FROM outlet_stock os
        LEFT JOIN outlets  o ON o.id = os.outlet_id
        LEFT JOIN products p ON p.id = os.product_id
        {where}
        ORDER BY o.outlet_name, p.name
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                                   AS skus,
            COALESCE(SUM(os.stock_qty), 0)             AS total_qty,
            COALESCE(SUM(os.stock_qty * COALESCE(p.cost_price,0)), 0) AS total_value
        FROM outlet_stock os
        LEFT JOIN products p ON p.id = os.product_id
        {where}
    """), params)
    s = sumq.fetchone()

    return {
        "summary": {
            "total_skus":  int(s[0] or 0),
            "total_qty":   _fmt(s[1]),
            "total_value": _fmt(s[2]),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows],
        "outlets": await _outlets(db),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 11. HSN Mismatch Report
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/hsn-mismatch")
async def hsn_mismatch_report(
    db: AsyncSession = Depends(get_db),
):
    access.require_unrestricted()
    rowq = await db.execute(text("""
        SELECT
            p.id, p.item_code, p.name AS item_name,
            sc.name AS subcategory_name,
            h1.hsn_code AS suggested_hsn,
            h2.hsn_code AS entered_hsn,
            p.gst_percent,
            h2.gst_percent AS hsn_gst_percent
        FROM products p
        LEFT JOIN item_subcategories sc ON sc.id = p.subcategory_id
        LEFT JOIN hsn_master h1 ON h1.id = p.suggested_hsn_id
        LEFT JOIN hsn_master h2 ON h2.id = p.hsn_id
        WHERE p.suggested_hsn_id IS NOT NULL 
          AND p.hsn_id IS NOT NULL 
          AND p.suggested_hsn_id != p.hsn_id
        ORDER BY p.name
    """))
    rows = rowq.fetchall()
    cols = rowq.keys()
    
    return {
        "summary": {
            "total_mismatches": len(rows)
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows]
    }


# ══════════════════════════════════════════════════════════════════════════════
# 12. HSN Mapping Report
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/hsn-mapping")
async def hsn_mapping_report(
    db: AsyncSession = Depends(get_db),
):
    access.require_unrestricted()
    rowq = await db.execute(text("""
        SELECT
            sc.id, sc.name AS subcategory_name,
            c.name AS category_name,
            h.hsn_code, h.description, h.gst_percent
        FROM item_subcategories sc
        LEFT JOIN item_categories c ON c.id = sc.category_id
        LEFT JOIN hsn_master h ON h.id = sc.default_hsn_id
        WHERE sc.is_active = True
        ORDER BY c.name, sc.name
    """))
    rows = rowq.fetchall()
    cols = rowq.keys()
    
    return {
        "summary": {
            "total_mappings": len(rows),
            "missing_mappings": len([r for r in rows if not r[3]])
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows]
    }


# ══════════════════════════════════════════════════════════════════════════════
# 13. HSN Exception Logs
# ══════════════════════════════════════════════════════════════════════════════
@router.get("/hsn-exceptions")
async def hsn_exceptions_report(
    from_date: str = Query(default=None),
    to_date: str = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_unrestricted()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date,   date.today())
    
    rowq = await db.execute(text("""
        SELECT
            l.id, l.created_at, l.item_code, 
            p.name AS item_name,
            sc.name AS subcategory_name,
            h1.hsn_code AS suggested_hsn,
            h2.hsn_code AS entered_hsn,
            u.name AS user_name,
            l.reason
        FROM hsn_exception_logs l
        LEFT JOIN products p ON p.id = l.product_id
        LEFT JOIN item_subcategories sc ON sc.id = l.subcategory_id
        LEFT JOIN hsn_master h1 ON h1.id = l.suggested_hsn_id
        LEFT JOIN hsn_master h2 ON h2.id = l.entered_hsn_id
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.created_at::date BETWEEN :fd AND :td
        ORDER BY l.created_at DESC
    """), {"fd": fd, "td": td})
    rows = rowq.fetchall()
    cols = rowq.keys()

    return {
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows]
    }


# ══════════════════════════════════════════════════════════════════════════════
# NEW PRICING REPORTS
# ══════════════════════════════════════════════════════════════════════════════

def _row_to_dict(cols, row):
    return dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row]))


# ── 1. Channel Margin Report ──────────────────────────────────────────────────
@router.get("/channel-margin")
async def channel_margin_report(
    partner_id : Optional[int] = Query(default=None),
    db         : AsyncSession  = Depends(get_db),
):
    access.require_unrestricted()
    """
    Channel-wise margin per product.
    Shows: Product | Partner | MRP | Base Cost | Selling Price | Commission% |
           Settlement | Net Profit | Margin%
    """
    where  = "WHERE icp.is_active = true"
    params: dict = {}
    if partner_id:
        where += " AND icp.partner_id = :pid"
        params["pid"] = partner_id

    # Summary
    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                                    AS total_prices,
            COUNT(DISTINCT icp.partner_id)              AS total_partners,
            COUNT(DISTINCT icp.product_id)              AS total_products,
            COALESCE(AVG(
                CASE WHEN icp.base_cost > 0
                     THEN (icp.final_settlement_rate - icp.base_cost) / icp.base_cost * 100
                END
            ), 0)                                       AS avg_net_margin,
            COALESCE(SUM(icp.final_settlement_rate), 0) AS total_settlement_value,
            COALESCE(SUM(icp.selling_price), 0)         AS total_selling_value
        FROM item_channel_prices icp
        {where}
    """), params)
    s = sumq.fetchone()

    # Detail rows
    rowq = await db.execute(text(f"""
        SELECT
            p.id            AS product_id,
            p.name          AS product_name,
            p.item_code,
            p.category,
            cp.partner_name,
            cp.partner_code,
            cp.settlement_days,
            icp.mrp,
            icp.base_cost,
            icp.margin_percent       AS extra_margin_pct,
            icp.partner_commission   AS commission_pct,
            icp.selling_price,
            icp.final_settlement_rate AS settlement,
            CASE WHEN icp.base_cost > 0
                 THEN ROUND((icp.final_settlement_rate - icp.base_cost) / icp.base_cost * 100, 2)
            END                      AS net_margin_pct,
            ROUND(icp.final_settlement_rate - icp.base_cost, 2) AS net_profit,
            icp.is_active
        FROM item_channel_prices icp
        JOIN products         p  ON p.id  = icp.product_id
        JOIN channel_partners cp ON cp.id = icp.partner_id
        {where}
        ORDER BY cp.partner_name, p.name
        LIMIT 1000
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    # Partners list for filter dropdown
    pq = await db.execute(text(
        "SELECT id, partner_name, partner_code FROM channel_partners WHERE is_active ORDER BY partner_name"
    ))
    partners = [{"id": r[0], "name": r[1], "code": r[2]} for r in pq.fetchall()]

    return {
        "summary": {
            "total_prices"        : int(s[0] or 0),
            "total_partners"      : int(s[1] or 0),
            "total_products"      : int(s[2] or 0),
            "avg_net_margin"      : _fmt(s[3]),
            "total_settlement"    : _fmt(s[4]),
            "total_selling_value" : _fmt(s[5]),
        },
        "rows"    : [_row_to_dict(cols, r) for r in rows],
        "partners": partners,
    }


# ── 2. Channel Profitability Report ──────────────────────────────────────────
@router.get("/channel-profitability")
async def channel_profitability_report(db: AsyncSession = Depends(get_db)):
    access.require_unrestricted()
    """Partner-level P&L: total items, avg margin, total settlement."""
    rowq = await db.execute(text("""
        SELECT
            cp.id,
            cp.partner_name,
            cp.partner_code,
            cp.commission_percent,
            cp.settlement_days,
            COUNT(icp.id)           AS total_items,
            COALESCE(AVG(
                CASE WHEN icp.base_cost > 0
                     THEN (icp.final_settlement_rate - icp.base_cost) / icp.base_cost * 100
                END
            ), 0)                   AS avg_net_margin,
            COALESCE(SUM(icp.final_settlement_rate), 0) AS total_settlement,
            COALESCE(SUM(icp.selling_price), 0)         AS total_selling,
            COALESCE(SUM(icp.final_settlement_rate - icp.base_cost), 0) AS total_profit,
            COUNT(CASE WHEN icp.final_settlement_rate < icp.base_cost THEN 1 END) AS below_cost_count
        FROM channel_partners cp
        LEFT JOIN item_channel_prices icp ON icp.partner_id = cp.id AND icp.is_active
        WHERE cp.is_active
        GROUP BY cp.id, cp.partner_name, cp.partner_code, cp.commission_percent, cp.settlement_days
        ORDER BY total_settlement DESC
    """))
    rows = rowq.fetchall()
    cols = rowq.keys()
    return {"rows": [_row_to_dict(cols, r) for r in rows]}


# ── 3. Low Margin Alert Report ────────────────────────────────────────────────
@router.get("/low-margin")
async def low_margin_report(
    min_margin : float = Query(default=10.0, description="Minimum acceptable margin %"),
    category_id: Optional[int] = Query(default=None),
    db         : AsyncSession  = Depends(get_db),
):
    access.require_unrestricted()
    """
    Products whose SP margin is below the threshold.
    Highlights negative-profit items separately.
    """
    where  = "WHERE p.is_active = true AND p.sp_margin < :min_margin AND p.selling_price > 0"
    params: dict = {"min_margin": min_margin}
    if category_id:
        where += " AND p.category_id = :cid"
        params["cid"] = category_id

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                                    AS total_items,
            COUNT(CASE WHEN p.sp_margin < 0 THEN 1 END) AS negative_margin_items,
            COALESCE(AVG(p.sp_margin), 0)               AS avg_margin,
            COALESCE(AVG(p.mrp), 0)                     AS avg_mrp
        FROM products p {where}
    """), params)
    s = sumq.fetchone()

    rowq = await db.execute(text(f"""
        SELECT
            p.id, p.name, p.item_code, p.category, p.brand,
            p.mrp, p.cost_price, p.selling_price,
            p.sp_margin, p.mrp_margin, p.cp_margin,
            p.gst_percent, p.stock_qty, p.status,
            p.pricing_mode, p.online_partner_enabled
        FROM products p
        {where}
        ORDER BY p.sp_margin ASC
        LIMIT 500
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    cats = await db.execute(text(
        "SELECT id, name FROM item_categories WHERE is_active ORDER BY name"
    ))
    categories = [{"id": r[0], "name": r[1]} for r in cats.fetchall()]

    return {
        "summary": {
            "total_items"          : int(s[0] or 0),
            "negative_margin_items": int(s[1] or 0),
            "avg_margin"           : round(_fmt(s[2]), 2),
            "avg_mrp"              : round(_fmt(s[3]), 2),
            "min_margin_filter"    : min_margin,
        },
        "rows"      : [_row_to_dict(cols, r) for r in rows],
        "categories": categories,
    }


# ── 4. Markdown Items Report ──────────────────────────────────────────────────
@router.get("/markdown-items")
async def markdown_items_report(
    category_id: Optional[int] = Query(default=None),
    db         : AsyncSession  = Depends(get_db),
):
    access.require_unrestricted()
    """Products with pricing_mode = MARKDOWN or FIXED_MARGIN."""
    where  = "WHERE p.is_active = true AND p.pricing_mode IN ('MARKDOWN','FIXED_MARGIN')"
    params: dict = {}
    if category_id:
        where += " AND p.category_id = :cid"
        params["cid"] = category_id

    rowq = await db.execute(text(f"""
        SELECT
            p.id, p.name, p.item_code, p.category, p.brand,
            p.pricing_mode,
            p.mrp, p.basic_cost, p.cost_price, p.selling_price,
            p.mrp_margin, p.sp_margin,
            p.gst_percent, p.stock_qty, p.status,
            p.fixed_margin_percent, p.minimum_margin_percent,
            p.online_partner_enabled
        FROM products p
        {where}
        ORDER BY p.category, p.name
        LIMIT 1000
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()

    sumq = await db.execute(text(f"""
        SELECT
            COUNT(*)                  AS total_items,
            COALESCE(AVG(p.mrp_margin), 0)  AS avg_mrp_margin,
            COALESCE(SUM(p.stock_qty * p.cost_price), 0) AS total_stock_value
        FROM products p {where}
    """), params)
    s = sumq.fetchone()

    return {
        "summary": {
            "total_items"      : int(s[0] or 0),
            "avg_mrp_margin"   : round(_fmt(s[1]), 2),
            "total_stock_value": round(_fmt(s[2]), 2),
        },
        "rows": [_row_to_dict(cols, r) for r in rows],
    }


# ── 5. Negative Profit Alert ──────────────────────────────────────────────────
@router.get("/negative-profit")
async def negative_profit_report(db: AsyncSession = Depends(get_db)):
    access.require_unrestricted()
    """Channel prices where settlement < cost (net_profit < 0)."""
    rowq = await db.execute(text("""
        SELECT
            p.id AS product_id, p.name AS product_name, p.item_code,
            cp.partner_name, cp.partner_code,
            icp.mrp, icp.base_cost, icp.selling_price,
            icp.final_settlement_rate AS settlement,
            ROUND(icp.final_settlement_rate - icp.base_cost, 2) AS net_profit,
            CASE WHEN icp.base_cost > 0
                 THEN ROUND((icp.final_settlement_rate - icp.base_cost) / icp.base_cost * 100, 2)
            END AS net_margin_pct,
            icp.partner_commission AS commission_pct
        FROM item_channel_prices icp
        JOIN products         p  ON p.id  = icp.product_id
        JOIN channel_partners cp ON cp.id = icp.partner_id
        WHERE icp.is_active AND icp.final_settlement_rate < icp.base_cost
        ORDER BY net_profit ASC
        LIMIT 500
    """))
    rows = rowq.fetchall()
    cols = rowq.keys()
    return {
        "total": len(rows),
        "rows" : [_row_to_dict(cols, r) for r in rows],
    }


# ── 6. Channel Pricing Grid (Product × Partner Matrix) ────────────────────────
@router.get("/channel-pricing-grid")
async def channel_pricing_grid(
    category_id: Optional[int] = Query(default=None),
    search     : Optional[str] = Query(default=None),
    db         : AsyncSession  = Depends(get_db),
):
    access.require_unrestricted()
    """Item-wise all channel prices in a grid (product × partner matrix view)."""
    pwhere  = "WHERE p.is_active AND p.online_partner_enabled"
    pparams: dict = {}
    if category_id:
        pwhere += " AND p.category_id = :cid"
        pparams["cid"] = category_id
    if search:
        sql, sp = word_match_sql(search, ["p.name", "p.item_code"])
        pwhere += f" AND {sql}"
        pparams.update(sp)

    # Products
    prodq = await db.execute(text(f"""
        SELECT id, name, item_code, category, mrp, cost_price
        FROM products p {pwhere}
        ORDER BY p.name LIMIT 200
    """), pparams)
    products = [dict(zip(prodq.keys(), r)) for r in prodq.fetchall()]
    product_ids = [p["id"] for p in products]

    if not product_ids:
        return {"products": [], "partners": [], "grid": {}}

    # Partners
    partq = await db.execute(text(
        "SELECT id, partner_name, partner_code FROM channel_partners WHERE is_active ORDER BY partner_name"
    ))
    partners = [{"id": r[0], "name": r[1], "code": r[2]} for r in partq.fetchall()]

    # Prices
    priceq = await db.execute(text("""
        SELECT product_id, partner_id, selling_price, final_settlement_rate,
               ROUND(final_settlement_rate - base_cost, 2) AS net_profit,
               CASE WHEN base_cost > 0
                    THEN ROUND((final_settlement_rate - base_cost) / base_cost * 100, 2)
               END AS net_margin_pct
        FROM item_channel_prices
        WHERE product_id = ANY(:pids) AND is_active
    """), {"pids": product_ids})
    prices = priceq.fetchall()

    # Build grid: {product_id: {partner_id: {...}}}
    grid: dict = {}
    for row in prices:
        pid, parid = row[0], row[1]
        grid.setdefault(pid, {})[parid] = {
            "selling_price"   : _fmt(row[2]),
            "settlement"      : _fmt(row[3]),
            "net_profit"      : _fmt(row[4]),
            "net_margin_pct"  : _fmt(row[5]),
        }

    return {"products": products, "partners": partners, "grid": grid}


# ── 7. Channel Settlement Pending Report ──────────────────────────────────────
@router.get("/channel-settlement")
async def channel_settlement_report(
    partner_id: Optional[int] = Query(default=None),
    db        : AsyncSession  = Depends(get_db),
):
    access.require_unrestricted()
    """
    Settlement timeline per partner based on settlement_days.
    Shows expected settlement dates for online orders.
    """
    where  = "WHERE cp.is_active"
    params: dict = {}
    if partner_id:
        where += " AND cp.id = :pid"
        params["pid"] = partner_id

    rowq = await db.execute(text(f"""
        SELECT
            cp.partner_name,
            cp.partner_code,
            cp.settlement_days,
            cp.commission_percent,
            cp.gst_on_commission,
            COUNT(icp.id)                               AS priced_items,
            COALESCE(SUM(icp.selling_price), 0)         AS total_listing_value,
            COALESCE(SUM(icp.final_settlement_rate), 0) AS expected_settlement,
            COALESCE(SUM(icp.selling_price) * cp.commission_percent / 100, 0) AS commission_payable,
            NOW()::date + cp.settlement_days            AS next_settlement_date
        FROM channel_partners cp
        LEFT JOIN item_channel_prices icp ON icp.partner_id = cp.id AND icp.is_active
        {where}
        GROUP BY cp.id, cp.partner_name, cp.partner_code, cp.settlement_days,
                 cp.commission_percent, cp.gst_on_commission
        ORDER BY cp.partner_name
    """), params)
    rows = rowq.fetchall()
    cols = rowq.keys()
    return {"rows": [_row_to_dict(cols, r) for r in rows]}


# ══════════════════════════════════════════════════════════════════════════════
# FMCG-STYLE REPORTS — Unit-Wise Dashboard & Analytics
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/unit-dashboard")
async def unit_dashboard(db: AsyncSession = Depends(get_db)):
    access.require_unrestricted()
    today_q = await db.execute(text("""
        SELECT o.outlet_name, COUNT(i.id) AS bills,
               COALESCE(SUM(i.total_amount), 0) AS sales,
               COALESCE(SUM(i.total_gst), 0) AS gst,
               COALESCE(AVG(i.total_amount), 0) AS avg_bill
        FROM unit_wise_invoices i JOIN outlets o ON o.id = i.outlet_id
        WHERE i.invoice_date = CURRENT_DATE AND i.invoice_type != 'return' AND i.status <> 'cancelled'
        GROUP BY o.outlet_name ORDER BY SUM(i.total_amount) DESC
    """))
    today_rows = today_q.fetchall()
    mtd_q = await db.execute(text("""
        SELECT COALESCE(SUM(i.total_amount), 0), COUNT(i.id)
        FROM unit_wise_invoices i
        WHERE i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) AND i.invoice_type != 'return' AND i.status <> 'cancelled'
    """))
    mtd = mtd_q.fetchone()
    trend_q = await db.execute(text("""
        SELECT i.invoice_date, COUNT(i.id), COALESCE(SUM(i.total_amount), 0)
        FROM unit_wise_invoices i
        WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '7 days' AND i.invoice_type != 'return' AND i.status <> 'cancelled'
        GROUP BY i.invoice_date ORDER BY i.invoice_date
    """))
    trend = [{"date": str(r[0]), "bills": int(r[1] or 0), "sales": _fmt(r[2])}
             for r in trend_q.fetchall()]
    stock_q = await db.execute(text(
        "SELECT COUNT(DISTINCT product_id), COALESCE(SUM(stock_qty),0) FROM outlet_stock WHERE stock_qty>0"
    ))
    stock = stock_q.fetchone()
    total_s = sum(_fmt(r[2]) for r in today_rows)
    total_b = sum(int(r[1] or 0) for r in today_rows)
    return {
        "kpi": {"today_sales": total_s, "today_bills": total_b,
                "avg_bill": round(total_s / total_b, 2) if total_b else 0,
                "mtd_sales": _fmt(mtd[0]), "mtd_bills": int(mtd[1] or 0),
                "total_skus": int(stock[0] or 0), "total_stock_qty": _fmt(stock[1])},
        "by_outlet": [{"outlet": r[0], "bills": int(r[1] or 0), "sales": _fmt(r[2]),
                       "gst": _fmt(r[3]), "avg_bill": round(_fmt(r[4]), 2)} for r in today_rows],
        "trend": trend,
    }


@router.get("/sales-trend")
async def sales_trend_report(
    from_date: str = Query(default=None), to_date: str = Query(default=None),
    outlet_id: Optional[int] = Query(default=None), db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date, date.today())
    w = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'"
    p: dict = {"fd": fd, "td": td}
    if outlet_id: w += " AND i.outlet_id = :oid"; p["oid"] = outlet_id
    w += access.outlet_filter("i.outlet_id", p)
    q = await db.execute(text(f"""
        SELECT i.invoice_date, TRIM(TO_CHAR(i.invoice_date,'Day')),
               COUNT(i.id), COALESCE(SUM(i.total_amount),0),
               COALESCE(SUM(i.discount),0), COALESCE(AVG(i.total_amount),0)
        FROM unit_wise_invoices i {w} GROUP BY i.invoice_date ORDER BY i.invoice_date
    """), p)
    return {"rows": [{"date": str(r[0]), "weekday": r[1], "bills": int(r[2] or 0),
                      "sales": _fmt(r[3]), "discount": _fmt(r[4]),
                      "avg_bill": round(_fmt(r[5]), 2)} for r in q.fetchall()],
            "outlets": await _outlets(db)}


@router.get("/top-items")
async def top_items_report(
    from_date: str = Query(default=None), to_date: str = Query(default=None),
    outlet_id: Optional[int] = Query(default=None), top_n: int = Query(default=20),
    db: AsyncSession = Depends(get_db),
):
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date, date.today())
    w = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'"
    p: dict = {"fd": fd, "td": td, "topn": top_n}
    if outlet_id: w += " AND i.outlet_id = :oid"; p["oid"] = outlet_id
    w += access.outlet_filter("i.outlet_id", p) + access.product_filter("p", p)
    q = await db.execute(text(f"""
        SELECT p.item_code, p.name, p.category, p.brand,
               COUNT(DISTINCT i.id), COALESCE(SUM(ii.qty),0),
               COALESCE(SUM(ii.total),0), COALESCE(SUM(ii.disc_val),0)
        FROM unit_wise_invoice_items ii
        JOIN unit_wise_invoices i ON i.id=ii.invoice_id
        JOIN products p ON p.id=ii.product_id {w}
        GROUP BY p.item_code,p.name,p.category,p.brand
        ORDER BY SUM(ii.total) DESC LIMIT :topn
    """), p)
    return {"rows": [{"item_code": r[0], "item_name": r[1], "category": r[2],
                      "brand": r[3], "bills": int(r[4] or 0), "qty_sold": _fmt(r[5]),
                      "total_sales": _fmt(r[6]), "total_discount": _fmt(r[7])}
                     for r in q.fetchall()], "outlets": await _outlets(db)}


@router.get("/category-sales")
async def category_sales_report(
    from_date: str = Query(default=None), to_date: str = Query(default=None),
    outlet_id: Optional[int] = Query(default=None), db: AsyncSession = Depends(get_db),
):
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date, date.today())
    w = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'"
    p: dict = {"fd": fd, "td": td}
    if outlet_id: w += " AND i.outlet_id = :oid"; p["oid"] = outlet_id
    w += access.outlet_filter("i.outlet_id", p) + access.product_filter("p", p)
    q = await db.execute(text(f"""
        SELECT COALESCE(p.category,'Uncategorized'), COUNT(DISTINCT i.id),
               COALESCE(SUM(ii.qty),0), COALESCE(SUM(ii.total),0),
               COALESCE(SUM(ii.disc_val),0), COALESCE(SUM(ii.taxable_amt),0)
        FROM unit_wise_invoice_items ii
        JOIN unit_wise_invoices i ON i.id=ii.invoice_id
        JOIN products p ON p.id=ii.product_id {w}
        GROUP BY p.category ORDER BY SUM(ii.total) DESC
    """), p)
    return {"rows": [{"category": r[0], "bills": int(r[1] or 0), "qty": _fmt(r[2]),
                      "sales": _fmt(r[3]), "discount": _fmt(r[4]),
                      "taxable": _fmt(r[5])} for r in q.fetchall()],
            "outlets": await _outlets(db)}


@router.get("/profitability-analysis")
async def profitability_analysis(
    from_date: str = Query(default=None), to_date: str = Query(default=None),
    group_by: str = Query(default="category"),
    outlet_id: Optional[int] = Query(default=None), db: AsyncSession = Depends(get_db),
):
    fd = _d(from_date, date.today() - timedelta(days=90))
    td = _d(to_date, date.today())
    w = "WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'"
    p: dict = {"fd": fd, "td": td}
    if outlet_id: w += " AND i.outlet_id = :oid"; p["oid"] = outlet_id
    w += access.outlet_filter("i.outlet_id", p) + access.product_filter("p", p)
    if group_by == "item":
        sel, grp = "p.item_code, p.name AS dimension", "p.item_code, p.name"
    else:
        sel, grp = "COALESCE(p.category,'Uncategorized') AS dimension, '' AS item_code", "p.category"
    q = await db.execute(text(f"""
        SELECT {sel}, COALESCE(SUM(ii.qty),0),
               COALESCE(SUM(ii.total),0),
               COALESCE(SUM(ii.qty*COALESCE(p.cost_price,0)),0),
               COALESCE(SUM(ii.disc_val),0),
               COALESCE(SUM(ii.total)-SUM(ii.qty*COALESCE(p.cost_price,0)),0),
               CASE WHEN SUM(ii.total)>0
                    THEN ROUND((SUM(ii.total)-SUM(ii.qty*COALESCE(p.cost_price,0)))*100.0/SUM(ii.total),2)
                    ELSE 0 END
        FROM unit_wise_invoice_items ii
        JOIN unit_wise_invoices i ON i.id=ii.invoice_id
        JOIN products p ON p.id=ii.product_id {w}
        GROUP BY {grp} ORDER BY 7 DESC
    """), p)
    rows = q.fetchall(); cols = q.keys()
    return {"rows": [_row_to_dict(cols, r) for r in rows], "outlets": await _outlets(db)}


@router.get("/sales-vs-purchase")
async def sales_vs_purchase_report(
    year: int = Query(default=None), outlet_id: Optional[int] = Query(default=None), db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    yr = year or date.today().year
    sp: dict = {"yr": yr, "oid": outlet_id}
    sw = " AND (CAST(:oid AS INT) IS NULL OR i.outlet_id = :oid)" + access.outlet_filter("i.outlet_id", sp)
    pw = " AND (CAST(:oid AS INT) IS NULL OR p.outlet_id = :oid)" + access.outlet_filter("p.outlet_id", sp)
    sq = await db.execute(text(f"""
        SELECT EXTRACT(MONTH FROM i.invoice_date)::int, TO_CHAR(i.invoice_date,'Mon'),
               COALESCE(SUM(i.total_amount),0), COUNT(i.id)
        FROM unit_wise_invoices i
        WHERE EXTRACT(YEAR FROM i.invoice_date)=:yr AND i.invoice_type!='return' AND i.status <> 'cancelled' {sw}
        GROUP BY 1,2 ORDER BY 1
    """), sp)
    sales = {int(r[0]): {"month": r[1], "sales": _fmt(r[2]), "bills": int(r[3] or 0)}
             for r in sq.fetchall()}
    pq = await db.execute(text(f"""
        SELECT EXTRACT(MONTH FROM p.invoice_date)::int, COALESCE(SUM(p.total_amount),0)
        FROM unit_wise_purchases p WHERE EXTRACT(YEAR FROM p.invoice_date)=:yr AND p.status NOT IN ('draft', 'cancelled') {pw} GROUP BY 1
    """), sp)
    purchases = {int(r[0]): _fmt(r[1]) for r in pq.fetchall()}
    rows = []
    for m in range(1, 13):
        s = sales.get(m, {"month": date(yr, m, 1).strftime("%b"), "sales": 0, "bills": 0})
        pu = purchases.get(m, 0)
        net = s["sales"] - pu
        rows.append({"month": s["month"], "month_num": m, "sales": s["sales"],
                      "bills": s["bills"], "purchases": pu, "net_margin": round(net, 2),
                      "margin_pct": round(net / s["sales"] * 100, 2) if s["sales"] else 0})
    return {"year": yr, "rows": rows, "outlets": await _outlets(db)}


@router.get("/item-velocity")
async def item_velocity_report(
    velocity: str = Query(default=""), outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    ow = ""; p: dict = {}
    if outlet_id: ow = "AND os.outlet_id = :oid"; p["oid"] = outlet_id
    ow += access.outlet_filter("outlet_id", p)
    sw = access.outlet_filter("i.outlet_id", p)
    pw = access.product_filter("p", p)
    q = await db.execute(text(f"""
        WITH item_sales AS (
            SELECT ii.product_id, SUM(ii.qty) AS qty_90d,
                   COUNT(DISTINCT i.id) AS bills_90d, SUM(ii.total) AS sales_90d,
                   MAX(i.invoice_date) AS last_sold
            FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id=ii.invoice_id
            WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND i.invoice_type != 'return' AND i.status <> 'cancelled' {sw}
            GROUP BY ii.product_id
        )
        SELECT p.item_code, p.name, p.category, p.brand,
               COALESCE(os_a.stk,0), COALESCE(s.qty_90d,0), COALESCE(s.bills_90d,0),
               COALESCE(s.sales_90d,0), s.last_sold,
               CASE WHEN s.last_sold IS NOT NULL THEN (CURRENT_DATE-s.last_sold) ELSE 9999 END,
               CASE WHEN COALESCE(s.qty_90d,0)>=50 THEN 'FAST'
                    WHEN COALESCE(s.qty_90d,0)>=10 THEN 'MEDIUM'
                    WHEN COALESCE(s.qty_90d,0)>0 THEN 'SLOW' ELSE 'DEAD' END
        FROM products p LEFT JOIN item_sales s ON s.product_id=p.id
        LEFT JOIN (SELECT product_id, SUM(stock_qty) AS stk FROM outlet_stock
                   WHERE stock_qty>0 {ow} GROUP BY product_id) os_a ON os_a.product_id=p.id
        WHERE p.is_active=true {pw} ORDER BY COALESCE(s.sales_90d,0) DESC LIMIT 500
    """), p)
    all_rows = [{"item_code": r[0], "item_name": r[1], "category": r[2], "brand": r[3],
                 "stock_qty": _fmt(r[4]), "qty_sold_90d": _fmt(r[5]), "bills_90d": int(r[6] or 0),
                 "sales_90d": _fmt(r[7]), "last_sold": str(r[8]) if r[8] else "",
                 "days_since_sold": int(r[9] or 0), "velocity": r[10]} for r in q.fetchall()]
    if velocity:
        all_rows = [r for r in all_rows if r["velocity"] == velocity.upper()]
    summary = {v.lower(): len([r for r in all_rows if r["velocity"] == v])
               for v in ["FAST", "MEDIUM", "SLOW", "DEAD"]}
    return {"rows": all_rows, "summary": summary, "outlets": await _outlets(db)}


@router.get("/customer-analytics")
async def customer_analytics_report(
    from_date: str = Query(default=None), to_date: str = Query(default=None),
    outlet_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    access.require_whole_bill_access()
    fd = _d(from_date, date.today() - timedelta(days=90))
    td = _d(to_date, date.today())
    p: dict = {"fd": fd, "td": td, "oid": outlet_id}
    w = access.outlet_filter("i.outlet_id", p)
    q = await db.execute(text(f"""
        SELECT c.name, COUNT(i.id), COALESCE(SUM(i.total_amount),0),
               COALESCE(AVG(i.total_amount),0), MAX(i.invoice_date), MIN(i.invoice_date), c.phone
        FROM unit_wise_invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_date BETWEEN :fd AND :td AND i.invoice_type != 'return' AND i.status <> 'cancelled'
          AND (CAST(:oid AS INT) IS NULL OR i.outlet_id = :oid) {w}
        GROUP BY c.id, c.name, c.phone ORDER BY SUM(i.total_amount) DESC LIMIT 200
    """), p)
    return {"rows": [{"customer": r[0], "visits": int(r[1] or 0), "total_spent": _fmt(r[2]),
                      "avg_bill": round(_fmt(r[3]), 2), "last_visit": str(r[4]) if r[4] else "",
                      "first_visit": str(r[5]) if r[5] else "", "phone": r[6]} for r in q.fetchall()],
            "outlets": await _outlets(db)}


@router.get("/tax-breakup")
async def tax_breakup_report(
    from_date: str = Query(default=None),
    to_date: str = Query(default=None),
    outlet_id: int = Query(default=None),
    view_mode: str = Query(default="details"),
    db: AsyncSession = Depends(get_db)
):
    access.require_unrestricted()
    fd = _d(from_date, date.today().replace(day=1))
    td = _d(to_date, date.today())
    
    where = ["i.invoice_date BETWEEN :fd AND :td", "i.invoice_type != 'return' AND i.status <> 'cancelled'"]
    params = {"fd": fd, "td": td}
    
    if outlet_id:
        where.append("i.outlet_id = :oid")
        params["oid"] = outlet_id
        
    where_str = " AND ".join(where)
    
    if view_mode == "summary":
        group_col = "'-' as date"
        group_by = "o.outlet_name, o.state"
    else:
        group_col = "c.date as date"
        group_by = "o.outlet_name, o.state, c.date"

    where_c = []
    if outlet_id:
        where_c.append("c.outlet_id = :oid")
    where_c_str = " AND ".join(where_c) if where_c else "1=1"

    query = f"""
        WITH fast_data AS (
            SELECT 
                outlet_id, summary_date as date, sales_value, basic_value, 
                gst_0, taxable_5, gst_5, taxable_12, gst_12, taxable_18, gst_18, 
                taxable_28, gst_28, taxable_40, gst_40, cess
            FROM unit_wise_tax_summary
            WHERE summary_date BETWEEN :fd AND :td
        )
        SELECT 
            COALESCE(o.state, 'N/A') as state,
            o.outlet_name as unit,
            {group_col},
            COALESCE(SUM(c.sales_value), 0) as sales_value,
            COALESCE(SUM(c.gst_0), 0) as gst_0,
            COALESCE(SUM(c.taxable_5), 0) as taxable_5,
            COALESCE(SUM(c.gst_5), 0) as gst_5,
            COALESCE(SUM(c.taxable_12), 0) as taxable_12,
            COALESCE(SUM(c.gst_12), 0) as gst_12,
            COALESCE(SUM(c.taxable_18), 0) as taxable_18,
            COALESCE(SUM(c.gst_18), 0) as gst_18,
            COALESCE(SUM(c.taxable_28), 0) as taxable_28,
            COALESCE(SUM(c.gst_28), 0) as gst_28,
            COALESCE(SUM(c.taxable_40), 0) as taxable_40,
            COALESCE(SUM(c.gst_40), 0) as gst_40,
            COALESCE(SUM(c.cess), 0) as cess,
            COALESCE(SUM(c.basic_value), 0) as basic_value
        FROM fast_data c
        JOIN outlets o ON o.id = c.outlet_id
        WHERE {where_c_str}
        GROUP BY {group_by}
        ORDER BY state, unit, date DESC
        LIMIT 2000
    """
    
    q = await db.execute(text(query), params)
    
    rows = []
    for r in q.fetchall():
        rows.append({
            "state": r[0],
            "unit": r[1],
            "date": str(r[2]),
            "sales_value": _fmt(r[3]),
            "gst_0": _fmt(r[4]),
            "taxable_5": _fmt(r[5]),
            "gst_5": _fmt(r[6]),
            "taxable_12": _fmt(r[7]),
            "gst_12": _fmt(r[8]),
            "taxable_18": _fmt(r[9]),
            "gst_18": _fmt(r[10]),
            "taxable_28": _fmt(r[11]),
            "gst_28": _fmt(r[12]),
            "taxable_40": _fmt(r[13]),
            "gst_40": _fmt(r[14]),
            "cess": _fmt(r[15]),
            "basic_value": _fmt(r[16])
        })
        
    return {"rows": rows}
