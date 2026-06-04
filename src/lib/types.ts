export const ORDER_STATUSES = ["PENDING", "PARTIAL", "WRITTEN_OFF"] as const;
export const URGENCY_LEVELS = ["NORMAL", "URGENT", "VERY_URGENT"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export type OrderEventType =
  | "CREATED"
  | "UPDATED"
  | "PARTIAL"
  | "WRITTEN_OFF"
  | "UNDO_WRITTEN_OFF";

export type OrderRecord = {
  id: string;
  code: string;
  customerName: string;
  quantity: number;
  suitQuantity: number;
  jacketQuantity: number;
  pantQuantity: number;
  vestQuantity: number;
  coatQuantity: number;
  registeredAt: string;
  status: OrderStatus;
  writtenOffAt: string | null;
  urgency: UrgencyLevel;
  partialQuantity: number | null;
  partialDate: string | null;
  partialNote: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrdersInput = {
  codes: string[];
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

export type UpdateOrderInput = {
  id: string;
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

export type ActionResult = {
  ok: boolean;
  message: string;
  skipped?: string[];
};

export const statusLabels: Record<OrderStatus, string> = {
  PENDING: "待核销",
  PARTIAL: "部分交付",
  WRITTEN_OFF: "已核销",
};

export const urgencyLabels: Record<UrgencyLevel, string> = {
  NORMAL: "普通",
  URGENT: "比较急",
  VERY_URGENT: "最急",
};
