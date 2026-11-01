"""users.outlet_id -> outlets (was the empty legacy outlet_master, so no user could be tied to a branch)

Revision ID: d7f9b1c3e5a6
Revises: c6e8a0b2d4f5
Create Date: 2026-10-02 09:30:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'd7f9b1c3e5a6'
down_revision: Union[str, None] = 'c6e8a0b2d4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET outlet_id = NULL WHERE outlet_id IS NOT NULL AND outlet_id NOT IN (SELECT id FROM outlets)")
    op.drop_constraint('users_outlet_id_fkey', 'users', type_='foreignkey')
    op.create_foreign_key('users_outlet_id_fkey', 'users', 'outlets', ['outlet_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('users_outlet_id_fkey', 'users', type_='foreignkey')
    op.create_foreign_key('users_outlet_id_fkey', 'users', 'outlet_master', ['outlet_id'], ['id'])
