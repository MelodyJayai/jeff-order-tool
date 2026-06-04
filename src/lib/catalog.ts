import type { OrderRecord } from "@/lib/types";

export const PRODUCT_COLUMNS = [
  { key: "suitQuantity", label: "套装", shortLabel: "套" },
  { key: "jacketQuantity", label: "单衫", shortLabel: "衫" },
  { key: "pantQuantity", label: "单裤", shortLabel: "裤" },
  { key: "vestQuantity", label: "马甲", shortLabel: "马" },
  { key: "coatQuantity", label: "大衣", shortLabel: "衣" },
] as const;

export type ProductQuantityKey = (typeof PRODUCT_COLUMNS)[number]["key"];

export function calculateTotalQuantity(
  values: Record<ProductQuantityKey, number>,
) {
  return PRODUCT_COLUMNS.reduce((total, item) => total + values[item.key], 0);
}

export function productSummary(order: OrderRecord) {
  return PRODUCT_COLUMNS.filter((item) => order[item.key] > 0)
    .map((item) => `${item.shortLabel}${order[item.key]}`)
    .join(" ");
}
