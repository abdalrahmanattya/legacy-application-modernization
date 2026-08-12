# Wave 2 architecture and delivery design

```mermaid
flowchart LR
  User --> Route53[Optional Route53 domain]
  Route53 --> CloudFront[CloudFront VPC origin]
  CloudFront --> WAF[AWS WAF]
  WAF --> ALB[Private HTTPS ALB]
  ALB --> ECS[Private ECS Fargate service]
  ECS --> RDS[(Isolated RDS PostgreSQL)]
  ECS --> SQS[Standard SQS + DLQ]
  ECS --> S3[(Encrypted report S3)]
  ECS --> Secrets[Secrets Manager + KMS]
  ECS --> Logs[CloudWatch Logs]
  GitHub[GitHub OIDC] --> Plan[PR Terraform plan]
  GitHub --> Apply[Manual protected apply]
  Apply --> ECS
```

The diagram is a design only. CloudFront VPC origins/private ALB constraints,
TLS certificates, WAF association, Cognito integration, and endpoint routing
must be validated in an approved AWS account before any claim of operation.
Authentication is group-based (`operator`/`admin`) through Cognito JWT access
tokens. Resource-server scopes are metadata only until application enforcement;
the no-secret client has no hosted UI, OAuth callback, or auth-code claim.
Nonprod is single-AZ and cost-conscious; prod is Multi-AZ. No long-lived AWS
keys are permitted. Build once, promote one immutable image digest, retain an
SBOM, and choose keyless Sigstore signing before production delivery.
