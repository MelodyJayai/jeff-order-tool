import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-monthly-statistics-"));
process.env.JEFF_ORDER_DB_PATH = path.join(root, "data", "orders.db");
process.env.JEFF_BACKUP_DIR = path.join(root, "data", "backups");
process.env.JEFF_DEPLOYMENT_MODE = "";

const db = await import("../src/lib/db");

function orderInput(
  submissionKey: string,
  code: string,
  registeredAt: string,
  quantity: number,
) {
  return {
    submissionKey,
    codes: [code],
    companyName: "统计测试公司",
    factoryName: "统计测试工厂",
    firstDelivery: "",
    customerName: "",
    quantity,
    suitQuantity: 0,
    jacketQuantity: quantity,
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
  assert.equal(
    db.createOrders(orderInput("jan-1", "JAN-1", "2026-01-08", 2)).created,
    1,
  );
  assert.equal(
    db.createOrders(orderInput("jan-2", "JAN-2", "2026-01-20", 3)).created,
    1,
  );
  assert.equal(
    db.createOrders(orderInput("feb-1", "FEB-1", "2026-02-03", 5)).created,
    1,
  );

  const stats = db.getMonthlyOrderStatistics();
  assert.deepEqual(stats, [
    {
      month: "2026-02",
      orderCount: 1,
      quantity: 5,
      pendingOrders: 1,
      pendingQuantity: 5,
      partialOrders: 0,
      partialQuantity: 0,
      returnedOrders: 0,
      returnedQuantity: 0,
      writtenOffOrders: 0,
      writtenOffQuantity: 0,
    },
    {
      month: "2026-01",
      orderCount: 2,
      quantity: 5,
      pendingOrders: 2,
      pendingQuantity: 5,
      partialOrders: 0,
      partialQuantity: 0,
      returnedOrders: 0,
      returnedQuantity: 0,
      writtenOffOrders: 0,
      writtenOffQuantity: 0,
    },
  ]);
  assert.equal(db.listOrders("2026-01").length, 2);
  assert.equal(db.listOrders("2026-02").length, 1);

  const order = db.listOrders("2026-01")[0];
  assert.equal(
    db.updateOrder({
      id: order.id,
      expectedUpdatedAt: "stale-page",
      companyName: order.companyName,
      factoryName: order.factoryName,
      quantity: order.quantity,
      suitQuantity: order.suitQuantity,
      jacketQuantity: order.jacketQuantity,
      pantQuantity: order.pantQuantity,
      vestQuantity: order.vestQuantity,
      coatQuantity: order.coatQuantity,
      registeredAt: order.registeredAt,
      urgency: order.urgency,
      note: "should not overwrite",
    }),
    "conflict",
  );
  assert.equal(db.getOrder(order.id)?.note, "");

  console.log("Monthly statistics and concurrent edit protection tests passed.");
} finally {
  db.closeDatabaseForMigration();
  fs.rmSync(root, { recursive: true, force: true });
}
