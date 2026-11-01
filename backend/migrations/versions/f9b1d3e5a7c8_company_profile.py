"""Company profile (ported from bombayfishries settings / sps_company / hr_company_settings) + compliance documents

Revision ID: f9b1d3e5a7c8
Revises: e8a0c2d4f6b7
Create Date: 2026-10-02 11:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f9b1d3e5a7c8'
down_revision: Union[str, None] = 'e8a0c2d4f6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = [
    # identity
    sa.Column('legal_name', sa.String(200)),             # registered name as on GST / MCA
    sa.Column('company_type', sa.String(40)),            # Private Limited, LLP, Partnership, ...
    sa.Column('company_pan', sa.String(10)),
    sa.Column('state_code', sa.String(2)),               # GST state code (from GSTIN)
    sa.Column('fssai_no', sa.String(14)),
    sa.Column('msme_no', sa.String(30)),                 # Udyam registration
    sa.Column('iec_no', sa.String(10)),
    # registered office (head office keeps ho_address + company_state)
    sa.Column('reg_address', sa.Text()),
    sa.Column('reg_city', sa.String(60)),
    sa.Column('reg_state', sa.String(60)),
    sa.Column('reg_pincode', sa.String(6)),
    sa.Column('ho_city', sa.String(60)),
    sa.Column('ho_pincode', sa.String(6)),
    sa.Column('company_website', sa.String(150)),
    sa.Column('alt_phone', sa.String(20)),
    # bank shown on invoices
    sa.Column('bank_account_name', sa.String(150)),
    sa.Column('bank_name', sa.String(100)),
    sa.Column('bank_account_no', sa.String(30)),
    sa.Column('bank_ifsc', sa.String(11)),
    sa.Column('bank_branch', sa.String(100)),
    sa.Column('upi_id', sa.String(60)),
    # invoice / signatory
    sa.Column('authorized_signatory', sa.String(100)),
    sa.Column('signatory_designation', sa.String(60)),
    sa.Column('invoice_terms', sa.Text()),
    sa.Column('invoice_footer', sa.String(200)),
    sa.Column('fy_start_month', sa.Integer(), nullable=False, server_default='4'),
    sa.Column('updated_at', sa.DateTime()),
    sa.Column('updated_by', sa.Integer()),
]


def upgrade() -> None:
    for c in COLS:
        op.add_column('company_settings', c)
    op.create_table(
        'company_documents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('doc_type', sa.String(30), nullable=False),     # PAN, CIN, GST_CERT, FSSAI, SHOPS_EST, ...
        sa.Column('doc_number', sa.String(60)),
        sa.Column('file_path', sa.String(255), nullable=False),
        sa.Column('issue_date', sa.Date()),
        sa.Column('expiry_date', sa.Date()),
        sa.Column('notes', sa.Text()),
        sa.Column('is_current', sa.Boolean(), nullable=False, server_default=sa.true()),  # older uploads kept as history
        sa.Column('uploaded_by', sa.Integer(), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ux_company_documents_current', 'company_documents', ['doc_type'], unique=True,
                    postgresql_where=sa.text('is_current'))


def downgrade() -> None:
    op.drop_table('company_documents')
    for c in reversed(COLS):
        op.drop_column('company_settings', c.name)
