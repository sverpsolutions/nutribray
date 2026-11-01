"""Expiry, batch, correction and approval reports for the Report Center (/reports/x/<key>). Store scope applies."""
from app.core import access
from app.routers.report_engine import REPORTS, F, _rows, _where, col, report
from app.services.expiry_service import today

G = "Expiry & Batches"
BASE = """FROM product_batch_stock s JOIN product_batches b ON b.id = s.batch_id JOIN products p ON p.id = s.product_id
    LEFT JOIN item_categories c ON c.id = p.category_id LEFT JOIN outlets o ON o.id = s.location_id
    LEFT JOIN LATERAL (SELECT u.purchase_no, u.invoice_date AS grn_date FROM unit_wise_purchase_items pi JOIN unit_wise_purchases u ON u.id = pi.purchase_id
        WHERE pi.batch_id = b.id ORDER BY u.id LIMIT 1) g ON TRUE"""
STATUS = """CASE WHEN b.exp_date IS NULL THEN 'No expiry' WHEN b.exp_date <= :today THEN 'Already expired' ELSE
    COALESCE((SELECT eb.label FROM expiry_bands eb WHERE eb.days > 0 AND b.exp_date - :today <= eb.days ORDER BY eb.days LIMIT 1), 'OK') END"""
Q = "(:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR b.batch_no ILIKE :q OR g.purchase_no ILIKE :q)"
VALUE = "s.current_qty * COALESCE(NULLIF(b.cost_price, 0), p.cost_price, 0)"
COLS = [col("store", "Store"), col("item_code", "Code"), col("item", "Item"), col("category", "Category"), col("batch_no", "Batch"),
        col("grn_no", "GRN"), col("grn_date", "GRN date", "date"), col("mfg_date", "Mfg", "date"), col("exp_date", "Expiry", "date"),
        col("days_left", "Days left", "num"), col("qty", "Available", "qty"), col("value", "Stock value", "money"), col("status", "Status")]


async def _batches(db, f: F, cond: str):
    p = {"today": today(), "q": f"%{f.search.strip()}%"}
    return await _rows(db, f"""SELECT o.outlet_name AS store, p.item_code, p.name AS item, c.name AS category, b.batch_no, g.purchase_no AS grn_no,
        g.grn_date, b.mfg_date, b.exp_date, b.exp_date - :today AS days_left, s.current_qty AS qty, {VALUE} AS value, {STATUS} AS status
        {BASE} WHERE s.current_qty > 0 AND {cond} AND {Q} {_where(f, p, "s.location_id", "p")} ORDER BY b.exp_date NULLS LAST, o.outlet_name, p.name""", p)


@report("exp_near_expiry", "Near-expiry batches (store-wise)", G, "rep_stock", ("outlet", "category", "search"),
        note="Batches expiring within the longest warning band (expiry bands are configurable). Uses each batch's own expiry date.")
async def exp_near_expiry(db, f: F):
    return {"columns": COLS, "rows": await _batches(db, f, "b.exp_date > :today AND b.exp_date - :today <= (SELECT MAX(days) FROM expiry_bands)")}


@report("exp_expired", "Expired stock still in stores", G, "rep_stock", ("outlet", "category", "search"),
        note="Expired batches with stock. Remove them through Expiry → Expired Item Out (approval).")
async def exp_expired(db, f: F):
    return {"columns": COLS, "rows": await _batches(db, f, "b.exp_date <= :today")}


@report("exp_batch_inventory", "Batch-wise inventory with expiry", G, "rep_stock", ("outlet", "category", "search"))
async def exp_batch_inventory(db, f: F):
    return {"columns": COLS, "rows": await _batches(db, f, "TRUE")}


@report("exp_summary", "Expiry summary: store × band (qty & value)", G, "rep_stock", ("outlet", "category"))
async def exp_summary(db, f: F):
    p = {"today": today()}
    rows = await _rows(db, f"""SELECT o.outlet_name AS store, {STATUS} AS status, COUNT(*) AS batches, COUNT(DISTINCT p.id) AS items,
        SUM(s.current_qty) AS qty, SUM({VALUE}) AS value
        {BASE} WHERE s.current_qty > 0 AND b.exp_date IS NOT NULL {_where(f, p, "s.location_id", "p")}
        GROUP BY o.outlet_name, 2 ORDER BY o.outlet_name, MIN(b.exp_date)""", p)
    return {"columns": [col("store", "Store"), col("status", "Band"), col("batches", "Batches", "num"), col("items", "Items", "num"),
                        col("qty", "Qty", "qty"), col("value", "Value", "money")], "rows": rows}


@report("exp_category", "Expiry by category", G, "rep_stock", ("outlet", "category"))
async def exp_category(db, f: F):
    p = {"today": today()}
    rows = await _rows(db, f"""SELECT c.name AS category,
        SUM(s.current_qty) FILTER (WHERE b.exp_date <= :today) AS expired_qty,
        SUM({VALUE}) FILTER (WHERE b.exp_date <= :today) AS expired_value,
        SUM(s.current_qty) FILTER (WHERE b.exp_date > :today AND b.exp_date - :today <= 30) AS within_30_qty,
        SUM(s.current_qty) FILTER (WHERE b.exp_date - :today > 30 AND b.exp_date - :today <= 90) AS within_90_qty,
        SUM({VALUE}) FILTER (WHERE b.exp_date > :today AND b.exp_date - :today <= 90) AS near_value
        {BASE} WHERE s.current_qty > 0 AND b.exp_date IS NOT NULL {_where(f, p, "s.location_id", "p")}
        GROUP BY c.name ORDER BY expired_value DESC NULLS LAST""", p)
    return {"columns": [col("category", "Category"), col("expired_qty", "Expired qty", "qty"), col("expired_value", "Expired value", "money"),
                        col("within_30_qty", "≤ 30 days qty", "qty"), col("within_90_qty", "31–90 days qty", "qty"),
                        col("near_value", "Near-expiry value", "money")], "rows": rows}


@report("exp_removals", "Expired stock removed (register)", G, "rep_stock", ("date", "outlet", "search"))
async def exp_removals(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""SELECT CAST(r.posted_at + INTERVAL '5 hours 30 minutes' AS date) AS day, a.request_no, o.outlet_name AS store, p.item_code,
        p.name AS item, r.batch_no, r.exp_date, r.qty, r.cost_value, r.disposition, r.reason, ru.name AS requested_by, au.name AS approved_by
        FROM expired_removals r JOIN approval_requests a ON a.id = r.approval_id JOIN products p ON p.id = r.product_id
        LEFT JOIN outlets o ON o.id = r.outlet_id LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users au ON au.id = r.approved_by
        WHERE CAST(r.posted_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td AND (:q = '%%' OR p.name ILIKE :q OR r.batch_no ILIKE :q)
        {_where(f, p, "r.outlet_id", "p")} ORDER BY r.id""", p)
    return {"columns": [col("day", "Date", "date"), col("request_no", "Request"), col("store", "Store"), col("item_code", "Code"), col("item", "Item"),
                        col("batch_no", "Batch"), col("exp_date", "Expiry", "date"), col("qty", "Qty", "qty"), col("cost_value", "Value", "money"),
                        col("disposition", "Disposition"), col("reason", "Reason"), col("requested_by", "Requested by"), col("approved_by", "Approved by")],
            "rows": rows}


@report("exp_corrections", "Batch & expiry corrections", G, "rep_stock", ("date", "outlet", "search"),
        note="Every corrected sale batch and expiry date with the original value, the corrected value, requester and approver.")
async def exp_corrections(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""SELECT CAST(c.posted_at + INTERVAL '5 hours 30 minutes' AS date) AS day, a.request_no, c.kind, i.invoice_no,
        o.outlet_name AS store, p.name AS item, c.from_batch_no, c.from_expiry, c.to_batch_no, c.to_expiry, c.qty, c.reason,
        ru.name AS requested_by, au.name AS approved_by
        FROM batch_corrections c JOIN products p ON p.id = c.product_id LEFT JOIN approval_requests a ON a.id = c.approval_id
        LEFT JOIN unit_wise_invoices i ON i.id = c.invoice_id LEFT JOIN outlets o ON o.id = c.outlet_id
        LEFT JOIN users ru ON ru.id = c.requested_by LEFT JOIN users au ON au.id = c.approved_by
        WHERE CAST(c.posted_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td AND (:q = '%%' OR p.name ILIKE :q OR i.invoice_no ILIKE :q)
        {_where(f, p, "c.outlet_id")} ORDER BY c.id""", p)
    return {"columns": [col("day", "Date", "date"), col("request_no", "Request"), col("kind", "Kind"), col("invoice_no", "Bill"), col("store", "Store"),
                        col("item", "Item"), col("from_batch_no", "Original batch"), col("from_expiry", "Original expiry", "date"),
                        col("to_batch_no", "Corrected batch"), col("to_expiry", "Corrected expiry", "date"), col("qty", "Qty", "qty"),
                        col("reason", "Reason"), col("requested_by", "Requested by"), col("approved_by", "Approved by")], "rows": rows}


@report("approval_register", "Approval register (all requests)", "Audit & Compliance", "approvals", ("date", "outlet", "search"))
async def approval_register(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""SELECT TO_CHAR(a.requested_at + INTERVAL '5 hours 30 minutes', 'DD-MM-YYYY HH24:MI') AS requested, a.request_no,
        pol.label AS type, o.outlet_name AS store, ru.name AS requested_by, a.summary, a.reason, a.status, du.name AS decided_by,
        TO_CHAR(a.decided_at + INTERVAL '5 hours 30 minutes', 'DD-MM-YYYY HH24:MI') AS decided, a.decision_note, a.posted_ref
        FROM approval_requests a JOIN approval_policies pol ON pol.request_type = a.request_type LEFT JOIN outlets o ON o.id = a.outlet_id
        LEFT JOIN users ru ON ru.id = a.requested_by LEFT JOIN users du ON du.id = a.decided_by
        WHERE CAST(a.requested_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td
          AND (:q = '%%' OR a.request_no ILIKE :q OR a.summary ILIKE :q OR a.reason ILIKE :q) {_where(f, p, "a.outlet_id")} ORDER BY a.id""", p)
    return {"columns": [col("requested", "Requested"), col("request_no", "Request"), col("type", "Type"), col("store", "Store"),
                        col("requested_by", "By"), col("summary", "What"), col("reason", "Reason"), col("status", "Status"),
                        col("decided_by", "Decided by"), col("decided", "Decided"), col("decision_note", "Note"), col("posted_ref", "Posted")],
            "rows": rows}


@report("day_closing", "Store day-end closing register", "Store Operations", "day_shift", ("date", "outlet"),
        note="Every store business day: expected vs counted cash, difference, collections by payment mode, review and reopen history.")
async def day_closing(db, f: F):
    p = {"fd": f.fd, "td": f.td}
    rows = await _rows(db, f"""SELECT d.business_date, o.outlet_name AS store, d.status, d.review_status, d.reopen_count, d.last_reopen_reason,
        (SELECT string_agg(DISTINCT u.name, ', ') FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id WHERE s.business_day_id = d.id) AS cashiers,
        (SELECT COALESCE(SUM(s.expected_cash), 0) FROM cashier_shifts s WHERE s.business_day_id = d.id) AS expected_cash,
        (SELECT COALESCE(SUM(s.actual_cash), 0) FROM cashier_shifts s WHERE s.business_day_id = d.id) AS actual_cash,
        d.total_shortage, d.total_excess, d.net_sales, d.total_collected, d.mode_totals::text AS collections, d.safe_variance,
        cu.name AS closed_by, ru.name AS reviewed_by, d.review_note
        FROM business_days d LEFT JOIN outlets o ON o.id = d.outlet_id LEFT JOIN users cu ON cu.id = d.closed_by LEFT JOIN users ru ON ru.id = d.reviewed_by
        WHERE d.business_date BETWEEN :fd AND :td {_where(f, p, "d.outlet_id")} ORDER BY d.business_date DESC, o.outlet_name""", p)
    for r in rows:
        r["difference"] = (r["actual_cash"] or 0) - (r["expected_cash"] or 0)
    return {"columns": [col("business_date", "Business date", "date"), col("store", "Store"), col("status", "Day"), col("review_status", "Review"),
                        col("cashiers", "Cashiers"), col("expected_cash", "Expected cash", "money"), col("actual_cash", "Counted cash", "money"),
                        col("difference", "Difference", "money"), col("net_sales", "Net sales", "money"), col("total_collected", "Collected", "money"),
                        col("collections", "By payment mode"), col("safe_variance", "Safe variance", "money"), col("reopen_count", "Reopened", "num"),
                        col("last_reopen_reason", "Reopen reason"), col("closed_by", "Closed by"), col("reviewed_by", "Reviewed by"),
                        col("review_note", "Review note")], "rows": rows}


@report("discount_audit", "Discount audit (type, %, approval)", "Store Operations", "rep_sales", ("date", "outlet", "search"),
        note="Bills with any discount: item / scheme / bill / loyalty split, total %, and the High Discount approval used.")
async def discount_audit(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""SELECT i.invoice_date, i.invoice_no, o.outlet_name AS store, u.name AS cashier, i.total_amount,
        (i.discount_breakdown->>'item')::numeric AS item_disc, (i.discount_breakdown->>'scheme')::numeric AS scheme_disc,
        (i.discount_breakdown->>'bill')::numeric AS bill_disc, (i.discount_breakdown->>'loyalty')::numeric AS loyalty,
        (i.discount_breakdown->>'pct')::numeric AS pct, i.discount_breakdown->'types' AS types, i.discount_approval_no
        FROM unit_wise_invoices i LEFT JOIN outlets o ON o.id = i.outlet_id LEFT JOIN users u ON u.id = i.created_by
        WHERE i.invoice_date BETWEEN :fd AND :td AND i.discount_breakdown IS NOT NULL AND jsonb_array_length(i.discount_breakdown->'types') > 0
          AND i.status <> 'cancelled' AND (:q = '%%' OR i.invoice_no ILIKE :q OR i.discount_approval_no ILIKE :q) {_where(f, p, "i.outlet_id")}
        ORDER BY pct DESC NULLS LAST""", p)
    for r in rows:
        r["types"] = ", ".join(r["types"] or [])
    return {"columns": [col("invoice_date", "Date", "date"), col("invoice_no", "Bill"), col("store", "Store"), col("cashier", "Cashier"),
                        col("total_amount", "Bill total", "money"), col("item_disc", "Item", "money"), col("scheme_disc", "Scheme", "money"),
                        col("bill_disc", "Bill", "money"), col("loyalty", "Loyalty", "money"), col("pct", "Discount %", "pct"), col("types", "Types"),
                        col("discount_approval_no", "Approval")], "rows": rows}


@report("loyalty_ledger", "Loyalty points ledger", "Store Operations", "loyalty", ("date", "outlet", "search"))
async def loyalty_ledger(db, f: F):
    p = {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}
    rows = await _rows(db, f"""SELECT CAST(l.created_at + INTERVAL '5 hours 30 minutes' AS date) AS day, c.name AS customer, c.loyalty_no, o.outlet_name AS store,
        l.txn_type, l.points, l.reference, l.amount, l.eligible_amount, l.expires_on, l.reason, u.name AS by_user
        FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id LEFT JOIN outlets o ON o.id = l.outlet_id LEFT JOIN users u ON u.id = l.created_by
        WHERE CAST(l.created_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td
          AND (:q = '%%' OR c.name ILIKE :q OR c.phone ILIKE :q OR c.loyalty_no ILIKE :q OR l.reference ILIKE :q) {_where(f, p, "l.outlet_id")} ORDER BY l.id""", p)
    return {"columns": [col("day", "Date", "date"), col("customer", "Customer"), col("loyalty_no", "Loyalty no"), col("store", "Store"), col("txn_type", "Type"),
                        col("points", "Points", "num"), col("reference", "Bill / ref"), col("amount", "Redeemed ₹", "money"),
                        col("eligible_amount", "Eligible ₹", "money"), col("expires_on", "Expires", "date"), col("reason", "Reason"), col("by_user", "By")],
            "rows": rows}


access.register_paths({f"/reports/x/{k}": REPORTS[k]["module"] for k in ("exp_near_expiry", "exp_expired", "exp_batch_inventory", "exp_summary",
                                                                           "exp_category", "exp_removals", "exp_corrections", "approval_register",
                                                                           "day_closing", "discount_audit", "loyalty_ledger")})
