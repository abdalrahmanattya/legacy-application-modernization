const crypto = require("node:crypto");
const STATUSES = ["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED"];
const TRANSITIONS = {
  PENDING: new Set(["CONFIRMED", "CANCELLED"]),
  CONFIRMED: new Set(["FULFILLED", "CANCELLED"]),
  FULFILLED: new Set(),
  CANCELLED: new Set(),
};
const now = () => new Date().toISOString();
const canonical = (input) =>
  JSON.stringify({
    customerReference: input.customerReference,
    lineItems: [...input.lineItems]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((item) => ({ sku: item.sku, quantity: item.quantity })),
  });
const hash = (input) =>
  crypto.createHash("sha256").update(canonical(input)).digest("hex");
function products(db) {
  return db
    .prepare(
      "SELECT sku, name, price_minor_units AS minorUnits, currency FROM products ORDER BY sku",
    )
    .all()
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      price: { minorUnits: p.minorUnits, currency: p.currency },
    }));
}
function mapOrder(db, row) {
  if (!row) return null;
  const lineItems = db
    .prepare(
      "SELECT sku, name, quantity, unit_price_minor_units AS unitMinor, currency, line_total_minor_units AS lineTotalMinor FROM order_lines WHERE order_id = ? ORDER BY sku",
    )
    .all(row.order_id)
    .map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: { minorUnits: l.unitMinor, currency: l.currency },
      lineTotal: { minorUnits: l.lineTotalMinor, currency: l.currency },
    }));
  return {
    orderId: row.order_id,
    customerReference: row.customer_reference,
    status: row.status,
    lineItems,
    total: { minorUnits: row.total_minor_units, currency: row.currency },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
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
    throw new Error("invalid order request");
  const seen = new Set();
  const resolved = [];
  for (const item of input.lineItems) {
    if (
      !item ||
      Object.keys(item).some((key) => !["sku", "quantity"].includes(key)) ||
      !/^DEMO-[A-Z0-9-]{3,28}$/.test(item.sku || "") ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100 ||
      seen.has(item.sku)
    )
      throw new Error("invalid line item");
    seen.add(item.sku);
    const p = catalog.find((product) => product.sku === item.sku);
    if (!p) throw new Error("unknown SKU");
    resolved.push({ ...item, p });
  }
  return resolved;
}
function createOrder(db, input, idempotencyKey, principal) {
  const catalog = products(db);
  const resolved = validate(input, catalog);
  const payloadHash = hash(input);
  const prior = db
    .prepare("SELECT * FROM orders WHERE principal = ? AND idempotency_key = ?")
    .get(principal, idempotencyKey);
  if (prior) {
    if (prior.payload_hash !== payloadHash)
      throw new Error("idempotency key conflicts with a different request");
    return { order: mapOrder(db, prior), replayed: true };
  }
  const total = resolved.reduce(
    (sum, i) => sum + i.p.price.minorUnits * i.quantity,
    0,
  );
  if (total > 10000000) throw new Error("order total exceeds maximum");
  const id = crypto.randomUUID();
  const timestamp = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO orders (order_id, customer_reference, status, total_minor_units, currency, idempotency_key, principal, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.customerReference,
      "PENDING",
      total,
      "USD",
      idempotencyKey,
      principal,
      payloadHash,
      timestamp,
      timestamp,
    );
    const insert = db.prepare(
      "INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_minor_units, currency, line_total_minor_units) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const item of resolved)
      insert.run(
        id,
        item.sku,
        item.p.name,
        item.quantity,
        item.p.price.minorUnits,
        item.p.price.currency,
        item.p.price.minorUnits * item.quantity,
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return {
    order: mapOrder(
      db,
      db.prepare("SELECT * FROM orders WHERE order_id = ?").get(id),
    ),
    replayed: false,
  };
}
function getOrder(db, id, principal, admin = false) {
  const row = db
    .prepare(
      `SELECT * FROM orders WHERE order_id = ? ${admin ? "" : "AND principal = ?"}`,
    )
    .get(...(admin ? [id] : [id, principal]));
  return mapOrder(db, row);
}
function listOrders(db, status, limit, cursor, principal, admin = false) {
  let where = [];
  let values = [];
  if (!admin) {
    where.push("principal = ?");
    values.push(principal);
  }
  if (status) {
    where.push("status = ?");
    values.push(status);
  }
  if (cursor) {
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch {
      throw new Error("invalid cursor");
    }
    if (!decoded.createdAt || !decoded.orderId)
      throw new Error("invalid cursor");
    where.push("(created_at < ? OR (created_at = ? AND order_id < ?))");
    values.push(decoded.createdAt, decoded.createdAt, decoded.orderId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, order_id DESC LIMIT ?`,
    )
    .all(...values, limit + 1);
  const items = rows.slice(0, limit).map((row) => mapOrder(db, row));
  const last = rows.length > limit ? rows[limit - 1] : null;
  return {
    items,
    nextCursor: last
      ? Buffer.from(
          JSON.stringify({
            createdAt: last.created_at,
            orderId: last.order_id,
          }),
        ).toString("base64url")
      : null,
  };
}
function transition(db, id, targetStatus, principal, admin = false) {
  const row = db
    .prepare(
      `SELECT * FROM orders WHERE order_id = ? ${admin ? "" : "AND principal = ?"}`,
    )
    .get(...(admin ? [id] : [id, principal]));
  if (!row) return null;
  if (!TRANSITIONS[row.status]?.has(targetStatus))
    throw new Error(`invalid transition from ${row.status} to ${targetStatus}`);
  const result = db
    .prepare(
      `UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ? AND status = ? ${admin ? "" : "AND principal = ?"}`,
    )
    .run(targetStatus, now(), id, row.status, ...(admin ? [] : [principal]));
  if (result.changes !== 1) throw new Error("transition could not be applied");
  return getOrder(db, id, principal, admin);
}
function report(db, status, createdFrom, createdTo, limit) {
  const where = [];
  const values = [];
  if (status) {
    where.push("status = ?");
    values.push(status);
  }
  if (createdFrom) {
    where.push("created_at >= ?");
    values.push(createdFrom);
  }
  if (createdTo) {
    where.push("created_at <= ?");
    values.push(createdTo);
  }
  const rows = db
    .prepare(
      `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...values, limit);
  return {
    generatedAt: now(),
    count: rows.length,
    items: rows.map((row) => {
      const o = mapOrder(db, row);
      return {
        orderId: o.orderId,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    }),
  };
}
function csvReport(result) {
  return (
    [
      "orderId,status,totalMinorUnits,currency,createdAt,updatedAt",
      ...result.items.map((o) =>
        [
          o.orderId,
          o.status,
          o.total.minorUnits,
          o.total.currency,
          o.createdAt,
          o.updatedAt,
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n") + "\n"
  );
}
module.exports = {
  STATUSES,
  TRANSITIONS,
  products,
  createOrder,
  getOrder,
  listOrders,
  transition,
  report,
  csvReport,
  canonical,
};
