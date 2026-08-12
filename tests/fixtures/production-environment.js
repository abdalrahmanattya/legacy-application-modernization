const productionBase = Object.freeze({
  ENVIRONMENT: "production",
  DATABASE_ENGINE: "postgresql",
  DATABASE_URL: "postgresql://raw-secret@database.internal/orders",
  DATABASE_SSL_MODE: "require",
  DATABASE_SSL_CA:
    "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----",
  AWS_REGION: "eu-west-1",
});

const apiEnvironment = () => ({
  ...productionBase,
  AUTH_MODE: "jwt",
  JWT_ISSUER: "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_fixture",
  JWT_CLIENT_ID: "portfolio-client",
  JWT_ADMIN_GROUP: "admin",
  JWT_OPERATOR_GROUP: "operator",
  CURSOR_SIGNING_SECRET: "a-production-cursor-secret-over-32-chars",
  REPORT_BUCKET_NAME: "private-reports",
});

const publisherEnvironment = () => ({
  ...productionBase,
  REPORT_QUEUE_URL: "https://sqs.eu-west-1.amazonaws.com/123/report-jobs",
});

const workerEnvironment = () => ({
  ...publisherEnvironment(),
  REPORT_BUCKET_NAME: "private-reports",
  REPORT_VISIBILITY_TIMEOUT_SECONDS: "300",
  REPORT_HEARTBEAT_SECONDS: "120",
});

module.exports = {
  productionBase,
  apiEnvironment,
  publisherEnvironment,
  workerEnvironment,
};
