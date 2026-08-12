# Wave 2 operations and rollback plan

Bootstrap remote state once with a separately reviewed identity, then initialize
each environment with an explicit backend configuration. Never place secrets
in tfvars or state inputs. The application workflow promotes one ECR digest
and runs a separate migration task before ECS service deployment.

The current PR workflow is credential-free: it runs formatting, backend-free
initialization/validation, and deterministic policy checks only. The manual
apply workflow is a refusal-by-default contract with no OIDC permission and
an unconditional false job gate. Enabling it requires explicit review of
protected-environment claims, scoped role resources, backend lock isolation,
and migration rollback.

Rollback is a digest redeploy through the protected environment. Database
rollback is forward-compatible migration only; restore uses RDS point-in-time
recovery into a separately reviewed instance. SQS messages remain in the DLQ
for operator inspection. Destructive operations require deletion protection,
final snapshots, and explicit approval.

Secret bootstrap is operator-only and must not print values or enter Terraform
state. After the RDS endpoint and managed master-password secret are available,
compose temporary raw PostgreSQL URL and cursor-secret files with mode `0600`,
then run:

```sh
umask 077
aws secretsmanager put-secret-value --secret-id "$DATABASE_SECRET_ARN" --secret-string file:///private/tmp/database-url.txt
aws secretsmanager put-secret-value --secret-id "$CURSOR_SECRET_ARN" --secret-string file:///private/tmp/cursor-signing-secret.txt
rm -f /private/tmp/database-url.txt /private/tmp/cursor-signing-secret.txt
aws secretsmanager describe-secret --secret-id "$DATABASE_SECRET_ARN" --query 'ARN' --output text
```

Generate the files locally from operator-held values and clean them up
immediately. `describe-secret` is the preflight check; never use
`get-secret-value` in logs or CI. The RDS managed password secret is separate;
compose the database URL out-of-band using the TLS endpoint.
