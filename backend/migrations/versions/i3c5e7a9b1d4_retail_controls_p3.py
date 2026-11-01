"""Retail controls phase 3: vendor GSTIN verification fields, PO e-mail outbox (Outlook / Microsoft Graph) and settings.
Item creation through a Purchase ID uses the existing approval engine (ITEM_CREATION) — no new table.

Revision ID: i3c5e7a9b1d4
Revises: h2b4d6f8a0c3
Create Date: 2026-10-28 13:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'i3c5e7a9b1d4'
down_revision: Union[str, None] = 'h2b4d6f8a0c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_verify_status VARCHAR(12) NOT NULL DEFAULT 'UNVERIFIED'",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMP",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_verify_source VARCHAR(60)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_legal_name VARCHAR(200)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_trade_name VARCHAR(200)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_reg_status VARCHAR(40)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_taxpayer_type VARCHAR(60)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_address TEXT",
    "CREATE INDEX IF NOT EXISTS ix_suppliers_gst ON suppliers (UPPER(gst_number))",
    """CREATE TABLE po_email_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), auto_send BOOLEAN NOT NULL DEFAULT FALSE,
        send_unapproved BOOLEAN NOT NULL DEFAULT FALSE, cc VARCHAR(300), reply_to VARCHAR(150), max_attempts INTEGER NOT NULL DEFAULT 5,
        signature TEXT, updated_by INTEGER, updated_at TIMESTAMP)""",
    "INSERT INTO po_email_settings (id) VALUES (1)",
    """CREATE TABLE po_email_outbox (
        id SERIAL PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES po_headers(id), po_no VARCHAR(30) NOT NULL,
        to_email VARCHAR(300) NOT NULL, cc VARCHAR(300), subject VARCHAR(300) NOT NULL,
        status VARCHAR(8) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('PENDING','QUEUED','SENDING','SENT','FAILED','RETRY')),
        attempts INTEGER NOT NULL DEFAULT 0, next_try_at TIMESTAMP NOT NULL DEFAULT NOW(), last_error TEXT, sent_at TIMESTAMP,
        provider_ref VARCHAR(120), dedupe_key VARCHAR(80) NOT NULL UNIQUE, trigger VARCHAR(12) NOT NULL DEFAULT 'APPROVAL',
        created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX ix_po_email_due ON po_email_outbox (status, next_try_at)",
]


NEW_PERMS: dict = {}
ROLE_GRANTS = {"purchase_manager": ["items.create"]}     # new items through the Purchase ID workflow (still needs approval)


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS po_email_outbox")
    op.execute("DROP TABLE IF EXISTS po_email_settings")
