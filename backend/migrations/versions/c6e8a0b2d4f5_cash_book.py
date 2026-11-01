"""Cash book: expenses, pay-ins, pickups, handovers, bank deposits, safe count (ported + tightened from NCG cash management)

Revision ID: c6e8a0b2d4f5
Revises: b4d6f8a0c2e3
Create Date: 2026-10-02 09:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c6e8a0b2d4f5'
down_revision: Union[str, None] = 'b4d6f8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bank_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),          # display name, e.g. "HDFC Current - Saket"
        sa.Column('bank_name', sa.String(100), nullable=False),
        sa.Column('account_no', sa.String(30), nullable=False, unique=True),
        sa.Column('ifsc', sa.String(11)),
        sa.Column('branch', sa.String(100)),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    cat = op.create_table(
        'cash_categories',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('type', sa.String(10), nullable=False),            # expense | pay_in
        sa.Column('approval_limit', sa.Numeric(12, 2)),               # above this a manager must approve; NULL = never
        sa.Column('requires_bill', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.UniqueConstraint('name', 'type', name='ux_cash_categories_name_type'),
    )
    op.bulk_insert(cat, [
        {'name': n, 'type': 'expense', 'approval_limit': lim, 'requires_bill': bill, 'sort_order': i}
        for i, (n, lim, bill) in enumerate([
            ('Staff Tea / Refreshment', 500, False), ('Cleaning & Housekeeping', 1000, False),
            ('Stationery & Printing', 1000, True), ('Transport / Porter', 1000, False),
            ('Courier', 500, True), ('Repair & Maintenance', 2000, True),
            ('Electricity / Utility', 0, True), ('Staff Welfare', 1000, False),
            ('Purchase - Local', 2000, True), ('Miscellaneous', 500, True),
        ], 1)
    ] + [
        {'name': n, 'type': 'pay_in', 'approval_limit': None, 'requires_bill': False, 'sort_order': i}
        for i, n in enumerate(['Safe Opening Balance', 'Change from Bank', 'Additional Float', 'Other Receipt'], 1)
    ])

    op.create_table(
        'cash_entries',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('entry_no', sa.String(20), unique=True),
        # expense | pay_in | pickup | float_out | shift_close | handover | deposit | adjustment
        sa.Column('kind', sa.String(15), nullable=False),
        sa.Column('outlet_id', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('business_date', sa.Date(), nullable=False),
        sa.Column('shift_id', sa.Integer()),
        # custody moved from -> to. types: drawer(ref=shift) safe(ref=outlet) person(ref=user) bank(ref=bank_account)
        #                                   outside / expense / adjustment (ref NULL)
        sa.Column('from_type', sa.String(10), nullable=False),
        sa.Column('from_ref', sa.Integer()),
        sa.Column('to_type', sa.String(10), nullable=False),
        sa.Column('to_ref', sa.Integer()),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        # posted | pending (approval / acceptance / bank verification) | rejected | cancelled | void
        sa.Column('status', sa.String(10), nullable=False, server_default='posted'),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('cash_categories.id')),
        sa.Column('party', sa.String(150)),        # paid to / received from
        sa.Column('ref_no', sa.String(50)),        # bill no / deposit slip no
        sa.Column('description', sa.Text()),
        sa.Column('attachment', sa.String(255)),
        sa.Column('credited_amount', sa.Numeric(12, 2)),   # deposits: what the bank statement shows
        sa.Column('bank_ref', sa.String(60)),
        sa.Column('credited_date', sa.Date()),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('actioned_by', sa.Integer(), sa.ForeignKey('users.id')),   # approved / accepted / verified / rejected by
        sa.Column('actioned_at', sa.DateTime()),
        sa.Column('action_remarks', sa.Text()),
        sa.CheckConstraint('amount > 0', name='ck_cash_entries_amount_positive'),
    )
    op.create_index('ix_cash_entries_from', 'cash_entries', ['from_type', 'from_ref'])
    op.create_index('ix_cash_entries_to', 'cash_entries', ['to_type', 'to_ref'])
    op.create_index('ix_cash_entries_outlet_date', 'cash_entries', ['outlet_id', 'business_date'])
    op.create_index('ix_cash_entries_status', 'cash_entries', ['status'])

    for c in ('safe_expected', 'safe_counted', 'safe_variance'):
        op.add_column('business_days', sa.Column(c, sa.Numeric(12, 2)))


def downgrade() -> None:
    for c in ('safe_variance', 'safe_counted', 'safe_expected'):
        op.drop_column('business_days', c)
    op.drop_table('cash_entries')
    op.drop_table('cash_categories')
    op.drop_table('bank_accounts')
