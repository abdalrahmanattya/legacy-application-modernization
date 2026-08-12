# Development Workflow

## Local-first workflow

Use the documented local mode and deterministic fixtures first. Do not require
AWS credentials for unit tests, API tests, linting, container checks, or
documentation builds.

## Planned checks

- Format and lint the application.
- Run unit, contract, integration, and migration-regression tests.
- Build the container as a non-root image and scan it.
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
