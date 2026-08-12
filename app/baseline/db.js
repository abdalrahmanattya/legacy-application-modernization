const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_PATH = path.join(process.cwd(), "baseline-data", "orders.sqlite");

function openDatabase(filePath = process.env.ORDER_DB_PATH || DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price_minor_units INTEGER NOT NULL CHECK (price_minor_units > 0), currency TEXT NOT NULL CHECK (length(currency) = 3));
    CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, customer_reference TEXT NOT NULL, status TEXT NOT NULL, total_minor_units INTEGER NOT NULL CHECK (total_minor_units >= 0 AND total_minor_units <= 10000000), currency TEXT NOT NULL, idempotency_key TEXT NOT NULL, principal TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(principal, idempotency_key));
    CREATE TABLE IF NOT EXISTS order_lines (order_id TEXT NOT NULL REFERENCES orders(order_id), sku TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100), unit_price_minor_units INTEGER NOT NULL, currency TEXT NOT NULL, line_total_minor_units INTEGER NOT NULL, PRIMARY KEY(order_id, sku));
  `);
  return db;
}

function seedProducts(db) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO products (sku, name, price_minor_units, currency) VALUES (?, ?, ?, ?)",
  );
  for (const product of [
    ["DEMO-PLATFORM-001", "Platform Foundations Workshop", 12500, "USD"],
    ["DEMO-DATA-002", "Data Pipeline Review", 9000, "USD"],
    ["DEMO-AI-003", "Applied AI Architecture Session", 15000, "USD"],
  ])
    insert.run(...product);
}

module.exports = { DEFAULT_PATH, openDatabase, seedProducts };
