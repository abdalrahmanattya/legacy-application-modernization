const { createPool } = require("../../app/postgresql");
const { PostgresqlRepository } = require("../../app/repositories/postgresql");
const { createServer } = require("../../app/baseline/server");
const { localAuthenticator } = require("../../app/auth/local");

const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 8 });
const repository = new PostgresqlRepository(pool);
const authenticator = localAuthenticator({
  "operator-a": process.env.WAVE3_TOKEN || "wave3-local-token",
});
const server = createServer({
  repository,
  authenticator,
  cursorSecret: "wave3-local-cursor-secret-012345678901234567890123456789",
  logger: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.shutdown().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
server.listen(Number(process.env.PORT), "127.0.0.1", () =>
  process.stdout.write(`WAVE3_READY ${process.env.PORT}\n`),
);
