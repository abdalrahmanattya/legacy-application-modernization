# Characterization and evidence matrix

This matrix separates what is specified from what has actually been run.
Nothing in this Wave 0 document is cloud evidence.

| Behavior                    | Contract evidence                              | Current status    | Wave 1 proof                    |
| --------------------------- | ---------------------------------------------- | ----------------- | ------------------------------- |
| Seeded `DEMO-*` catalog     | Product brief and OpenAPI `Product`            | Locally verified  | Preserve in Wave 1              |
| Create order                | `POST /v1/orders`                              | Locally verified  | Preserve in Wave 1              |
| Idempotent replay           | `Idempotency-Key` contract                     | Locally verified  | Preserve in Wave 1              |
| List/retrieve authorization | Route auth table and internal `ownerPrincipal` | Locally verified  | Preserve in Wave 1              |
| State machine               | Product brief and transition schema            | Locally verified  | Preserve in Wave 1              |
| Synchronous report bound    | `GET /v1/reports/orders`                       | Locally verified  | Preserve in Wave 1              |
| Liveness/readiness          | `/healthz`, `/readyz`                          | Locally verified  | Preserve in Wave 1              |
| Correlation ID              | `X-Correlation-ID` contract                    | Locally verified  | Preserve in Wave 1              |
| Privacy boundary            | Threat model and risk register                 | Locally verified  | Preserve in Wave 1              |
| Money and lifecycle bounds  | OpenAPI Money, quantity, status schemas        | Locally verified  | Preserve in Wave 1              |
| Node 24 runtime             | ADR 002                                        | Decision recorded | Build and runtime version check |

The Wave 0 baseline is locally accepted, not cloud verified. The latest
characterization record reports 16/16 lifecycle checks, 4/4 characterization
helper tests, and Node 24 service tests passing. Performance values are
indicative local samples, not production SLO claims.
