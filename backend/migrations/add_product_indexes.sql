-- Run this once in psql / pgAdmin to make 51K-item queries fast
-- Estimated time: 10-30 seconds on 51K rows

-- Enable trigram extension for fast LIKE/ILIKE with leading wildcard
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes — make %search% instant on name, code, barcode
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_item_code_trgm
    ON products USING gin (item_code gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_barcode_trgm
    ON products USING gin (barcode gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_filter_combo_trgm
    ON products USING gin (filter_combination_name gin_trgm_ops);

-- B-tree indexes for filter columns (category, brand, classification, is_active)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_id
    ON products (category_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_brand_id
    ON products (brand_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_classification_id
    ON products (classification_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_is_active
    ON products (is_active);

-- Composite index for the most common query: all active, ordered by name
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_name
    ON products (is_active, name);

-- Barcode lookup (unique exact match)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_barcode_exact
    ON products (barcode)
    WHERE barcode IS NOT NULL;

-- Packaging join column
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_packaging_product_id
    ON item_packaging_master (product_id);

-- Verify indexes created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'products'
ORDER BY indexname;
