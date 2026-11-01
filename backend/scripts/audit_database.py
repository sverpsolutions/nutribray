import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from decimal import Decimal
from sqlalchemy import text
from app.core.database import async_session_factory

async def run_db_audit():
    report = {
        "postgres_version": "",
        "tables_summary": {},
        "missing_primary_keys": [],
        "foreign_keys": [],
        "indexes": [],
        "sequences_status": [],
        "integrity_issues": [],
        "orphan_checks": [],
        "master_detail_discrepancies": [],
    }

    async with async_session_factory() as db:
        # 1. Version
        v = (await db.execute(text("SELECT version();"))).scalar()
        report["postgres_version"] = v

        # 2. Tables & Counts
        tables_res = await db.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """))
        tables = [r[0] for r in tables_res.fetchall()]

        for t in tables:
            try:
                cnt = (await db.execute(text(f'SELECT count(*) FROM "{t}";'))).scalar()
                report["tables_summary"][t] = cnt
            except Exception as e:
                report["tables_summary"][t] = f"Error: {e}"

        # 3. Tables without Primary Key
        pk_res = await db.execute(text("""
            SELECT t.table_name
            FROM information_schema.tables t
            LEFT JOIN information_schema.table_constraints tc 
                ON t.table_name = tc.table_name 
                AND tc.constraint_type = 'PRIMARY KEY' 
                AND tc.table_schema = 'public'
            WHERE t.table_schema = 'public' 
              AND t.table_type = 'BASE TABLE'
              AND tc.constraint_name IS NULL
            ORDER BY t.table_name;
        """))
        report["missing_primary_keys"] = [r[0] for r in pk_res.fetchall()]

        # 4. Foreign Keys
        fk_res = await db.execute(text("""
            SELECT
                tc.table_name, 
                kcu.column_name, 
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.delete_rule,
                rc.update_rule
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.referential_constraints AS rc
              ON tc.constraint_name = rc.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.table_name, kcu.column_name;
        """))
        report["foreign_keys"] = [
            {
                "table": r[0],
                "column": r[1],
                "foreign_table": r[2],
                "foreign_column": r[3],
                "on_delete": r[4],
                "on_update": r[5]
            }
            for r in fk_res.fetchall()
        ]

        # 5. Indexes
        idx_res = await db.execute(text("""
            SELECT
                t.relname AS table_name,
                i.relname AS index_name,
                a.attname AS column_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
            ORDER BY t.relname, i.relname;
        """))
        report["indexes"] = [
            {
                "table": r[0],
                "index": r[1],
                "column": r[2],
                "is_unique": r[3],
                "is_primary": r[4]
            }
            for r in idx_res.fetchall()
        ]

        # 6. Sequences sync check (max id vs sequence value)
        seq_res = await db.execute(text("""
            SELECT
                s.relname AS seq_name,
                t.relname AS table_name,
                a.attname AS col_name
            FROM pg_class s
            JOIN pg_depend d ON d.objid = s.oid
            JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
            JOIN pg_namespace n ON n.oid = s.relnamespace
            WHERE s.relkind = 'S' AND n.nspname = 'public';
        """))
        sequences = seq_res.fetchall()
        for seq_name, tbl_name, col_name in sequences:
            try:
                curr_val = (await db.execute(text(f"SELECT last_value, is_called FROM \"{seq_name}\";"))).fetchone()
                max_val = (await db.execute(text(f"SELECT COALESCE(MAX(\"{col_name}\"), 0) FROM \"{tbl_name}\";"))).scalar()
                last_v = curr_val[0]
                is_called = curr_val[1]
                effective_val = last_v if is_called else last_v - 1
                out_of_sync = max_val > effective_val
                report["sequences_status"].append({
                    "sequence": seq_name,
                    "table": tbl_name,
                    "column": col_name,
                    "current_seq_value": last_v,
                    "max_table_id": max_val,
                    "out_of_sync": out_of_sync
                })
            except Exception as e:
                report["sequences_status"].append({
                    "sequence": seq_name,
                    "table": tbl_name,
                    "column": col_name,
                    "error": str(e)
                })

        # 7. Orphan Checks for Key Relationships
        orphan_queries = [
            ("unit_wise_invoice_items -> unit_wise_invoices", "SELECT count(*) FROM unit_wise_invoice_items ii LEFT JOIN unit_wise_invoices i ON ii.invoice_id = i.id WHERE i.id IS NULL;"),
            ("po_items -> po_headers", "SELECT count(*) FROM po_items poi LEFT JOIN po_headers po ON poi.po_id = po.id WHERE po.id IS NULL;"),
            ("unit_wise_purchase_items -> unit_wise_purchases", "SELECT count(*) FROM unit_wise_purchase_items upi LEFT JOIN unit_wise_purchases up ON upi.purchase_id = up.id WHERE up.id IS NULL;"),
            ("product_batch_stock -> product_batches", "SELECT count(*) FROM product_batch_stock pbs LEFT JOIN product_batches pb ON pbs.batch_id = pb.id WHERE pb.id IS NULL;"),
            ("product_batches -> products", "SELECT count(*) FROM product_batches pb LEFT JOIN products p ON pb.product_id = p.id WHERE p.id IS NULL;"),
            ("stock_take_items -> stock_takes", "SELECT count(*) FROM stock_take_items sti LEFT JOIN stock_takes st ON sti.stock_take_id = st.id WHERE st.id IS NULL;"),
            ("stock_take_item_batches -> stock_take_items", "SELECT count(*) FROM stock_take_item_batches stib LEFT JOIN stock_take_items sti ON stib.stock_take_item_id = sti.id WHERE sti.id IS NULL;"),
            ("products -> item_categories (invalid non-null fk)", "SELECT count(*) FROM products p LEFT JOIN item_categories c ON p.category_id = c.id WHERE p.category_id IS NOT NULL AND c.id IS NULL;"),
            ("products -> brands (invalid non-null fk)", "SELECT count(*) FROM products p LEFT JOIN brands b ON p.brand_id = b.id WHERE p.brand_id IS NOT NULL AND b.id IS NULL;"),
            ("outlet_stock -> products", "SELECT count(*) FROM outlet_stock os LEFT JOIN products p ON os.product_id = p.id WHERE p.id IS NULL;"),
            ("outlet_stock -> outlets", "SELECT count(*) FROM outlet_stock os LEFT JOIN outlets o ON os.outlet_id = o.id WHERE o.id IS NULL;"),
        ]
        for desc, q in orphan_queries:
            try:
                cnt = (await db.execute(text(q))).scalar()
                report["orphan_checks"].append({"check": desc, "orphans_count": cnt})
            except Exception as e:
                report["orphan_checks"].append({"check": desc, "error": str(e)})

        # 8. Data Integrity Checks
        integrity_queries = [
            ("Negative stock in outlet_stock", "SELECT count(*) FROM outlet_stock WHERE stock_qty < 0;"),
            ("Negative stock in product_batch_stock", "SELECT count(*) FROM product_batch_stock WHERE current_qty < 0;"),
            ("Invoices with total_amount <= 0", "SELECT count(*) FROM unit_wise_invoices WHERE total_amount <= 0;"),
            ("Purchases with total_amount < 0", "SELECT count(*) FROM unit_wise_purchases WHERE total_amount < 0;"),
            ("PO Headers with total_amount < 0", "SELECT count(*) FROM po_headers WHERE total_amount < 0;"),
            ("Duplicate product item_code (active)", "SELECT item_code, count(*) FROM products WHERE is_active = true AND item_code IS NOT NULL AND item_code != '' GROUP BY item_code HAVING count(*) > 1;"),
            ("Duplicate product barcode (active)", "SELECT barcode, count(*) FROM products WHERE is_active = true AND barcode IS NOT NULL AND barcode != '' GROUP BY barcode HAVING count(*) > 1;"),
            ("Duplicate batch_no per product in product_batches", "SELECT product_id, batch_no, count(*) FROM product_batches GROUP BY product_id, batch_no HAVING count(*) > 1;"),
            ("Invoices where items sum != invoice total", """
                SELECT count(*) FROM (
                    SELECT i.id, i.total_amount, COALESCE(SUM(ii.amount), 0) as items_sum
                    FROM unit_wise_invoices i
                    JOIN unit_wise_invoice_items ii ON i.id = ii.invoice_id
                    GROUP BY i.id, i.total_amount
                    HAVING ABS(i.total_amount - SUM(ii.amount)) > 0.05
                ) sub;
            """)
        ]
        for desc, q in integrity_queries:
            try:
                res = (await db.execute(text(q))).fetchall()
                if "HAVING count(*)" in q:
                    report["integrity_issues"].append({"check": desc, "duplicate_groups": len(res), "samples": [list(r) for r in res[:5]]})
                else:
                    report["integrity_issues"].append({"check": desc, "count": res[0][0] if res else 0})
            except Exception as e:
                report["integrity_issues"].append({"check": desc, "error": str(e)})

    with open("database_audit_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print("Database audit complete. Output written to database_audit_report.json")

if __name__ == "__main__":
    asyncio.run(run_db_audit())
