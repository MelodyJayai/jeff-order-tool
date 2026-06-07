/* eslint-disable @typescript-eslint/no-require-imports */

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--force" || arg === "--help" || arg === "-h") {
      values[arg.replace(/^-+/u, "")] = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[index + 1];

      if (next && !next.startsWith("--")) {
        values[key] = next;
        index += 1;
      }
    }
  }

  return values;
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

function hasOrdersDb(dir) {
  return fs.existsSync(path.join(dir, "orders.db"));
}

function findDataDir(candidate, depth = 0) {
  if (!candidate || depth > 5 || !fs.existsSync(candidate)) {
    return null;
  }

  const stat = fs.statSync(candidate);

  if (!stat.isDirectory()) {
    return null;
  }

  if (hasOrdersDb(candidate)) {
    return candidate;
  }

  const directData = path.join(candidate, "data");

  if (hasOrdersDb(directData)) {
    return directData;
  }

  const packageData = path.join(candidate, "JeffOrderTool", "data");

  if (hasOrdersDb(packageData)) {
    return packageData;
  }

  for (const item of fs.readdirSync(candidate, { withFileTypes: true })) {
    if (!item.isDirectory()) {
      continue;
    }

    const found = findDataDir(path.join(candidate, item.name), depth + 1);

    if (found) {
      return found;
    }
  }

  return null;
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function orderCount(dataDir) {
  const dbPath = path.join(dataDir, "orders.db");

  if (!fs.existsSync(dbPath)) {
    return 0;
  }

  const db = new Database(dbPath, { fileMustExist: true, readonly: true });

  try {
    if (!tableExists(db, "orders")) {
      return 0;
    }

    const row = db.prepare("SELECT COUNT(*) AS count FROM orders").get();
    return Number(row?.count ?? 0);
  } finally {
    db.close();
  }
}

function defaultTargetDataDir() {
  if (process.env.JEFF_ORDER_DB_PATH) {
    return path.dirname(path.resolve(process.env.JEFF_ORDER_DB_PATH));
  }

  if (process.env.JEFF_CLOUD_DATA_DIR) {
    return path.resolve(process.env.JEFF_CLOUD_DATA_DIR);
  }

  return path.join(root, "cloud-data");
}

function usage() {
  console.log(`Usage:
  npm run migrate:cloud-data -- --from "D:\\tools\\JeffOrderTool-v0.1.8\\JeffOrderTool\\data" --to "D:\\JeffOrderToolCloud\\data"

Options:
  --from   Old data folder, old package folder, or a parent folder to scan.
  --to     Cloud data folder. Defaults to JEFF_ORDER_DB_PATH directory or ./cloud-data.
  --force  Replace target data even when the target already has orders.
`);
}

function backupExistingTarget(targetDataDir) {
  if (!fs.existsSync(targetDataDir)) {
    return null;
  }

  const entries = fs.readdirSync(targetDataDir);

  if (entries.length === 0) {
    return null;
  }

  const backupDir = `${targetDataDir}-before-cloud-migration-${timestamp()}`;
  fs.cpSync(targetDataDir, backupDir, { recursive: true });
  return backupDir;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h || !args.from) {
    usage();
    process.exit(args.help || args.h ? 0 : 1);
  }

  const sourceDataDir = findDataDir(path.resolve(args.from));

  if (!sourceDataDir) {
    throw new Error(`Could not find orders.db under: ${args.from}`);
  }

  const targetDataDir = path.resolve(args.to || defaultTargetDataDir());
  const sourceOrders = orderCount(sourceDataDir);
  const targetOrders = orderCount(targetDataDir);

  if (targetOrders > 0 && !args.force) {
    throw new Error(
      `Target already has ${targetOrders} orders. Use --force only after making a manual backup.`,
    );
  }

  const backupDir = backupExistingTarget(targetDataDir);

  if (fs.existsSync(targetDataDir)) {
    fs.rmSync(targetDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(targetDataDir), { recursive: true });
  fs.cpSync(sourceDataDir, targetDataDir, { recursive: true });

  console.log("CLOUD_DATA_MIGRATION_OK");
  console.log(`Source: ${sourceDataDir}`);
  console.log(`Target: ${targetDataDir}`);
  console.log(`Source orders: ${sourceOrders}`);
  console.log(`Previous target orders: ${targetOrders}`);

  if (backupDir) {
    console.log(`Previous target backup: ${backupDir}`);
  }
}

main();
