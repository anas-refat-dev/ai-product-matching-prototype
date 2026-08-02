# Design Note — AI Product Matching Prototype
**Scope:** narrow test of one thing only — can the AI reliably map messy Arabic/mixed customer text to real products? No cart, no order, no delivery, no multi-store, no admin UI.
**Stack:** Node.js + PostgreSQL (with `pg_trgm`) + Anthropic API (tool calling).

---

## 1. Database schema

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE product_variants (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    brand TEXT,          -- plain text, e.g. "جهينة", nullable for unbranded products
    size NUMERIC,         -- just the number, e.g. 1, 1.5, 400 — nullable for products with no meaningful size (e.g. eggs)
    unit TEXT,            -- "L", "kg", "g" — fixed per product, for DISPLAY only, never parsed from or matched against customer input
    price NUMERIC NOT NULL
);

CREATE TABLE product_aliases (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),  -- attached to PRODUCT, not variant
    alias_text TEXT NOT NULL
);

-- Trigram index for fast fuzzy search on the small products table
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_aliases_text_trgm ON product_aliases USING gin (alias_text gin_trgm_ops);
```

**Why this shape (recap of the reasoning):**
- `products` is the small, deduplicated "what" list — this is what gets fuzzy-searched, which is why matching typos against it is reliable (comparing against ~15–20 short names, not hundreds of long variant descriptions). Single `name` field only (Arabic-only app, no need for a separate English column).
- `product_variants` holds brand/size/unit/price as plain columns — never fuzzy-searched on their own; once the product is identified, variants are just filtered/listed, which is why this step can't really go wrong the way fuzzy search can. (No `stock` field for this prototype — availability isn't part of what's being tested.)
- **`size` is a number, `unit` is fixed metadata, not customer input.** A given product realistically only comes in one unit type (milk is always liters, rice/flour/sugar always kilos) — so the customer only ever needs to say *how much* (a plain number), never the unit itself. This removes an entire normalization concern (no لتر/كيلو ↔ L/kg mapping needed at all) compared to an earlier version of this design that treated size as free text.
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

**Implementation choice: normalize at seed time, not query time.** Rather than normalizing the stored text on every query (e.g. via SQL `translate()`), catalog data is normalized once when it's inserted (`seed.js` runs `normalizeArabic()` on `name`, `alias_text`, `brand`, and `unit` before insertion — with a null-safe guard, since several fields are nullable). This means stored data no longer shows its "original" spelling (e.g. "مكرونة" is stored as "مكرونه") — a real, accepted tradeoff for simpler queries at prototype scale. The incoming customer query is still normalized the same way at search time, so both sides stay consistent.

**Note on unit text:** an earlier version of this design also planned a unit-normalization step (لتر/كيلو ↔ L/kg mapping) for matching customer-provided size text. That's no longer needed — see the updated schema above, where `unit` is fixed per-variant metadata, never parsed from customer input at all. The customer only ever provides a plain number.

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
        "type": "number",
        "description": "Just the numeric amount, if mentioned (e.g. 1, 1.5, 400). The unit is fixed per product and never needs to be extracted or provided by the customer — omit this field if no amount was mentioned."
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
1. Fuzzy-match `product_query` (normalized) against `products` (normalized) via `word_similarity()` → candidate product(s). **Implementation note:** search products by name first with a high-confidence threshold (short-circuit if cleared); only fall back to also searching `product_aliases` and merging results if the name-only check doesn't clear that threshold. See Section 4 for why this ordering is safe and where it needs care (very short product names).
2. If `brand` given: fuzzy-match against the actual brand values present on that product's variants only.
3. If `size` given: compare directly as a number against the actual `size` values on those variants (no unit conversion needed — `unit` is fixed metadata, not customer input).
4. All three resolve to exactly one real variant row → confident match, no clarification needed.
   Otherwise → return the real candidate list for the AI to present or ask about.

**Scoped/partial clarification rule:** only ask about the slot(s) that are actually missing or ambiguous — never re-ask about a slot the customer already specified and that resolved cleanly. For example, if the customer gave a size that matched fine but no brand, the clarifying question should be narrowed to "which brand?" only, not a generic re-ask about the whole item. This matters once messages contain several items with different amounts of detail per item (see the multi-item stress example in the test categories below) — treating clarification as all-or-nothing produces annoying, redundant questions.

**Response format for scoped clarification — confirm what's resolved, then ask only what's missing:**

```
Customer: عايز لبن جبيته
AI:       تمام، عايز لبن جهينة. حجم ايه؟ في 1 لتر وفي 1.5 لتر
```

This is the target pattern: state what's confirmed, ask only about `missing_slot`, and populate options from the already-narrowed candidate list, never the full unfiltered catalog.

**Important correction from real testing:** this exact example was originally written assuming fuzzy brand-matching alone would catch "جبيته" as a typo of "جهينة." Empirically, it does not — trigram similarity between them scores ~0.17, below the brand-match threshold (0.3), so as currently implemented this falls through to `narrowVariant`'s never-dead-end fallback (showing *all* variants, `missing_slot: "both"`) rather than resolving brand automatically. Severe brand-level typos like this are a known, accepted gap in fuzzy-matching-only brand resolution — closing it is the specific motivation for the planned LLM-assisted second pass (Section 4), not something to fix by loosening the brand threshold (which would risk false positives, per the بيت/زيتون findings from product-name testing).

---

## 4. Matching strategy: name-first short-circuit, alias fallback, variant narrowing

**Implemented — product-level matching:** search `products.name` first via `word_similarity()`. If the top score clears a high-confidence threshold (starting point: `0.8`, tune empirically), return that match immediately without checking aliases at all. If it doesn't clear the threshold, also search `product_aliases`, merge both result sets by `product_id` via a Map keyed by id (keeping the higher score when the same product appears in both), filter out anything below a minimum score floor (`MIN_SCORE = 0.15`, found empirically to be somewhat loose — see caution below), sort, and keep the top few (`MAX_CANDIDATES = 5`). This is what catches genuine typos of the product name itself (لبب → لبن) and synonym/transliteration aliases (حليب, ميلك, طحين) — both are confirmed working via `alias-fallback-test.js`.

**Caution specific to this catalog:** several product names are very short (رز, بيض, شاي — 2-3 characters). Trigram/word-similarity scores on short strings are noisier than on longer ones. Real stress-testing (`typo-severity-test.js`) found genuine false positives at `MIN_SCORE = 0.15` — unrelated real words like "بيت" (house) and "زيتون" (olives, which literally contains "زيت" as a substring) both scored ~0.5, well above the floor. This is an inherent limitation of character-based trigram matching (it measures overlap, not meaning) rather than a bug — worth raising `MIN_SCORE` and re-testing, but note this is never a *safety* issue: everything below `HIGH_CONFIDENCE` only ever produces a clarification candidate, never a silent match, so a false positive here at worst means one unnecessary "did you mean X?" question.

**Implemented — variant-level narrowing (`narrowVariant`):** once a single product is identified, brand and size are narrowed separately: brand is fuzzy-matched in plain JS (small list, no need for a DB round-trip) using the same trigram-similarity technique at a lower threshold (`BRAND_MATCH_THRESHOLD = 0.3`); size is compared as a number directly. **Never-dead-end design decision:** if brand or size text doesn't match anything among the current candidates, that text is discarded rather than treated as a hard filter — the function falls back to whatever candidate set existed before trying it, rather than ever returning `not_found`. `missing_slot` is computed empirically from what's actually still ambiguous among the remaining candidates (distinct brands/sizes still present), not from which fields the customer happened to mention — and can be `"brand"`, `"size"`, or `"both"`. Consequence: `narrowVariant` never returns `not_found` — only `confident_match` or `clarification_needed`. `not_found` as an outcome only applies at the product level (`findProduct` returning zero candidates), see Section 5.

**Known gap, not yet built:** severe brand-level typos (e.g. "جبيته" for "جهينة", ~0.17 similarity) fall below `BRAND_MATCH_THRESHOLD` and are not caught by fuzzy matching alone — see the corrected example in Section 3. The planned fix is an LLM-assisted second pass: alongside the raw extracted text, have the LLM also propose a `likely_correction` guess, run `findProduct`/matching on both, and merge the results using the same `mergeTwoCandidates` pattern already built for name/alias merging. Not yet implemented — to be wired in once `lib/llm.js` exists.

**Implementation gotcha worth remembering:** `node-postgres` returns `NUMERIC` columns as strings, not JS numbers (to avoid floating-point precision loss). Comparing `size` with `===` against a `Number(...)`-converted input silently never matches unless both sides are explicitly converted to numbers first (`Number(v.size) === Number(sizeText)`) — this caused a real bug during development where size filtering appeared to do nothing at all, masked by the never-dead-end fallback quietly keeping every candidate instead of erroring.

---

## 5. JSON output shape

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
        {"product": "لبن", "brand": "جهينة", "size": 1.5, "unit": "L", "price": 22, "score": 0.33},
        {"product": "لبن", "brand": "المراعي", "size": 1.5, "unit": "L", "price": 20, "score": 0.31}
      ]
    },
    {
      "query": "بيض",
      "outcome": "confident_match",
      "matched_variant": {"product": "بيض", "brand": null, "size": null, "unit": null, "price": 3.5}
    }
  ]
}
```

`outcome` is always one of: `confident_match`, `clarification_needed`, `not_found`. **Note on `not_found`'s actual scope, confirmed during implementation:** it only ever applies at the product level — when `findProduct` finds no plausible product at all. Once a product is identified, `narrowVariant` never returns `not_found` (see Section 4's never-dead-end design) — it always resolves to either `confident_match` or `clarification_needed`, falling back to showing all variants rather than dead-ending on a bad brand/size guess. `missing_slot` (only present on `clarification_needed`) names which slot(s) are actually unresolved (`brand`, `size`, or `both`) so the clarifying question can be scoped narrowly instead of re-asking about the whole item. This fixed vocabulary is what makes scoring test cases automatic later (compare `outcome` to each test case's `expected_outcome`) instead of eyeballing free text.

---

## 6. Test case categories (write these before touching AI code)

Aim for 20–30 total messages, covering:
- Clean, correct input (should be `confident_match`)
- Typos (لبب, ميلك — should be `clarification_needed` or `confident_match` depending on how distinctive the typo is)
- Dialect / Arabizi (عايز ٢ كولا, 3ayez lban)
- Genuine ambiguity — one product, multiple brands/sizes available (should be `clarification_needed`)
- Fully specified — product + brand + size in one message (should be `confident_match`, no question asked)
- Multiple items in one message (لبن وبيض وعيش — each item scored independently)
- Multi-item stress test with varying detail per item, exercising scoped/partial clarification (e.g. "عايز لبب 1 لتر و 3 بيضات و رز المنار و دقيق المنار 1 كيلو" — one item needs only a brand clarification despite giving size, one is a clean multi-slot match, one only has product+brand with size still missing, one is a plural form of a known product)
- Plural/morphological variation of a known product (بيضات for بيض) — distinct from typos or dialect synonyms, worth confirming trigram similarity handles this correctly rather than assuming it
- Normalization-variant spelling of a known product name (e.g. شاى vs شاي, جبنه vs جبنة) — should score ~1.0 after normalization; if it doesn't, that's a normalization bug, not a fuzzy-matching tuning issue
- False-positive sanity check — a clearly unrelated word (e.g. موبايل) should never match anything, regardless of threshold; useful for catching an overly loose threshold especially given several very short product names in this catalog
- Out-of-catalog item (e.g. بيبسي if not stocked — should be `not_found`, not a forced bad match)

Each test case: `{ "input": "...", "expected_outcome": "confident_match" | "clarification_needed" | "not_found" }`

---

## 7. Build order (do not reorder — each step should work in isolation before the next)

1. Schema + seed script (15–20 real products, Arabic names, manual aliases) → verify data by eye in a DB GUI.
2. Normalization function + fuzzy search (`word_similarity` query), tested directly with hardcoded strings — **no AI yet**.
3. `search_products` tool wired to the LLM (tool-calling loop) — test manually with one or two live messages.
4. Test runner — loop over the written test cases, print JSON, auto-compare `outcome` vs `expected_outcome`.
5. Read the results and judge quality — this is the actual point of the prototype.

---

*This note consolidates decisions made across the planning conversation. It intentionally omits cart/order/delivery/multi-store/admin concerns — those live in the separate SRS/HLD documents for the full MVP, which remain valid for later phases.*