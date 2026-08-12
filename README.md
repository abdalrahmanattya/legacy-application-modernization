# Legacy Application Modernization on AWS

An original, evidence-led modernization project for demonstrating how a
legacy web workload can move toward a secure, operable AWS platform.

## Status

This repository is a local planning and implementation scaffold. It has no
live deployment, endpoint, production data, or claim of cloud execution.

## Audience

Cloud architects, platform engineers, security reviewers, and hiring teams
who want to see the reasoning behind a pragmatic modernization path.

## Scope

- Build a small original Node.js application with a deliberately documented
  legacy baseline.
- Define migration waves from that baseline to a containerized AWS target.
- Demonstrate secure networking, identity boundaries, observability,
  resilience, and cost-aware decisions.
- Make the application runnable locally without AWS credentials.
- Produce reproducible tests, architecture evidence, and an operations runbook.

## Target direction

The intended target is CloudFront and AWS WAF at the edge, an HTTPS ALB,
private ECS Fargate services, managed persistence, asynchronous work through
SQS, and centralized logging and metrics. Account and environment boundaries
will be documented before infrastructure is implemented.

## Evidence boundaries

Diagrams, tests, measurements, and recorded decisions will be labelled as
planned, locally verified, or cloud verified. This project will never imply a
live AWS deployment until one is explicitly created, tested, and documented.
No third-party frontend bundle will be copied into this repository.

## Historical attribution

The historical repository [nodejs-application-migration](https://github.com/abdalrahmanattya/nodejs-application-migration)
is used only as source material for migration questions, architectural themes,
and lessons learned. This repository is an original successor and does not
copy its application artifacts or generated cloud files.

## Planned documentation

- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Development](docs/development.md)
- [Initial decision record](docs/decisions/001-original-app-and-modernization-path.md)

## License and reuse

The license and any third-party dependency notices will be added before the
first implementation milestone. Do not treat this scaffold as production
infrastructure.
