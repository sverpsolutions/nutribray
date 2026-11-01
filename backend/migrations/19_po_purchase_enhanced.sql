-- ============================================================
-- Migration 19: Enhanced PO & Purchase System
-- Run in: pgAdmin → bombayfisheries DB
-- All ALTER statements are idempotent (DO blocks check first)
-- ============================================================

-- 1. Enhance po_headers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='outlet_id') THEN
    ALTER TABLE po_headers ADD COLUMN outlet_id integer DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='delivery_days') THEN
    ALTER TABLE po_headers ADD COLUMN delivery_days integer NOT NULL DEFAULT 7;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='approval_status') THEN
    ALTER TABLE po_headers ADD COLUMN approval_status varchar(30) NOT NULL DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='approved_by') THEN
    ALTER TABLE po_headers ADD COLUMN approved_by integer DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='approved_at') THEN
    ALTER TABLE po_headers ADD COLUMN approved_at timestamp DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='approval_remarks') THEN
    ALTER TABLE po_headers ADD COLUMN approval_remarks text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='reject_reason') THEN
    ALTER TABLE po_headers ADD COLUMN reject_reason text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='markdown_enabled') THEN
    ALTER TABLE po_headers ADD COLUMN markdown_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_headers' AND column_name='terms') THEN
    ALTER TABLE po_headers ADD COLUMN terms text DEFAULT NULL;
  END IF;
END $$;

-- 2. Enhance po_items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='warehouse_stock') THEN
    ALTER TABLE po_items ADD COLUMN warehouse_stock numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='outlet_stock') THEN
    ALTER TABLE po_items ADD COLUMN outlet_stock numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='doh_value') THEN
    ALTER TABLE po_items ADD COLUMN doh_value numeric(8,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='sale_7d') THEN
    ALTER TABLE po_items ADD COLUMN sale_7d numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='sale_30d') THEN
    ALTER TABLE po_items ADD COLUMN sale_30d numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='avg_daily_sale') THEN
    ALTER TABLE po_items ADD COLUMN avg_daily_sale numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='suggested_qty') THEN
    ALTER TABLE po_items ADD COLUMN suggested_qty numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='mrp') THEN
    ALTER TABLE po_items ADD COLUMN mrp numeric(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='markdown_percent') THEN
    ALTER TABLE po_items ADD COLUMN markdown_percent numeric(5,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='order_qty') THEN
    ALTER TABLE po_items ADD COLUMN order_qty numeric(12,3) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='po_items' AND column_name='amount') THEN
    ALTER TABLE po_items ADD COLUMN amount numeric(12,2) DEFAULT 0;
  END IF;
END $$;

-- 3. Supplier structured terms
CREATE TABLE IF NOT EXISTS supplier_po_terms (
    id                  serial PRIMARY KEY,
    supplier_id         integer NOT NULL UNIQUE REFERENCES suppliers(id),
    payment_terms       text DEFAULT NULL,
    delivery_terms      text DEFAULT NULL,
    transport_terms     text DEFAULT NULL,
    tax_terms           text DEFAULT NULL,
    replacement_policy  text DEFAULT NULL,
    default_po_terms    text DEFAULT NULL,
    remarks             text DEFAULT NULL,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. PO Terms per PO (fixed snapshot + dynamic additions)
CREATE TABLE IF NOT EXISTS po_terms_conditions (
    id          serial PRIMARY KEY,
    po_id       integer NOT NULL REFERENCES po_headers(id) ON DELETE CASCADE,
    term_type   varchar(10) NOT NULL DEFAULT 'DYNAMIC' CHECK (term_type IN ('FIXED','DYNAMIC')),
    title       varchar(255) NOT NULL,
    description text DEFAULT NULL,
    sequence_no integer NOT NULL DEFAULT 0,
    created_by  integer DEFAULT NULL,
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_po_terms_po_id ON po_terms_conditions(po_id);

-- 5. Multi-outlet distribution
CREATE TABLE IF NOT EXISTS po_distribution_hdr (
    id              serial PRIMARY KEY,
    po_id           integer NOT NULL REFERENCES po_headers(id) ON DELETE CASCADE,
    outlet_id       integer NOT NULL,
    status          varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','completed','cancelled')),
    transfer_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (transfer_status IN ('pending','in_transit','received')),
    remarks         text DEFAULT NULL,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(po_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS idx_po_dist_hdr_po ON po_distribution_hdr(po_id);

CREATE TABLE IF NOT EXISTS po_distribution_dtl (
    id               serial PRIMARY KEY,
    distribution_id  integer NOT NULL REFERENCES po_distribution_hdr(id) ON DELETE CASCADE,
    po_item_id       integer NOT NULL REFERENCES po_items(id),
    product_id       integer NOT NULL,
    allocated_qty    numeric(12,3) NOT NULL DEFAULT 0,
    received_qty     numeric(12,3) NOT NULL DEFAULT 0,
    pending_qty      numeric(12,3) NOT NULL DEFAULT 0,
    UNIQUE(distribution_id, po_item_id)
);

-- 6. PO Audit Log
CREATE TABLE IF NOT EXISTS po_audit_log (
    id          serial PRIMARY KEY,
    po_id       integer NOT NULL REFERENCES po_headers(id) ON DELETE CASCADE,
    action      varchar(100) NOT NULL,
    description text DEFAULT NULL,
    old_status  varchar(50) DEFAULT NULL,
    new_status  varchar(50) DEFAULT NULL,
    created_by  integer DEFAULT NULL,
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_po_audit_po ON po_audit_log(po_id);

-- 7. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_po_hdr_supplier   ON po_headers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_hdr_status      ON po_headers(approval_status);
CREATE INDEX IF NOT EXISTS idx_po_items_po        ON po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_uwp_supplier       ON unit_wise_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_uwp_status         ON unit_wise_purchases(status);
CREATE INDEX IF NOT EXISTS idx_uwpi_purchase      ON unit_wise_purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_uwpi_product       ON unit_wise_purchase_items(product_id);
