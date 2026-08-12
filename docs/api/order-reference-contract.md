# Order Reference Service HTTP Contract

The normative machine-readable contract is [`openapi.yaml`](openapi.yaml).
This page explains the boundaries that must remain stable during
modernization.

## Route groups

| Method | Path                      | Auth                  | Purpose                                       |
| ------ | ------------------------- | --------------------- | --------------------------------------------- |
| `GET`  | `/healthz`                | None                  | Process liveness; no dependency check         |
| `GET`  | `/readyz`                 | None                  | Storage readiness; `503` when unavailable     |
| `GET`  | `/v1/products`            | None                  | Read the seeded synthetic catalog             |
| `POST` | `/v1/orders`              | Operator/admin bearer | Create an order; requires `Idempotency-Key`   |
| `GET`  | `/v1/orders`              | Operator/admin bearer | Principal-scoped cursor-based order list      |
| `GET`  | `/v1/orders/{orderId}`    | Operator/admin bearer | Retrieve an in-scope order                    |
| `POST` | `/v1/orders/{orderId}`    | Operator/admin bearer | Apply one allowed state transition            |
| `GET`  | `/v1/reports/orders`      | Admin bearer only     | Bounded synchronous aggregate JSON/CSV export |
| `POST` | `/v2/report-jobs`         | Admin bearer only     | Accept a durable asynchronous report job      |
| `GET`  | `/v2/report-jobs/{jobId}` | Owning admin/admin    | Poll a durable report job                     |
| `GET`  | `/v2/report-jobs/{jobId}/download` | Owning admin/admin | Create a short-lived private download after completion |

Every response includes `X-Correlation-ID`. A valid caller-supplied value is
echoed; an invalid or overlong value is replaced with a generated opaque
identifier. Correlation IDs must not contain customer references.

## Authentication and authorization

The only accepted scheme is `Authorization: Bearer <token>`. Local fixtures
are `operator-a`, `operator-b`, and `admin`. The target JWT adapter validates
Cognito-compatible RS256 access tokens against the exact issuer, client ID,
token type, lifetime, and rotating JWKS. The configured Cognito groups map to
`operator` and `admin`; a valid token in neither group receives `403`. OAuth
scopes are not used for route authorization. Operators can
create/list/retrieve/transition only their own orders. Admin can manage all
orders and is the only principal allowed to run aggregate reports. Missing or
invalid credentials return `401`. Unknown and out-of-scope order IDs both
return indistinguishable `404`; `403` is reserved for an authenticated
principal denied an admin-only route. The service validates local fixtures but
never issues or introspects a production token. The internal `ownerPrincipal`
is persisted for authorization but is never exposed in order responses or
reports.

## Order semantics

`POST /v1/orders` accepts one opaque `customerReference` and one or more line
items. Callers must not submit PII; semantic PII detection is not claimed. Each
line item contains a catalog `sku` and quantity `1..100`; the server resolves
the current USD catalog price and snapshots it into the created order. The
order total must not exceed 10,000,000 minor units. The response is `201` with
`Location: /v1/orders/{orderId}`.

`Idempotency-Key` is required and scoped by authenticated principal, endpoint,
and key. The service stores SHA-256 digests of the key and canonical request,
never the raw key in persistence or logs. An identical replay returns `200` with
`Idempotency-Replayed: true`; a different payload using the same scope returns
`409`. Wave 2 adapters use a 24-hour retention window.

`GET /v1/orders` returns at most the requested bounded page size and an opaque,
principal-scoped cursor. Results are ordered by `createdAt DESC`, then
`orderId DESC`; an invalid cursor returns `400`. It supports `status` filtering.
The baseline deliberately does not support customer-reference search.

`POST /v1/orders/{orderId}` accepts exactly one `targetStatus`. The only
transitions are `PENDING` to `CONFIRMED` or `CANCELLED`, and `CONFIRMED` to
`FULFILLED` or `CANCELLED`. `FULFILLED` and `CANCELLED` are terminal. Invalid
or repeated terminal transitions return `409`; no free-form transition reason
is accepted or persisted in the baseline.

The admin-only report is bounded to 1,000 rows and supports `status`, optional
RFC3339 `createdFrom`/`createdTo`, and `limit` filters. The `Accept` header
selects JSON (default) or CSV. JSON returns an `OrderReport`; CSV is UTF-8,
RFC4180-escaped, and includes `Content-Disposition`. Aggregate report items
omit `customerReference` and `ownerPrincipal` to minimize disclosure. Invalid
filters or over-limit requests return `422`. It performs no external calls and
is an intentionally synchronous baseline constraint.

The `/v1` report remains stable. `/v2/report-jobs` adds an asynchronous
resource without silently changing `/v1`: job state and an outbox event commit
atomically, an outbox publisher sends a job reference through a queue port,
and a worker stores a privacy-minimized artifact through an artifact port. The
production adapters send only the job ID plus correlation/trace context to SQS
and store a checksummed artifact in a private, bucket-default-SSE-KMS S3
bucket. The download route rechecks job scope and `SUCCEEDED` state before
creating a 60–900 second presigned URL with `Cache-Control: no-store`. These
adapters are locally verified with injected SDK clients; retry/DLQ,
encryption-policy, lifecycle, and signed-download behavior require separate
cloud evidence.

## Error envelope

All expected errors use:

```json
{
  "error": "invalid_request",
  "message": "Human-readable, non-sensitive explanation",
  "correlationId": "01J...",
  "details": {}
}
```

`details` is optional and must be an object with no additional properties in the
baseline. It must not contain bearer tokens, customer references, database
connection strings, or full request bodies.

## Status summary

| Route family        | Expected statuses                                                    |
| ------------------- | -------------------------------------------------------------------- |
| Health/readiness    | `200`, `503`                                                         |
| Catalog             | `200`, `503`                                                         |
| Create order        | `200` replay, `201`, `400`, `401`, `409`, `422`, `429`, `500`, `503` |
| List/retrieve order | `200`, `400`, `401`, `404`, `422`, `429`, `500`, `503`               |
| Transition          | `200`, `401`, `404`, `409`, `422`, `429`, `500`, `503`               |
| Report              | `200`, `401`, `403`, `422`, `429`, `500`, `503`                      |
| Report jobs         | `200`, `202`, `400`, `401`, `403`, `404`, `409`, `422`, `500`, `503` |

The local HTML demonstration is outside the canonical API: `GET /` and
`POST /ui/orders` exist only when `ENVIRONMENT=local`, use the same local
operator authentication boundary, and must not be exposed as a deployment
interface.
