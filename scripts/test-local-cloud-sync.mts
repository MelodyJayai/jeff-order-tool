import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

if (process.platform !== "win32") {
  console.log("Local cloud sync DPAPI test skipped outside Windows.");
  process.exit(0);
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-local-sync-"));
const dbPath = path.join(testRoot, "data", "orders.db");
process.env.JEFF_ORDER_DB_PATH = dbPath;
process.env.JEFF_BACKUP_DIR = path.join(testRoot, "data", "backups");
process.env.JEFF_DEPLOYMENT_MODE = "";

const dbModule = await import("../src/lib/db");
const localSync = await import("../src/lib/local-cloud-sync");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
try {
  dbModule.ensureDatabaseSchema(db);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (
      id, code, company_name, registered_at, status, urgency,
      note, created_at, updated_at
    ) VALUES ('local-sync-order', 'LOCAL-1', 'Local Company', '2026-07-23',
      'PENDING', 'NORMAL', 'local test', ?, ?)
  `).run(now, now);
} finally {
  db.close();
}

let authorization = "";
let uploadedBytes = 0;
const server = http.createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);

  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/cloud-sync/pair") {
    response.end(
      JSON.stringify({
        ok: true,
        message: "paired",
        token: "local-test-secret-token",
        deviceId: "local-test-device",
        deviceName: "Local test computer",
      }),
    );
    return;
  }

  if (request.url === "/api/cloud-sync/push") {
    authorization = String(request.headers.authorization || "");
    uploadedBytes = body.length;
    response.end(
      JSON.stringify({
        ok: true,
        status: "applied",
        message: "test upload applied",
        sessionId: "local-test-session",
        sourceOrders: 1,
        conflictCount: 0,
        created: 1,
        updatedFromSource: 0,
        keptCloud: 0,
        reportId: "local-test-report",
      }),
    );
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false }));
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const serverUrl = `http://127.0.0.1:${address.port}`;

  const paired = await localSync.pairLocalCloudSync({
    serverUrl,
    code: "123456",
  });
  assert.equal(paired.connected, true);

  const configText = fs.readFileSync(
    path.join(testRoot, "data", "cloud-sync-client.json"),
    "utf8",
  );
  assert.equal(configText.includes("local-test-secret-token"), false);

  const pushed = await localSync.pushLocalCloudChanges({ automatic: false });
  assert.equal(pushed.ok, true);
  assert.equal(pushed.needsSync, false);
  assert.equal(authorization, "Bearer local-test-secret-token");
  assert.ok(uploadedBytes > 4096);

  localSync.disconnectLocalCloudSync();
  assert.equal((await localSync.getLocalCloudSyncStatus()).connected, false);
  console.log("Local cloud sync DPAPI integration test passed.");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  dbModule.closeDatabaseForMigration();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
