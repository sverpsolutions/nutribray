"""Retail controls phase 2: day-end review workflow + store closing times, discount combination policy and invoice
discount breakdown, loyalty programme (config, earning rules, ledger), permissions.

Additive only.

Revision ID: h2b4d6f8a0c3
Revises: g1a3c5e7f9b1
Create Date: 2026-10-28 09:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'h2b4d6f8a0c3'
down_revision: Union[str, None] = 'g1a3c5e7f9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    # day-end review: Submitted (closed, awaiting review) -> Approved / Rejected; reopen through approval
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS review_status VARCHAR(10)",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS reviewed_by INTEGER",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS review_note TEXT",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS last_reopen_reason TEXT",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS checklist JSONB",
    "UPDATE business_days SET review_status = 'APPROVED' WHERE status = 'closed' AND review_status IS NULL",
    "ALTER TABLE outlets ADD COLUMN IF NOT EXISTS closing_time TIME",
    "ALTER TABLE outlets ADD COLUMN IF NOT EXISTS closing_review BOOLEAN NOT NULL DEFAULT FALSE",
    # discount policy (one row) + what each bill actually got
    """CREATE TABLE discount_policy (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        item_allowed BOOLEAN NOT NULL DEFAULT TRUE, bill_allowed BOOLEAN NOT NULL DEFAULT TRUE,
        scheme_allowed BOOLEAN NOT NULL DEFAULT TRUE, loyalty_allowed BOOLEAN NOT NULL DEFAULT TRUE,
        item_with_bill BOOLEAN NOT NULL DEFAULT TRUE, item_with_scheme BOOLEAN NOT NULL DEFAULT TRUE,
        bill_with_scheme BOOLEAN NOT NULL DEFAULT TRUE, loyalty_with_discount BOOLEAN NOT NULL DEFAULT TRUE,
        max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 100, approval_above_pct NUMERIC(5,2),
        override_roles TEXT[] NOT NULL DEFAULT ARRAY['admin','superadmin'], updated_by INTEGER, updated_at TIMESTAMP)""",
    "INSERT INTO discount_policy (id) VALUES (1)",
    "ALTER TABLE unit_wise_invoices ADD COLUMN IF NOT EXISTS discount_breakdown JSONB",
    "ALTER TABLE unit_wise_invoices ADD COLUMN IF NOT EXISTS discount_approval_no VARCHAR(30)",
    # loyalty
    """CREATE TABLE loyalty_config (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), enabled BOOLEAN NOT NULL DEFAULT FALSE,
        point_value NUMERIC(10,4) NOT NULL DEFAULT 1 CHECK (point_value > 0), min_redeem_points NUMERIC(12,2) NOT NULL DEFAULT 100,
        max_redeem_pct NUMERIC(5,2) NOT NULL DEFAULT 50, max_redeem_points NUMERIC(12,2), redeem_outlet_ids INTEGER[],
        consolidated BOOLEAN NOT NULL DEFAULT TRUE, approval_above_points NUMERIC(12,2), updated_by INTEGER, updated_at TIMESTAMP)""",
    "INSERT INTO loyalty_config (id) VALUES (1)",
    """CREATE TABLE loyalty_rules (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, is_campaign BOOLEAN NOT NULL DEFAULT FALSE,
        valid_from DATE, valid_to DATE, spend_per_point NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (spend_per_point > 0),
        multiplier NUMERIC(6,2) NOT NULL DEFAULT 1, min_bill NUMERIC(12,2) NOT NULL DEFAULT 0, max_points NUMERIC(12,2),
        expiry_days INTEGER, outlet_ids INTEGER[], category_ids INTEGER[], product_ids INTEGER[], excluded_product_ids INTEGER[],
        excluded_category_ids INTEGER[], created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "INSERT INTO loyalty_rules (name, spend_per_point, expiry_days) VALUES ('Standard: 1 point per ₹100', 100, 365)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_no VARCHAR(30)",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_status VARCHAR(10) NOT NULL DEFAULT 'NONE'",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_joined DATE",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_loyalty_no ON customers (loyalty_no) WHERE loyalty_no IS NOT NULL",
    """CREATE TABLE loyalty_ledger (
        id BIGSERIAL PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), outlet_id INTEGER,
        txn_type VARCHAR(10) NOT NULL CHECK (txn_type IN ('EARN','REDEEM','EXPIRE','REVERSAL','ADJUST')),
        points NUMERIC(12,2) NOT NULL CHECK (points <> 0), remaining NUMERIC(12,2), expires_on DATE,
        invoice_id INTEGER, rule_id INTEGER, eligible_amount NUMERIC(14,2), amount NUMERIC(14,2), reference VARCHAR(60), reason TEXT,
        created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE UNIQUE INDEX ux_loyalty_once ON loyalty_ledger (invoice_id, txn_type) WHERE invoice_id IS NOT NULL AND txn_type IN ('EARN','REDEEM')",
    "CREATE INDEX ix_loyalty_customer ON loyalty_ledger (customer_id, created_at)",
    """INSERT INTO payment_modes (code, name, mode_type, applies_to, reconciliation_required, sort)
        VALUES ('loyalty', 'Loyalty Points', 'VOUCHER', ARRAY['SALE'], FALSE, 20) ON CONFLICT DO NOTHING""",
]

NEW_PERMS = {
    "loyalty": ("Loyalty Programme", ["view", "create", "edit", "export"]),
    "discounts": ("Discount Control", ["view", "edit"]),
}
ROLE_GRANTS = {
    "manager": ["loyalty.view", "loyalty.create", "loyalty.edit", "loyalty.export", "discounts.view", "discounts.edit"],
    "store_manager": ["loyalty.view", "loyalty.create", "discounts.view"],
    "staff": ["loyalty.view", "loyalty.create", "discounts.view"],
    "area_sales_manager": ["loyalty.view", "loyalty.export", "discounts.view", "day_shift.approve"],
    "accounts_manager": ["loyalty.view", "loyalty.export"],
}


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for key, (label, acts) in NEW_PERMS.items():
        for a in acts:
            conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES (:m, :n, :s) ON CONFLICT (slug) DO NOTHING"),
                         {"m": key, "n": f"{label} — {a}", "s": f"{key}.{a}"})
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    for t in ("loyalty_ledger", "loyalty_rules", "loyalty_config", "discount_policy"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
