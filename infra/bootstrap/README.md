# State bootstrap design (plan-only)

This directory intentionally contains no account IDs, buckets, KMS keys, or
credentials. Before an approved apply, create one encrypted, versioned,
access-logged Terraform state bucket and one DynamoDB lock table per trust
boundary (nonprod and prod), with a separately reviewed bootstrap identity.
Then configure each environment's backend using explicit operator inputs.
Bootstrap is a one-time operation and must never be performed by the
application deployment workflow.

Run bootstrap separately with explicit `state_bucket_name` and
`lock_table_name`; review and apply it once. Then copy the corresponding
`backend.hcl.example` to a local ignored file and run `terraform init
-backend-config=backend.hcl`. Never run bootstrap from the application stack
workflow.

The environment examples enable Terraform 1.15's S3-native lockfile while
retaining DynamoDB during the transition. Nonprod and prod use separate
buckets, keys, and lock tables; state must never cross trust boundaries.
