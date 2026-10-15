/* eslint-disable @typescript-eslint/no-require-imports */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"],
  {
    cwd: root,
    env: { ...process.env, JEFF_NEXT_DIST_DIR: ".next-preview" },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
