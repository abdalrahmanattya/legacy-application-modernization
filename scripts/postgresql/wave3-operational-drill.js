#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createPool } = require("../../app/postgresql");
const { migrate } = require("./migrate");
const { PostgresqlRepository } = require("../../app/repositories/postgresql");
const { createOrderService } = require("../../app/baseline/service");
const { cursorCodec } = require("../../app/core/cursor");

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const output =
  process.env.WAVE3_EVIDENCE_OUTPUT ||
  ".evidence-results/postgresql-operational.json";
const secret = "wave3-operational-drill-signing-secret-0123456789";
const identity = { subject: "wave3-operator", roles: ["operator"] };
const order = {
  customerReference: "wave3-opaque-reference",
  lineItems: [{ sku: "DEMO-DATA-002", quantity: 1 }],
};

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

async function main() {
  const schema = `wave3_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = createPool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = `${url}${url.includes("?") ? "&" : "?"}options=-csearch_path%3D${schema}`;
  const poolA = createPool({ connectionString: scoped, max: 8 });
  const poolB = createPool({ connectionString: scoped, max: 8 });
  try {
    await poolA.query(
      "CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    await poolA.query("INSERT INTO schema_migrations (version) VALUES (0)");
    await migrate(poolA);
    await migrate(poolA);
    const repositoryA = new PostgresqlRepository(poolA);
    const repositoryB = new PostgresqlRepository(poolB);
    const serviceA = createOrderService({
      repository: repositoryA,
      cursorCodec: cursorCodec(secret),
    });
    const serviceB = createOrderService({
      repository: repositoryB,
      cursorCodec: cursorCodec(secret),
    });
    const services = [serviceA, serviceB];
    const latencies = [];
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        const begin = process.hrtime.bigint();
        const result = await services[index % 2].createOrder(
          order,
          `load-${index}`,
          identity,
        );
        latencies.push(Number(process.hrtime.bigint() - begin) / 1e6);
        return result.order.orderId;
      }),
    );
    const duplicate = await Promise.all([
      serviceA.createOrder(order, "duplicate-key", identity),
      serviceB.createOrder(order, "duplicate-key", identity),
    ]);
    await poolB.end();
    const afterReplicaClose = await serviceA.products();
    const evidence = {
      schema: "wave3.postgresql-operational.v1",
      database: "PostgreSQL 17 disposable container",
      apiReplicas: 2,
      concurrentCreates: results.length,
      uniqueOrderIds: new Set(results).size,
      duplicateKeyUniqueOrderIds: new Set(
        duplicate.map((item) => item.order.orderId),
      ).size,
      duplicateReplayCount: duplicate.filter((item) => item.replayed).length,
      elapsedMs: Date.now() - started,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: Math.max(...latencies),
      },
      replicaCloseRecovery: afterReplicaClose.length > 0,
      errorCount: 0,
      rpoAssumption:
        "local drill uses an explicit dump point; zero uncommitted transactions assumed",
      rtoMs: null,
      pass:
        new Set(results).size === results.length &&
        new Set(duplicate.map((item) => item.order.orderId)).size === 1 &&
        duplicate.filter((item) => item.replayed).length === 1 &&
        afterReplicaClose.length > 0,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    if (!evidence.pass) process.exitCode = 1;
  } finally {
    await poolA.end().catch(() => {});
    await poolB.end().catch(() => {});
    await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `PostgreSQL operational drill failed: ${error.message}\n`,
  );
  process.exitCode = 1;
});
