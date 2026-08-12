# Security Boundaries

Security is part of the architecture acceptance criteria.

- Keep application tasks in private subnets; expose only the intended edge
  path.
- Use least-privilege task roles and separate deployment identities.
- Store runtime secrets in Secrets Manager; never use repository secrets as
  application configuration.
- Require HTTPS, restrictive security-group relationships, and WAF rules
  appropriate to the demonstrated workload.
- Scan dependencies and container images, validate infrastructure policy, and
  review the generated artifact before any cloud operation.
- Keep Terraform state, plans, credentials, dumps, logs with sensitive data,
  and cloud metadata out of Git.
- Record threat-model assumptions, data classification, retention, and
  incident-response boundaries before claiming security evidence.

The historical repositories `nodejs-application-migration` and related
examples are not treated as secure by default. Their credentials, generated
artifacts, and old terminology are not imported.
