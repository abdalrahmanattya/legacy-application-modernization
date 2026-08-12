# Wave 2 application exit criteria

## Locally verifiable gates

- All Wave 0/1 `/v1` behavior remains green against SQLite.
- SQLite and PostgreSQL satisfy the repository/HTTP compatibility contract.
- Empty PostgreSQL migration is repeatable; unsupported schema versions make
  readiness fail.
- Concurrent identical idempotent creates yield one creation and replays of the
  same UUID; a different request yields `409`.
- Concurrent duplicate transitions yield one legal state change and conflicts.
- Stored idempotency keys are SHA-256 digests and expire after 24 hours.
- Cursor tampering and reuse under another principal or status scope return
  `400`.
- Cognito-compatible fixtures reject wrong signature algorithm, issuer,
  client, token type, expiry, not-before time, and unknown signing key; JWKS
  key rotation is exercised without network dependency.
- Completion logs use route templates and contain no bearer, idempotency key,
  customer reference, or request body. Valid W3C trace context is propagated
  as an OTel-compatible trace correlation seam.
- `/v2` job acceptance, outbox publication, queue receipt, worker execution,
  artifact storage, status polling, and authenticated complete-only download
  work through local ports while `/v1` synchronous reports remain available.
- Injected AWS SDK clients verify the SQS message allowlist and lifecycle,
  visibility renewal, S3 checksum/metadata, bounded private presigning, and SDK
  client shutdown without credentials or network access.
- Strict production configuration rejects missing or ambiguous raw secrets,
  non-PostgreSQL persistence, non-JWT API auth, unverified database TLS, and
  invalid worker lease/visibility settings without logging configuration
  values.
- Duplicate deliveries are acknowledged idempotently; handled failures release
  the database lease and requeue, while expired worker leases are reclaimable.
- SIGTERM stops readiness, drains HTTP requests, and closes the selected
  repository pool within the bounded container stop period.

## Cloud-only gates

RDS availability/failover/restore, Cognito-issued tokens, SQS retries/DLQ and
visibility behavior, S3/KMS encryption/lifecycle/presigned download behavior,
ECS multi-task draining, CloudWatch telemetry, WAF rate limiting, and
end-to-end traces remain unverified until separately approved cloud execution
occurs.

## Rollback

Application rollback requires the previous task image and a backward-compatible
database schema. Do not reverse a PostgreSQL migration during an application
rollback. Expand/contract migrations must leave the previous version operable
until the rollout and rollback window closes.
