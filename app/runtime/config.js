const fs = require("node:fs");

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing required configuration: ${name}`);
  return value;
}

function integer(env, name, fallback, minimum, maximum) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`invalid configuration: ${name}`);
  return value;
}

function rawSecret(env, name, pattern) {
  const value = required(env, name);
  if (value.startsWith("{") || (pattern && !pattern.test(value)))
    throw new Error(`invalid raw secret configuration: ${name}`);
  return value;
}

function databaseCa(env) {
  const inline = env.DATABASE_SSL_CA?.trim();
  const filePath = env.DATABASE_SSL_CA_PATH?.trim();
  if (Boolean(inline) === Boolean(filePath))
    throw new Error(
      "exactly one of DATABASE_SSL_CA or DATABASE_SSL_CA_PATH is required",
    );
  let value;
  if (filePath) {
    if (!filePath.startsWith("/"))
      throw new Error("DATABASE_SSL_CA_PATH must be an absolute path");
    try {
      value = fs.readFileSync(filePath, "utf8");
    } catch {
      throw new Error("DATABASE_SSL_CA_PATH is unreadable");
    }
  } else value = inline.replaceAll("\\n", "\n");
  if (
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----")
  )
    throw new Error("database CA source must contain a PEM certificate bundle");
  return value;
}

function productionConfig(mode, env) {
  if (!new Set(["api", "publisher", "worker", "migration"]).has(mode))
    throw new Error("invalid process mode");
  if (required(env, "ENVIRONMENT") !== "production")
    throw new Error("production ENVIRONMENT must be production");
  if (required(env, "DATABASE_ENGINE") !== "postgresql")
    throw new Error("production DATABASE_ENGINE must be postgresql");
  const databaseUrl = rawSecret(
    env,
    "DATABASE_URL",
    /^postgres(?:ql)?:\/\/.+$/,
  );
  if (required(env, "DATABASE_SSL_MODE") !== "require")
    throw new Error("production DATABASE_SSL_MODE must be require");
  const databaseSslCa = databaseCa(env);
  const config = {
    environment: "production",
    mode,
    databaseEngine: "postgresql",
    databaseUrl,
    databaseSsl: { rejectUnauthorized: true, ca: databaseSslCa },
    databasePoolMax: integer(env, "DB_POOL_MAX", 10, 1, 100),
    databaseConnectTimeoutMs: integer(
      env,
      "DB_CONNECT_TIMEOUT_MS",
      3000,
      100,
      30000,
    ),
    databaseStatementTimeoutMs: integer(
      env,
      "DB_STATEMENT_TIMEOUT_MS",
      5000,
      100,
      120000,
    ),
  };
  if (mode !== "migration") config.awsRegion = required(env, "AWS_REGION");
  if (mode === "api") {
    if (required(env, "AUTH_MODE") !== "jwt")
      throw new Error("production AUTH_MODE must be jwt");
    const issuer = required(env, "JWT_ISSUER");
    if (!/^https:\/\/[^/]+\/.+/.test(issuer))
      throw new Error("JWT_ISSUER must be an HTTPS issuer URL");
    Object.assign(config, {
      authMode: "jwt",
      jwtIssuer: issuer.replace(/\/$/, ""),
      jwtClientId: required(env, "JWT_CLIENT_ID"),
      jwtAdminGroup: env.JWT_ADMIN_GROUP?.trim() || "admin",
      jwtOperatorGroup: env.JWT_OPERATOR_GROUP?.trim() || "operator",
      cursorSigningSecret: rawSecret(env, "CURSOR_SIGNING_SECRET", /^.{32,}$/),
      reportBucketName: required(env, "REPORT_BUCKET_NAME"),
      reportDownloadExpiresSeconds: integer(
        env,
        "REPORT_DOWNLOAD_EXPIRES_SECONDS",
        300,
        60,
        900,
      ),
    });
  }
  if (mode === "publisher" || mode === "worker") {
    Object.assign(config, {
      reportQueueUrl: required(env, "REPORT_QUEUE_URL"),
      reportVisibilityTimeoutSeconds: integer(
        env,
        "REPORT_VISIBILITY_TIMEOUT_SECONDS",
        300,
        30,
        43200,
      ),
      reportHeartbeatSeconds: integer(
        env,
        "REPORT_HEARTBEAT_SECONDS",
        120,
        5,
        3600,
      ),
    });
    if (config.reportHeartbeatSeconds >= config.reportVisibilityTimeoutSeconds)
      throw new Error(
        "REPORT_HEARTBEAT_SECONDS must be below the visibility timeout",
      );
  }
  if (mode === "worker")
    config.reportBucketName = required(env, "REPORT_BUCKET_NAME");
  return config;
}

function readRuntimeConfig(mode, env = process.env) {
  if (env.ENVIRONMENT === "local")
    return {
      environment: "local",
      mode,
      databaseEngine: "sqlite",
      authMode: "local",
      cursorSigningSecret:
        env.CURSOR_SIGNING_SECRET ||
        "local-cursor-signing-secret-not-for-shared-use",
    };
  return productionConfig(mode, env);
}

module.exports = { readRuntimeConfig };
