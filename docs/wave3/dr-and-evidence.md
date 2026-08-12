# Wave 3 DR and evidence matrix

| Capability | Candidate objective | Evidence required | Classification |
|---|---:|---|---|
| Database point-in-time restore | RPO 15m / RTO 60m prod | Approved isolated restore drill and timings | AWS-only |
| Nonprod recovery | RPO 24h / RTO 4h | Restore drill using disposable target | AWS-only |
| ECS rollback | < 15m to last good digest | Hosted failed-deployment drill | AWS-only |
| SQS recovery | No silent loss; DLQ reviewed | Redrive count and post-fix processing | AWS-only |
| Secret/certificate rotation | No outage during rollout | Two-version task rollout evidence | AWS-only |
| Local application restart | Preserve intended data contract | Node24 restart/persistence evidence | Local accepted |
| Local API/database recovery | Survive one API loss and PostgreSQL restart | PostgreSQL 17 disposable drill: two API processes, readiness 503 during outage, both recover to 200, post-recovery write succeeds | Local accepted; RDS failover remains cloud-only |
| Local backup/restore integrity | Recover a known marker from an explicit dump | PostgreSQL 17 disposable `pg_dump`/`pg_restore` drill | Local accepted; RDS PITR remains cloud-only |
| Terraform controls | No public DB/S3, encryption and backups | fmt/validate/policy/static tests | Local/CI |

The local app-lane restart and persistence evidence does not substitute for an
RDS restore, ECS rollback, or regional outage drill. RPO/RTO values remain
candidates until a hosted drill records start time, end time, data point, and
operator approvals. These hosted drills are cloud-only evidence.
