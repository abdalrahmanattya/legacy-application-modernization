const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} = require("@aws-sdk/client-sqs");

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORRELATION = /^[A-Za-z0-9._:-]{1,64}$/;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

function validateMessage(value) {
  if (
    !value ||
    value.version !== 1 ||
    !UUID_V4.test(value.reportJobId || "") ||
    !CORRELATION.test(value.correlationId || "") ||
    (value.traceparent && !TRACEPARENT.test(value.traceparent)) ||
    Object.keys(value).some(
      (key) =>
        !["version", "reportJobId", "correlationId", "traceparent"].includes(
          key,
        ),
    )
  )
    throw new Error("invalid report queue message");
  return {
    version: 1,
    reportJobId: value.reportJobId,
    correlationId: value.correlationId,
    ...(value.traceparent ? { traceparent: value.traceparent } : {}),
  };
}

class AwsSqsReportQueue {
  constructor({
    client,
    queueUrl,
    region,
    waitTimeSeconds = 20,
    visibilityTimeoutSeconds = 300,
  }) {
    if (!queueUrl) throw new Error("REPORT_QUEUE_URL is required");
    this.client = client || new SQSClient({ region });
    this.queueUrl = queueUrl;
    this.waitTimeSeconds = waitTimeSeconds;
    this.visibilityTimeoutSeconds = visibilityTimeoutSeconds;
  }

  async send(message) {
    const body = validateMessage({ version: 1, ...message });
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(body),
      }),
    );
  }

  async receive() {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
        AttributeNames: ["ApproximateReceiveCount"],
      }),
    );
    const message = result.Messages?.[0];
    if (!message) return null;
    if (!message.ReceiptHandle || typeof message.Body !== "string")
      throw new Error("invalid report queue envelope");
    const body = validateMessage(JSON.parse(message.Body));
    let settled = false;
    return {
      body,
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount || 1),
      ack: async () => {
        if (settled) return;
        await this.client.send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        settled = true;
      },
      nack: async () => {
        if (settled) return;
        await this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        );
        settled = true;
      },
      extend: async (seconds = this.visibilityTimeoutSeconds) => {
        if (settled) return;
        await this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: seconds,
          }),
        );
      },
    };
  }

  destroy() {
    this.client.destroy?.();
  }
}

module.exports = { AwsSqsReportQueue, validateMessage };
