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
| Container/build/security scans     | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` | Locally verified: image build, Compose config, non-root and fail-fast checks; hosted scan unverified | Observe hosted CI; retain image scan output                            |
| AWS network/identity/data controls | No infrastructure yet                                    | Not evidenced                                                                                        | Separately approved target validation                                  |

Wave 0 is accepted locally, not production or cloud verified. The Node 24
measurement record includes 30/30 and 100/100 samples with p95 11.820 ms and
14.520 ms respectively, plus restart persistence and readiness 503 evidence.
SQLite lock/read-only experiments and AWS execution remain plan-only.
