# Wave 0 measurement method

This method is a credential-free characterization plan for the local Order
Reference baseline. It does not create production traffic, use AWS, or turn
candidate SLOs into production claims. Until the service is running with the
frozen `/healthz`, `/readyz`, and `/v1` contract, harness output must remain
`blocked` or `pass: false` rather than being interpreted as a measurement.

## Harnesses

```sh
node tools/baseline/smoke-order-lifecycle.js --base-url http://127.0.0.1:3000
node tools/baseline/load-harness.js --base-url http://127.0.0.1:3000 --requests 100 --concurrency 5
node tools/baseline/process-snapshot.js
node tools/baseline/failure-plan.js
node tools/baseline/restart-persistence.js --base-url http://127.0.0.1:3000 --restart-command '<reviewed local command>'
```

All generated JSON is written below `tools/baseline/evidence-results/`, which
is ignored by Git. Reports use schema `wave0.characterization.v1`, redact
token-shaped fields, retain status/count/latency data, and never print request
bodies or customer references. The load harness is capped at 500 requests and
25 workers. It samples liveness, readiness, and the seeded product catalog;
the lifecycle harness separately covers create, replay, idempotency conflict,
retrieve, transitions, terminal-transition rejection, list, and JSON report.
Transitions are `POST /v1/orders/{orderId}` with a `targetStatus` body. The
report checks admin-only JSON via `Accept: application/json` and CSV via
`Accept: text/csv`; order IDs are checked as UUID v4 values and operator
visibility is checked with the second operator fixture.

## Restart and failure boundaries

The restart harness refuses to start a process unless the caller supplies an
explicit command. Failure injection is initially a plan: SQLite lock,
read-only storage, unavailable storage, and process restart. Experiments must
use a disposable temporary copy, a five-second lock cap, and a process started
by the experiment itself. Expected outcomes are recorded against the contract:
health should distinguish process liveness from readiness, storage failures
must use the documented error envelope, and no token or full request body may
appear in output.

The current safe failure check is covered by the baseline test suite: a
disposable database is closed before the server is probed, and `/readyz`
returns the expected `503` storage-failure response while the test cleans up
its temporary directory. SQLite lock and read-only experiments remain planned,
not executed, because manipulating filesystem state concurrently is not yet a
reliable or sufficiently isolated characterization step.

## Latest local characterization

The corrected run used the cached `node:24-bookworm-slim` image, the
contract-compatible service, and disposable local SQLite databases. It is
evidence for this baseline only, not a production SLO claim:

- The lifecycle run at `20260812T110114Z` passed all 16 checks, including
  operator isolation, idempotent replay/conflict, UUID v4 order IDs, both
  transitions, terminal-transition rejection, and admin JSON/CSV reports.
- The 30-request/concurrency-5 sample completed 30/30 HTTP 200 responses with
  p50 2.520 ms, p95 11.820 ms, and max 29.111 ms. A broader 100-request/
  concurrency-10 sample completed 100/100 HTTP 200 responses with p50 3.444
  ms, p95 14.520 ms, and max 32.311 ms. These samples exercised health,
  readiness, and the seeded catalog, so they are only an indicative comparison
  against the read candidate threshold.
- The controlled restart run passed: an order created before restarting the
  disposable service remained retrievable afterward. A host process snapshot
  was also captured; it is observational only and is not a resource-capacity
  claim.

The run outputs are timestamped JSON below the ignored
`tools/baseline/evidence-results/` directory. They contain status, counts, and
latency only; tokens, customer references, and request bodies are redacted or
omitted. The exact source revision should be recorded with any future retained
run before comparing results.

## Candidate acceptance thresholds

The values in `docs/assessment/slo-candidates.md` remain candidates only:
liveness 99.9%, readiness 99.5%, reads p95 ≤ 300 ms, creates/transitions p95 ≤
500 ms, and reports p95 ≤ 2 seconds for ≤100 rows. A valid baseline report
must name the runtime, database mode, dataset size, request count,
concurrency, and exact commit; thresholds are not pass/fail production SLOs.
