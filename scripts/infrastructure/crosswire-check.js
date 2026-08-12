const fs = require("node:fs");
const source =
  fs.readFileSync("infra/modules/delivery/main.tf", "utf8") +
  fs.readFileSync("infra/variables.tf", "utf8") +
  fs
    .readdirSync("infra/modules/delivery/templates")
    .filter((file) => file.endsWith(".json.tftpl"))
    .map((file) =>
      fs.readFileSync(`infra/modules/delivery/templates/${file}`, "utf8"),
    )
    .join("\n");
const required = [
  'name = "ENVIRONMENT"',
  'value = "production"',
  'name = "DATABASE_ENGINE"',
  'value = "postgresql"',
  'name = "AUTH_MODE"',
  'name = "JWT_ISSUER"',
  'name = "JWT_CLIENT_ID"',
  'name = "REPORT_QUEUE_URL"',
  'name = "REPORT_BUCKET_NAME"',
  'name = "DATABASE_SSL_MODE"',
  'name = "DATABASE_SSL_CA_PATH"',
  'name = "JWT_ADMIN_GROUP"',
  'value = "require"',
  'name = "DATABASE_URL"',
  'name = "CURSOR_SIGNING_SECRET"',
  '"readonlyRootFilesystem": true',
  '"user": "1000"',
  "sha256",
  "/healthz",
  "scripts/postgresql/migrate.js",
  "app/processes/outbox-publisher.js",
  "app/processes/report-worker.js",
  "deployment_circuit_breaker",
  "templates/api.json.tftpl",
  "templates/migration.json.tftpl",
  "templates/publisher.json.tftpl",
  "templates/worker.json.tftpl",
];
const missing = required.filter((value) => !source.includes(value));
if (source.includes("OWNER_TOKENS") || source.includes("owner_tokens"))
  missing.push("OWNER_TOKENS must not be wired");
if (source.includes("000000000000") || source.includes("latest"))
  missing.push("fake certificate/account or mutable image marker detected");
if (missing.length) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log("Infrastructure/runtime cross-wire checks passed.");
