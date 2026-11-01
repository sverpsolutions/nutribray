"""Excel import engine: import jobs (preview -> commit, idempotent), price change history, import permissions.

Revision ID: j4d6f8b0c2e5
Revises: i3c5e7a9b1d4
Create Date: 2026-10-28 18:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'j4d6f8b0c2e5'
down_revision: Union[str, None] = 'i3c5e7a9b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    """CREATE TABLE import_jobs (
        id SERIAL PRIMARY KEY, import_no VARCHAR(30) NOT NULL UNIQUE,
        module VARCHAR(12) NOT NULL CHECK (module IN ('PO','GRN','WHOLESALE','ITEMS','PRICES')),
        file_name VARCHAR(200) NOT NULL, file_hash VARCHAR(64) NOT NULL, outlet_id INTEGER, header JSONB NOT NULL DEFAULT '{}',
        rows JSONB NOT NULL DEFAULT '[]', total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0,
        failed_rows INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW','IMPORTED','PARTIAL','FAILED','CANCELLED','PENDING_APPROVAL')),
        created_refs TEXT, message TEXT, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW(), committed_at TIMESTAMP)""",
    "CREATE INDEX ix_import_jobs_hash ON import_jobs (module, file_hash, status)",
    """CREATE TABLE price_change_log (
        id BIGSERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), field VARCHAR(20) NOT NULL,
        old_value NUMERIC(14,2), new_value NUMERIC(14,2), source VARCHAR(30) NOT NULL, ref VARCHAR(40), reason TEXT,
        changed_by INTEGER, changed_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "CREATE INDEX ix_price_change_product ON price_change_log (product_id, changed_at)",
    "CREATE INDEX IF NOT EXISTS ix_products_item_code_upper ON products (UPPER(item_code))",
]

ACTS = ["view", "export", "po", "grn", "wholesale", "items", "prices"]
ROLE_GRANTS = {
    "manager": [f"imports.{a}" for a in ACTS],
    "purchase_manager": ["imports.view", "imports.export", "imports.po", "imports.grn", "imports.items", "imports.prices"],
    "category_manager": ["imports.view", "imports.export", "imports.items", "imports.prices"],
    "store_manager": ["imports.view", "imports.export", "imports.grn", "imports.wholesale"],
    "accounts_manager": ["imports.view", "imports.export", "imports.wholesale"],
}


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for a in ACTS:
        conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES ('imports', :n, :s) ON CONFLICT (slug) DO NOTHING"),
                     {"n": f"Excel Import — {a}", "s": f"imports.{a}"})
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS price_change_log")
    op.execute("DROP TABLE IF EXISTS import_jobs")
