# IaC policy boundary

Policy tests must fail for public RDS, public ALB, `0.0.0.0/0` task ingress,
wildcard IAM actions/resources, unencrypted storage, missing tags/logging,
missing backups, and missing deletion safeguards. Run Checkov/TFLint/OPA in
CI when pinned tool versions are selected; no policy result is claimed until
the workflow has executed.
