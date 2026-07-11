"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  Flame,
  History,
  ListChecks,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  addOrderDeliveryAction,
  createOrdersAction,
  importCsvAction,
  importSqliteBackupAction,
  installUpdateAction,
  markReturnedOrderAction,
  removeOrderDeliveryAction,
  undoWriteOffOrderAction,
  updateOrderAction,
  writeOffOrderAction,
} from "@/app/actions";
import { logoutAction } from "@/app/auth-actions";
import {
  PRODUCT_COLUMNS,
  calculateTotalQuantity,
  productSummary,
} from "@/lib/catalog";
import { COMPANY_OPTIONS, FACTORY_OPTIONS } from "@/lib/companies";
import { formatDateTime } from "@/lib/date";
import {
  ORDER_STATUSES,
  URGENCY_LEVELS,
  type ActionResult,
  type DeliveryQuantities,
  type OrderEventRecord,
  type OrderDeliveryRecord,
  type OrderRecord,
  type OrderStatus,
  type UrgencyLevel,
  statusLabels,
  urgencyLabels,
} from "@/lib/types";

type WorkbenchProps = {
  cloudMode: boolean;
  initialEvents: OrderEventRecord[];
  initialOrders: OrderRecord[];
  phoneAccess: PhoneAccess;
  today: string;
};

type PhoneAccess = {
  primaryUrl: string | null;
  qrDataUrl: string | null;
  urls: string[];
};

type ServerAction = (formData: FormData) => Promise<ActionResult>;
type SubmitHandler = (
  event: FormEvent<HTMLFormElement>,
  action: ServerAction,
  busyLabel: string,
  reset?: boolean,
  onResult?: (result: ActionResult) => void,
) => Promise<void>;
type StatusFilter = "ALL" | "OPEN" | OrderStatus;
type UrgencyFilter = "ALL" | UrgencyLevel;
type CompanyFilter = "ALL" | "UNASSIGNED" | string;
type FactoryFilter = "ALL" | "UNASSIGNED" | string;
type SortMode = "CODE_ASC" | "DATE_ASC" | "DATE_DESC";
type UpdateState = {
  ok: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  assetName: string | null;
  downloadUrl: string | null;
  releaseUrl: string | null;
  message: string;
};
const MOBILE_QUERY = "(max-width: 767px)";

const urgencyWeight: Record<UrgencyLevel, number> = {
  VERY_URGENT: 0,
  URGENT: 1,
  NORMAL: 2,
};

const statusTone: Record<OrderStatus, string> = {
  PENDING: "border-zinc-200 bg-zinc-100 text-zinc-700",
  PARTIAL: "border-cyan-200 bg-cyan-50 text-cyan-800",
  RETURNED: "border-violet-200 bg-violet-50 text-violet-800",
  WRITTEN_OFF: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const urgencyTone: Record<UrgencyLevel, string> = {
  NORMAL: "border-zinc-200 bg-white text-zinc-600",
  URGENT: "border-yellow-300 bg-yellow-50 text-yellow-800",
  VERY_URGENT: "border-red-200 bg-red-50 text-red-800",
};
const firstDeliveryTone = "border-orange-200 bg-orange-50 text-orange-800";

const controlBaseClass =
  "h-10 w-full rounded-md border px-3 text-sm outline-none transition focus:ring-2";
const filterSelectBaseClass =
  "h-9 rounded-md border px-2 text-sm font-medium outline-none transition focus:ring-2";
const neutralControlTone =
  "border-zinc-300 bg-white text-zinc-950 focus:border-zinc-950 focus:ring-zinc-200";

const statusControlTone: Record<OrderStatus, string> = {
  PENDING:
    "border-zinc-300 bg-zinc-50 text-zinc-800 focus:border-zinc-500 focus:ring-zinc-200",
  PARTIAL:
    "border-cyan-300 bg-cyan-50 text-cyan-900 focus:border-cyan-600 focus:ring-cyan-200",
  RETURNED:
    "border-violet-300 bg-violet-50 text-violet-900 focus:border-violet-600 focus:ring-violet-200",
  WRITTEN_OFF:
    "border-emerald-300 bg-emerald-50 text-emerald-900 focus:border-emerald-600 focus:ring-emerald-200",
};

const urgencyControlTone: Record<UrgencyLevel, string> = {
  NORMAL:
    "border-zinc-300 bg-white text-zinc-900 focus:border-zinc-950 focus:ring-zinc-200",
  URGENT:
    "border-yellow-300 bg-yellow-50 text-yellow-900 focus:border-yellow-500 focus:ring-yellow-200",
  VERY_URGENT:
    "border-red-300 bg-red-50 text-red-900 focus:border-red-600 focus:ring-red-200",
};

const statusOptionStyle: Record<OrderStatus, CSSProperties> = {
  PENDING: { backgroundColor: "#f4f4f5", color: "#3f3f46" },
  PARTIAL: { backgroundColor: "#ecfeff", color: "#155e75" },
  RETURNED: { backgroundColor: "#f5f3ff", color: "#5b21b6" },
  WRITTEN_OFF: { backgroundColor: "#ecfdf5", color: "#047857" },
};

const urgencyOptionStyle: Record<UrgencyLevel, CSSProperties> = {
  NORMAL: { backgroundColor: "#ffffff", color: "#3f3f46" },
  URGENT: { backgroundColor: "#fefce8", color: "#854d0e" },
  VERY_URGENT: { backgroundColor: "#fef2f2", color: "#b91c1c" },
};

const eventLabels = {
  CREATED: "登记",
  UPDATED: "更新",
  PARTIAL: "部分交付",
  FIRST_DELIVERY: "先交",
  FIRST_DELIVERY_REMOVED: "撤销先交",
  RETURNED: "返厂修改",
  WRITTEN_OFF: "出货核销",
  RETURN_RESOLVED: "完成返厂",
  UNDO_WRITTEN_OFF: "撤销核销",
} as const;

const deliveryQuantityKeys = {
  suitQuantity: "deliverySuitQuantity",
  jacketQuantity: "deliveryJacketQuantity",
  pantQuantity: "deliveryPantQuantity",
  vestQuantity: "deliveryVestQuantity",
  coatQuantity: "deliveryCoatQuantity",
} as const;

const orderCodeCollator = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

const returnQuantityKeys = {
  suitQuantity: "returnSuitQuantity",
  jacketQuantity: "returnJacketQuantity",
  pantQuantity: "returnPantQuantity",
  vestQuantity: "returnVestQuantity",
  coatQuantity: "returnCoatQuantity",
} as const;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function subscribeToMobile(callback: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerMobileSnapshot() {
  return false;
}

function usePhoneMode() {
  return useSyncExternalStore(
    subscribeToMobile,
    getMobileSnapshot,
    getServerMobileSnapshot,
  );
}

function writeOffLabel(status: OrderStatus) {
  if (status === "RETURNED") {
    return "完成返厂";
  }

  return status === "WRITTEN_OFF" ? "已出货" : "出货核销";
}

function dateText(value: string | null) {
  return value || "-";
}

function blankText(value: string, fallback = "未选择") {
  return value.trim() || fallback;
}

function mergedOptions(
  configured: readonly string[],
  values: string[],
) {
  return Array.from(
    new Set(
      [...configured, ...values]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function quantityValues(order: OrderRecord) {
  return {
    suitQuantity: order.suitQuantity,
    jacketQuantity: order.jacketQuantity,
    pantQuantity: order.pantQuantity,
    vestQuantity: order.vestQuantity,
    coatQuantity: order.coatQuantity,
  };
}

function orderQuantity(order: OrderRecord) {
  const categoryTotal = calculateTotalQuantity(quantityValues(order));
  return categoryTotal > 0 ? categoryTotal : order.quantity;
}

function emptyQuantities(): DeliveryQuantities {
  return {
    suitQuantity: 0,
    jacketQuantity: 0,
    pantQuantity: 0,
    vestQuantity: 0,
    coatQuantity: 0,
  };
}

function deliveryTotals(order: OrderRecord) {
  return order.deliveries.reduce<DeliveryQuantities>((totals, delivery) => {
    PRODUCT_COLUMNS.forEach((item) => {
      totals[item.key] += delivery[item.key];
    });
    return totals;
  }, emptyQuantities());
}

function uncategorizedDelivered(order: OrderRecord) {
  return order.deliveries.reduce(
    (total, delivery) => total + delivery.uncategorizedQuantity,
    0,
  );
}

function hasFirstDelivery(order: OrderRecord) {
  return order.deliveries.length > 0 || Boolean(order.firstDelivery.trim());
}

function remainingQuantities(order: OrderRecord) {
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

function remainingTotal(order: OrderRecord) {
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

function quantitySummary(values: DeliveryQuantities) {
  return PRODUCT_COLUMNS.filter((item) => values[item.key] > 0)
    .map((item) => `${item.shortLabel}${values[item.key]}`)
    .join(" ");
}

function deliveryRecordSummary(delivery: OrderDeliveryRecord) {
  const categorized = quantitySummary(delivery);
  const uncategorized = delivery.uncategorizedQuantity
    ? `未分细类${delivery.uncategorizedQuantity}`
    : "";
  return [categorized, uncategorized].filter(Boolean).join(" ");
}

function compareOrderCodes(a: OrderRecord, b: OrderRecord) {
  return (
    orderCodeCollator.compare(a.code, b.code) ||
    a.registeredAt.localeCompare(b.registeredAt) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function compareOrders(a: OrderRecord, b: OrderRecord, mode: SortMode) {
  if (mode === "DATE_DESC") {
    return (
      b.registeredAt.localeCompare(a.registeredAt) || compareOrderCodes(a, b)
    );
  }

  if (mode === "DATE_ASC") {
    return (
      a.registeredAt.localeCompare(b.registeredAt) || compareOrderCodes(a, b)
    );
  }

  return compareOrderCodes(a, b);
}

function returnSummary(order: OrderRecord) {
  return PRODUCT_COLUMNS.filter(
    (item) => order[returnQuantityKeys[item.key]] > 0,
  )
    .map((item) => `${item.label}${order[returnQuantityKeys[item.key]]}`)
    .join(" ");
}

function returnSummaryLabel(order: OrderRecord) {
  return order.status === "RETURNED" ? "返厂数量" : "曾返厂";
}

function orderMatches(order: OrderRecord, query: string) {
  const q = query.trim().toLowerCase();

  if (!q) {
    return true;
  }

  return [
    order.code,
    order.companyName,
    order.factoryName,
    order.firstDelivery,
    order.customerName,
    order.note,
    order.partialNote,
  ].some((value) => value.toLowerCase().includes(q));
}

function sortByUrgency(a: OrderRecord, b: OrderRecord) {
  return (
    urgencyWeight[a.urgency] - urgencyWeight[b.urgency] ||
    a.registeredAt.localeCompare(b.registeredAt) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function orderTextTone(order: OrderRecord) {
  if (order.status === "RETURNED") {
    return "text-violet-700";
  }

  if (order.status === "WRITTEN_OFF") {
    return "text-emerald-700";
  }

  if (order.urgency === "VERY_URGENT") {
    return "text-red-700";
  }

  if (order.urgency === "URGENT") {
    return "text-yellow-700";
  }

  return "text-zinc-950";
}

function orderSubTextTone(order: OrderRecord) {
  if (order.status === "RETURNED") {
    return "text-violet-600";
  }

  if (order.status === "WRITTEN_OFF") {
    return "text-emerald-600";
  }

  if (order.urgency === "VERY_URGENT") {
    return "text-red-600";
  }

  if (order.urgency === "URGENT") {
    return "text-yellow-700";
  }

  return "text-zinc-500";
}

function fieldClass(tone = neutralControlTone) {
  return cn(controlBaseClass, tone);
}

function filterSelectClass(tone = neutralControlTone) {
  return cn(filterSelectBaseClass, tone);
}

function statusFilterTone(value: StatusFilter) {
  return ORDER_STATUSES.includes(value as OrderStatus)
    ? statusControlTone[value as OrderStatus]
    : neutralControlTone;
}

function urgencyFilterTone(value: UrgencyFilter) {
  return URGENCY_LEVELS.includes(value as UrgencyLevel)
    ? urgencyControlTone[value as UrgencyLevel]
    : neutralControlTone;
}

function tableInputClass(extra = "") {
  return cn(
    "h-10 w-full border-0 bg-white px-2 text-sm text-zinc-950 outline-none transition focus:bg-zinc-50 focus:ring-2 focus:ring-inset focus:ring-zinc-300",
    extra,
  );
}

function textareaClass() {
  return "w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-zinc-600">
      {label}
      {children}
    </label>
  );
}

function OptionSelect({
  name,
  options,
  placeholder,
  required,
  value,
}: {
  name: string;
  options: string[];
  placeholder: string;
  required?: boolean;
  value?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      required={required}
      className={fieldClass()}
    >
      <option value="">{placeholder}</option>
      {options.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>
  );
}

function UrgencySelect({
  name,
  value = "NORMAL",
}: {
  name: string;
  value?: UrgencyLevel;
}) {
  const [selected, setSelected] = useState<UrgencyLevel>(value);

  return (
    <select
      name={name}
      value={selected}
      onChange={(event) => setSelected(event.target.value as UrgencyLevel)}
      className={fieldClass(urgencyControlTone[selected])}
    >
      {URGENCY_LEVELS.map((level) => (
        <option key={level} value={level} style={urgencyOptionStyle[level]}>
          {urgencyLabels[level]}
        </option>
      ))}
    </select>
  );
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function QuantityPair({
  label,
  value,
  large = false,
  emphasis = false,
}: {
  label: string;
  value: number;
  large?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className="inline-flex min-w-0 items-baseline gap-1.5 whitespace-nowrap"
      aria-label={`${label}${value}`}
    >
      <span
        className={cn(
          "font-medium",
          emphasis ? "text-blue-800" : "text-zinc-500",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-semibold",
          large ? "text-xl" : "text-sm",
          emphasis ? "text-blue-900" : "text-zinc-950",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DeliveryQuantityRow({
  label,
  values,
  total,
  tone = "zinc",
}: {
  label: string;
  values: DeliveryQuantities;
  total: number;
  tone?: "orange" | "blue" | "zinc";
}) {
  const toneClass = {
    orange: "border-orange-200 bg-orange-50 text-orange-950",
    blue: "border-blue-200 bg-blue-50 text-blue-950",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-950",
  }[tone];

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 last:border-b-0",
        toneClass,
      )}
    >
      <span className="min-w-16 text-sm font-semibold">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {PRODUCT_COLUMNS.map((item) => (
          <QuantityPair
            key={item.key}
            label={item.label}
            value={values[item.key]}
          />
        ))}
      </div>
      <span className="ml-auto whitespace-nowrap text-sm font-semibold">
        小计 {total}
      </span>
    </div>
  );
}

function DeliverySection({
  busy,
  editable,
  onSubmit,
  order,
  today,
}: {
  busy: string | null;
  editable: boolean;
  onSubmit: SubmitHandler;
  order: OrderRecord;
  today: string;
}) {
  const delivered = deliveryTotals(order);
  const remaining = remainingQuantities(order);
  const deliveredTotal =
    calculateTotalQuantity(delivered) + uncategorizedDelivered(order);
  const canAdd =
    editable && (order.status === "PENDING" || order.status === "PARTIAL");
  const deliveries = [...order.deliveries].reverse();

  return (
    <section className="overflow-hidden rounded-md border border-orange-200">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-orange-950">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          先交记录
        </div>
        <div className="text-xs font-medium text-orange-800">
          {order.deliveries.length} 次
        </div>
      </div>

      <DeliveryQuantityRow
        label="累计先交"
        values={delivered}
        total={deliveredTotal}
        tone="orange"
      />
      {uncategorizedDelivered(order) > 0 ? (
        <div className="border-b border-orange-200 bg-orange-50 px-3 pb-3 text-xs font-medium text-orange-800">
          其中旧记录未分细类 {uncategorizedDelivered(order)} 件
        </div>
      ) : null}
      <DeliveryQuantityRow
        label={order.status === "RETURNED" ? "返厂待再交" : "剩余未交"}
        values={remaining}
        total={remainingTotal(order)}
        tone="blue"
      />

      {order.firstDelivery ? (
        <div className="border-b border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          旧版先交备注：{order.firstDelivery}
        </div>
      ) : null}

      {deliveries.length > 0 ? (
        <div className="divide-y divide-zinc-100 bg-white">
          {deliveries.map((delivery) => (
            <div
              key={delivery.id}
              className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium text-zinc-950">
                  {delivery.deliveredAt} · {deliveryRecordSummary(delivery)}
                </div>
                {delivery.note ? (
                  <div className="mt-1 break-words text-xs text-zinc-500">
                    {delivery.note}
                  </div>
                ) : null}
              </div>
              {canAdd && delivery.source === "STRUCTURED" ? (
                <form
                  onSubmit={(event) =>
                    onSubmit(
                      event,
                      removeOrderDeliveryAction,
                      `撤销先交-${delivery.id}`,
                    )
                  }
                >
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="deliveryId" value={delivery.id} />
                  <button
                    type="submit"
                    disabled={Boolean(busy)}
                    onClick={(event) => {
                      if (!window.confirm("确认撤销这一笔先交记录？")) {
                        event.preventDefault();
                      }
                    }}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:text-zinc-400"
                    title="撤销这笔先交"
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {busy === `撤销先交-${delivery.id}` ? "撤销中" : "撤销"}
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white px-3 py-3 text-sm text-zinc-500">
          暂无按数量登记的先交记录
        </div>
      )}

      {canAdd ? (
        <details className="group border-t border-orange-200 bg-white">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-orange-900 transition hover:bg-orange-50 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <Plus
                className="h-4 w-4 transition group-open:rotate-45"
                aria-hidden="true"
              />
              记录本次先交
            </span>
            <span className="text-xs font-medium text-orange-700">填写</span>
          </summary>
          <form
            onSubmit={(event) =>
              onSubmit(
                event,
                addOrderDeliveryAction,
                `先交-${order.id}`,
                true,
              )
            }
            className="grid gap-2 border-t border-orange-100 p-3"
          >
            <input type="hidden" name="orderId" value={order.id} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PRODUCT_COLUMNS.map((item) => (
                <Field
                  key={item.key}
                  label={`${item.label}（余${remaining[item.key]}）`}
                >
                  <input
                    name={deliveryQuantityKeys[item.key]}
                    type="number"
                    min={0}
                    max={remaining[item.key]}
                    inputMode="numeric"
                    defaultValue={0}
                    className={fieldClass()}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_150px] sm:items-end">
              <Field label="先交日期">
                <input
                  name="deliveryDate"
                  type="date"
                  defaultValue={today}
                  required
                  className={fieldClass()}
                />
              </Field>
              <Field label="本次先交备注">
                <input
                  name="deliveryNote"
                  className={fieldClass()}
                  placeholder="可不填"
                />
              </Field>
              <button
                type="submit"
                disabled={
                  Boolean(busy) ||
                  remainingTotal(order) <= 1 ||
                  calculateTotalQuantity(remaining) <= 0
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange-700 px-3 text-sm font-medium text-white transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:bg-orange-300"
                title="保存本次先交"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {busy === `先交-${order.id}` ? "保存中" : "保存先交"}
              </button>
            </div>
            {remainingTotal(order) <= 1 ? (
              <div className="text-xs font-medium text-zinc-500">
                最后一件请直接使用“出货核销”。
              </div>
            ) : null}
          </form>
        </details>
      ) : null}
    </section>
  );
}

function ReturnOrderForm({
  busy,
  onSubmit,
  order,
  today,
}: {
  busy: string | null;
  onSubmit: SubmitHandler;
  order: OrderRecord;
  today: string;
}) {
  const isEditing = order.status === "RETURNED";
  const hasCategoryQuantities = calculateTotalQuantity(quantityValues(order)) > 0;

  return (
    <form
      onSubmit={(event) => onSubmit(event, markReturnedOrderAction, "返厂")}
      className="grid gap-3 rounded-md border border-violet-200 bg-violet-50 p-3"
    >
      <input type="hidden" name="id" value={order.id} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-violet-900">
          {isEditing ? "更新返厂记录" : "返厂修改"}
        </div>
        <div className="text-xs font-medium text-violet-700">
          返厂日期 {today}
        </div>
      </div>
      <input type="hidden" name="returnedAt" value={today} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PRODUCT_COLUMNS.map((item) => {
          const maxQuantity = hasCategoryQuantities
            ? order[item.key]
            : order.quantity;
          const defaultQuantity = isEditing
            ? order[returnQuantityKeys[item.key]]
            : 0;

          return (
            <Field key={item.key} label={`${item.label}（原${maxQuantity}）`}>
              <input
                name={returnQuantityKeys[item.key]}
                type="number"
                min={0}
                max={maxQuantity}
                inputMode="numeric"
                defaultValue={defaultQuantity}
                className={fieldClass()}
              />
            </Field>
          );
        })}
      </div>
      <Field label="返厂备注">
        <textarea
          name="returnNote"
          rows={2}
          className={textareaClass()}
          defaultValue={isEditing ? order.returnNote : ""}
          placeholder="例如：客人改腰、改单衫袖长"
        />
      </Field>
      <button
        type="submit"
        disabled={Boolean(busy)}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-medium text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300"
        title={isEditing ? "更新返厂记录" : "标记返厂修改"}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {busy === "返厂"
          ? "保存中"
          : isEditing
            ? "更新返厂记录"
            : "标记返厂修改"}
      </button>
    </form>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
}) {
  return (
    <div className="min-h-20 rounded-md border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function PhoneAccessCard({ access }: { access: PhoneAccess }) {
  const [copied, setCopied] = useState(false);
  const primaryUrl = access.primaryUrl ?? access.urls[0] ?? null;
  const otherUrls = access.urls.filter((url) => url !== primaryUrl).slice(0, 3);

  if (!primaryUrl) {
    return (
      <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
        <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          手机/其他电脑访问
        </div>
        <div className="p-4 text-sm text-zinc-500">
          未检测到办公室局域网地址。
        </div>
      </section>
    );
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <Smartphone className="h-4 w-4" aria-hidden="true" />
        手机/其他电脑访问
      </div>
      <div className="grid gap-3 p-4">
        {access.qrDataUrl ? (
          <div className="flex justify-center rounded-md border border-zinc-200 bg-white p-3">
            <Image
              src={access.qrDataUrl}
              alt="手机访问二维码"
              className="h-40 w-40"
              height={160}
              unoptimized
              width={160}
            />
          </div>
        ) : null}
        <div className="break-all rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950">
          {primaryUrl}
        </div>
        <button
          type="button"
          onClick={() => copyUrl(primaryUrl)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50"
          title="复制手机访问地址"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {copied ? "已复制" : "复制地址"}
        </button>
        <div className="text-xs leading-5 text-zinc-500">
          只在一台电脑上双击打开工具；手机或另一台电脑连同一个 Wi-Fi 后，用这个地址访问，数据会写入同一份总表。
        </div>
        {otherUrls.length > 0 ? (
          <div className="grid gap-1 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
            <div>扫码不通时试这些地址：</div>
            {otherUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => copyUrl(url)}
                className="break-all text-left text-zinc-700 underline-offset-2 hover:underline"
              >
                {url}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ImportBackupCard({
  busy,
  onSubmit,
}: {
  busy: string | null;
  onSubmit: SubmitHandler;
}) {
  return (
    <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <FileDown className="h-4 w-4" aria-hidden="true" />
        数据工具
      </div>
      <div className="grid gap-3 p-4">
        <a
          href="/api/backup"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          下载数据库备份
        </a>
        <form
          onSubmit={(event) => onSubmit(event, importCsvAction, "导入", true)}
          className="grid gap-2 border-t border-zinc-100 pt-3"
        >
          <Field label="导入 CSV">
            <input
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-medium file:text-white"
              required
            />
          </Field>
          <button
            type="submit"
            disabled={Boolean(busy)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            title="导入 CSV"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {busy === "导入" ? "导入中" : "导入订单"}
          </button>
        </form>
        <form
          onSubmit={(event) =>
            onSubmit(event, importSqliteBackupAction, "导入旧库", true)
          }
          className="grid gap-2 border-t border-zinc-100 pt-3"
        >
          <Field label="导入旧版 .db 备份">
            <input
              name="dbFile"
              type="file"
              accept=".db,application/octet-stream,application/x-sqlite3"
              className="block w-full text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-medium file:text-white"
              required
            />
          </Field>
          <button
            type="submit"
            disabled={Boolean(busy)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
            title="导入旧版数据库备份"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {busy === "导入旧库" ? "导入中" : "导入旧版 .db"}
          </button>
          <div className="text-xs leading-5 text-zinc-500">
            用于导入旧绿色版或备份目录里的 `jeff-order-*.db`，导入前会自动备份当前数据。
          </div>
        </form>
      </div>
    </section>
  );
}

function UpdateCard({
  busy,
  onSubmit,
}: {
  busy: string | null;
  onSubmit: SubmitHandler;
}) {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(true);
  const [installResult, setInstallResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const response = await fetch("/api/update", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = (await response.json()) as UpdateState;

        if (!cancelled) {
          setUpdate(data);
        }
      } catch {
        if (!cancelled) {
          setUpdate({
            ok: false,
            currentVersion: "",
            latestVersion: null,
            updateAvailable: false,
            assetName: null,
            downloadUrl: null,
            releaseUrl: null,
            message: "暂时无法检查更新",
          });
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, []);

  const canInstall = Boolean(update?.updateAvailable && update.downloadUrl);

  return (
    <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <Activity className="h-4 w-4" aria-hidden="true" />
        软件更新
      </div>
      <div className="grid gap-3 p-4 text-sm">
        <div className="grid gap-1 text-zinc-600">
          <div>
            当前版本{" "}
            <span className="font-semibold text-zinc-950">
              {update?.currentVersion || "-"}
            </span>
          </div>
          <div>
            最新版本{" "}
            <span className="font-semibold text-zinc-950">
              {checking ? "检查中" : update?.latestVersion || "-"}
            </span>
          </div>
          <div
            className={cn(
              "text-xs font-medium",
              canInstall ? "text-emerald-700" : "text-zinc-500",
            )}
          >
            {checking ? "正在检查更新" : update?.message || "暂无更新信息"}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {update?.releaseUrl ? (
            <a
              href={update.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-zinc-700 underline-offset-2 hover:underline"
            >
              查看发布页面
            </a>
          ) : null}
          {canInstall && update?.downloadUrl ? (
            <a
              href={update.downloadUrl}
              className="text-xs font-medium text-blue-700 underline-offset-2 hover:underline"
            >
              手动下载安装包
            </a>
          ) : null}
        </div>
        <form
          onSubmit={(event) =>
            onSubmit(
              event,
              installUpdateAction,
              "更新",
              false,
              setInstallResult,
            )
          }
        >
          <button
            type="submit"
            disabled={Boolean(busy) || !canInstall}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            title="安装更新"
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            {busy === "更新"
              ? "更新中"
              : canInstall
                ? `更新到 ${update?.latestVersion}`
                : "无需更新"}
          </button>
        </form>
        {installResult ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs font-medium",
              installResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {installResult.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EventLogCard({ events }: { events: OrderEventRecord[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-zinc-200 px-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" aria-hidden="true" />
          最近操作
        </div>
        <a
          href="/events"
          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
          title="查看全部操作"
        >
          全部
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <div className="max-h-72 overflow-auto">
        {events.length > 0 ? (
          events.slice(0, 20).map((event) => (
            <div
              key={event.id}
              className="grid gap-1 border-b border-zinc-100 px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-zinc-950">
                  {event.orderCode || "未知订单"}
                </span>
                <span className="text-xs text-zinc-500">
                  {eventLabels[event.type]}
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                {formatDateTime(event.createdAt)}
              </div>
              {event.detail ? (
                <div className="text-xs text-zinc-600">{event.detail}</div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-sm text-zinc-500">暂无</div>
        )}
      </div>
    </section>
  );
}

function OrderRow({
  order,
  active,
  onSelect,
}: {
  order: OrderRecord;
  active: boolean;
  onSelect: () => void;
}) {
  const summary = productSummary(order);
  const returnedSummary = returnSummary(order);
  const delivered = deliveryTotals(order);
  const remaining = remainingQuantities(order);
  const mainTone = orderTextTone(order);
  const subTone = orderSubTextTone(order);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full gap-2 border-b border-zinc-100 px-3 py-3 text-left transition hover:bg-zinc-50",
        active && "bg-zinc-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-semibold", mainTone)}>
            {order.code}
          </div>
          <div className={cn("mt-1 truncate text-xs", subTone)}>
            {blankText(order.companyName, "未选公司")} ·{" "}
            {blankText(order.factoryName, "未选工厂")}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Badge className={statusTone[order.status]}>
            {statusLabels[order.status]}
          </Badge>
          {order.urgency !== "NORMAL" ? (
            <Badge className={urgencyTone[order.urgency]}>
              {urgencyLabels[order.urgency]}
            </Badge>
          ) : null}
          {hasFirstDelivery(order) ? (
            <Badge className={firstDeliveryTone}>先交</Badge>
          ) : null}
        </div>
      </div>
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs", subTone)}>
        <span>登记 {order.registeredAt}</span>
        <span>出货 {dateText(order.writtenOffAt)}</span>
        <span>数量 {orderQuantity(order)}</span>
        {order.deliveries.length > 0 ? (
          <span>
            累计先交 {quantitySummary(delivered) || uncategorizedDelivered(order)}
          </span>
        ) : null}
        {order.status !== "WRITTEN_OFF" && hasFirstDelivery(order) ? (
          <span>
            剩余 {quantitySummary(remaining) || remainingTotal(order)}（小计
            {remainingTotal(order)}）
          </span>
        ) : null}
        {order.firstDelivery ? <span>旧备注 {order.firstDelivery}</span> : null}
        {summary ? <span>{summary}</span> : null}
        {returnedSummary ? (
          <span>
            {returnSummaryLabel(order)} {returnedSummary}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function MobileDetail({
  order,
  today,
  busy,
  onSubmit,
}: {
  order: OrderRecord;
  today: string;
  busy: string | null;
  onSubmit: SubmitHandler;
}) {
  const summary = productSummary(order);
  const returnedSummary = returnSummary(order);

  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-2">
        <div className="break-all text-2xl font-semibold text-zinc-950">
          {order.code}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge className={statusTone[order.status]}>
            {statusLabels[order.status]}
          </Badge>
          <Badge className={urgencyTone[order.urgency]}>
            {urgencyLabels[order.urgency]}
          </Badge>
          {hasFirstDelivery(order) ? (
            <Badge className={firstDeliveryTone}>先交</Badge>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">公司</span>
          <span className="text-right font-medium text-zinc-950">
            {blankText(order.companyName)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">工厂</span>
          <span className="text-right font-medium text-zinc-950">
            {blankText(order.factoryName)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">登记日期</span>
          <span className="font-medium text-zinc-950">{order.registeredAt}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">出货日期</span>
          <span className="font-medium text-zinc-950">
            {dateText(order.writtenOffAt)}
          </span>
        </div>
        {order.returnedAt ? (
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">返厂日期</span>
            <span className="font-medium text-violet-700">
              {order.returnedAt}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">数量小计</span>
          <span className="font-medium text-zinc-950">
            {orderQuantity(order)}
          </span>
        </div>
      </div>

      <div className="rounded-md border border-zinc-200">
        <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">
          细分类数量
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 text-sm">
          {PRODUCT_COLUMNS.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-start"
            >
              <QuantityPair label={item.label} value={order[item.key]} />
            </div>
          ))}
        </div>
      </div>

      {summary ? (
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">摘要</span>
            <span className="text-right font-medium text-zinc-950">
              {summary}
            </span>
          </div>
        </div>
      ) : null}

      {hasFirstDelivery(order) ? (
        <DeliverySection
          busy={busy}
          editable={false}
          onSubmit={onSubmit}
          order={order}
          today={today}
        />
      ) : null}

      {returnedSummary || order.returnNote ? (
        <div className="grid gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          {returnedSummary ? (
            <div>
              {returnSummaryLabel(order)}：{returnedSummary}
            </div>
          ) : null}
          {order.returnNote ? <div>{order.returnNote}</div> : null}
        </div>
      ) : null}

      {order.note ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {order.note}
        </div>
      ) : null}

      {order.status === "WRITTEN_OFF" || order.status === "RETURNED" ? (
        <ReturnOrderForm
          busy={busy}
          onSubmit={onSubmit}
          order={order}
          today={today}
        />
      ) : null}

      {order.status !== "WRITTEN_OFF" ? (
        <form
          onSubmit={(event) => onSubmit(event, writeOffOrderAction, "核销")}
          className="border-t border-emerald-100 pt-3"
        >
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="writtenOffAt" value={today} />
          <button
            type="submit"
            disabled={Boolean(busy)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
            title="出货核销"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {busy === "核销" ? "核销中" : writeOffLabel(order.status)}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function Workbench({
  cloudMode,
  initialEvents,
  initialOrders,
  phoneAccess,
  today,
}: WorkbenchProps) {
  const router = useRouter();
  const isPhoneMode = usePhoneMode();
  const orders = initialOrders;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOrders[0]?.id ?? null,
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("ALL");
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("ALL");
  const [factoryFilter, setFactoryFilter] = useState<FactoryFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("CODE_ASC");
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [entryFormKey, setEntryFormKey] = useState(0);

  const exactMatches = query.trim()
    ? orders.filter(
        (order) => order.code.toLowerCase() === query.trim().toLowerCase(),
      )
    : [];
  const exactMatch = exactMatches.length === 1 ? exactMatches[0] : null;
  const selected =
    exactMatch ??
    orders.find((order) => order.id === selectedId) ??
    orders[0] ??
    null;

  const stats = useMemo(
    () => {
      const monthPrefix = today.slice(0, 7);
      const yearPrefix = today.slice(0, 4);

      return {
        todayRegistered: orders.filter((order) => order.registeredAt === today)
          .length,
        monthRegistered: orders.filter((order) =>
          order.registeredAt.startsWith(monthPrefix),
        ).length,
        yearRegistered: orders.filter((order) =>
          order.registeredAt.startsWith(yearPrefix),
        ).length,
        totalRegistered: orders.length,
        todayWrittenOff: orders.filter((order) => order.writtenOffAt === today)
          .length,
        open: orders.filter((order) => order.status !== "WRITTEN_OFF").length,
        partial: orders.filter((order) => order.status === "PARTIAL").length,
        firstDeliveryOpen: orders.filter(
          (order) =>
            order.status !== "WRITTEN_OFF" && hasFirstDelivery(order),
        ).length,
        urgentOpen: orders.filter(
          (order) =>
            order.status !== "WRITTEN_OFF" && order.urgency !== "NORMAL",
        ).length,
      };
    },
    [orders, today],
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    return orders.filter((order) => orderMatches(order, query)).slice(0, 8);
  }, [orders, query]);

  const urgentOrders = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            order.status !== "WRITTEN_OFF" && order.urgency !== "NORMAL",
        )
        .sort(sortByUrgency)
        .slice(0, 10),
    [orders],
  );
  const firstDeliveryOrders = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            order.status !== "WRITTEN_OFF" && hasFirstDelivery(order),
        )
        .sort(compareOrderCodes)
        .slice(0, 10),
    [orders],
  );

  const recentWrittenOff = useMemo(
    () =>
      orders
        .filter((order) => order.status === "WRITTEN_OFF")
        .sort(
          (a, b) =>
            (b.writtenOffAt ?? "").localeCompare(a.writtenOffAt ?? "") ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, 8),
    [orders],
  );
  const companyOptions = useMemo(
    () =>
      mergedOptions(
        COMPANY_OPTIONS,
        orders.map((order) => order.companyName),
      ),
    [orders],
  );
  const factoryOptions = useMemo(
    () =>
      mergedOptions(
        FACTORY_OPTIONS,
        orders.map((order) => order.factoryName),
      ),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => orderMatches(order, query))
      .filter((order) => {
        if (companyFilter === "ALL") {
          return true;
        }
        if (companyFilter === "UNASSIGNED") {
          return !order.companyName.trim();
        }
        return order.companyName === companyFilter;
      })
      .filter((order) => {
        if (factoryFilter === "ALL") {
          return true;
        }
        if (factoryFilter === "UNASSIGNED") {
          return !order.factoryName.trim();
        }
        return order.factoryName === factoryFilter;
      })
      .filter((order) => {
        if (statusFilter === "ALL") {
          return true;
        }
        if (statusFilter === "OPEN") {
          return order.status !== "WRITTEN_OFF";
        }
        return order.status === statusFilter;
      })
      .filter((order) => {
        if (urgencyFilter === "ALL") {
          return true;
        }
        return order.urgency === urgencyFilter;
      })
      .sort((a, b) => {
        if (a.status !== b.status) {
          const aClosed = a.status === "WRITTEN_OFF";
          const bClosed = b.status === "WRITTEN_OFF";
          if (aClosed !== bClosed) {
            return aClosed ? 1 : -1;
          }
        }
        return compareOrders(a, b, sortMode);
      });
  }, [
    orders,
    query,
    companyFilter,
    factoryFilter,
    statusFilter,
    urgencyFilter,
    sortMode,
  ]);

  const accountSummary = useMemo(() => {
    return {
      categories: PRODUCT_COLUMNS.map((item) => ({
        ...item,
        total: filteredOrders.reduce((sum, order) => sum + order[item.key], 0),
      })),
      quantity: filteredOrders.reduce(
        (sum, order) => sum + orderQuantity(order),
        0,
      ),
    };
  }, [filteredOrders]);

  const pendingQuantitySummary = useMemo(() => {
    const pendingOrders = orders.filter((order) => order.status !== "WRITTEN_OFF");
    const categories = PRODUCT_COLUMNS.map((item) => ({
      ...item,
      total: pendingOrders.reduce(
        (sum, order) => sum + remainingQuantities(order)[item.key],
        0,
      ),
    }));
    const categoryTotal = pendingOrders.reduce(
      (sum, order) =>
        sum + calculateTotalQuantity(remainingQuantities(order)),
      0,
    );
    const quantity = pendingOrders.reduce(
      (sum, order) => sum + remainingTotal(order),
      0,
    );

    return {
      categories,
      quantity,
      uncategorized: Math.max(quantity - categoryTotal, 0),
    };
  }, [orders]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: ServerAction,
    busyLabel: string,
    reset = false,
    onResult?: (result: ActionResult) => void,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(busyLabel);

    try {
      const actionResult = await action(new FormData(form));
      setNotice(actionResult);
      onResult?.(actionResult);

      if (actionResult.ok && reset) {
        form.reset();
        setEntryFormKey((key) => key + 1);
      }

      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const headers = [
      "号码",
      "公司",
      "工厂",
      "套装",
      "单衫",
      "单裤",
      "马甲",
      "大衣",
      "数量小计",
      "登记日期",
      "状态",
      "出货日期",
      "返厂日期",
      "返厂套装",
      "返厂单衫",
      "返厂单裤",
      "返厂马甲",
      "返厂大衣",
      "返厂备注",
      "急单等级",
      "先交次数",
      "累计先交套装",
      "累计先交单衫",
      "累计先交单裤",
      "累计先交马甲",
      "累计先交大衣",
      "先交未分细类",
      "剩余套装",
      "剩余单衫",
      "剩余单裤",
      "剩余马甲",
      "剩余大衣",
      "剩余数量小计",
      "最近先交日期",
      "先交明细",
      "备注",
    ];
    const rows = filteredOrders.map((order) => {
      const delivered = deliveryTotals(order);
      const remaining = remainingQuantities(order);
      const deliveryDetails = order.deliveries
        .map(
          (delivery) =>
            `${delivery.deliveredAt} ${deliveryRecordSummary(delivery)}${
              delivery.note ? ` ${delivery.note}` : ""
            }`,
        )
        .join("；");

      return [
        order.code,
        order.companyName,
        order.factoryName,
        String(order.suitQuantity),
        String(order.jacketQuantity),
        String(order.pantQuantity),
        String(order.vestQuantity),
        String(order.coatQuantity),
        String(orderQuantity(order)),
        order.registeredAt,
        statusLabels[order.status],
        order.writtenOffAt ?? "",
        order.returnedAt ?? "",
        String(order.returnSuitQuantity),
        String(order.returnJacketQuantity),
        String(order.returnPantQuantity),
        String(order.returnVestQuantity),
        String(order.returnCoatQuantity),
        order.returnNote,
        urgencyLabels[order.urgency],
        String(order.deliveries.length),
        ...PRODUCT_COLUMNS.map((item) => String(delivered[item.key])),
        String(uncategorizedDelivered(order)),
        ...PRODUCT_COLUMNS.map((item) => String(remaining[item.key])),
        String(remainingTotal(order)),
        order.deliveries.at(-1)?.deliveredAt ?? "",
        deliveryDetails || order.firstDelivery,
        order.note,
      ];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `订单出货核销-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main
      className="min-h-screen bg-[#f6f7f8] text-zinc-950"
      data-app="jeff-order-tool"
    >
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">
              Jeff 订单总表
            </h1>
            <div className="mt-1 text-sm text-zinc-500">
              今日 {today} · 一个总表，不分月份
            </div>
          </div>
          <div className="hidden flex-wrap gap-2 md:flex">
            <a
              href="/health"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              title="检查工具状态"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              检查
            </a>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              title="导出当前列表"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              导出
            </button>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
                title="退出登录"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                退出
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6">
        <section className="rounded-md border border-zinc-200 bg-white p-3">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-12 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-lg font-medium text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              placeholder="输入订单号、公司或工厂查找"
              autoFocus
            />
          </label>
          {query.trim() ? (
            <div className="mt-3 grid gap-2">
              {searchResults.length > 0 ? (
                searchResults.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    active={order.id === selected?.id}
                    onSelect={() => setSelectedId(order.id)}
                  />
                ))
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  未登记
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <Stat icon={Clock3} label="今日登记" value={stats.todayRegistered} />
          <Stat icon={ListChecks} label="本月订单" value={stats.monthRegistered} />
          <Stat icon={History} label="本年订单" value={stats.yearRegistered} />
          <Stat icon={FileDown} label="历史订单" value={stats.totalRegistered} />
          <Stat
            icon={CheckCircle2}
            label="今日出货"
            value={stats.todayWrittenOff}
          />
          <Stat icon={ListChecks} label="待核销" value={stats.open} />
          <Stat icon={Clock3} label="先交" value={stats.firstDeliveryOpen} />
          <Stat icon={Flame} label="急单" value={stats.urgentOpen} />
        </section>

        <section className="rounded-md border border-zinc-200 bg-white">
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ListChecks className="h-4 w-4 text-blue-700" aria-hidden="true" />
              待核销明细
            </div>
            <div className="text-xs font-medium text-zinc-500">
              订单 {stats.open} · 数量 {pendingQuantitySummary.quantity}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-zinc-200 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {pendingQuantitySummary.categories.map((item) => (
              <div
                key={item.key}
                className="flex min-h-16 items-center justify-start bg-white px-4 py-3"
              >
                <QuantityPair label={item.label} value={item.total} large />
              </div>
            ))}
            {pendingQuantitySummary.uncategorized > 0 ? (
              <div className="flex min-h-16 items-center justify-start bg-white px-4 py-3">
                <QuantityPair
                  label="未分细类"
                  value={pendingQuantitySummary.uncategorized}
                  large
                />
              </div>
            ) : null}
            <div className="flex min-h-16 items-center justify-start bg-blue-50 px-4 py-3">
              <QuantityPair
                label="数量小计"
                value={pendingQuantitySummary.quantity}
                large
                emphasis
              />
            </div>
          </div>
        </section>

        {notice ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-sm font-medium",
              notice.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {notice.message}
          </div>
        ) : null}

        {isPhoneMode ? (
          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-900">
            手机模式：搜索订单，点“出货核销”；登记和修改在办公室电脑操作。
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[440px_minmax(0,1fr)] xl:grid-cols-[520px_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            {!isPhoneMode ? (
              <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
                <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    登记并保存
                  </div>
                </div>
                <form
                  onSubmit={(event) =>
                    submit(event, createOrdersAction, "保存登记", true)
                  }
                  className="grid gap-3 p-4"
                >
                  <input type="hidden" name="registeredAt" value={today} />
                  <input type="hidden" name="quantity" value="1" />
                  <div className="overflow-x-auto rounded-md border border-zinc-300">
                    <div className="grid min-w-[430px] grid-cols-[1.35fr_repeat(5,56px)] bg-amber-50 text-center text-xs font-semibold text-zinc-700">
                      <div className="border-r border-b border-zinc-300 px-2 py-2">
                        订单号
                      </div>
                      {PRODUCT_COLUMNS.map((item) => (
                        <div
                          key={item.key}
                          className="border-r border-b border-zinc-300 px-2 py-2 last:border-r-0"
                        >
                          {item.label}
                        </div>
                      ))}
                    </div>
                    <div className="grid min-w-[430px] grid-cols-[1.35fr_repeat(5,56px)]">
                      <div className="border-r border-zinc-300">
                        <input
                          name="codes"
                          className={tableInputClass("font-semibold")}
                          placeholder="输入订单号"
                          required
                        />
                      </div>
                      {PRODUCT_COLUMNS.map((item) => (
                        <div
                          key={item.key}
                          className="border-r border-zinc-300 last:border-r-0"
                        >
                          <input
                            name={item.key}
                            type="number"
                            min={0}
                            inputMode="numeric"
                            defaultValue={0}
                            className={tableInputClass("text-center")}
                            aria-label={item.label}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="公司">
                      <OptionSelect
                        name="companyName"
                        options={companyOptions}
                        placeholder="选择公司"
                        required
                      />
                    </Field>
                    <Field label="工厂">
                      <OptionSelect
                        name="factoryName"
                        options={factoryOptions}
                        placeholder="选择工厂"
                      />
                    </Field>
                  </div>
                  <Field label="急单等级">
                    <UrgencySelect key={entryFormKey} name="urgency" />
                  </Field>
                  <div className="overflow-hidden rounded-md border border-orange-200">
                    <div className="flex items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-3 py-2">
                      <span className="text-sm font-semibold text-orange-950">
                        首批先交（没有可不填）
                      </span>
                      <span className="text-xs font-medium text-orange-800">
                        以后还能继续追加
                      </span>
                    </div>
                    <input type="hidden" name="deliveryDate" value={today} />
                    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
                      {PRODUCT_COLUMNS.map((item) => (
                        <Field key={item.key} label={item.label}>
                          <input
                            name={deliveryQuantityKeys[item.key]}
                            type="number"
                            min={0}
                            inputMode="numeric"
                            defaultValue={0}
                            className={fieldClass()}
                          />
                        </Field>
                      ))}
                    </div>
                    <div className="px-3 pb-3">
                      <Field label="首批先交备注">
                        <input
                          name="deliveryNote"
                          className={fieldClass()}
                          placeholder="可不填"
                        />
                      </Field>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-zinc-500">
                    登记日期 {today} 自动记录
                  </div>
                  <Field label="备注">
                    <textarea name="note" rows={3} className={textareaClass()} />
                  </Field>
                  <button
                    type="submit"
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    title="保存登记"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {busy === "保存登记" ? "保存中" : "保存到订单总表"}
                  </button>
                </form>
              </section>
            ) : null}

            {!isPhoneMode ? <PhoneAccessCard access={phoneAccess} /> : null}

            {!isPhoneMode ? (
              <ImportBackupCard busy={busy} onSubmit={submit} />
            ) : null}

            {!isPhoneMode && !cloudMode ? (
              <UpdateCard busy={busy} onSubmit={submit} />
            ) : null}

            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
                <Clock3 className="h-4 w-4 text-orange-700" />
                先交
              </div>
              <div>
                {firstDeliveryOrders.length > 0 ? (
                  firstDeliveryOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      active={order.id === selected?.id}
                      onSelect={() => setSelectedId(order.id)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-zinc-500">暂无</div>
                )}
              </div>
            </section>

            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                急单
              </div>
              <div>
                {urgentOrders.length > 0 ? (
                  urgentOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      active={order.id === selected?.id}
                      onSelect={() => setSelectedId(order.id)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-zinc-500">暂无</div>
                )}
              </div>
            </section>

            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                最近出货
              </div>
              <div>
                {recentWrittenOff.length > 0 ? (
                  recentWrittenOff.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      active={order.id === selected?.id}
                      onSelect={() => setSelectedId(order.id)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-zinc-500">暂无</div>
                )}
              </div>
            </section>

            <EventLogCard events={initialEvents} />
          </div>

          <div className="order-first grid content-start gap-3 lg:order-none">
            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
                <div className="text-sm font-semibold">订单详情</div>
                {selected ? (
                  <div className="flex flex-wrap gap-1">
                    <Badge className={statusTone[selected.status]}>
                      {statusLabels[selected.status]}
                    </Badge>
                    <Badge className={urgencyTone[selected.urgency]}>
                      {urgencyLabels[selected.urgency]}
                    </Badge>
                    {hasFirstDelivery(selected) ? (
                      <Badge className={firstDeliveryTone}>先交</Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {selected ? (
                isPhoneMode ? (
                  <MobileDetail
                    order={selected}
                    today={today}
                    busy={busy}
                    onSubmit={submit}
                  />
                ) : (
                <div className="hidden gap-3 p-3 md:grid">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <div className="break-all text-xl font-semibold text-zinc-950">
                      {selected.code}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span>登记 {selected.registeredAt}</span>
                      <span>出货 {dateText(selected.writtenOffAt)}</span>
                      {selected.returnedAt ? (
                        <span>返厂 {selected.returnedAt}</span>
                      ) : null}
                      <span>数量 {orderQuantity(selected)}</span>
                      {hasFirstDelivery(selected) ? (
                        <span className="font-medium text-orange-800">
                          剩余未交 {remainingTotal(selected)}
                        </span>
                      ) : null}
                      <span>更新 {formatDateTime(selected.updatedAt)}</span>
                    </div>
                  </div>

                  <form
                    key={selected.id}
                    onSubmit={(event) =>
                      submit(event, updateOrderAction, "保存")
                    }
                    className="grid gap-2"
                  >
                    <input type="hidden" name="id" value={selected.id} />
                    <input type="hidden" name="quantity" value={selected.quantity} />
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_140px_120px]">
                      <Field label="公司">
                        <OptionSelect
                          name="companyName"
                          options={companyOptions}
                          placeholder="选择公司"
                          value={selected.companyName}
                        />
                      </Field>
                      <Field label="工厂">
                        <OptionSelect
                          name="factoryName"
                          options={factoryOptions}
                          placeholder="选择工厂"
                          value={selected.factoryName}
                        />
                      </Field>
                      <Field label="登记日期">
                        <input
                          name="registeredAt"
                          type="date"
                          defaultValue={selected.registeredAt}
                          className={fieldClass()}
                        />
                      </Field>
                      <Field label="急单等级">
                        <UrgencySelect
                          name="urgency"
                          value={selected.urgency}
                        />
                      </Field>
                    </div>
                    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-y border-zinc-200 bg-zinc-50 px-3 py-1.5">
                      <span className="text-xs font-semibold text-zinc-600">
                        细分类数量
                      </span>
                      {PRODUCT_COLUMNS.map((item) => (
                        <label
                          key={item.key}
                          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600"
                        >
                          {item.label}
                          <input
                            name={item.key}
                            type="number"
                            min={0}
                            inputMode="numeric"
                            defaultValue={selected[item.key]}
                            className="h-8 w-12 border-0 border-b border-zinc-300 bg-transparent px-1 text-center text-sm font-semibold text-zinc-950 outline-none transition focus:border-blue-600 focus:ring-0"
                            aria-label={`${item.label}数量`}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-end">
                      <Field label="备注">
                        <textarea
                          name="note"
                          rows={2}
                          defaultValue={selected.note}
                          className={textareaClass()}
                        />
                      </Field>
                      <button
                        type="submit"
                        disabled={Boolean(busy)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-blue-300 disabled:bg-blue-300"
                        title="保存详情"
                      >
                        <Save className="h-4 w-4" aria-hidden="true" />
                        {busy === "保存" ? "保存中" : "保存"}
                      </button>
                    </div>
                  </form>

                  <DeliverySection
                    busy={busy}
                    editable
                    onSubmit={submit}
                    order={selected}
                    today={today}
                  />

                  {selected.status === "WRITTEN_OFF" ||
                  selected.status === "RETURNED" ? (
                    <ReturnOrderForm
                      busy={busy}
                      onSubmit={submit}
                      order={selected}
                      today={today}
                    />
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <form
                      onSubmit={(event) =>
                        submit(event, writeOffOrderAction, "核销")
                      }
                      className="grid gap-2 border-t border-emerald-100 pt-3"
                    >
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="writtenOffAt" value={today} />
                      <div className="text-sm text-zinc-600">
                        {selected.status === "RETURNED"
                          ? "完成返厂日期自动记录"
                          : "出货日期自动记录"}{" "}
                        {today}
                      </div>
                      <button
                        type="submit"
                        disabled={
                          Boolean(busy) || selected.status === "WRITTEN_OFF"
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                        title={
                          selected.status === "RETURNED" ? "完成返厂" : "出货核销"
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        {busy === "核销"
                          ? "核销中"
                          : writeOffLabel(selected.status)}
                      </button>
                    </form>
                    <form
                      onSubmit={(event) =>
                        submit(event, undoWriteOffOrderAction, "撤销")
                      }
                      className="grid content-end gap-2 border-t border-zinc-200 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0"
                    >
                      <input type="hidden" name="id" value={selected.id} />
                      <button
                        type="submit"
                        disabled={
                          Boolean(busy) || selected.status !== "WRITTEN_OFF"
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                        title="撤销核销"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        {busy === "撤销" ? "撤销中" : "撤销核销"}
                      </button>
                    </form>
                  </div>
                </div>
                )
              ) : (
                <div className="px-4 py-8 text-sm text-zinc-500">暂无记录</div>
              )}
            </section>

            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  订单总表
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={companyFilter}
                    onChange={(event) =>
                      setCompanyFilter(event.target.value as CompanyFilter)
                    }
                    className={filterSelectClass()}
                  >
                    <option value="ALL">全部公司</option>
                    <option value="UNASSIGNED">未选公司</option>
                    {companyOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    value={factoryFilter}
                    onChange={(event) =>
                      setFactoryFilter(event.target.value as FactoryFilter)
                    }
                    className={filterSelectClass()}
                  >
                    <option value="ALL">全部工厂</option>
                    <option value="UNASSIGNED">未选工厂</option>
                    {factoryOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as StatusFilter)
                    }
                    className={filterSelectClass(statusFilterTone(statusFilter))}
                  >
                    <option value="ALL">全部状态</option>
                    <option value="OPEN">未完成</option>
                    {ORDER_STATUSES.map((status) => (
                      <option
                        key={status}
                        value={status}
                        style={statusOptionStyle[status]}
                      >
                        {statusLabels[status]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={urgencyFilter}
                    onChange={(event) =>
                      setUrgencyFilter(event.target.value as UrgencyFilter)
                    }
                    className={filterSelectClass(
                      urgencyFilterTone(urgencyFilter),
                    )}
                  >
                    <option value="ALL">全部急度</option>
                    {[...URGENCY_LEVELS].reverse().map((level) => (
                      <option
                        key={level}
                        value={level}
                        style={urgencyOptionStyle[level]}
                      >
                        {urgencyLabels[level]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sortMode}
                    onChange={(event) =>
                      setSortMode(event.target.value as SortMode)
                    }
                    className={filterSelectClass()}
                    title="订单排序"
                  >
                    <option value="CODE_ASC">订单号小到大</option>
                    <option value="DATE_ASC">登记日期早到晚</option>
                    <option value="DATE_DESC">登记日期新到旧</option>
                  </select>
                </div>
              </div>
              <div className="hidden flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 px-4 py-3 text-sm md:flex">
                {accountSummary.categories.map((item) => (
                  <QuantityPair
                    key={item.key}
                    label={item.label}
                    value={item.total}
                  />
                ))}
                <QuantityPair
                  label="数量小计"
                  value={accountSummary.quantity}
                  emphasis
                />
              </div>
              <div className="max-h-[640px] overflow-auto">
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      active={order.id === selected?.id}
                      onSelect={() => setSelectedId(order.id)}
                    />
                  ))
                ) : (
                  <div className="px-4 py-8 text-sm text-zinc-500">暂无记录</div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
