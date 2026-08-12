# ADR 002: Use Node.js 24 LTS for the baseline

- Status: Accepted for Wave 1 planning; revalidate at implementation start
- Date: 2026-08-12

## Context

The baseline needs a supported, reproducible runtime with a current security
patch stream and broad tooling support. Choosing a version by personal
familiarity would make the modernization evidence weaker.

## Decision

Use the Node.js 24 (`Krypton`) LTS line for the first implementation, pinned to
an exact patch version in the package/container/tool-version files. The Wave 1
image currently uses `node:24-bookworm-slim` digest
`sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03`.
Refresh this digest deliberately for a newer Node 24 security patch, then
rerun tests, audit, image scan, and container smoke checks.
The official Node.js release table lists v24 as LTS:
<https://nodejs.org/en/about/previous-releases>.

This is a version-line decision with a locally built Wave 1 image. Hosted CI
and cloud execution remain unverified. Refreshes must be reviewed and rerun
through the container evidence gates.

## Consequences

- The baseline gets an explicitly supported runtime line and a clear update
  policy.
- Local and CI checks can assert the same major and exact patch version.
- Node release status changes over time, so the official release table must be
  rechecked before implementation and before publication.
- Runtime selection does not remove the need for dependency, container, or
  supply-chain scanning.
