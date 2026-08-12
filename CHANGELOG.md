# Changelog

## Unreleased

- Added Wave 2 async application seams with SQLite and PostgreSQL adapters,
  external PostgreSQL migrations, transaction-safe hashed idempotency,
  row-locked transitions, signed scoped cursors, schema-aware readiness, and
  graceful pool shutdown.
- Added local-fixture and Cognito-compatible JWT authentication adapters,
  typed errors, normalized structured completion logs, W3C trace-context
  correlation, and a local-only rate-limit boundary.
- Preserved synchronous `/v1` reports and added `/v2` durable report jobs with
  an atomic outbox, queue/artifact ports, and executable local worker.
- Added pinned modular AWS SDK v3 SQS/S3 adapters, separate long-running
  publisher/worker commands, coordinated queue/database lease renewal,
  checksummed private report artifacts, and owner/admin-scoped short-lived
  download signing.
- Added a strict process-specific production contract for verified PostgreSQL
  TLS, raw secrets, Cognito group authorization, queue/bucket configuration,
  sanitized fail-fast startup, and graceful SDK/pool shutdown. AWS adapter
  behavior is fake-client tested; no cloud execution is claimed.

- Implemented and locally accepted the original Node 24 Order Reference
  Service baseline with SQLite persistence, seeded USD catalog, principal
  ownership, idempotent creation, lifecycle transitions, aggregate JSON/CSV
  reports, correlation IDs, sanitized errors, local UI gating, body limits,
  and process-local rate limiting.
- Added the deterministic reset/seed workflow and executable lint, format,
  test, and dependency-audit checks. AWS/container deployment remains a future
  modernization wave.
- Added a pinned Node 24 container, non-root/read-only Compose profile,
  `/data` persistence boundary, readiness healthcheck, graceful signal drain,
  strict production configuration validation, immutable-action CI workflow,
  and Dependabot configuration. These are local design/verification artifacts;
  hosted CI and AWS remain unverified.
