# ADR 005: Wave 2 application migration seams

## Status

Accepted for local implementation evidence. AWS deployment is not implied.

## Decision

Preserve the complete `/v1` HTTP contract while introducing asynchronous
domain and repository boundaries. SQLite remains the credential-free local
adapter. PostgreSQL is the managed-persistence target and uses a connection
pool, versioned external migrations, transaction-scoped idempotency locks, and
row-locked state transitions.

Identity is represented as an immutable `subject` plus authorization `roles`.
Local fixtures and Cognito-compatible access-token JWT validation implement the
same authentication port. Order ownership uses the subject, never a mutable
username or role name.

Idempotency is scoped to principal, endpoint, and a SHA-256 digest of the key.
The request fingerprint and result UUID are retained for 24 hours. Raw keys
are neither persisted nor logged. Order creation, lines, and the idempotency
record commit atomically.

Order cursors are HMAC-signed and bound to principal, admin scope, and status
filter. List hydration uses a bounded two-query pattern; aggregate reports do
not load order lines.

PostgreSQL migration is a separate command protected by an advisory lock.
Application startup never creates or changes PostgreSQL schema. Readiness
requires a reachable database at the exact supported migration version.

## Consequences

- Domain operations are asynchronous even when SQLite is selected.
- Rolling changes must use expand/contract migrations compatible with the old
  and new application task definitions.
- The cursor signing secret is required outside local mode and must be supplied
  from an approved runtime secret mechanism.
- SQLite schema evolution remains intentionally local; it is not the managed
  migration authority.
- PostgreSQL client pooling adds one pinned runtime dependency.

## Evidence boundary

Adapter parity, PostgreSQL concurrency, migrations, JWT fixtures, redaction,
and readiness can be verified locally. RDS, Cognito, Secrets Manager, ECS, and
restore behavior remain unevidenced until separately approved cloud tests run.
