"""Create shop_banners

Revision ID: b7e2c4d1f0a3
Revises: a198d928ca09
Create Date: 2026-10-01 08:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b7e2c4d1f0a3'
down_revision: Union[str, None] = 'a198d928ca09'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Other shop_* tables were created by hand; skip if this one was too.
    if sa.inspect(op.get_bind()).has_table('shop_banners'):
        return
    op.create_table(
        'shop_banners',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('title', sa.String(100)),
        sa.Column('image', sa.String(255), nullable=False),
        sa.Column('link', sa.String(255)),
        sa.Column('status', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('shop_banners')
