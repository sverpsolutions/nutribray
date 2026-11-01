"""Sales returns (credit notes) + company GSTIN/state

Revision ID: c3d9e1a2b4f5
Revises: b7e2c4d1f0a3
Create Date: 2026-10-01 10:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c3d9e1a2b4f5'
down_revision: Union[str, None] = 'b7e2c4d1f0a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('unit_wise_invoices', sa.Column('ref_invoice_no', sa.String(30)))
    op.add_column('unit_wise_invoices', sa.Column('return_reason', sa.String(255)))
    op.add_column('unit_wise_invoices', sa.Column('refund_method', sa.String(20)))
    op.add_column('unit_wise_invoices', sa.Column('adjusted_amount', sa.Numeric(12, 2), nullable=False, server_default='0'))
    op.create_index('idx_invoices_ref_invoice_no', 'unit_wise_invoices', ['ref_invoice_no'])

    op.add_column('company_settings', sa.Column('gstin', sa.String(20)))
    op.add_column('company_settings', sa.Column('company_state', sa.String(50)))


def downgrade() -> None:
    op.drop_column('company_settings', 'company_state')
    op.drop_column('company_settings', 'gstin')
    op.drop_index('idx_invoices_ref_invoice_no', table_name='unit_wise_invoices')
    op.drop_column('unit_wise_invoices', 'adjusted_amount')
    op.drop_column('unit_wise_invoices', 'refund_method')
    op.drop_column('unit_wise_invoices', 'return_reason')
    op.drop_column('unit_wise_invoices', 'ref_invoice_no')
