const {
  findProduct,
  narrowVariant,
  getVariantsForProduct,
  fuzzyMatchBrand,
  closeConnections,
} = require("./lib/matching");

async function main() {
  // First, get real product ids to test against — don't hardcode ids from memory,
  // look them up fresh each time in case the catalog ever changes.
  const [milk] = await findProduct("لبن");
  const [rice] = await findProduct("رز");
  const [eggs] = await findProduct("بيض");

  console.log("\n--- getVariantsForProduct ---");
  console.log("لبن variants:", await getVariantsForProduct(milk.id));
  console.log("بيض variants:", await getVariantsForProduct(eggs.id));

  console.log("\n--- fuzzyMatchBrand ---");
  const milkVariants = await getVariantsForProduct(milk.id);
  console.log("brand 'جهينة' (exact):", fuzzyMatchBrand(milkVariants, "جهينة"));
  console.log(
    "brand 'جهينه' (ة/ه variant):",
    fuzzyMatchBrand(milkVariants, "جهينه"),
  );
  console.log("brand 'جبيته' (typo):", fuzzyMatchBrand(milkVariants, "جبيته"));
  console.log(
    "brand 'بيبسي' (unrelated brand, shouldn't match):",
    fuzzyMatchBrand(milkVariants, "بيبسي"),
  );

  console.log("\n--- narrowVariant: full scenarios ---");

  console.log("\nملك + جهينة + 1 (should be confident_match):");
  console.log(await narrowVariant(milk.id, "جهينة", "1"));

  console.log(
    "\nلبن + جهينة, no size (should be clarification_needed, missing_slot: size):",
  );
  console.log(await narrowVariant(milk.id, "جهينة", null));

  console.log(
    "\nلبن, no brand, no size (should be clarification_needed, missing_slot: both):",
  );
  console.log(await narrowVariant(milk.id, null, null));

  console.log(
    "\nلبن + typo'd brand 'جبيته' + 1.5 (should still resolve via fuzzy brand match):",
  );
  console.log(await narrowVariant(milk.id, "جبيته", "1.5"));

  console.log(
    "\nلبن + nonsense brand 'بيبسي' (should fall back to showing ALL variants, not dead-end):",
  );
  console.log(await narrowVariant(milk.id, "بيبسي", null));

  console.log(
    "\nرز + المنار, no size (should be clarification_needed, missing_slot: size):",
  );
  console.log(await narrowVariant(rice.id, "المنار", null));

  console.log(
    "\nبيض, no brand, no size (single variant, no brand at all — should be confident_match):",
  );
  console.log(await narrowVariant(eggs.id, null, null));

  await closeConnections();
}

main();
