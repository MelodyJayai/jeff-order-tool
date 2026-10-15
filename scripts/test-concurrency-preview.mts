import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-order-concurrency-"));
process.env.JEFF_ORDER_DATA_DIR = dataDir;
process.env.JEFF_CONCURRENCY_PREVIEW = "1";

const db = await import("../src/lib/db");

try {
  db.createOrders({
    codes: ["CONCURRENCY-PREVIEW"],
    companyName: "预览公司",
    factoryName: "预览工厂",
    firstDelivery: "",
    customerName: "",
    quantity: 2,
    suitQuantity: 2,
    jacketQuantity: 0,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
    registeredAt: "2026-09-05",
    urgency: "NORMAL",
    note: "",
    deliveryRequest: null,
    initialDelivery: null,
  });

  const created = db.listOrders()[0];
  assert.ok(created, "preview order should be created");

  const firstWrite = db.updateOrder({
    id: created.id,
    companyName: created.companyName,
    factoryName: created.factoryName,
    quantity: created.quantity,
    suitQuantity: created.suitQuantity,
    jacketQuantity: created.jacketQuantity,
    pantQuantity: created.pantQuantity,
    vestQuantity: created.vestQuantity,
    coatQuantity: created.coatQuantity,
    registeredAt: created.registeredAt,
    urgency: created.urgency,
    note: "第一台电脑修改",
    expectedUpdatedAt: created.updatedAt,
  });
  assert.equal(firstWrite, "updated");

  const staleWrite = db.updateOrder({
    id: created.id,
    companyName: created.companyName,
    factoryName: created.factoryName,
    quantity: created.quantity,
    suitQuantity: created.suitQuantity,
    jacketQuantity: created.jacketQuantity,
    pantQuantity: created.pantQuantity,
    vestQuantity: created.vestQuantity,
    coatQuantity: created.coatQuantity,
    registeredAt: created.registeredAt,
    urgency: created.urgency,
    note: "第二台电脑的过期修改",
    expectedUpdatedAt: created.updatedAt,
  });
  assert.equal(staleWrite, "conflict");
  assert.equal(db.getOrder(created.id)?.note, "第一台电脑修改");

  console.log("Concurrency preview optimistic-lock test passed.");
} finally {
  db.closeDatabaseForMigration();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
