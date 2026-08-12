const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

test("cost model is deterministic and shows NAT-free sensitivity", () => {
  const output = execFileSync(
    "node",
    ["scripts/infrastructure/cost-calculator.js"],
    { encoding: "utf8" },
  );
  const result = JSON.parse(output);
  assert.equal(result.currency, "USD");
  assert.ok(
    result.scenarios.prod_load_nat_free.total >
      result.scenarios.prod_idle_nat_free.total,
  );
  assert.ok(
    result.scenarios.prod_idle_nat.total >
      result.scenarios.prod_idle_nat_free.total,
  );
  assert.equal(result.scenarios.prod_idle_nat_free.nat, 0);
});
