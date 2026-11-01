"""Add aisle_no and barcode_crt to products

Revision ID: 7afcade8349d
Revises: 99c456aa93f7
Create Date: 2026-05-03 19:28:10.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '7afcade8349d'
down_revision: Union[str, None] = '99c456aa93f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('products', sa.Column('aisle_no', sa.String(length=20), nullable=True))
    op.add_column('products', sa.Column('barcode_crt', sa.String(length=50), nullable=True))

def downgrade() -> None:
    op.drop_column('products', 'barcode_crt')
    op.drop_column('products', 'aisle_no')
