# Wave 0 baseline risk register

The baseline is intentionally safe but constrained. It must not contain a
deliberate vulnerability for demonstration value; limitations are recorded so
the modernization can remove them with evidence.

| ID    | Baseline condition                             | Risk                                         | Guardrail now                                                                                              | Residual risk / migration response               | Wave |
| ----- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---- |
| R-001 | JavaScript monolith and one process            | A fault affects all requests                 | Clear module seams and health endpoints                                                                    | Split deployable units only when measured        | 1–2  |
| R-002 | SQLite on local disk                           | Loss/corruption and single-writer contention | Disposable data; no cloud claim                                                                            | Managed database, backups, restore proof         | 1–3  |
| R-003 | Synchronous bounded report                     | Request latency and memory pressure          | Admin-only route, status/date filters, max 1,000 rows, `422` bound                                         | Queue worker and durable job state               | 2    |
| R-004 | Coarse local bearer fixtures                   | No production identity assurance             | `operator-a`, `operator-b`, and `admin`; principal-scoped ownership; no token issuance                     | OIDC/IAM or approved identity integration        | 2–3  |
| R-005 | Single process/no HA                           | Maintenance or host failure is total outage  | Readiness endpoint and rollback notes                                                                      | Multi-task service and measured recovery         | 2–3  |
| R-006 | Local filesystem logs                          | Logs can be lost or mishandled               | Redaction contract; no customer reference in logs                                                          | Centralized structured logs and retention policy | 2    |
| R-007 | Seeded synthetic catalog                       | Fixtures could be mistaken for business data | Clearly named `DEMO-*` SKUs and no PII                                                                     | External catalog only if justified               | 0–1  |
| R-008 | Opaque customer reference accepted from caller | Caller may submit PII or secrets             | Contract pattern/length limits, explicit caller prohibition, log exclusion; semantic detection not claimed | Validate ownership/privacy policy at boundary    | 0    |
| R-009 | Cursor/list/report volume                      | Enumeration or resource exhaustion           | Principal-scoped opaque cursor, bounded page/report limits, admin report, candidate local rate limits      | WAF/app quotas and async export                  | 0–2  |
| R-010 | Dependency/build supply chain                  | Malicious or vulnerable package              | Lockfile, pinned runtime plan, scan gate                                                                   | Reproducible CI and signed artifact policy       | 1–2  |

### Stop conditions

Stop the wave if a change introduces names, emails, payment data, unrestricted
free text, unbounded export, server-side fetching, committed credentials, or a
route that bypasses authentication or correlation IDs. These are contract
violations, not acceptable “legacy realism.”
