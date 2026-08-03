import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-duplicate-orders-"));
const dbPath = path.join(testRoot, "data", "orders.db");
process.env.JEFF_ORDER_DB_PATH = dbPath;
process.env.JEFF_BACKUP_DIR = path.join(testRoot, "data", "backups");
process.env.JEFF_DEPLOYMENT_MODE = "";

const dbModule = await import("../src/lib/db");

function orderInput(
  submissionKey: string,
  registeredAt: string,
  jacketQuantity: number,
) {
  return {
    submissionKey,
    codes: ["54278"],
    companyName: "Vogue Tailors",
    factoryName: "新奇洋服",
    firstDelivery: "",
    customerName: "",
    quantity: jacketQuantity,
    suitQuantity: 0,
    jacketQuantity,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
    registeredAt,
    urgency: "NORMAL" as const,
    note: "",
    deliveryRequest: null,
    initialDelivery: null,
  };
}

try {
  const first = dbModule.createOrders(orderInput("entry-a", "2026-08-02", 2));
  assert.equal(first.created, 1);
  assert.equal(first.reused.length, 0);

  const retried = dbModule.createOrders(orderInput("entry-a", "2026-08-02", 2));
  assert.equal(retried.created, 0);
  assert.equal(retried.alreadySubmitted, true);

  const second = dbModule.createOrders(orderInput("entry-b", "2026-08-03", 3));
  assert.equal(second.created, 1);
  assert.equal(second.reused.length, 1);
  assert.equal(second.reused[0].total, 2);

  let orders = dbModule
    .listOrders()
    .filter(
      (order) =>
        order.companyName === "Vogue Tailors" && order.code === "54278",
    );
  assert.equal(orders.length, 2);
  assert.notEqual(orders[0].id, orders[1].id);

  const older = orders.find((order) => order.registeredAt === "2026-08-02")!;
  const newer = orders.find((order) => order.registeredAt === "2026-08-03")!;
  assert.equal(
    dbModule.updateOrder({
      id: older.id,
      companyName: older.companyName,
      factoryName: older.factoryName,
      quantity: 2,
      suitQuantity: 0,
      jacketQuantity: 2,
      pantQuantity: 0,
      vestQuantity: 0,
      coatQuantity: 0,
      registeredAt: older.registeredAt,
      urgency: "NORMAL",
      note: "only the older duplicate",
    }),
    "updated",
  );
  assert.equal(
    dbModule.addOrderDelivery({
      orderId: newer.id,
      deliveredAt: "2026-08-03",
      suitQuantity: 0,
      jacketQuantity: 1,
      pantQuantity: 0,
      vestQuantity: 0,
      coatQuantity: 0,
      note: "only the newer duplicate",
    }),
    "added",
  );
  assert.equal(dbModule.writeOffOrder(older.id, "2026-08-03"), "updated");

  orders = dbModule
    .listOrders()
    .filter(
      (order) =>
        order.companyName === "Vogue Tailors" && order.code === "54278",
    );
  assert.equal(orders.find((order) => order.id === older.id)?.status, "WRITTEN_OFF");
  assert.equal(orders.find((order) => order.id === newer.id)?.status, "PARTIAL");
  assert.equal(orders.find((order) => order.id === newer.id)?.deliveries.length, 1);

  const ambiguousLegacyCsv = dbModule.importOrders([
    {
      ...orderInput("", "2026-08-03", 4),
      code: "54278",
      status: "PENDING",
      writtenOffAt: null,
      returnedAt: null,
      returnNote: "",
      returnSuitQuantity: 0,
      returnJacketQuantity: 0,
      returnPantQuantity: 0,
      returnVestQuantity: 0,
      returnCoatQuantity: 0,
      partialQuantity: null,
      partialDate: null,
      partialNote: "",
    },
  ]);
  assert.equal(ambiguousLegacyCsv.created, 0);
  assert.equal(ambiguousLegacyCsv.updated, 0);
  assert.match(ambiguousLegacyCsv.skipped[0], /多笔同号订单/);

  const importedWithId = dbModule.importOrders([
    {
      ...orderInput("", "2026-08-04", 4),
      sourceId: "imported-duplicate-id",
      code: "54278",
      status: "PENDING",
      writtenOffAt: null,
      returnedAt: null,
      returnNote: "",
      returnSuitQuantity: 0,
      returnJacketQuantity: 0,
      returnPantQuantity: 0,
      returnVestQuantity: 0,
      returnCoatQuantity: 0,
      partialQuantity: null,
      partialDate: null,
      partialNote: "",
    },
  ]);
  assert.equal(importedWithId.created, 1);
  assert.equal(dbModule.listOrders().length, 3);

  const sqliteSourcePath = path.join(testRoot, "duplicate-source.db");
  const sqliteSource = new Database(sqliteSourcePath);
  try {
    dbModule.ensureDatabaseSchema(sqliteSource);
    const now = new Date().toISOString();
    const insert = sqliteSource.prepare(`
      INSERT INTO orders (
        id, code, company_name, factory_name, jacket_quantity, quantity,
        registered_at, status, urgency, note, created_at, updated_at
      ) VALUES (?, '54278', 'Vogue Tailors', '新奇洋服', ?, ?, ?, 'PENDING',
        'NORMAL', ?, ?, ?)
    `);
    insert.run("sqlite-duplicate-1", 5, 5, "2026-08-05", "sqlite one", now, now);
    insert.run("sqlite-duplicate-2", 6, 6, "2026-08-06", "sqlite two", now, now);
    sqliteSource.prepare(`
      INSERT INTO order_deliveries (
        id, order_id, delivered_at, jacket_quantity, note, source, created_at
      ) VALUES ('sqlite-delivery-2', 'sqlite-duplicate-2', '2026-08-06', 1,
        'delivery stays with second duplicate', 'STRUCTURED', ?)
    `).run(now);
  } finally {
    sqliteSource.close();
  }
  const sqliteImported = dbModule.importOrdersFromSqliteBackup(sqliteSourcePath);
  assert.equal(sqliteImported.created, 2);
  const afterSqliteImport = dbModule.listOrders();
  assert.equal(afterSqliteImport.length, 5);
  assert.equal(
    afterSqliteImport.find((order) => order.id === "sqlite-duplicate-1")
      ?.deliveries.length,
    0,
  );
  assert.equal(
    afterSqliteImport.find((order) => order.id === "sqlite-duplicate-2")
      ?.deliveries.length,
    1,
  );

  dbModule.closeDatabaseForMigration();
  const database = new Database(dbPath, { fileMustExist: true, readonly: true });
  try {
    assert.equal(String(database.pragma("integrity_check", { simple: true })), "ok");
    const indexes = database.pragma("index_list('orders')") as Array<{
      name: string;
      unique: number;
    }>;
    assert.equal(
      indexes.some(
        (index) =>
          index.name === "idx_orders_company_code_unique" && index.unique === 1,
      ),
      false,
    );
  } finally {
    database.close();
  }

  console.log("Duplicate order-number safety tests passed.");
} finally {
  dbModule.closeDatabaseForMigration();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
