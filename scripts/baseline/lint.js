const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(target)
      : entry.name.endsWith(".js")
        ? [target]
        : [];
  });
}
const files = ["app", "scripts", "tests"].flatMap(javascriptFiles);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status) failed = true;
}
process.exit(failed ? 1 : 0);
