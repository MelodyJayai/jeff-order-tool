import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createServer } from "node:http";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-delete-"));
const cloudPath = path.join(root, "cloud", "orders.db");
process.env.JEFF_ORDER_DB_PATH = cloudPath;
process.env.JEFF_BACKUP_DIR = path.join(root, "backups");
process.env.JEFF_DEPLOYMENT_MODE = "cloud";
const db = await import("../src/lib/db");
const migration = await import("../src/lib/cloud-migration");

function open(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const connection = new Database(file);
  connection.pragma("foreign_keys = ON");
  db.ensureDatabaseSchema(connection);
  return connection;
}

const originalTime = "2026-10-20T01:00:00.000Z";
function seed(connection: Database.Database, id: string, code = id) {
  connection.prepare(`INSERT INTO orders
    (id, code, company_name, jacket_quantity, quantity, registered_at, status,
     urgency, created_at, updated_at) VALUES (?, ?, 'Test Company', 2, 2,
     '2026-10-20', 'PENDING', 'NORMAL', ?, ?)`)
    .run(id, code, originalTime, originalTime);
}

function tombstone(connection: Database.Database, id: string) {
  const row = connection.prepare("SELECT * FROM orders WHERE id = ?").get(id) as {
    code: string; company_name: string; updated_at: string;
  };
  connection.prepare(`INSERT INTO order_deletions
    (order_id, code, company_name, expected_updated_at, expected_hash, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, row.code, row.company_name,
    row.updated_at, db.orderContentHash(connection, id), "2026-10-21T01:00:00.000Z");
  connection.prepare("DELETE FROM orders WHERE id = ?").run(id);
}

async function preview(connection: Database.Database, label: string) {
  const file = path.join(root, `${label}.db`);
  await connection.backup(file);
  return migration.createMigrationPreview(`${label}.db`, fs.readFileSync(file));
}

function exists(id: string) { return Boolean(db.getOrder(id)); }

try {
  const cloud = open(cloudPath);
  for (const id of ["target", "same-number", "stale", "delivered", "closed", "cloud-edit"])
    seed(cloud, id, id === "same-number" ? "target" : id);
  cloud.prepare(`INSERT INTO order_events (id, order_id, type, created_at)
    VALUES ('target-event', 'target', 'CREATED', ?)`).run(originalTime);
  cloud.close();

  const beforeToken = db.getDatabaseChangeToken();
  assert.equal(db.deleteOrder("missing"), "missing");
  assert.equal(db.deleteOrder("stale", "outdated-page"), "conflict");
  assert.ok(exists("stale"));
  assert.equal(db.getDatabaseChangeToken(), beforeToken);
  assert.equal(db.deleteOrder("target", originalTime), "deleted");
  assert.equal(exists("target"), false);
  assert.ok(exists("same-number"), "same code with another ID stays intact");
  assert.notEqual(db.getDatabaseChangeToken(), beforeToken);
  assert.equal(db.listOrderEvents().some((event) => event.orderId === "target"), false);

  const activities = open(cloudPath);
  activities.prepare(`INSERT INTO order_deliveries
    (id, order_id, delivered_at, jacket_quantity, created_at)
    VALUES ('delivery', 'delivered', '2026-10-21', 1, ?)`).run(originalTime);
  activities.prepare("UPDATE orders SET status = 'WRITTEN_OFF' WHERE id = 'closed'").run();
  activities.close();
  assert.equal(db.deleteOrder("delivered", originalTime), "has_activity");
  assert.equal(db.deleteOrder("closed", originalTime), "closed");

  const source = open(path.join(root, "source.db"));
  seed(source, "sync-delete");
  seed(source, "cloud-edit");
  seed(source, "protected-delivery");
  seed(source, "target", "target"); // Old snapshot of the already deleted order.
  seed(source, "same-number", "target");
  seed(source, "new-registration", "target");
  seed(source, "never-synced");
  const cloudSeed = open(cloudPath);
  seed(cloudSeed, "sync-delete");
  seed(cloudSeed, "protected-delivery");
  cloudSeed.prepare("UPDATE orders SET note = 'new cloud edit', updated_at = ? WHERE id = 'cloud-edit'")
    .run("2026-10-21T00:59:00.000Z");
  cloudSeed.prepare(`INSERT INTO order_deliveries
    (id, order_id, delivered_at, jacket_quantity, created_at)
    VALUES ('protected-record', 'protected-delivery', '2026-10-21', 1, ?)`).run(originalTime);
  cloudSeed.close();
  tombstone(source, "sync-delete");
  tombstone(source, "cloud-edit");
  tombstone(source, "protected-delivery");
  tombstone(source, "never-synced");
  const first = await preview(source, "delete-sync");
  assert.equal(first.diffs.find((diff) => diff.key === "id:sync-delete")?.category, "local_changed");
  assert.equal(first.diffs.find((diff) => diff.key === "id:target")?.category, "cloud_changed");
  assert.equal(first.diffs.find((diff) => diff.key === "id:cloud-edit")?.category, "conflict");
  assert.equal(first.diffs.find((diff) => diff.key === "id:protected-delivery")?.category, "conflict");
  const resolutions = Object.fromEntries(first.diffs.filter((diff) => diff.category === "conflict")
    .map((diff) => [diff.id, "cloud" as const]));
  await assert.rejects(migration.applyMigration(first.sessionId, "merge", {
    ...resolutions,
    [first.diffs.find((diff) => diff.key === "id:protected-delivery")!.id]: "source",
  }), /不能删除/);
  assert.ok(exists("sync-delete"), "failed batch rolls back earlier safe deletion");
  assert.ok(exists("protected-delivery"));
  const next = await preview(source, "delete-sync-safe");
  const safeChoices = Object.fromEntries(next.diffs.filter((diff) => diff.category === "conflict")
    .map((diff) => [diff.id, "cloud" as const]));
  const report = await migration.applyMigration(next.sessionId, "merge", safeChoices);
  assert.equal(report.deleted, 1);
  assert.equal(exists("sync-delete"), false);
  assert.equal(exists("target"), false, "stale source must not resurrect deleted ID");
  assert.ok(exists("new-registration"), "new ID with same code is a separate order");
  assert.ok(exists("cloud-edit"));
  assert.ok(exists("protected-delivery"));

  source.prepare("DELETE FROM order_deletions WHERE order_id = 'sync-delete'").run();
  seed(source, "sync-delete"); // Simulate a different old desktop upload.
  source.prepare("UPDATE orders SET note = 'stale upload change' WHERE id = 'sync-delete'").run();
  const replay = await preview(source, "stale-replay");
  const replayChoices = Object.fromEntries(replay.diffs.filter((diff) => diff.category === "conflict")
    .map((diff) => [diff.id, "cloud" as const]));
  await assert.rejects(migration.applyMigration(replay.sessionId, "replace", {}), /删除记录/);
  await migration.applyMigration(replay.sessionId, "merge", replayChoices);
  assert.equal(exists("sync-delete"), false);
  source.close();
  db.closeDatabaseForMigration();
  const check = open(cloudPath);
  assert.equal(check.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(check.pragma("foreign_key_check"), []);
  check.close();
  const localSync = await import("../src/lib/local-cloud-sync");
  let capable = false;
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ capabilities: capable ? { orderDeletionSync: 1 } : {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    fs.writeFileSync(path.join(path.dirname(cloudPath), "cloud-sync-client.json"), JSON.stringify({
      version: 1, serverUrl: `http://127.0.0.1:${address.port}`, deviceId: "test-device",
      installationId: "test-installation", protectedToken: "test-only-placeholder",
    }));
    process.env.JEFF_DEPLOYMENT_MODE = "";
    assert.match((await localSync.orderDeletionSyncBlockedReason())!, /云端还没有更新/);
    capable = true;
    assert.equal(await localSync.orderDeletionSyncBlockedReason(), null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log("Deletion safety and cloud sync tests passed.");
} finally {
  db.closeDatabaseForMigration();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows may briefly hold SQLite sidecars after the integrity check.
  }
}
