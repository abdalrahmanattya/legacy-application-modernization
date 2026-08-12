# Development Workflow

## Local-first workflow

Use the documented local mode and deterministic fixtures first. Do not require
AWS credentials for unit tests, API tests, linting, container checks, or
documentation builds.

## Wave 1 checks

- Format and lint the application.
- Run unit, contract, integration, and migration-regression tests.
- Build the pinned Node 24 container as a non-root image and scan it.
- Run Compose with a named `/data` volume, read-only root filesystem, dropped
  capabilities, and disposable local fixture tokens from `.env.example`.
- Validate infrastructure and policy without applying it.
- Check documentation links and ensure sensitive file patterns are absent.

## Delivery direction

The eventual delivery path will use GitHub Actions with short-lived AWS
credentials through OIDC, immutable image references, environment approval,
and a reviewed promotion step. It will not use long-lived access keys.

## Cloud work

Cloud changes require explicit user approval, a reviewed plan, bounded cost,
and a tested destroy or rollback path. Until then, this repository contains no
live deployment claim.

Outside `ENVIRONMENT=local`, the process fails fast unless the three bearer
tokens are explicitly supplied, nonblank, and distinct. Production-like
container mode uses `ORDER_DB_PATH=/data/orders.sqlite`; only `/data` is
intended to be writable. SIGTERM/SIGINT initiates a bounded drain before the
database closes. The local rate limiter is process-local and is not a
distributed abuse-control design.
