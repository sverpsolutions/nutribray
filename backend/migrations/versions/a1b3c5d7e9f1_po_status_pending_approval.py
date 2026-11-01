"""PO status: allow pending_approval and completed (used by PO create / list / approval screens)

Revision ID: a1b3c5d7e9f1
Revises: d1e2f3a4b5c6
Create Date: 2026-10-15 17:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'a1b3c5d7e9f1'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "('draft', 'approved', 'partial', 'fulfilled', 'cancelled')"
NEW = "('draft', 'pending_approval', 'approved', 'partial', 'completed', 'fulfilled', 'cancelled')"


def upgrade() -> None:
    op.drop_constraint('po_headers_status_check', 'po_headers', type_='check')
    op.create_check_constraint('po_headers_status_check', 'po_headers', f"status IN {NEW}")


def downgrade() -> None:
    op.execute("UPDATE po_headers SET status = 'draft' WHERE status = 'pending_approval'")
    op.execute("UPDATE po_headers SET status = 'fulfilled' WHERE status = 'completed'")
    op.drop_constraint('po_headers_status_check', 'po_headers', type_='check')
    op.create_check_constraint('po_headers_status_check', 'po_headers', f"status IN {OLD}")
