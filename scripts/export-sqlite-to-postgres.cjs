/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dbPath =
  process.argv[2] || process.env.JEFF_ORDER_DB_PATH || path.join("data", "orders.db");
const outPath =
  process.argv[3] || path.join("data", "jeff-order-postgres-import.sql");

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(table, row) {
  const columns = Object.keys(row);

  return `INSERT INTO ${quoteIdent(table)} (${columns
    .map(quoteIdent)
    .join(", ")}) VALUES (${columns.map((key) => sqlValue(row[key])).join(", ")});`;
}

function tableExists(database, table) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

if (!fs.existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const lines = [
  "-- Jeff Order Tool SQLite to PostgreSQL import script",
  "-- Review before running on a production database.",
  "BEGIN;",
  "",
  `CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  company_name TEXT,
  factory_name TEXT,
  first_delivery TEXT,
  request_suit_quantity INTEGER NOT NULL DEFAULT 0,
  request_jacket_quantity INTEGER NOT NULL DEFAULT 0,
  request_pant_quantity INTEGER NOT NULL DEFAULT 0,
  request_vest_quantity INTEGER NOT NULL DEFAULT 0,
  request_coat_quantity INTEGER NOT NULL DEFAULT 0,
  delivery_request_date TEXT,
  delivery_request_note TEXT,
  delivery_request_updated_at TEXT,
  customer_name TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  suit_quantity INTEGER NOT NULL DEFAULT 0,
  jacket_quantity INTEGER NOT NULL DEFAULT 0,
  pant_quantity INTEGER NOT NULL DEFAULT 0,
  vest_quantity INTEGER NOT NULL DEFAULT 0,
  coat_quantity INTEGER NOT NULL DEFAULT 0,
  extra_fee INTEGER NOT NULL DEFAULT 0,
  registered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  written_off_at TEXT,
  returned_at TEXT,
  return_note TEXT,
  return_suit_quantity INTEGER NOT NULL DEFAULT 0,
  return_jacket_quantity INTEGER NOT NULL DEFAULT 0,
  return_pant_quantity INTEGER NOT NULL DEFAULT 0,
  return_vest_quantity INTEGER NOT NULL DEFAULT 0,
  return_coat_quantity INTEGER NOT NULL DEFAULT 0,
  urgency TEXT NOT NULL DEFAULT 'NORMAL',
  partial_quantity INTEGER,
  partial_date TEXT,
  partial_note TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  "",
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_suit_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_jacket_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_pant_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_vest_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_coat_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_request_date TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_request_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_request_updated_at TEXT;`,
  "",
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_company_code_unique
ON orders (lower(trim(coalesce(company_name, ''))), lower(trim(code)));`,
  "",
  `CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);`,
  "",
  `CREATE TABLE IF NOT EXISTS order_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  delivered_at TEXT NOT NULL,
  suit_quantity INTEGER NOT NULL DEFAULT 0,
  jacket_quantity INTEGER NOT NULL DEFAULT 0,
  pant_quantity INTEGER NOT NULL DEFAULT 0,
  vest_quantity INTEGER NOT NULL DEFAULT 0,
  coat_quantity INTEGER NOT NULL DEFAULT 0,
  uncategorized_quantity INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'STRUCTURED',
  created_at TEXT NOT NULL
);`,
  "",
  "TRUNCATE TABLE order_events;",
  "TRUNCATE TABLE order_deliveries;",
  "TRUNCATE TABLE orders CASCADE;",
  "",
];

for (const row of db.prepare("SELECT * FROM orders ORDER BY created_at").all()) {
  lines.push(insertSql("orders", row));
}

lines.push("");

if (tableExists(db, "order_deliveries")) {
  for (const row of db
    .prepare("SELECT * FROM order_deliveries ORDER BY created_at")
    .all()) {
    lines.push(insertSql("order_deliveries", row));
  }
}

lines.push("");

for (const row of db.prepare("SELECT * FROM order_events ORDER BY created_at").all()) {
  lines.push(insertSql("order_events", row));
}

lines.push("", "COMMIT;", "");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
db.close();

console.log(`PostgreSQL import SQL written to ${outPath}`);
