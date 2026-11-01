"""Accounts: supplier bill entry (SPS) on GRNs, supplier payments with maker-checker, bank opening balance

Revision ID: e8a0c2d4f6b7
Revises: d7f9b1c3e5a6
Create Date: 2026-10-02 10:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e8a0c2d4f6b7'
down_revision: Union[str, None] = 'd7f9b1c3e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BILL_COLS = [
    sa.Column('bill_status', sa.String(10), nullable=False, server_default='pending'),  # pending | verified | disputed
    sa.Column('bill_no', sa.String(50)),
    sa.Column('bill_date', sa.Date()),
    sa.Column('bill_amount', sa.Numeric(12, 2)),
    sa.Column('bill_attachment', sa.String(255)),
    sa.Column('bill_remarks', sa.Text()),
    sa.Column('bill_verified_by', sa.Integer()),
    sa.Column('bill_verified_at', sa.DateTime()),
    sa.Column('due_date', sa.Date()),
]


def upgrade() -> None:
    for c in BILL_COLS:
        op.add_column('unit_wise_purchases', c)
    # the same supplier invoice can be booked only once
    op.create_index('ux_purchases_supplier_bill', 'unit_wise_purchases', ['supplier_id', sa.text('UPPER(bill_no)')], unique=True,
                    postgresql_where=sa.text("bill_no IS NOT NULL"))

    op.add_column('bank_accounts', sa.Column('opening_balance', sa.Numeric(14, 2), nullable=False, server_default='0'))
    op.add_column('bank_accounts', sa.Column('opening_date', sa.Date()))

    op.create_table(
        'supplier_payments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('payment_no', sa.String(20), unique=True),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('suppliers.id'), nullable=False),
        sa.Column('bank_account_id', sa.Integer(), sa.ForeignKey('bank_accounts.id'), nullable=False),
        sa.Column('payment_date', sa.Date(), nullable=False),
        sa.Column('mode', sa.String(10), nullable=False),            # neft | rtgs | imps | upi | cheque
        sa.Column('reference_no', sa.String(50), nullable=False),     # UTR / cheque no
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='pending'),  # pending | posted | rejected | void
        sa.Column('remarks', sa.Text()),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('actioned_by', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('actioned_at', sa.DateTime()),
        sa.Column('action_remarks', sa.Text()),
        sa.CheckConstraint('amount > 0', name='ck_supplier_payments_amount'),
    )
    op.create_index('ux_supplier_payments_ref', 'supplier_payments', ['bank_account_id', 'mode', sa.text('UPPER(reference_no)')],
                    unique=True, postgresql_where=sa.text("status IN ('pending', 'posted')"))
    op.create_index('ix_supplier_payments_supplier', 'supplier_payments', ['supplier_id'])

    op.create_table(
        'supplier_payment_allocations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('payment_id', sa.Integer(), sa.ForeignKey('supplier_payments.id'), nullable=False),
        sa.Column('purchase_id', sa.Integer(), sa.ForeignKey('unit_wise_purchases.id'), nullable=False),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False, server_default='0'),     # cash paid against the bill
        sa.Column('discount', sa.Numeric(14, 2), nullable=False, server_default='0'),   # cash discount received
        sa.Column('status', sa.String(10), nullable=False, server_default='active'),    # active | reversed
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.CheckConstraint('amount >= 0 AND discount >= 0 AND amount + discount > 0', name='ck_alloc_positive'),
    )
    op.create_index('ix_alloc_payment', 'supplier_payment_allocations', ['payment_id'])
    op.create_index('ix_alloc_purchase', 'supplier_payment_allocations', ['purchase_id'])


def downgrade() -> None:
    op.drop_table('supplier_payment_allocations')
    op.drop_table('supplier_payments')
    op.drop_column('bank_accounts', 'opening_date')
    op.drop_column('bank_accounts', 'opening_balance')
    op.drop_index('ux_purchases_supplier_bill', 'unit_wise_purchases')
    for c in reversed(BILL_COLS):
        op.drop_column('unit_wise_purchases', c.name)
