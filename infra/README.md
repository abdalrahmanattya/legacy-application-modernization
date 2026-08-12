# Wave 2 infrastructure (plan-only)

The Terraform scaffold targets `eu-west-1` with separate nonprod and prod
root modules. It is deliberately plan-only: the image digest and regional ACM
certificate are explicit operator inputs with no defaults, no AWS backend or
credentials are configured, and the apply workflow is hard-disabled.

The design is NAT-free for application subnets. Required private connectivity
is provided through VPC endpoints (ECR API/DKR, CloudWatch Logs, Secrets
Manager, STS, KMS, SQS, plus S3 gateway). The stack models private ALB HTTPS
redirect/listening, regional WAF managed rules and rate limiting, Cognito
scopes/client boundaries, encrypted ECR/S3/SQS/logs/secrets, RDS TLS/backups,
ECS circuit breakers/autoscaling, and immutable image inputs. CloudFront VPC
origins are optional and gated by `enable_cloudfront`; custom domains require
an ACM certificate ARN, while Route 53 records are intentionally not created.
The WAF is attached to the regional private ALB; a CloudFront-scope WAF must
be managed in `us-east-1` as a separate edge state before enabling a public
distribution. This is structural evidence, not cloud evidence.

Database and cursor-signing Secrets Manager resources are created without
secret values. An approved operator must populate those raw-string secrets
out-of-band before service start; secret values must never enter Terraform
configuration, variables, plans, or state inputs. The ECS execution role fetches
the two secret ARNs for injection; the task role retains only runtime SQS/S3
permissions.

The image vendors the public AWS RDS global CA bundle at
`/app/certs/global-bundle.pem` from
`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`, pinned by
SHA-256 `e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3`.
Runtime configuration uses `DATABASE_SSL_CA_PATH` and Node `pg` enforces
`rejectUnauthorized=true`. Refresh the bundle only by reviewing the official
URL, updating the checksum, rebuilding, and rerunning container acceptance.

Run `node scripts/infrastructure/policy-check.js` for deterministic local
gates and `node scripts/infrastructure/crosswire-check.js` for ECS contract
checks. The hosted PR workflow also runs pinned Trivy v0.36.0 config scanning
and uploads JSON evidence; that hosted result is configured but unverified
until CI executes. `infra/bootstrap` is a separate state boundary and
environment backends require explicit operator-supplied bucket/table names.

Budgets are disabled unless both `monthly_budget_usd` is positive and
`budget_notification_emails` contains explicit addresses. Cost filtering uses
the Project cost-allocation tag; email endpoints are never inferred.
