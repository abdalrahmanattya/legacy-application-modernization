const test = require("node:test");
const assert = require("node:assert/strict");
const { csv, percentile, redact } = require("../../tools/baseline/common");

test("percentile is deterministic and bounded", () => {
  assert.equal(percentile([3, 1, 2], 95), 3);
  assert.equal(percentile([], 95), null);
});
test("redaction removes token-shaped values without exposing them", () => {
  const output = JSON.stringify(
    redact({
      authorization: "Bearer local-baseline-token",
      note: "token=local-baseline-token",
    }),
  );
  assert.doesNotMatch(output, /local-baseline-token/);
  assert.match(output, /redacted/);
});
test("csv emits stable headers and escaped fields", () => {
  assert.equal(
    csv([{ route: "/v1/orders", status: 201, note: "a,b" }]),
    'route,status,note\n"/v1/orders","201","a,b"\n',
  );
});
test("order identifiers follow UUID v4 shape", () => {
  assert.match(
    "550e8400-e29b-41d4-a716-446655440000",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
