"""Live dashboard + store health, from synced outlet invoices, outlet_stock and sync_logs."""
import asyncio
import platform
import re
import subprocess
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from app.core import access
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])

SALE = "invoice_type <> 'return' AND status <> 'cancelled'"   # cancelled bills are not sales (same rule as shift / day close)
SALE_I = "i.invoice_type <> 'return' AND i.status <> 'cancelled'"


async def _rows(db: AsyncSession, sql: str, **params):
    return [dict(r) for r in (await db.execute(text(sql), params)).mappings().all()]


@router.get("/summary")
async def summary(
    days: int = Query(7, ge=7, le=90),
    on: date | None = Query(None, description="report date, default today"),
    db: AsyncSession = Depends(get_db),
):
    day = on or date.today()
    start = day - timedelta(days=days - 1)
    month_start = day.replace(day=1)

    # Data scope: V = the bills this user may see, as a drop-in for unit_wise_invoices. Outlet-limited users see
    # their outlets; category-limited users see only their categories' share of each bill (no receivables).
    sp: dict = {}
    of, pf = access.outlet_filter("i.outlet_id", sp), access.product_filter("p", sp)
    if pf:
        V = f"""(SELECT i.id, i.outlet_id, i.invoice_date, i.invoice_type, i.customer_id, i.invoice_no, i.status,
                        0 AS due_amount, SUM(ii.total) AS total_amount
                 FROM unit_wise_invoices i JOIN unit_wise_invoice_items ii ON ii.invoice_id = i.id
                 JOIN products p ON p.item_code = ii.item_code WHERE TRUE {of}{pf} GROUP BY i.id)"""
    elif of:
        V = f"(SELECT i.* FROM unit_wise_invoices i WHERE TRUE {of})"
    else:
        V = "unit_wise_invoices"

    kpi = (await _rows(db, f"""
        SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE invoice_date = :d AND {SALE}), 0)            AS today_sales,
          COUNT(*)                   FILTER (WHERE invoice_date = :d AND {SALE})                AS today_bills,
          COALESCE(SUM(total_amount) FILTER (WHERE invoice_date = CAST(:d AS date) - 1 AND {SALE}), 0)        AS yesterday_sales,
          COALESCE(SUM(total_amount) FILTER (WHERE invoice_date BETWEEN :m AND :d AND {SALE}), 0) AS month_sales,
          COALESCE(SUM(total_amount) FILTER (WHERE invoice_date = :d AND invoice_type = 'return' AND status <> 'cancelled'), 0) AS today_returns,
          COALESCE(SUM(due_amount)   FILTER (WHERE due_amount > 0 AND {SALE}), 0)               AS receivables,
          COUNT(*)                   FILTER (WHERE due_amount > 0 AND {SALE})                   AS unpaid_bills
        FROM {V} AS unit_wise_invoices""", d=day, m=month_start, **sp))[0]
    kpi["avg_bill"] = (kpi["today_sales"] / kpi["today_bills"]) if kpi["today_bills"] else 0

    daily = await _rows(db, f"""
        SELECT g::date AS day, COALESCE(SUM(i.total_amount), 0) AS sales, COUNT(i.id) AS bills
        FROM generate_series(CAST(:s AS date), CAST(:d AS date), interval '1 day') g
        LEFT JOIN {V} i ON i.invoice_date = g::date AND {SALE_I}
        GROUP BY g ORDER BY g""", s=start, d=day, **sp)

    stores = await _rows(db, f"""
        SELECT o.id, o.outlet_name AS name, o.unit_code AS code,
               COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date = :d), 0)              AS today_sales,
               COUNT(i.id)                  FILTER (WHERE i.invoice_date = :d)                  AS today_bills,
               COALESCE(SUM(i.total_amount) FILTER (WHERE i.invoice_date BETWEEN :m AND :d), 0) AS month_sales,
               MAX(i.invoice_date)                                                              AS last_bill_date
        FROM outlets o
        LEFT JOIN {V} i ON i.outlet_id = o.id AND {SALE_I}
        WHERE o.is_active {access.outlet_filter("o.id", sp)}
        GROUP BY o.id ORDER BY today_sales DESC, month_sales DESC""", d=day, m=month_start, **sp)

    top_items = await _rows(db, f"""
        SELECT ii.item_code, MAX(ii.name) AS name, SUM(ii.qty) AS qty, SUM(ii.total) AS value
        FROM unit_wise_invoice_items ii JOIN unit_wise_invoices i ON i.id = ii.invoice_id
        {"JOIN products p ON p.item_code = ii.item_code" if pf else ""}
        WHERE i.invoice_date BETWEEN :s AND :d AND {SALE_I} {of}{pf}
        GROUP BY ii.item_code ORDER BY value DESC LIMIT 8""", s=start, d=day, **sp)

    # reorder levels are unset and thresholds default on every item, so "low stock" =
    # items that sold at an outlet in the last 30 days and now have no stock there
    stockouts = await _rows(db, f"""
        WITH sold AS (
          -- synced outlet lines carry the outlet's item code in product_id; match HO products by item_code
          SELECT i.outlet_id, p.id AS product_id, SUM(ii.qty) AS sold_qty
          FROM unit_wise_invoice_items ii
          JOIN unit_wise_invoices i ON i.id = ii.invoice_id
          JOIN products p ON p.item_code = ii.item_code
          WHERE i.invoice_date > CAST(:d AS date) - 30 AND {SALE_I} AND i.outlet_id IS NOT NULL {of}{pf}
          GROUP BY 1, 2)
        SELECT s.outlet_id, o.outlet_name AS outlet, p.id AS product_id, p.name, p.item_code,
               s.sold_qty, COALESCE(os.stock_qty, 0) AS stock_qty
        FROM sold s
        JOIN products p ON p.id = s.product_id
        JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN outlet_stock os ON os.outlet_id = s.outlet_id AND os.product_id = s.product_id
        WHERE COALESCE(os.stock_qty, 0) <= 0
        ORDER BY s.sold_qty DESC LIMIT 10""", d=day, **sp)
    stockout_count = (await db.execute(text(f"""
        SELECT COUNT(*) FROM (
          SELECT i.outlet_id, p.id AS product_id
          FROM unit_wise_invoice_items ii
          JOIN unit_wise_invoices i ON i.id = ii.invoice_id
          JOIN products p ON p.item_code = ii.item_code
          WHERE i.invoice_date > CAST(:d AS date) - 30 AND {SALE_I} AND i.outlet_id IS NOT NULL {of}{pf}
          GROUP BY 1, 2) s
        LEFT JOIN outlet_stock os ON os.outlet_id = s.outlet_id AND os.product_id = s.product_id
        WHERE COALESCE(os.stock_qty, 0) <= 0"""), {"d": day, **sp})).scalar()

    recent = await _rows(db, f"""
        SELECT i.id, i.invoice_no, i.invoice_date, i.total_amount, i.due_amount, i.status, i.invoice_type,
               o.outlet_name AS outlet, c.name AS customer
        FROM {V} i
        LEFT JOIN outlets o ON o.id = i.outlet_id
        LEFT JOIN customers c ON c.id = i.customer_id
        ORDER BY i.invoice_date DESC, i.id DESC LIMIT 8""", **sp)

    tp: dict = {}
    tf = access.outlet_filter("from_outlet_id", tp)
    if tf:
        tf = f" AND (from_outlet_id = ANY(:_scope_outlets) OR to_outlet_id = ANY(:_scope_outlets))"
    transfers = (await _rows(db, f"""
        SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
               COUNT(*) FILTER (WHERE transfer_date = :d) AS today
        FROM unit_wise_stock_transfers WHERE TRUE {tf}""", d=day, **tp))[0]

    return {
        "date": day, "kpi": kpi, "daily": daily, "stores": stores, "top_items": top_items,
        "stockouts": stockouts, "stockout_count": stockout_count, "recent_invoices": recent,
        "transfers": transfers,
    }


@router.get("/store-health")
async def store_health(db: AsyncSession = Depends(get_db)):
    """Per outlet: last successful/failed sync, last bill, today's sales. No network calls."""
    sp: dict = {}
    return await _rows(db, f"""
        SELECT o.id, o.outlet_name AS name, o.unit_code AS code, o.server_name IS NOT NULL AND o.server_name <> '' AS has_server,
               (SELECT MAX(created_at) FROM sync_logs l WHERE l.outlet_id = o.id AND l.status = 'success') AS last_sync_ok,
               (SELECT MAX(created_at) FROM sync_logs l WHERE l.outlet_id = o.id AND l.status <> 'success') AS last_sync_fail,
               (SELECT message FROM sync_logs l WHERE l.outlet_id = o.id AND l.status <> 'success' ORDER BY id DESC LIMIT 1) AS last_error,
               (SELECT MAX(invoice_date) FROM unit_wise_invoices i WHERE i.outlet_id = o.id) AS last_bill_date,
               (SELECT COALESCE(SUM(total_amount), 0) FROM unit_wise_invoices i
                 WHERE i.outlet_id = o.id AND i.invoice_date = CURRENT_DATE AND i.invoice_type <> 'return' AND i.status <> 'cancelled') AS today_sales
        FROM outlets o WHERE o.is_active {access.outlet_filter("o.id", sp)} ORDER BY o.outlet_name""", **sp)


def _host(server_name: str | None) -> str | None:
    # "26.249.176.14\\sqlexpress" or "26.1.2.3,1433" -> "26.249.176.14"
    return re.split(r"[\\,]", server_name)[0].strip() if server_name else None


async def ping_host(host: str, timeout_ms: int = 1500) -> bool:
    """One ICMP echo via the OS ping. Reachable outlets answer; unreachable ones never do.
    Runs in a thread: uvicorn --reload on Windows uses a selector loop with no async subprocess support."""
    flag = ["-n", "1", "-w", str(timeout_ms)] if platform.system() == "Windows" else ["-c", "1", "-W", str(max(1, timeout_ms // 1000))]
    try:
        out = await asyncio.to_thread(
            subprocess.run, ["ping", *flag, host], capture_output=True, timeout=timeout_ms / 1000 + 3)
        return b"TTL=" in out.stdout.upper()
    except Exception:
        return False


@router.get("/store-health/ping")
async def ping_stores(db: AsyncSession = Depends(get_db)):
    """Live reachability of every outlet's POS server over the VPN, checked in parallel."""
    outs = await _rows(db, "SELECT id, server_name FROM outlets WHERE is_active AND COALESCE(server_name, '') <> ''")
    hosts = [_host(o["server_name"]) for o in outs]
    results = await asyncio.gather(*(ping_host(h) for h in hosts))
    return {o["id"]: ok for o, ok in zip(outs, results)}
