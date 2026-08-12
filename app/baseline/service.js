const crypto = require("node:crypto");
const { validation, conflict } = require("../core/errors");

const STATUSES = ["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED"];
const TRANSITIONS = {
  PENDING: new Set(["CONFIRMED", "CANCELLED"]),
  CONFIRMED: new Set(["FULFILLED", "CANCELLED"]),
  FULFILLED: new Set(),
  CANCELLED: new Set(),
};
const canonical = (input) =>
  JSON.stringify({
    customerReference: input.customerReference,
    lineItems: [...input.lineItems]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((item) => ({ sku: item.sku, quantity: item.quantity })),
  });
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

function validate(input, catalog) {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["customerReference", "lineItems"].includes(key),
    ) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(input.customerReference || "") ||
    !Array.isArray(input.lineItems) ||
    input.lineItems.length < 1 ||
    input.lineItems.length > 50
  )
    throw validation("invalid order request");
  const seen = new Set();
  return input.lineItems.map((item) => {
    if (
      !item ||
      Object.keys(item).some((key) => !["sku", "quantity"].includes(key)) ||
      !/^DEMO-[A-Z0-9-]{3,28}$/.test(item.sku || "") ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100 ||
      seen.has(item.sku)
    )
      throw validation("invalid line item");
    seen.add(item.sku);
    const product = catalog.find((entry) => entry.sku === item.sku);
    if (!product) throw validation("unknown SKU");
    return {
      sku: item.sku,
      name: product.name,
      quantity: item.quantity,
      unitMinorUnits: product.price.minorUnits,
      currency: product.price.currency,
      lineTotalMinorUnits: product.price.minorUnits * item.quantity,
    };
  });
}

function createOrderService({
  repository,
  cursorCodec,
  clock = () => new Date(),
  idempotencyTtlMs = 86_400_000,
}) {
  const admin = (identity) => identity.roles.includes("admin");
  return {
    async products() {
      return repository.listProducts();
    },
    async createOrder(input, idempotencyKey, identity) {
      const catalog = await repository.listProducts();
      const lineItems = validate(input, catalog);
      const totalMinorUnits = lineItems.reduce(
        (sum, line) => sum + line.lineTotalMinorUnits,
        0,
      );
      if (totalMinorUnits > 10_000_000)
        throw validation("order total exceeds maximum");
      const timestamp = clock();
      return repository.createOrder({
        orderId: crypto.randomUUID(),
        customerReference: input.customerReference,
        lineItems,
        totalMinorUnits,
        principal: identity.subject,
        endpoint: "POST /v1/orders",
        keyDigest: sha256(idempotencyKey),
        payloadHash: sha256(canonical(input)),
        now: timestamp.toISOString(),
        expiresAt: new Date(
          timestamp.getTime() + idempotencyTtlMs,
        ).toISOString(),
      });
    },
    async getOrder(orderId, identity) {
      return repository.getOrder(orderId, identity.subject, admin(identity));
    },
    async listOrders(status, limit, cursor, identity) {
      const scope = {
        principal: identity.subject,
        admin: admin(identity),
        status: status || null,
      };
      const position = cursor ? cursorCodec.decode(cursor, scope) : null;
      const page = await repository.listOrders({
        status,
        limit,
        position,
        principal: identity.subject,
        admin: admin(identity),
      });
      const last = page.hasMore ? page.items.at(-1) : null;
      return {
        items: page.items,
        nextCursor: last
          ? cursorCodec.encode(
              { createdAt: last.createdAt, orderId: last.orderId },
              scope,
            )
          : null,
      };
    },
    async transition(orderId, targetStatus, identity) {
      const allowedFrom = Object.entries(TRANSITIONS)
        .filter(([, targets]) => targets.has(targetStatus))
        .map(([status]) => status);
      if (!allowedFrom.length) throw conflict("invalid transition");
      return repository.transition({
        orderId,
        targetStatus,
        allowedFrom,
        principal: identity.subject,
        admin: admin(identity),
        now: clock().toISOString(),
      });
    },
    async report(filters) {
      const items = await repository.report(filters);
      return {
        generatedAt: clock().toISOString(),
        count: items.length,
        items,
      };
    },
    async createReportJob(filters, format, identity, context) {
      return repository.createReportJob({
        principal: identity.subject,
        filters,
        format,
        correlationId: context.correlationId,
        traceparent: context.traceparent || null,
        now: clock().toISOString(),
      });
    },
    async getReportJob(jobId, identity) {
      return repository.getReportJob(
        jobId,
        identity.subject,
        identity.roles.includes("admin"),
      );
    },
  };
}

function csvReport(result) {
  return (
    [
      "orderId,status,totalMinorUnits,currency,createdAt,updatedAt",
      ...result.items.map((order) =>
        [
          order.orderId,
          order.status,
          order.total.minorUnits,
          order.total.currency,
          order.createdAt,
          order.updatedAt,
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n") + "\n"
  );
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  canonical,
  createOrderService,
  csvReport,
};
