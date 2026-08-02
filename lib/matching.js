const pool = require("../db/pool");

function normalizeArabic(text) {
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim()
    .toLowerCase();
}

function safeNormalize(text) {
  return text == null ? text : normalizeArabic(text);
}

const HIGH_CONFIDENCE = 0.8; // short-circuit threshold — tune once you see real test results
const MIN_SCORE = 0.15; // floor for the fallback list — below this, don't show it to the customer at all
const MAX_CANDIDATES = 5; // don't overwhelm the customer with more than this many options

async function findProduct(rawQuery) {
  const normalizedQuery = normalizeArabic(rawQuery);

  // Step 1: check the product name directly first
  const nameMatch = await pool.query(
    `SELECT id, name, word_similarity($1, name) AS score
     FROM products
     WHERE $1 % name
     ORDER BY score DESC`,
    [normalizedQuery],
  );

  // Short-circuit: if the top name match is already very confident, skip the alias
  // query entirely — it couldn't produce a better answer than one we're already sure of.
  // Wrapped in [] so the return type is ALWAYS an array, regardless of which path runs.
  if (nameMatch.rows.length && nameMatch.rows[0].score >= HIGH_CONFIDENCE) {
    return [nameMatch.rows[0]];
  }

  // Step 2: not confident enough from the name alone — also check aliases
  const aliasMatch = await pool.query(
    `SELECT p.id, p.name, word_similarity($1, pa.alias_text) AS score
     FROM product_aliases pa
     JOIN products p ON p.id = pa.product_id
     WHERE $1 % pa.alias_text
     ORDER BY score DESC`,
    [normalizedQuery],
  );

  const candidates = mergeTwoCandidates(nameMatch.rows, aliasMatch.rows);

  return candidates;
}

async function closeConnections() {
  await pool.end();
}

function mergeTwoCandidates(first, second) {
  const merged = new Map();

  for (const row of [...first, ...second]) {
    const existing = merged.get(row.id);
    if (!existing || row.score > existing.score) {
      merged.set(row.id, row);
    }
  }

  const candidates = [...merged.values()]
    .filter((row) => row.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  return candidates;
}

async function narrowVariant(productId, brandText, sizeText) {
  const allVariants = await getVariantsForProduct(productId);

  let candidates = allVariants;

  if (brandText) {
    const brandFiltered = fuzzyMatchBrand(allVariants, brandText);
    // If the brand text didn't match anything, don't dead-end — fall back to
    // showing every variant for this product instead of returning not_found.
    if (brandFiltered.length > 0) {
      candidates = brandFiltered;
    }
  }

  if (sizeText != null) {
    const sizeFiltered = candidates.filter(
      (v) => Number(v.size) === Number(sizeText),
    );
    // Same principle: if size text didn't match anything among current
    // candidates, don't lose information — keep whatever we had before trying it.
    if (sizeFiltered.length > 0) {
      candidates = sizeFiltered;
    }
  }

  if (candidates.length === 1) {
    return { outcome: "confident_match", variant: candidates[0] };
  }

  // Still ambiguous (or brand/size text didn't help) — figure out WHICH slot(s)
  // actually remain unresolved, based on what's still varying among the candidates.
  const distinctBrands = new Set(candidates.map((v) => v.brand));
  const distinctSizes = new Set(candidates.map((v) => v.size));

  const brandUnresolved = distinctBrands.size > 1;
  const sizeUnresolved = distinctSizes.size > 1;

  let missingSlot;
  if (brandUnresolved && sizeUnresolved) {
    missingSlot = "both";
  } else if (brandUnresolved) {
    missingSlot = "brand";
  } else {
    missingSlot = "size";
  }

  return {
    outcome: "clarification_needed",
    missing_slot: missingSlot,
    candidates,
  };
}

async function getVariantsForProduct(productId) {
  const result = await pool.query(
    `SELECT id, brand, size, unit, price
     FROM product_variants
     WHERE product_id = $1`,
    [productId],
  );
  return result.rows;
}

// Same trigram-overlap idea as pg_trgm's word_similarity, just done in plain JS
// since we're comparing against a small, already-narrowed list — no need for
// a database round-trip here.
function trigrams(str) {
  const padded = `  ${str}  `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function trigramSimilarity(a, b) {
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  let intersection = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) intersection++;
  }
  const union = gramsA.size + gramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const BRAND_MATCH_THRESHOLD = 0.3; // lower bar than product matching — brand list is already tiny and narrowed

function fuzzyMatchBrand(variants, brandText) {
  const normalizedBrandText = normalizeArabic(brandText);

  return variants.filter((v) => {
    if (v.brand == null) return false; // no brand on this variant, can't match against it
    const score = trigramSimilarity(
      normalizedBrandText,
      normalizeArabic(v.brand),
    );
    return score >= BRAND_MATCH_THRESHOLD;
  });
}

module.exports = {
  normalizeArabic,
  safeNormalize,
  findProduct,
  closeConnections,
  mergeTwoCandidates,
  trigramSimilarity, // exported so you can test it directly, same pattern as normalizeArabic
  fuzzyMatchBrand,
  getVariantsForProduct,
  narrowVariant,
};
