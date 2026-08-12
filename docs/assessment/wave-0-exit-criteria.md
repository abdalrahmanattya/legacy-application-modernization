# Wave 0 migration exit and go/no-go criteria

Wave 0 freezes the product and evidence contract before implementation or AWS
infrastructure work.

## Required exit evidence

- [ ] Product purpose and data-minimization boundary are accepted.
- [ ] OpenAPI routes, schemas, status codes, auth, idempotency, and lifecycle
      rules are frozen and structurally checked.
- [ ] Synthetic catalog fixtures and an idempotent seed expectation are recorded.
- [ ] Baseline risks, SLO candidates, threat model, and retention assumptions
      have owners and explicit residual risks.
- [ ] Characterization examples cover create, replay, conflict, list, retrieve,
      valid/invalid transitions, report bounds, health, and correlation IDs.
- [ ] Node runtime decision and dependency policy are recorded.
- [ ] No secrets, PII, cloud state, historical code, or third-party frontend
      artifacts are present.
- [x] Wave 1 has a rollback plan that returns to the local baseline.

## No-go gates

Do not begin implementation if any route has ambiguous authorization, an
unbounded body/page/report, a missing error envelope, an unbounded customer
reference, an undocumented state transition, an idempotency ambiguity, or a
claim that local evidence is cloud evidence.

## Rollback and next wave

Rollback is documentation/configuration-only until code exists: stop at the
last accepted contract revision and discard unapproved implementation changes.
Wave 1 exit requires a reproducible local Node service, tests against this
contract, safe container behavior, and a characterization report with no
regression in status, auth, or data-minimization semantics. The dedicated
`wave-1-exit-and-rollback.md` checklist records the current local evidence;
hosted CI and cloud execution remain unverified.
