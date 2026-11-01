"""Day open/close + cashier shift open/close (ported from NCG Shifts)

Revision ID: b4d6f8a0c2e3
Revises: a9c3e5f7b1d2
Create Date: 2026-10-02 08:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b4d6f8a0c2e3'
down_revision: Union[str, None] = 'a9c3e5f7b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def money(name):
    return sa.Column(name, sa.Numeric(12, 2), nullable=False, server_default='0')


def upgrade() -> None:
    op.create_table(
        'business_days',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('outlet_id', sa.Integer(), nullable=False, server_default='0'),  # 0 = HO
        sa.Column('business_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='open'),
        sa.Column('opened_by', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('opened_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('open_remarks', sa.Text()),
        sa.Column('closed_by', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('closed_at', sa.DateTime()),
        sa.Column('close_remarks', sa.Text()),
        # frozen at day close
        sa.Column('total_bills', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cancelled_bills', sa.Integer(), nullable=False, server_default='0'),
        money('gross_sales'), money('total_discount'), money('total_gst'), money('net_sales'),
        money('total_returns'), money('total_credit'),
        money('total_collected'), money('total_cash'),
        sa.Column('mode_totals', sa.JSON()),  # {payment_mode: amount}
        money('total_shortage'), money('total_excess'),
        sa.UniqueConstraint('outlet_id', 'business_date', name='ux_business_days_outlet_date'),
    )
    op.create_index('ux_business_days_one_open', 'business_days', ['outlet_id'], unique=True,
                    postgresql_where=sa.text("status = 'open'"))

    op.create_table(
        'cashier_shifts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('business_day_id', sa.Integer(), sa.ForeignKey('business_days.id'), nullable=False),
        sa.Column('outlet_id', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('business_date', sa.Date(), nullable=False),
        sa.Column('cashier_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('shift_name', sa.String(30), nullable=False, server_default='General'),
        sa.Column('terminal_no', sa.String(30)),
        sa.Column('status', sa.String(10), nullable=False, server_default='open'),
        sa.Column('opened_at', sa.DateTime(), server_default=sa.func.now()),
        money('opening_cash'),
        sa.Column('open_remarks', sa.Text()),
        sa.Column('closed_at', sa.DateTime()),
        sa.Column('closed_by', sa.Integer(), sa.ForeignKey('users.id')),  # differs from cashier on force close
        sa.Column('close_remarks', sa.Text()),
        # frozen at shift close
        sa.Column('total_bills', sa.Integer(), nullable=False, server_default='0'),
        money('total_sales'), money('total_returns'), money('cash_refunds'), money('credit_sales'),
        money('system_cash'), money('actual_cash'), money('expected_cash'),
        sa.Column('mode_totals', sa.JSON()),  # [{mode, system, actual, diff}] incl. cash
        money('diff_total'), money('short_amount'), money('excess_amount'),
        sa.Column('denominations', sa.JSON()),
    )
    op.create_index('ux_cashier_shifts_one_open', 'cashier_shifts', ['cashier_id'], unique=True,
                    postgresql_where=sa.text("status = 'open'"))
    op.create_index('ix_cashier_shifts_day', 'cashier_shifts', ['business_day_id'])

    for t in ('unit_wise_invoices', 'unit_wise_payments'):
        op.add_column(t, sa.Column('shift_id', sa.Integer()))
        op.create_index(f'ix_{t}_shift', t, ['shift_id'])


def downgrade() -> None:
    for t in ('unit_wise_payments', 'unit_wise_invoices'):
        op.drop_index(f'ix_{t}_shift', t)
        op.drop_column(t, 'shift_id')
    op.drop_table('cashier_shifts')
    op.drop_table('business_days')
