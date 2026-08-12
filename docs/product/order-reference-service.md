# Privacy-Minimized Order Reference Service

## Product purpose

The first implementation wave is an original, small order-reference service.
It demonstrates a modernization path without becoming a commerce system or
modeling customer-profile or payment data.

The service provides:

- a deterministic, seeded synthetic product catalog;
- creation of an order from a customer-supplied opaque reference and catalog
  line items;
- authenticated retrieval and cursor-based listing of orders;
- explicit, validated order-state transitions; and
- a bounded synchronous report/export that is intentionally replaced by an
  asynchronous job in a later migration wave.

## Data minimization boundary

The baseline models no customer name, email address, telephone number, postal
address, payment-card data, payment token, or customer profile. Synthetic
catalog product names are allowed. A `customerReference` is an opaque
caller-owned identifier with a bounded pattern and length; callers must not put
PII in it, but the service does not claim semantic PII detection. It is excluded
from application logs and correlation metadata. The service does not call
external customer, payment, or fulfillment systems in the baseline.

The product catalog contains synthetic fixtures only. Prices are represented
as integer USD minor units; floating point money values are not accepted.

## Baseline behavior

An order is created in `PENDING`. Each requested SKU must exist in the seeded
catalog, and quantity must be `1..100`. The service snapshots the SKU, product
name, unit price, and currency into the order line so later catalog edits do
not rewrite order history. The total must not exceed 10,000,000 minor units.
HTTP request bodies are capped at 200 KiB by the baseline service. The local
abuse-control implementation is an in-memory, process-local candidate: when a
limit is exceeded it returns `429` with `Retry-After`. Counters reset when the
process restarts and are not a production quota or distributed protection
mechanism.

Allowed transitions are:

```text
PENDING ──> CONFIRMED ──> FULFILLED
   │             │
   └─────────────┴────> CANCELLED
```

`FULFILLED` and `CANCELLED` are terminal. There is no delete endpoint in the
baseline. Retention and eventual purge are policy decisions, not an implicit
hard-delete behavior. Every order has an internal `ownerPrincipal`; it is not
returned by the API.

## Seed catalog

The implementation must seed these synthetic products idempotently:

| SKU | Display name | Unit price | Currency |
|---|---|---:|---|
| `DEMO-PLATFORM-001` | Platform Foundations Workshop | 12500 | USD |
| `DEMO-DATA-002` | Data Pipeline Review | 9000 | USD |
| `DEMO-AI-003` | Applied AI Architecture Session | 15000 | USD |

These values are demonstration fixtures, not commercial pricing. A repeated
seed operation must not create duplicate SKUs or mutate an existing order
snapshot.

## Local identity boundary

The baseline uses local-only bearer fixtures supplied through environment
configuration: `operator-a`, `operator-b`, and `admin`. It does not issue
tokens and does not imitate a production identity provider. Operators can
create/list/retrieve/transition only their own orders; admin can manage all
orders and exclusively run aggregate reports. Out-of-scope order IDs return
the same `404` as unknown IDs. Fixture values must never be copied into a
shared environment or committed.

The local HTML demonstration routes `GET /` and `POST /ui/orders` are available
only with `ENVIRONMENT=local`; they are not the canonical API and are not a
deployment interface.

## Later evolution

The synchronous report route is intentionally bounded for Wave 0. A later wave
will introduce a report request resource, an asynchronous worker, durable job
status, object storage, and an expiring download reference. The HTTP contract
must preserve the baseline status/date filters while changing the interaction
from an in-request export to a pollable job. The baseline idempotency record is
retained for the life of the local database; the target requires a 24-hour TTL.
