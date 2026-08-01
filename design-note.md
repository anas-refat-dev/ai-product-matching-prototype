# Design Note — AI Product Matching Prototype
**Scope:** narrow test of one thing only — can the AI reliably map messy Arabic/mixed customer text to real products? No cart, no order, no delivery, no multi-store, no admin UI.
**Stack:** Node.js + PostgreSQL (with `pg_trgm`) + Anthropic API (tool calling).

---

## 1. Database schema

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT
);

CREATE TABLE product_variants (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    brand TEXT,          -- plain text, e.g. "جهينة"
    size TEXT,           -- plain text, e.g. "1.5L"
    price NUMERIC NOT NULL
);

CREATE TABLE product_aliases (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),  -- attached to PRODUCT, not variant
    alias_text TEXT NOT NULL
);

-- Trigram index for fast fuzzy search on the small products table
CREATE INDEX idx_products_name_trgm ON products USING gin (name_ar gin_trgm_ops);
CREATE INDEX idx_aliases_text_trgm ON product_aliases USING gin (alias_text gin_trgm_ops);
```

**Why this shape (recap of the reasoning):**
- `products` is the small, deduplicated "what" list — this is what gets fuzzy-searched, which is why matching typos against it is reliable (comparing against ~15–20 short names, not hundreds of long variant descriptions).
- `product_variants` holds brand/size/price as plain columns — never fuzzy-searched on their own; once the product is identified, variants are just filtered/listed, which is why this step can't really go wrong the way fuzzy search can. (No `stock` field for this prototype — availability isn't part of what's being tested.)
- `product_aliases` is attached to `products`, so one alias (e.g. "لبب" → لبن) covers every brand/size at once, instead of needing to be duplicated per variant.
- `GENERATED ALWAYS AS IDENTITY` is used instead of the older `SERIAL` shorthand — same auto-incrementing behavior, but it's the modern SQL-standard syntax and prevents the sequence-desync bug class that `SERIAL` allows if an explicit id is ever inserted.

**On aliases specifically — why they're needed even though fuzzy search exists:** fuzzy search (`word_similarity`) is a character-overlap measure — it correctly catches typos (لبب → لبن, one character off) but cannot catch genuine synonyms or transliterations with little character overlap (حليب → لبن, or ميلك → لبن, the transliterated English word "milk"). Aliases exist specifically for that second category — known dialect/synonym/foreign-script terms — not for typos. Kept in the schema and populated for this prototype (per decision to keep both aliases and the full test set, including the "ميلك" case that specifically exercises this).

---

## 2. Arabic normalization rule (apply before every comparison, both sides)

Before storing or searching any Arabic text, run it through this normalization — applied to **both** the stored catalog text and the incoming customer query, never just one side:

- Strip diacritics (tashkeel), if present.
- Collapse alef variants: أ, إ, آ → ا
- Collapse taa marbuta / haa: ة → ه (pick one direction, apply everywhere)
- Collapse alef maksura: ى → ي

Without this, legitimate Arabic spelling variation (e.g. "جهينة" vs "جهينه") lowers match scores for no real reason — this isn't a threshold-tuning problem, it's a missing normalization step.

### Unit normalization (separate from character normalization, needed for `size` matching)

Sizes given in Arabic text ("1 لتر", "1 كيلو") need to match stored variant sizes even if those are stored in Latin abbreviated form ("1L", "1kg") — a literal string comparison between the two fails even though they mean the same thing. Apply a small unit-mapping step before comparing `size`:

- لتر / لتر ↔ L
- كيلو / كيلوجرام ↔ kg
- (extend this list as new units show up in real test cases)

This is a lookup/mapping table, not fuzzy matching — units are a small closed set, so exact mapping is more reliable than similarity scoring here.

---

## 3. The `search_products` tool definition

```json
{
  "name": "search_products",
  "description": "Search for a product the customer wants, with optional brand/size if mentioned.",
  "input_schema": {
    "type": "object",
    "properties": {
      "product_query": {
        "type": "string",
        "description": "The core item name AS THE CUSTOMER WROTE IT, raw, uncorrected (e.g. 'لبب', not 'لبن')."
      },
      "brand": {
        "type": "string",
        "description": "Brand mentioned, if any, raw as written. Omit if not mentioned."
      },
      "size": {
        "type": "string",
        "description": "Size/quantity unit mentioned, if any, raw as written. Omit if not mentioned."
      },
      "qty": {
        "type": "integer",
        "description": "How many of this item. Default 1 if not stated."
      }
    },
    "required": ["product_query"]
  }
}
```

**Backend verification steps on every call (the LLM's extraction is a guess, not a fact):**
1. Fuzzy-match `product_query` (normalized) against `products` (normalized) via `word_similarity()` → candidate product(s).
2. If `brand` given: fuzzy-match against the actual brand values present on that product's variants only.
3. If `size` given: normalize units, then match against actual size values on those variants.
4. All three resolve to exactly one real variant row → confident match, no clarification needed.
   Otherwise → return the real candidate list for the AI to present or ask about.

**Scoped/partial clarification rule:** only ask about the slot(s) that are actually missing or ambiguous — never re-ask about a slot the customer already specified and that resolved cleanly. For example, if the customer gave a size that matched fine but no brand, the clarifying question should be narrowed to "which brand?" only, not a generic re-ask about the whole item. This matters once messages contain several items with different amounts of detail per item (see the multi-item stress example in the test categories below) — treating clarification as all-or-nothing produces annoying, redundant questions.

**Response format for scoped clarification — confirm what's resolved, then ask only what's missing:**

```
Customer: عايز لبن جبيته
                  └── "جبيته" is a typo for "جهينة", caught by fuzzy brand-matching
AI:       تمام، عايز لبن جهينة. حجم ايه؟ في 1 لتر وفي 1.5 لتر
```

Here `product_query` ("لبن") and `brand` ("جبيته" → fuzzy-matched to "جهينة") both resolved; only `size` is missing. The response reflects that back explicitly ("تمام، عايز لبن جهينة") before asking — this confirms to the customer that their typo'd brand was understood correctly, then asks only about the one genuinely missing slot, listing the real sizes available for that specific product+brand combination (not sizes across all brands). This is the pattern to follow for every `clarification_needed` case: state what's confirmed, ask only about `missing_slot`, and populate options from the already-narrowed candidate list, never the full unfiltered catalog.

---

## 4. JSON output shape

```json
{
  "input": "عايز لبب و بيض",
  "extracted_items": ["لبب", "بيض"],
  "results": [
    {
      "query": "لبب",
      "outcome": "clarification_needed",
      "missing_slot": "brand",
      "candidates": [
        {"product": "لبن", "brand": "جهينة", "size": "1.5L", "price": 22, "score": 0.33},
        {"product": "لبن", "brand": "المراعي", "size": "1.5L", "price": 20, "score": 0.31}
      ]
    },
    {
      "query": "بيض",
      "outcome": "confident_match",
      "matched_variant": {"product": "بيض", "brand": null, "size": "unit", "price": 5.5}
    }
  ]
}
```

`outcome` is always one of: `confident_match`, `clarification_needed`, `not_found`. `missing_slot` (only present on `clarification_needed`) names which slot(s) are actually unresolved (`brand`, `size`, or `both`) so the clarifying question can be scoped narrowly instead of re-asking about the whole item. This fixed vocabulary is what makes scoring test cases automatic later (compare `outcome` to each test case's `expected_outcome`) instead of eyeballing free text.

---

## 5. Test case categories (write these before touching AI code)

Aim for 20–30 total messages, covering:
- Clean, correct input (should be `confident_match`)
- Typos (لبب, ميلك — should be `clarification_needed` or `confident_match` depending on how distinctive the typo is)
- Dialect / Arabizi (عايز ٢ كولا, 3ayez lban)
- Genuine ambiguity — one product, multiple brands/sizes available (should be `clarification_needed`)
- Fully specified — product + brand + size in one message (should be `confident_match`, no question asked)
- Multiple items in one message (لبن وبيض وعيش — each item scored independently)
- Multi-item stress test with varying detail per item, exercising scoped/partial clarification (e.g. "عايز لبب 1 لتر و 3 بيضات و رز المنار و دقيق المنار 1 كيلو" — one item needs only a brand clarification despite giving size, one is a clean multi-slot match, one is fully unresolved/`not_found`, one is a plural form of a known product)
- Plural/morphological variation of a known product (بيضات for بيض) — distinct from typos or dialect synonyms, worth confirming trigram similarity handles this correctly rather than assuming it
- Out-of-catalog item (e.g. بيبسي if not stocked — should be `not_found`, not a forced bad match)

Each test case: `{ "input": "...", "expected_outcome": "confident_match" | "clarification_needed" | "not_found" }`

---

## 6. Build order (do not reorder — each step should work in isolation before the next)

1. Schema + seed script (15–20 real products, Arabic names, manual aliases) → verify data by eye in a DB GUI.
2. Normalization function + fuzzy search (`word_similarity` query), tested directly with hardcoded strings — **no AI yet**.
3. `search_products` tool wired to the LLM (tool-calling loop) — test manually with one or two live messages.
4. Test runner — loop over the written test cases, print JSON, auto-compare `outcome` vs `expected_outcome`.
5. Read the results and judge quality — this is the actual point of the prototype.

---

*This note consolidates decisions made across the planning conversation. It intentionally omits cart/order/delivery/multi-store/admin concerns — those live in the separate SRS/HLD documents for the full MVP, which remain valid for later phases.*