const http = require("node:http");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const querystring = require("node:querystring");
const { openDatabase } = require("./db");
const domain = require("./service");
const { SqliteRepository } = require("../repositories/sqlite");
const { cursorCodec } = require("../core/cursor");
const { AppError, validation, badRequest } = require("../core/errors");
const { DEFAULT_FIXTURES, localAuthenticator } = require("../auth/local");
const { createTelemetry } = require("../observability/telemetry");

const PORT = Number(process.env.PORT || 3000);
function configuredTokens() {
  if (process.env.ENVIRONMENT !== "local")
    throw new Error("local fixture authentication is unavailable");
  return DEFAULT_FIXTURES;
}

function configuredAuthenticator() {
  return localAuthenticator(configuredTokens());
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
function traceparent(request) {
  const value = request.headers.traceparent;
  const match =
    typeof value === "string" &&
    value.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  return match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2])
    ? value.toLowerCase()
    : null;
}
function traceId(value) {
  return value ? value.split("-")[1] : null;
}
function defaultLogger(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
function normalizedRoute(method, pathname) {
  if (/^\/v1\/orders\/[0-9a-f-]{36}$/i.test(pathname))
    return `${method} /v1/orders/{orderId}`;
  if (/^\/v2\/report-jobs\/[0-9a-f-]{36}$/i.test(pathname))
    return `${method} /v2/report-jobs/{jobId}`;
  if (/^\/v2\/report-jobs\/[0-9a-f-]{36}\/download$/i.test(pathname))
    return `${method} /v2/report-jobs/{jobId}/download`;
  const known = new Set([
    "/healthz",
    "/readyz",
    "/v1/products",
    "/v1/orders",
    "/v1/reports/orders",
    "/v2/report-jobs",
    "/",
    "/ui/orders",
  ]);
  return known.has(pathname) ? `${method} ${pathname}` : `${method} unmatched`;
}
async function readBody(request) {
  let text = "";
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 204800)
      throw new AppError("payload_too_large", "request is too large", 413);
    text += chunk;
  }
  if (!text) return {};
  if (
    (request.headers["content-type"] || "").startsWith(
      "application/x-www-form-urlencoded",
    )
  )
    return querystring.parse(text);
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("request body is not valid JSON");
  }
}
function send(response, status, payload, id, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": id,
    ...headers,
  });
  response.end(JSON.stringify(payload));
}
function sendError(response, error, id) {
  const expected = error instanceof AppError;
  send(
    response,
    expected ? error.status : 500,
    {
      error: expected ? error.code : "internal_error",
      message:
        expected && error.expose
          ? error.message
          : "request could not be completed",
      correlationId: id,
      details: {},
    },
    id,
  );
}
function reportFilters(url) {
  const status = url.searchParams.get("status");
  if (status && !domain.STATUSES.includes(status))
    throw validation("invalid status filter");
  const fromInput = url.searchParams.get("createdFrom");
  const toInput = url.searchParams.get("createdTo");
  const createdFrom = fromInput ? parseRfc3339(fromInput) : null;
  const createdTo = toInput ? parseRfc3339(toInput) : null;
  if (
    (fromInput && !createdFrom) ||
    (toInput && !createdTo) ||
    (createdFrom && createdTo && createdFrom > createdTo)
  )
    throw validation("invalid date filter");
  return { status, createdFrom, createdTo };
}
async function ui(service) {
  const products = await service.products();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order Reference Service</title></head><body><main><h1>Order Reference Service</h1><p>Local demonstration UI; the canonical interface is the JSON API.</p><ul>${products.map((product) => `<li>${product.sku}: ${product.name}</li>`).join("")}</ul><form method="post" action="/ui/orders"><label>Bearer fixture <input name="token" type="password" required></label><label>Customer reference <input name="customerReference" required></label><label>SKU <input name="sku" value="DEMO-PLATFORM-001" required></label><label>Quantity <input name="quantity" type="number" min="1" max="100" value="1" required></label><button>Create order</button></form></main></body></html>`;
}

function createServer({
  db,
  repository = new SqliteRepository(db || openDatabase()),
  authenticator = configuredAuthenticator(),
  artifactStore = null,
  reportDownloadExpiresSeconds = 300,
  logger = defaultLogger,
  telemetry = createTelemetry(),
  rateLimit = {},
  cursorSecret = process.env.CURSOR_SIGNING_SECRET ||
    (process.env.ENVIRONMENT === "local"
      ? "local-cursor-signing-secret-not-for-shared-use"
      : null),
} = {}) {
  const service = domain.createOrderService({
    repository,
    cursorCodec: cursorCodec(cursorSecret),
  });
  let initialization;
  try {
    initialization = Promise.resolve(repository.initialize());
  } catch (error) {
    initialization = Promise.reject(error);
  }
  const counters = new Map();
  const localRateLimit = process.env.ENVIRONMENT === "local";
  const limit = rateLimit.limit ?? 120;
  const windowMs = rateLimit.windowMs ?? 60_000;
  const checkRate = (key) => {
    if (!localRateLimit) return 0;
    const current = counters.get(key);
    const now = Date.now();
    if (!current || now >= current.resetAt) {
      counters.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    current.count += 1;
    return current.count > limit
      ? Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      : 0;
  };
  const server = http.createServer(async (request, response) => {
    const started = process.hrtime.bigint();
    const id = correlation(request);
    const traceContext = traceparent(request);
    const trace = traceId(traceContext);
    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );
    const route = normalizedRoute(request.method, url.pathname);
    const requestSpan = telemetry.startHttp({
      method: request.method,
      route,
      traceparent: traceContext,
    });
    let identity = null;
    let outcome = "success";
    try {
      await initialization;
      if (request.method === "GET" && url.pathname === "/healthz")
        return send(response, 200, { status: "ok" }, id);
      if (server.draining)
        throw new AppError("unavailable", "service is shutting down", 503);
      if (request.method === "GET" && url.pathname === "/readyz") {
        if (!(await repository.ready()))
          throw new AppError("unavailable", "storage is unavailable", 503);
        return send(response, 200, { status: "ready", storage: "ok" }, id);
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
        return response.end(await ui(service));
      }
      if (request.method === "GET" && url.pathname === "/v1/products")
        return send(response, 200, await service.products(), id);
      if (
        request.method === "POST" &&
        url.pathname === "/ui/orders" &&
        process.env.ENVIRONMENT === "local"
      ) {
        const body = await readBody(request);
        identity = await authenticator.authenticate(`Bearer ${body.token}`);
        if (!identity)
          throw new AppError(
            "unauthenticated",
            "valid bearer authentication is required",
            401,
          );
        const result = await service.createOrder(
          {
            customerReference: body.customerReference,
            lineItems: [{ sku: body.sku, quantity: Number(body.quantity) }],
          },
          `ui-${crypto.randomUUID()}`,
          identity,
        );
        response.writeHead(303, {
          location: `/v1/orders/${result.order.orderId}`,
          "x-correlation-id": id,
        });
        return response.end();
      }
      if (!url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/v2/"))
        throw new AppError("not_found", "resource not found", 404);
      identity = await authenticator.authenticate(
        request.headers.authorization,
      );
      if (!identity)
        throw new AppError(
          "unauthenticated",
          "valid bearer authentication is required",
          401,
        );
      if (
        !identity.roles.includes("operator") &&
        !identity.roles.includes("admin")
      )
        throw new AppError(
          "forbidden",
          "an approved Cognito group is required",
          403,
        );
      const retryAfter = checkRate(
        `${identity.subject}:${normalizedRoute(request.method, url.pathname)}`,
      );
      if (retryAfter) {
        response.setHeader("retry-after", String(retryAfter));
        throw new AppError("rate_limited", "request rate exceeded", 429);
      }
      if (request.method === "POST" && url.pathname === "/v1/orders") {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
          throw validation("Idempotency-Key is required and invalid");
        const result = await service.createOrder(
          await readBody(request),
          key,
          identity,
        );
        return send(response, result.replayed ? 200 : 201, result.order, id, {
          location: `/v1/orders/${result.order.orderId}`,
          ...(result.replayed ? { "idempotency-replayed": "true" } : {}),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/orders") {
        const status = url.searchParams.get("status");
        if (status && !domain.STATUSES.includes(status))
          throw validation("invalid status filter");
        const pageLimit = Number(url.searchParams.get("limit") || 25);
        if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100)
          throw validation("invalid limit");
        return send(
          response,
          200,
          await service.listOrders(
            status,
            pageLimit,
            url.searchParams.get("cursor"),
            identity,
          ),
          id,
        );
      }
      if (request.method === "GET" && url.pathname === "/v1/reports/orders") {
        if (!identity.roles.includes("admin"))
          throw new AppError(
            "forbidden",
            "administrator access is required",
            403,
          );
        const accept = request.headers.accept || "application/json";
        if (
          !accept.includes("application/json") &&
          !accept.includes("text/csv") &&
          !accept.includes("*/*")
        )
          throw validation("unsupported Accept header");
        const filters = reportFilters(url);
        const reportLimit = Number(url.searchParams.get("limit") || 100);
        if (
          !Number.isInteger(reportLimit) ||
          reportLimit < 1 ||
          reportLimit > 1000
        )
          throw validation("invalid limit");
        const result = await service.report({ ...filters, limit: reportLimit });
        if (accept.includes("text/csv")) {
          response.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="orders.csv"',
            "x-correlation-id": id,
          });
          return response.end(domain.csvReport(result));
        }
        return send(response, 200, result, id);
      }
      if (request.method === "POST" && url.pathname === "/v2/report-jobs") {
        if (!identity.roles.includes("admin"))
          throw new AppError(
            "forbidden",
            "administrator access is required",
            403,
          );
        const body = await readBody(request);
        if (
          Object.keys(body).some(
            (key) =>
              !["status", "createdFrom", "createdTo", "format"].includes(key),
          ) ||
          !["json", "csv"].includes(body.format || "json")
        )
          throw validation("invalid report job request");
        const params = new URLSearchParams();
        for (const key of ["status", "createdFrom", "createdTo"])
          if (body[key]) params.set(key, body[key]);
        const filters = reportFilters(new URL(`http://local/?${params}`));
        const job = await service.createReportJob(
          filters,
          body.format || "json",
          identity,
          { correlationId: id, traceparent: traceContext },
        );
        return send(response, 202, job, id, {
          location: `/v2/report-jobs/${job.jobId}`,
        });
      }
      const downloadMatch = url.pathname.match(
        /^\/v2\/report-jobs\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/download$/i,
      );
      if (request.method === "GET" && downloadMatch) {
        const job = await service.getReportJob(downloadMatch[1], identity);
        if (!job) throw new AppError("not_found", "report job not found", 404);
        if (job.status !== "SUCCEEDED" || !job.result?.artifactId)
          throw new AppError(
            "conflict",
            "report artifact is not available",
            409,
          );
        if (!artifactStore)
          throw new AppError(
            "unavailable",
            "report download is unavailable",
            503,
          );
        const url = await artifactStore.presign(
          job.result.artifactId,
          reportDownloadExpiresSeconds,
        );
        return send(
          response,
          200,
          {
            url,
            expiresAt: new Date(
              Date.now() + reportDownloadExpiresSeconds * 1000,
            ).toISOString(),
          },
          id,
          { "cache-control": "no-store" },
        );
      }
      const jobMatch = url.pathname.match(
        /^\/v2\/report-jobs\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      if (request.method === "GET" && jobMatch) {
        const job = await service.getReportJob(jobMatch[1], identity);
        if (!job) throw new AppError("not_found", "report job not found", 404);
        return send(response, 200, job, id);
      }
      const match = url.pathname.match(
        /^\/v1\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
      );
      if (!match) throw new AppError("not_found", "resource not found", 404);
      if (request.method === "GET") {
        const order = await service.getOrder(match[1], identity);
        if (!order) throw new AppError("not_found", "order not found", 404);
        return send(response, 200, order, id);
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        if (
          !body ||
          Object.keys(body).some((key) => key !== "targetStatus") ||
          !domain.STATUSES.includes(body.targetStatus)
        )
          throw validation("invalid target status");
        const order = await service.transition(
          match[1],
          body.targetStatus,
          identity,
        );
        if (!order) throw new AppError("not_found", "order not found", 404);
        return send(response, 200, order, id);
      }
      throw new AppError("not_found", "resource not found", 404);
    } catch (error) {
      outcome = error instanceof AppError ? error.code : "internal_error";
      sendError(response, error, id);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      logger({
        timestamp: new Date().toISOString(),
        event: "request.completed",
        service: "order-reference-service",
        correlationId: id,
        ...(trace ? { traceId: trace } : {}),
        method: request.method,
        route,
        status: response.statusCode,
        durationMs,
        outcome,
      });
      telemetry.endHttp(requestSpan, {
        method: request.method,
        route,
        status: response.statusCode,
        durationMs,
        outcome,
      });
    }
  });
  server.draining = false;
  server.repository = repository;
  server.initialization = initialization;
  server.shutdown = async () => {
    if (server.draining) return;
    server.draining = true;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await repository.close();
  };
  return server;
}

if (require.main === module)
  Promise.resolve()
    .then(() => {
      const { readRuntimeConfig } = require("../runtime/config");
      const {
        createRepository,
        createAuthenticator,
        createArtifactStore,
      } = require("../runtime/factory");
      const config = readRuntimeConfig("api");
      const repository = createRepository(config);
      const server = createServer({
        repository,
        authenticator: createAuthenticator(config),
        artifactStore:
          config.environment === "local" ? null : createArtifactStore(config),
        reportDownloadExpiresSeconds:
          config.reportDownloadExpiresSeconds || 300,
        cursorSecret: config.cursorSigningSecret,
      });
      const shutdown = () => {
        const timer = setTimeout(() => process.exit(1), 10_000);
        timer.unref();
        server
          .shutdown()
          .then(() => {
            clearTimeout(timer);
            process.exit(0);
          })
          .catch(() => process.exit(1));
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
      server.listen(PORT, "0.0.0.0", () =>
        defaultLogger({
          timestamp: new Date().toISOString(),
          event: "server.started",
          service: "order-reference-service",
          port: PORT,
        }),
      );
      return server;
    })
    .catch(() => {
      defaultLogger({
        timestamp: new Date().toISOString(),
        event: "server.start_failed",
        service: "order-reference-service",
        errorCode: "configuration_error",
      });
      process.exitCode = 1;
    });

module.exports = {
  TOKENS: DEFAULT_FIXTURES,
  configuredTokens,
  configuredAuthenticator,
  createServer,
  normalizedRoute,
};
