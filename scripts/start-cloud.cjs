/* eslint-disable @typescript-eslint/no-require-imports */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function setDefault(key, value) {
  if (!clean(process.env[key])) {
    process.env[key] = value;
  }
}

function unquote(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filePath, override = false) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");

    if (equalIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const value = unquote(trimmed.slice(equalIndex + 1));

    if (override || !clean(process.env[key])) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env.cloud"), true);

const dataDir = clean(process.env.JEFF_CLOUD_DATA_DIR)
  ? path.resolve(process.env.JEFF_CLOUD_DATA_DIR)
  : path.join(root, "cloud-data");

setDefault("NODE_ENV", "production");
setDefault("PORT", "3000");
setDefault("HOSTNAME", "0.0.0.0");
setDefault("JEFF_DEPLOYMENT_MODE", "cloud");
setDefault("JEFF_DISABLE_IN_APP_UPDATES", "true");
setDefault("JEFF_ENABLE_RETURN_WORKFLOW", "false");
setDefault("JEFF_ORDER_DB_PATH", path.join(dataDir, "orders.db"));
setDefault("JEFF_BACKUP_DIR", path.join(dataDir, "backups"));

fs.mkdirSync(path.dirname(process.env.JEFF_ORDER_DB_PATH), { recursive: true });
fs.mkdirSync(process.env.JEFF_BACKUP_DIR, { recursive: true });

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!fs.existsSync(nextBin)) {
  console.error("Next.js is not installed. Run npm ci first.");
  process.exit(1);
}

if (!fs.existsSync(path.join(root, ".next"))) {
  console.error("Production build not found. Run npm run build first.");
  process.exit(1);
}

console.log(
  `Starting Jeff Order Tool cloud server on ${process.env.HOSTNAME}:${process.env.PORT}`,
);
console.log(`Database: ${process.env.JEFF_ORDER_DB_PATH}`);
console.log(`Backups: ${process.env.JEFF_BACKUP_DIR}`);

const child = spawn(
  process.execPath,
  [
    nextBin,
    "start",
    "--hostname",
    process.env.HOSTNAME,
    "--port",
    process.env.PORT,
  ],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Cloud server stopped by signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});
