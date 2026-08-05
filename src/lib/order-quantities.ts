import { PRODUCT_COLUMNS, calculateTotalQuantity } from "@/lib/catalog";
import type { DeliveryQuantities, OrderRecord } from "@/lib/types";

export function emptyQuantities(): DeliveryQuantities {
  return {
    suitQuantity: 0,
    jacketQuantity: 0,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
  };
}

export function orderQuantity(order: OrderRecord) {
  const categoryTotal = calculateTotalQuantity(order);
  return categoryTotal > 0 ? categoryTotal : order.quantity;
}

export function deliveryTotals(order: OrderRecord) {
  return order.deliveries.reduce<DeliveryQuantities>((totals, delivery) => {
    PRODUCT_COLUMNS.forEach((item) => {
      totals[item.key] += delivery[item.key];
    });
    return totals;
  }, emptyQuantities());
}

export function uncategorizedDelivered(order: OrderRecord) {
  return order.deliveries.reduce(
    (total, delivery) => total + delivery.uncategorizedQuantity,
    0,
  );
}

export function remainingQuantities(order: OrderRecord) {
  if (order.status === "WRITTEN_OFF") {
    return emptyQuantities();
  }

  if (order.status === "RETURNED") {
    return {
      suitQuantity: order.returnSuitQuantity,
      jacketQuantity: order.returnJacketQuantity,
      pantQuantity: order.returnPantQuantity,
      vestQuantity: order.returnVestQuantity,
      coatQuantity: order.returnCoatQuantity,
    };
  }

  const delivered = deliveryTotals(order);
  const remaining = emptyQuantities();
  PRODUCT_COLUMNS.forEach((item) => {
    remaining[item.key] = Math.max(order[item.key] - delivered[item.key], 0);
  });
  return remaining;
}

export function remainingTotal(order: OrderRecord) {
  if (order.status === "WRITTEN_OFF") {
    return 0;
  }

  if (order.status === "RETURNED") {
    return calculateTotalQuantity(remainingQuantities(order));
  }

  const delivered = calculateTotalQuantity(deliveryTotals(order));
  return Math.max(
    orderQuantity(order) - delivered - uncategorizedDelivered(order),
    0,
  );
}

export function summarizeOpenOrders(orders: OrderRecord[]) {
  const openOrders = orders.filter((order) => order.status !== "WRITTEN_OFF");
  const categories = PRODUCT_COLUMNS.map((item) => ({
    ...item,
    total: openOrders.reduce(
      (sum, order) => sum + remainingQuantities(order)[item.key],
      0,
    ),
  }));
  const categorizedBalance = categories.reduce(
    (sum, item) => sum + item.total,
    0,
  );
  const quantity = openOrders.reduce(
    (sum, order) => sum + remainingTotal(order),
    0,
  );

  return {
    categories,
    quantity,
    openCount: openOrders.length,
    pendingCount: openOrders.filter((order) => order.status === "PENDING").length,
    partialCount: openOrders.filter((order) => order.status === "PARTIAL").length,
    uncategorized: Math.max(quantity - categorizedBalance, 0),
    unallocatedDelivered: Math.max(categorizedBalance - quantity, 0),
  };
}
