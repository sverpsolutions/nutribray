"""Add credit_days to supplier_brands

Revision ID: a198d928ca09
Revises: 44ab3843adca
Create Date: 2026-06-08 12:39:58.092898

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'a198d928ca09'
down_revision: Union[str, None] = '44ab3843adca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('supplier_brands', sa.Column('credit_days', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('supplier_brands', 'credit_days')
