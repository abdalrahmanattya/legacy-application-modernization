const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const unique = `${process.pid}-${Date.now()}`;
const name = `wave3-pg-${unique}`;
const volume = `wave3-volume-${unique}`;
const output =
  process.env.WAVE3_EVIDENCE_OUTPUT ||
  ".evidence-results/wave3-api-recovery.json";
const token = "wave3-local-token";
let dbPort = Number(process.env.WAVE3_DB_PORT || 0);
const basePort = Number(process.env.WAVE3_BASE_PORT || 34101);
const portA = basePort;
const portB = basePort + 1;
let dbUrl;
const children = new Map();
const evidence = { schema: "wave3.api-recovery.v1", pass: false, errors: [] };
let cleanupPromise;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
}
function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
function publishedDatabasePort() {
  return Number(
    run("docker", ["port", name, "5432/tcp"]).match(/:(\d+)\s*$/m)?.[1],
  );
}
function waitForExit(child, timeoutMs = 3000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const live = [...children.values()];
    for (const child of live) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
    await Promise.all(live.map((child) => waitForExit(child)));
    for (const child of live) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    children.clear();
    try {
      run("docker", ["rm", "-f", name]);
    } catch {}
    try {
      run("docker", ["volume", "rm", volume]);
    } catch {}
  })();
  return cleanupPromise;
}
function emergencyDockerCleanup() {
  try {
    run("docker", ["rm", "-f", name]);
  } catch {}
  try {
    run("docker", ["volume", "rm", volume]);
  } catch {}
}
process.on("exit", emergencyDockerCleanup);
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    void cleanup().finally(() => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
  });
}

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
  // Always drain child pipes. Leaving structured request logs unread can fill
  // the OS pipe buffer and block the API event loop during readiness polling.
  child.wave3Logs = { stdout: "", stderr: "" };
  for (const streamName of ["stdout", "stderr"]) {
    child[streamName].on("data", (chunk) => {
      child.wave3Logs[streamName] = (
        child.wave3Logs[streamName] + chunk.toString()
      ).slice(-32768);
    });
  }
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
  if (!dbPort) dbPort = await reserveLocalPort();
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
    `127.0.0.1:${dbPort}:5432`,
    "-v",
    `${volume}:/var/lib/postgresql/data`,
    "postgres:17",
  ]);
  const initialPublishedPort = publishedDatabasePort();
  if (!initialPublishedPort || initialPublishedPort !== dbPort)
    throw new Error("could not determine disposable PostgreSQL port");
  dbUrl = `postgres://postgres:wave3-local-only@127.0.0.1:${dbPort}/orders`;
  let dbReady = false;
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
      dbReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!dbReady)
    throw new Error(
      "PostgreSQL container did not become ready within 30 seconds",
    );
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
  const apiA = startApi(portA);
  const apiB = startApi(portB);
  evidence.apiReady =
    (await waitFor(`http://127.0.0.1:${portA}/readyz`, 200)) &&
    (await waitFor(`http://127.0.0.1:${portB}/readyz`, 200));
  const latencies = [];
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      request(i % 2 ? portB : portA, `load-${i}`).then(async (r) => {
        latencies.push(r.latencyMs);
        return r.response.status;
      }),
    ),
  );
  const duplicate = await Promise.all([
    request(portA, "same-key"),
    request(portB, "same-key"),
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
    (await waitFor(`http://127.0.0.1:${portB}/readyz`, 200)) &&
    (await request(portB, "after-api-kill")).response.status === 201;
  startApi(portA);
  evidence.apiRestartReady = await waitFor(
    `http://127.0.0.1:${portA}/readyz`,
    200,
  );
  run("docker", ["stop", name]);
  evidence.dbOutage503 =
    (await waitFor(`http://127.0.0.1:${portA}/readyz`, 503, 10000)) ||
    (await waitFor(`http://127.0.0.1:${portB}/readyz`, 503, 10000));
  run("docker", ["start", name]);
  evidence.databaseEndpointStable = publishedDatabasePort() === dbPort;
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
    (await waitFor(`http://127.0.0.1:${portA}/readyz`, 200, 30000)) &&
    (await waitFor(`http://127.0.0.1:${portB}/readyz`, 200, 30000));
  evidence.postRecoveryCreate =
    (await request(portA, "after-db-restart")).response.status === 201;
  evidence.pass =
    evidence.apiReady &&
    evidence.workload.errors === 0 &&
    evidence.workload.replayed &&
    evidence.apiKillRecovery &&
    evidence.apiRestartReady &&
    evidence.dbOutage503 &&
    evidence.databaseEndpointStable &&
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
main()
  .catch((error) => {
    evidence.errors.push(error.message);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stderr.write(`Wave3 recovery failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (interrupted && process.exitCode === 0) process.exitCode = 143;
  });
