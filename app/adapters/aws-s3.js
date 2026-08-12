const crypto = require("node:crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const JOB_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT = /^reports\/[0-9a-f-]{36}\.(?:json|csv)$/i;
const CORRELATION = /^[A-Za-z0-9._:-]{1,64}$/;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

class AwsS3ArtifactStore {
  constructor({ client, bucketName, region, presigner = getSignedUrl }) {
    if (!bucketName) throw new Error("REPORT_BUCKET_NAME is required");
    this.client = client || new S3Client({ region });
    this.bucketName = bucketName;
    this.presigner = presigner;
  }

  async put({ jobId, contentType, body, correlationId, traceparent }) {
    if (!JOB_ID.test(jobId || "")) throw new Error("invalid report job ID");
    if (!["application/json", "text/csv"].includes(contentType))
      throw new Error("invalid report artifact content type");
    if (correlationId && !CORRELATION.test(correlationId))
      throw new Error("invalid report artifact correlation ID");
    if (traceparent && !TRACEPARENT.test(traceparent))
      throw new Error("invalid report artifact trace context");
    const bytes = Buffer.from(body, "utf8");
    const checksumBytes = crypto.createHash("sha256").update(bytes).digest();
    const checksumHex = checksumBytes.toString("hex");
    const extension = contentType === "text/csv" ? "csv" : "json";
    const key = `reports/${jobId}.${extension}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ChecksumSHA256: checksumBytes.toString("base64"),
        Metadata: {
          "report-job-id": jobId,
          sha256: checksumHex,
          ...(correlationId ? { "correlation-id": correlationId } : {}),
          ...(traceparent ? { traceparent } : {}),
        },
      }),
    );
    return {
      artifactId: key,
      contentType,
      checksumSha256: checksumHex,
      sizeBytes: bytes.length,
    };
  }

  async presign(artifactId, expiresIn = 300) {
    if (!ARTIFACT.test(artifactId || ""))
      throw new Error("invalid report artifact identifier");
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 900)
      throw new Error("invalid report download expiry");
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: artifactId,
    });
    return this.presigner(this.client, command, { expiresIn });
  }

  destroy() {
    this.client.destroy?.();
  }
}

module.exports = { AwsS3ArtifactStore };
