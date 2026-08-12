const { Pool } = require("pg");
const fs = require("node:fs");

function createPool(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is required for PostgreSQL");
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 3000),
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000),
    application_name: "order-reference-service",
    ssl:
      process.env.DB_SSL === "true"
        ? {
            rejectUnauthorized: true,
            ...(process.env.DATABASE_SSL_CA_PATH
              ? {
                  ca: fs.readFileSync(process.env.DATABASE_SSL_CA_PATH, "utf8"),
                }
              : process.env.DB_SSL_CA
                ? { ca: process.env.DB_SSL_CA.replaceAll("\\n", "\n") }
                : {}),
          }
        : false,
    ...options,
  });
  // Idle clients can emit asynchronous errors when PostgreSQL restarts. Keep
  // the process alive so readiness returns 503 and pg-pool can reconnect on
  // the next query instead of terminating the API on an unhandled event.
  pool.on("error", () => {});
  return pool;
}

module.exports = { createPool };
