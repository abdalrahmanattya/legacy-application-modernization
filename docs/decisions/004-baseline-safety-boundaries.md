# ADR 004: Keep the baseline constrained, safe, and credential-free

- Status: Accepted for Wave 0
- Date: 2026-08-12

## Decision

The first implementation remains local-first and credential-free. SQLite/local
disk, one process, local bearer fixtures, and synchronous bounded export are
accepted only as explicit baseline constraints. They are not hidden
vulnerabilities and must not be used to simulate production readiness.

The implementation must reject unbounded input, avoid external fetches, redact
opaque references and credentials from logs, and preserve the route/error/
correlation contract. AWS infrastructure, cloud identities, state, and
production data are out of scope until a separate approval and migration-wave
gate.

## Consequences

- Wave 0 can be implemented and tested without AWS access or cost.
- Risk reduction is measurable across waves.
- Any change that adds PII, external side effects, unrestricted reports, or
  unreviewed credentials is a no-go and requires architecture review.
