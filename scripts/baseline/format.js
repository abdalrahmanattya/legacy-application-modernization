const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  [
    require.resolve("prettier/bin/prettier.cjs"),
    "--check",
    "app",
    "scripts",
    "tests",
    "migrations",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
