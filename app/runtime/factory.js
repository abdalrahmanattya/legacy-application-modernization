const { openDatabase } = require("../baseline/db");
const { SqliteRepository } = require("../repositories/sqlite");
const { PostgresqlRepository } = require("../repositories/postgresql");
const { createPool } = require("../postgresql");
const { localAuthenticator } = require("../auth/local");
const { cognitoJwtAuthenticator } = require("../auth/jwt");
const { AwsSqsReportQueue } = require("../adapters/aws-sqs");
const { AwsS3ArtifactStore } = require("../adapters/aws-s3");

function createRepository(config) {
  if (config.databaseEngine === "sqlite")
    return new SqliteRepository(openDatabase());
  return new PostgresqlRepository(
    createPool({
      connectionString: config.databaseUrl,
      max: config.databasePoolMax,
      connectionTimeoutMillis: config.databaseConnectTimeoutMs,
      statement_timeout: config.databaseStatementTimeoutMs,
      ssl: config.databaseSsl,
    }),
  );
}

function createAuthenticator(config) {
  if (config.authMode === "local") return localAuthenticator();
  return cognitoJwtAuthenticator({
    issuer: config.jwtIssuer,
    clientId: config.jwtClientId,
    adminGroup: config.jwtAdminGroup,
    operatorGroup: config.jwtOperatorGroup,
    fetchJwks: async () => {
      const response = await fetch(
        `${config.jwtIssuer}/.well-known/jwks.json`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!response.ok) throw new Error("JWKS unavailable");
      return response.json();
    },
  });
}

const createQueue = (config, options = {}) =>
  new AwsSqsReportQueue({
    queueUrl: config.reportQueueUrl,
    region: config.awsRegion,
    visibilityTimeoutSeconds: config.reportVisibilityTimeoutSeconds,
    ...options,
  });

const createArtifactStore = (config, options = {}) =>
  new AwsS3ArtifactStore({
    bucketName: config.reportBucketName,
    region: config.awsRegion,
    ...options,
  });

module.exports = {
  createRepository,
  createAuthenticator,
  createQueue,
  createArtifactStore,
};
