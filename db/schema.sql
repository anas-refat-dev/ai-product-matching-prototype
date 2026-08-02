DROP TABLE IF EXISTS product_aliases;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    brand TEXT,          -- plain text, e.g. "جهينة"
    size NUMERIC,        -- just the number, e.g. 1, 1.5, 400 — nullable for products with no meaningful size (e.g. eggs)
    unit TEXT,           -- "L", "kg", "g" — fixed per product, for DISPLAY only, never matched against customer input
    price NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS product_aliases (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),  -- attached to PRODUCT, not variant
    alias_text TEXT NOT NULL
);

-- Trigram index for fast fuzzy search on the small products table
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_aliases_text_trgm ON product_aliases USING gin (alias_text gin_trgm_ops);