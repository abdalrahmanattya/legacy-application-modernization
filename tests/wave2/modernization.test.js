const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../app/baseline/db");
const { createServer, TOKENS } = require("../../app/baseline/server");
const { SqliteRepository } = require("../../app/repositories/sqlite");
const { localAuthenticator } = require("../../app/auth/local");
const { cognitoJwtAuthenticator } = require("../../app/auth/jwt");
const { createReportWorker } = require("../../app/report-worker");
const { createOutboxPublisher } = require("../../app/outbox-publisher");
const {
  LocalReportQueue,
  LocalArtifactStore,
} = require("../../app/ports/reporting");

process.env.ENVIRONMENT = "local";
const auth = (token = TOKENS["operator-a"]) => ({
  authorization: `Bearer ${token}`,
});

async function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wave2-sqlite-"));
  const repository = new SqliteRepository(
    openDatabase(path.join(directory, "orders.sqlite")),
  );
  const logs = [];
  const server = createServer({
    repository,
    logger: (event) => logs.push(event),
    artifactStore: options.artifactStore,
    authenticator: options.authenticator,
  });
  await server.initialization;
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    repository,
    logs,
    request: (pathname, options = {}) =>
      fetch(base + pathname, {
        ...options,
        headers: { ...(options.headers || {}) },
      }),
    close: async () => {
      await server.shutdown();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

const orderBody = (customerReference = "wave2-opaque") =>
  JSON.stringify({
    customerReference,
    lineItems: [{ sku: "DEMO-AI-003", quantity: 1 }],
  });
function create(f, key, body = orderBody(), token = TOKENS["operator-a"]) {
  return f.request("/v1/orders", {
    method: "POST",
    body,
    headers: {
      ...auth(token),
      "content-type": "application/json",
      "idempotency-key": key,
    },
  });
}

test("SQLite adapter preserves concurrent idempotency and hashes stored keys", async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => create(f, "concurrent-secret-key")),
    );
    assert.equal(
      responses.filter((response) => response.status === 201).length,
      1,
    );
    assert.equal(
      responses.filter((response) => response.status === 200).length,
      11,
    );
    const ids = await Promise.all(
      responses.map(async (response) => (await response.json()).orderId),
    );
    assert.equal(new Set(ids).size, 1);
    const stored = f.repository.db
      .prepare(
        "SELECT key_digest, created_at, expires_at FROM idempotency_records",
      )
      .get();
    assert.match(stored.key_digest, /^[0-9a-f]{64}$/);
    assert.notEqual(stored.key_digest, "concurrent-secret-key");
    assert.equal(
      Date.parse(stored.expires_at) - Date.parse(stored.created_at),
      86_400_000,
    );
    const conflict = await create(
      f,
      "concurrent-secret-key",
      orderBody("different-opaque"),
    );
    assert.equal(conflict.status, 409);
  } finally {
    await f.close();
  }
});

test("signed cursors reject tampering and cross-principal replay", async () => {
  const f = await fixture();
  try {
    await create(f, "cursor-1", orderBody("cursor-one"));
    await create(f, "cursor-2", orderBody("cursor-two"));
    const first = await f.request("/v1/orders?limit=1", { headers: auth() });
    const cursor = (await first.json()).nextCursor;
    assert.ok(cursor);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    assert.equal(
      (
        await f.request(`/v1/orders?cursor=${encodeURIComponent(tampered)}`, {
          headers: auth(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(`/v1/orders?cursor=${encodeURIComponent(cursor)}`, {
          headers: auth(TOKENS["operator-b"]),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          `/v1/orders?status=PENDING&cursor=${encodeURIComponent(cursor)}`,
          { headers: auth() },
        )
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});

test("versioned report jobs preserve v1 and execute through local worker port", async () => {
  const artifactStore = new LocalArtifactStore();
  const localAuth = localAuthenticator(TOKENS);
  const f = await fixture({
    artifactStore,
    authenticator: {
      authenticate: async (header) =>
        header === "Bearer local-reviewer-admin-token"
          ? { subject: "reviewer-admin", roles: ["admin"] }
          : localAuth.authenticate(header),
    },
  });
  try {
    await create(f, "job-order");
    const sync = await f.request("/v1/reports/orders", {
      headers: auth(TOKENS.admin),
    });
    assert.equal(sync.status, 200);
    const accepted = await f.request("/v2/report-jobs", {
      method: "POST",
      body: JSON.stringify({ format: "csv", status: "PENDING" }),
      headers: {
        ...auth(TOKENS.admin),
        "content-type": "application/json",
      },
    });
    assert.equal(accepted.status, 202);
    const job = await accepted.json();
    assert.equal(job.status, "QUEUED");
    assert.equal(
      (
        await f.request(`/v2/report-jobs/${job.jobId}/download`, {
          headers: auth(TOKENS.admin),
        })
      ).status,
      409,
    );
    const queue = new LocalReportQueue();
    const publisher = createOutboxPublisher({
      repository: f.repository,
      queue,
    });
    assert.equal(await publisher.runOnce(), 1);
    assert.equal(await publisher.runOnce(), 0);
    const worker = createReportWorker({
      repository: f.repository,
      queue,
      artifactStore,
    });
    assert.equal(await worker.runOnce(), true);
    const completed = await f.request(`/v2/report-jobs/${job.jobId}`, {
      headers: auth(TOKENS.admin),
    });
    assert.equal(completed.status, 200);
    const result = await completed.json();
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.result.contentType, "text/csv");
    const artifact = await artifactStore.get(result.result.artifactId);
    assert.doesNotMatch(artifact.body, /customerReference|principal/);
    const download = await f.request(`/v2/report-jobs/${job.jobId}/download`, {
      headers: auth(TOKENS.admin),
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.match((await download.json()).url, /^local-report:/);
    assert.equal(
      (
        await f.request(`/v2/report-jobs/${job.jobId}/download`, {
          headers: { authorization: "Bearer local-reviewer-admin-token" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(`/v2/report-jobs/${job.jobId}/download`, {
          headers: auth(),
        })
      ).status,
      404,
    );
    await queue.send({ reportJobId: job.jobId });
    assert.equal(await worker.runOnce(), false);
    assert.equal(await queue.receive(), null);

    const retryAccepted = await f.request("/v2/report-jobs", {
      method: "POST",
      body: JSON.stringify({ format: "json" }),
      headers: {
        ...auth(TOKENS.admin),
        "content-type": "application/json",
      },
    });
    const retryJob = await retryAccepted.json();
    assert.equal(await publisher.runOnce(), 1);
    const failingWorker = createReportWorker({
      repository: f.repository,
      queue,
      artifactStore: { put: async () => Promise.reject(new Error("fixture")) },
    });
    await assert.rejects(failingWorker.runOnce(), /fixture/);
    assert.equal(
      (await f.repository.getReportJob(retryJob.jobId, "admin")).status,
      "QUEUED",
    );
    assert.equal(await worker.runOnce(), true);
  } finally {
    await f.close();
  }
});

test("completion logs are normalized and redact body, bearer, and idempotency data", async () => {
  const f = await fixture();
  try {
    const response = await create(
      f,
      "never-log-this-key",
      orderBody("never-log-this-reference"),
    );
    const order = await response.json();
    await f.request(`/v1/orders/${order.orderId}`, {
      headers: {
        ...auth(),
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      },
    });
    const serialized = JSON.stringify(f.logs);
    assert.doesNotMatch(serialized, /never-log-this-key/);
    assert.doesNotMatch(serialized, /never-log-this-reference/);
    assert.doesNotMatch(serialized, /local-operator-a-token/);
    assert.ok(
      f.logs.some(
        (entry) =>
          entry.route === "GET /v1/orders/{orderId}" &&
          entry.traceId === "0123456789abcdef0123456789abcdef",
      ),
    );
  } finally {
    await f.close();
  }
});

test("shutdown drains HTTP and awaits asynchronous repository close", async () => {
  let closed = false;
  const repository = {
    initialize: async () => {},
    ready: async () => true,
    close: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      closed = true;
    },
  };
  const server = createServer({
    repository,
    authenticator: localAuthenticator(TOKENS),
    logger: () => {},
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const closing = server.shutdown();
  assert.equal(server.draining, true);
  assert.equal(closed, false);
  await closing;
  assert.equal(closed, true);
});

test("authenticated identities without an approved group are forbidden", async () => {
  const f = await fixture({
    authenticator: {
      authenticate: async () => ({ subject: "ungrouped", roles: [] }),
    },
  });
  try {
    assert.equal(
      (
        await f.request("/v1/orders", {
          headers: { authorization: "Bearer valid-but-ungrouped" },
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});

function jwt(privateKey, kid, claims, overrides = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid, ...overrides }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  );
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

test("Cognito JWT adapter validates access-token boundaries and JWKS rotation", async () => {
  const first = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const second = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const issuer =
    "https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_fixture";
  const now = 2_000_000_000;
  const claims = {
    iss: issuer,
    client_id: "portfolio-client",
    token_use: "access",
    sub: "subject-1",
    exp: now + 300,
    "cognito:groups": ["admin"],
  };
  let keys = [
    {
      ...first.publicKey.export({ format: "jwk" }),
      kid: "first",
      use: "sig",
      alg: "RS256",
    },
  ];
  const authn = cognitoJwtAuthenticator({
    issuer,
    clientId: "portfolio-client",
    fetchJwks: async () => ({ keys }),
    clock: () => now,
    cacheMs: 60_000,
  });
  const good = jwt(first.privateKey, "first", claims);
  assert.deepEqual(await authn.authenticate(`Bearer ${good}`), {
    subject: `${issuer}#subject-1`,
    roles: ["admin"],
  });
  for (const changed of [
    { ...claims, iss: "https://wrong" },
    { ...claims, client_id: "wrong" },
    { ...claims, token_use: "id" },
    { ...claims, exp: now },
    { ...claims, nbf: now + 1 },
  ])
    assert.equal(
      await authn.authenticate(
        `Bearer ${jwt(first.privateKey, "first", changed)}`,
      ),
      null,
    );
  assert.equal(
    await authn.authenticate(
      `Bearer ${jwt(first.privateKey, "first", claims, { alg: "HS256" })}`,
    ),
    null,
  );
  assert.equal(
    await authn.authenticate(
      `Bearer ${jwt(second.privateKey, "first", claims)}`,
    ),
    null,
  );
  keys = [
    {
      ...second.publicKey.export({ format: "jwk" }),
      kid: "second",
      use: "sig",
      alg: "RS256",
    },
  ];
  const rotated = await authn.authenticate(
    `Bearer ${jwt(second.privateKey, "second", { ...claims, "cognito:groups": ["operator"] })}`,
  );
  assert.deepEqual(rotated.roles, ["operator"]);
  const customGroups = cognitoJwtAuthenticator({
    issuer,
    clientId: "portfolio-client",
    jwks: { keys },
    clock: () => now,
    adminGroup: "platform-admin",
    operatorGroup: "platform-operator",
  });
  assert.deepEqual(
    await customGroups.authenticate(
      `Bearer ${jwt(second.privateKey, "second", {
        ...claims,
        "cognito:groups": ["platform-admin", "platform-operator"],
      })}`,
    ),
    {
      subject: `${issuer}#subject-1`,
      roles: ["operator", "admin"],
    },
  );
});
