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

module.exports = {
  normalizeArabic,
  safeNormalize,
  findProduct,
  closeConnections,
  mergeTwoCandidates,
};
