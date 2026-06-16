export const ORDER_STATUSES = [
  "PENDING",
  "PARTIAL",
  "RETURNED",
  "WRITTEN_OFF",
] as const;
export const URGENCY_LEVELS = ["NORMAL", "URGENT", "VERY_URGENT"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export type OrderEventType =
  | "CREATED"
  | "UPDATED"
  | "PARTIAL"
  | "RETURNED"
  | "WRITTEN_OFF"
  | "RETURN_RESOLVED"
  | "UNDO_WRITTEN_OFF";

export type OrderRecord = {
  id: string;
  code: string;
  companyName: string;
  factoryName: string;
  firstDelivery: string;
  customerName: string;
  quantity: number;
  suitQuantity: number;
  jacketQuantity: number;
  pantQuantity: number;
  vestQuantity: number;
  coatQuantity: number;
  returnSuitQuantity: number;
  returnJacketQuantity: number;
  returnPantQuantity: number;
  returnVestQuantity: number;
  returnCoatQuantity: number;
  registeredAt: string;
  status: OrderStatus;
  writtenOffAt: string | null;
  returnedAt: string | null;
  returnNote: string;
  urgency: UrgencyLevel;
  partialQuantity: number | null;
  partialDate: string | null;
  partialNote: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderEventRecord = {
  id: string;
  orderId: string;
  orderCode: string;
  type: OrderEventType;
  detail: string;
  createdAt: string;
};

export type CreateOrdersInput = {
  codes: string[];
  companyName: string;
  factoryName: string;
  firstDelivery: string;
  customerName: string;
  quantity: number;
  suitQuantity: number;
  jacketQuantity: number;
  pantQuantity: number;
  vestQuantity: number;
  coatQuantity: number;
  registeredAt: string;
  urgency: UrgencyLevel;
  note: string;
};

export type ImportOrderInput = CreateOrdersInput & {
  code: string;
  status: OrderStatus;
  writtenOffAt: string | null;
  returnedAt: string | null;
  returnNote: string;
  returnSuitQuantity: number;
  returnJacketQuantity: number;
  returnPantQuantity: number;
  returnVestQuantity: number;
  returnCoatQuantity: number;
  partialQuantity: number | null;
  partialDate: string | null;
  partialNote: string;
};

export type UpdateOrderInput = {
  id: string;
  companyName: string;
  factoryName: string;
  firstDelivery: string;
  customerName: string;
  quantity: number;
  suitQuantity: number;
  jacketQuantity: number;
  pantQuantity: number;
  vestQuantity: number;
  coatQuantity: number;
  registeredAt: string;
  urgency: UrgencyLevel;
  partialQuantity: number | null;
  partialDate: string | null;
  partialNote: string;
  note: string;
};

export type ReturnOrderInput = {
  id: string;
  returnedAt: string;
  returnNote: string;
  returnSuitQuantity: number;
  returnJacketQuantity: number;
  returnPantQuantity: number;
  returnVestQuantity: number;
  returnCoatQuantity: number;
};

export type ActionResult = {
  ok: boolean;
  message: string;
  skipped?: string[];
};

export type ImportOrdersResult = {
  created: number;
  updated: number;
  skipped: string[];
};

export const statusLabels: Record<OrderStatus, string> = {
  PENDING: "待核销",
  PARTIAL: "部分交付",
  RETURNED: "返厂修改",
  WRITTEN_OFF: "已核销",
};

export const urgencyLabels: Record<UrgencyLevel, string> = {
  NORMAL: "普通",
  URGENT: "比较急",
  VERY_URGENT: "特急",
};
