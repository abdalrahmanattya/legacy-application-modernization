# ADR 006: Versioned asynchronous reports

## Status

Accepted for local ports, production adapter seams, and local worker evidence.

## Decision

The bounded synchronous `GET /v1/reports/orders` route remains unchanged.
Asynchronous execution is introduced as a versioned resource:

- `POST /v2/report-jobs` accepts the existing status/date filters and output
  format, then returns `202` and a job `Location`.
- `GET /v2/report-jobs/{jobId}` returns owner-scoped durable job state.

Job state and an outbox event commit in one database transaction. A publisher
port moves event references to a queue port. An idempotent worker claims a
specific queued job, creates a privacy-minimized artifact, stores it through an
artifact port, and commits the result reference. Local in-memory queue and
artifact adapters provide executable evidence without imitating AWS.

Claims use a five-minute renewable/reclaimable database lease. A handled
worker failure releases the job to `QUEUED` before negatively acknowledging
the message; an expired `RUNNING` lease can be reclaimed after a process crash.

The AWS adapters use a Standard SQS queue and a private, default-SSE-KMS,
lifecycle-managed S3 bucket. SDK behavior is locally verified with injected
clients; no queue, bucket, KMS key, DLQ, or cloud behavior is claimed.

## Consequences

- `/v1` clients do not receive a silent semantic breaking change.
- Queue messages contain job identifiers rather than report data.
- Downloads are authorized against durable job ownership/admin scope and
  completion state before a short-lived S3 signature is created.
- Duplicate delivery is harmless after the job leaves `QUEUED`; workers must
  acknowledge already-completed deliveries.
- Worker crashes do not permanently strand jobs in `RUNNING`.
- Production defaults align the database lease and SQS visibility at five
  minutes with a two-minute heartbeat. Infrastructure must still define retry
  count, DLQ redrive, artifact lifecycle, bucket policy, and KMS policy before
  cloud deployment.
