"""Complete Expiry Date & Batch Management System Across the Entire ERP

Revision ID: b8c9d0e1f2a3
Revises: f9b1d3e5a7c8
Create Date: 2026-10-14 14:35:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'f9b1d3e5a7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Central Batch Register: product_batches ─────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS product_batches (
            id SERIAL PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            batch_no VARCHAR(100) NOT NULL,
            supplier_batch_no VARCHAR(100),
            supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
            mfg_date DATE,
            exp_date DATE,
            first_receipt_date DATE,
            purchase_rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            mrp NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
            status VARCHAR(30) NOT NULL DEFAULT 'Active',
            barcode VARCHAR(100),
            notes TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_product_batches_prod_batch UNIQUE (product_id, batch_no)
        );
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batches_product_id ON product_batches(product_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batches_batch_no ON product_batches(batch_no);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batches_exp_date ON product_batches(exp_date);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batches_status ON product_batches(status);")

    # ── 2. Location-Wise Batch Stock Balances: product_batch_stock ──────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS product_batch_stock (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            location_id INTEGER NOT NULL DEFAULT 1,
            opening_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            received_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            sold_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            returned_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            transferred_in_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            transferred_out_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            adjusted_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            current_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            reserved_qty NUMERIC(15, 3) NOT NULL DEFAULT 0.000,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_batch_stock_batch_location UNIQUE (batch_id, location_id)
        );
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batch_stock_batch_id ON product_batch_stock(batch_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batch_stock_location_id ON product_batch_stock(location_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batch_stock_product_id ON product_batch_stock(product_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_batch_stock_current_qty ON product_batch_stock(current_qty);")

    # ── 3. Product Master Batch & Expiry Settings ──────────────────────────
    op.execute("""
        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS has_batch_tracking BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS has_expiry_tracking BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS mfg_date_required BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS exp_date_required BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS min_shelf_life_purchase_days INTEGER,
            ADD COLUMN IF NOT EXISTS min_shelf_life_sale_days INTEGER,
            ADD COLUMN IF NOT EXISTS near_expiry_alert_days INTEGER NOT NULL DEFAULT 60,
            ADD COLUMN IF NOT EXISTS allow_expired_sale BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS allow_neg_batch_stock BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS batch_wise_purchase_rate BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS batch_wise_selling_price BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS is_fefo_enabled BOOLEAN NOT NULL DEFAULT true;
    """)

    # ── 4. Transaction Item Tables Batch Tracking ──────────────────────────
    # unit_wise_purchase_items (GRN)
    op.execute("""
        ALTER TABLE unit_wise_purchase_items
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS mfg_date DATE,
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
    """)

    # unit_wise_purchase_return_items (PRN / Debit Notes)
    op.execute("""
        ALTER TABLE unit_wise_purchase_return_items
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
    """)

    # unit_wise_stock_transfer_items (Transfers)
    op.execute("""
        ALTER TABLE unit_wise_stock_transfer_items
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS mfg_date DATE,
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
    """)

    # stock_take_items (Stock Take)
    op.execute("""
        ALTER TABLE stock_take_items
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS mfg_date DATE,
            ADD COLUMN IF NOT EXISTS expiry_date DATE,
            ADD COLUMN IF NOT EXISTS reason VARCHAR(255);
    """)

    # unit_wise_invoice_items (Sales Invoices / POS)
    op.execute("""
        ALTER TABLE unit_wise_invoice_items
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
    """)

    # stock_ledger (Stock Movement Audit Trail)
    op.execute("""
        ALTER TABLE stock_ledger
            ADD COLUMN IF NOT EXISTS batch_no VARCHAR(100),
            ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS expiry_date DATE;
    """)


def downgrade() -> None:
    pass
