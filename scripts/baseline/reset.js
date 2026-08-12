const fs = require("node:fs");
const { DEFAULT_PATH } = require("../../app/baseline/db");
for (const suffix of ["", "-shm", "-wal"]) {
  try {
    fs.unlinkSync(DEFAULT_PATH + suffix);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
console.log("reset baseline database");
