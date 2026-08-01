require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./pool.js");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema applied.");

  // seed data insertion goes here next — nothing yet, intentionally

  await pool.end();
}

main().catch((err) => {
  console.error("Error setting up database:", err);
  process.exit(1);
});
