/* eslint-disable @typescript-eslint/no-require-imports */

// Start an isolated local preview instance. This intentionally does not read
// .env.cloud or reuse the normal data directory used by the desktop build.
// It is safe to run alongside the production desktop instance.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const previewDistDir = ".next-preview";
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const resolve = (value) => path.resolve(value);

// Do not inherit PORT: a production shell may export 3000 and would then
// accidentally make the preview compete for the production listener.
const port = clean(process.env.JEFF_PREVIEW_PORT) || "3211";
const publicUrl =
  clean(process.env.JEFF_PREVIEW_PUBLIC_URL) || `http://127.0.0.1:${port}`;
const dataDir = resolve(
  clean(process.env.JEFF_PREVIEW_DATA_DIR) || path.join(root, ".preview-data"),
);
const dbPath = resolve(path.join(dataDir, "orders.db"));
const backupDir = resolve(path.join(dataDir, "backups"));
const productionDataDirs = [
  path.join(root, "data"),
  path.join(root, "cloud-data"),
  // Current production is hosted from this separate checkout. Keep the
  // guard here so an operator cannot accidentally point the preview at it.
  "D:\\JeffOrderToolCloudTrial\\data",
  clean(process.env.JEFF_PRODUCTION_DATA_DIR),
]
  .filter(Boolean)
  .map(resolve)
  .map((item) => item.toLowerCase());

if (productionDataDirs.includes(dataDir.toLowerCase())) {
  throw new Error(
    `Refusing to start preview with a production data directory: ${dataDir}`,
  );
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(nextBin)) {
  throw new Error("Next.js is not installed. Run npm ci first.");
}
if (!fs.existsSync(path.join(root, previewDistDir))) {
  throw new Error("Preview build not found. Run npm run build:preview first.");
}

fs.mkdirSync(backupDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: port,
  JEFF_DEPLOYMENT_MODE: "cloud",
  JEFF_DISABLE_IN_APP_UPDATES: "true",
  // The preview is intentionally writable so two browsers can exercise
  // concurrent order changes without touching the production database.
  JEFF_CLOUD_SYNC_READ_ONLY: "false",
  JEFF_CONCURRENCY_PREVIEW: "1",
  JEFF_DUAL_HOST_PREVIEW: "true",
  JEFF_ORDER_DB_PATH: dbPath,
  JEFF_BACKUP_DIR: backupDir,
  JEFF_PUBLIC_URL: publicUrl,
  NEXT_PUBLIC_SITE_URL: publicUrl,
  JEFF_NEXT_DIST_DIR: previewDistDir,
  JEFF_COOKIE_SECURE: "false",
  JEFF_SESSION_COOKIE_NAME: "jeff_order_preview_session",
};

// Never reuse a production password supplied by the parent shell. An explicit
// preview-only variable is available for automated smoke tests.
delete env.JEFF_ADMIN_PASSWORD;
if (clean(process.env.JEFF_PREVIEW_ADMIN_PASSWORD)) {
  env.JEFF_ADMIN_PASSWORD = process.env.JEFF_PREVIEW_ADMIN_PASSWORD;
}

console.log("Starting Jeff Order Tool isolated preview");
console.log(`URL: ${env.JEFF_PUBLIC_URL}`);
console.log(`Database: ${env.JEFF_ORDER_DB_PATH}`);
console.log(`Backups: ${env.JEFF_BACKUP_DIR}`);
console.log("Production data and session cookie are not used.");

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", env.HOSTNAME, "--port", env.PORT],
  { cwd: root, env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Preview stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
