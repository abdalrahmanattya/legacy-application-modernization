const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const files = ["app/baseline", "scripts/baseline", "tests/baseline"].flatMap(
  (dir) =>
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".js"))
      .map((file) => path.join(dir, file)),
);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status) failed = true;
}
process.exit(failed ? 1 : 0);
