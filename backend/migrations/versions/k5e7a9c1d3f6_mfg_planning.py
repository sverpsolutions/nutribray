"""Manufacturing planning: item type on the item master, BOM component rounding / preferred store, warehouse -> plant store
transfer requests (approval), production release control with audited override, variance reasons, permissions.

Additive. Item types are back-filled from how items are already used (BOM components, packaging specs).

Revision ID: k5e7a9c1d3f6
Revises: j4d6f8b0c2e5
Create Date: 2026-10-28 22:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'k5e7a9c1d3f6'
down_revision: Union[str, None] = 'j4d6f8b0c2e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    """ALTER TABLE products ADD COLUMN IF NOT EXISTS item_type VARCHAR(4) NOT NULL DEFAULT 'FG'
        CHECK (item_type IN ('FG','RM','PM','SFG','CONS','OTH'))""",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS bom_applicable BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS default_store_id INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS item_remarks TEXT",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_pack_qty NUMERIC(12,3)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS min_order_qty NUMERIC(12,3)",
    # back-fill item types from current use
    """UPDATE products SET item_type = 'RM' WHERE id IN (SELECT product_id FROM mfg_bom_items WHERE material_type IN ('RAW_MATERIAL','PREMIX'))""",
    """UPDATE products SET item_type = 'PM' WHERE id IN (SELECT product_id FROM mfg_bom_items WHERE material_type = 'PACKAGING')
        OR id IN (SELECT x FROM mfg_pack_specs s, LATERAL (VALUES (s.printed_tin_item_id), (s.cap_item_id), (s.label_item_id), (s.carton_item_id)) v(x)
                  WHERE x IS NOT NULL)""",
    "UPDATE products SET item_type = 'CONS' WHERE id IN (SELECT product_id FROM mfg_bom_items WHERE material_type = 'CONSUMABLE')",
    "UPDATE products SET bom_applicable = TRUE WHERE id IN (SELECT product_id FROM mfg_boms)",
    "CREATE INDEX IF NOT EXISTS ix_products_item_type ON products (item_type)",
    # BOM: component rounding (whole units per order) and where it is normally issued from
    "ALTER TABLE mfg_bom_items ALTER COLUMN quantity TYPE NUMERIC(16,8)",      # 1/24 carton = 0.04166667, not 0.0417
    "ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS round_up BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS preferred_store_id INTEGER",
    "UPDATE mfg_bom_items SET round_up = TRUE WHERE UPPER(unit) IN ('PCS','NOS','PC','CTN','CARTON','BOX','ROLL','SHEET')",
    "CREATE INDEX IF NOT EXISTS ix_mfg_bom_items_product ON mfg_bom_items (product_id)",
    # warehouse (retail / GRN location) -> plant store transfer requests use the plant transfer approval
    "ALTER TABLE mfg_transfers ALTER COLUMN from_store_id DROP NOT NULL",
    "ALTER TABLE mfg_transfers ADD COLUMN IF NOT EXISTS from_outlet_id INTEGER REFERENCES outlets(id)",
    "ALTER TABLE mfg_transfers ADD COLUMN IF NOT EXISTS for_order_id INTEGER",
    "ALTER TABLE mfg_transfers DROP CONSTRAINT IF EXISTS mfg_transfers_check",
    "ALTER TABLE mfg_transfers ADD CONSTRAINT mfg_transfers_source CHECK ((from_store_id IS NULL) <> (from_outlet_id IS NULL))",
    "ALTER TABLE mfg_transfers ADD CONSTRAINT mfg_transfers_diff CHECK (from_store_id IS NULL OR from_store_id <> to_store_id)",
    # production release control
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS released_at TIMESTAMP",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS released_by INTEGER",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS release_override_reason TEXT",
    "ALTER TABLE mfg_orders ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5",
    "ALTER TABLE mfg_order_items ADD COLUMN IF NOT EXISTS variance_reason TEXT",
    "CREATE INDEX IF NOT EXISTS ix_mfg_orders_status ON mfg_orders (stock_mode, status)",
]
PERMS = [("release", "Approve production release"), ("override", "Override production shortage")]
ROLE_GRANTS = {"manager": ["manufacturing.release", "manufacturing.override"]}


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)
    conn = op.get_bind()
    for a, label in PERMS:
        conn.execute(sa.text("INSERT INTO permissions (module, name, slug) VALUES ('manufacturing', :n, :s) ON CONFLICT (slug) DO NOTHING"),
                     {"n": f"Manufacturing — {label}", "s": f"manufacturing.{a}"})
    for role, slugs in ROLE_GRANTS.items():
        conn.execute(sa.text("""INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r
            JOIN permissions p ON p.slug = ANY(:s) WHERE r.slug = :r ON CONFLICT DO NOTHING"""), {"s": slugs, "r": role})


def downgrade() -> None:
    op.execute("ALTER TABLE mfg_transfers DROP CONSTRAINT IF EXISTS mfg_transfers_source")
