const { searchProducts, closeConnections } = require("./lib/matching");

async function main() {
  const tests = [
    // --- brand_not_applicable: بيض has no brand distinction at all ---
    {
      args: ["بيض", "جهينة", null],
      note: "brand given for a product with no brands — expect notes: ['brand_not_applicable']",
    },

    // --- size_not_applicable: بيض also has no size distinction ---
    {
      args: ["بيض", null, 1],
      note: "size given for a product with no size — expect notes: ['size_not_applicable']",
    },

    // --- both at once ---
    {
      args: ["بيض", "جهينة", 1],
      note: "both brand and size given, neither applies — expect notes with BOTH entries",
    },

    // --- sanity: plain بيض with nothing extra should have NO notes field at all ---
    {
      args: ["بيض", null, null],
      note: "nothing extra given — expect confident_match with no notes field",
    },

    // --- same pattern for other no-brand/no-size products in the catalog ---
    {
      args: ["عيش", "جهينة", null],
      note: "brand given for bread (uses بلدي/فينو as its own 'brand' field though — check this doesn't misfire)",
    },
    {
      args: ["شاي", "ليبتون", null],
      note: "شاي's one variant HAS a real brand (ليبتون) — brand should apply normally here, NOT trigger brand_not_applicable",
    },

    // --- the product_ambiguous downgrade fix: weak product match + single variant should NOT auto-confirm ---
    {
      args: ["بيت", "جهينة", null],
      note: "weak match to بيض via coincidence — expect product_ambiguous, NOT confident_match",
    },
    {
      args: ["بيت", null, null],
      note: "same weak match, no brand at all — still expect product_ambiguous",
    },

    // --- confirm the fix doesn't over-trigger on GENUINE confident matches ---
    {
      args: ["بيض", null, null],
      note: "exact match — should still short-circuit to real confident_match, not get caught by the guard",
    },
    {
      args: ["لبن", "جهينة", 1],
      note: "exact product + real brand + real size — should remain confident_match",
    },
  ];

  for (const t of tests) {
    const result = await searchProducts(...t.args);
    console.log(`\nsearchProducts(${JSON.stringify(t.args)}) — ${t.note}`);
    console.log(JSON.stringify(result, null, 2));
  }

  await closeConnections();
}

main();
