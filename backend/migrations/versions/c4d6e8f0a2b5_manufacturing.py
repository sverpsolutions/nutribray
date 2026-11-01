"""Manufacturing / Production module (Nutribray): BOMs, manufacturing orders, material batches, outputs,
plus manufacturing / QC columns on company settings, GRNs, POs, batches and stock transfers.

Same SQL as backend/scripts/migrate_manufacturing.py, run by Alembic so the live server gets it on start-up.
Additive and idempotent (IF NOT EXISTS): no existing column or row is changed.
Also registers the 'manufacturing' permissions for User Management and gives them to the Manager role.

Revision ID: c4d6e8f0a2b5
Revises: a2b4c6d8e0f1
Create Date: 2026-10-26 15:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c4d6e8f0a2b5'
down_revision: Union[str, None] = 'a2b4c6d8e0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADD_COLUMNS = {
    "company_settings": [
        ("enable_manufacturing", "BOOLEAN DEFAULT FALSE"), ("mfg_company_name", "VARCHAR(200)"), ("mfg_plant_locations", "TEXT"),
        ("mfg_departments", "TEXT"), ("production_store_id", "INTEGER"), ("raw_material_warehouse_id", "INTEGER"),
        ("packaging_material_warehouse_id", "INTEGER"), ("semi_finished_store_id", "INTEGER"), ("finished_goods_warehouse_id", "INTEGER"),
        ("qc_store_id", "INTEGER"), ("quarantine_store_id", "INTEGER"), ("production_number_prefix", "VARCHAR(30) DEFAULT 'MFG-PROD-'"),
        ("mfg_order_number_prefix", "VARCHAR(30) DEFAULT 'MO-'"), ("batch_number_prefix", "VARCHAR(30) DEFAULT 'BAT-'"),
        ("require_bom_approval", "BOOLEAN DEFAULT TRUE"), ("require_material_issue_approval", "BOOLEAN DEFAULT TRUE"),
        ("require_production_completion_approval", "BOOLEAN DEFAULT TRUE"), ("require_qc_release", "BOOLEAN DEFAULT TRUE"),
        ("negative_stock_policy", "VARCHAR(20) DEFAULT 'block'"), ("batch_tracking_required", "BOOLEAN DEFAULT TRUE"),
        ("expiry_tracking_required", "BOOLEAN DEFAULT TRUE"), ("default_stock_valuation_method", "VARCHAR(30) DEFAULT 'FIFO'"),
        ("default_units_conversion_rules", "TEXT"), ("mfg_document_print_settings", "TEXT"),
    ],
    "unit_wise_purchase_items": [
        ("qc_status", "VARCHAR(30) DEFAULT 'PENDING'"), ("accepted_qty", "NUMERIC(12, 3) DEFAULT 0"),
        ("rejected_qty", "NUMERIC(12, 3) DEFAULT 0"), ("quarantined_qty", "NUMERIC(12, 3) DEFAULT 0"),
        ("supplier_lot_no", "VARCHAR(100)"), ("coa_attachment", "VARCHAR(255)"), ("inspection_reference", "VARCHAR(100)"),
        ("warehouse_id", "INTEGER"), ("rack_id", "INTEGER"),
    ],
    "unit_wise_purchases": [
        ("material_type", "VARCHAR(30) DEFAULT 'GENERAL'"), ("qc_status", "VARCHAR(30) DEFAULT 'PENDING'"), ("qc_inspection_no", "VARCHAR(50)"),
    ],
    "po_headers": [("mfg_order_id", "INTEGER"), ("mfg_order_no", "VARCHAR(50)"), ("material_type", "VARCHAR(30) DEFAULT 'GENERAL'")],
    "product_batches": [
        ("batch_type", "VARCHAR(30) DEFAULT 'STANDARD'"), ("mfg_order_id", "INTEGER"), ("bom_id", "INTEGER"), ("parent_batch_id", "INTEGER"),
        ("qc_status", "VARCHAR(30) DEFAULT 'Active'"), ("qc_notes", "TEXT"), ("qc_release_date", "DATE"), ("qc_released_by", "INTEGER"),
    ],
    "unit_wise_stock_transfers": [
        ("movement_type", "VARCHAR(50) DEFAULT 'OUT'"), ("mfg_order_id", "INTEGER"), ("mfg_order_no", "VARCHAR(50)"), ("department", "VARCHAR(100)"),
    ],
}

TABLES = [
    """CREATE TABLE IF NOT EXISTS mfg_boms (
        id SERIAL PRIMARY KEY, bom_no VARCHAR(50) UNIQUE NOT NULL, bom_name VARCHAR(150) NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id), revision INTEGER DEFAULT 1, version_label VARCHAR(20) DEFAULT 'v1.0',
        product_type VARCHAR(30) DEFAULT 'FINISHED', batch_size NUMERIC(12, 3) DEFAULT 1.000, batch_unit VARCHAR(20) DEFAULT 'PCS',
        expected_yield_pct NUMERIC(5, 2) DEFAULT 100.00, tolerance_pct NUMERIC(5, 2) DEFAULT 2.00, expected_wastage_pct NUMERIC(5, 2) DEFAULT 0.00,
        valid_from DATE NOT NULL, valid_to DATE, status VARCHAR(30) DEFAULT 'DRAFT', approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP, approval_remarks TEXT, total_cost NUMERIC(12, 2) DEFAULT 0.00, labor_cost NUMERIC(12, 2) DEFAULT 0.00,
        overhead_cost NUMERIC(12, 2) DEFAULT 0.00, notes TEXT, created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())""",
    """CREATE TABLE IF NOT EXISTS mfg_bom_items (
        id SERIAL PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES mfg_boms(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id), material_type VARCHAR(30) DEFAULT 'RAW_MATERIAL',
        quantity NUMERIC(12, 4) NOT NULL, unit VARCHAR(20) DEFAULT 'KG', wastage_pct NUMERIC(5, 2) DEFAULT 0.00,
        cost_per_unit NUMERIC(12, 2) DEFAULT 0.00, total_cost NUMERIC(12, 2) DEFAULT 0.00, is_critical BOOLEAN DEFAULT FALSE,
        sub_bom_id INTEGER REFERENCES mfg_boms(id), stage VARCHAR(50) DEFAULT 'Mixing', sequence INTEGER DEFAULT 1, notes TEXT)""",
    """CREATE TABLE IF NOT EXISTS mfg_orders (
        id SERIAL PRIMARY KEY, order_no VARCHAR(50) UNIQUE NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
        bom_id INTEGER NOT NULL REFERENCES mfg_boms(id), planned_qty NUMERIC(12, 3) NOT NULL, completed_qty NUMERIC(12, 3) DEFAULT 0,
        rejected_qty NUMERIC(12, 3) DEFAULT 0, scrap_qty NUMERIC(12, 3) DEFAULT 0, unit VARCHAR(20) DEFAULT 'PCS',
        plant_id INTEGER REFERENCES outlets(id), department VARCHAR(100) DEFAULT 'Production', source_warehouse_id INTEGER,
        target_warehouse_id INTEGER, production_batch_no VARCHAR(100), production_batch_id INTEGER REFERENCES product_batches(id),
        planned_start_date DATE NOT NULL, planned_end_date DATE NOT NULL, actual_start_date TIMESTAMP, actual_end_date TIMESTAMP,
        status VARCHAR(30) DEFAULT 'DRAFT', qc_status VARCHAR(30) DEFAULT 'PENDING', qc_inspection_no VARCHAR(50), qc_remarks TEXT,
        qc_released_by INTEGER REFERENCES users(id), qc_released_at TIMESTAMP, estimated_cost NUMERIC(12, 2) DEFAULT 0.00,
        actual_cost NUMERIC(12, 2) DEFAULT 0.00, supervisor_id INTEGER REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMP, created_by INTEGER REFERENCES users(id), notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())""",
    """CREATE TABLE IF NOT EXISTS mfg_order_items (
        id SERIAL PRIMARY KEY, mfg_order_id INTEGER NOT NULL REFERENCES mfg_orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id), material_type VARCHAR(30) DEFAULT 'RAW_MATERIAL',
        required_qty NUMERIC(12, 4) NOT NULL, reserved_qty NUMERIC(12, 4) DEFAULT 0, issued_qty NUMERIC(12, 4) DEFAULT 0,
        consumed_qty NUMERIC(12, 4) DEFAULT 0, returned_qty NUMERIC(12, 4) DEFAULT 0, unit VARCHAR(20) DEFAULT 'KG',
        cost_per_unit NUMERIC(12, 2) DEFAULT 0.00, total_cost NUMERIC(12, 2) DEFAULT 0.00, status VARCHAR(30) DEFAULT 'PENDING')""",
    """CREATE TABLE IF NOT EXISTS mfg_order_batches (
        id SERIAL PRIMARY KEY, mfg_order_id INTEGER NOT NULL REFERENCES mfg_orders(id) ON DELETE CASCADE,
        mfg_order_item_id INTEGER NOT NULL REFERENCES mfg_order_items(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id), batch_id INTEGER NOT NULL REFERENCES product_batches(id),
        batch_no VARCHAR(100) NOT NULL, expiry_date DATE, reserved_qty NUMERIC(12, 4) DEFAULT 0, issued_qty NUMERIC(12, 4) DEFAULT 0,
        consumed_qty NUMERIC(12, 4) DEFAULT 0, returned_qty NUMERIC(12, 4) DEFAULT 0, status VARCHAR(30) DEFAULT 'RESERVED')""",
    """CREATE TABLE IF NOT EXISTS mfg_order_outputs (
        id SERIAL PRIMARY KEY, mfg_order_id INTEGER NOT NULL REFERENCES mfg_orders(id) ON DELETE CASCADE,
        output_no VARCHAR(50) NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id), batch_id INTEGER REFERENCES product_batches(id),
        batch_no VARCHAR(100) NOT NULL, good_qty NUMERIC(12, 3) NOT NULL, rejected_qty NUMERIC(12, 3) DEFAULT 0,
        scrap_qty NUMERIC(12, 3) DEFAULT 0, unit VARCHAR(20) DEFAULT 'PCS', mfg_date DATE NOT NULL, exp_date DATE,
        qc_status VARCHAR(30) DEFAULT 'PENDING', qc_released_at TIMESTAMP, qc_released_by INTEGER REFERENCES users(id), qc_notes TEXT,
        created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW())""",
]
INDEXES = [
    ("idx_mfg_boms_prod", "mfg_boms(product_id)"), ("idx_mfg_bom_items_bom", "mfg_bom_items(bom_id)"),
    ("idx_mfg_bom_items_prod", "mfg_bom_items(product_id)"), ("idx_mfg_orders_prod", "mfg_orders(product_id)"),
    ("idx_mfg_orders_bom", "mfg_orders(bom_id)"), ("idx_mfg_orders_status", "mfg_orders(status)"),
    ("idx_mfg_order_items_order", "mfg_order_items(mfg_order_id)"), ("idx_mfg_order_items_prod", "mfg_order_items(product_id)"),
    ("idx_mfg_order_batches_order", "mfg_order_batches(mfg_order_id)"), ("idx_mfg_order_batches_batch", "mfg_order_batches(batch_id)"),
    ("idx_mfg_order_outputs_order", "mfg_order_outputs(mfg_order_id)"), ("idx_mfg_order_outputs_batch", "mfg_order_outputs(batch_id)"),
]
PERMS = ["view", "create", "edit", "delete", "approve", "cancel", "print", "export"]


def upgrade() -> None:
    for table, cols in ADD_COLUMNS.items():
        for name, ddl in cols:
            op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {ddl}")
    for ddl in TABLES:
        op.execute(ddl)
    for name, target in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")
    conn = op.get_bind()
    for a in PERMS:
        conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES ('manufacturing', :n, :s) ON CONFLICT (slug) DO NOTHING"),
                     {"n": f"Manufacturing / Production — {a}", "s": f"manufacturing.{a}"})
    conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r JOIN permissions p ON p.module = 'manufacturing' WHERE r.slug = 'manager'
        ON CONFLICT DO NOTHING"""))


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE module = 'manufacturing')")
    op.execute("DELETE FROM user_granular_permissions WHERE slug LIKE 'manufacturing.%'")
    op.execute("DELETE FROM permissions WHERE module = 'manufacturing'")
    for t in ("mfg_order_outputs", "mfg_order_batches", "mfg_order_items", "mfg_orders", "mfg_bom_items", "mfg_boms"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
    for table, cols in ADD_COLUMNS.items():
        for name, _ in cols:
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {name}")
