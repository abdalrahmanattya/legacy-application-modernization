const crypto = require("node:crypto");

const DEFAULT_FIXTURES = {
  "operator-a": process.env.OPERATOR_A_TOKEN || "local-operator-a-token",
  "operator-b": process.env.OPERATOR_B_TOKEN || "local-operator-b-token",
  admin: process.env.ADMIN_TOKEN || "local-admin-token",
};

function localAuthenticator(fixtures = DEFAULT_FIXTURES) {
  const entries = Object.entries(fixtures).map(([subject, token]) => ({
    subject,
    roles: subject === "admin" ? ["admin"] : ["operator"],
    token: String(token),
  }));
  return {
    async authenticate(header) {
      const parts = String(header || "").split(" ");
      if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer")
        return null;
      const supplied = Buffer.from(parts[1]);
      for (const fixture of entries) {
        const expected = Buffer.from(fixture.token);
        if (
          expected.length === supplied.length &&
          crypto.timingSafeEqual(expected, supplied)
        )
          return { subject: fixture.subject, roles: [...fixture.roles] };
      }
      return null;
    },
  };
}

module.exports = { DEFAULT_FIXTURES, localAuthenticator };
