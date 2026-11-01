"""stock_take_item_batches

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-14 23:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS stock_take_item_batches (
            id SERIAL PRIMARY KEY,
            stock_take_item_id INTEGER NOT NULL REFERENCES stock_take_items(id) ON DELETE CASCADE,
            stock_take_id INTEGER NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
            batch_no VARCHAR(100) NOT NULL,
            mfg_date DATE,
            expiry_date DATE,
            system_qty NUMERIC(12, 3) DEFAULT 0.000,
            counted_qty NUMERIC(12, 3) NOT NULL DEFAULT 0.000,
            variance NUMERIC(12, 3) DEFAULT 0.000,
            reason VARCHAR(255),
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_stk_item_batches_sti ON stock_take_item_batches(stock_take_item_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stk_item_batches_take_prod ON stock_take_item_batches(stock_take_id, product_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS stock_take_item_batches CASCADE")
