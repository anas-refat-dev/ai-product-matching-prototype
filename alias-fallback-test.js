const { findProduct, closeConnections } = require("./lib/matching");

async function main() {
  const tests = [
    // --- Alias-only words — genuinely different words for the same product, NOT catchable
    // by normalization or fuzzy typo-matching against the product name alone. These only
    // resolve correctly if product_aliases is actually being searched and merged in. ---
    { input: "حليب", note: "MSA word for milk, alias of لبن" },
    { input: "ميلك", note: "transliterated English 'milk', alias of لبن" },
    { input: "طحين", note: "common synonym, alias of دقيق" },
    { input: "أرز", note: "MSA spelling variant, alias of رز" },
    {
      input: "معكرونة",
      note: "alt spelling with extra م prefix, alias of مكرونة",
    },
    { input: "خبز", note: "MSA word for bread, alias of عيش" },
    { input: "بيضه", note: "spelling variant, alias of بيض" },
    { input: "gebna", note: "Latin transliteration, alias of جبنة" },
    { input: "tea", note: "English word, alias of شاي" },
    { input: "sokkar", note: "Latin transliteration, alias of سكر" },

    // --- Sanity check: a word that isn't an alias of anything, shouldn't match ---
    {
      input: "موبايل",
      note: "not in catalog or aliases at all — should return empty",
    },
  ];

  for (const t of tests) {
    const result = await findProduct(t.input);
    console.log(`\n"${t.input}" (${t.note})`);
    console.log(result);
  }

  await closeConnections();
}

main();
