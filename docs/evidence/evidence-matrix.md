# Wave 0 evidence matrix

Evidence labels:

- **Specified** — frozen in a product, API, decision, or threat document.
- **Structurally reviewed** — checked for consistency within documentation;
  this is not runtime evidence.
- **Locally verified** — executed against an implementation with retained output.
- **Cloud verified** — executed against an approved AWS environment with
  retained measurements.

| Claim                              | Source                                                   | Status                                                                                               | Required next evidence                                                 |
| ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Product/data boundary              | `docs/product/order-reference-service.md`                | Specified                                                                                            | Brain acceptance before implementation                                 |
| HTTP routes and schemas            | `docs/api/openapi.yaml`                                  | Locally verified: parser and 7-test contract suite                                                   | Preserve in Wave 1 container checks                                    |
| State transitions                  | Product brief and API contract                           | Locally verified: allowed edges and terminal conflicts                                               | Preserve in Wave 1 container checks                                    |
| Ownership and authorization        | API contract, internal `ownerPrincipal`                  | Locally verified: operator isolation and admin access                                                | Preserve in Wave 1 container checks                                    |
| Idempotency semantics              | API contract                                             | Locally verified: 201/200/409 with persistent store                                                  | Preserve in Wave 1 container checks                                    |
| Report filters and privacy         | API contract                                             | Locally verified: admin JSON/CSV and omission boundaries                                             | Preserve in Wave 1 container checks                                    |
| Money and identifiers              | API contract                                             | Specified                                                                                            | USD minor-unit arithmetic, total cap, quantity cap, UUID v4 validation |
| Correlation/error boundary         | API contract                                             | Locally verified: correlation and safe expected-error envelopes                                      | Preserve in Wave 1 container checks                                    |
| Synthetic seed catalog             | Product brief                                            | Locally verified: deterministic reset/seed/reset                                                     | Preserve in Wave 1 container checks                                    |
| Threat controls                    | `docs/threat-model.md`                                   | Structurally reviewed                                                                                | Log/auth/abuse tests in Wave 1; semantic PII detection is not claimed  |
| Baseline risks and SLOs            | `docs/assessment/`                                       | Specified                                                                                            | Measurement harness and owner review                                   |
| Node runtime                       | ADR 002                                                  | Decision recorded                                                                                    | Runtime/version and dependency checks                                  |
| Local service behavior             | `app/baseline/`, `tests/baseline/`                       | Locally verified: Node 24 7/7 tests; lifecycle harness 16/16; characterization helper tests 4/4      | Wave 1 container test run                                              |
| Container/build/security scans     | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` | Locally and hosted verified on merged main run `31628031475`: image build, Compose config, non-root/fail-fast checks, Trivy image scan, and SBOM artifact | Cloud runtime remains unverified |
| AWS network/identity/data controls | No infrastructure yet                                    | Not evidenced                                                                                        | Separately approved target validation                                  |
| SQLite async adapter parity        | Wave 2 Node 24 suite                                     | Locally verified: `/v1`, hashed-key concurrency, signed cursors, report jobs and redaction           | Preserve in container acceptance                                       |
| PostgreSQL migrations/parity       | Disposable PostgreSQL 17 integration test                | Locally verified: repeatable empty migration, concurrent idempotency/transitions, schema readiness   | Add hosted disposable-service execution; RDS remains unverified        |
| Cognito-compatible JWT adapter     | Local RSA/JWKS fixtures                                  | Locally verified: algorithm, issuer, client, token type, time, groups and key rotation               | Cognito-issued-token evidence requires approved AWS execution          |
| Versioned asynchronous reports     | Outbox/queue/artifact ports, publisher and worker         | Locally verified: local execution, duplicate/failure paths, lease and visibility renewal             | SQS retry/DLQ and ECS draining remain cloud-unverified                 |
| AWS report adapters                | Injected AWS SDK v3 client tests                          | Locally verified: safe SQS payload/lifecycle, S3 checksum/metadata and bounded private presign        | SQS/S3/KMS policy and runtime behavior remain cloud-unverified         |
| Production configuration contract | Mode-specific fail-fast tests and runtime contract        | Locally verified: raw secrets, verified PostgreSQL TLS, JWT-only API, queue/bucket requirements       | Rendered task execution and Secrets Manager injection remain unverified |
| Wave 3 telemetry and worker resilience | `tests/wave3/` and injected fault adapters | Locally verified and included in merged main run `31628031475`: trace-context preservation, bounded/redacted telemetry, duplicate/crash/poison retry paths | Hosted exporter, SQS redrive, and ECS draining remain cloud-unverified |
| Wave 3 PostgreSQL API recovery | `scripts/postgresql/wave3-api-recovery.js` | Locally and hosted verified on PostgreSQL 17 in merged main run `31628031475`: two API processes, 30-request load, API kill/restart, DB stop/start, readiness 503/200 recovery, post-recovery create | RDS Multi-AZ/failover remains cloud-unverified |
| Wave 3 PostgreSQL backup restore | `scripts/postgresql/wave3-restore-drill.sh` | Locally and hosted verified on PostgreSQL 17 in merged main run `31628031475`: pg_dump/pg_restore integrity and secret-free evidence artifact | RDS PITR and approved isolated restore remain cloud-unverified |

The Wave3 PostgreSQL CI job uses a disposable PostgreSQL 17 service, local-only
credentials, bounded runtime, cleanup, and pinned artifact upload. Hosted CI
verified the job on merged main; no AWS credentials or cloud resources were
used.

Wave 0 is accepted locally, not production or cloud verified. The Node 24
measurement record includes 30/30 and 100/100 samples with p95 11.820 ms and
14.520 ms respectively, plus restart persistence and readiness 503 evidence.
SQLite lock/read-only experiments and AWS execution remain plan-only.
