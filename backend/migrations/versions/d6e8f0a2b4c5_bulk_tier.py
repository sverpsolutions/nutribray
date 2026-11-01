"""Bulk discount = scheme type BULK_TIER (qty tiers), plus customer-type targeting for any scheme

Revision ID: d6e8f0a2b4c5
Revises: c3d5e7f9a1b4
Create Date: 2026-10-23 10:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'd6e8f0a2b4c5'
down_revision: Union[str, None] = 'c3d5e7f9a1b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "('QTY_SLAB','VALUE_DISC','FREE_ITEM','MIX_MATCH','CARTON','TARGET','CASH_DISC','CREDIT_NOTE','CHEAPEST_FREE')"
NEW = OLD[:-1] + ",'BULK_TIER')"


def upgrade() -> None:
    op.execute("ALTER TABLE schemes DROP CONSTRAINT schemes_scheme_type_check")
    op.execute(f"ALTER TABLE schemes ADD CONSTRAINT schemes_scheme_type_check CHECK (scheme_type IN {NEW})")
    op.execute("ALTER TABLE schemes ADD COLUMN customer_types VARCHAR(20)[]")  # NULL = every customer type
    op.execute("ALTER TABLE schemes ADD COLUMN qty_basis VARCHAR(10) NOT NULL DEFAULT 'line' CHECK (qty_basis IN ('line','total'))")


def downgrade() -> None:
    op.execute("DELETE FROM schemes WHERE scheme_type = 'BULK_TIER'")
    op.execute("ALTER TABLE schemes DROP COLUMN qty_basis")
    op.execute("ALTER TABLE schemes DROP COLUMN customer_types")
    op.execute("ALTER TABLE schemes DROP CONSTRAINT schemes_scheme_type_check")
    op.execute(f"ALTER TABLE schemes ADD CONSTRAINT schemes_scheme_type_check CHECK (scheme_type IN {OLD})")
