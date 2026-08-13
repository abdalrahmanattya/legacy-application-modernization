# Security policy

## Supported version

Security fixes are evaluated against the current `main` branch. This
repository is an evidence-led modernization project, not a hosted service.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private GitHub
Security Advisory for this repository. Do not open a public issue containing
credentials, exploit details, personal data, or private infrastructure data.

## Scope and boundaries

The repository contains synthetic fixtures and plan-only AWS infrastructure.
It must not contain real credentials, production data, Terraform state, or
cloud-generated evidence. AWS resources, hosted endpoints, Cognito-issued
tokens, RDS failover, SQS redrive, and production recovery remain unverified
until a separately approved cloud validation.
