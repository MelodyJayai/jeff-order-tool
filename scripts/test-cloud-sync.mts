import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-cloud-sync-"));
const cloudPath = path.join(testRoot, "cloud", "orders.db");
const backupDir = path.join(testRoot, "cloud", "backups");
fs.mkdirSync(path.dirname(cloudPath), { recursive: true });
process.env.JEFF_ORDER_DB_PATH = cloudPath;
process.env.JEFF_BACKUP_DIR = backupDir;
process.env.JEFF_DEPLOYMENT_MODE = "cloud";

const dbModule = await import("../src/lib/db");
const migration = await import("../src/lib/cloud-migration");
const service = await import("../src/lib/cloud-sync-service");
const store = await import("../src/lib/cloud-sync-store");

function initialize(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.pragma("foreign_keys = ON");
    dbModule.ensureDatabaseSchema(db);
  } finally {
    db.close();
  }
}

function insertOrder(db: Database.Database, note: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (
      id, code, company_name, registered_at, status, urgency,
      note, created_at, updated_at
    ) VALUES ('sync-order-a', 'SYNC-A', 'Sync Company', '2026-07-23',
      'PENDING', 'NORMAL', ?, ?, ?)
  `).run(note, now, now);
}

function updateOrder(db: Database.Database, note: string) {
  db.prepare(`
    UPDATE orders SET note = ?, updated_at = ? WHERE id = 'sync-order-a'
  `).run(note, new Date().toISOString());
}

async function snapshot(sourcePath: string, outputPath: string) {
  const source = new Database(sourcePath, { fileMustExist: true, readonly: true });
  try {
    await source.backup(outputPath);
  } finally {
    source.close();
  }
}

try {
  initialize(cloudPath);

  const pairing = store.createCloudSyncPairing();
  assert.match(pairing.code, /^\d{6}$/u);
  await assert.rejects(
    async () =>
      store.consumeCloudSyncPairing({
        code: "000000",
        installationId: "test-installation",
        name: "Test computer",
        appVersion: "0.1.27",
      }),
    /配对码不正确/,
  );

  const paired = store.consumeCloudSyncPairing({
    code: `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`,
    installationId: "test-installation",
    name: "Test computer",
    appVersion: "0.1.27",
  });
  const authenticated = store.authenticateCloudSyncToken(
    `Bearer ${paired.token}`,
  );
  assert.ok(authenticated);
  assert.equal(authenticated.id, paired.device.id);

  const firstSource = path.join(testRoot, "source-first.db");
  initialize(firstSource);
  const firstDb = new Database(firstSource);
  try {
    insertOrder(firstDb, "first local value");
  } finally {
    firstDb.close();
  }

  const first = await service.processCloudSyncUpload({
    device: authenticated,
    sourceFilename: "source-first.db",
    sourceChangeToken: "change-1",
    bytes: fs.readFileSync(firstSource),
  });
  assert.equal(first.status, "applied");
  assert.equal(first.created, 1);

  const repeated = await service.processCloudSyncUpload({
    device: authenticated,
    sourceFilename: "source-first.db",
    sourceChangeToken: "change-1",
    bytes: fs.readFileSync(firstSource),
  });
  assert.equal(repeated.status, "already_synced");

  dbModule.closeDatabaseForMigration();
  const splitSource = path.join(testRoot, "source-split.db");
  await snapshot(cloudPath, splitSource);
  const local = new Database(splitSource);
  try {
    updateOrder(local, "local conflict value");
  } finally {
    local.close();
  }
  const cloud = new Database(cloudPath);
  try {
    updateOrder(cloud, "cloud conflict value");
  } finally {
    cloud.close();
  }

  const conflicted = await service.processCloudSyncUpload({
    device: authenticated,
    sourceFilename: "source-split.db",
    sourceChangeToken: "change-2",
    bytes: fs.readFileSync(splitSource),
  });
  assert.equal(conflicted.status, "conflict");
  assert.equal(conflicted.conflictCount, 1);
  assert.equal(
    service.getCloudSyncSessionResult(authenticated, conflicted.sessionId)?.status,
    "conflict",
  );

  const preview = migration.getMigrationPreview(conflicted.sessionId);
  const conflict = preview.diffs.find((item) => item.category === "conflict");
  assert.ok(conflict);
  const report = await migration.applyMigration(conflicted.sessionId, "merge", {
    [conflict.id]: "source",
  });
  const resolved = service.getCloudSyncSessionResult(
    authenticated,
    conflicted.sessionId,
  );
  assert.equal(resolved?.status, "applied");
  assert.equal(resolved?.reportId, report.id);

  const adminState = store.getCloudSyncAdminState();
  assert.equal(adminState.devices.filter((item) => !item.revokedAt).length, 1);
  assert.ok(adminState.attempts.length >= 3);

  assert.equal(store.revokeCloudSyncDevice(authenticated.id), true);
  assert.equal(
    store.authenticateCloudSyncToken(`Bearer ${paired.token}`),
    null,
  );

  console.log("Cloud sync integration tests passed.");
} finally {
  dbModule.closeDatabaseForMigration();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
