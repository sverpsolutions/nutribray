"""Customer master: code, GST registration, PAN, shipping address, credit days, discount

Revision ID: a9c3e5f7b1d2
Revises: f2a5b8c1d3e4
Create Date: 2026-10-02 07:20:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'a9c3e5f7b1d2'
down_revision: Union[str, None] = 'f2a5b8c1d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = [
    sa.Column('customer_code', sa.String(20)),
    sa.Column('contact_person', sa.String(100)),
    sa.Column('alt_phone', sa.String(20)),
    sa.Column('gst_registration_type', sa.String(20), server_default='Unregistered'),
    sa.Column('pan_number', sa.String(10)),
    sa.Column('state_code', sa.String(2)),
    sa.Column('shipping_address', sa.Text()),
    sa.Column('shipping_city', sa.String(50)),
    sa.Column('shipping_state', sa.String(50)),
    sa.Column('shipping_pincode', sa.String(10)),
    sa.Column('credit_days', sa.Integer(), server_default='0'),
    sa.Column('discount_percent', sa.Numeric(5, 2), server_default='0'),
    sa.Column('notes', sa.Text()),
]


def upgrade() -> None:
    for c in COLS:
        op.add_column('customers', c)
    # backfill codes for existing rows, then make them unique
    op.execute("UPDATE customers SET customer_code = 'CUST' || LPAD(id::text, 5, '0') WHERE customer_code IS NULL")
    op.create_index('ux_customers_code', 'customers', ['customer_code'], unique=True)
    # one active customer per GSTIN
    op.create_index('ux_customers_gst_active', 'customers', ['gst_number'], unique=True,
                    postgresql_where=sa.text("gst_number IS NOT NULL AND status"))


def downgrade() -> None:
    op.drop_index('ux_customers_gst_active', 'customers')
    op.drop_index('ux_customers_code', 'customers')
    for c in reversed(COLS):
        op.drop_column('customers', c.name)
