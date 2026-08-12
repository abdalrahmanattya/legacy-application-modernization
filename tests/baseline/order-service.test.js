const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../app/baseline/db");
const { createServer, TOKENS } = require("../../app/baseline/server");
let server;
let base;
let directory;
test.before(async () => {
  process.env.ENVIRONMENT = "local";
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "order-baseline-"));
  server = createServer({
    db: openDatabase(path.join(directory, "orders.sqlite")),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});
async function request(pathname, options = {}) {
  return fetch(base + pathname, {
    ...options,
    headers: { ...(options.headers || {}) },
  });
}
const auth = (token = TOKENS["operator-a"]) => ({
  authorization: `Bearer ${token}`,
});
const create = (
  customerReference = "cust_opaque_01",
  key = `key-${customerReference}`,
  token = TOKENS["operator-a"],
  lineItems = [{ sku: "DEMO-PLATFORM-001", quantity: 1 }],
) =>
  request("/v1/orders", {
    method: "POST",
    body: JSON.stringify({ customerReference, lineItems }),
    headers: {
      ...auth(token),
      "content-type": "application/json",
      "idempotency-key": key,
    },
  });

test("health, readiness, catalog, UI, and correlation are contract-shaped", async () => {
  const live = await request("/healthz", {
    headers: { "x-correlation-id": "test-123" },
  });
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("x-correlation-id"), "test-123");
  assert.deepEqual(await live.json(), { status: "ok" });
  assert.equal((await request("/readyz")).status, 200);
  const products = await request("/v1/products");
  assert.equal(products.status, 200);
  assert.deepEqual(
    (await products.json()).map((p) => p.sku),
    ["DEMO-AI-003", "DEMO-DATA-002", "DEMO-PLATFORM-001"],
  );
  const ui = await request("/");
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /canonical interface/);
});
test("readiness reports storage failure", async () => {
  const brokenDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-baseline-broken-"),
  );
  const brokenDb = openDatabase(path.join(brokenDirectory, "orders.sqlite"));
  const brokenServer = createServer({ db: brokenDb });
  brokenDb.close();
  await new Promise((resolve) => brokenServer.listen(0, resolve));
  const response = await fetch(
    `http://127.0.0.1:${brokenServer.address().port}/readyz`,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "unavailable");
  await new Promise((resolve) => brokenServer.close(resolve));
  fs.rmSync(brokenDirectory, { recursive: true, force: true });
});
test("create requires key, returns UUID/201, snapshots USD totals, and replays 200", async () => {
  assert.equal(
    (
      await request("/v1/orders", {
        method: "POST",
        body: "{}",
        headers: auth(),
      })
    ).status,
    422,
  );
  const first = await create();
  assert.equal(first.status, 201);
  const order = await first.json();
  assert.match(order.orderId, /^[0-9a-f-]{36}$/);
  assert.equal(order.total.minorUnits, 12500);
  assert.equal(order.total.currency, "USD");
  assert.equal(order.status, "PENDING");
  assert.equal(first.headers.get("location"), `/v1/orders/${order.orderId}`);
  const replay = await create();
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal((await replay.json()).orderId, order.orderId);
  const conflict = await create("different", "key-cust_opaque_01");
  assert.equal(conflict.status, 409);
});
test("principal scoping and admin access are enforced with indistinguishable 404", async () => {
  const made = await create("owner_a", "owner-a-key");
  const order = await made.json();
  assert.equal(
    (
      await request(`/v1/orders/${order.orderId}`, {
        headers: auth(TOKENS["operator-b"]),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await (
        await request("/v1/orders", { headers: auth(TOKENS["operator-b"]) })
      ).json()
    ).items.length,
    0,
  );
  assert.equal(
    (
      await request(`/v1/orders/${order.orderId}`, {
        headers: auth(TOKENS.admin),
      })
    ).status,
    200,
  );
});
test("transitions and out-of-scope routes follow contract", async () => {
  const order = await (await create("transition", "transition-key")).json();
  const confirmed = await request(`/v1/orders/${order.orderId}`, {
    method: "POST",
    body: JSON.stringify({ targetStatus: "CONFIRMED" }),
    headers: { ...auth(), "content-type": "application/json" },
  });
  const confirmedBody = await confirmed.json();
  assert.equal(confirmed.status, 200, JSON.stringify(confirmedBody));
  assert.equal(confirmedBody.status, "CONFIRMED");
  const fulfilled = await request(`/v1/orders/${order.orderId}`, {
    method: "POST",
    body: JSON.stringify({ targetStatus: "FULFILLED" }),
    headers: { ...auth(), "content-type": "application/json" },
  });
  const fulfilledBody = await fulfilled.json();
  assert.equal(fulfilled.status, 200, JSON.stringify(fulfilledBody));
  assert.equal(fulfilledBody.status, "FULFILLED");
  const invalid = await request(`/v1/orders/${order.orderId}`, {
    method: "POST",
    body: JSON.stringify({ targetStatus: "CANCELLED", reason: "not allowed" }),
    headers: { ...auth(), "content-type": "application/json" },
  });
  assert.equal(invalid.status, 422);
  assert.equal(
    (
      await request("/v1/orders/00000000-0000-4000-8000-000000000000", {
        headers: auth(TOKENS["operator-b"]),
      })
    ).status,
    404,
  );
});
test("cursor list and admin aggregate reports support filters and CSV privacy", async () => {
  await create("list-a", "list-a");
  await create("list-b", "list-b", TOKENS["operator-b"]);
  const list = await request("/v1/orders?limit=1", { headers: auth() });
  assert.equal(list.status, 200);
  const page = await list.json();
  assert.equal(page.items.length, 1);
  if (page.nextCursor)
    assert.equal(
      (
        await request(
          `/v1/orders?cursor=${encodeURIComponent(page.nextCursor)}`,
          { headers: auth() },
        )
      ).status,
      200,
    );
  assert.equal(
    (await request("/v1/reports/orders", { headers: auth() })).status,
    403,
  );
  const csv = await request("/v1/reports/orders?limit=10", {
    headers: { ...auth(TOKENS.admin), accept: "text/csv" },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /orders.csv/);
  assert.doesNotMatch(await csv.text(), /customerReference|ownerPrincipal/);
  const json = await request("/v1/reports/orders?format=json", {
    headers: auth(TOKENS.admin),
  });
  assert.equal(json.status, 200);
  assert.ok((await json.json()).count >= 1);
});
test("validation, privacy, auth, and error envelopes are safe", async () => {
  const bad = await create("bad ref", "bad");
  assert.equal(bad.status, 422);
  const basic = await request("/v1/orders", {
    method: "POST",
    body: "{}",
    headers: { authorization: `Basic ${TOKENS.admin}` },
  });
  assert.equal(basic.status, 401);
  const response = await request("/v1/nope", { headers: auth() });
  assert.equal(response.status, 404);
  const error = await response.json();
  assert.equal(error.correlationId.length > 0, true);
  assert.equal(Object.keys(error.details).length, 0);
});
