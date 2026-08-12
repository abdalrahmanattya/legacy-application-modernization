const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../infra");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && ![".terraform", ".git"].includes(entry.name))
      walk(file);
    else if (entry.isFile() && file.endsWith(".tf")) files.push(file);
  }
}
walk(root);
const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const failures = [];
const forbid = (pattern, message) => {
  if (pattern.test(source)) failures.push(message);
};
forbid(/publicly_accessible\s*=\s*true/, "RDS must not be publicly accessible");
forbid(/assign_public_ip\s*=\s*true/, "ECS tasks must not receive public IPs");
forbid(/image_tag_mutability\s*=\s*"MUTABLE"/, "ECR tags must be immutable");
forbid(
  /cidr_blocks\s*=\s*\["0\.0\.0\.0\/0"\]/,
  "security groups must not allow unrestricted IPv4 ingress/egress",
);
forbid(/Action\s*=\s*"\*"/, "IAM must not use wildcard actions");
forbid(/force_destroy\s*=\s*true/, "managed stores must not force destroy");
if (!source.includes("backup_retention_period"))
  failures.push("RDS backup retention is required");
if (!source.includes("enable_key_rotation = true"))
  failures.push("KMS key rotation is required");
if (!source.includes("deployment_circuit_breaker"))
  failures.push("ECS deployment circuit breaker is required");
if (!source.includes("aws_cloudfront_vpc_origin"))
  failures.push("optional CloudFront VPC origin is required");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Infrastructure policy gates passed for ${files.length} Terraform files.`,
);
