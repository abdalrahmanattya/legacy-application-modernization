const fs = require("node:fs");
const path = require("node:path");
const { createPool } = require("../../app/postgresql");

async function migrate(pool = createPool()) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(746792301)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    const applied = new Set(
      (await client.query("SELECT version FROM schema_migrations")).rows.map(
        (row) => row.version,
      ),
    );
    const directory = path.join(process.cwd(), "migrations", "postgresql");
    for (const file of fs.readdirSync(directory).sort()) {
      const match = file.match(/^(\d+)_.*\.sql$/);
      if (!match || applied.has(Number(match[1]))) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(directory, file), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(746792301)");
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  let pool;
  Promise.resolve()
    .then(() => {
      const { readRuntimeConfig } = require("../../app/runtime/config");
      const config = readRuntimeConfig("migration");
      pool = createPool({
        connectionString: config.databaseUrl,
        max: 1,
        connectionTimeoutMillis: config.databaseConnectTimeoutMs,
        statement_timeout: config.databaseStatementTimeoutMs,
        ssl: config.databaseSsl,
      });
      return migrate(pool);
    })
    .then(() => process.stdout.write("PostgreSQL migrations applied\n"))
    .catch(() => {
      process.stderr.write("PostgreSQL migration failed\n");
      process.exitCode = 1;
    })
    .finally(() => pool?.end());
}

module.exports = { migrate };
