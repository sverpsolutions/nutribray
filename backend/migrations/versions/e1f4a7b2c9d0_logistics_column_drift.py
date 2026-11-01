"""Column drift fix: logistics, stock transfers, PO vendor invoice, item packaging

The ORM models write columns the DB never got (logistic_transfers was created
outside migrations): Shipment List failed with "column
logistic_transfers.source_transfer_id does not exist".

Revision ID: e1f4a7b2c9d0
Revises: d5e8f2a3c6b7
Create Date: 2026-10-01 20:40:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e1f4a7b2c9d0'
down_revision: Union[str, None] = 'd5e8f2a3c6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_missing(table: str, cols: list[sa.Column]):
    have = {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for c in cols:
        if c.name not in have:
            op.add_column(table, c)


def upgrade() -> None:
    _add_missing('unit_wise_stock_transfers', [
        sa.Column('type', sa.String(10), nullable=False, server_default='OUT'),
        sa.Column('remarks', sa.Text()),
    ])
    _add_missing('logistic_transfers', [
        sa.Column('source_transfer_id', sa.Integer(), sa.ForeignKey('unit_wise_stock_transfers.id')),
    ])
    _add_missing('unit_wise_stock_transfer_items', [
        sa.Column('unit', sa.String(10), nullable=False, server_default='PCS'),
        sa.Column('cost_price', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('mrp', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('total_val', sa.Numeric(12, 2), nullable=False, server_default='0'),
    ])
    _add_missing('po_headers', [
        sa.Column('vendor_invoice_no', sa.String(50)),
        sa.Column('vendor_invoice_date', sa.Date()),
        sa.Column('vendor_invoice_file', sa.Text()),
    ])
    uom = lambda name: sa.Column(name, sa.Integer(), sa.ForeignKey('unit_master.id'))
    _add_missing('item_packaging_master', [
        uom('base_uom_id'), uom('purchase_uom_id'), uom('sales_uom_id'),
        uom('inner_pack_uom_id'), uom('outer_carton_uom_id'),
        sa.Column('outer_carton_qty', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('shelf_life_days', sa.Integer()),
        sa.Column('storage_type_id', sa.Integer(), sa.ForeignKey('storage_type_master.id')),
        sa.Column('temperature_category_id', sa.Integer(), sa.ForeignKey('temperature_category_master.id')),
    ])


def downgrade() -> None:
    # drift fix only: columns are required by the models, nothing to undo
    pass
