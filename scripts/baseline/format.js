const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  [
    require.resolve("prettier/bin/prettier.cjs"),
    "--check",
    "app/baseline",
    "scripts/baseline",
    "tests/baseline",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
