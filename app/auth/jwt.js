const crypto = require("node:crypto");

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function cognitoJwtAuthenticator({
  issuer,
  clientId,
  jwks,
  fetchJwks,
  adminGroup = "admin",
  operatorGroup = "operator",
  clock = () => Math.floor(Date.now() / 1000),
  cacheMs = 300_000,
}) {
  if (!issuer || !clientId || (!jwks && !fetchJwks))
    throw new Error("JWT issuer, client ID, and JWKS source are required");
  let cached = jwks || null;
  let loadedAt = jwks ? Date.now() : 0;
  const load = async (force = false) => {
    if (!force && cached && Date.now() - loadedAt < cacheMs) return cached;
    cached = await fetchJwks();
    loadedAt = Date.now();
    return cached;
  };
  async function verify(header) {
    const parts = String(header || "").split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
    const segments = parts[1].split(".");
    if (segments.length !== 3) return null;
    try {
      const protectedHeader = decodePart(segments[0]);
      const claims = decodePart(segments[1]);
      if (protectedHeader.alg !== "RS256" || !protectedHeader.kid) return null;
      let keys = await load();
      let key = keys.keys?.find((item) => item.kid === protectedHeader.kid);
      if (!key && fetchJwks) {
        keys = await load(true);
        key = keys.keys?.find((item) => item.kid === protectedHeader.kid);
      }
      if (!key) return null;
      const valid = crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${segments[0]}.${segments[1]}`),
        crypto.createPublicKey({ key, format: "jwk" }),
        Buffer.from(segments[2], "base64url"),
      );
      const now = clock();
      if (
        !valid ||
        claims.iss !== issuer ||
        claims.token_use !== "access" ||
        claims.client_id !== clientId ||
        typeof claims.sub !== "string" ||
        !claims.sub ||
        claims.sub.length > 256 ||
        typeof claims.exp !== "number" ||
        claims.exp <= now ||
        (typeof claims.nbf === "number" && claims.nbf > now)
      )
        return null;
      const groups = Array.isArray(claims["cognito:groups"])
        ? claims["cognito:groups"]
        : [];
      const roles = [
        ...(groups.includes(operatorGroup) ? ["operator"] : []),
        ...(groups.includes(adminGroup) ? ["admin"] : []),
      ];
      return {
        subject: `${issuer}#${claims.sub}`,
        roles,
      };
    } catch {
      return null;
    }
  }
  return { authenticate: verify };
}

module.exports = { cognitoJwtAuthenticator };
