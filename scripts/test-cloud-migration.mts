import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-cloud-migration-"));
const cloudPath = path.join(testRoot, "cloud", "orders.db");
const backupDir = path.join(testRoot, "cloud", "backups");
fs.mkdirSync(path.dirname(cloudPath), { recursive: true });
process.env.JEFF_ORDER_DB_PATH = cloudPath;
process.env.JEFF_BACKUP_DIR = backupDir;
process.env.JEFF_DEPLOYMENT_MODE = "cloud";

const dbModule = await import("../src/lib/db");
const migration = await import("../src/lib/cloud-migration");
const maintenance = await import("../src/lib/maintenance");

function openDatabase(filePath: string) {
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}

function initializeDatabase(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = openDatabase(filePath);
  try {
    dbModule.ensureDatabaseSchema(db);
  } finally {
    db.close();
  }
}

function insertOrder(
  db: Database.Database,
  {
    id,
    code,
    note,
    companyName = "Jeff Test Company",
  }: { id: string; code: string; note: string; companyName?: string },
) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (
      id, code, company_name, registered_at, status, urgency,
      note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', 'NORMAL', ?, ?, ?)
  `).run(id, code, companyName, "2026-07-15", note, now, now);
}

function updateOrderNote(db: Database.Database, code: string, note: string) {
  db.prepare(`
    UPDATE orders SET note = ?, updated_at = ?
    WHERE company_name = 'Jeff Test Company' AND code = ?
  `).run(note, new Date().toISOString(), code);
}

function insertEvent(
  db: Database.Database,
  id: string,
  orderId: string,
  detail: string,
) {
  db.prepare(`
    INSERT INTO order_events (id, order_id, type, detail, created_at)
    VALUES (?, ?, 'UPDATED', ?, ?)
  `).run(id, orderId, detail, new Date().toISOString());
}

function insertDelivery(
  db: Database.Database,
  id: string,
  orderId: string,
  quantity: number,
) {
  db.prepare(`
    INSERT INTO order_deliveries (
      id, order_id, delivered_at, suit_quantity, note, created_at
    ) VALUES (?, ?, '2026-07-15', ?, 'integration test', ?)
  `).run(id, orderId, quantity, new Date().toISOString());
}

async function snapshot(sourcePath: string, outputPath: string) {
  fs.rmSync(outputPath, { force: true });
  const db = new Database(sourcePath, { fileMustExist: true, readonly: true });
  try {
    await db.backup(outputPath);
  } finally {
    db.close();
  }
}

function databaseBytes(filePath: string) {
  return fs.readFileSync(filePath);
}

function orderNote(db: Database.Database, code: string) {
  return (
    db
      .prepare("SELECT note FROM orders WHERE code = ?")
      .get(code) as { note: string | null } | undefined
  )?.note;
}

function count(db: Database.Database, table: string, where = "1 = 1") {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as {
      count: number;
    }
  ).count;
}

try {
  initializeDatabase(cloudPath);
  const cloudSetup = openDatabase(cloudPath);
  try {
    const now = new Date().toISOString();
    cloudSetup
      .prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
      .run("session_secret", "cloud-session-secret", now);
    cloudSetup
      .prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
      .run("admin_password_hash", "cloud-password-hash", now);
  } finally {
    cloudSetup.close();
  }

  const initialSource = path.join(testRoot, "source-initial.db");
  initializeDatabase(initialSource);
  const initialDb = openDatabase(initialSource);
  try {
    insertOrder(initialDb, { id: "order-a", code: "A100", note: "base A" });
    insertOrder(initialDb, { id: "order-b", code: "B100", note: "base B" });
    insertOrder(initialDb, { id: "order-e", code: "E100", note: "base E" });
    insertOrder(initialDb, { id: "order-f", code: "F100", note: "base F" });
    insertEvent(initialDb, "event-a-base", "order-a", "base event");
    insertDelivery(initialDb, "delivery-a-base", "order-a", 1);
  } finally {
    initialDb.close();
  }

  const firstPreview = await migration.createMigrationPreview(
    "source-initial.db",
    databaseBytes(initialSource),
  );
  assert.equal(firstPreview.sourceIntegrity, "ok");
  assert.equal(firstPreview.source.orders, 4);
  assert.equal(firstPreview.cloud.orders, 0);
  assert.equal(firstPreview.counts.source_only, 4);

  const replaceReport = await migration.applyMigration(
    firstPreview.sessionId,
    "replace",
    {},
  );
  assert.equal(replaceReport.cloudOrdersAfter, 4);

  const afterReplace = openDatabase(cloudPath);
  try {
    assert.equal(count(afterReplace, "orders"), 4);
    assert.equal(count(afterReplace, "order_events"), 1);
    assert.equal(count(afterReplace, "order_deliveries"), 1);
    assert.equal(
      (
        afterReplace
          .prepare("SELECT value FROM app_meta WHERE key = 'session_secret'")
          .get() as { value: string }
      ).value,
      "cloud-session-secret",
    );
    assert.equal(
      String(afterReplace.pragma("integrity_check", { simple: true })),
      "ok",
    );
  } finally {
    afterReplace.close();
  }

  const repeated = await migration.createMigrationPreview(
    "source-initial.db",
    databaseBytes(initialSource),
  );
  assert.equal(repeated.alreadyImported, true);
  await assert.rejects(
    migration.applyMigration(repeated.sessionId, "merge", {}),
    /已经迁移过/,
  );

  const splitSource = path.join(testRoot, "source-split.db");
  await snapshot(cloudPath, splitSource);
  const local = openDatabase(splitSource);
  try {
    updateOrderNote(local, "A100", "local A");
    insertEvent(local, "event-a-local", "order-a", "local A changed");
    updateOrderNote(local, "B100", "local B");
    insertOrder(local, { id: "order-c", code: "C100", note: "local C" });
    insertEvent(local, "event-c-local", "order-c", "local C created");
    insertDelivery(local, "delivery-c-local", "order-c", 2);
  } finally {
    local.close();
  }

  const cloudSplit = openDatabase(cloudPath);
  try {
    updateOrderNote(cloudSplit, "B100", "cloud B");
    updateOrderNote(cloudSplit, "E100", "cloud E");
    insertOrder(cloudSplit, { id: "order-d", code: "D100", note: "cloud D" });
  } finally {
    cloudSplit.close();
  }

  const splitPreview = await migration.createMigrationPreview(
    "source-split.db",
    databaseBytes(splitSource),
  );
  assert.equal(splitPreview.counts.local_changed, 1);
  assert.equal(splitPreview.counts.conflict, 1);
  assert.equal(splitPreview.counts.source_only, 1);
  assert.equal(splitPreview.counts.cloud_only, 1);
  assert.equal(splitPreview.counts.cloud_changed, 1);
  assert.equal(splitPreview.counts.identical, 1);

  await assert.rejects(
    migration.applyMigration(splitPreview.sessionId, "merge", {}),
    /请选择冲突订单/,
  );
  assert.equal(maintenance.getMigrationMaintenance(), null);

  const conflict = splitPreview.diffs.find(
    (item) => item.category === "conflict",
  );
  assert.ok(conflict);
  const mergeReport = await migration.applyMigration(
    splitPreview.sessionId,
    "merge",
    { [conflict.id]: "source" },
  );
  assert.equal(mergeReport.created, 1);
  assert.equal(mergeReport.updatedFromSource, 2);
  assert.equal(mergeReport.keptCloud, 3);
  assert.equal(mergeReport.conflictsResolved, 1);
  assert.equal(mergeReport.cloudOrdersAfter, 6);

  const afterMerge = openDatabase(cloudPath);
  try {
    assert.equal(orderNote(afterMerge, "A100"), "local A");
    assert.equal(orderNote(afterMerge, "B100"), "local B");
    assert.equal(orderNote(afterMerge, "C100"), "local C");
    assert.equal(orderNote(afterMerge, "D100"), "cloud D");
    assert.equal(orderNote(afterMerge, "E100"), "cloud E");
    assert.equal(orderNote(afterMerge, "F100"), "base F");
    assert.equal(count(afterMerge, "order_events", "id = 'event-a-local'"), 1);
    assert.equal(count(afterMerge, "order_events", "id = 'event-c-local'"), 1);
    assert.equal(
      count(afterMerge, "order_deliveries", "id = 'delivery-c-local'"),
      1,
    );
    assert.equal(
      String(afterMerge.pragma("integrity_check", { simple: true })),
      "ok",
    );
  } finally {
    afterMerge.close();
  }

  const unchangedSource = path.join(testRoot, "source-unchanged.db");
  await snapshot(splitSource, unchangedSource);
  const metadataOnly = openDatabase(unchangedSource);
  try {
    metadataOnly
      .prepare("INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
      .run("test_nonce", "second-upload", new Date().toISOString());
  } finally {
    metadataOnly.close();
  }
  const unchangedPreview = await migration.createMigrationPreview(
    "source-unchanged.db",
    databaseBytes(unchangedSource),
  );
  assert.equal(unchangedPreview.counts.unchanged_divergent, 1);
  const unchangedReport = await migration.applyMigration(
    unchangedPreview.sessionId,
    "merge",
    {},
  );

  const staleSource = path.join(testRoot, "source-stale.db");
  await snapshot(cloudPath, staleSource);
  const staleLocal = openDatabase(staleSource);
  try {
    insertOrder(staleLocal, { id: "order-x", code: "X100", note: "local X" });
  } finally {
    staleLocal.close();
  }
  const stalePreview = await migration.createMigrationPreview(
    "source-stale.db",
    databaseBytes(staleSource),
  );
  const changedCloud = openDatabase(cloudPath);
  try {
    insertOrder(changedCloud, { id: "order-y", code: "Y100", note: "cloud Y" });
  } finally {
    changedCloud.close();
  }
  await assert.rejects(
    migration.applyMigration(stalePreview.sessionId, "merge", {}),
    /云端订单已经变化/,
  );

  const finalDb = openDatabase(cloudPath);
  try {
    assert.equal(count(finalDb, "orders", "code = 'X100'"), 0);
    assert.equal(count(finalDb, "orders", "code = 'Y100'"), 1);
    assert.equal(count(finalDb, "cloud_migrations"), 3);
    assert.equal(
      String(finalDb.pragma("integrity_check", { simple: true })),
      "ok",
    );
  } finally {
    finalDb.close();
  }

  const rollbackReport = await migration.rollbackLatestMigration(
    unchangedReport.id,
  );
  assert.ok(rollbackReport.rolledBackAt);
  assert.ok(rollbackReport.rollbackBackupFilename);
  const afterRollback = openDatabase(cloudPath);
  try {
    assert.equal(count(afterRollback, "orders"), 6);
    assert.equal(count(afterRollback, "orders", "code = 'Y100'"), 0);
    assert.equal(
      String(afterRollback.pragma("integrity_check", { simple: true })),
      "ok",
    );
  } finally {
    afterRollback.close();
  }
  const rollbackSafety = openDatabase(
    path.join(backupDir, rollbackReport.rollbackBackupFilename),
  );
  try {
    assert.equal(count(rollbackSafety, "orders", "code = 'Y100'"), 1);
  } finally {
    rollbackSafety.close();
  }
  await assert.rejects(
    migration.rollbackLatestMigration(unchangedReport.id),
    /已经回滚过/,
  );

  assert.equal(migration.getRecentMigrationReports(10).length, 3);
  assert.equal(maintenance.getMigrationMaintenance(), null);
  console.log("Cloud migration integration tests passed.");
} finally {
  dbModule.closeDatabaseForMigration();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
