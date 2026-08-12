const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} = require("@aws-sdk/client-sqs");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { AwsSqsReportQueue } = require("../../app/adapters/aws-sqs");
const { AwsS3ArtifactStore } = require("../../app/adapters/aws-s3");
const { readRuntimeConfig } = require("../../app/runtime/config");
const { createReportWorker } = require("../../app/report-worker");
const { runPublisher } = require("../../app/processes/outbox-publisher");
const { runWorker } = require("../../app/processes/report-worker");
const {
  productionBase,
  apiEnvironment,
  workerEnvironment,
} = require("../fixtures/production-environment");

class FakeClient {
  constructor(responses = []) {
    this.responses = [...responses];
    this.commands = [];
    this.destroyed = false;
  }
  async send(command) {
    this.commands.push(command);
    return this.responses.shift() || {};
  }
  destroy() {
    this.destroyed = true;
  }
}

const jobId = "550e8400-e29b-41d4-a716-446655440000";
const context = {
  reportJobId: jobId,
  correlationId: "correlation-123",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

test("SQS adapter sends only safe job context and controls message lifecycle", async () => {
  const receivedBody = JSON.stringify({ version: 1, ...context });
  const client = new FakeClient([
    {},
    {
      Messages: [
        {
          Body: receivedBody,
          ReceiptHandle: "receipt-fixture",
          Attributes: { ApproximateReceiveCount: "2" },
        },
      ],
    },
    {},
    {},
  ]);
  const queue = new AwsSqsReportQueue({
    client,
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123/report-jobs",
    waitTimeSeconds: 1,
    visibilityTimeoutSeconds: 300,
  });
  await queue.send(context);
  assert.ok(client.commands[0] instanceof SendMessageCommand);
  assert.deepEqual(JSON.parse(client.commands[0].input.MessageBody), {
    version: 1,
    ...context,
  });
  assert.doesNotMatch(
    client.commands[0].input.MessageBody,
    /customerReference|bearer|idempotency/i,
  );
  const message = await queue.receive();
  assert.ok(client.commands[1] instanceof ReceiveMessageCommand);
  assert.equal(message.receiveCount, 2);
  await message.extend(240);
  assert.ok(client.commands[2] instanceof ChangeMessageVisibilityCommand);
  assert.equal(client.commands[2].input.VisibilityTimeout, 240);
  await message.ack();
  assert.ok(client.commands[3] instanceof DeleteMessageCommand);
  queue.destroy();
  assert.equal(client.destroyed, true);
});

test("SQS adapter nacks without deleting and rejects poison payloads", async () => {
  const client = new FakeClient([
    {
      Messages: [
        {
          Body: JSON.stringify({ version: 1, ...context }),
          ReceiptHandle: "retry-receipt",
        },
      ],
    },
    {},
  ]);
  const queue = new AwsSqsReportQueue({ client, queueUrl: "queue" });
  const message = await queue.receive();
  await message.nack();
  assert.ok(client.commands[1] instanceof ChangeMessageVisibilityCommand);
  assert.equal(client.commands[1].input.VisibilityTimeout, 0);
  assert.equal(
    client.commands.some((command) => command instanceof DeleteMessageCommand),
    false,
  );
  const poison = new AwsSqsReportQueue({
    client: new FakeClient([
      {
        Messages: [
          {
            Body: JSON.stringify({ ...context, customerReference: "secret" }),
            ReceiptHandle: "poison",
          },
        ],
      },
    ]),
    queueUrl: "queue",
  });
  await assert.rejects(poison.receive(), /invalid report queue message/);
});

test("S3 adapter sends checksum metadata and presigns a bounded private get", async () => {
  const client = new FakeClient([{}]);
  let signed;
  const store = new AwsS3ArtifactStore({
    client,
    bucketName: "private-report-bucket",
    presigner: async (passedClient, command, options) => {
      signed = { passedClient, command, options };
      return "https://signed.invalid/report";
    },
  });
  const body = '{"safe":true}';
  const result = await store.put({
    jobId,
    contentType: "application/json",
    body,
  });
  const command = client.commands[0];
  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.Bucket, "private-report-bucket");
  assert.equal(command.input.ServerSideEncryption, undefined);
  assert.equal(
    command.input.ChecksumSHA256,
    crypto.createHash("sha256").update(body).digest("base64"),
  );
  assert.equal(
    command.input.Metadata.sha256,
    crypto.createHash("sha256").update(body).digest("hex"),
  );
  assert.doesNotMatch(JSON.stringify(command.input.Metadata), /customer/i);
  assert.equal(result.artifactId, `reports/${jobId}.json`);
  assert.equal(
    await store.presign(result.artifactId, 300),
    "https://signed.invalid/report",
  );
  assert.equal(signed.passedClient, client);
  assert.ok(signed.command instanceof GetObjectCommand);
  assert.equal(signed.options.expiresIn, 300);
  await assert.rejects(store.presign("../secret", 300), /invalid/);
  await assert.rejects(store.presign(result.artifactId, 3600), /invalid/);
});

test("worker coordinates queue visibility and database lease heartbeats", async () => {
  let queueExtended = 0;
  let leaseExtended = 0;
  let acknowledged = 0;
  let heartbeatObserved;
  const firstHeartbeat = new Promise((resolve) => {
    heartbeatObserved = resolve;
  });
  const observeHeartbeat = () => {
    if (queueExtended && leaseExtended) heartbeatObserved();
  };
  const queue = {
    receive: async () => ({
      body: context,
      extend: async () => {
        queueExtended += 1;
        observeHeartbeat();
      },
      ack: async () => {
        acknowledged += 1;
      },
      nack: async () => {},
    }),
  };
  const repository = {
    claimReportJob: async () => ({
      jobId,
      filters: {},
      format: "json",
    }),
    report: async () => [],
    extendReportJobLease: async () => {
      leaseExtended += 1;
      observeHeartbeat();
    },
    completeReportJob: async () => {},
    releaseReportJob: async () => {},
  };
  const worker = createReportWorker({
    repository,
    queue,
    artifactStore: {
      put: async ({ jobId: storedJobId }) => {
        await Promise.race([
          firstHeartbeat,
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
        return { artifactId: `reports/${storedJobId}.json` };
      },
    },
    visibilityTimeoutSeconds: 60,
    heartbeatSeconds: 0.01,
  });
  assert.equal(await worker.runOnce(), true);
  assert.ok(queueExtended >= 1);
  assert.ok(leaseExtended >= 1);
  assert.equal(acknowledged, 1);
});

test("publisher and worker loops stop cleanly at process boundaries", async () => {
  let publisherStop = false;
  const sent = [];
  await runPublisher({
    repository: {
      pendingOutbox: async () => [
        {
          eventId: "event",
          jobId,
          correlationId: context.correlationId,
          traceparent: context.traceparent,
        },
      ],
      markOutboxPublished: async () => {
        publisherStop = true;
      },
    },
    queue: { send: async (message) => sent.push(message) },
    shouldStop: () => publisherStop,
    idleMs: 1,
  });
  assert.deepEqual(sent, [context]);
  let workerStop = false;
  await runWorker({
    worker: {
      runOnce: async () => {
        workerStop = true;
        return true;
      },
    },
    shouldStop: () => workerStop,
    retryMs: 1,
  });
});

test("production configuration is mode-specific, raw, verified, and fail-fast", () => {
  const api = readRuntimeConfig("api", apiEnvironment());
  assert.equal(api.databaseUrl, productionBase.DATABASE_URL);
  assert.equal(api.databaseSsl.rejectUnauthorized, true);
  assert.equal(api.jwtAdminGroup, "admin");
  assert.equal(api.jwtOperatorGroup, "operator");
  assert.equal("OPERATOR_A_TOKEN" in api, false);
  const worker = readRuntimeConfig("worker", workerEnvironment());
  assert.equal(worker.reportVisibilityTimeoutSeconds, 300);
  assert.equal(worker.reportHeartbeatSeconds, 120);
  assert.throws(
    () => readRuntimeConfig("api", productionBase),
    /missing required configuration/,
  );
  assert.throws(
    () =>
      readRuntimeConfig("migration", { ...productionBase, ENVIRONMENT: "aws" }),
    /must be production/,
  );
  assert.throws(
    () =>
      readRuntimeConfig("migration", {
        ...productionBase,
        DATABASE_URL: '{"url":"postgresql:\/\/ambiguous"}',
      }),
    /invalid raw secret configuration/,
  );
  assert.throws(
    () =>
      readRuntimeConfig("worker", {
        ...productionBase,
        REPORT_QUEUE_URL: "queue",
        REPORT_BUCKET_NAME: "bucket",
        REPORT_VISIBILITY_TIMEOUT_SECONDS: "30",
        REPORT_HEARTBEAT_SECONDS: "30",
      }),
    /below the visibility timeout/,
  );
  assert.throws(
    () =>
      readRuntimeConfig("migration", {
        ...productionBase,
        DATABASE_SSL_MODE: "disable",
      }),
    /must be require/,
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wave2-ca-"));
  const caPath = path.join(directory, "global-bundle.pem");
  fs.writeFileSync(caPath, productionBase.DATABASE_SSL_CA);
  try {
    const fromPath = readRuntimeConfig("migration", {
      ...productionBase,
      DATABASE_SSL_CA: undefined,
      DATABASE_SSL_CA_PATH: caPath,
    });
    assert.equal(fromPath.databaseSsl.rejectUnauthorized, true);
    assert.equal(fromPath.databaseSsl.ca, productionBase.DATABASE_SSL_CA);
    assert.throws(
      () =>
        readRuntimeConfig("migration", {
          ...productionBase,
          DATABASE_SSL_CA_PATH: caPath,
        }),
      /exactly one/,
    );
    assert.throws(
      () =>
        readRuntimeConfig("migration", {
          ...productionBase,
          DATABASE_SSL_CA: undefined,
          DATABASE_SSL_CA_PATH: "relative.pem",
        }),
      /absolute path/,
    );
    assert.throws(
      () =>
        readRuntimeConfig("migration", {
          ...productionBase,
          DATABASE_SSL_CA: undefined,
          DATABASE_SSL_CA_PATH: path.join(directory, "missing.pem"),
        }),
      /unreadable/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
