const crypto = require("node:crypto");
const { badRequest } = require("./errors");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

function cursorCodec(secret) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error(
      "cursor signing secret must contain at least 32 characters",
    );
  const sign = (payload) =>
    crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    encode(position, scope) {
      const payload = Buffer.from(
        JSON.stringify(canonical({ version: 1, position, scope })),
      ).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    decode(value, scope) {
      try {
        if (typeof value !== "string" || value.length > 1024)
          throw new Error("length");
        const [payload, signature, extra] = String(value).split(".");
        if (!payload || !signature || extra) throw new Error("shape");
        const expected = Buffer.from(sign(payload));
        const supplied = Buffer.from(signature);
        if (
          supplied.length !== expected.length ||
          !crypto.timingSafeEqual(supplied, expected)
        )
          throw new Error("signature");
        const decoded = JSON.parse(Buffer.from(payload, "base64url"));
        if (
          decoded.version !== 1 ||
          JSON.stringify(canonical(decoded.scope)) !==
            JSON.stringify(canonical(scope)) ||
          !decoded.position?.createdAt ||
          !decoded.position?.orderId
        )
          throw new Error("scope");
        return decoded.position;
      } catch {
        throw badRequest("invalid cursor");
      }
    },
  };
}

module.exports = { cursorCodec };
