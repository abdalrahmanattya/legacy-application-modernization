# Wave 3 operations and recovery runbooks

This runbook is a plan-only operating contract. Commands are examples for an
operator with an approved AWS role and the correct environment; they must not
be run from CI or a laptop by default. Every destructive command is explicitly
gated by change approval, a backup/restore point, and a second-person review.

## ECS rollout, failed deployment, and rollback

The service uses the ECS deployment circuit breaker with rollback enabled. A
deployment is healthy only when the ALB target group reports `/healthz` 200,
the service has the desired running count, and application error alarms remain
quiet. Investigate the deployment events and logs first:

```bash
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region eu-west-1
aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status STOPPED --region eu-west-1
aws logs tail "/ecs/$SERVICE" --since 30m --region eu-west-1
```

If the circuit breaker has not already rolled back, stop the rollout through
the approved release workflow or redeploy the last known-good immutable task
definition revision. Do not change the image digest in place. Confirm the
running task count, ALB health, and alarms before closing the incident.

## Database migration and restore

Migrations follow expand-contract: add backward-compatible schema first, roll
out readers/writers, backfill in bounded batches, then remove old fields only
after the application and rollback window have passed. The migration task is a
separate ECS task and must complete before application traffic is shifted.

RDS failover is a cloud-only drill. For an approved restore, create an
isolated target instance/cluster from a named recovery point, apply network
controls, validate TLS and schema, then switch an explicitly reviewed secret
or endpoint. Never overwrite the source during a test. Candidate targets are
RPO 15 minutes / RTO 60 minutes for production and RPO 24 hours / RTO 4 hours
for non-production; these are targets, not claims until drills produce
evidence.

## SQS DLQ

Inspect before redriving; preserve message IDs and redact payloads in tickets:

```bash
aws sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages --region eu-west-1
aws sqs receive-message --queue-url "$DLQ_URL" --max-number-of-messages 10 --visibility-timeout 30 --region eu-west-1
```

Redrive is destructive to the DLQ message state and requires an approved
batch, a destination check, and a recorded count. Use the SQS redrive task or
AWS console only after the defect is fixed; verify queue age and DLQ alarms.

## Secret, certificate, and KMS rotation

Create a new version out-of-band, validate it against a disposable task, then
roll the ECS service to a new immutable task revision. Keep the previous
version until the rollback window expires. ACM certificates are renewed by
AWS when eligible; certificate expiry alarms require confirming the regional
ALB certificate and the separate us-east-1 CloudFront certificate. KMS key
rotation must preserve old key material for decryption; never delete a key
while ciphertext or state may reference it.

## CloudFront, WAF, and regional outage

CloudFront is optional and uses a separate us-east-1 certificate. WAF managed
rules and rate limits can block legitimate traffic; first compare blocked
requests with application correlation IDs, then apply a narrowly scoped rule
override with expiry. During a regional outage, declare the incident, freeze
migrations and destructive changes, assess restore targets and DNS ownership,
and use the documented RPO/RTO decision matrix. No automatic cross-region
failover is claimed by this plan-only stack.

## Safety boundary

All `terraform apply`, `terraform destroy`, secret value reads, database
restores, redrives, key deletion, and DNS changes are cloud-only actions and
require explicit approval. Static checks and local tests do not prove AWS
control-plane behavior.
