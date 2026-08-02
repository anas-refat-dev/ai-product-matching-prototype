const { findProduct, closeConnections } = require("./lib/matching");

async function main() {
  const tests = [
    // Exact matches — should all score 1, confirm short-circuit works across the whole catalog
    { input: "بيض", expect: "exact match, score ~1" },
    { input: "زيت", expect: "exact match, score ~1" },
    { input: "دقيق", expect: "exact match, score ~1" },
    { input: "جبنة", expect: "exact match, score ~1" },

    // Normalization variants — different spelling, same word after normalizeArabic, should still score ~1
    {
      input: "شاى",
      expect: "matches شاي via alef maksura normalization, score ~1",
    },
    {
      input: "جبنه",
      expect: "matches جبنة via taa marbuta normalization, score ~1",
    },

    // Real typos of the PRODUCT NAME itself (not aliases) — currently expected to return "not found",
    // since only the high-confidence short-circuit is built; these are candidates for the fuzzy fallback later
    { input: "دقيقي", expect: "not found (typo, no fallback yet)" },
    { input: "زيد", expect: "not found (typo of زيت, no fallback yet)" },

    // Alias-only words — genuinely different words for the same product, NOT caught by normalization
    // or fuzzy typo-matching at all — these should currently ALWAYS be "not found" until alias
    // fallback is built, regardless of threshold tuning
    { input: "حليب", expect: "not found (alias, needs alias table lookup)" },
    { input: "طحين", expect: "not found (alias of دقيق)" },
    { input: "أرز", expect: "not found (alias of رز)" },
    { input: "معكرونة", expect: "not found (alias of مكرونة, extra م prefix)" },

    // A word that shouldn't match anything at all — sanity check for false positives
    { input: "موبايل", expect: "not found (not in catalog, unrelated word)" },
  ];

  for (const t of tests) {
    const result = await findProduct(t.input);
    console.log(`${t.input} → expected: ${t.expect} → got:`, result);
  }
  await closeConnections();
}

main();
