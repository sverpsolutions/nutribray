"""24-hour stores: operating mode + shift plan + automatic midnight rollover per outlet; planned shift end; auto-closed flags.

Additive; every store stays STANDARD until switched to 24H.

Revision ID: l6f8b0d2e4a7
Revises: k5e7a9c1d3f6
Create Date: 2026-10-29 10:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'l6f8b0d2e4a7'
down_revision: Union[str, None] = 'k5e7a9c1d3f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    "ALTER TABLE outlets ADD COLUMN IF NOT EXISTS operating_mode VARCHAR(10) NOT NULL DEFAULT 'STANDARD' CHECK (operating_mode IN ('STANDARD','24H'))",
    "ALTER TABLE outlets ADD COLUMN IF NOT EXISTS shift_plan JSONB",
    "ALTER TABLE outlets ADD COLUMN IF NOT EXISTS auto_rollover BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE cashier_shifts ADD COLUMN IF NOT EXISTS planned_end TIMESTAMP",
    "ALTER TABLE cashier_shifts ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE business_days ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE",
    "CREATE INDEX IF NOT EXISTS ix_cashier_shifts_open ON cashier_shifts (outlet_id, status)",
    "ALTER TABLE cashier_shifts ADD COLUMN IF NOT EXISTS shift_no SMALLINT",
    "UPDATE cashier_shifts c SET shift_no = x.n FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY business_day_id ORDER BY opened_at, id) AS n "
    "FROM cashier_shifts) x WHERE x.id = c.id AND c.shift_no IS NULL",
]


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)


def downgrade() -> None:
    pass
