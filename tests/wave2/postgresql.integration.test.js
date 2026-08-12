const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createPool } = require("../../app/postgresql");
const { migrate } = require("../../scripts/postgresql/migrate");
const { PostgresqlRepository } = require("../../app/repositories/postgresql");
const { createOrderService } = require("../../app/baseline/service");
const { cursorCodec } = require("../../app/core/cursor");
const { createOutboxPublisher } = require("../../app/outbox-publisher");
const { createReportWorker } = require("../../app/report-worker");
const {
  LocalReportQueue,
  LocalArtifactStore,
} = require("../../app/ports/reporting");

const enabled = Boolean(process.env.TEST_DATABASE_URL);
test(
  "PostgreSQL empty migration, parity, idempotency, transitions, and readiness",
  { skip: !enabled },
  async () => {
    const schema = `wave2_${crypto.randomUUID().replaceAll("-", "")}`;
    const administration = createPool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await administration.query(`CREATE SCHEMA ${schema}`);
    const connectionString = `${process.env.TEST_DATABASE_URL}${process.env.TEST_DATABASE_URL.includes("?") ? "&" : "?"}options=-csearch_path%3D${schema}`;
    const pool = createPool({ connectionString, max: 12 });
    try {
      await pool.query(
        "CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
      );
      await pool.query("INSERT INTO schema_migrations (version) VALUES (0)");
      await migrate(pool);
      await migrate(pool);
      const repository = new PostgresqlRepository(pool);
      assert.equal(await repository.ready(), true);
      const service = createOrderService({
        repository,
        cursorCodec: cursorCodec("postgresql-test-cursor-signing-secret-123"),
      });
      const identity = { subject: "operator-a", roles: ["operator"] };
      const body = {
        customerReference: "postgres-opaque",
        lineItems: [{ sku: "DEMO-DATA-002", quantity: 1 }],
      };
      const results = await Promise.all(
        Array.from({ length: 16 }, () =>
          service.createOrder(body, "same-secret-key", identity),
        ),
      );
      assert.equal(results.filter((result) => !result.replayed).length, 1);
      assert.equal(
        new Set(results.map((result) => result.order.orderId)).size,
        1,
      );
      await assert.rejects(
        service.createOrder(
          { ...body, customerReference: "postgres-different" },
          "same-secret-key",
          identity,
        ),
        (error) => error.status === 409,
      );
      const orderId = results[0].order.orderId;
      const transitions = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          service.transition(orderId, "CONFIRMED", identity),
        ),
      );
      assert.equal(
        transitions.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        transitions.filter((result) => result.status === "rejected").length,
        7,
      );
      const job = await service.createReportJob(
        { status: "CONFIRMED", createdFrom: null, createdTo: null },
        "json",
        { subject: "admin", roles: ["admin"] },
        { correlationId: "pg-integration", traceparent: null },
      );
      const queue = new LocalReportQueue();
      const artifactStore = new LocalArtifactStore();
      assert.equal(
        await createOutboxPublisher({ repository, queue }).runOnce(),
        1,
      );
      assert.equal(
        await createReportWorker({
          repository,
          queue,
          artifactStore,
        }).runOnce(),
        true,
      );
      assert.equal(
        (await repository.getReportJob(job.jobId, "admin")).status,
        "SUCCEEDED",
      );
      const digest = await pool.query(
        "SELECT key_digest FROM idempotency_records",
      );
      assert.match(digest.rows[0].key_digest, /^[0-9a-f]{64}$/);
      await pool.query(
        "UPDATE schema_migrations SET version = 999 WHERE version = 1",
      );
      assert.equal(await repository.ready(), false);
      const unavailablePool = createPool({
        connectionString:
          "postgresql://postgres:unused@127.0.0.1:1/unavailable",
        connectionTimeoutMillis: 100,
      });
      assert.equal(
        await new PostgresqlRepository(unavailablePool).ready(),
        false,
      );
      await unavailablePool.end();
    } finally {
      await pool.end();
      await administration.query(`DROP SCHEMA ${schema} CASCADE`);
      await administration.end();
    }
  },
);
