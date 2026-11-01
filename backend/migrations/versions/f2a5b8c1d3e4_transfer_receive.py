"""Stock transfer receive: received qty per line, who/when received

Revision ID: f2a5b8c1d3e4
Revises: e1f4a7b2c9d0
Create Date: 2026-10-01 22:20:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f2a5b8c1d3e4'
down_revision: Union[str, None] = 'e1f4a7b2c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('unit_wise_stock_transfer_items', sa.Column('received_qty', sa.Numeric(12, 3)))
    op.add_column('unit_wise_stock_transfers', sa.Column('received_at', sa.DateTime()))
    op.add_column('unit_wise_stock_transfers', sa.Column('received_by', sa.Integer()))


def downgrade() -> None:
    op.drop_column('unit_wise_stock_transfers', 'received_by')
    op.drop_column('unit_wise_stock_transfers', 'received_at')
    op.drop_column('unit_wise_stock_transfer_items', 'received_qty')
