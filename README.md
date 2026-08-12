# Legacy Application Modernization

An original, local-first Wave 0 baseline for an Order Reference Service. The
repository demonstrates how a deliberately constrained Node.js monolith can be
made explicit and testable before containerization or AWS migration.

## Status

Wave 0 is **accepted locally, not production-ready**. The baseline has no AWS
deployment, endpoint, production data, or cloud execution claim. Node 24
Node 24 evidence records 7/7 baseline tests passing, while the container
acceptance script verifies the same lifecycle, ownership, idempotency,
transitions, reports, persistence, filesystem, configuration, and shutdown
boundaries. These are local results; hosted CI and cloud evidence are not
claimed.

## Run locally

Node `>=24 <25` is required because the baseline uses built-in `node:sqlite`.

```sh
npm install
npm run reset
npm run seed
npm test
npm run lint
npm run format
npm run audit
ENVIRONMENT=local npm start
```

The service listens on port 3000 by default. `GET /healthz` is liveness;
`GET /readyz` checks SQLite readiness. `GET /` and `POST /ui/orders` are a
local-only demonstration UI and are not the canonical API. Reset the local
database before repeating deterministic seed runs.

## API baseline

| Method | Route                  | Boundary                                           |
| ------ | ---------------------- | -------------------------------------------------- |
| GET    | `/healthz`             | public liveness                                    |
| GET    | `/readyz`              | public readiness; 503 on storage failure           |
| GET    | `/v1/products`         | public synthetic catalog                           |
| POST   | `/v1/orders`           | operator/admin bearer; mandatory `Idempotency-Key` |
| GET    | `/v1/orders`           | principal-scoped operator/admin list               |
| GET    | `/v1/orders/{orderId}` | owner or admin retrieval                           |
| POST   | `/v1/orders/{orderId}` | owner or admin state transition                    |
| GET    | `/v1/reports/orders`   | admin-only bounded JSON/CSV aggregate              |

Orders use opaque customer references, UUID v4 IDs, USD minor units, seeded
`DEMO-*` products, bounded quantities and totals, principal-scoped
idempotency, and terminal lifecycle states. Every response carries
`X-Correlation-ID`. Invalid input returns 422, idempotency conflicts 409,
unknown/out-of-scope orders 404, and unexpected failures use a sanitized 500
envelope.

The baseline enforces a 200 KiB request-body limit and a process-local,
per-principal/per-route rate limiter with `429` and `Retry-After`. This is a
local demonstration control; distributed enforcement remains a future edge or
platform concern. `npm run reset` removes the local SQLite database and its
sidecar files.

## Container mode

```sh
docker build -t order-reference-service:wave1 .
docker compose up --build -d
curl http://127.0.0.1:3000/readyz
docker compose down
```

Compose uses disposable `.env.example` fixtures, a named `/data` volume,
read-only root filesystem, dropped capabilities, and a non-root image user.
Production-like container mode fails fast unless distinct `OPERATOR_A_TOKEN`,
`OPERATOR_B_TOKEN`, and `ADMIN_TOKEN` values are supplied. The image
healthcheck calls `/readyz` with Node and installs no curl.

## Evidence and modernization direction

The current evidence includes Node 24 tests, lint, formatting, audit, reset /
seed verification, restart persistence, and readiness failure behavior. SQLite
locking/read-only experiments and AWS deployment are explicitly
plan-only. Wave 1 preserves the API contract and adds the local deployment
boundary without claiming that AWS resources exist.

Detailed contract and decisions:

- [Order Reference HTTP Contract](docs/api/order-reference-contract.md)
- [OpenAPI contract](docs/api/openapi.yaml)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Development](docs/development.md)
- [Threat model](docs/threat-model.md)
- [Evidence matrix](docs/evidence/evidence-matrix.md)

## Provenance

This is an original successor project. The historical
`nodejs-application-migration` repository is referenced only for migration
questions and architectural lessons; its application artifacts and generated
cloud files are not copied here.
