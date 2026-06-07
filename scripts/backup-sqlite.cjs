/* eslint-disable @typescript-eslint/no-require-imports */

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

function backupTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

function retentionDays() {
  const parsed = Number.parseInt(process.env.JEFF_BACKUP_RETENTION_DAYS || "30", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function cleanupBackupFiles(backupDir) {
  if (!fs.existsSync(backupDir)) {
    return;
  }

  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;

  for (const item of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!item.isFile() || !/^jeff-order-.*\.db$/u.test(item.name)) {
      continue;
    }

    const filePath = path.join(backupDir, item.name);
    const stat = fs.statSync(filePath);

    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

async function main() {
  const dbPath = process.env.JEFF_ORDER_DB_PATH
    ? path.resolve(process.env.JEFF_ORDER_DB_PATH)
    : path.join(process.cwd(), "data", "orders.db");
  const backupDir = process.env.JEFF_BACKUP_DIR
    ? path.resolve(process.env.JEFF_BACKUP_DIR)
    : path.join(path.dirname(dbPath), "backups");

  if (!fs.existsSync(dbPath)) {
    console.log(`Database not found, skipped: ${dbPath}`);
    return;
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(
    backupDir,
    `jeff-order-daily-${backupTimestamp()}.db`,
  );
  const db = new Database(dbPath);

  try {
    await db.backup(backupPath);
  } finally {
    db.close();
  }

  cleanupBackupFiles(backupDir);
  console.log(`Backup created: ${backupPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
