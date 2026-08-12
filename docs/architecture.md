# Architecture Direction

## States

1. **Legacy baseline** — a small original Node.js service with explicit
   operational limitations and a documented risk register.
2. **Transitional state** — containerized application, repeatable build,
   externalized configuration, and observable deployment seams.
3. **Target state** — edge protection, private compute, managed data,
   asynchronous work, centralized telemetry, and separated environments.

## Target components

```text
Client
  -> CloudFront + AWS WAF
  -> HTTPS Application Load Balancer
  -> private ECS Fargate service
  -> managed database / S3 as justified by the use case
  -> SQS for asynchronous work
  -> CloudWatch logs, metrics, alarms, and traces
```

Account, identity, network, data, and recovery boundaries will be detailed
before infrastructure code is introduced. The target must remain runnable in
a credential-free local mode.

## Migration waves

- **Wave 0:** establish baseline behaviour, threat model, SLO candidates, and
  dependency inventory.
- **Wave 1:** containerize and harden the original service locally. The current
  evidence verifies a pinned Node 24 image, non-root/read-only Compose posture,
  `/data` persistence, readiness healthcheck, and graceful shutdown; hosted CI
  and cloud execution remain unverified.
- **Wave 2:** introduce repeatable infrastructure and secure delivery seams.
- **Wave 3:** validate resilience, observability, rollback, and cost posture.

Every wave has an explicit go/no-go checklist and a rollback note. Diagrams
will identify whether they describe a design, a local test, or cloud evidence.
