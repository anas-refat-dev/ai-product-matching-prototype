require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const pool = require("./pool.js");
const catalog = require("./catalog-data.js");
const { safeNormalize } = require("../lib/matching.js");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema applied.");

  for (const product of catalog) {
    const result = await pool.query(
      "INSERT INTO products (name) VALUES ($1) RETURNING id",
      [safeNormalize(product.name)],
    );
    const productId = result.rows[0].id;

    for (const alias of product.aliases) {
      await pool.query(
        "INSERT INTO product_aliases (product_id, alias_text) VALUES ($1, $2)",
        [productId, safeNormalize(alias)],
      );
    }

    for (const variant of product.variants) {
      await pool.query(
        "INSERT INTO product_variants (product_id, brand, size, unit, price) VALUES ($1, $2, $3, $4, $5)",
        [
          productId,
          safeNormalize(variant.brand),
          variant.size,
          safeNormalize(variant.unit),
          variant.price,
        ],
      );
    }
  }

  console.log(`Seeded ${catalog.length} products.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Error setting up database:", err);
  process.exit(1);
});
