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

`ENVIRONMENT=local` selects SQLite and disposable fixture authentication. All
other environments use the strict production contract: PostgreSQL with a raw
connection URI and verified CA bundle, JWT authentication for the API, and
process-specific SQS/S3 values. Local fixture token variables are ignored and
must not be present in ECS task definitions. SIGTERM/SIGINT initiates a bounded
drain before SDK clients and the database pool close. The local rate limiter is
process-local and is not a distributed abuse-control design.

## Wave 2 application verification

SQLite remains the local default and requires no credentials. `npm test` runs
the baseline contract plus Wave 2 cursor, idempotency, JWT, log-redaction,
report job, outbox, worker, AWS adapter, production fail-fast, and shutdown
checks under Node 24. AWS adapter tests inject fake SDK clients and perform no
network or cloud operation.

The PostgreSQL integration suite requires a disposable database and creates an
isolated schema:

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test \
  npm run test:postgresql
```

It applies the versioned migration twice, exercises upgrade-from-version-zero,
concurrent create/replay/conflict and transition behavior, report-job
processing, hashed key storage, and incompatible-schema readiness. The test
drops its isolated schema. It must never point at a shared or production
database.

Application startup does not migrate PostgreSQL. Run `npm run
migrate:postgresql` as a separately controlled task. Use `npm run
start:publisher` and `npm run start:worker` for the two non-HTTP process modes.
The complete production environment, secret, IAM, and stop/lease contract is
defined in [`application-runtime-contract.md`](application-runtime-contract.md).
