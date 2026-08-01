# ai-product-matching-prototype

A narrow prototype testing one specific question: **can an LLM reliably map messy, typo'd, dialect Arabic customer text to real products in a database?**

This is deliberately *not* a full ordering app. No cart, no order creation, no delivery, no multi-store support, no admin UI. Just: message in → structured JSON showing what was understood and matched → out. If this doesn't work well, nothing built on top of it will either — so this gets proven first.

## What this tests

Given a message like `"عايز لبب و بيض"`, the system should:
1. Correctly split it into separate item mentions (لبب, بيض)
2. Fuzzy-match each against the real product catalog, tolerating typos and dialect
3. Return a confident match, ask a scoped clarifying question, or honestly report "not found" — never guess silently or invent a product that doesn't exist

Full design rationale (schema, tool definition, normalization rules, output format) is in [`design-note.md`](./design-note.md).

## Tech stack

- **Node.js** (18+)
- **PostgreSQL** with the `pg_trgm` extension (fuzzy/trigram text matching), installed natively (not via Docker)
- **Anthropic API** (Claude, via tool/function calling) for extracting structured intent from raw customer text

> Note: since Postgres is installed natively rather than in a container, it runs as a persistent system service in the background (`sudo systemctl status postgresql` to check, `stop`/`start` to pause/resume it).

## Project structure

```
ai-product-matching-prototype/
├── db/
│   ├── schema.sql        # products, product_variants, product_aliases
│   └── seed.js           # populates a small real catalog for testing
├── lib/
│   ├── matching.js        # normalization + fuzzy search against real catalog
│   └── llm.js             # tool-calling loop: raw text -> structured search calls
├── test-cases.json        # ~25 real test messages with expected outcomes
├── run-tests.js           # runs all test cases, prints JSON, scores pass/fail
├── design-note.md         # full design decisions and reasoning
└── README.md
```

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Install PostgreSQL natively (Ubuntu) — postgresql-contrib includes pg_trgm
sudo apt update
sudo apt install postgresql postgresql-contrib

# 3. Make sure it's running
sudo systemctl status postgresql
# if not running: sudo systemctl start postgresql

# 4. Set a password for the postgres user, then create the database
sudo -u postgres psql
#   inside psql:
#   ALTER USER postgres WITH PASSWORD 'devpassword';
#   CREATE DATABASE grocery_proto;
#   \c grocery_proto
#   CREATE EXTENSION IF NOT EXISTS pg_trgm;
#   \q

# 5. Copy .env.example to .env and fill in your values
cp .env.example .env
# then edit .env: add your ANTHROPIC_API_KEY and DATABASE_URL
# DATABASE_URL=postgresql://postgres:devpassword@localhost:5432/grocery_proto

# 6. Sanity check pg_trgm is enabled
psql -U postgres -h localhost -d grocery_proto -c "SELECT extname FROM pg_extension;"
# should list pg_trgm alongside plpgsql

# 7. Seed the database
node db/seed.js
```

## Running the tests

```bash
node run-tests.js
```

Prints each test case's input, extracted items, matched outcome, and whether it matched the expected outcome from `test-cases.json`.

## Results

*(To fill in once the test suite has actually been run — this is the part that matters most.)*

- [ ] Overall pass rate against expected outcomes: __ / __
- [ ] Known failure cases and why (matching bug vs. extraction bug vs. missing alias):
- [ ] Cases that need a new alias added:
- [ ] Any surprising behavior worth noting:

## Status

🚧 In progress — environment setup phase.

## Related documents

- [`design-note.md`](./design-note.md) — schema, tool definitions, normalization rules, test case categories