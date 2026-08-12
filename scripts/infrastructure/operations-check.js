const fs = require("node:fs");

const docs = {
  "docs/wave3/operations-and-recovery.md": [
    "rollback",
    "circuit breaker",
    "destructive",
    "DLQ",
    "rotation",
  ],
  "docs/wave3/observability-catalog.md": [
    "cloud-only",
    "ALB",
    "RDS",
    "SQS",
    "WAF",
  ],
  "docs/wave3/dr-and-evidence.md": ["RPO", "RTO", "cloud-only"],
  "docs/wave3/cost-model.md": ["dated", "NAT-free", "calculator"],
  "docs/wave3/exit-and-go-no-go.md": ["go/no-go", "cloud readiness", "apply"],
};
const missing = [];
for (const [file, required] of Object.entries(docs)) {
  const text = fs.readFileSync(file, "utf8").toLowerCase();
  for (const term of required)
    if (!text.includes(term.toLowerCase())) missing.push(`${file}: ${term}`);
}
const tf = fs.readFileSync("infra/modules/delivery/main.tf", "utf8");
for (const term of [
  "deployment_circuit_breaker",
  "redrive_policy",
  "enable_key_rotation",
  "retention_in_days",
  "aws_wafv2_web_acl",
  "aws_cloudwatch_metric_alarm",
]) {
  if (!tf.includes(term)) missing.push(`Terraform control: ${term}`);
}
if (missing.length) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log(
  "Wave3 operational documentation and Terraform control checks passed.",
);
