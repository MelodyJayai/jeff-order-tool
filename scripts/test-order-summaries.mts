import assert from "node:assert/strict";

import { summarizeOpenOrders } from "../src/lib/order-quantities";
import type { OrderDeliveryRecord, OrderRecord } from "../src/lib/types";

function delivery(
  overrides: Partial<OrderDeliveryRecord> = {},
): OrderDeliveryRecord {
  return {
    id: "delivery-1",
    orderId: "order-1",
    deliveredAt: "2026-08-05",
    suitQuantity: 0,
    jacketQuantity: 0,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
    uncategorizedQuantity: 0,
    note: "",
    source: "STRUCTURED",
    createdAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: "order-1",
    code: "1001",
    companyName: "Test Company",
    factoryName: "Test Factory",
    firstDelivery: "",
    customerName: "",
    quantity: 0,
    suitQuantity: 0,
    jacketQuantity: 0,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
    returnSuitQuantity: 0,
    returnJacketQuantity: 0,
    returnPantQuantity: 0,
    returnVestQuantity: 0,
    returnCoatQuantity: 0,
    registeredAt: "2026-08-05",
    status: "PENDING",
    writtenOffAt: null,
    returnedAt: null,
    returnNote: "",
    urgency: "NORMAL",
    partialQuantity: null,
    partialDate: null,
    partialNote: "",
    note: "",
    deliveryRequest: {
      suitQuantity: 0,
      jacketQuantity: 0,
      pantQuantity: 0,
      vestQuantity: 0,
      coatQuantity: 0,
      requestedAt: null,
      note: "",
      updatedAt: null,
    },
    deliveries: [],
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

const result = summarizeOpenOrders([
  order({ id: "pending", suitQuantity: 2 }),
  order({
    id: "partial",
    code: "1002",
    status: "PARTIAL",
    suitQuantity: 3,
    deliveries: [
      delivery({
        id: "legacy-delivery",
        orderId: "partial",
        uncategorizedQuantity: 1,
        source: "LEGACY",
      }),
    ],
  }),
  order({ id: "closed", code: "1003", status: "WRITTEN_OFF", pantQuantity: 9 }),
]);

assert.equal(result.openCount, 2);
assert.equal(result.pendingCount, 1);
assert.equal(result.partialCount, 1);
assert.equal(result.categories.find((item) => item.key === "suitQuantity")?.total, 5);
assert.equal(result.quantity, 4);
assert.equal(result.uncategorized, 0);
assert.equal(result.unallocatedDelivered, 1);

console.log("Order summary consistency tests passed.");
