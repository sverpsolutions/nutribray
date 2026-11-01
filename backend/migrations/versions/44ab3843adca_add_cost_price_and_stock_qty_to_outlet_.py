"""Add cost_price and stock_qty to outlet_pricing

Revision ID: 44ab3843adca
Revises: 7afcade8349d
Create Date: 2026-05-03 20:53:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '44ab3843adca'
down_revision: Union[str, None] = '7afcade8349d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('outlet_pricing', sa.Column('cost_price', sa.Numeric(10, 2), nullable=True))
    op.add_column('outlet_pricing', sa.Column('stock_qty', sa.Numeric(15, 3), nullable=True))

def downgrade() -> None:
    op.drop_column('outlet_pricing', 'stock_qty')
    op.drop_column('outlet_pricing', 'cost_price')
