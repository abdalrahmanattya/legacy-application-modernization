# Requirements

## Product intent

Create a small original web workload that makes modernization trade-offs
visible. The workload is intentionally modest: the portfolio value is in the
migration reasoning, security posture, operational evidence, and repeatable
delivery path.

## Functional requirements

- Provide a minimal catalog or order-reference workflow with documented API
  contracts.
- Support a local development mode with deterministic seed data.
- Expose health and readiness checks suitable for container orchestration.
- Emit structured application events and correlation identifiers.
- Preserve behaviour across each migration wave with automated tests.

## Platform requirements

- Define legacy, transitional, and target states with explicit exit criteria.
- Target private application workloads behind an HTTPS edge path.
- Separate public ingress, application, data, and operations boundaries.
- Use managed services only where their operational and cost trade-offs are
  recorded.
- Provide a rollback and recovery path for every migration wave.

## Quality requirements

- No credentials, state files, production data, or cloud-generated artifacts
  are committed.
- Tests run without AWS credentials.
- Images run as a non-root user and are scanned before publication.
- Accessibility, API validation, dependency review, and failure handling are
  treated as acceptance criteria rather than follow-up work.

## Non-goals

- Reproducing the historical repository or its third-party frontend.
- Claiming a production migration or public cloud endpoint.
- Building a feature-complete commerce platform.
- Supporting every AWS service or every migration strategy.

## Acceptance evidence

Each milestone must link to tests, diagrams, decisions, and measurements. A
reviewer should be able to distinguish local evidence from any future cloud
verification without relying on implied claims.
