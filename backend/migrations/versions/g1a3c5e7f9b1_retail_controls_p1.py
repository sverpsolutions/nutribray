"""Retail controls phase 1: central approval engine (+ configurable policies), payment mode master, expiry bands,
batch / expiry corrections and expired-stock removal registers, tamper-proof audit log, new permissions.

Additive: no existing row is changed except audit_logs gaining nullable columns.

Revision ID: g1a3c5e7f9b1
Revises: e8f0a2b4c6d8
Create Date: 2026-10-27 22:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'g1a3c5e7f9b1'
down_revision: Union[str, None] = 'e8f0a2b4c6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TYPES = ("'EXPIRED_REMOVAL','BATCH_CORRECTION','EXPIRY_CORRECTION','PRICE_CHANGE','HIGH_DISCOUNT','ITEM_CREATION',"
         "'DAY_REOPEN','LOYALTY_ADJUST','OTHER'")
MGRS = "ARRAY['admin','superadmin','manager']"
AREA = "ARRAY['admin','superadmin','manager','area_sales_manager']"
STORE = "ARRAY['admin','superadmin','manager','area_sales_manager','store_manager']"

STATEMENTS = [
    f"""CREATE TABLE approval_policies (
        request_type VARCHAR(30) PRIMARY KEY CHECK (request_type IN ({TYPES})), label VARCHAR(80) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE, approver_roles TEXT[] NOT NULL, allow_self BOOLEAN NOT NULL DEFAULT FALSE,
        threshold NUMERIC(14,2), notes TEXT)""",
    f"""INSERT INTO approval_policies (request_type, label, enabled, approver_roles, threshold) VALUES
        ('EXPIRED_REMOVAL', 'Expired item removal', TRUE, {AREA}, NULL),
        ('BATCH_CORRECTION', 'Wrong batch correction (sale)', TRUE, {AREA}, NULL),
        ('EXPIRY_CORRECTION', 'Expiry date master correction', TRUE, {MGRS}, NULL),
        ('PRICE_CHANGE', 'Price change (import / bulk)', TRUE, {MGRS}, NULL),
        ('HIGH_DISCOUNT', 'Discount above limit', TRUE, {STORE}, NULL),
        ('ITEM_CREATION', 'New item via Purchase ID', TRUE, {MGRS}, NULL),
        ('DAY_REOPEN', 'Store day-end reopening', TRUE, {AREA}, NULL),
        ('LOYALTY_ADJUST', 'Loyalty point adjustment', TRUE, {STORE}, NULL),
        ('OTHER', 'Other sensitive transaction', TRUE, {MGRS}, NULL)""",
    f"""CREATE TABLE approval_requests (
        id SERIAL PRIMARY KEY, request_no VARCHAR(30) NOT NULL UNIQUE, request_type VARCHAR(30) NOT NULL REFERENCES approval_policies(request_type),
        outlet_id INTEGER, ref_type VARCHAR(30), ref_id INTEGER, ref_no VARCHAR(60), summary VARCHAR(300),
        old_value JSONB, new_value JSONB, payload JSONB NOT NULL DEFAULT '{{}}', reason TEXT NOT NULL, attachment VARCHAR(255),
        status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','RETURNED','CANCELLED')),
        requested_by INTEGER NOT NULL, requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
        decided_by INTEGER, decided_at TIMESTAMP, decision_note TEXT, posted_ref VARCHAR(60), request_key VARCHAR(60) UNIQUE)""",
    "CREATE INDEX ix_approval_status ON approval_requests (status, request_type, outlet_id)",
    """CREATE TABLE approval_seq (yr INTEGER PRIMARY KEY, last_no INTEGER NOT NULL)""",
    # payment mode master
    """CREATE TABLE payment_modes (
        id SERIAL PRIMARY KEY, code VARCHAR(30) NOT NULL, name VARCHAR(60) NOT NULL,
        mode_type VARCHAR(12) NOT NULL DEFAULT 'OTHER' CHECK (mode_type IN ('CASH','UPI','CARD','BANK','CHEQUE','CREDIT','WALLET','VOUCHER','OTHER')),
        ledger_account VARCHAR(80), outlet_ids INTEGER[], applies_to TEXT[] NOT NULL DEFAULT ARRAY['SALE'],
        reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE, approval_required BOOLEAN NOT NULL DEFAULT FALSE,
        sort INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE UNIQUE INDEX ux_payment_modes_code ON payment_modes (LOWER(code))",
    "CREATE UNIQUE INDEX ux_payment_modes_name ON payment_modes (LOWER(name))",
    """INSERT INTO payment_modes (code, name, mode_type, applies_to, reconciliation_required, sort) VALUES
        ('cash', 'Cash', 'CASH', ARRAY['SALE','PURCHASE','EXPENSE'], FALSE, 1),
        ('upi', 'UPI', 'UPI', ARRAY['SALE','PURCHASE'], TRUE, 2),
        ('card', 'Card (Credit / Debit)', 'CARD', ARRAY['SALE'], TRUE, 3),
        ('credit_card', 'Credit Card', 'CARD', ARRAY['SALE'], TRUE, 4),
        ('debit_card', 'Debit Card', 'CARD', ARRAY['SALE'], TRUE, 5),
        ('neft', 'NEFT', 'BANK', ARRAY['SALE','PURCHASE'], TRUE, 6),
        ('rtgs', 'RTGS', 'BANK', ARRAY['SALE','PURCHASE'], TRUE, 7),
        ('imps', 'IMPS', 'BANK', ARRAY['SALE','PURCHASE'], TRUE, 8),
        ('bank', 'Bank Transfer', 'BANK', ARRAY['SALE','PURCHASE'], TRUE, 9),
        ('cheque', 'Cheque', 'CHEQUE', ARRAY['SALE','PURCHASE'], TRUE, 10),
        ('credit', 'Credit Terms', 'CREDIT', ARRAY['SALE','PURCHASE'], FALSE, 11)
        ON CONFLICT DO NOTHING""",
    # modes already used in bills are kept as they are (no guessing): add any not yet in the master
    """INSERT INTO payment_modes (code, name, mode_type, sort)
        SELECT DISTINCT LOWER(TRIM(payment_mode)), INITCAP(REPLACE(TRIM(payment_mode), '_', ' ')), 'OTHER', 50 FROM unit_wise_payments
        WHERE COALESCE(TRIM(payment_mode), '') <> ''
          AND LOWER(TRIM(payment_mode)) NOT IN (SELECT LOWER(code) FROM payment_modes)
          AND LOWER(INITCAP(REPLACE(TRIM(payment_mode), '_', ' '))) NOT IN (SELECT LOWER(name) FROM payment_modes)
        ON CONFLICT DO NOTHING""",
    # expiry warning bands (days; 0 = already expired)
    """CREATE TABLE expiry_bands (id SERIAL PRIMARY KEY, days INTEGER NOT NULL UNIQUE CHECK (days >= 0), label VARCHAR(40) NOT NULL)""",
    """INSERT INTO expiry_bands (days, label) VALUES (0, 'Already expired'), (7, 'Within 7 days'), (15, 'Within 15 days'),
        (30, 'Within 30 days'), (60, 'Within 60 days'), (90, 'Within 90 days')""",
    # corrections register (original + corrected values; history rows are never overwritten silently)
    """CREATE TABLE batch_corrections (
        id SERIAL PRIMARY KEY, approval_id INTEGER REFERENCES approval_requests(id), kind VARCHAR(12) NOT NULL CHECK (kind IN ('SALE_BATCH','EXPIRY')),
        invoice_id INTEGER, invoice_item_id INTEGER, outlet_id INTEGER, product_id INTEGER NOT NULL,
        from_batch_id INTEGER, from_batch_no VARCHAR(100), from_expiry DATE, to_batch_id INTEGER, to_batch_no VARCHAR(100), to_expiry DATE,
        qty NUMERIC(15,3), reason TEXT NOT NULL, requested_by INTEGER, approved_by INTEGER, posted_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    """CREATE TABLE expired_removals (
        id SERIAL PRIMARY KEY, approval_id INTEGER UNIQUE REFERENCES approval_requests(id), outlet_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, batch_no VARCHAR(100), exp_date DATE, qty NUMERIC(15,3) NOT NULL CHECK (qty > 0),
        cost_value NUMERIC(14,2), disposition VARCHAR(20) NOT NULL DEFAULT 'WRITE_OFF', reason TEXT NOT NULL, photo VARCHAR(255),
        requested_by INTEGER, approved_by INTEGER, posted_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX IF NOT EXISTS ix_batch_stock_loc ON product_batch_stock (location_id, product_id)",
    "CREATE INDEX IF NOT EXISTS ix_batches_exp ON product_batches (exp_date)",
    # audit log: who / role / store / approval, and no edits or deletes
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_role VARCHAR(40)",
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outlet_id INTEGER",
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS approval_ref VARCHAR(30)",
    """CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
       BEGIN
         IF TG_OP = 'INSERT' THEN
           IF NEW.user_role IS NULL AND NEW.user_id IS NOT NULL THEN
             SELECT role INTO NEW.user_role FROM users WHERE id = NEW.user_id;
           END IF;
           RETURN NEW;
         END IF;
         RAISE EXCEPTION 'Audit history cannot be changed or deleted';
       END $$ LANGUAGE plpgsql""",
    "DROP TRIGGER IF EXISTS trg_audit_logs_guard ON audit_logs",
    "CREATE TRIGGER trg_audit_logs_guard BEFORE INSERT OR UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_guard()",
]

NEW_PERMS = {
    "approvals": ("Approvals", ["view", "approve", "edit"]),
    "payment_modes": ("Payment Mode Master", ["view", "create", "edit", "delete"]),
    "expiry": ("Expiry, Batch Correction & Expired Removal", ["view", "remove_expired", "change_batch", "edit", "export"]),
    "items": ("Item Master", ["change_price"]),
    "purchase_order": ("Purchase Order", ["email"]),
    "day_shift": ("Day & Shift Open/Close", ["submit", "reopen"]),
}
ROLE_GRANTS = {
    "manager": [f"{m}.{a}" for m, (_, acts) in NEW_PERMS.items() for a in acts],
    "area_sales_manager": ["approvals.view", "approvals.approve", "expiry.view", "expiry.remove_expired", "expiry.change_batch", "expiry.export", "expiry.edit",
                           "payment_modes.view", "day_shift.reopen"],
    "store_manager": ["approvals.view", "expiry.view", "expiry.remove_expired", "expiry.change_batch", "expiry.edit", "payment_modes.view", "day_shift.submit"],
    "staff": ["expiry.view", "expiry.change_batch", "payment_modes.view"],
    "purchase_manager": ["purchase_order.email", "items.change_price", "expiry.view", "payment_modes.view"],
    "category_manager": ["items.change_price", "expiry.view"],
    "accounts_manager": ["payment_modes.view", "payment_modes.create", "payment_modes.edit", "approvals.view"],
}


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for key, (label, acts) in NEW_PERMS.items():
        for a in acts:
            conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES (:m, :n, :s) ON CONFLICT (slug) DO NOTHING"),
                         {"m": key, "n": f"{label} — {a.replace('_', ' ')}", "s": f"{key}.{a}"})
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_guard ON audit_logs")
    for t in ("expired_removals", "batch_corrections", "expiry_bands", "payment_modes", "approval_seq", "approval_requests", "approval_policies"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
