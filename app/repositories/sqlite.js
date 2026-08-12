const crypto = require("node:crypto");
const { SCHEMA_VERSION, seedProducts } = require("../baseline/db");
const { conflict, unavailable } = require("../core/errors");

function hydrateOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.order_id))
      orders.set(row.order_id, {
        orderId: row.order_id,
        customerReference: row.customer_reference,
        status: row.status,
        lineItems: [],
        total: { minorUnits: row.total_minor_units, currency: row.currency },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    if (row.line_sku)
      orders.get(row.order_id).lineItems.push({
        sku: row.line_sku,
        name: row.line_name,
        quantity: row.line_quantity,
        unitPrice: {
          minorUnits: row.unit_price_minor_units,
          currency: row.line_currency,
        },
        lineTotal: {
          minorUnits: row.line_total_minor_units,
          currency: row.line_currency,
        },
      });
  }
  return [...orders.values()];
}

const SELECT_ORDER = `SELECT o.*, l.sku AS line_sku, l.name AS line_name,
  l.quantity AS line_quantity, l.unit_price_minor_units, l.currency AS line_currency,
  l.line_total_minor_units FROM orders o LEFT JOIN order_lines l ON l.order_id = o.order_id`;

class SqliteRepository {
  constructor(db) {
    this.db = db;
  }

  async initialize() {
    seedProducts(this.db);
  }

  async ready() {
    try {
      const row = this.db
        .prepare("SELECT version FROM schema_metadata WHERE singleton = 1")
        .get();
      return row?.version === SCHEMA_VERSION;
    } catch {
      return false;
    }
  }

  async close() {
    this.db.close();
  }

  async listProducts() {
    return this.db
      .prepare(
        "SELECT sku, name, price_minor_units AS minorUnits, currency FROM products ORDER BY sku",
      )
      .all()
      .map((row) => ({
        sku: row.sku,
        name: row.name,
        price: { minorUnits: row.minorUnits, currency: row.currency },
      }));
  }

  async createOrder(command) {
    const prior = this.db
      .prepare(
        "SELECT payload_hash, resource_id, expires_at FROM idempotency_records WHERE principal = ? AND endpoint = ? AND key_digest = ?",
      )
      .get(command.principal, command.endpoint, command.keyDigest);
    if (prior && prior.expires_at > command.now) {
      if (prior.payload_hash !== command.payloadHash)
        throw conflict("idempotency key conflicts with a different request");
      return {
        order: await this.getOrder(prior.resource_id, command.principal, true),
        replayed: true,
      };
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "DELETE FROM idempotency_records WHERE principal = ? AND endpoint = ? AND key_digest = ? AND expires_at <= ?",
        )
        .run(
          command.principal,
          command.endpoint,
          command.keyDigest,
          command.now,
        );
      if (prior)
        this.db
          .prepare(
            "DELETE FROM idempotency_records WHERE principal = ? AND endpoint = ? AND key_digest = ?",
          )
          .run(command.principal, command.endpoint, command.keyDigest);
      this.db
        .prepare(
          "INSERT INTO orders (order_id, customer_reference, status, total_minor_units, currency, idempotency_key, principal, payload_hash, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, 'USD', ?, ?, ?, ?, ?)",
        )
        .run(
          command.orderId,
          command.customerReference,
          command.totalMinorUnits,
          command.keyDigest,
          command.principal,
          command.payloadHash,
          command.now,
          command.now,
        );
      const insert = this.db.prepare(
        "INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_minor_units, currency, line_total_minor_units) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const line of command.lineItems)
        insert.run(
          command.orderId,
          line.sku,
          line.name,
          line.quantity,
          line.unitMinorUnits,
          line.currency,
          line.lineTotalMinorUnits,
        );
      this.db
        .prepare(
          "INSERT INTO idempotency_records (principal, endpoint, key_digest, payload_hash, resource_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          command.principal,
          command.endpoint,
          command.keyDigest,
          command.payloadHash,
          command.orderId,
          command.now,
          command.expiresAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) {
        const concurrent = this.db
          .prepare(
            "SELECT payload_hash, resource_id FROM idempotency_records WHERE principal = ? AND endpoint = ? AND key_digest = ?",
          )
          .get(command.principal, command.endpoint, command.keyDigest);
        if (concurrent?.payload_hash === command.payloadHash)
          return {
            order: await this.getOrder(
              concurrent.resource_id,
              command.principal,
              true,
            ),
            replayed: true,
          };
        throw conflict("idempotency key conflicts with a different request");
      }
      throw error;
    }
    return {
      order: await this.getOrder(command.orderId, command.principal, true),
      replayed: false,
    };
  }

  async getOrder(orderId, principal, admin = false) {
    const rows = this.db
      .prepare(
        `${SELECT_ORDER} WHERE o.order_id = ? ${admin ? "" : "AND o.principal = ?"} ORDER BY l.sku`,
      )
      .all(...(admin ? [orderId] : [orderId, principal]));
    return hydrateOrders(rows)[0] || null;
  }

  async listOrders({ status, limit, position, principal, admin }) {
    const where = [];
    const values = [];
    if (!admin) {
      where.push("principal = ?");
      values.push(principal);
    }
    if (status) {
      where.push("status = ?");
      values.push(status);
    }
    if (position) {
      where.push("(created_at < ? OR (created_at = ? AND order_id < ?))");
      values.push(position.createdAt, position.createdAt, position.orderId);
    }
    const headers = this.db
      .prepare(
        `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, order_id DESC LIMIT ?`,
      )
      .all(...values, limit + 1);
    const selected = headers.slice(0, limit);
    if (!selected.length) return { items: [], hasMore: false };
    const placeholders = selected.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `${SELECT_ORDER} WHERE o.order_id IN (${placeholders}) ORDER BY o.created_at DESC, o.order_id DESC, l.sku`,
      )
      .all(...selected.map((row) => row.order_id));
    return { items: hydrateOrders(rows), hasMore: headers.length > limit };
  }

  async transition({
    orderId,
    targetStatus,
    allowedFrom,
    principal,
    admin,
    now,
  }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const scoped = this.db
        .prepare(
          `SELECT status FROM orders WHERE order_id = ? ${admin ? "" : "AND principal = ?"}`,
        )
        .get(...(admin ? [orderId] : [orderId, principal]));
      if (!scoped) {
        this.db.exec("COMMIT");
        return null;
      }
      if (!allowedFrom.includes(scoped.status))
        throw conflict(
          `invalid transition from ${scoped.status} to ${targetStatus}`,
        );
      const changed = this.db
        .prepare(
          `UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ? AND status = ? ${admin ? "" : "AND principal = ?"}`,
        )
        .run(
          targetStatus,
          now,
          orderId,
          scoped.status,
          ...(admin ? [] : [principal]),
        );
      if (changed.changes !== 1)
        throw conflict("transition could not be applied");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getOrder(orderId, principal, admin);
  }

  async report({ status, createdFrom, createdTo, limit }) {
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
    return this.db
      .prepare(
        `SELECT order_id AS orderId, status, total_minor_units AS minorUnits, currency, created_at AS createdAt, updated_at AS updatedAt FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...values, limit)
      .map((row) => ({
        orderId: row.orderId,
        status: row.status,
        total: { minorUnits: row.minorUnits, currency: row.currency },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
  }

  async createReportJob({
    principal,
    filters,
    format,
    correlationId,
    traceparent,
    now,
  }) {
    const jobId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO report_jobs (job_id, principal, status, filters_json, format, created_at, updated_at) VALUES (?, ?, 'QUEUED', ?, ?, ?, ?)",
        )
        .run(jobId, principal, JSON.stringify(filters), format, now, now);
      this.db
        .prepare(
          "INSERT INTO report_outbox (event_id, job_id, correlation_id, traceparent, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(eventId, jobId, correlationId, traceparent, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getReportJob(jobId, principal);
  }

  async getReportJob(jobId, principal, admin = false) {
    const row = this.db
      .prepare(
        `SELECT * FROM report_jobs WHERE job_id = ? ${admin ? "" : "AND principal = ?"}`,
      )
      .get(...(admin ? [jobId] : [jobId, principal]));
    if (!row) return null;
    return {
      jobId: row.job_id,
      status: row.status,
      filters: JSON.parse(row.filters_json),
      format: row.format,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error_code || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async pendingOutbox(limit = 10) {
    return this.db
      .prepare(
        "SELECT event_id AS eventId, job_id AS jobId, correlation_id AS correlationId, traceparent FROM report_outbox WHERE published_at IS NULL ORDER BY created_at LIMIT ?",
      )
      .all(limit);
  }

  async markOutboxPublished(eventId, now) {
    this.db
      .prepare(
        "UPDATE report_outbox SET published_at = ? WHERE event_id = ? AND published_at IS NULL",
      )
      .run(now, eventId);
  }

  async claimReportJob(jobId = null, leaseSeconds = 300) {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = new Date(
      now.getTime() + leaseSeconds * 1000,
    ).toISOString();
    const row = jobId
      ? this.db
          .prepare(
            "SELECT * FROM report_jobs WHERE job_id = ? AND (status = 'QUEUED' OR (status = 'RUNNING' AND lease_until <= ?))",
          )
          .get(jobId, nowIso)
      : this.db
          .prepare(
            "SELECT * FROM report_jobs WHERE status = 'QUEUED' OR (status = 'RUNNING' AND lease_until <= ?) ORDER BY created_at LIMIT 1",
          )
          .get(nowIso);
    if (!row) return null;
    const changed = this.db
      .prepare(
        "UPDATE report_jobs SET status = 'RUNNING', attempt_count = attempt_count + 1, lease_until = ?, updated_at = ? WHERE job_id = ? AND (status = 'QUEUED' OR (status = 'RUNNING' AND lease_until <= ?))",
      )
      .run(leaseUntil, nowIso, row.job_id, nowIso);
    return changed.changes === 1
      ? {
          jobId: row.job_id,
          principal: row.principal,
          filters: JSON.parse(row.filters_json),
          format: row.format,
        }
      : null;
  }

  async completeReportJob(jobId, result, now) {
    this.db
      .prepare(
        "UPDATE report_jobs SET status = 'SUCCEEDED', result_json = ?, error_code = NULL, lease_until = NULL, updated_at = ? WHERE job_id = ? AND status = 'RUNNING'",
      )
      .run(JSON.stringify(result), now, jobId);
  }

  async releaseReportJob(jobId, now) {
    this.db
      .prepare(
        "UPDATE report_jobs SET status = 'QUEUED', error_code = 'worker_retry', lease_until = NULL, updated_at = ? WHERE job_id = ? AND status = 'RUNNING'",
      )
      .run(now, jobId);
  }

  async extendReportJobLease(jobId, leaseSeconds = 300) {
    const now = new Date();
    this.db
      .prepare(
        "UPDATE report_jobs SET lease_until = ?, updated_at = ? WHERE job_id = ? AND status = 'RUNNING'",
      )
      .run(
        new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        now.toISOString(),
        jobId,
      );
  }
}

module.exports = { SqliteRepository, hydrateOrders };
