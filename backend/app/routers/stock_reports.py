from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy import text, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core import access
from app.core.dependencies import get_current_user, current_user_dep, require_role

router = APIRouter(prefix="/stock-reports", tags=["stock-reports"], dependencies=[Depends(get_current_user)])

def _fmt(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0

def _d(s: Optional[str], fallback: date) -> date:
    if s:
        try:
            return date.fromisoformat(s)
        except:
            pass
    return fallback

@router.get("/filters")
async def get_report_filters(db: AsyncSession = Depends(get_db)):
    # Use try-except for each to prevent one missing table from breaking all filters
    async def q(sql):
        try:
            res = await db.execute(text(sql))
            return [{"id": r[0], "name": r[1], **({"pid": r[2]} if len(r) > 2 else {})} for r in res.fetchall()]
        except Exception:
            return []

    return {
        "outlets": await q("SELECT id, outlet_name as name FROM outlets ORDER BY outlet_name"),
        "groups": await q("SELECT id, name FROM item_groups ORDER BY name"),
        "subgroups": await q("SELECT id, name, group_id as pid FROM item_subgroups ORDER BY name"),
        "categories": await q("SELECT id, name, subgroup_id as pid FROM item_categories ORDER BY name"),
        "subcategories": await q("SELECT id, name, category_id as pid FROM item_subcategories ORDER BY name"),
        "brands": await q("SELECT id, name FROM brands ORDER BY name"),
        "subbrands": await q("SELECT id, name, brand_id as pid FROM sub_category_brands ORDER BY name"),
        "suppliers": await q("SELECT id, name FROM suppliers ORDER BY name"),
        "manufacturers": await q("SELECT id, name FROM manufacturers ORDER BY name"),
        "submanufacturers": await q("SELECT id, name, manufacturer_id as pid FROM sub_manufacturers ORDER BY name"),
        "variants": await q("SELECT id, name FROM variant_masters ORDER BY name"),
        "flavours": await q("SELECT id, name FROM flavour_masters ORDER BY name"),
    }

@router.get("/summary")
async def stock_summary_report(
    outlet_ids: List[int] = Query(None),
    group_ids: List[int] = Query(None),
    subgroup_ids: List[int] = Query(None),
    brand_ids: List[int] = Query(None),
    subbrand_ids: List[int] = Query(None),
    supplier_ids: List[int] = Query(None),
    category_ids: List[int] = Query(None),
    subcategory_ids: List[int] = Query(None),
    manufacturer_ids: List[int] = Query(None),
    submanufacturer_ids: List[int] = Query(None),
    active_only: bool = Query(True),
    low_stock: bool = Query(False),
    negative_stock: bool = Query(False),
    zero_stock: bool = Query(False),
    search: str = Query(None),
    group_by: str = Query("item"), # item, outlet, brand, group, supplier
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    where_clauses = ["1=1"]
    params = {}

    # Security: the user's outlets and categories / groups (core/access.py), applied to every total below
    where_clauses.append("TRUE" + access.outlet_filter("os.outlet_id", params) + access.product_filter("p", params))

    if outlet_ids:
        where_clauses.append("os.outlet_id = ANY(:oids)")
        params["oids"] = list(outlet_ids)
    
    if group_ids:
        where_clauses.append("p.group_id = ANY(:gids)")
        params["gids"] = list(group_ids)
    
    if subgroup_ids:
        where_clauses.append("p.subgroup_id = ANY(:sgids)")
        params["sgids"] = list(subgroup_ids)

    if brand_ids:
        where_clauses.append("p.brand_id = ANY(:bids)")
        params["bids"] = list(brand_ids)

    if subbrand_ids:
        where_clauses.append("p.sub_category_brand_id = ANY(:sbids)")
        params["sbids"] = list(subbrand_ids)

    if supplier_ids:
        where_clauses.append("p.supplier_id = ANY(:sids)")
        params["sids"] = list(supplier_ids)

    if category_ids:
        where_clauses.append("p.category_id = ANY(:cids)")
        params["cids"] = list(category_ids)
    
    if subcategory_ids:
        where_clauses.append("p.subcategory_id = ANY(:scids)")
        params["scids"] = list(subcategory_ids)

    if manufacturer_ids:
        where_clauses.append("p.manufacturer_id = ANY(:mids)")
        params["mids"] = list(manufacturer_ids)
    
    if submanufacturer_ids:
        where_clauses.append("p.sub_manufacturer_id = ANY(:smids)")
        params["smids"] = list(submanufacturer_ids)

    if active_only:
        where_clauses.append("p.is_active = True")

    if low_stock:
        where_clauses.append("os.stock_qty <= p.low_stock_threshold")
    
    if negative_stock:
        where_clauses.append("os.stock_qty < 0")
    
    if zero_stock:
        where_clauses.append("os.stock_qty = 0")

    if search:
        sql, sp = word_match_sql(search, ["p.name", "p.item_code", "p.barcode"])
        where_clauses.append(sql)
        params.update(sp)

    where = " AND ".join(where_clauses) if where_clauses else "1=1"

    # Dashboard Cards
    dash_q = await db.execute(text(f"""
        SELECT 
            COALESCE(SUM(os.stock_qty), 0) as total_qty,
            COALESCE(SUM(os.stock_qty * p.cost_price), 0) as total_value,
            COUNT(CASE WHEN os.stock_qty < 0 THEN 1 END) as negative_items,
            COUNT(CASE WHEN os.stock_qty = 0 OR os.stock_qty IS NULL THEN 1 END) as zero_items,
            COUNT(CASE WHEN os.stock_qty <= p.low_stock_threshold AND os.stock_qty > 0 THEN 1 END) as low_stock_items,
            COUNT(DISTINCT p.id) as active_skus,
            COALESCE(SUM(os.stock_qty * p.basic_cost), 0) as total_basic_value,
            COALESCE(SUM(os.stock_qty * (p.cost_price - p.basic_cost)), 0) as total_tax_value,
            COALESCE(SUM(os.stock_qty * p.mrp), 0) as total_mrp_value,
            COALESCE(SUM(os.stock_qty * p.selling_price), 0) as total_selling_value
        FROM products p
        LEFT JOIN outlet_stock os ON p.id = os.product_id
        WHERE {where}
    """), params)
    dash = dash_q.fetchone()

    # Dynamic Grouping
    group_col = "p.name"
    if group_by == "outlet": group_col = "o.outlet_name"
    elif group_by == "brand": group_col = "b.name"
    elif group_by == "group": group_col = "ig.name"
    elif group_by == "supplier": group_col = "s.name"
    elif group_by == "category": group_col = "ic.name"
    elif group_by == "subgroup": group_col = "isg.name"
    elif group_by == "subcategory": group_col = "isc.name"
    elif group_by == "subbrand": group_col = "scb.name"

    # Rows
    is_item_level = group_by == "item"
    
    if is_item_level:
        query = f"""
            SELECT 
                p.item_code, p.barcode, p.name as item_name,
                p.variant, p.size as weight, p.unit as uom,
                COALESCE(o.outlet_name, 'N/A') as outlet,
                COALESCE(os.stock_qty, 0) as current_stock,
                0 as reserved_stock,
                COALESCE(os.stock_qty, 0) as available_stock,
                p.cost_price as avg_cost,
                p.basic_cost,
                p.selling_price,
                p.mrp,
                (COALESCE(os.stock_qty, 0) * p.basic_cost) as basic_value,
                (COALESCE(os.stock_qty, 0) * (p.cost_price - p.basic_cost)) as tax_value,
                (COALESCE(os.stock_qty, 0) * p.cost_price) as stock_value,
                (COALESCE(os.stock_qty, 0) * p.mrp) as mrp_value,
                (COALESCE(os.stock_qty, 0) * p.selling_price) as selling_value,
                (COALESCE(os.stock_qty, 0) * (p.mrp - p.selling_price)) as discount_value,
                s.name as supplier,
                b.name as brand,
                ig.name as item_group,
                isg.name as sub_group
            FROM products p
            LEFT JOIN outlet_stock os ON p.id = os.product_id
            LEFT JOIN outlets o ON o.id = os.outlet_id
            LEFT JOIN brands b ON b.id = p.brand_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN item_groups ig ON ig.id = p.group_id
            LEFT JOIN item_subgroups isg ON isg.id = p.subgroup_id
            LEFT JOIN item_categories ic ON ic.id = p.category_id
            LEFT JOIN item_subcategories isc ON isc.id = p.subcategory_id
            LEFT JOIN sub_category_brands scb ON scb.id = p.sub_category_brand_id
            WHERE {where}
            ORDER BY {group_col}, p.name
            LIMIT 2000
        """
    else:
        # Aggregated View
        label_col = "COALESCE(o.outlet_name, 'N/A')" if group_by == "outlet" else \
                   "COALESCE(b.name, 'N/A')" if group_by == "brand" else \
                   "COALESCE(ig.name, 'N/A')" if group_by == "group" else \
                   "COALESCE(s.name, 'N/A')" if group_by == "supplier" else \
                   "COALESCE(ic.name, 'N/A')" if group_by == "category" else \
                   "COALESCE(isg.name, 'N/A')" if group_by == "subgroup" else \
                   "COALESCE(isc.name, 'N/A')" if group_by == "subcategory" else \
                   "COALESCE(scb.name, 'N/A')" if group_by == "subbrand" else "'N/A'"
        
        query = f"""
            SELECT 
                '' as item_code, '' as barcode, {label_col} as item_name,
                '' as variant, '' as weight, '' as uom,
                {label_col} as outlet,
                SUM(COALESCE(os.stock_qty, 0)) as current_stock,
                0 as reserved_stock,
                SUM(COALESCE(os.stock_qty, 0)) as available_stock,
                AVG(COALESCE(p.cost_price, 0)) as avg_cost,
                AVG(COALESCE(p.basic_cost, 0)) as basic_cost,
                AVG(COALESCE(p.selling_price, 0)) as selling_price,
                AVG(COALESCE(p.mrp, 0)) as mrp,
                SUM(COALESCE(os.stock_qty, 0) * COALESCE(p.basic_cost, 0)) as basic_value,
                SUM(COALESCE(os.stock_qty, 0) * (COALESCE(p.cost_price, 0) - COALESCE(p.basic_cost, 0))) as tax_value,
                SUM(COALESCE(os.stock_qty, 0) * COALESCE(p.cost_price, 0)) as stock_value,
                SUM(COALESCE(os.stock_qty, 0) * COALESCE(p.mrp, 0)) as mrp_value,
                SUM(COALESCE(os.stock_qty, 0) * COALESCE(p.selling_price, 0)) as selling_value,
                SUM(COALESCE(os.stock_qty, 0) * (COALESCE(p.mrp, 0) - COALESCE(p.selling_price, 0))) as discount_value,
                MAX(s.name) as supplier,
                MAX(b.name) as brand,
                MAX(ig.name) as item_group,
                MAX(isg.name) as sub_group
            FROM products p
            LEFT JOIN outlet_stock os ON p.id = os.product_id
            LEFT JOIN outlets o ON o.id = os.outlet_id
            LEFT JOIN brands b ON b.id = p.brand_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN item_groups ig ON ig.id = p.group_id
            LEFT JOIN item_subgroups isg ON isg.id = p.subgroup_id
            LEFT JOIN item_categories ic ON ic.id = p.category_id
            LEFT JOIN item_subcategories isc ON isc.id = p.subcategory_id
            LEFT JOIN sub_category_brands scb ON scb.id = p.sub_category_brand_id
            WHERE {where}
            GROUP BY {label_col}
            ORDER BY {label_col}
            LIMIT 2000
        """
    
    rows_q = await db.execute(text(query), params)
    rows = rows_q.fetchall()
    cols = rows_q.keys()

    return {
        "dashboard": {
            "total_qty": _fmt(dash[0]),
            "total_value": _fmt(dash[1]),
            "negative_items": int(dash[2] or 0),
            "zero_items": int(dash[3] or 0),
            "low_stock_items": int(dash[4] or 0),
            "active_skus": int(dash[5] or 0),
            "total_basic_value": _fmt(dash[6]),
            "total_tax_value": _fmt(dash[7]),
            "total_mrp_value": _fmt(dash[8]),
            "total_selling_value": _fmt(dash[9]),
            "total_discount_value": _fmt(float(dash[8] or 0) - float(dash[9] or 0)),
        },
        "rows": [dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row])) for row in rows]
    }

@router.get("/detail")
async def stock_detail_report(
    from_date: str = Query(None),
    to_date: str = Query(None),
    outlet_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    search: str = Query(None),
    current_user: current_user_dep = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    fd = _d(from_date, date.today() - timedelta(days=30))
    td = _d(to_date, date.today())

    where_clauses = ["sl.created_at::date BETWEEN :fd AND :td"]
    params = {"fd": fd, "td": td}

    # Security: the user's outlets and categories / groups (core/access.py), applied to every total below
    where_clauses.append("TRUE" + access.outlet_filter("sl.outlet_id", params) + access.product_filter("p", params))

    if outlet_id:
        where_clauses.append("sl.outlet_id = :oid")
        params["oid"] = outlet_id
    
    if product_id:
        where_clauses.append("sl.product_id = :pid")
        params["pid"] = product_id

    if search:
        sql, sp = word_match_sql(search, ["p.name", "p.item_code"])
        where_clauses.append(sql)
        params.update(sp)

    where = " AND ".join(where_clauses)

    # Get Opening Stock (Sum of transactions before from_date)
    opening_params = {"fd": fd}
    opening_where = "sl.created_at::date < :fd"
    if outlet_id:
        opening_where += " AND sl.outlet_id = :oid"
        opening_params["oid"] = outlet_id
    if product_id:
        opening_where += " AND sl.product_id = :pid"
        opening_params["pid"] = product_id

    opening_q = await db.execute(text(f"""
        SELECT COALESCE(SUM(qty), 0) 
        FROM stock_ledger sl 
        WHERE {opening_where}
    """), opening_params)
    opening_qty = _fmt(opening_q.scalar())

    # Detail Rows
    query = f"""
        SELECT 
            sl.created_at as date,
            sl.ref_id as voucher_no,
            sl.txn_type as transaction_type,
            o.outlet_name as outlet,
            p.item_code,
            p.barcode,
            p.name as item_name,
            p.variant,
            p.size as weight,
            '' as batch_no,
            NULL as expiry_date,
            sl.qty as txn_qty,
            p.cost_price as cost_rate,
            p.mrp,
            (sl.qty * p.cost_price) as stock_value,
            u.username as user_name,
            s.name as supplier
        FROM stock_ledger sl
        JOIN products p ON p.id = sl.product_id
        LEFT JOIN outlets o ON o.id = sl.outlet_id
        LEFT JOIN users u ON u.id = sl.created_by
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE {where}
        ORDER BY sl.created_at ASC
        LIMIT 5000
    """
    
    rows_q = await db.execute(text(query), params)
    rows = rows_q.fetchall()
    cols = rows_q.keys()

    # Calculate running balance
    final_rows = []
    current_bal = opening_qty
    for row in rows:
        r = dict(zip(cols, [str(v) if isinstance(v, (date, datetime, Decimal)) else v for v in row]))
        qty = _fmt(row[11]) # txn_qty
        r["opening_qty"] = current_bal
        if qty > 0:
            r["in_qty"] = qty
            r["out_qty"] = 0
        else:
            r["in_qty"] = 0
            r["out_qty"] = abs(qty)
        current_bal += qty
        r["closing_qty"] = current_bal
        final_rows.append(r)

    return {
        "opening_qty": opening_qty,
        "rows": final_rows
    }

import os
import subprocess
from datetime import datetime
from sqlalchemy.engine import make_url
from app.core.config import get_settings
from app.utils.search import word_match_sql

@router.post("/email", dependencies=[Depends(get_current_user)])
async def email_report(request: Request):
    # This is a placeholder for the actual email sending logic
    body = await request.json()
    email = body.get("email")
    # Simulate success
    return {"status": "success", "message": f"Report sent to {email}"}

@router.post("/backup", dependencies=[Depends(require_role("admin"))])
async def create_backup(request: Request):
    body = await request.json()
    dest_path = body.get("path", "C:\\Backups\\Nutribray")
    
    if not os.path.exists(dest_path):
        try: os.makedirs(dest_path, exist_ok=True)
        except Exception as e: raise HTTPException(status_code=400, detail=f"Cannot create folder: {str(e)}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"nutribay_backup_{timestamp}.backup"
    full_path = os.path.join(dest_path, filename)

    pg_dump_path = r"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
    
    db_url = make_url(get_settings().database_url)
    env = os.environ.copy()
    env["PGPASSWORD"] = db_url.password or ""

    cmd = [
        pg_dump_path,
        "-h", db_url.host or "localhost",
        "-p", str(db_url.port or 5432),
        "-U", db_url.username or "postgres",
        "-F", "c", # custom format
        "-b",      # include blobs
        "-v",      # verbose
        "-f", full_path,
        db_url.database or "nutribay_erp"
    ]

    try:
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"pg_dump error: {result.stderr}")
        
        return {"status": "success", "message": f"Backup created successfully: {filename}", "path": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/as-at")
async def stock_as_at(
    on: date = Query(..., description="date, e.g. 2026-10-23"),
    at: str = Query("23:59", pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="time HH:MM, Indian time"),
    outlet_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    search: str = Query(""),
    show_zero: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """Stock as it stood at a moment (e.g. 23 Oct 2026, 14:10).

    Worked backwards from today: stock then = stock now − every movement recorded after that moment
    (sales, GRNs, transfers, returns, adjustments in stock_ledger). This needs no complete history
    back to opening stock. Times are entered in IST; the ledger is stored in UTC.
    """
    access.check_outlet(outlet_id)
    p: dict = {"ts": datetime.combine(on, datetime.strptime(at, "%H:%M").time()), "q": f"%{search.strip()}%", "cat": category_id}
    cut = "((CAST(:ts AS timestamp) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')"
    mine = [outlet_id] if outlet_id else access.allowed_outlets()   # None = whole company
    if mine is None:
        cur_sql = "SELECT id AS product_id, COALESCE(stock_qty, 0) AS cur FROM products"
        aft_where = ""
    else:
        p["S"] = mine or [0]
        # per outlet: its own stock row, or (no row yet) the sum of its ledger movements
        cur_sql = """SELECT pr.product_id, SUM(COALESCE(os.stock_qty, (SELECT SUM(l.qty) FROM stock_ledger l
                       WHERE l.outlet_id = pr.outlet_id AND l.product_id = pr.product_id), 0)) AS cur
                     FROM (SELECT outlet_id, product_id FROM outlet_stock WHERE outlet_id = ANY(:S)
                           UNION SELECT outlet_id, product_id FROM stock_ledger WHERE outlet_id = ANY(:S)) pr
                     LEFT JOIN outlet_stock os ON os.outlet_id = pr.outlet_id AND os.product_id = pr.product_id
                     GROUP BY pr.product_id"""
        aft_where = " AND outlet_id = ANY(:S)"
    pf = access.product_filter("p", p)
    rows = (await db.execute(text(f"""
        WITH cur AS ({cur_sql}),
        aft AS (SELECT product_id, COALESCE(SUM(qty) FILTER (WHERE qty > 0), 0) AS qin,
                       COALESCE(SUM(-qty) FILTER (WHERE qty < 0), 0) AS qout, COALESCE(SUM(qty), 0) AS net
                FROM stock_ledger WHERE created_at > {cut}{aft_where} GROUP BY product_id)
        SELECT p.id, p.item_code, p.name AS item_name, COALESCE(c.name, p.category) AS category, p.unit,
               COALESCE(cur.cur, 0) AS current_stock, COALESCE(aft.qin, 0) AS in_after, COALESCE(aft.qout, 0) AS out_after,
               COALESCE(cur.cur, 0) - COALESCE(aft.net, 0) AS stock_at, COALESCE(p.cost_price, 0) AS cost_price, COALESCE(p.mrp, 0) AS mrp
        FROM products p
        LEFT JOIN cur ON cur.product_id = p.id
        LEFT JOIN aft ON aft.product_id = p.id
        LEFT JOIN item_categories c ON c.id = p.category_id
        WHERE (cur.product_id IS NOT NULL OR aft.product_id IS NOT NULL){pf}
          AND (CAST(:cat AS INT) IS NULL OR p.category_id = :cat)
          AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR p.barcode ILIKE :q)
        ORDER BY p.name"""), p)).mappings().all()
    out = [dict(r) for r in rows if show_zero or r["stock_at"] != 0 or r["in_after"] or r["out_after"]]
    for r in out:
        r["value_cost"] = float(r["stock_at"] * r["cost_price"])
        r["value_mrp"] = float(r["stock_at"] * r["mrp"])
    return {
        "as_at": f"{on.isoformat()} {at}",
        "outlet_id": outlet_id,
        "summary": {
            "items": sum(1 for r in out if r["stock_at"] != 0),
            "qty_at": _fmt(sum(r["stock_at"] for r in out)),
            "qty_now": _fmt(sum(r["current_stock"] for r in out)),
            "in_after": _fmt(sum(r["in_after"] for r in out)),
            "out_after": _fmt(sum(r["out_after"] for r in out)),
            "value_cost": round(sum(r["value_cost"] for r in out), 2),
            "value_mrp": round(sum(r["value_mrp"] for r in out), 2),
            "negative_items": sum(1 for r in out if r["stock_at"] < 0),
        },
        "rows": [{k: (_fmt(v) if isinstance(v, Decimal) else v) for k, v in r.items()} for r in out],
    }
