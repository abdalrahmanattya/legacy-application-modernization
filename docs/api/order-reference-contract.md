# Order Reference Service HTTP Contract

The normative machine-readable contract is [`openapi.yaml`](openapi.yaml).
This page explains the boundaries that must remain stable during
modernization.

## Route groups

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | None | Process liveness; no dependency check |
| `GET` | `/readyz` | None | Storage readiness; `503` when unavailable |
| `GET` | `/v1/products` | None | Read the seeded synthetic catalog |
| `POST` | `/v1/orders` | Operator/admin bearer | Create an order; requires `Idempotency-Key` |
| `GET` | `/v1/orders` | Operator/admin bearer | Principal-scoped cursor-based order list |
| `GET` | `/v1/orders/{orderId}` | Operator/admin bearer | Retrieve an in-scope order |
| `POST` | `/v1/orders/{orderId}` | Operator/admin bearer | Apply one allowed state transition |
| `GET` | `/v1/reports/orders` | Admin bearer only | Bounded synchronous aggregate JSON/CSV export |

Every response includes `X-Correlation-ID`. A valid caller-supplied value is
echoed; an invalid or overlong value is replaced with a generated opaque
identifier. Correlation IDs must not contain customer references.

## Authentication and authorization

The only accepted scheme is `Authorization: Bearer <opaque-token>`. Local
fixtures are `operator-a`, `operator-b`, and `admin`. Operators can
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
and key. The service stores a SHA-256 fingerprint of the canonical request,
never the response or key in logs. An identical replay returns `200` with
`Idempotency-Replayed: true`; a different payload using the same scope returns
`409`. Baseline records live for the lifetime of the local database; the target
must introduce a 24-hour retention policy.

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

| Route family | Expected statuses |
|---|---|
| Health/readiness | `200`, `503` |
| Catalog | `200`, `503` |
| Create order | `200` replay, `201`, `400`, `401`, `409`, `422`, `429`, `500`, `503` |
| List/retrieve order | `200`, `400`, `401`, `404`, `422`, `429`, `500`, `503` |
| Transition | `200`, `401`, `404`, `409`, `422`, `429`, `500`, `503` |
| Report | `200`, `401`, `403`, `422`, `429`, `500`, `503` |

The local HTML demonstration is outside the canonical API: `GET /` and
`POST /ui/orders` exist only when `ENVIRONMENT=local`, use the same local
operator authentication boundary, and must not be exposed as a deployment
interface.
