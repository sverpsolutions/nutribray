"""Settings → Block negative inventory

Revision ID: e7f9a1b3c5d6
Revises: d6e8f0a2b4c5
Create Date: 2026-10-23 12:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'e7f9a1b3c5d6'
down_revision: Union[str, None] = 'd6e8f0a2b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS block_negative_stock BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE company_settings DROP COLUMN block_negative_stock")
