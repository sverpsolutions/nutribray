"""Add item master upgrades

Revision ID: 99c456aa93f7
Revises: 0006
Create Date: 2026-05-03 19:08:20.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '99c456aa93f7'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Add item_code_format to company_settings
    op.add_column('company_settings', sa.Column('item_code_format', sa.String(), server_default='[PREFIX]-[BRAND]-[VARIANT]-[SIZE]'))

    # 2. Add fields to categories, groups, subgroups, subcategories, brands
    for table in ['categories', 'item_groups', 'item_subgroups', 'item_subcategories', 'brands']:
        op.add_column(table, sa.Column('short_name', sa.String(length=10), nullable=True))
        # if updated_at doesn't exist, we add it. Many might not have it.
        op.add_column(table, sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True))
        op.add_column(table, sa.Column('updated_by', sa.Integer(), nullable=True))

    # 3. Create sub_category_brands table
    op.create_table('sub_category_brands',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('brand_id', sa.Integer(), nullable=False),
        sa.Column('subcategory_id', sa.Integer(), nullable=False),
        sa.Column('short_name', sa.String(length=10), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # 4. Add fields to products table
    op.add_column('products', sa.Column('print_name', sa.String(length=30), nullable=True))
    op.add_column('products', sa.Column('variant', sa.String(length=50), nullable=True))
    op.add_column('products', sa.Column('size', sa.String(length=50), nullable=True))
    op.add_column('products', sa.Column('sub_category_brand_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('products', 'sub_category_brand_id')
    op.drop_column('products', 'size')
    op.drop_column('products', 'variant')
    op.drop_column('products', 'print_name')
    
    op.drop_table('sub_category_brands')

    for table in ['categories', 'item_groups', 'item_subgroups', 'item_subcategories', 'brands']:
        op.drop_column(table, 'updated_by')
        op.drop_column(table, 'updated_at')
        op.drop_column(table, 'short_name')

    op.drop_column('company_settings', 'item_code_format')
