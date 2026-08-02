const { findProduct, closeConnections } = require("./lib/matching");

async function main() {
  const tests = [
    // --- Mild typos (1 character off) — should still match reasonably well ---
    { input: "لبن", note: "baseline, no typo, for comparison" },
    { input: "لبم", note: "1 char swap (ن→م) — mild" },

    // --- Moderate typos (2+ characters off, or letters dropped/reordered) ---
    { input: "لببب", note: "extra letter, moderate" },
    { input: "نبل", note: "letters reordered — same letters, wrong order" },
    { input: "دقق", note: "middle letter dropped from دقيق" },
    { input: "زي", note: "زيت with the ت dropped entirely — very short now" },

    // --- Severe typos — barely resembles the original, testing the real limit ---
    {
      input: "لكن",
      note: "shares only 1 letter with لبن, looks nothing alike to a human either",
    },
    { input: "دفيق", note: "2 of 4 letters changed from دقيق" },
    { input: "شاعي", note: "extra letter inserted into شاي" },

    // --- Genuinely different words that happen to share some letters — should NOT match ---
    {
      input: "بيت",
      note: "means 'house' — shares letters with بيض but is a real unrelated word",
    },
    {
      input: "زيتون",
      note: "means 'olives' — contains زيت as a substring, but is a different product entirely",
    },

    // --- Completely unrelated, sanity check repeated with a different word ---
    {
      input: "كمبيوتر",
      note: "computer — should return empty, same as موبايل before",
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
