const http = require("node:http");
const crypto = require("node:crypto");
const { timingSafeEqual } = crypto;
const { URL } = require("node:url");
const querystring = require("node:querystring");
const { openDatabase, seedProducts } = require("./db");
const service = require("./service");
const PORT = Number(process.env.PORT || 3000);
const LOCAL_TOKENS = {
  "operator-a": process.env.OPERATOR_A_TOKEN || "local-operator-a-token",
  "operator-b": process.env.OPERATOR_B_TOKEN || "local-operator-b-token",
  admin: process.env.ADMIN_TOKEN || "local-admin-token",
};
const TOKEN_ENV = {
  "operator-a": "OPERATOR_A_TOKEN",
  "operator-b": "OPERATOR_B_TOKEN",
  admin: "ADMIN_TOKEN",
};
function configuredTokens() {
  if (process.env.ENVIRONMENT === "local") return LOCAL_TOKENS;
  const tokens = Object.fromEntries(
    Object.entries(TOKEN_ENV).map(([role, name]) => [
      role,
      process.env[name]?.trim(),
    ]),
  );
  if (
    Object.values(tokens).some(
      (token) => typeof token !== "string" || !token.trim(),
    ) ||
    new Set(Object.values(tokens)).size !== Object.values(tokens).length
  )
    throw new Error("production token configuration is invalid");
  return tokens;
}
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
function parseRfc3339(value) {
  if (!value || !RFC3339.test(value) || Number.isNaN(Date.parse(value)))
    return null;
  return new Date(value).toISOString();
}
function correlation(request) {
  const supplied = request.headers["x-correlation-id"];
  return typeof supplied === "string" &&
    /^[A-Za-z0-9._:-]{1,64}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}
function log(event, fields) {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }) +
      "\n",
  );
}
function identity(request, tokens) {
  const parts = String(request.headers.authorization || "").split(" ");
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  for (const [role, expected] of Object.entries(tokens)) {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return role;
  }
  return null;
}
async function readBody(request) {
  let text = "";
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 204800) throw new Error("request too large");
    text += chunk;
  }
  if (!text) return {};
  return (request.headers["content-type"] || "").startsWith(
    "application/x-www-form-urlencoded",
  )
    ? querystring.parse(text)
    : JSON.parse(text);
}
function send(response, status, payload, id, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": id,
    ...headers,
  });
  response.end(JSON.stringify(payload));
}
function error(response, status, code, message, id, details = {}) {
  send(
    response,
    status,
    { error: code, message, correlationId: id, details },
    id,
  );
}
function ui(db) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order Reference Service</title></head><body><main><h1>Order Reference Service</h1><p>Local demonstration UI; the canonical interface is the JSON API.</p><ul>${service
    .products(db)
    .map((p) => `<li>${p.sku}: ${p.name}</li>`)
    .join(
      "",
    )}</ul><form method="post" action="/ui/orders"><label>Bearer fixture <input name="token" type="password" required></label><label>Customer reference <input name="customerReference" required></label><label>SKU <input name="sku" value="DEMO-PLATFORM-001" required></label><label>Quantity <input name="quantity" type="number" min="1" max="100" value="1" required></label><button>Create order</button></form></main></body></html>`;
}
function createServer({ db = openDatabase(), rateLimit = {} } = {}) {
  const tokens = configuredTokens();
  seedProducts(db);
  const counters = new Map();
  const limit = rateLimit.limit ?? 120;
  const windowMs = rateLimit.windowMs ?? 60_000;
  const checkRate = (key) => {
    const current = counters.get(key);
    const nowMs = Date.now();
    if (!current || nowMs >= current.resetAt) {
      counters.set(key, { count: 1, resetAt: nowMs + windowMs });
      return 0;
    }
    current.count += 1;
    return current.count > limit
      ? Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000))
      : 0;
  };
  const server = http.createServer(async (request, response) => {
    const id = correlation(request);
    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    try {
      if (server.draining)
        return error(
          response,
          503,
          "unavailable",
          "service is shutting down",
          id,
        );
      if (request.method === "GET" && url.pathname === "/healthz")
        return send(response, 200, { status: "ok" }, id);
      if (request.method === "GET" && url.pathname === "/readyz") {
        try {
          if (server.draining) throw new Error("service is shutting down");
          db.prepare("SELECT 1").get();
          return send(response, 200, { status: "ready", storage: "ok" }, id);
        } catch {
          return error(
            response,
            503,
            "unavailable",
            "storage is unavailable",
            id,
          );
        }
      }
      if (
        request.method === "GET" &&
        url.pathname === "/" &&
        process.env.ENVIRONMENT === "local"
      ) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-correlation-id": id,
        });
        return response.end(ui(db));
      }
      if (request.method === "GET" && url.pathname === "/v1/products")
        return send(response, 200, service.products(db), id);
      if (
        request.method === "POST" &&
        url.pathname === "/ui/orders" &&
        process.env.ENVIRONMENT === "local"
      ) {
        const body = await readBody(request);
        const role = identity(
          {
            headers: { authorization: `Bearer ${body.token}` },
          },
          tokens,
        );
        if (!role)
          return error(
            response,
            401,
            "unauthenticated",
            "valid bearer authentication is required",
            id,
          );
        const input = {
          customerReference: body.customerReference,
          lineItems: [{ sku: body.sku, quantity: Number(body.quantity) }],
        };
        const result = service.createOrder(
          db,
          input,
          `ui-${crypto.randomUUID()}`,
          role,
        );
        response.writeHead(303, {
          location: `/v1/orders/${result.order.orderId}`,
          "x-correlation-id": id,
        });
        return response.end();
      }
      if (!url.pathname.startsWith("/v1/"))
        return error(response, 404, "not_found", "resource not found", id);
      const role = identity(request, tokens);
      if (!role)
        return error(
          response,
          401,
          "unauthenticated",
          "valid bearer authentication is required",
          id,
        );
      const retryAfter = checkRate(`${role}:${request.method}:${url.pathname}`);
      if (retryAfter) {
        response.setHeader("retry-after", String(retryAfter));
        return error(
          response,
          429,
          "rate_limited",
          "request rate exceeded",
          id,
          {
            retryAfter,
          },
        );
      }
      if (request.method === "POST" && url.pathname === "/v1/orders") {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
          return error(
            response,
            422,
            "validation_error",
            "Idempotency-Key is required and invalid",
            id,
          );
        const result = service.createOrder(
          db,
          await readBody(request),
          key,
          role,
        );
        return send(response, result.replayed ? 200 : 201, result.order, id, {
          location: `/v1/orders/${result.order.orderId}`,
          ...(result.replayed ? { "idempotency-replayed": "true" } : {}),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/orders") {
        const status = url.searchParams.get("status");
        if (status && !service.STATUSES.includes(status))
          return error(
            response,
            422,
            "validation_error",
            "invalid status filter",
            id,
          );
        const limit = Number(url.searchParams.get("limit") || 25);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          return error(response, 422, "validation_error", "invalid limit", id);
        try {
          return send(
            response,
            200,
            service.listOrders(
              db,
              status,
              limit,
              url.searchParams.get("cursor"),
              role,
              role === "admin",
            ),
            id,
          );
        } catch (e) {
          return error(response, 400, "bad_request", e.message, id);
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/reports/orders") {
        if (role !== "admin")
          return error(
            response,
            403,
            "forbidden",
            "administrator access is required",
            id,
          );
        const accept = request.headers.accept || "application/json";
        if (
          !accept.includes("application/json") &&
          !accept.includes("text/csv") &&
          !accept.includes("*/*")
        )
          return error(
            response,
            422,
            "validation_error",
            "unsupported Accept header",
            id,
          );
        const status = url.searchParams.get("status");
        if (status && !service.STATUSES.includes(status))
          return error(
            response,
            422,
            "validation_error",
            "invalid status filter",
            id,
          );
        const limit = Number(url.searchParams.get("limit") || 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
          return error(response, 422, "validation_error", "invalid limit", id);
        const fromInput = url.searchParams.get("createdFrom");
        const toInput = url.searchParams.get("createdTo");
        const from = fromInput ? parseRfc3339(fromInput) : null;
        const to = toInput ? parseRfc3339(toInput) : null;
        if (
          (fromInput && !from) ||
          (toInput && !to) ||
          (from && to && from > to)
        )
          return error(
            response,
            422,
            "validation_error",
            "invalid date filter",
            id,
          );
        const result = service.report(db, status, from, to, limit);
        if (accept.includes("text/csv")) {
          response.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="orders.csv"',
            "x-correlation-id": id,
          });
          return response.end(service.csvReport(result));
        }
        return send(response, 200, result, id);
      }
      const match = url.pathname.match(
        /^\/v1\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      if (!match)
        return error(response, 404, "not_found", "resource not found", id);
      const order = service.getOrder(db, match[1], role, role === "admin");
      if (!order)
        return error(response, 404, "not_found", "order not found", id);
      if (request.method === "GET") return send(response, 200, order, id);
      if (request.method === "POST") {
        const body = await readBody(request);
        if (!body || Object.keys(body).some((key) => key !== "targetStatus"))
          return error(
            response,
            422,
            "validation_error",
            "only targetStatus is accepted",
            id,
          );
        if (!service.STATUSES.includes(body.targetStatus))
          return error(
            response,
            422,
            "validation_error",
            "invalid target status",
            id,
          );
        try {
          return send(
            response,
            200,
            service.transition(
              db,
              match[1],
              body.targetStatus,
              role,
              role === "admin",
            ),
            id,
          );
        } catch (e) {
          return error(response, 409, "conflict", e.message, id);
        }
      }
      return error(response, 404, "not_found", "resource not found", id);
    } catch (e) {
      log("request.error", {
        correlationId: id,
        method: request.method,
        path: url.pathname,
        error: e.message,
      });
      const conflict = e.message.includes("idempotency");
      const validation =
        /invalid order request|invalid line item|unknown SKU|order total exceeds/.test(
          e.message,
        );
      const status = conflict ? 409 : validation ? 422 : 500;
      return error(
        response,
        status,
        conflict
          ? "conflict"
          : validation
            ? "validation_error"
            : "internal_error",
        conflict || validation ? e.message : "request could not be completed",
        id,
      );
    }
  });
  server.on("close", () => {
    try {
      db.close();
    } catch {
      // The readiness-failure path may already have closed the database.
    }
  });
  server.draining = false;
  server.db = db;
  return server;
}
if (require.main === module) {
  const server = createServer();
  const shutdown = () => {
    if (server.draining) return;
    server.draining = true;
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(PORT, "0.0.0.0", () => log("server.started", { port: PORT }));
}
module.exports = { createServer, TOKENS: LOCAL_TOKENS, configuredTokens };
