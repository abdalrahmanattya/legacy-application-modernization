# Changelog

## Unreleased

- Implemented and locally accepted the original Node 24 Order Reference
  Service baseline with SQLite persistence, seeded USD catalog, principal
  ownership, idempotent creation, lifecycle transitions, aggregate JSON/CSV
  reports, correlation IDs, sanitized errors, local UI gating, body limits,
  and process-local rate limiting.
- Added the deterministic reset/seed workflow and executable lint, format,
  test, and dependency-audit checks. AWS/container deployment remains a future
  modernization wave.
- Added a pinned Node 24 container, non-root/read-only Compose profile,
  `/data` persistence boundary, readiness healthcheck, graceful signal drain,
  production token fail-fast validation, immutable-action CI workflow, and
  Dependabot configuration. These are local design/verification artifacts;
  hosted CI and AWS remain unverified.
