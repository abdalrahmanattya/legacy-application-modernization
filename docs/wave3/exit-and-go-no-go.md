# Wave 3 exit and go/no-go

## Exit evidence

- Terraform fmt, backend-disabled init/validate for every root.
- Deterministic policy, cross-wire, rendered task-definition, and operations
  checks.
- Hosted Trivy configuration scan and artifact retained by CI.
- Merged main CI run `31628031475` completed the Node, container, Wave3
  PostgreSQL recovery, backup/restore, Trivy, and SBOM checks.
- Reviewed runbooks for ECS rollback, migration/restore, DLQ, rotation, WAF,
  and regional outage.
- Cost assumptions dated and sensitivity scenarios generated locally.
- RPO/RTO objectives explicitly marked as candidates until AWS drills.

## Go/no-go

**No-go for production operation** until a protected AWS environment has
completed identity/OIDC verification, certificate and secret bootstrap,
database restore, ECS rollback, alarm delivery, and DLQ drills. The plan-only
Terraform and local tests are suitable for review and implementation planning,
not evidence of cloud readiness.

**Conditional go for further implementation** when the image digest, regional
certificate ARNs, protected deployment environment, notification recipients,
and approved backend state are supplied. Apply remains disabled by default in
this lane.
