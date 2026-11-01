"""GRN against PO: link unit_wise_purchases / items to po_headers / po_items

Revision ID: b2c4d6e8f0a3
Revises: a1b3c5d7e9f1
Create Date: 2026-10-15 19:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b2c4d6e8f0a3'
down_revision: Union[str, None] = 'a1b3c5d7e9f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('unit_wise_purchases', sa.Column('po_id', sa.Integer(), sa.ForeignKey('po_headers.id'), nullable=True))
    op.create_index('ix_unit_wise_purchases_po_id', 'unit_wise_purchases', ['po_id'])
    op.add_column('unit_wise_purchase_items', sa.Column('po_item_id', sa.Integer(), sa.ForeignKey('po_items.id', ondelete='SET NULL'), nullable=True))


def downgrade() -> None:
    op.drop_column('unit_wise_purchase_items', 'po_item_id')
    op.drop_index('ix_unit_wise_purchases_po_id', 'unit_wise_purchases')
    op.drop_column('unit_wise_purchases', 'po_id')
