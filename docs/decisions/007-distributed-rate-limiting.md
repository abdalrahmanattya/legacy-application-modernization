# ADR 007: Distributed rate limiting boundary

## Status

Accepted design; production implementation deferred to the edge/platform lane.

## Decision

The process-memory limiter is retained only when `ENVIRONMENT=local`. It is
disabled outside local mode because per-task counters reset and diverge across
ECS replicas, making them a misleading production control.

The production target uses layered distributed controls:

- AWS WAF rate-based rules for coarse source-abuse protection.
- ALB and ECS capacity bounds for infrastructure protection.
- An explicitly selected shared quota store only if authenticated
  per-principal quotas become a product requirement.

Application logs and metrics must still record `429` outcomes from an approved
upstream or shared control without using principal values as metric dimensions.

## Consequences

Wave 2 does not claim a distributed application quota. WAF configuration and
measured behavior belong to the separately reviewed infrastructure and cloud
evidence lanes.
