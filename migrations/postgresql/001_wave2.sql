CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE products (
  sku text PRIMARY KEY,
  name text NOT NULL,
  price_minor_units integer NOT NULL CHECK (price_minor_units > 0),
  currency char(3) NOT NULL
);

CREATE TABLE orders (
  order_id uuid PRIMARY KEY,
  customer_reference varchar(128) NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FULFILLED', 'CANCELLED')),
  total_minor_units integer NOT NULL CHECK (total_minor_units BETWEEN 0 AND 10000000),
  currency char(3) NOT NULL,
  principal text NOT NULL,
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE order_lines (
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  sku text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_minor_units integer NOT NULL CHECK (unit_price_minor_units > 0),
  currency char(3) NOT NULL,
  line_total_minor_units integer NOT NULL CHECK (line_total_minor_units > 0),
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE idempotency_records (
  principal text NOT NULL,
  endpoint text NOT NULL,
  key_digest char(64) NOT NULL,
  payload_hash char(64) NOT NULL,
  resource_id uuid NOT NULL REFERENCES orders(order_id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal, endpoint, key_digest)
);

CREATE TABLE report_jobs (
  job_id uuid PRIMARY KEY,
  principal text NOT NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  filters_json jsonb NOT NULL,
  format text NOT NULL CHECK (format IN ('json', 'csv')),
  result_json jsonb,
  error_code text,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE report_outbox (
  event_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES report_jobs(job_id),
  correlation_id varchar(64) NOT NULL,
  traceparent varchar(55),
  published_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX idx_orders_principal_page ON orders(principal, created_at DESC, order_id DESC);
CREATE INDEX idx_orders_admin_page ON orders(created_at DESC, order_id DESC);
CREATE INDEX idx_orders_principal_status_page ON orders(principal, status, created_at DESC, order_id DESC);
CREATE INDEX idx_orders_status_page ON orders(status, created_at DESC, order_id DESC);
CREATE INDEX idx_idempotency_expiry ON idempotency_records(expires_at);
CREATE INDEX idx_report_jobs_queue ON report_jobs(status, lease_until, created_at);

INSERT INTO products (sku, name, price_minor_units, currency) VALUES
  ('DEMO-PLATFORM-001', 'Platform Foundations Workshop', 12500, 'USD'),
  ('DEMO-DATA-002', 'Data Pipeline Review', 9000, 'USD'),
  ('DEMO-AI-003', 'Applied AI Architecture Session', 15000, 'USD')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES (1);
