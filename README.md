<!-- reader-first-readme:v1 -->

# Legacy Application Modernization

This repository follows an Order Reference Service as it grows from a small,
single-computer application into a safer containerized system with a clear path
to AWS. The service lets authorized customers create and follow fictional
orders, while operations staff can manage order states and produce reports.

The value is not a cosmetic rewrite. Each modernization step preserves the
customer-facing contract while reducing a specific operational risk: single-
machine storage, manual startup, weak identity, blocking reports, or limited
recovery evidence.

## The 30-second overview

1. A customer submits an order with a unique request key.
2. The service validates the order and safely handles accidental retries.
3. The customer can read only orders they own and follow allowed status changes.
4. An administrator can request a report without making the web request wait.
5. A background worker creates the report and stores only a private reference.
6. Automated checks prove that the original API still behaves the same as its
   storage, identity, and processing boundaries are modernized.

## A complete customer and operator journey

Suppose a customer's connection drops while they submit an order. They repeat
the request with the same idempotency key—a one-time identifier for that
intended action. The service returns the original order instead of creating a
duplicate. The customer can later see their order, but not another customer's
records, and can move it only through valid states.

An administrator may request a filtered report. The modernized path records a
report job and a queue message in one transaction, then returns immediately. A
separate worker claims the job, creates a privacy-minimized file, and records
where it can be downloaded. Repeated queue delivery is safe, and an abandoned
job can be reclaimed after its lease expires.

For an operator, the same HTTP contract moves through four evidence-backed
waves: characterize the baseline, harden it in a container, introduce managed-
service adapters, then test recovery and failure behavior.

## What it does and why it is useful

- The `/v1` order API, ownership rules, state transitions, reports, correlation
  IDs, safe errors, and retry protection.
- A `/v2` asynchronous report-job API with outbox, queue, worker, artifact, and
  crash-recovery behavior.
- SQLite for simple local use and PostgreSQL 17 integration evidence for the
  production-shaped data path.
- Local fixture identity and a Cognito-compatible JSON Web Token validator.
- A non-root container with a read-only filesystem, persistent `/data` volume,
  liveness, readiness, graceful shutdown, and strict production configuration.
- Terraform describing the planned private AWS environment, plus security,
  recovery, cost, and go/no-go documentation.

## System architecture diagram

```mermaid
flowchart LR
  Person[Customer or administrator] --> API[Order Reference API]
  API --> Identity[Identity and ownership checks]
  API --> Rules[Order and retry rules]
  Rules --> Database[(SQLite locally or PostgreSQL)]
  API --> Job[Report job and outbox]
  Job --> Publisher[Outbox publisher]
  Publisher --> Queue[Queue port]
  Queue --> Worker[Report worker]
  Worker --> Artifact[Private report artifact]
  API --> Signals[Health, readiness, logs, metrics]
```

In plain language, the diagram shows how the web API authenticates each request
before applying ownership and state rules. Order creation and its hashed retry
key commit together. A report request
commits its job and outgoing event together, so a process interruption cannot
silently lose one half. Separate publisher and worker processes move that work
through queue and storage interfaces. Local implementations make the complete
flow executable without cloud credentials; AWS adapters use the same interfaces
and are tested with injected clients.

## Security and trust boundaries

- The application stores synthetic references rather than personal or payment
  information and redacts customer references and credentials from logs.
- A local bearer token is a development fixture, not production identity.
- Production mode requires verified JWT claims and PostgreSQL transport-layer
  security using the pinned Amazon RDS certificate bundle.
- Raw retry keys are hashed before storage; list cursors are signed and bound
  to the caller and filter.
- Queue messages contain a report-job identifier, not report contents.
- The API authorizes a completed job before creating a short-lived S3 download.
- Process-memory rate limiting is local only; the AWS design uses shared edge
  controls instead of pretending each container has a global view.

## Technology guide in plain English

| Technology | Its job here |
|---|---|
| Node.js 24 | Runs the web API and background processes. |
| SQLite | Provides a credential-free database for the simplest local mode. |
| PostgreSQL | Provides transactions, locking, migrations, and concurrency for the production-shaped mode. |
| Docker and Compose | Package the service and run it with repeatable local boundaries. |
| JSON Web Tokens (JWTs) | Carry signed identity claims that the production adapter verifies. |
| Transactional outbox | Saves a business change and its future queue event together. |
| Terraform | Describes AWS resources as reviewable code; validation does not create them. |
| GitHub Actions | Repeats tests, container checks, infrastructure validation, and secret scanning. |

## Planned AWS cloud resources

![Planned AWS architecture for the Order Reference Service using official AWS service icons](docs/diagrams/aws-services.svg)

The diagram uses the [official AWS Architecture Icons](https://aws.amazon.com/architecture/icons/).
Customers optionally enter through CloudFront and AWS WAF, then an Application
Load Balancer sends HTTPS requests to private Elastic Container Service (ECS)
tasks. Cognito supplies identity claims and Aurora PostgreSQL stores orders and
durable job state. A publisher sends report references to Simple Queue Service
(SQS); a worker writes completed reports to private Simple Storage Service (S3).
Secrets Manager, Key Management Service (KMS), Elastic Container Registry
(ECR), and CloudWatch support configuration, encryption, images, and monitoring.

Terraform under `infra/` defines this environment for `eu-west-1`. The planned components are not deployed. The code was validated locally and in
hosted CI but has not been applied to an AWS account. To use the cloud design,
an operator provides an immutable image digest, a reviewed Terraform state
backend, certificate identifiers, secrets
outside Terraform, and the inputs in [the infrastructure guide](infra/README.md).
The apply workflow remains disabled, so deployment is a deliberate operator
action rather than an automatic result of a push.

## What was tested

Waves 0–3 are implemented and accepted locally. Hosted run
[31628031475](https://github.com/abdalrahmanattya/legacy-application-modernization/actions/runs/31628031475)
covered Node tests, PostgreSQL integration, container build and acceptance,
Trivy vulnerability checks, software-bill-of-materials generation, API
recovery, and backup/restore evidence. The final baseline and secret-scan runs
were `31628680586` and `31628680590`.

Evidence includes seven baseline service tests, four characterization-helper
tests, 16 container lifecycle checks, PostgreSQL migrations and concurrent
retry behavior, readiness changing to `503` during database loss and recovering
to `200`, process restart, and a disposable `pg_dump`/`pg_restore` drill. See
the [evidence matrix](docs/evidence/evidence-matrix.md) for claim-level detail.

## Important limitations

- The product uses fictional data and is not a commerce or payment service.
- Local authentication is intentionally coarse and must not be used publicly.
- SQLite is a single-process baseline, not a horizontally scalable database.
- AWS identity, WAF behavior, failover, point-in-time restore, queue redrive,
  rollback, cost, scale, and availability have not been live-tested.
- CloudFront needs separately managed certificate and edge WAF configuration.
- A short test cannot demonstrate long-term reliability or service objectives.

## Operator guide: run locally

Node.js `>=24 <25` is required. From the repository root:

```sh
npm ci
npm run reset
npm run seed
npm test
npm run test:wave3
npm run lint
npm run format
npm audit --audit-level=high
ENVIRONMENT=local npm start
```

The API listens on `http://127.0.0.1:3000`; `/healthz` reports process
liveness, `/readyz` reports database readiness, and `/` provides a local-only
interface. Stop it with `Ctrl-C`.

### Run the hardened container

```sh
docker build -t order-reference-service:local .
docker compose up --build -d
curl --fail http://127.0.0.1:3000/readyz
docker compose down
```

The container runs as a non-root user with a read-only root filesystem and a
persistent `/data` volume. Compose uses disposable values from `.env.example`.

### Verify PostgreSQL and the AWS design

Start a disposable PostgreSQL 17 database, then run:

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test \
  npm run test:postgresql
node scripts/infrastructure/policy-check.js
node scripts/infrastructure/crosswire-check.js
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

The database suite creates and removes its own schema; never point it at a
shared database. Production-shaped operation uses separate migration, API,
publisher, and worker commands documented in the
[runtime contract](docs/application-runtime-contract.md). Creating or removing
AWS resources requires a reviewed plan, exact account and region confirmation,
cost boundary, backup decision, rollback path, and operator-run Terraform.

### Deployment method

There is intentionally no automatic apply workflow. After supplying the
prerequisites and passing the validation above, the exact deployment method is
a reviewed Terraform plan followed by an operator-run apply against the chosen
environment root module. Follow [the infrastructure guide](infra/README.md) for
the backend and environment inputs; capture the plan before running any apply.

## Repository map

| Location | Contents |
|---|---|
| `app/` | API, domain services, adapters, publisher, and worker processes. |
| `tests/` | Baseline, PostgreSQL, adapter, telemetry, and recovery tests. |
| `scripts/` | Setup, acceptance, infrastructure checks, and recovery drills. |
| `infra/` | Plan-only Terraform for the independent AWS environment. |
| `docs/api/` | OpenAPI definition and readable HTTP contract. |
| `docs/decisions/` | Architecture decisions and trade-offs. |
| `docs/evidence/` | Claim-by-claim validation record. |
| `docs/wave3/` | Operations, recovery, cost, and go/no-go guidance. |

More detail is available in [architecture](docs/architecture.md), the
[runtime contract](docs/application-runtime-contract.md), [security](docs/security.md),
[threat model](docs/threat-model.md), and [operations and recovery](docs/wave3/operations-and-recovery.md).

Licensed under the [MIT License](LICENSE).
