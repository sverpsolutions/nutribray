"""Outlet master: per-outlet negative stock rule (company setting / block / allow)

Revision ID: a2b4c6d8e0f1
Revises: f8a0b2c4d6e7
Create Date: 2026-10-25 10:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'a2b4c6d8e0f1'
down_revision: Union[str, None] = 'f8a0b2c4d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""ALTER TABLE outlets ADD COLUMN negative_stock VARCHAR(10) NOT NULL DEFAULT 'company'
                  CHECK (negative_stock IN ('company', 'block', 'allow'))""")


def downgrade() -> None:
    op.execute("ALTER TABLE outlets DROP COLUMN negative_stock")
