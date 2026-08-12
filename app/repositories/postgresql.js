const crypto = require("node:crypto");
const { conflict } = require("../core/errors");
const { hydrateOrders } = require("./sqlite");

const EXPECTED_SCHEMA_VERSION = 1;
const SELECT_ORDER = `SELECT o.*, l.sku AS line_sku, l.name AS line_name,
  l.quantity AS line_quantity, l.unit_price_minor_units, l.currency AS line_currency,
  l.line_total_minor_units FROM orders o LEFT JOIN order_lines l ON l.order_id = o.order_id`;

const iso = (value) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
function normalize(rows) {
  return hydrateOrders(
    rows.map((row) => ({
      ...row,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    })),
  );
}

class PostgresqlRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async initialize() {}

  async ready() {
    try {
      const result = await this.pool.query(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      );
      return Number(result.rows[0].version) === EXPECTED_SCHEMA_VERSION;
    } catch {
      return false;
    }
  }

  async close() {
    await this.pool.end();
  }

  async listProducts(client = this.pool) {
    const result = await client.query(
      "SELECT sku, name, price_minor_units, currency FROM products ORDER BY sku",
    );
    return result.rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      price: {
        minorUnits: row.price_minor_units,
        currency: row.currency.trim(),
      },
    }));
  }

  async createOrder(command) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          JSON.stringify([
            command.principal,
            command.endpoint,
            command.keyDigest,
          ]),
        ],
      );
      await client.query(
        "DELETE FROM idempotency_records WHERE principal = $1 AND endpoint = $2 AND key_digest = $3 AND expires_at <= $4",
        [command.principal, command.endpoint, command.keyDigest, command.now],
      );
      const prior = await client.query(
        "SELECT payload_hash, resource_id, expires_at FROM idempotency_records WHERE principal = $1 AND endpoint = $2 AND key_digest = $3 FOR UPDATE",
        [command.principal, command.endpoint, command.keyDigest],
      );
      if (prior.rowCount && prior.rows[0].expires_at > new Date(command.now)) {
        if (prior.rows[0].payload_hash !== command.payloadHash)
          throw conflict("idempotency key conflicts with a different request");
        const order = await this.getOrderWithClient(
          client,
          prior.rows[0].resource_id,
          command.principal,
          true,
        );
        await client.query("COMMIT");
        return { order, replayed: true };
      }
      if (prior.rowCount)
        await client.query(
          "DELETE FROM idempotency_records WHERE principal = $1 AND endpoint = $2 AND key_digest = $3",
          [command.principal, command.endpoint, command.keyDigest],
        );
      await client.query(
        "INSERT INTO orders (order_id, customer_reference, status, total_minor_units, currency, principal, payload_hash, created_at, updated_at) VALUES ($1, $2, 'PENDING', $3, 'USD', $4, $5, $6, $6)",
        [
          command.orderId,
          command.customerReference,
          command.totalMinorUnits,
          command.principal,
          command.payloadHash,
          command.now,
        ],
      );
      for (const line of command.lineItems)
        await client.query(
          "INSERT INTO order_lines (order_id, sku, name, quantity, unit_price_minor_units, currency, line_total_minor_units) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            command.orderId,
            line.sku,
            line.name,
            line.quantity,
            line.unitMinorUnits,
            line.currency,
            line.lineTotalMinorUnits,
          ],
        );
      await client.query(
        "INSERT INTO idempotency_records (principal, endpoint, key_digest, payload_hash, resource_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          command.principal,
          command.endpoint,
          command.keyDigest,
          command.payloadHash,
          command.orderId,
          command.now,
          command.expiresAt,
        ],
      );
      const order = await this.getOrderWithClient(
        client,
        command.orderId,
        command.principal,
        true,
      );
      await client.query("COMMIT");
      return { order, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrderWithClient(client, orderId, principal, admin = false) {
    const values = admin ? [orderId] : [orderId, principal];
    const result = await client.query(
      `${SELECT_ORDER} WHERE o.order_id = $1 ${admin ? "" : "AND o.principal = $2"} ORDER BY l.sku`,
      values,
    );
    return normalize(result.rows)[0] || null;
  }

  async getOrder(orderId, principal, admin = false) {
    return this.getOrderWithClient(this.pool, orderId, principal, admin);
  }

  async listOrders({ status, limit, position, principal, admin }) {
    const values = [];
    const where = [];
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (!admin) where.push(`principal = ${bind(principal)}`);
    if (status) where.push(`status = ${bind(status)}`);
    if (position) {
      const created = bind(position.createdAt);
      const createdAgain = bind(position.createdAt);
      const order = bind(position.orderId);
      where.push(
        `(created_at < ${created} OR (created_at = ${createdAgain} AND order_id < ${order}))`,
      );
    }
    const limitBind = bind(limit + 1);
    const headers = await this.pool.query(
      `SELECT order_id FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, order_id DESC LIMIT ${limitBind}`,
      values,
    );
    const selected = headers.rows.slice(0, limit).map((row) => row.order_id);
    if (!selected.length) return { items: [], hasMore: false };
    const result = await this.pool.query(
      `${SELECT_ORDER} WHERE o.order_id = ANY($1::uuid[]) ORDER BY o.created_at DESC, o.order_id DESC, l.sku`,
      [selected],
    );
    return { items: normalize(result.rows), hasMore: headers.rowCount > limit };
  }

  async transition({
    orderId,
    targetStatus,
    allowedFrom,
    principal,
    admin,
    now,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scoped = await client.query(
        `SELECT status FROM orders WHERE order_id = $1 ${admin ? "" : "AND principal = $2"} FOR UPDATE`,
        admin ? [orderId] : [orderId, principal],
      );
      if (!scoped.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      if (!allowedFrom.includes(scoped.rows[0].status))
        throw conflict(
          `invalid transition from ${scoped.rows[0].status} to ${targetStatus}`,
        );
      await client.query(
        "UPDATE orders SET status = $1, updated_at = $2 WHERE order_id = $3 AND status = $4",
        [targetStatus, now, orderId, scoped.rows[0].status],
      );
      const order = await this.getOrderWithClient(
        client,
        orderId,
        principal,
        admin,
      );
      await client.query("COMMIT");
      return order;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async report({ status, createdFrom, createdTo, limit }) {
    const values = [];
    const where = [];
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (status) where.push(`status = ${bind(status)}`);
    if (createdFrom) where.push(`created_at >= ${bind(createdFrom)}`);
    if (createdTo) where.push(`created_at <= ${bind(createdTo)}`);
    const limitBind = bind(limit);
    const result = await this.pool.query(
      `SELECT order_id, status, total_minor_units, currency, created_at, updated_at FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ${limitBind}`,
      values,
    );
    return result.rows.map((row) => ({
      orderId: row.order_id,
      status: row.status,
      total: {
        minorUnits: row.total_minor_units,
        currency: row.currency.trim(),
      },
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO report_jobs (job_id, principal, status, filters_json, format, created_at, updated_at) VALUES ($1, $2, 'QUEUED', $3, $4, $5, $5)",
        [jobId, principal, filters, format, now],
      );
      await client.query(
        "INSERT INTO report_outbox (event_id, job_id, correlation_id, traceparent, created_at) VALUES ($1, $2, $3, $4, $5)",
        [eventId, jobId, correlationId, traceparent, now],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.getReportJob(jobId, principal);
  }

  async getReportJob(jobId, principal, admin = false) {
    const result = await this.pool.query(
      `SELECT * FROM report_jobs WHERE job_id = $1 ${admin ? "" : "AND principal = $2"}`,
      admin ? [jobId] : [jobId, principal],
    );
    const row = result.rows[0];
    return row
      ? {
          jobId: row.job_id,
          status: row.status,
          filters: row.filters_json,
          format: row.format,
          result: row.result_json,
          error: row.error_code,
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        }
      : null;
  }

  async pendingOutbox(limit = 10) {
    const result = await this.pool.query(
      "SELECT event_id, job_id, correlation_id, traceparent FROM report_outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1",
      [limit],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      jobId: row.job_id,
      correlationId: row.correlation_id,
      traceparent: row.traceparent,
    }));
  }

  async markOutboxPublished(eventId, now) {
    await this.pool.query(
      "UPDATE report_outbox SET published_at = $1 WHERE event_id = $2 AND published_at IS NULL",
      [now, eventId],
    );
  }

  async claimReportJob(jobId = null, leaseSeconds = 300) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = jobId
        ? await client.query(
            "SELECT * FROM report_jobs WHERE job_id = $1 AND (status = 'QUEUED' OR (status = 'RUNNING' AND lease_until <= clock_timestamp())) FOR UPDATE SKIP LOCKED",
            [jobId],
          )
        : await client.query(
            "SELECT * FROM report_jobs WHERE status = 'QUEUED' OR (status = 'RUNNING' AND lease_until <= clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
          );
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        "UPDATE report_jobs SET status = 'RUNNING', attempt_count = attempt_count + 1, lease_until = clock_timestamp() + make_interval(secs => $2), updated_at = clock_timestamp() WHERE job_id = $1",
        [row.job_id, leaseSeconds],
      );
      await client.query("COMMIT");
      return {
        jobId: row.job_id,
        principal: row.principal,
        filters: row.filters_json,
        format: row.format,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async completeReportJob(jobId, result, now) {
    await this.pool.query(
      "UPDATE report_jobs SET status = 'SUCCEEDED', result_json = $1, error_code = NULL, lease_until = NULL, updated_at = $2 WHERE job_id = $3 AND status = 'RUNNING'",
      [result, now, jobId],
    );
  }

  async releaseReportJob(jobId, now) {
    await this.pool.query(
      "UPDATE report_jobs SET status = 'QUEUED', error_code = 'worker_retry', lease_until = NULL, updated_at = $1 WHERE job_id = $2 AND status = 'RUNNING'",
      [now, jobId],
    );
  }

  async extendReportJobLease(jobId, leaseSeconds = 300) {
    await this.pool.query(
      "UPDATE report_jobs SET lease_until = clock_timestamp() + make_interval(secs => $2), updated_at = clock_timestamp() WHERE job_id = $1 AND status = 'RUNNING'",
      [jobId, leaseSeconds],
    );
  }
}

module.exports = { EXPECTED_SCHEMA_VERSION, PostgresqlRepository };
