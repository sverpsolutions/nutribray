"""Manufacturing reports (Phase E) registered into the Report Center engine (/reports/x/<key>, Excel + print there).

Plant stock is counted once: every unit sits in exactly one mfg store, and stores are classified (available / WIP /
QC hold / rejected / damaged / dispatch) instead of being added together. The search box filters customer, brand,
item, batch, job and order numbers.
"""
from app.core import access
from app.routers.report_engine import REPORTS, F, _rows, col, report

G_INV, G_PRN, G_PRD, G_DMG, G_FG = ("Manufacturing · Plant Stock", "Manufacturing · Printing", "Manufacturing · Production",
                                    "Manufacturing · Damage & Quality", "Manufacturing · Finished Goods & Dispatch")
M = "manufacturing"
IST = "(t.posted_at + INTERVAL '5 hours 30 minutes')"
UPC = """LEFT JOIN LATERAL (SELECT COALESCE((SELECT s.units_per_carton FROM mfg_pack_specs s WHERE s.product_id = {p} AND s.brand_id = {b}
            AND s.status = 'APPROVED' ORDER BY s.revision DESC LIMIT 1),
        (SELECT NULLIF(pk.total_units_per_carton, 0) FROM item_packaging_master pk WHERE pk.product_id = {p} AND pk.is_active LIMIT 1), 1) AS upc) u ON TRUE"""
CLASS = """CASE WHEN st.kind = 'QC' THEN 'QC hold' WHEN st.kind = 'REJECTED' THEN 'Rejected' WHEN st.kind = 'SCRAP' THEN 'Damaged / scrap'
    WHEN st.kind = 'DISPATCH' THEN 'With billing / dispatch' WHEN st.is_wip THEN 'Work in progress' WHEN st.usable THEN 'Available' ELSE 'Blocked' END"""
CTN = [col("cartons", "Cartons", "qty"), col("loose", "Loose", "qty"), col("upc", "Per carton", "num")]


def _q(f: F) -> dict:
    return {"fd": f.fd, "td": f.td, "q": f"%{f.search.strip()}%"}


def _cartons(rows, qty="qty"):
    for r in rows:
        upc = max(int(r.get("upc") or 1), 1)
        r["cartons"] = int((r[qty] or 0) // upc)
        r["loose"] = round((r[qty] or 0) - r["cartons"] * upc, 4)
    return rows


# ── A. plant stock ────────────────────────────────────────────────────────────
@report("mfg_store_stock", "Department-wise stock: physical, reserved, available", G_INV, M, ("search",),
        note="Each unit in exactly one department store. Reserved = earmarked for customer orders (stock does not move until handover).")
async def mfg_store_stock(db, f: F):
    rows = await _rows(db, f"""SELECT st.code AS store, st.name AS store_name, {CLASS} AS status, p.item_code, p.name AS item, b.name AS brand,
        m.batch_no, m.qty, COALESCE(r.res, 0) AS reserved,
        CASE WHEN st.usable AND NOT st.is_wip THEN m.qty - COALESCE(r.res, 0) ELSE 0 END AS available, u.upc
        FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id JOIN products p ON p.id = m.product_id LEFT JOIN mfg_brands b ON b.id = m.brand_id
        LEFT JOIN (SELECT store_id, product_id, batch_no, brand_id, SUM(qty) AS res FROM mfg_fg_reservations GROUP BY 1, 2, 3, 4) r
          ON r.store_id = m.store_id AND r.product_id = m.product_id AND r.batch_no = m.batch_no AND r.brand_id = m.brand_id
        {UPC.format(p='m.product_id', b='m.brand_id')}
        WHERE m.qty <> 0 AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR b.name ILIKE :q OR m.batch_no ILIKE :q)
        ORDER BY st.sort, p.name, m.batch_no""", _q(f))
    return {"columns": [col("store", "Store"), col("store_name", "Department"), col("status", "Stock status"), col("item_code", "Code"),
                        col("item", "Item"), col("brand", "Brand / customer"), col("batch_no", "Batch"), col("qty", "Physical", "qty"),
                        col("reserved", "Reserved", "qty"), col("available", "Available", "qty"), *CTN], "rows": _cartons(rows)}


@report("mfg_item_stock", "Item-wise plant stock by status (no double counting)", G_INV, M, ("search",))
async def mfg_item_stock(db, f: F):
    rows = await _rows(db, f"""SELECT p.item_code, p.name AS item, b.name AS brand, UPPER(COALESCE(p.unit, 'PCS')) AS unit,
        SUM(m.qty) FILTER (WHERE st.usable AND NOT st.is_wip) AS available, SUM(m.qty) FILTER (WHERE st.is_wip) AS wip,
        SUM(m.qty) FILTER (WHERE st.kind = 'QC') AS qc_hold, SUM(m.qty) FILTER (WHERE st.kind = 'REJECTED') AS rejected,
        SUM(m.qty) FILTER (WHERE st.kind = 'SCRAP') AS damaged, SUM(m.qty) FILTER (WHERE st.kind = 'DISPATCH') AS dispatch,
        SUM(m.qty) AS qty, SUM(m.qty * COALESCE(p.cost_price, 0)) AS value, MAX(u.upc) AS upc
        FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id JOIN products p ON p.id = m.product_id LEFT JOIN mfg_brands b ON b.id = m.brand_id
        {UPC.format(p='m.product_id', b='m.brand_id')}
        WHERE m.qty <> 0 AND (:q = '%%' OR p.name ILIKE :q OR p.item_code ILIKE :q OR b.name ILIKE :q)
        GROUP BY p.item_code, p.name, b.name, p.unit ORDER BY p.name""", _q(f))
    return {"columns": [col("item_code", "Code"), col("item", "Item"), col("brand", "Brand"), col("unit", "Unit"), col("available", "Available", "qty"),
                        col("wip", "WIP", "qty"), col("qc_hold", "QC hold", "qty"), col("rejected", "Rejected", "qty"), col("damaged", "Damaged", "qty"),
                        col("dispatch", "Billing / dispatch", "qty"), col("qty", "Total", "qty"), *CTN, col("value", "Value", "money")],
            "rows": _cartons(rows)}


@report("mfg_customer_pack_stock", "Customer-specific packaging stock (design-wise)", G_INV, M, ("search",),
        note="Brand-specific printed tins, caps, labels and cartons — never interchangeable between customers.")
async def mfg_customer_pack_stock(db, f: F):
    rows = await _rows(db, f"""SELECT b.name AS brand, c.name AS customer, p.item_code, p.name AS item, st.name AS store, {CLASS} AS status,
        m.batch_no, m.qty, (SELECT string_agg(DISTINCT a.code || ' r' || a.revision, ', ') FROM mfg_pack_specs s JOIN mfg_artworks a
            ON a.id IN (s.tin_artwork_id, s.cap_artwork_id, s.label_artwork_id, s.carton_artwork_id)
            WHERE s.brand_id = m.brand_id AND p.id IN (s.printed_tin_item_id, s.cap_item_id, s.label_item_id, s.carton_item_id)) AS artwork
        FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id JOIN products p ON p.id = m.product_id JOIN mfg_brands b ON b.id = m.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id
        WHERE m.qty <> 0 AND st.kind <> 'FINISHED' AND st.kind <> 'DISPATCH' AND NOT (st.kind = 'QC' AND EXISTS (SELECT 1 FROM mfg_order_outputs x
            WHERE x.product_id = m.product_id AND x.batch_no = m.batch_no))
          AND (:q = '%%' OR p.name ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q)
        ORDER BY b.name, p.name, st.sort""", _q(f))
    return {"columns": [col("brand", "Brand"), col("customer", "Customer"), col("artwork", "Artwork"), col("item_code", "Code"), col("item", "Item"),
                        col("store", "Store"), col("status", "Status"), col("batch_no", "Batch / job"), col("qty", "Qty", "qty")], "rows": rows}


@report("mfg_stock_ledger", "Plant stock ledger", G_INV, M, ("date", "search"))
async def mfg_stock_ledger(db, f: F):
    rows = await _rows(db, f"""SELECT TO_CHAR({IST}, 'DD-MM-YYYY HH24:MI') AS posted, t.doc_no, t.txn_type, p.item_code, p.name AS item,
        b.name AS brand, t.batch_no, fs.code AS from_store, ts.code AS to_store,
        CASE WHEN t.to_store_id IS NOT NULL AND t.from_store_id IS NULL THEN t.qty END AS qty_in,
        CASE WHEN t.from_store_id IS NOT NULL AND t.to_store_id IS NULL THEN t.qty END AS qty_out,
        CASE WHEN t.from_store_id IS NOT NULL AND t.to_store_id IS NOT NULL THEN t.qty END AS moved,
        UPPER(COALESCE(p.unit, 'PCS')) AS unit, t.ref_no, us.name AS user_name, rv.doc_no AS reversal_of
        FROM mfg_stock_txns t JOIN products p ON p.id = t.product_id LEFT JOIN mfg_brands b ON b.id = t.brand_id
        LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id LEFT JOIN mfg_stores ts ON ts.id = t.to_store_id
        LEFT JOIN users us ON us.id = t.posted_by LEFT JOIN mfg_stock_txns rv ON rv.id = t.reversal_of
        WHERE CAST({IST} AS date) BETWEEN :fd AND :td
          AND (:q = '%%' OR p.name ILIKE :q OR t.doc_no ILIKE :q OR t.ref_no ILIKE :q OR t.batch_no ILIKE :q OR b.name ILIKE :q)
        ORDER BY t.id""", _q(f))
    return {"columns": [col("posted", "Posted"), col("doc_no", "Doc"), col("txn_type", "Type"), col("item_code", "Code"), col("item", "Item"),
                        col("brand", "Brand"), col("batch_no", "Batch"), col("from_store", "From"), col("to_store", "To"),
                        col("qty_in", "In", "qty"), col("qty_out", "Out", "qty"), col("moved", "Transfer", "qty"), col("unit", "Base unit"),
                        col("ref_no", "Reference"), col("user_name", "User"), col("reversal_of", "Reversal of")], "rows": rows}


# ── B. printing ───────────────────────────────────────────────────────────────
PJ = """FROM mfg_print_jobs j JOIN mfg_brands b ON b.id = j.brand_id LEFT JOIN customers c ON c.id = b.customer_id
    JOIN mfg_artworks a ON a.id = j.artwork_id JOIN products pl ON pl.id = j.plain_item_id JOIN products pr ON pr.id = j.printed_item_id"""
PJQ = "(:q = '%%' OR j.job_no ILIKE :q OR j.vendor_name ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q OR a.code ILIKE :q)"
PEND = "j.qty_issued - j.accepted_qty - j.rejected_qty - j.damaged_qty - j.lost_qty - j.returned_qty"


@report("mfg_print_issue", "Printing issue register", G_PRN, M, ("date", "search"))
async def mfg_print_issue(db, f: F):
    rows = await _rows(db, f"""SELECT j.job_date, j.job_no, j.vendor_type, j.vendor_name, c.name AS customer, b.name AS brand,
        a.code || ' r' || a.revision AS artwork, pl.name AS plain_item, pr.name AS printed_item, j.qty_issued, j.expected_return, j.status
        {PJ} WHERE j.job_date BETWEEN :fd AND :td AND j.status NOT IN ('PENDING_APPROVAL','REJECTED','CANCELLED') AND {PJQ} ORDER BY j.id""", _q(f))
    return {"columns": [col("job_date", "Date", "date"), col("job_no", "Job"), col("vendor_type", "Type"), col("vendor_name", "Printer / vendor"),
                        col("customer", "Customer"), col("brand", "Brand"), col("artwork", "Artwork"), col("plain_item", "Plain item"),
                        col("printed_item", "Printed item"), col("qty_issued", "Issued", "qty"), col("expected_return", "Expected back", "date"),
                        col("status", "Status")], "rows": rows}


@report("mfg_print_receipt", "Printing receipt & inspection register", G_PRN, M, ("date", "search"))
async def mfg_print_receipt(db, f: F):
    rows = await _rows(db, f"""SELECT CAST(r.received_at + INTERVAL '5 hours 30 minutes' AS date) AS received, r.receipt_no, j.job_no, j.vendor_name,
        b.name AS brand, pr.name AS printed_item, r.accepted_qty, r.rejected_qty, r.damaged_qty,
        CASE WHEN r.artwork_ok THEN 'Yes' ELSE 'No' END AS artwork_ok, CASE WHEN r.colour_ok THEN 'Yes' ELSE 'No' END AS colour_ok,
        r.quality_status, r.qc_remarks
        FROM mfg_print_receipts r JOIN mfg_print_jobs j ON j.id = r.job_id JOIN mfg_brands b ON b.id = j.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id JOIN mfg_artworks a ON a.id = j.artwork_id JOIN products pr ON pr.id = j.printed_item_id
        WHERE CAST(r.received_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td AND {PJQ} ORDER BY r.id""", _q(f))
    return {"columns": [col("received", "Date", "date"), col("receipt_no", "Receipt"), col("job_no", "Job"), col("vendor_name", "Printer"),
                        col("brand", "Brand"), col("printed_item", "Printed item"), col("accepted_qty", "Accepted", "qty"),
                        col("rejected_qty", "Rejected", "qty"), col("damaged_qty", "Damaged", "qty"), col("artwork_ok", "Artwork OK"),
                        col("colour_ok", "Colour OK"), col("quality_status", "Quality"), col("qc_remarks", "QC remarks")], "rows": rows}


@report("mfg_print_pending", "Pending & overdue printing jobs (vendor-wise)", G_PRN, M, ("search",))
async def mfg_print_pending(db, f: F):
    rows = await _rows(db, f"""SELECT j.vendor_name, j.job_no, j.job_date, b.name AS brand, pr.name AS printed_item, j.qty_issued,
        j.accepted_qty + j.rejected_qty + j.damaged_qty AS received, {PEND} AS pending, j.expected_return,
        GREATEST(CURRENT_DATE - j.expected_return, 0) AS days_overdue, j.status
        {PJ} WHERE j.status IN ('ISSUED','PARTIAL') AND {PJQ} ORDER BY j.vendor_name, j.expected_return NULLS LAST""", _q(f))
    return {"columns": [col("vendor_name", "Printer / vendor"), col("job_no", "Job"), col("job_date", "Issued", "date"), col("brand", "Brand"),
                        col("printed_item", "Printed item"), col("qty_issued", "Issued", "qty"), col("received", "Received", "qty"),
                        col("pending", "Pending", "qty"), col("expected_return", "Expected", "date"), col("days_overdue", "Days overdue", "num"),
                        col("status", "Status")], "rows": rows}


@report("mfg_print_recon", "Printing job reconciliation", G_PRN, M, ("date", "search"),
        note="Issued = accepted + rejected + damaged + approved loss + returned unprinted + still pending.")
async def mfg_print_recon(db, f: F):
    rows = await _rows(db, f"""SELECT j.job_no, j.job_date, j.vendor_name, b.name AS brand, a.code || ' r' || a.revision AS artwork, j.qty_issued,
        j.accepted_qty, j.rejected_qty, j.damaged_qty, j.lost_qty, j.returned_qty, {PEND} AS pending,
        ROUND((j.damaged_qty + j.lost_qty + j.rejected_qty) / j.qty_issued * 100, 2) AS loss_pct, j.status
        {PJ} WHERE j.job_date BETWEEN :fd AND :td AND j.status NOT IN ('PENDING_APPROVAL','REJECTED','CANCELLED') AND {PJQ} ORDER BY j.id""", _q(f))
    return {"columns": [col("job_no", "Job"), col("job_date", "Date", "date"), col("vendor_name", "Printer"), col("brand", "Brand"),
                        col("artwork", "Artwork"), col("qty_issued", "Issued", "qty"), col("accepted_qty", "Accepted", "qty"),
                        col("rejected_qty", "Rejected", "qty"), col("damaged_qty", "Damaged", "qty"), col("lost_qty", "Lost (approved)", "qty"),
                        col("returned_qty", "Returned", "qty"), col("pending", "Pending", "qty"), col("loss_pct", "Reject+damage+loss %", "pct"),
                        col("status", "Status")], "rows": rows}


# ── C. production ─────────────────────────────────────────────────────────────
MO = """FROM mfg_orders o JOIN products p ON p.id = o.product_id LEFT JOIN mfg_brands b ON b.id = o.brand_id
    LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN mfg_sales_orders so ON so.id = o.sales_order_id"""
MOQ = "o.stock_mode = 'DEPT' AND (:q = '%%' OR o.order_no ILIKE :q OR p.name ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q OR so.so_no ILIKE :q)"
IN_PROC = "(i.issued_qty - i.consumed_qty - i.damaged_qty - i.returned_qty - i.written_off_qty)"


@report("mfg_prod_register", "Production order register & plan", G_PRD, M, ("date", "search"))
async def mfg_prod_register(db, f: F):
    rows = await _rows(db, f"""SELECT o.order_no, o.planned_start_date, o.planned_end_date, c.name AS customer, b.name AS brand, so.so_no, p.name AS product,
        o.planned_qty, o.completed_qty, o.rejected_qty,
        (SELECT COALESCE(SUM(x.approved_qty), 0) FROM mfg_order_outputs x WHERE x.mfg_order_id = o.id) AS approved,
        GREATEST(o.planned_qty - o.completed_qty, 0) AS shortfall, o.supervisor_name, o.status
        {MO} WHERE o.planned_start_date BETWEEN :fd AND :td AND {MOQ} ORDER BY o.planned_start_date, o.id""", _q(f))
    return {"columns": [col("order_no", "Order"), col("planned_start_date", "Start", "date"), col("planned_end_date", "Due", "date"),
                        col("customer", "Customer"), col("brand", "Brand"), col("so_no", "Customer order"), col("product", "Product"),
                        col("planned_qty", "Planned", "qty"), col("completed_qty", "Good produced", "qty"), col("rejected_qty", "Rejected", "qty"),
                        col("approved", "QC approved", "qty"), col("shortfall", "Shortfall", "qty"), col("supervisor_name", "Supervisor"),
                        col("status", "Status")], "rows": rows}


@report("mfg_material_req", "Material requirement & shortage (open orders)", G_PRD, M, ("search",),
        note="Available = usable plant stores of the same brand; free = available less reservations of all open orders.")
async def mfg_material_req(db, f: F):
    rows = await _rows(db, f"""WITH av AS (SELECT m.product_id, m.brand_id, SUM(m.qty) AS qty FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id
            WHERE st.usable AND st.is_active AND NOT st.is_wip GROUP BY 1, 2),
        rs AS (SELECT i.product_id, i.brand_id, SUM(i.reserved_qty) AS qty FROM mfg_order_items i JOIN mfg_orders o ON o.id = i.mfg_order_id
            WHERE o.stock_mode = 'DEPT' AND o.status NOT IN ('COMPLETED','CANCELLED') GROUP BY 1, 2)
        SELECT o.order_no, b.name AS brand, m.item_code, m.name AS material, COALESCE(mb.name, 'General') AS material_brand, i.required_qty,
            i.issued_qty, i.reserved_qty, COALESCE(av.qty, 0) AS available, COALESCE(av.qty, 0) - COALESCE(rs.qty, 0) AS free,
            GREATEST(i.required_qty - i.issued_qty - i.reserved_qty - GREATEST(COALESCE(av.qty, 0) - COALESCE(rs.qty, 0), 0), 0) AS shortage,
            (SELECT string_agg(st.code || ':' || m2.qty::numeric(14,2), ', ') FROM mfg_stock m2 JOIN mfg_stores st ON st.id = m2.store_id
               WHERE m2.product_id = i.product_id AND m2.brand_id = i.brand_id AND m2.qty > 0) AS locations,
            (SELECT MIN(j.expected_return) FROM mfg_print_jobs j WHERE j.printed_item_id = i.product_id AND j.brand_id = i.brand_id
               AND j.status IN ('ISSUED','PARTIAL')) AS expected
        {MO} JOIN mfg_order_items i ON i.mfg_order_id = o.id JOIN products m ON m.id = i.product_id LEFT JOIN mfg_brands mb ON mb.id = i.brand_id
        LEFT JOIN av ON av.product_id = i.product_id AND av.brand_id = i.brand_id LEFT JOIN rs ON rs.product_id = i.product_id AND rs.brand_id = i.brand_id
        WHERE o.status NOT IN ('COMPLETED','CANCELLED') AND {MOQ} ORDER BY o.id, i.id""", _q(f))
    return {"columns": [col("order_no", "Order"), col("brand", "Brand"), col("item_code", "Code"), col("material", "Material"),
                        col("material_brand", "Material brand"), col("required_qty", "Required", "qty"), col("issued_qty", "Issued", "qty"),
                        col("reserved_qty", "Reserved", "qty"), col("available", "Available", "qty"), col("free", "Free", "qty"),
                        col("shortage", "Shortage", "qty"), col("locations", "Locations"), col("expected", "Printing due", "date")], "rows": rows}


@report("mfg_issue_register", "Material issue & return register", G_PRD, M, ("date", "search"))
async def mfg_issue_register(db, f: F):
    rows = await _rows(db, f"""SELECT TO_CHAR({IST}, 'DD-MM-YYYY HH24:MI') AS posted, t.doc_no, t.txn_type, t.ref_no AS order_no, p.item_code,
        p.name AS material, b.name AS brand, t.batch_no, fs.name AS from_store, ts.name AS to_store, t.qty, t.unit_entered, t.qty_entered,
        us.name AS issued_by, t.remarks
        FROM mfg_stock_txns t JOIN products p ON p.id = t.product_id LEFT JOIN mfg_brands b ON b.id = t.brand_id
        LEFT JOIN mfg_stores fs ON fs.id = t.from_store_id LEFT JOIN mfg_stores ts ON ts.id = t.to_store_id LEFT JOIN users us ON us.id = t.posted_by
        WHERE t.txn_type IN ('MATERIAL_ISSUE','MATERIAL_RETURN') AND CAST({IST} AS date) BETWEEN :fd AND :td
          AND (:q = '%%' OR t.ref_no ILIKE :q OR p.name ILIKE :q OR t.doc_no ILIKE :q OR b.name ILIKE :q) ORDER BY t.id""", _q(f))
    return {"columns": [col("posted", "Posted"), col("doc_no", "Slip"), col("txn_type", "Type"), col("order_no", "Production order"),
                        col("item_code", "Code"), col("material", "Material"), col("brand", "Brand"), col("batch_no", "Batch"),
                        col("from_store", "From"), col("to_store", "To"), col("qty", "Qty (base)", "qty"), col("qty_entered", "Entered", "qty"),
                        col("unit_entered", "Unit"), col("issued_by", "By"), col("remarks", "Remarks")], "rows": rows}


@report("mfg_consumption", "Material consumption: actual vs standard & reconciliation", G_PRD, M, ("date", "search"),
        note="Standard = BOM quantity per unit × good output. Issued = consumed + damaged + returned + written off + in process.")
async def mfg_consumption(db, f: F):
    rows = await _rows(db, f"""SELECT o.order_no, b.name AS brand, p.name AS product, o.completed_qty AS good_output, m.name AS material,
        ROUND(bi.quantity / NULLIF(bo.batch_size, 0) * o.completed_qty, 4) AS standard, i.consumed_qty AS actual,
        i.consumed_qty - ROUND(bi.quantity / NULLIF(bo.batch_size, 0) * o.completed_qty, 4) AS variance,
        i.issued_qty, i.damaged_qty, i.returned_qty, i.written_off_qty, {IN_PROC} AS in_process,
        ROUND(i.damaged_qty / NULLIF(i.issued_qty, 0) * 100, 2) AS damage_pct
        {MO} JOIN mfg_boms bo ON bo.id = o.bom_id JOIN mfg_order_items i ON i.mfg_order_id = o.id JOIN products m ON m.id = i.product_id
        LEFT JOIN LATERAL (SELECT quantity FROM mfg_bom_items x WHERE x.bom_id = o.bom_id AND x.product_id = i.product_id ORDER BY id LIMIT 1) bi ON TRUE
        WHERE o.planned_start_date BETWEEN :fd AND :td AND i.issued_qty > 0 AND {MOQ} ORDER BY o.id, i.id""", _q(f))
    return {"columns": [col("order_no", "Order"), col("brand", "Brand"), col("product", "Product"), col("good_output", "Good output", "qty"),
                        col("material", "Material"), col("standard", "Standard", "qty"), col("actual", "Actual consumed", "qty"),
                        col("variance", "Variance", "qty"), col("issued_qty", "Issued", "qty"), col("damaged_qty", "Damaged", "qty"),
                        col("returned_qty", "Returned", "qty"), col("written_off_qty", "Written off", "qty"), col("in_process", "In process", "qty"),
                        col("damage_pct", "Damage %", "pct")], "rows": rows}


@report("mfg_output", "Production output (batch-wise)", G_PRD, M, ("date", "search"))
async def mfg_output(db, f: F):
    rows = await _rows(db, f"""SELECT x.mfg_date, x.output_no, o.order_no, b.name AS brand, p.name AS product, x.batch_no, x.exp_date,
        x.good_qty AS qty, x.rejected_qty, x.approved_qty, x.qc_rejected_qty, x.good_qty - x.approved_qty - x.qc_rejected_qty AS on_hold,
        x.qc_status, x.supervisor_name, u.upc
        {MO} JOIN mfg_order_outputs x ON x.mfg_order_id = o.id {UPC.format(p='x.product_id', b='x.brand_id')}
        WHERE x.mfg_date BETWEEN :fd AND :td AND ({MOQ} OR x.batch_no ILIKE :q) ORDER BY x.id""", _q(f))
    return {"columns": [col("mfg_date", "Mfg date", "date"), col("output_no", "Output"), col("order_no", "Order"), col("brand", "Brand"),
                        col("product", "Product"), col("batch_no", "Batch"), col("exp_date", "Expiry", "date"), col("qty", "Good", "qty"),
                        col("rejected_qty", "Rejected at line", "qty"), col("approved_qty", "QC approved", "qty"),
                        col("qc_rejected_qty", "QC rejected", "qty"), col("on_hold", "QC hold", "qty"), *CTN, col("qc_status", "QC"),
                        col("supervisor_name", "Supervisor")], "rows": _cartons(rows)}


@report("mfg_wip", "Work in progress (printing + production)", G_PRD, M, ("search",))
async def mfg_wip(db, f: F):
    rows = await _rows(db, f"""SELECT 'Printing' AS stage, j.job_no AS document, j.vendor_name AS at, b.name AS brand, pl.name AS item, {PEND} AS qty,
            j.expected_return AS due
        {PJ} WHERE j.status IN ('ISSUED','PARTIAL') AND {PEND} > 0 AND {PJQ}
        UNION ALL
        SELECT 'Production', o.order_no, 'Production WIP', b.name, m.name, {IN_PROC}, o.planned_end_date
        {MO} JOIN mfg_order_items i ON i.mfg_order_id = o.id JOIN products m ON m.id = i.product_id
        WHERE {IN_PROC} > 0 AND {MOQ} ORDER BY 1, 2""", _q(f))
    return {"columns": [col("stage", "Stage"), col("document", "Job / order"), col("at", "At"), col("brand", "Brand"), col("item", "Item"),
                        col("qty", "In process", "qty"), col("due", "Due", "date")], "rows": rows}


# ── D. damage & quality ───────────────────────────────────────────────────────
DM = """FROM mfg_damages d JOIN products p ON p.id = d.product_id LEFT JOIN mfg_brands b ON b.id = d.brand_id LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN mfg_orders o ON o.id = d.mfg_order_id LEFT JOIN mfg_print_jobs j ON j.id = d.print_job_id"""
DMQ = "(:q = '%%' OR p.name ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q OR o.order_no ILIKE :q OR j.job_no ILIKE :q OR d.batch_no ILIKE :q OR d.reason ILIKE :q)"
DAY = "CAST(d.created_at + INTERVAL '5 hours 30 minutes' AS date)"


@report("mfg_damage_register", "Damage register (department / item / customer)", G_DMG, M, ("date", "search"))
async def mfg_damage_register(db, f: F):
    rows = await _rows(db, f"""SELECT {DAY} AS day, d.damage_no, d.source, d.department, COALESCE(o.order_no, j.job_no) AS document, c.name AS customer,
        b.name AS brand, p.item_code, p.name AS item, d.batch_no, d.qty, d.reason, d.stage, d.damage_pct, d.tolerance_pct,
        CASE WHEN d.over_tolerance THEN 'OVER' ELSE '' END AS alert, d.operator, d.status
        {DM} WHERE {DAY} BETWEEN :fd AND :td AND {DMQ} ORDER BY d.id""", _q(f))
    return {"columns": [col("day", "Date", "date"), col("damage_no", "Damage no"), col("source", "Source"), col("department", "Department"),
                        col("document", "Order / job"), col("customer", "Customer"), col("brand", "Brand"), col("item_code", "Code"), col("item", "Item"),
                        col("batch_no", "Batch"), col("qty", "Qty", "qty"), col("reason", "Reason"), col("stage", "Stage"),
                        col("damage_pct", "Damage %", "pct"), col("tolerance_pct", "Tolerance %", "pct"), col("alert", "Alert"),
                        col("operator", "Operator"), col("status", "Approval")], "rows": rows}


@report("mfg_damage_summary", "Damage % & production yield by order", G_DMG, M, ("date", "search"),
        note="Yield = good output ÷ (good + rejected) × 100; damage % = damaged ÷ issued × 100 per material.")
async def mfg_damage_summary(db, f: F):
    rows = await _rows(db, f"""SELECT o.order_no, b.name AS brand, p.name AS product, o.planned_qty, o.completed_qty, o.rejected_qty,
        ROUND(o.completed_qty / NULLIF(o.completed_qty + o.rejected_qty, 0) * 100, 2) AS yield_pct,
        SUM(i.issued_qty) AS issued, SUM(i.damaged_qty) AS damaged, ROUND(SUM(i.damaged_qty) / NULLIF(SUM(i.issued_qty), 0) * 100, 2) AS damage_pct,
        bo.expected_wastage_pct AS standard_pct
        {MO} JOIN mfg_boms bo ON bo.id = o.bom_id JOIN mfg_order_items i ON i.mfg_order_id = o.id
        WHERE o.planned_start_date BETWEEN :fd AND :td AND {MOQ}
        GROUP BY o.id, o.order_no, b.name, p.name, o.planned_qty, o.completed_qty, o.rejected_qty, bo.expected_wastage_pct ORDER BY o.id""", _q(f))
    return {"columns": [col("order_no", "Order"), col("brand", "Brand"), col("product", "Product"), col("planned_qty", "Planned", "qty"),
                        col("completed_qty", "Good", "qty"), col("rejected_qty", "Rejected", "qty"), col("yield_pct", "Yield %", "pct"),
                        col("issued", "Material issued", "qty"), col("damaged", "Material damaged", "qty"), col("damage_pct", "Actual damage %", "pct"),
                        col("standard_pct", "Standard wastage %", "pct")], "rows": rows}


@report("mfg_qc_rejection", "QC rejection report (printing + finished goods)", G_DMG, M, ("date", "search"))
async def mfg_qc_rejection(db, f: F):
    rows = await _rows(db, f"""SELECT CAST(r.received_at + INTERVAL '5 hours 30 minutes' AS date) AS day, 'Printed material' AS stage, j.job_no AS document,
            b.name AS brand, pr.name AS item, j.job_no AS batch_no, r.accepted_qty + r.rejected_qty + r.damaged_qty AS inspected, r.rejected_qty AS rejected,
            r.qc_remarks AS remarks
        FROM mfg_print_receipts r JOIN mfg_print_jobs j ON j.id = r.job_id JOIN mfg_brands b ON b.id = j.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id JOIN mfg_artworks a ON a.id = j.artwork_id JOIN products pr ON pr.id = j.printed_item_id
        WHERE r.rejected_qty > 0 AND CAST(r.received_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td AND {PJQ}
        UNION ALL
        SELECT x.mfg_date, 'Finished goods', o.order_no, b.name, p.name, x.batch_no, x.good_qty + x.rejected_qty, x.rejected_qty + x.qc_rejected_qty, x.qc_notes
        {MO} JOIN mfg_order_outputs x ON x.mfg_order_id = o.id
        WHERE x.rejected_qty + x.qc_rejected_qty > 0 AND x.mfg_date BETWEEN :fd AND :td AND {MOQ} ORDER BY 1""", _q(f))
    return {"columns": [col("day", "Date", "date"), col("stage", "Stage"), col("document", "Job / order"), col("brand", "Brand"), col("item", "Item"),
                        col("batch_no", "Batch"), col("inspected", "Inspected", "qty"), col("rejected", "Rejected", "qty"), col("remarks", "Remarks")],
            "rows": rows}


@report("mfg_pending_variance", "Pending damage / variance approval", G_DMG, M, ("search",))
async def mfg_pending_variance(db, f: F):
    rows = await _rows(db, f"""SELECT {DAY} AS day, d.damage_no, d.source, COALESCE(o.order_no, j.job_no) AS document, b.name AS brand, p.name AS item,
        d.qty, d.reason, d.damage_pct, d.tolerance_pct, CASE WHEN d.over_tolerance THEN 'OVER' ELSE '' END AS alert,
        CURRENT_DATE - {DAY} AS days_pending
        {DM} WHERE d.status = 'PENDING' AND {DMQ} ORDER BY d.id""", _q(f))
    return {"columns": [col("day", "Recorded", "date"), col("damage_no", "Damage no"), col("source", "Source"), col("document", "Order / job"),
                        col("brand", "Brand"), col("item", "Item"), col("qty", "Qty", "qty"), col("reason", "Reason"), col("damage_pct", "Damage %", "pct"),
                        col("tolerance_pct", "Tolerance %", "pct"), col("alert", "Alert"), col("days_pending", "Days pending", "num")], "rows": rows}


# ── E. finished goods & dispatch ──────────────────────────────────────────────
SO = """FROM mfg_sales_orders so JOIN mfg_brands b ON b.id = so.brand_id LEFT JOIN customers c ON c.id = so.customer_id JOIN products p ON p.id = so.product_id"""
SOQ = "(:q = '%%' OR so.so_no ILIKE :q OR so.customer_po_no ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q OR p.name ILIKE :q)"


@report("mfg_fg_stock", "Finished goods stock (customer / batch, cartons)", G_FG, M, ("search",))
async def mfg_fg_stock(db, f: F):
    rows = await _rows(db, f"""SELECT c.name AS customer, b.name AS brand, p.item_code, p.name AS product, m.batch_no,
        (SELECT MAX(x.mfg_date) FROM mfg_order_outputs x WHERE x.batch_no = m.batch_no AND x.product_id = m.product_id) AS mfg_date,
        (SELECT MAX(x.exp_date) FROM mfg_order_outputs x WHERE x.batch_no = m.batch_no AND x.product_id = m.product_id) AS exp_date,
        {CLASS} AS status, m.qty, COALESCE(r.res, 0) AS reserved, CASE WHEN st.kind = 'FINISHED' THEN m.qty - COALESCE(r.res, 0) ELSE 0 END AS available, u.upc
        FROM mfg_stock m JOIN mfg_stores st ON st.id = m.store_id JOIN products p ON p.id = m.product_id LEFT JOIN mfg_brands b ON b.id = m.brand_id
        LEFT JOIN customers c ON c.id = b.customer_id
        LEFT JOIN (SELECT store_id, product_id, batch_no, brand_id, SUM(qty) AS res FROM mfg_fg_reservations GROUP BY 1, 2, 3, 4) r
          ON r.store_id = m.store_id AND r.product_id = m.product_id AND r.batch_no = m.batch_no AND r.brand_id = m.brand_id
        {UPC.format(p='m.product_id', b='m.brand_id')}
        WHERE m.qty <> 0 AND (st.kind IN ('FINISHED','DISPATCH') OR EXISTS (SELECT 1 FROM mfg_order_outputs x WHERE x.product_id = m.product_id
              AND x.batch_no = m.batch_no))
          AND (:q = '%%' OR p.name ILIKE :q OR b.name ILIKE :q OR c.name ILIKE :q OR m.batch_no ILIKE :q)
        ORDER BY c.name NULLS FIRST, b.name, p.name, m.batch_no""", _q(f))
    return {"columns": [col("customer", "Customer"), col("brand", "Brand"), col("item_code", "Code"), col("product", "Product"), col("batch_no", "Batch"),
                        col("mfg_date", "Mfg", "date"), col("exp_date", "Expiry", "date"), col("status", "Status"), col("qty", "Units", "qty"),
                        col("reserved", "Reserved", "qty"), col("available", "Available", "qty"), *CTN], "rows": _cartons(rows)}


@report("mfg_order_fulfilment", "Customer order fulfilment", G_FG, M, ("date", "search"),
        note="Ordered → produced → QC approved → reserved → issued to dispatch → billed → dispatched → pending, in units and cartons.")
async def mfg_order_fulfilment(db, f: F):
    from app.routers.mfg_sales import METRICS
    rows = await _rows(db, f"""SELECT so.so_no, so.so_date, c.name AS customer, b.name AS brand, so.customer_po_no, p.name AS product,
        so.units_per_carton AS upc, so.ordered_qty, {METRICS}, so.delivery_date, so.status
        {SO} WHERE so.so_date BETWEEN :fd AND :td AND {SOQ} ORDER BY so.id""", _q(f))
    for r in rows:
        r["pending"] = r["ordered_qty"] - r["dispatched_qty"]
        r["ordered_ctn"] = r["ordered_qty"] / max(r["upc"], 1)
    return {"columns": [col("so_no", "Order"), col("so_date", "Date", "date"), col("customer", "Customer"), col("brand", "Brand"),
                        col("customer_po_no", "Customer PO"), col("product", "Product"), col("upc", "Per carton", "num"),
                        col("ordered_ctn", "Ordered ctn", "qty"), col("ordered_qty", "Ordered", "qty"), col("production_qty", "In production", "qty"),
                        col("finished_qty", "Finished", "qty"), col("qc_approved_qty", "QC approved", "qty"), col("reserved_qty", "Reserved", "qty"),
                        col("issued_qty", "Issued to dispatch", "qty"), col("billed_qty", "Billed", "qty"), col("dispatched_qty", "Dispatched", "qty"),
                        col("pending", "Pending", "qty"), col("delivery_date", "Due", "date"), col("status", "Status")], "rows": rows}


@report("mfg_dispatch_register", "Dispatch register (cartons + loose units)", G_FG, M, ("date", "search"))
async def mfg_dispatch_register(db, f: F):
    rows = await _rows(db, f"""SELECT d.dispatch_date, d.dispatch_no, so.so_no, c.name AS customer, b.name AS brand, p.name AS product, h.batch_no,
        d.qty, so.units_per_carton AS upc, d.invoice_no, d.challan_no, d.eway_bill, d.vehicle_no, d.transporter, d.lr_no, o.outlet_name AS to_outlet,
        d.ack_status
        {SO} JOIN mfg_dispatches d ON d.sales_order_id = so.id JOIN mfg_handovers h ON h.id = d.handover_id LEFT JOIN outlets o ON o.id = d.to_outlet_id
        WHERE d.dispatch_date BETWEEN :fd AND :td AND ({SOQ} OR d.invoice_no ILIKE :q OR d.vehicle_no ILIKE :q) ORDER BY d.id""", _q(f))
    return {"columns": [col("dispatch_date", "Date", "date"), col("dispatch_no", "Dispatch"), col("so_no", "Order"), col("customer", "Customer"),
                        col("brand", "Brand"), col("product", "Product"), col("batch_no", "Batch"), col("qty", "Units", "qty"), *CTN,
                        col("invoice_no", "Invoice"), col("challan_no", "Challan"), col("eway_bill", "E-way bill"), col("vehicle_no", "Vehicle"),
                        col("transporter", "Transporter"), col("lr_no", "LR no"), col("to_outlet", "To outlet"), col("ack_status", "Acknowledged")],
            "rows": _cartons(rows)}


@report("mfg_handover_register", "Store issue to billing / dispatch register", G_FG, M, ("date", "search"))
async def mfg_handover_register(db, f: F):
    rows = await _rows(db, f"""SELECT CAST(h.issued_at + INTERVAL '5 hours 30 minutes' AS date) AS day, h.handover_no, so.so_no, c.name AS customer,
        b.name AS brand, p.name AS product, h.batch_no, h.qty, so.units_per_carton AS upc, h.dispatched_qty, h.returned_qty,
        h.qty - h.dispatched_qty - h.returned_qty AS awaiting, u2.name AS issued_by, h.received_by
        {SO} JOIN mfg_handovers h ON h.sales_order_id = so.id LEFT JOIN users u2 ON u2.id = h.issued_by
        WHERE CAST(h.issued_at + INTERVAL '5 hours 30 minutes' AS date) BETWEEN :fd AND :td AND {SOQ} ORDER BY h.id""", _q(f))
    return {"columns": [col("day", "Date", "date"), col("handover_no", "Issue no"), col("so_no", "Order"), col("customer", "Customer"),
                        col("brand", "Brand"), col("product", "Product"), col("batch_no", "Batch"), col("qty", "Issued", "qty"), *CTN,
                        col("dispatched_qty", "Dispatched", "qty"), col("returned_qty", "Returned", "qty"), col("awaiting", "Awaiting dispatch", "qty"),
                        col("issued_by", "Issued by"), col("received_by", "Received by")], "rows": _cartons(rows)}


@report("mfg_pending_orders", "Orders pending production / billing / dispatch (customer-wise)", G_FG, M, ("search",))
async def mfg_pending_orders(db, f: F):
    from app.routers.mfg_sales import METRICS
    rows = await _rows(db, f"""SELECT c.name AS customer, b.name AS brand, so.so_no, so.customer_po_no, p.name AS product, so.priority, so.delivery_date,
        so.ordered_qty, {METRICS}
        {SO} WHERE so.status IN ('OPEN','PARTIAL') AND {SOQ} ORDER BY c.name NULLS FIRST, so.delivery_date NULLS LAST""", _q(f))
    for r in rows:
        r["pending_production"] = max(r["ordered_qty"] - r["qc_approved_qty"], 0)
        r["pending_issue"] = r["ordered_qty"] - r["issued_qty"]
        r["pending_billing"] = r["issued_qty"] - r["billed_qty"]
        r["pending_dispatch"] = r["ordered_qty"] - r["dispatched_qty"]
    return {"columns": [col("customer", "Customer"), col("brand", "Brand"), col("so_no", "Order"), col("customer_po_no", "Customer PO"),
                        col("product", "Product"), col("priority", "Priority"), col("delivery_date", "Due", "date"), col("ordered_qty", "Ordered", "qty"),
                        col("pending_production", "Pending production", "qty"), col("pending_issue", "Not yet issued", "qty"),
                        col("pending_billing", "Issued, not billed", "qty"), col("pending_dispatch", "Pending dispatch", "qty")], "rows": rows}


access.register_paths({f"/reports/x/{k}": M for k in REPORTS if k.startswith("mfg_")})


# ── planning: order-wise shortage & production variance ──────────────────────
TYPE_NAME = {"FG": "Finished Goods", "RM": "Raw Material", "PM": "Packing Material", "SFG": "Semi-Finished", "CONS": "Consumable", "OTH": "Other"}


@report("mfg_shortage", "Order-wise raw material & packing material shortage", G_PRD, M, ("search",),
        note="Every open production / customer order, allocated in priority order so stock is never counted twice. Pending POs are expected "
             "supply, not stock. Search: customer, order, product, material, 'RM' / 'PM', or 'short' for shortages only.")
async def mfg_shortage(db, f: F):
    from app.services import mfg_planning as mp
    q = f.search.strip().lower()
    rows = []
    for o in await mp.open_orders(db):
        for l in o["lines"]:
            r = {"customer": o["customer"] or "Own stock", "so_no": o["so_no"], "order_no": o["order_no"] if o["kind"] == "MO" else "(not planned)",
                 "product": o["product"], "ordered": float(o["qty"]), "need_by": o["need_by"], "bom": o.get("bom"), "item_code": l["item_code"],
                 "item": l["item"], "item_type": TYPE_NAME.get(l["item_type"], l["item_type"]), "unit": l["unit"], "required": float(l["net_required"]),
                 "usable": float(l["plant"]), "reserved": float(l["reserved_other"]), "available": float(l["available"]), "shortage": float(l["shortage"]),
                 "warehouse": float(l["warehouse"]), "qc_hold": float(l["qc_hold"]), "pending_po": float(l["pending_po"]), "po_eta": l["po_eta"],
                 "transfer": float(l["transfer_suggested"]), "purchase": float(l["purchase_suggested"]), "status": l["status"],
                 "order_status": o["overall"]["color"]}
            hay = " ".join(str(v) for v in r.values()).lower()
            if q == "short" and not r["shortage"] or q in ("rm", "pm") and l["item_type"] != q.upper() or q not in ("", "short", "rm", "pm") and q not in hay:
                continue
            rows.append(r)
    return {"columns": [col("customer", "Customer"), col("so_no", "Customer order"), col("order_no", "Production order"), col("product", "Finished product"),
                        col("ordered", "Ordered", "qty"), col("need_by", "Required by", "date"), col("bom", "BOM version"), col("item_code", "Code"),
                        col("item", "Component"), col("item_type", "Type"), col("unit", "Unit"), col("required", "Required", "qty"),
                        col("usable", "Usable stock", "qty"), col("reserved", "Reserved (other orders)", "qty"), col("available", "Available", "qty"),
                        col("shortage", "Shortage", "qty"), col("warehouse", "Warehouse", "qty"), col("qc_hold", "QC hold", "qty"),
                        col("pending_po", "PO pending", "qty"), col("po_eta", "Expected", "date"), col("transfer", "Suggested transfer", "qty"),
                        col("purchase", "Suggested purchase", "qty"), col("status", "Status"), col("order_status", "Order")], "rows": rows}


@report("mfg_variance", "Production variance: BOM standard vs actual", G_PRD, M, ("date", "search"),
        note="Standard = BOM quantity per unit x good output (+ expected wastage). Actual = posted consumption + damage (returns excluded).")
async def mfg_variance(db, f: F):
    rows = await _rows(db, f"""SELECT o.order_no, p.name AS product, o.completed_qty AS output, m.item_code, m.name AS material,
        ROUND(bi.quantity / NULLIF(bo.batch_size, 0) * o.completed_qty, 4) AS standard, bi.wastage_pct,
        ROUND(bi.quantity / NULLIF(bo.batch_size, 0) * o.completed_qty * (1 + COALESCE(bi.wastage_pct, 0) / 100), 4) AS standard_with_wastage,
        i.issued_qty, i.consumed_qty + i.damaged_qty AS actual, i.returned_qty, i.cost_per_unit, i.variance_reason
        {MO} JOIN mfg_boms bo ON bo.id = o.bom_id JOIN mfg_order_items i ON i.mfg_order_id = o.id JOIN products m ON m.id = i.product_id
        LEFT JOIN LATERAL (SELECT quantity, wastage_pct FROM mfg_bom_items x WHERE x.bom_id = o.bom_id AND x.product_id = i.product_id ORDER BY id LIMIT 1) bi ON TRUE
        WHERE o.planned_start_date BETWEEN :fd AND :td AND o.completed_qty > 0 AND {MOQ} ORDER BY o.id, i.id""", _q(f))
    for r in rows:
        r["variance"] = round((r["actual"] or 0) - (r["standard"] or 0), 4)
        r["variance_pct"] = round(r["variance"] / r["standard"] * 100, 2) if r["standard"] else None
        r["variance_cost"] = round(r["variance"] * (r["cost_per_unit"] or 0), 2)
    return {"columns": [col("order_no", "Order"), col("product", "Product"), col("output", "Good output", "qty"), col("item_code", "Code"),
                        col("material", "Material"), col("standard", "Standard", "qty"), col("wastage_pct", "Wastage %", "pct"),
                        col("standard_with_wastage", "Standard + wastage", "qty"), col("issued_qty", "Issued", "qty"), col("actual", "Actual consumed", "qty"),
                        col("returned_qty", "Returned", "qty"), col("variance", "Variance", "qty"), col("variance_pct", "Variance %", "pct"),
                        col("variance_cost", "Variance cost", "money"), col("variance_reason", "Reason")], "rows": rows}


access.register_paths({"/reports/x/mfg_shortage": M, "/reports/x/mfg_variance": M})
