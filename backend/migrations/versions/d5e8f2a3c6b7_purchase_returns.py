"""Purchase returns (debit notes) + GRN column drift fix

- unit_wise_purchases / _items: add columns the ORM models write but the DB
  lacked (every GRN save failed with "column total_qty does not exist").
- unit_wise_purchase_returns / _items: DB had an old shape (return_no, rate,
  return_id) that matched neither the sync model nor debit notes. Both tables
  are empty; rebuild them to one schema used by outlet sync (prn_no, price,
  basic_amount) and HO debit notes (GST split, GRN link, status).

Revision ID: d5e8f2a3c6b7
Revises: c3d9e1a2b4f5
Create Date: 2026-10-01 12:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'd5e8f2a3c6b7'
down_revision: Union[str, None] = 'c3d9e1a2b4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

N = sa.Numeric(12, 2)


def _add_missing(table: str, cols: list[sa.Column]):
    have = {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for c in cols:
        if c.name not in have:
            op.add_column(table, c)


def upgrade() -> None:
    _add_missing('unit_wise_purchases', [sa.Column('total_qty', sa.Numeric(12, 3), nullable=False, server_default='0')])
    _add_missing('unit_wise_purchase_items', [
        sa.Column('basic_amount', N, nullable=False, server_default='0'),
        sa.Column('discount_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('discount_amount', N, nullable=False, server_default='0'),
        sa.Column('taxable_amount', N, nullable=False, server_default='0'),
    ])

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT (SELECT count(*) FROM unit_wise_purchase_returns) + (SELECT count(*) FROM unit_wise_purchase_return_items)")).scalar()
    if rows:
        raise RuntimeError(f"unit_wise_purchase_returns has {rows} rows; refusing to rebuild - migrate data first")
    op.drop_table('unit_wise_purchase_return_items')
    op.drop_table('unit_wise_purchase_returns')

    op.create_table(
        'unit_wise_purchase_returns',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('prn_no', sa.String(50), nullable=False, index=True),
        sa.Column('outlet_id', sa.Integer()),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('suppliers.id')),
        sa.Column('purchase_id', sa.Integer()),
        sa.Column('ref_purchase_no', sa.String(30), index=True),
        sa.Column('return_date', sa.Date(), nullable=False),
        sa.Column('is_interstate', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('total_qty', sa.Numeric(12, 3), nullable=False, server_default='0'),
        sa.Column('taxable_amount', N, nullable=False, server_default='0'),
        sa.Column('cgst_amount', N, nullable=False, server_default='0'),
        sa.Column('sgst_amount', N, nullable=False, server_default='0'),
        sa.Column('igst_amount', N, nullable=False, server_default='0'),
        sa.Column('total_gst', N, nullable=False, server_default='0'),
        sa.Column('total_amount', N, nullable=False, server_default='0'),
        sa.Column('adjusted_amount', N, nullable=False, server_default='0'),
        sa.Column('reason', sa.String(255)),
        sa.Column('notes', sa.Text()),
        sa.Column('status', sa.String(20), nullable=False, server_default='confirmed'),
        sa.Column('created_by', sa.Integer()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_table(
        'unit_wise_purchase_return_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('prn_id', sa.Integer(), sa.ForeignKey('unit_wise_purchase_returns.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('product_id', sa.Integer()),
        sa.Column('item_code', sa.String(50)),
        sa.Column('name', sa.String(200)),
        sa.Column('hsn_code', sa.String(20)),
        sa.Column('qty', sa.Numeric(12, 3), nullable=False, server_default='0'),
        sa.Column('unit', sa.String(20)),
        sa.Column('price', N, nullable=False, server_default='0'),
        sa.Column('basic_amount', N, nullable=False, server_default='0'),
        sa.Column('taxable_amt', N, nullable=False, server_default='0'),
        sa.Column('gst_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('cgst_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('sgst_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('igst_percent', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('cgst_amount', N, nullable=False, server_default='0'),
        sa.Column('sgst_amount', N, nullable=False, server_default='0'),
        sa.Column('igst_amount', N, nullable=False, server_default='0'),
        sa.Column('gst_amount', N, nullable=False, server_default='0'),
        sa.Column('total', N, nullable=False, server_default='0'),
    )
    # Outlet PRN numbers repeat across outlets (sync keys on prn_no + outlet_id);
    # only HO debit note numbers must be unique.
    op.create_index('uq_purchase_returns_ho_prn', 'unit_wise_purchase_returns', ['prn_no'], unique=True,
                    postgresql_where=sa.text("prn_no LIKE 'DN-HO-%'"))


def downgrade() -> None:
    op.drop_table('unit_wise_purchase_return_items')
    op.drop_table('unit_wise_purchase_returns')
    op.create_table(
        'unit_wise_purchase_returns',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('return_no', sa.String(), nullable=False),
        sa.Column('purchase_id', sa.Integer()),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('return_date', sa.Date(), nullable=False),
        sa.Column('total_amount', N, nullable=False, server_default='0'),
        sa.Column('reason', sa.Text()),
        sa.Column('status', sa.String(), server_default='approved'),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'unit_wise_purchase_return_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('return_id', sa.Integer(), sa.ForeignKey('unit_wise_purchase_returns.id')),
        sa.Column('product_id', sa.Integer()),
        sa.Column('qty', sa.Numeric(12, 3)),
        sa.Column('rate', N),
        sa.Column('total', N),
    )
    for c in ('basic_amount', 'discount_percent', 'discount_amount', 'taxable_amount'):
        op.drop_column('unit_wise_purchase_items', c)
    op.drop_column('unit_wise_purchases', 'total_qty')
