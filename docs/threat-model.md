# Threat model: order reference service

Wave 1 adds a local container boundary: non-root execution, read-only root
filesystem, writable `/data` volume only, dropped capabilities,
`no-new-privileges`, bounded resources, and a pinned Node 24 base image. Wave 2
adds strict production configuration for PostgreSQL/TLS, JWT identity, and
report-process modes. These controls are locally reviewed; hosted image
scanning and AWS controls remain unverified.

## Scope and assumptions

The baseline is a local-first Node.js service using a seeded synthetic catalog,
SQLite/local disk, one process, and local bearer fixtures. It models no
customer-profile fields or payment data; synthetic product names are allowed.
Callers must not place PII in `customerReference`; the service treats it as
opaque and does not claim semantic PII detection. It accepts no uploaded files
or external URLs and calls no customer, payment, or fulfillment provider.

The threat model covers the HTTP boundary, local persistence, reports, logs,
build inputs, and the planned AWS migration seams. It does not claim that an
AWS control is deployed or effective.

Wave 2 adds target-compatible PostgreSQL persistence and Cognito-compatible
JWT validation without claiming their AWS dependencies. Idempotency keys are
hashed before persistence, cursors are HMAC-signed and scope-bound, and report
jobs use an atomic database outbox. SQS/S3 production adapters and separate
publisher/worker modes are executable and tested with injected SDK clients,
without claiming AWS behavior. Local fixtures, SQLite, the in-memory queue, and
the in-memory artifact store remain test adapters rather than shared-environment
controls.

## Assets and trust boundaries

| Asset                                 | Classification                                  | Boundary                                 |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Synthetic catalog and price snapshots | Public/demo                                     | Seed file to service/database            |
| Opaque customer reference             | Confidential caller data; caller-prohibited PII | Authenticated request to database/report |
| Order state and totals                | Confidential business data                      | Authenticated API to persistence         |
| Bearer fixture configuration          | Disposable local-only value                     | Environment to authentication middleware |
| PostgreSQL/cursor secrets             | Production secret                               | Secrets Manager/task to application       |
| Report artifact                       | Confidential business data                      | Worker to private S3/download signer       |
| Correlation IDs and logs              | Operational metadata                            | Request boundary to local log sink       |
| Build/dependency artifacts            | Integrity-sensitive                             | Developer/CI to runtime image            |

## Threats and controls

| Threat                           | Control in baseline contract                                                                                       | Residual risk                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Token theft or spoofing          | Bearer scheme, constant-time comparison, local-only fixtures, no token issuance                                    | Fixture auth is not production identity                                               |
| Order enumeration                | UUID v4 IDs, principal-scoped list/retrieve, indistinguishable 404, no public order route                          | Coarse local roles and side-channel analysis                                          |
| Customer-reference PII injection | Opaque format and length bound; caller no-PII rule; log exclusion                                                  | A syntactically valid opaque value can still be sensitive; detection is not claimed   |
| Mass assignment/price tampering  | Only SKU and quantity accepted; price comes from catalog                                                           | Catalog ownership and price governance are future work                                |
| Replay/double creation           | Required key scoped to principal/endpoint/key, SHA-256 fingerprint, 201 then 200 replay, 409 mismatch              | Local records live for DB lifetime; target requires 24-hour TTL and concurrency proof |
| Invalid state transition         | Explicit finite state machine and `409` conflict                                                                   | Concurrent transition behavior needs database test                                    |
| Report data exfiltration         | Admin-only, bounded status/date filters and rows, no arbitrary query, customerReference and ownerPrincipal omitted | Admin fixture compromise; synchronous load                                            |
| Resource exhaustion              | Body, line-item, page, report, and candidate local rate bounds                                                     | Single process and SQLite contention                                                  |
| Log leakage                      | No bearer token, customer reference, full request body, or secret in logs                                          | Dependency/middleware redaction needs test evidence                                   |
| Database loss/corruption         | Readiness signal and documented local recovery boundary                                                            | SQLite/local disk has no HA or durable backup by default                              |
| Supply-chain compromise          | Node 24 LTS decision, lockfile, scan and review gates                                                              | CI signing/provenance is future work                                                  |
| Cloud credential misuse          | No AWS credentials locally; future OIDC and least privilege                                                        | No cloud trust behavior has been verified                                             |
| JWT substitution/replay          | RS256 only; issuer, client, token_use, exp/nbf and key ID validation; immutable issuer+sub ownership               | Cognito issuance/revocation behavior is not cloud-tested                              |
| Cursor tampering/cross-scope use | HMAC signature bound to owner/admin scope and status filter                                                        | Signing-secret rotation policy remains future work                                    |
| Duplicate queue delivery         | Durable job state, specific-job conditional claim, renewable DB/SQS leases, completed delivery acknowledgement    | SQS visibility/DLQ behavior remains cloud-only evidence                               |
| Queue/report data exfiltration   | Message field allowlist; private S3 prefix; checksum; scope/completion check before bounded presign                | IAM, bucket/KMS policy, lifecycle and URL behavior remain cloud-only evidence          |
| Database interception            | Production requires verified TLS and injected CA; disabling verification is rejected                             | RDS certificate rotation and runtime mount remain operational responsibilities         |
| SSRF/external side effects       | No destination URL or external fetch capability exists                                                             | Future integrations must preserve this boundary                                       |

## Abuse and privacy rules

The implementation must never log the `customerReference`, bearer value,
`Idempotency-Key`, or complete request body. Error messages must not reflect
whether an arbitrary customer reference exists. Reports are an authenticated
administrative function and must be rate-limited and size-limited.

## Residual-risk decision

The baseline is acceptable for local demonstration because its limitations are
bounded, visible, and not intentionally exploitable. It is not acceptable for
production or shared customer data until identity, persistence durability,
report isolation, logging, backup/recovery, and deployment controls have
measured evidence.
