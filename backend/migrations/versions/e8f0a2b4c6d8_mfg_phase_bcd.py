"""Manufacturing Phases B-D: printing job work, department production (issue / consumption / damage / returns /
output / QC), damage register + tolerances, customer orders, finished-goods reservations, store handover, dispatch.

All stock still moves only through mfg_stock_txns (Phase A). Additive only: existing rows are untouched;
production orders created before this keep stock_mode 'OUTLET' and their old workbench flow.

Revision ID: e8f0a2b4c6d8
Revises: d7e9f1a3b5c6
Create Date: 2026-10-27 18:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'e8f0a2b4c6d8'
down_revision: Union[str, None] = 'd7e9f1a3b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

Q = "NUMERIC(14,4) NOT NULL DEFAULT 0"
REASONS = ("'Production Damage','Printing Defect','Cap Damage','Label Damage','Filling Loss','Spillage',"
           "'Rejected Finished Product','Quality Rejection','Missing / Loss','Other Approved Reason'")

STATEMENTS = [
    # production orders: brand / spec / customer order links, department-store mode
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS stock_mode VARCHAR(10) NOT NULL DEFAULT 'OUTLET'",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES mfg_brands(id)",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS spec_id INTEGER REFERENCES mfg_pack_specs(id)",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS sales_order_id INTEGER",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS parent_order_id INTEGER REFERENCES mfg_orders(id)",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS customer_po_no VARCHAR(50)",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(100)",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS quality_requirements TEXT",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS close_note TEXT",
    f"ALTER TABLE mfg_order_items ADD COLUMN IF NOT EXISTS brand_id INTEGER NOT NULL DEFAULT 0",
    f"ALTER TABLE mfg_order_items ADD COLUMN IF NOT EXISTS damaged_qty {Q}",
    f"ALTER TABLE mfg_order_items ADD COLUMN IF NOT EXISTS written_off_qty {Q}",
    f"ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS approved_qty {Q}",
    f"ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS qc_rejected_qty {Q}",
    "ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS brand_id INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS start_time TIMESTAMP",
    "ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS end_time TIMESTAMP",
    "ALTER TABLE mfg_order_outputs ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(100)",
    "ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES mfg_brands(id)",
    # printing job work
    f"""CREATE TABLE mfg_print_jobs (
        id SERIAL PRIMARY KEY, job_no VARCHAR(30) NOT NULL UNIQUE, job_date DATE NOT NULL DEFAULT CURRENT_DATE,
        vendor_type VARCHAR(10) NOT NULL DEFAULT 'INTERNAL' CHECK (vendor_type IN ('INTERNAL','EXTERNAL')),
        vendor_name VARCHAR(150) NOT NULL, supplier_id INTEGER,
        brand_id INTEGER NOT NULL REFERENCES mfg_brands(id), spec_id INTEGER REFERENCES mfg_pack_specs(id),
        artwork_id INTEGER NOT NULL REFERENCES mfg_artworks(id),
        plain_item_id INTEGER NOT NULL REFERENCES products(id), printed_item_id INTEGER NOT NULL REFERENCES products(id),
        source_store_id INTEGER NOT NULL REFERENCES mfg_stores(id), source_brand_id INTEGER NOT NULL DEFAULT 0,
        source_batch_no VARCHAR(100) NOT NULL DEFAULT '', sales_order_id INTEGER, mfg_order_id INTEGER,
        tin_size VARCHAR(40), printing_colour VARCHAR(80), cap_colour VARCHAR(40),
        qty_issued NUMERIC(14,4) NOT NULL CHECK (qty_issued > 0), unit_entered VARCHAR(20), qty_entered NUMERIC(14,4),
        accepted_qty {Q}, rejected_qty {Q}, damaged_qty {Q}, lost_qty {Q}, returned_qty {Q},
        expected_return DATE, vehicle_ref VARCHAR(80), remarks TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
            CHECK (status IN ('PENDING_APPROVAL','ISSUED','PARTIAL','RECEIVED','CLOSED','CANCELLED','REJECTED')),
        prepared_by INTEGER, approved_by INTEGER, approved_at TIMESTAMP, closed_by INTEGER, closed_at TIMESTAMP, close_note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (accepted_qty + rejected_qty + damaged_qty + lost_qty + returned_qty <= qty_issued))""",
    f"""CREATE TABLE mfg_print_receipts (
        id SERIAL PRIMARY KEY, receipt_no VARCHAR(30) NOT NULL, job_id INTEGER NOT NULL REFERENCES mfg_print_jobs(id),
        accepted_qty {Q}, rejected_qty {Q}, damaged_qty {Q}, artwork_ok BOOLEAN NOT NULL, colour_ok BOOLEAN NOT NULL,
        quality_status VARCHAR(20) NOT NULL, qc_remarks TEXT, received_by INTEGER, received_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    # damage register + tolerances
    f"""CREATE TABLE mfg_damages (
        id SERIAL PRIMARY KEY, damage_no VARCHAR(30) NOT NULL,
        source VARCHAR(12) NOT NULL CHECK (source IN ('PRINTING','PRODUCTION','STORE')),
        mfg_order_id INTEGER, order_item_id INTEGER, print_job_id INTEGER, output_id INTEGER,
        product_id INTEGER NOT NULL REFERENCES products(id), brand_id INTEGER NOT NULL DEFAULT 0, batch_no VARCHAR(100) NOT NULL DEFAULT '',
        qty NUMERIC(14,4) NOT NULL CHECK (qty > 0), base_qty NUMERIC(14,4), damage_pct NUMERIC(8,3), tolerance_pct NUMERIC(8,3),
        over_tolerance BOOLEAN NOT NULL DEFAULT FALSE,
        reason VARCHAR(40) NOT NULL CHECK (reason IN ({REASONS})), stage VARCHAR(60), department VARCHAR(60),
        held_store_id INTEGER REFERENCES mfg_stores(id), back_store_id INTEGER REFERENCES mfg_stores(id),
        operator VARCHAR(100), remarks TEXT, photo VARCHAR(255),
        status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
        decided_by INTEGER, decided_at TIMESTAMP, decision_note TEXT, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX ix_mfg_damage_status ON mfg_damages (status, created_at)",
    """CREATE TABLE mfg_tolerances (
        id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id), material_id INTEGER REFERENCES products(id),
        department VARCHAR(60), process VARCHAR(60), tolerance_pct NUMERIC(6,3) NOT NULL CHECK (tolerance_pct >= 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE)""",
    "INSERT INTO mfg_tolerances (tolerance_pct) VALUES (1)",
    # customer orders, reservations, handover, dispatch
    """CREATE TABLE mfg_sales_orders (
        id SERIAL PRIMARY KEY, so_no VARCHAR(30) NOT NULL UNIQUE, so_date DATE NOT NULL DEFAULT CURRENT_DATE,
        customer_id INTEGER REFERENCES customers(id), brand_id INTEGER NOT NULL REFERENCES mfg_brands(id),
        spec_id INTEGER REFERENCES mfg_pack_specs(id), product_id INTEGER NOT NULL REFERENCES products(id),
        customer_po_no VARCHAR(50), customer_item_code VARCHAR(50),
        units_per_carton INTEGER NOT NULL CHECK (units_per_carton > 0), ordered_cartons NUMERIC(12,3),
        ordered_qty NUMERIC(14,4) NOT NULL CHECK (ordered_qty > 0), delivery_date DATE,
        priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
        billing_requirement TEXT, dispatch_instructions TEXT, remarks TEXT,
        status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','COMPLETED','CANCELLED','CLOSED')),
        close_note TEXT, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    """CREATE TABLE mfg_fg_reservations (
        id SERIAL PRIMARY KEY, sales_order_id INTEGER NOT NULL REFERENCES mfg_sales_orders(id),
        store_id INTEGER NOT NULL REFERENCES mfg_stores(id), product_id INTEGER NOT NULL REFERENCES products(id),
        batch_no VARCHAR(100) NOT NULL DEFAULT '', brand_id INTEGER NOT NULL DEFAULT 0,
        qty NUMERIC(14,4) NOT NULL CHECK (qty >= 0), created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX ix_mfg_resv_stock ON mfg_fg_reservations (store_id, product_id, batch_no, brand_id)",
    f"""CREATE TABLE mfg_handovers (
        id SERIAL PRIMARY KEY, handover_no VARCHAR(30) NOT NULL, sales_order_id INTEGER NOT NULL REFERENCES mfg_sales_orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id), batch_no VARCHAR(100) NOT NULL DEFAULT '', brand_id INTEGER NOT NULL DEFAULT 0,
        qty NUMERIC(14,4) NOT NULL CHECK (qty > 0), dispatched_qty {Q}, returned_qty {Q},
        from_store_id INTEGER NOT NULL REFERENCES mfg_stores(id), to_store_id INTEGER NOT NULL REFERENCES mfg_stores(id),
        received_by VARCHAR(100), remarks TEXT, issued_by INTEGER, issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (dispatched_qty + returned_qty <= qty))""",
    """CREATE TABLE mfg_dispatches (
        id SERIAL PRIMARY KEY, dispatch_no VARCHAR(30) NOT NULL, sales_order_id INTEGER NOT NULL REFERENCES mfg_sales_orders(id),
        handover_id INTEGER NOT NULL REFERENCES mfg_handovers(id), qty NUMERIC(14,4) NOT NULL CHECK (qty > 0),
        invoice_no VARCHAR(50), challan_no VARCHAR(50), eway_bill VARCHAR(30), vehicle_no VARCHAR(30), transporter VARCHAR(100),
        lr_no VARCHAR(50), dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE, to_outlet_id INTEGER REFERENCES outlets(id),
        ack_status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (ack_status IN ('PENDING','RECEIVED','SHORT','DAMAGED')),
        ack_note TEXT, ack_at TIMESTAMP, remarks TEXT, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
]


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)


def downgrade() -> None:
    for t in ("mfg_dispatches", "mfg_handovers", "mfg_fg_reservations", "mfg_sales_orders", "mfg_tolerances", "mfg_damages",
              "mfg_print_receipts", "mfg_print_jobs"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
