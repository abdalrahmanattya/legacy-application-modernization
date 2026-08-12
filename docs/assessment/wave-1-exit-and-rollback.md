# Wave 1 exit and rollback

## Exit checklist

- [x] Node 24 image is pinned by digest for the declared Linux `amd64`
      local/CI platform policy.
- [x] Runtime is non-root, read-only-compatible, and writes only to `/data`.
- [x] Compose uses a named volume, bounded resources, dropped capabilities,
      `no-new-privileges`, and a readiness healthcheck.
- [x] Container acceptance exercises readiness, API lifecycle, persistence,
      filesystem boundaries, configuration fail-fast, and signal shutdown.
- [x] CI is defined with immutable action SHAs, exact-image scanning, and SBOM
      artifact generation. Hosted results remain unverified until a run exists.
- [x] No AWS credentials, cloud resources, production data, or deployment claim
      are required.

## Evidence boundary

Local verification covers the Docker build, Compose configuration, smoke and
acceptance scripts, non-root/read-only posture, `/data` persistence, and token
configuration gates. Hosted CI, Trivy results, SBOM publication, performance
under production load, and AWS execution are not claimed.

## Rollback

Rollback is local and reversible: stop the Wave 1 container, retain or remove
the explicitly named Compose volume according to the operator's data decision,
and run the Node 24 baseline directly with `npm start`. The application API and
SQLite schema remain the Wave 0 contract boundary. No cloud rollback is
defined because no cloud change has been applied.

## Platform policy

The current policy is Linux `amd64` for local and hosted CI acceptance. This is
not a multi-architecture image claim. A future multi-platform build requires a
separate buildx verification and updated evidence.
