# Threat model: order reference service

Wave 1 adds a local container boundary: non-root execution, read-only root
filesystem, writable `/data` volume only, dropped capabilities,
`no-new-privileges`, bounded resources, pinned Node 24 base image, and
production token fail-fast validation. These controls are locally reviewed;
hosted image scanning and AWS controls remain unverified.

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

## Assets and trust boundaries

| Asset                                 | Classification                                  | Boundary                                 |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Synthetic catalog and price snapshots | Public/demo                                     | Seed file to service/database            |
| Opaque customer reference             | Confidential caller data; caller-prohibited PII | Authenticated request to database/report |
| Order state and totals                | Confidential business data                      | Authenticated API to persistence         |
| Bearer fixture configuration          | Secret in local runtime                         | Environment to authentication middleware |
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
