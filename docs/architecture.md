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

Wave 2 infrastructure is plan-only. The Terraform scaffold is separated into
nonprod/prod boundaries with eu-west-1 as the target region, a NAT-free private
network design, encrypted isolated data, immutable image promotion, and
credential-free PR validation. CloudFront VPC origins/private ALB constraints,
TLS/domain inputs, endpoint routing, Cognito, OIDC trust, and AWS behavior are
designed but not cloud-tested.

The Wave 2 application implements async repository and identity ports with
SQLite/local-fixture defaults and PostgreSQL/Cognito-compatible target
adapters. PostgreSQL migrations run separately from application startup.
Versioned `/v2` report jobs use a transactional outbox and queue/artifact ports
while `/v1` remains unchanged. Separate production commands publish to SQS and
process jobs into private, checksummed S3 artifacts; the API authorizes a
complete job before issuing a bounded presigned download. These adapters are
executable and locally tested with injected SDK clients; RDS, Cognito, SQS,
S3/KMS, ECS, and telemetry exporters are not cloud-evidenced.

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
