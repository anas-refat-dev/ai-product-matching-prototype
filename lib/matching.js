const pool = require("../db/pool");

function normalizeArabic(text) {
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim()
    .toLowerCase();
  // consider: should this also trim/lowercase for the Latin alias cases (ميلك vs english mixed)?
}

function safeNormalize(text) {
  return text == null ? text : normalizeArabic(text);
}

function searchForCandates(rawQuery) {}

async function findProduct(rawQuery) {
  const normalizedQuery = normalizeArabic(rawQuery);

  const nameMatch = await pool.query(
    `SELECT id, name, word_similarity($1, name) AS score
     FROM products
     WHERE $1 % name
     ORDER BY score DESC LIMIT 1`,
    [normalizedQuery],
  );

  // await pool.end();

  const HIGH_CONFIDENCE = 0.8; // tune this once you see real test results — start conservative given short product names

  if (nameMatch.rows.length && nameMatch.rows[0].score >= HIGH_CONFIDENCE) {
    return nameMatch.rows[0]; // confirmed, skip alias check entirely
  }

  return "not found";
  // otherwise, fall through to also checking aliases and merging, as discussed before
  // ...
}

async function closeConnections() {
  await pool.end();
}

module.exports = {
  safeNormalize,
  findProduct,
  searchForCandates,
  closeConnections,
};
