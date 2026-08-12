# ADR 003: Freeze a privacy-minimized order-reference contract

- Status: Proposed for Wave 0 review
- Date: 2026-08-12

## Context

The modernization project needs observable business behavior without importing
the historical application’s data model or frontend. A small order-reference
service provides useful lifecycle, persistence, reporting, and migration seams
while avoiding personal and payment data.

## Decision

Use the original contract in `docs/api/openapi.yaml`: synthetic catalog,
opaque customer reference, line items, authenticated order read/list/create,
explicit state transitions, liveness/readiness, correlation IDs, and a bounded
synchronous report. Require idempotency on creation. Preserve tombstone-like
business history by allowing cancellation but no baseline hard-delete route.

The local fixture identity is an explicit boundary. It is not an identity
provider and cannot be presented as production authentication.

## Consequences

- Contract tests can characterize meaningful behavior before any AWS work.
- Data minimization is demonstrable and easy to inspect.
- SQLite, one process, coarse auth, and synchronous reporting remain visible
  baseline risks rather than hidden design debt.
- A later asynchronous report changes execution mechanics, not the baseline
  filters or privacy boundary.
