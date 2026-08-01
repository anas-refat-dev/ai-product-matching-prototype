CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT
);

CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    brand TEXT,          -- plain text, e.g. "جهينة"
    size TEXT,           -- plain text, e.g. "1.5L"
    price NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS product_aliases (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),  -- attached to PRODUCT, not variant
    alias_text TEXT NOT NULL
);

-- Trigram index for fast fuzzy search on the small products table
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name_ar gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_aliases_text_trgm ON product_aliases USING gin (alias_text gin_trgm_ops);