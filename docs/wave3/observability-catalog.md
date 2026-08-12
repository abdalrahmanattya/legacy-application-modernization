# Wave 3 observability catalog

| Domain | Signal / candidate threshold | Severity and owner | Runbook |
|---|---|---|---|
| ALB | 5xx > 1% for 5 minutes; target response latency p95 > 1s | Sev-1 platform | ECS rollout |
| ECS | running count below desired; CPU or memory > 80% for 10 minutes | Sev-2 service owner | ECS rollout |
| RDS | CPU > 80%, connections > 80% of limit, free storage < 20% | Sev-2 data owner | Database restore |
| SQS | oldest message > 5 minutes; visible messages rising; DLQ > 0 | Sev-2 async owner | SQS DLQ |
| WAF | blocked requests spike above baseline | Sev-2 security owner | WAF rollback |
| ACM | certificate days-to-expiry < 30 | Sev-2 platform | Certificate rotation |
| Budget | forecast or actual exceeds approved monthly limit | Sev-2 finance/platform | Cost review |

Alarm thresholds are candidate operating values and must be tuned from hosted
baseline evidence. Alarm actions are intentionally non-destructive. Alarm
testing is cloud-only: publish a controlled synthetic signal in a test
environment, wait for evaluation periods, verify SNS/on-call delivery, and
clean up the test signal with approval.

Every request should carry a correlation ID from the edge through ECS logs,
database operation logs, and SQS message attributes. The current design does
not claim distributed tracing; adding a trace exporter is a separate decision.
CloudWatch structured logs are the authoritative hosted evidence source.
