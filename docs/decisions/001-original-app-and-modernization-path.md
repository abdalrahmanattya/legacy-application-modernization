# ADR 001: Build an Original App and Document a Modernization Path

- Status: Accepted for scaffold phase
- Date: 2026-08-12

## Context

The historical `nodejs-application-migration` repository contains useful
architecture and migration thinking, but also includes artifacts that are not
appropriate to copy into a new portfolio project. The successor must show
modern cloud judgement while remaining demonstrable without a live account.

## Decision

Build a small original Node.js workload and model three explicit states:
legacy baseline, transitional containerized service, and secure AWS target.
Use CloudFront/WAF, HTTPS ALB, private ECS Fargate, managed persistence, SQS,
and centralized telemetry as the target direction, subject to later measured
validation.

## Consequences

- The project can reuse lessons and attribution without importing old code or
  third-party frontend bundles.
- Local tests and diagrams can provide evidence before any cloud spend.
- The architecture will need explicit cost, recovery, and service-selection
  decisions before implementation.
