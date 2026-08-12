# Application and container security

The local container runs as the image's non-root `node` user with a read-only
root filesystem. `/data` is the only declared writable volume and contains the
SQLite database. Compose drops all Linux capabilities, enables
`no-new-privileges`, bounds PIDs and memory, and uses a small noexec `/tmp`
tmpfs.

Local fixture tokens are explicitly disposable. The target authentication
adapter validates Cognito-compatible RS256 access-token JWTs against the exact
issuer, client ID, token type, time bounds, and rotating JWKS. Ownership uses
immutable issuer-plus-subject identity. Configurable Cognito operator/admin
groups drive authorization; OAuth scopes are not claimed as authorization.
The service never issues tokens. Production startup cannot select fixture auth.

Raw idempotency keys are SHA-256 digested before persistence and excluded from
logs. Order cursors are HMAC-signed and bound to authorization/filter scope.
Outside local mode a cursor secret is mandatory. Completion logs use normalized
route templates and omit bearer values, idempotency keys, request bodies, and
customer references.

The process-local rate limiter operates only in local mode. It is deliberately
disabled for multi-replica production use; approved WAF/shared quota behavior
must be separately implemented and evidenced.

Production database connections require a raw PostgreSQL URI and verified TLS
against an injected CA bundle. There is no certificate-verification bypass.
The report queue message contains only a job UUID plus correlation and optional
trace context. The worker stores checksummed artifacts under a constrained S3
prefix and relies on an enforced private bucket with default SSE-KMS. The API
rechecks job scope and completion state before returning a bounded presigned
download; it never returns a public bucket URL. These AWS boundaries are
adapter-tested locally and are not cloud evidence.

The pinned Node 24 base image and lockfile are reviewed inputs. CI is designed
to run dependency and image scans without AWS credentials; hosted results are
not claimed until a workflow run is observed.

# Security Boundaries

Security is part of the architecture acceptance criteria.

- Keep application tasks in private subnets; expose only the intended edge
  path.
- Use least-privilege task roles and separate deployment identities.
- Store runtime secrets in Secrets Manager; never use repository secrets as
  application configuration.
- Require HTTPS, restrictive security-group relationships, and WAF rules
  appropriate to the demonstrated workload.
- Scan dependencies and container images, validate infrastructure policy, and
  review the generated artifact before any cloud operation.
- Keep Terraform state, plans, credentials, dumps, logs with sensitive data,
  and cloud metadata out of Git.
- Record threat-model assumptions, data classification, retention, and
  incident-response boundaries before claiming security evidence.

The historical repositories `nodejs-application-migration` and related
examples are not treated as secure by default. Their credentials, generated
artifacts, and old terminology are not imported.
