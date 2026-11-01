"""Vendor Portal and Supplier Master Complete System Upgrade

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Create Date: 2026-10-15 07:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Enhance suppliers table with missing vendor registration fields ──────
    op.execute("""
        ALTER TABLE suppliers 
        ADD COLUMN IF NOT EXISTS trade_name VARCHAR(150),
        ADD COLUMN IF NOT EXISTS designation VARCHAR(100),
        ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(20),
        ADD COLUMN IF NOT EXISTS alt_email VARCHAR(100),
        ADD COLUMN IF NOT EXISTS msme_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS fssai_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tan_number VARCHAR(30),
        ADD COLUMN IF NOT EXISTS business_constitution VARCHAR(50),
        ADD COLUMN IF NOT EXISTS product_categories TEXT,
        ADD COLUMN IF NOT EXISTS company_description TEXT,
        ADD COLUMN IF NOT EXISTS portal_sales_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS portal_sales_config JSONB DEFAULT '{"view_sales_qty": true, "view_sales_value": true, "view_outlet_wise": false, "view_daily_sales": false, "view_monthly_sales": true, "export_sales": false, "view_stock_position": false}'::jsonb;
    """)

    # ── 2. Add supplier_id to users table for vendor role binding ──────────────
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_supplier_id ON users(supplier_id);")

    # ── 3. Add vendor acknowledgement tracking to po_headers ───────────────────
    op.execute("""
        ALTER TABLE po_headers
        ADD COLUMN IF NOT EXISTS vendor_ack BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS vendor_ack_at TIMESTAMP WITHOUT TIME ZONE,
        ADD COLUMN IF NOT EXISTS vendor_expected_delivery DATE,
        ADD COLUMN IF NOT EXISTS vendor_delivery_remarks TEXT;
    """)

    # ── 4. Create vendor_profile_requests (for sensitive profile updates) ──────
    op.execute("""
        CREATE TABLE IF NOT EXISTS vendor_profile_requests (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            changes JSONB NOT NULL,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMP WITHOUT TIME ZONE,
            review_notes TEXT,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_vendor_profile_req_supplier ON vendor_profile_requests(supplier_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vendor_profile_req_status ON vendor_profile_requests(status);")

    # ── 5. Create vendor_item_requests (proposing new products) ────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS vendor_item_requests (
            id SERIAL PRIMARY KEY,
            request_no VARCHAR(30) UNIQUE NOT NULL,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            product_name VARCHAR(150) NOT NULL,
            brand_name VARCHAR(100),
            brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
            category_name VARCHAR(100),
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            manufacturer VARCHAR(100),
            vendor_item_code VARCHAR(50),
            barcode VARCHAR(100),
            description TEXT,
            unit VARCHAR(20) DEFAULT 'PCS',
            pack_size VARCHAR(50),
            purchase_rate NUMERIC(12, 2) DEFAULT 0.00,
            mrp NUMERIC(12, 2) DEFAULT 0.00,
            proposed_selling_price NUMERIC(12, 2) DEFAULT 0.00,
            gst_percent NUMERIC(5, 2) DEFAULT 0.00,
            hsn_code VARCHAR(20),
            moq NUMERIC(10, 2) DEFAULT 1.00,
            lead_time_days INTEGER DEFAULT 7,
            country_of_origin VARCHAR(50) DEFAULT 'India',
            image_url TEXT,
            brochure_url TEXT,
            vendor_remarks TEXT,
            status VARCHAR(30) NOT NULL DEFAULT 'submitted',
            review_notes TEXT,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMP WITHOUT TIME ZONE,
            created_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_vendor_item_req_supplier ON vendor_item_requests(supplier_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vendor_item_req_status ON vendor_item_requests(status);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_vendor_item_req_barcode ON vendor_item_requests(barcode);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_item_requests CASCADE;")
    op.execute("DROP TABLE IF EXISTS vendor_profile_requests CASCADE;")
    op.execute("""
        ALTER TABLE po_headers
        DROP COLUMN IF EXISTS vendor_ack,
        DROP COLUMN IF EXISTS vendor_ack_at,
        DROP COLUMN IF EXISTS vendor_expected_delivery,
        DROP COLUMN IF EXISTS vendor_delivery_remarks;
    """)
    op.execute("""
        ALTER TABLE users
        DROP COLUMN IF EXISTS supplier_id;
    """)
    op.execute("""
        ALTER TABLE suppliers
        DROP COLUMN IF EXISTS trade_name,
        DROP COLUMN IF EXISTS designation,
        DROP COLUMN IF EXISTS alt_phone,
        DROP COLUMN IF EXISTS alt_email,
        DROP COLUMN IF EXISTS msme_number,
        DROP COLUMN IF EXISTS fssai_number,
        DROP COLUMN IF EXISTS tan_number,
        DROP COLUMN IF EXISTS business_constitution,
        DROP COLUMN IF EXISTS product_categories,
        DROP COLUMN IF EXISTS company_description,
        DROP COLUMN IF EXISTS portal_sales_enabled,
        DROP COLUMN IF EXISTS portal_sales_config;
    """)
