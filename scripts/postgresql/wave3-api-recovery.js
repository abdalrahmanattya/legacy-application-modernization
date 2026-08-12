const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const name = `wave3-pg-${process.pid}`;
const volume = `wave3-volume-${process.pid}`;
const output =
  process.env.WAVE3_EVIDENCE_OUTPUT ||
  ".evidence-results/wave3-api-recovery.json";
const token = "wave3-local-token";
const dbPort = 35439;
const portA = 34101;
const portB = 34102;
const dbUrl = `postgres://postgres:wave3-local-only@127.0.0.1:${dbPort}/orders`;
const children = new Map();
const evidence = { schema: "wave3.api-recovery.v1", pass: false, errors: [] };

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
}
function cleanup() {
  for (const child of children.values()) child.kill("SIGKILL");
  try {
    run("docker", ["rm", "-f", name]);
  } catch {}
  try {
    run("docker", ["volume", "rm", volume]);
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function waitFor(url, expected, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.status === expected) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
function startApi(port) {
  const child = spawn(
    process.execPath,
    ["scripts/postgresql/wave3-api-process.js"],
    {
      cwd: root,
      env: {
        ...process.env,
        ENVIRONMENT: "production",
        DATABASE_URL: dbUrl,
        PORT: String(port),
        WAVE3_TOKEN: token,
        DB_SSL: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.set(port, child);
  return child;
}
async function request(port, key, body = {}) {
  const started = process.hrtime.bigint();
  const response = await fetch(`http://127.0.0.1:${port}/v1/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      customerReference: `wave3-${key}`,
      lineItems: [{ sku: "DEMO-PLATFORM-001", quantity: 1 }],
      ...body,
    }),
  });
  return {
    response,
    latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}
async function main() {
  process.env.WAVE3_EVIDENCE_OUTPUT = output;
  run("docker", ["volume", "create", volume]);
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=wave3-local-only",
    "-e",
    "POSTGRES_DB=orders",
    "-p",
    `${dbPort}:5432`,
    "-v",
    `${volume}:/var/lib/postgresql/data`,
    "postgres:17",
  ]);
  for (let i = 0; i < 60; i++) {
    try {
      run("docker", [
        "exec",
        name,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "orders",
      ]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const migrateCode =
    "require('./scripts/postgresql/migrate').migrate(require('./app/postgresql').createPool({connectionString: process.env.DATABASE_URL})).then(()=>process.exit()).catch((e)=>{console.error(e.message);process.exit(1)})";
  let migrated = false;
  for (let i = 0; i < 10 && !migrated; i++) {
    try {
      run(process.execPath, ["-e", migrateCode], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: dbUrl, DB_SSL: "false" },
      });
      migrated = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!migrated)
    throw new Error("PostgreSQL migration did not become available");
  const apiA = startApi(34101);
  const apiB = startApi(34102);
  evidence.apiReady =
    (await waitFor("http://127.0.0.1:34101/readyz", 200)) &&
    (await waitFor("http://127.0.0.1:34102/readyz", 200));
  const latencies = [];
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      request(i % 2 ? 34102 : 34101, `load-${i}`).then(async (r) => {
        latencies.push(r.latencyMs);
        return r.response.status;
      }),
    ),
  );
  const duplicate = await Promise.all([
    request(34101, "same-key"),
    request(34102, "same-key"),
  ]);
  evidence.workload = {
    requests: results.length,
    errors: results.filter((s) => s >= 500).length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    duplicateStatuses: duplicate.map((r) => r.response.status),
    replayed: duplicate.some(
      (r) => r.response.headers.get("idempotency-replayed") === "true",
    ),
  };
  apiA.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  evidence.apiKillRecovery =
    (await waitFor("http://127.0.0.1:34102/readyz", 200)) &&
    (await request(34102, "after-api-kill")).response.status === 201;
  startApi(34101);
  evidence.apiRestartReady = await waitFor(
    "http://127.0.0.1:34101/readyz",
    200,
  );
  run("docker", ["stop", name]);
  evidence.dbOutage503 =
    (await waitFor("http://127.0.0.1:34101/readyz", 503, 10000)) ||
    (await waitFor("http://127.0.0.1:34102/readyz", 503, 10000));
  run("docker", ["start", name]);
  for (let i = 0; i < 60; i++) {
    try {
      run("docker", [
        "exec",
        name,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "orders",
      ]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  evidence.dbRestartRecovery =
    (await waitFor("http://127.0.0.1:34101/readyz", 200, 30000)) &&
    (await waitFor("http://127.0.0.1:34102/readyz", 200, 30000));
  evidence.postRecoveryCreate =
    (await request(34101, "after-db-restart")).response.status === 201;
  evidence.pass =
    evidence.apiReady &&
    evidence.workload.errors === 0 &&
    evidence.workload.replayed &&
    evidence.apiKillRecovery &&
    evidence.apiRestartReady &&
    evidence.dbOutage503 &&
    evidence.dbRestartRecovery &&
    evidence.postRecoveryCreate;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (!evidence.pass) process.exitCode = 1;
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}
main().catch((error) => {
  evidence.errors.push(error.message);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stderr.write(`Wave3 recovery failed: ${error.message}\n`);
  process.exitCode = 1;
});
