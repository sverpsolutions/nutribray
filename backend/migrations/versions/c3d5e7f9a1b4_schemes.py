"""Schemes / promotions engine (port of NCG scheme_master + SchemeEngine)

One `schemes` table: NCG's slab / free-item / mix-match / party / item-map side tables are JSONB
and int[] columns here (they were only ever read whole, per scheme). `scheme_usage_log`
records what every bill actually got, for the scheme report.

Revision ID: c3d5e7f9a1b4
Revises: b2c4d6e8f0a3
Create Date: 2026-10-18 10:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'c3d5e7f9a1b4'
down_revision: Union[str, None] = 'b2c4d6e8f0a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE schemes (
        id                      SERIAL PRIMARY KEY,
        name                    VARCHAR(150) NOT NULL,
        scheme_type             VARCHAR(20)  NOT NULL CHECK (scheme_type IN
            ('QTY_SLAB','VALUE_DISC','FREE_ITEM','MIX_MATCH','CARTON','TARGET','CASH_DISC','CREDIT_NOTE','CHEAPEST_FREE')),
        apply_on                VARCHAR(20)  NOT NULL DEFAULT 'item' CHECK (apply_on IN
            ('item','brand','category','brand_category','invoice','mix_match')),
        priority                SMALLINT     NOT NULL DEFAULT 5,
        start_date              DATE         NOT NULL,
        end_date                DATE         NOT NULL,
        start_time              TIME,
        end_time                TIME,
        is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
        outlet_ids              INTEGER[],              -- NULL = every outlet
        customer_ids            INTEGER[],              -- NULL = every customer
        product_ids             INTEGER[],              -- apply_on = item
        brand_id                INTEGER REFERENCES brands(id),
        category_id             INTEGER REFERENCES item_categories(id),
        min_qty                 NUMERIC(10,3) NOT NULL DEFAULT 0,
        min_value               NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount_percent        NUMERIC(6,2)  NOT NULL DEFAULT 0,
        discount_percent2       NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- cascading "20% + 10% extra"
        discount_value          NUMERIC(12,2) NOT NULL DEFAULT 0,
        free_qty                NUMERIC(10,3) NOT NULL DEFAULT 0,
        free_item_id            INTEGER REFERENCES products(id),
        is_recursive            BOOLEAN NOT NULL DEFAULT FALSE,
        is_combination_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
        max_benefit_per_invoice NUMERIC(12,2) NOT NULL DEFAULT 0,
        expiry_days_trigger     INTEGER,
        target_amount           NUMERIC(15,2) NOT NULL DEFAULT 0,
        credit_note_percent     NUMERIC(6,2)  NOT NULL DEFAULT 0,
        credit_note_timing      VARCHAR(20)   NOT NULL DEFAULT 'immediate',
        carton_size             INTEGER       NOT NULL DEFAULT 1,
        slabs                   JSONB NOT NULL DEFAULT '[]',  -- [{min_qty,max_qty,min_value,free_qty,discount_percent,discount_percent2,discount_value,free_item_id}]
        free_items              JSONB NOT NULL DEFAULT '[]',  -- [{product_id, qty}]
        mix_groups              JSONB NOT NULL DEFAULT '[]',  -- [{name, min_qty, product_ids:[]}]
        notes                   TEXT,
        created_by              INTEGER,
        created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMP,
        CHECK (end_date >= start_date)
    )
    """)
    op.execute("""
    CREATE INDEX ix_schemes_active_dates ON schemes (is_active, start_date, end_date)
    """)
    op.execute("""
    CREATE TABLE scheme_usage_log (
        id              SERIAL PRIMARY KEY,
        invoice_id      INTEGER NOT NULL REFERENCES unit_wise_invoices(id) ON DELETE CASCADE,
        invoice_no      VARCHAR(30) NOT NULL,
        outlet_id       INTEGER,
        customer_id     INTEGER,
        scheme_id       INTEGER REFERENCES schemes(id) ON DELETE SET NULL,
        scheme_name     VARCHAR(150) NOT NULL,
        scheme_type     VARCHAR(20)  NOT NULL,
        benefit_type    VARCHAR(20)  NOT NULL,      -- discount_percent / discount_value / free_item / credit_note
        discount_given  NUMERIC(12,2) NOT NULL DEFAULT 0,
        free_product_id INTEGER,
        free_qty        NUMERIC(10,3) NOT NULL DEFAULT 0,
        note            TEXT,
        applied_by      INTEGER,
        applied_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
    """)
    op.execute("""
    CREATE INDEX ix_scheme_usage_scheme ON scheme_usage_log (scheme_id, applied_at)
    """)
    op.execute("""
    CREATE INDEX ix_scheme_usage_invoice ON scheme_usage_log (invoice_id)
    """)
    op.execute("""
    CREATE INDEX ix_scheme_usage_customer ON scheme_usage_log (customer_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE scheme_usage_log")
    op.execute("DROP TABLE schemes")
