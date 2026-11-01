"""Manufacturing Phase A: customer brands, artwork & packaging specifications (revisioned), item units,
department stores and the department stock ledger.

* mfg_stock_txns is append-only: a trigger refuses UPDATE / DELETE, corrections are reversal rows.
* mfg_stock keeps the balance per store / item / batch / brand and can never go negative (CHECK).
* brand_id 0 = general stock (not customer-specific); customer-specific packaging carries its brand.

Revision ID: d7e9f1a3b5c6
Revises: c4d6e8f0a2b5
Create Date: 2026-10-27 10:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'd7e9f1a3b5c6'
down_revision: Union[str, None] = 'c4d6e8f0a2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATUS = "status VARCHAR(15) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SUPERSEDED','INACTIVE'))"

STATEMENTS = [
    """CREATE TABLE mfg_brands (
        id SERIAL PRIMARY KEY, code VARCHAR(30) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
        customer_id INTEGER REFERENCES customers(id), is_own_brand BOOLEAN NOT NULL DEFAULT FALSE, notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (is_own_brand OR customer_id IS NOT NULL))""",
    f"""CREATE TABLE mfg_artworks (
        id SERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        brand_id INTEGER NOT NULL REFERENCES mfg_brands(id), title VARCHAR(150) NOT NULL,
        applies_to VARCHAR(10) NOT NULL DEFAULT 'TIN' CHECK (applies_to IN ('TIN','CAP','LABEL','CARTON','POUCH','OTHER')),
        colours VARCHAR(150), description TEXT, file_path VARCHAR(255), {STATUS},
        effective_from DATE, effective_to DATE, approved_by INTEGER, approved_at TIMESTAMP,
        created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE (code, revision))""",
    f"""CREATE TABLE mfg_pack_specs (
        id SERIAL PRIMARY KEY, spec_code VARCHAR(40) NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        brand_id INTEGER NOT NULL REFERENCES mfg_brands(id), product_id INTEGER NOT NULL REFERENCES products(id),
        customer_item_code VARCHAR(50), product_spec TEXT, tin_size VARCHAR(40), tin_type VARCHAR(60),
        cap_type VARCHAR(60), cap_colour VARCHAR(40), printing_colour VARCHAR(80), packaging_instructions TEXT,
        units_per_carton INTEGER NOT NULL DEFAULT 1 CHECK (units_per_carton > 0), std_pack_qty NUMERIC(12,3),
        quality_requirements TEXT,
        tin_artwork_id INTEGER REFERENCES mfg_artworks(id), cap_artwork_id INTEGER REFERENCES mfg_artworks(id),
        label_artwork_id INTEGER REFERENCES mfg_artworks(id), carton_artwork_id INTEGER REFERENCES mfg_artworks(id),
        printed_tin_item_id INTEGER REFERENCES products(id), cap_item_id INTEGER REFERENCES products(id),
        label_item_id INTEGER REFERENCES products(id), carton_item_id INTEGER REFERENCES products(id),
        photos JSONB NOT NULL DEFAULT '[]', {STATUS}, effective_from DATE, effective_to DATE,
        approved_by INTEGER, approved_at TIMESTAMP, created_by INTEGER, created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (spec_code, revision))""",
    """CREATE TABLE mfg_item_uoms (
        id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit VARCHAR(20) NOT NULL, factor NUMERIC(18,6) NOT NULL CHECK (factor > 0),
        for_purchase BOOLEAN NOT NULL DEFAULT FALSE, for_stock BOOLEAN NOT NULL DEFAULT FALSE,
        for_production BOOLEAN NOT NULL DEFAULT FALSE, for_packing BOOLEAN NOT NULL DEFAULT FALSE,
        for_sales BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE (product_id, unit))""",
    """CREATE TABLE mfg_stores (
        id SERIAL PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(80) NOT NULL,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('RAW','PACKAGING','PLAIN_TIN','PRINTING_WIP','PRINTED','PRODUCTION_WIP',
                                               'PACKING','FINISHED','QC','REJECTED','SCRAP','DISPATCH')),
        outlet_id INTEGER REFERENCES outlets(id), usable BOOLEAN NOT NULL DEFAULT TRUE, is_wip BOOLEAN NOT NULL DEFAULT FALSE,
        sort INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE)""",
    """INSERT INTO mfg_stores (code, name, kind, usable, is_wip, sort) VALUES
        ('RMS', 'Raw Material Store', 'RAW', TRUE, FALSE, 1),
        ('PMS', 'Packaging Material Store', 'PACKAGING', TRUE, FALSE, 2),
        ('PTS', 'Plain Tin Store', 'PLAIN_TIN', TRUE, FALSE, 3),
        ('PWIP', 'Printing Work in Progress', 'PRINTING_WIP', FALSE, TRUE, 4),
        ('PRS', 'Printed Tin Store', 'PRINTED', TRUE, FALSE, 5),
        ('MWIP', 'Production Work in Progress', 'PRODUCTION_WIP', FALSE, TRUE, 6),
        ('PACK', 'Packing Department', 'PACKING', FALSE, TRUE, 7),
        ('FGS', 'Finished Goods Store', 'FINISHED', TRUE, FALSE, 8),
        ('QCQ', 'Quality Control / Quarantine', 'QC', FALSE, FALSE, 9),
        ('REJ', 'Rejected Material Store', 'REJECTED', FALSE, FALSE, 10),
        ('SCR', 'Damage / Scrap Store', 'SCRAP', FALSE, FALSE, 11),
        ('DSP', 'Billing / Dispatch Store', 'DISPATCH', FALSE, FALSE, 12)""",
    """CREATE TABLE mfg_stock (
        store_id INTEGER NOT NULL REFERENCES mfg_stores(id), product_id INTEGER NOT NULL REFERENCES products(id),
        batch_no VARCHAR(100) NOT NULL DEFAULT '', brand_id INTEGER NOT NULL DEFAULT 0,
        qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (qty >= 0), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (store_id, product_id, batch_no, brand_id))""",
    """CREATE TABLE mfg_stock_txns (
        id BIGSERIAL PRIMARY KEY, doc_no VARCHAR(30) NOT NULL, txn_type VARCHAR(30) NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id), batch_no VARCHAR(100) NOT NULL DEFAULT '',
        brand_id INTEGER NOT NULL DEFAULT 0, from_store_id INTEGER REFERENCES mfg_stores(id),
        to_store_id INTEGER REFERENCES mfg_stores(id), qty NUMERIC(14,4) NOT NULL CHECK (qty > 0),
        unit_entered VARCHAR(20), qty_entered NUMERIC(14,4), ref_type VARCHAR(30), ref_id INTEGER, ref_no VARCHAR(50),
        remarks TEXT, request_key VARCHAR(80) UNIQUE, reversal_of BIGINT UNIQUE REFERENCES mfg_stock_txns(id),
        posted_by INTEGER, posted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (from_store_id IS NOT NULL OR to_store_id IS NOT NULL), CHECK (from_store_id IS DISTINCT FROM to_store_id))""",
    "CREATE INDEX ix_mfg_txn_product ON mfg_stock_txns (product_id, posted_at)",
    "CREATE INDEX ix_mfg_txn_ref ON mfg_stock_txns (ref_type, ref_id)",
    """CREATE OR REPLACE FUNCTION mfg_txn_immutable() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION 'Posted stock movements cannot be changed or deleted; post a reversal instead'; END $$ LANGUAGE plpgsql""",
    """CREATE TRIGGER trg_mfg_txn_immutable BEFORE UPDATE OR DELETE ON mfg_stock_txns
       FOR EACH ROW EXECUTE FUNCTION mfg_txn_immutable()""",
    """CREATE TABLE mfg_transfers (
        id SERIAL PRIMARY KEY, transfer_no VARCHAR(30) NOT NULL UNIQUE,
        from_store_id INTEGER NOT NULL REFERENCES mfg_stores(id), to_store_id INTEGER NOT NULL REFERENCES mfg_stores(id),
        status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
        remarks TEXT, requested_by INTEGER, requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
        approved_by INTEGER, approved_at TIMESTAMP, reject_reason TEXT, CHECK (from_store_id <> to_store_id))""",
    """CREATE TABLE mfg_transfer_lines (
        id SERIAL PRIMARY KEY, transfer_id INTEGER NOT NULL REFERENCES mfg_transfers(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id), batch_no VARCHAR(100) NOT NULL DEFAULT '',
        brand_id INTEGER NOT NULL DEFAULT 0, qty NUMERIC(14,4) NOT NULL CHECK (qty > 0),
        unit_entered VARCHAR(20), qty_entered NUMERIC(14,4))""",
    """CREATE TABLE mfg_doc_seq (prefix VARCHAR(20) PRIMARY KEY, last_no INTEGER NOT NULL DEFAULT 0)""",
]


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)


def downgrade() -> None:
    for t in ("mfg_doc_seq", "mfg_transfer_lines", "mfg_transfers"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("DROP TRIGGER IF EXISTS trg_mfg_txn_immutable ON mfg_stock_txns")
    op.execute("DROP FUNCTION IF EXISTS mfg_txn_immutable()")
    for t in ("mfg_stock_txns", "mfg_stock", "mfg_stores", "mfg_item_uoms", "mfg_pack_specs", "mfg_artworks", "mfg_brands"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
