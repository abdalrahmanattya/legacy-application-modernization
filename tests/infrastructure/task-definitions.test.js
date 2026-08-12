const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const templateDir = path.resolve(
  __dirname,
  "../../infra/modules/delivery/templates",
);
const digestImage = `repo@sha256:${"a".repeat(64)}`;
const environment = JSON.stringify([
  { name: "ENVIRONMENT", value: "production" },
  { name: "DATABASE_ENGINE", value: "postgresql" },
  { name: "AUTH_MODE", value: "jwt" },
  { name: "JWT_ADMIN_GROUP", value: "platform-admin" },
  { name: "DATABASE_SSL_MODE", value: "require" },
  { name: "DATABASE_SSL_CA_PATH", value: "/app/certs/global-bundle.pem" },
  {
    name: "REPORT_QUEUE_URL",
    value: "https://sqs.eu-west-1.amazonaws.com/example/reports",
  },
  { name: "REPORT_BUCKET_NAME", value: "example-reports" },
]);
const databaseSecret = JSON.stringify([
  {
    name: "DATABASE_URL",
    valueFrom: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:database",
  },
]);
const apiSecrets = JSON.stringify([
  ...JSON.parse(databaseSecret),
  {
    name: "CURSOR_SIGNING_SECRET",
    valueFrom: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:cursor",
  },
]);
const logOptions = JSON.stringify({
  "awslogs-group": "/aws/ecs/example",
  "awslogs-region": "eu-west-1",
  "awslogs-stream-prefix": "runtime",
});

function renderTemplate(file, secrets = databaseSecret) {
  const source = fs.readFileSync(path.join(templateDir, file), "utf8");
  const values = {
    image: digestImage,
    environment,
    secrets,
    log_options: logOptions,
  };
  return JSON.parse(
    source.replace(
      /\$\{(image|environment|secrets|log_options)\}/g,
      (_, key) => values[key],
    ),
  );
}

test("Terraform task templates render the complete runtime contract", () => {
  const cases = [
    ["api.json.tftpl", null, apiSecrets],
    [
      "migration.json.tftpl",
      ["node", "scripts/postgresql/migrate.js"],
      databaseSecret,
    ],
    [
      "publisher.json.tftpl",
      ["node", "app/processes/outbox-publisher.js"],
      databaseSecret,
    ],
    [
      "worker.json.tftpl",
      ["node", "app/processes/report-worker.js"],
      databaseSecret,
    ],
  ];
  for (const [file, command, secrets] of cases) {
    const [container] = renderTemplate(file, secrets);
    assert.match(container.image, /@sha256:[0-9a-f]{64}$/);
    assert.equal(container.stopTimeout, 40);
    assert.equal(container.user, "1000");
    assert.equal(container.readonlyRootFilesystem, true);
    if (command)
      assert.deepEqual(container.command?.slice(0, command.length), command);
    assert.equal(
      container.secrets.some(({ name }) => name === "OWNER_TOKENS"),
      false,
    );
    assert.equal(
      container.secrets.some(({ name }) => name === "DATABASE_URL"),
      true,
    );
    const env = Object.fromEntries(
      container.environment.map(({ name, value }) => [name, value]),
    );
    assert.equal(env.ENVIRONMENT, "production");
    assert.equal(env.DATABASE_SSL_CA_PATH, "/app/certs/global-bundle.pem");
    if (file === "api.json.tftpl") {
      assert.equal(container.portMappings[0].containerPort, 3000);
      assert.match(container.healthCheck.command[1], /\/healthz/);
      assert.equal(env.AUTH_MODE, "jwt");
      assert.equal(env.JWT_ADMIN_GROUP, "platform-admin");
      assert.equal(
        container.secrets.some(({ name }) => name === "CURSOR_SIGNING_SECRET"),
        true,
      );
    } else {
      assert.equal(
        container.secrets.some(({ name }) => name === "CURSOR_SIGNING_SECRET"),
        false,
      );
    }
  }
});
