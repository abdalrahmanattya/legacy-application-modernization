# Application runtime and ECS task contract

This document is the exact application-facing contract for the Wave 2
infrastructure lane. It defines process commands, environment variables,
Secrets Manager values, IAM actions, and shutdown coordination. It does not
claim that an ECS task or AWS service has been deployed.

## One image, four commands

| Process | Container command | Network listener | Purpose |
|---|---|---|---|
| API | `node app/baseline/server.js` | TCP `3000` | `/v1`, `/v2`, liveness, readiness, presigned downloads |
| Outbox publisher | `node app/processes/outbox-publisher.js` | None | PostgreSQL outbox to SQS Standard queue |
| Report worker | `node app/processes/report-worker.js` | None | SQS job to PostgreSQL report to private S3 artifact |
| Migration task | `node scripts/postgresql/migrate.js` | None | Advisory-locked forward PostgreSQL migration |

The publisher and worker are separate ECS services/tasks, not sidecars in the
API task. Only the API is registered with an ALB target group. Publisher and
worker health is process-essential exit status plus retained structured logs;
they do not expose artificial HTTP health ports.

## Shared production values

| Name | Source | Exact requirement |
|---|---|---|
| `ENVIRONMENT` | task environment | `production` |
| `DATABASE_ENGINE` | task environment | `postgresql` |
| `DATABASE_URL` | Secrets Manager | Raw PostgreSQL URI string, not a JSON object |
| `DATABASE_SSL_MODE` | task environment | `require` |
| `DATABASE_SSL_CA_PATH` | task environment | Preferred absolute path to a mounted/baked PEM RDS CA bundle, for example `/app/certs/global-bundle.pem` |
| `DATABASE_SSL_CA` | task environment or secret | Alternative inline raw PEM bundle; literal `\n` is accepted for local/test injection |
| `DB_POOL_MAX` | task environment | Optional integer `1..100`, default `10` |
| `DB_CONNECT_TIMEOUT_MS` | task environment | Optional `100..30000`, default `3000` |
| `DB_STATEMENT_TIMEOUT_MS` | task environment | Optional `100..120000`, default `5000` |

Exactly one CA source is required. The RDS CA bundle is public trust material,
not an application password. The preferred ECS contract bakes or mounts the
reviewed bundle at `DATABASE_SSL_CA_PATH`; inline `DATABASE_SSL_CA` remains for
tests or controlled injection. Relative/unreadable paths, ambiguous dual
sources, and invalid PEM content fail before startup. The application does not
download a CA bundle at startup and does not support a TLS-verification bypass.

## API-only values

| Name | Source | Exact requirement |
|---|---|---|
| `AUTH_MODE` | task environment | `jwt` |
| `JWT_ISSUER` | task environment | Exact HTTPS Cognito user-pool issuer |
| `JWT_CLIENT_ID` | task environment | Exact accepted app client ID |
| `JWT_ADMIN_GROUP` | task environment | Optional Cognito group, default `admin` |
| `JWT_OPERATOR_GROUP` | task environment | Optional Cognito group, default `operator` |
| `CURSOR_SIGNING_SECRET` | Secrets Manager | Raw string of at least 32 characters, not JSON |
| `AWS_REGION` | task environment | Region used by the S3 SDK client |
| `REPORT_BUCKET_NAME` | task environment | Private report-artifact bucket name |
| `REPORT_DOWNLOAD_EXPIRES_SECONDS` | task environment | Optional `60..900`, default `300` |

JWT validation requires RS256, exact issuer, `token_use=access`, exact
`client_id`, expiration/not-before validity, signature, and a known JWKS key.
The immutable ownership key is `issuer#sub`. The configured operator group
allows owner-scoped order operations; the configured admin group allows all
orders and report administration. A valid token without either group receives
`403`. OAuth scopes are not used for route authorization and are not claimed.
`OPERATOR_A_TOKEN`, `OPERATOR_B_TOKEN`, and `ADMIN_TOKEN` are local fixtures and
must not appear in a production task definition.

The API role needs `s3:GetObject` only for `reports/*` in the report bucket so
it can create a short-lived signature. `GET
/v2/report-jobs/{jobId}/download` checks job ownership/admin scope and
`SUCCEEDED` state before returning a `Cache-Control: no-store` URL.

## Publisher-only values

| Name | Source | Exact requirement |
|---|---|---|
| `AWS_REGION` | task environment | Queue region |
| `REPORT_QUEUE_URL` | task environment | SQS Standard queue URL |
| `REPORT_VISIBILITY_TIMEOUT_SECONDS` | task environment | Optional `30..43200`, default `300` |
| `REPORT_HEARTBEAT_SECONDS` | task environment | Optional and lower than visibility timeout; default `120` |

The publisher role needs `sqs:SendMessage` on the report queue. Queue messages
contain only schema version, report-job UUID, correlation ID, and optional W3C
trace context. Sending succeeds before the outbox row is marked published, so
duplicate delivery is expected and safe.

## Worker-only values

The worker uses all publisher values plus `REPORT_BUCKET_NAME`. Its role needs:

- `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and
  `sqs:ChangeMessageVisibility` on the report queue;
- `s3:PutObject` on `reports/*` in the report bucket; and
- the KMS permissions required by the bucket's default customer-managed
  SSE-KMS key policy.

The S3 bucket must be private, block all public access, enforce TLS, use
default SSE-KMS encryption, and apply the approved artifact lifecycle. The
adapter deliberately omits a per-object KMS key override so bucket-default
SSE-KMS policy remains authoritative. It supplies a SHA-256 checksum and safe
job/correlation metadata. The API never returns a bucket URL or public object.

The worker's SQS visibility timeout and PostgreSQL job lease are both 300
seconds by default and are renewed every 120 seconds. A successful artifact
write and database completion precede message deletion. A handled failure
releases the job lease and resets message visibility. A process crash leaves
both leases to expire, allowing safe redelivery. Queue retry count, retention,
DLQ, and redrive are infrastructure policy rather than application claims.

## Shutdown and deployment settings

- API: readiness becomes unavailable, HTTP drains, and the PostgreSQL pool
  closes asynchronously. Configure ECS `stopTimeout` to at least 30 seconds.
- Publisher/worker: SIGTERM stops the next loop iteration, allows an in-flight
  SDK/database operation to settle, destroys SDK clients, and closes the pool.
  A 25-second internal guard exits nonzero if drain cannot finish.
- Worker crash/forced termination is safe through SQS visibility plus the
  database lease. ECS `stopTimeout` should be at least 30 seconds.
- Migration is a one-off task before service rollout. Application tasks never
  mutate PostgreSQL schema at startup.

All modes fail before serving/processing when a required value is missing,
ambiguous, out of bounds, or would disable database certificate verification.
Startup logs contain only `configuration_error`, never a raw secret or value.
