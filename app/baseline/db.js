const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_PATH = path.join(process.cwd(), "baseline-data", "orders.sqlite");
const SCHEMA_VERSION = 2;

function openDatabase(filePath = process.env.ORDER_DB_PATH || DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price_minor_units INTEGER NOT NULL CHECK (price_minor_units > 0), currency TEXT NOT NULL CHECK (length(currency) = 3));
    CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, customer_reference TEXT NOT NULL, status TEXT NOT NULL, total_minor_units INTEGER NOT NULL CHECK (total_minor_units >= 0 AND total_minor_units <= 10000000), currency TEXT NOT NULL, idempotency_key TEXT NOT NULL, principal TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(principal, idempotency_key));
    CREATE TABLE IF NOT EXISTS order_lines (order_id TEXT NOT NULL REFERENCES orders(order_id), sku TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100), unit_price_minor_units INTEGER NOT NULL, currency TEXT NOT NULL, line_total_minor_units INTEGER NOT NULL, PRIMARY KEY(order_id, sku));
    CREATE TABLE IF NOT EXISTS schema_metadata (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency_records (principal TEXT NOT NULL, endpoint TEXT NOT NULL, key_digest TEXT NOT NULL, payload_hash TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES orders(order_id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(principal, endpoint, key_digest));
    CREATE TABLE IF NOT EXISTS report_jobs (job_id TEXT PRIMARY KEY, principal TEXT NOT NULL, status TEXT NOT NULL, filters_json TEXT NOT NULL, format TEXT NOT NULL, result_json TEXT, error_code TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS report_outbox (event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES report_jobs(job_id), correlation_id TEXT NOT NULL, traceparent TEXT, published_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_principal_page ON orders(principal, created_at DESC, order_id DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_admin_page ON orders(created_at DESC, order_id DESC);
    CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_records(expires_at);
  `);
  const metadata = db
    .prepare("SELECT version FROM schema_metadata WHERE singleton = 1")
    .get();
  if (!metadata)
    db.prepare(
      "INSERT INTO schema_metadata (singleton, version) VALUES (1, ?)",
    ).run(SCHEMA_VERSION);
  else if (metadata.version !== SCHEMA_VERSION)
    throw new Error("incompatible database schema");
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

module.exports = { DEFAULT_PATH, SCHEMA_VERSION, openDatabase, seedProducts };
