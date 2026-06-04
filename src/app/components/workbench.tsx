"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  Flame,
  History,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Upload,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useMemo, useState, useSyncExternalStore } from "react";

import {
  createOrdersAction,
  importCsvAction,
  undoWriteOffOrderAction,
  updateOrderAction,
  writeOffOrderAction,
} from "@/app/actions";
import {
  PRODUCT_COLUMNS,
  calculateTotalQuantity,
  productSummary,
} from "@/lib/catalog";
import { formatDateTime } from "@/lib/date";
import {
  type ActionResult,
  type OrderEventRecord,
  type OrderRecord,
  type OrderStatus,
  type UrgencyLevel,
  statusLabels,
  urgencyLabels,
} from "@/lib/types";

type WorkbenchProps = {
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
type StatusFilter = "ALL" | "OPEN" | OrderStatus;
type UrgencyFilter = "ALL" | UrgencyLevel;
const MOBILE_QUERY = "(max-width: 767px)";

const urgencyWeight: Record<UrgencyLevel, number> = {
  VERY_URGENT: 0,
  URGENT: 1,
  NORMAL: 2,
};

const statusTone: Record<OrderStatus, string> = {
  PENDING: "border-zinc-200 bg-zinc-100 text-zinc-700",
  PARTIAL: "border-cyan-200 bg-cyan-50 text-cyan-800",
  WRITTEN_OFF: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const urgencyTone: Record<UrgencyLevel, string> = {
  NORMAL: "border-zinc-200 bg-white text-zinc-600",
  URGENT: "border-amber-200 bg-amber-50 text-amber-800",
  VERY_URGENT: "border-red-200 bg-red-50 text-red-800",
};

const eventLabels = {
  CREATED: "登记",
  UPDATED: "更新",
  PARTIAL: "部分交付",
  WRITTEN_OFF: "出货核销",
  UNDO_WRITTEN_OFF: "撤销核销",
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
  return status === "WRITTEN_OFF" ? "已出货" : "出货核销";
}

function dateText(value: string | null) {
  return value || "-";
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

function orderMatches(order: OrderRecord, query: string) {
  const q = query.trim().toLowerCase();

  if (!q) {
    return true;
  }

  return [
    order.code,
    order.customerName,
    order.note,
    order.partialNote,
  ].some((value) => value.toLowerCase().includes(q));
}

function sortByUrgency(a: OrderRecord, b: OrderRecord) {
  return (
    urgencyWeight[a.urgency] - urgencyWeight[b.urgency] ||
    a.registeredAt.localeCompare(b.registeredAt) ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

function fieldClass() {
  return "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200";
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
          手机访问
        </div>
        <div className="p-4 text-sm text-zinc-500">
          未检测到办公室 Wi-Fi 地址。
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
        手机访问
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
          手机和电脑连同一个 Wi-Fi，扫码打开。
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
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    action: ServerAction,
    busyLabel: string,
    reset?: boolean,
  ) => Promise<void>;
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
      </div>
    </section>
  );
}

function EventLogCard({ events }: { events: OrderEventRecord[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <History className="h-4 w-4" aria-hidden="true" />
        最近操作
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
          <div className="truncate text-sm font-semibold text-zinc-950">
            {order.code}
          </div>
          <div className="mt-1 truncate text-xs text-zinc-500">
            {order.customerName || "未填写客户"}
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
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>登记 {order.registeredAt}</span>
        <span>出货 {dateText(order.writtenOffAt)}</span>
        <span>数量 {orderQuantity(order)}</span>
        {summary ? <span>{summary}</span> : null}
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
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    action: ServerAction,
    busyLabel: string,
    reset?: boolean,
  ) => Promise<void>;
}) {
  const summary = productSummary(order);

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
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-zinc-500">客户</span>
          <span className="text-right font-medium text-zinc-950">
            {order.customerName || "未填写"}
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
              className="flex items-center justify-between gap-3"
            >
              <span className="text-zinc-500">{item.label}</span>
              <span className="font-semibold text-zinc-950">
                {order[item.key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {summary || order.partialQuantity || order.partialDate || order.partialNote ? (
        <div className="grid gap-2 text-sm">
          {summary ? (
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">摘要</span>
              <span className="text-right font-medium text-zinc-950">
                {summary}
              </span>
            </div>
          ) : null}
          {order.partialQuantity ? (
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">部分交付数量</span>
              <span className="font-medium text-zinc-950">
                {order.partialQuantity}
              </span>
            </div>
          ) : null}
          {order.partialDate ? (
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">部分交付日期</span>
              <span className="font-medium text-zinc-950">
                {order.partialDate}
              </span>
            </div>
          ) : null}
          {order.partialNote ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700">
              {order.partialNote}
            </div>
          ) : null}
        </div>
      ) : null}

      {order.note ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {order.note}
        </div>
      ) : null}

      <form
        onSubmit={(event) => onSubmit(event, writeOffOrderAction, "核销")}
        className="border-t border-emerald-100 pt-3"
      >
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="writtenOffAt" value={today} />
        <button
          type="submit"
          disabled={Boolean(busy) || order.status === "WRITTEN_OFF"}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
          title="出货核销"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {busy === "核销" ? "核销中" : writeOffLabel(order.status)}
        </button>
      </form>
    </div>
  );
}

export function Workbench({
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
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const exactMatch = query.trim()
    ? orders.find(
        (order) => order.code.toLowerCase() === query.trim().toLowerCase(),
      )
    : null;
  const selected =
    exactMatch ??
    orders.find((order) => order.id === selectedId) ??
    orders[0] ??
    null;

  const stats = useMemo(
    () => ({
      todayRegistered: orders.filter((order) => order.registeredAt === today)
        .length,
      todayQuantity: orders
        .filter((order) => order.registeredAt === today)
        .reduce((total, order) => total + orderQuantity(order), 0),
      todayWrittenOff: orders.filter((order) => order.writtenOffAt === today)
        .length,
      open: orders.filter((order) => order.status !== "WRITTEN_OFF").length,
      partial: orders.filter((order) => order.status === "PARTIAL").length,
      urgentOpen: orders.filter(
        (order) =>
          order.status !== "WRITTEN_OFF" && order.urgency !== "NORMAL",
      ).length,
    }),
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

  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => orderMatches(order, query))
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
        if (a.status !== "WRITTEN_OFF" && b.status !== "WRITTEN_OFF") {
          return sortByUrgency(a, b);
        }
        if (a.status !== b.status) {
          return a.status === "WRITTEN_OFF" ? 1 : -1;
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [orders, query, statusFilter, urgencyFilter]);

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

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: ServerAction,
    busyLabel: string,
    reset = false,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(busyLabel);

    try {
      const actionResult = await action(new FormData(form));
      setNotice(actionResult);

      if (actionResult.ok && reset) {
        form.reset();
      }

      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const headers = [
      "号码",
      "客户",
      "套装",
      "单衫",
      "单裤",
      "马甲",
      "大衣",
      "数量小计",
      "登记日期",
      "状态",
      "出货日期",
      "急单等级",
      "部分交付数量",
      "部分交付日期",
      "部分交付备注",
      "备注",
    ];
    const rows = filteredOrders.map((order) => [
      order.code,
      order.customerName,
      String(order.suitQuantity),
      String(order.jacketQuantity),
      String(order.pantQuantity),
      String(order.vestQuantity),
      String(order.coatQuantity),
      String(orderQuantity(order)),
      order.registeredAt,
      statusLabels[order.status],
      order.writtenOffAt ?? "",
      urgencyLabels[order.urgency],
      order.partialQuantity ? String(order.partialQuantity) : "",
      order.partialDate ?? "",
      order.partialNote,
      order.note,
    ]);
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
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
              title="导出当前列表"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              导出
            </button>
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
              placeholder="输入订单号查找"
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

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Clock3} label="今日登记" value={stats.todayRegistered} />
          <Stat
            icon={CheckCircle2}
            label="今日出货"
            value={stats.todayWrittenOff}
          />
          <Stat icon={ListChecks} label="待核销" value={stats.open} />
          <Stat icon={Flame} label="急单" value={stats.urgentOpen} />
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

        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
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
                  <Field label="订单号">
                    <input
                      name="codes"
                      className={fieldClass()}
                      placeholder="输入订单号"
                      required
                    />
                  </Field>
                  <input type="hidden" name="registeredAt" value={today} />
                  <input type="hidden" name="quantity" value="1" />
                  <div className="rounded-md border border-zinc-200">
                    <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">
                      登记日期 {today} 自动记录
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                      {PRODUCT_COLUMNS.map((item) => (
                        <Field key={item.key} label={item.label}>
                          <input
                            name={item.key}
                            type="number"
                            min={0}
                            inputMode="numeric"
                            defaultValue={0}
                            className={fieldClass()}
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                  <Field label="客户">
                    <input
                      name="customerName"
                      className={fieldClass()}
                      placeholder="可不填"
                    />
                  </Field>
                  <Field label="急单等级">
                    <select name="urgency" className={fieldClass()}>
                      <option value="NORMAL">普通</option>
                      <option value="URGENT">比较急</option>
                      <option value="VERY_URGENT">最急</option>
                    </select>
                  </Field>
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

          <div className="order-first grid content-start gap-4 lg:order-none">
            <section className="rounded-md border border-zinc-200 bg-white">
              <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
                <div className="text-sm font-semibold">订单详情</div>
                {selected ? (
                  <div className="flex flex-wrap gap-1">
                    <Badge className={statusTone[selected.status]}>
                      {statusLabels[selected.status]}
                    </Badge>
                    <Badge className={urgencyTone[selected.urgency]}>
                      {urgencyLabels[selected.urgency]}
                    </Badge>
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
                <div className="hidden gap-4 p-4 md:grid">
                  <div className="grid gap-1">
                    <div className="break-all text-2xl font-semibold text-zinc-950">
                      {selected.code}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
                      <span>登记 {selected.registeredAt}</span>
                      <span>出货 {dateText(selected.writtenOffAt)}</span>
                      <span>数量 {orderQuantity(selected)}</span>
                      <span>更新 {formatDateTime(selected.updatedAt)}</span>
                    </div>
                  </div>

                  <form
                    key={selected.id}
                    onSubmit={(event) =>
                      submit(event, updateOrderAction, "保存")
                    }
                    className="grid gap-3"
                  >
                    <input type="hidden" name="id" value={selected.id} />
                    <input type="hidden" name="quantity" value={selected.quantity} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="登记日期">
                        <input
                          name="registeredAt"
                          type="date"
                          defaultValue={selected.registeredAt}
                          className={fieldClass()}
                        />
                      </Field>
                      <Field label="客户">
                        <input
                          name="customerName"
                          defaultValue={selected.customerName}
                          className={fieldClass()}
                        />
                      </Field>
                      <Field label="急单等级">
                        <select
                          name="urgency"
                          defaultValue={selected.urgency}
                          className={fieldClass()}
                        >
                          <option value="NORMAL">普通</option>
                          <option value="URGENT">比较急</option>
                          <option value="VERY_URGENT">最急</option>
                        </select>
                      </Field>
                    </div>
                    <div className="rounded-md border border-zinc-200">
                      <div className="border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600">
                        细分类数量
                      </div>
                      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                        {PRODUCT_COLUMNS.map((item) => (
                          <Field key={item.key} label={item.label}>
                            <input
                              name={item.key}
                              type="number"
                              min={0}
                              inputMode="numeric"
                              defaultValue={selected[item.key]}
                              className={fieldClass()}
                            />
                          </Field>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="部分交付数量">
                        <input
                          name="partialQuantity"
                          type="number"
                          min={1}
                          defaultValue={selected.partialQuantity ?? ""}
                          className={fieldClass()}
                        />
                      </Field>
                      <Field label="部分交付日期">
                        <input
                          name="partialDate"
                          type="date"
                          defaultValue={selected.partialDate ?? ""}
                          className={fieldClass()}
                        />
                      </Field>
                    </div>
                    <Field label="部分交付备注">
                      <textarea
                        name="partialNote"
                        rows={2}
                        defaultValue={selected.partialNote}
                        className={textareaClass()}
                      />
                    </Field>
                    <Field label="备注">
                      <textarea
                        name="note"
                        rows={3}
                        defaultValue={selected.note}
                        className={textareaClass()}
                      />
                    </Field>
                    <button
                      type="submit"
                      disabled={Boolean(busy)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                      title="保存详情"
                    >
                      <Save className="h-4 w-4" aria-hidden="true" />
                      {busy === "保存" ? "保存中" : "保存"}
                    </button>
                  </form>

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
                        出货日期自动记录 {today}
                      </div>
                      <button
                        type="submit"
                        disabled={
                          Boolean(busy) || selected.status === "WRITTEN_OFF"
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                        title="出货核销"
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
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as StatusFilter)
                    }
                    className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  >
                    <option value="ALL">全部状态</option>
                    <option value="OPEN">未完成</option>
                    <option value="PENDING">待核销</option>
                    <option value="PARTIAL">部分交付</option>
                    <option value="WRITTEN_OFF">已核销</option>
                  </select>
                  <select
                    value={urgencyFilter}
                    onChange={(event) =>
                      setUrgencyFilter(event.target.value as UrgencyFilter)
                    }
                    className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
                  >
                    <option value="ALL">全部急度</option>
                    <option value="VERY_URGENT">最急</option>
                    <option value="URGENT">比较急</option>
                    <option value="NORMAL">普通</option>
                  </select>
                </div>
              </div>
              <div className="hidden gap-2 border-b border-zinc-200 px-4 py-3 text-sm md:grid md:grid-cols-3 xl:grid-cols-6">
                {accountSummary.categories.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-zinc-500">{item.label}</span>
                    <span className="font-semibold text-zinc-950">
                      {item.total}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">数量小计</span>
                  <span className="font-semibold text-zinc-950">
                    {accountSummary.quantity}
                  </span>
                </div>
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
