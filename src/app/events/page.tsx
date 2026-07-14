import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";

import { formatDateTime } from "@/lib/date";
import { requireAuthenticatedPage } from "@/lib/auth";
import { listOrderEvents } from "@/lib/db";
import type { OrderEventType } from "@/lib/types";

export const dynamic = "force-dynamic";

const eventLabels: Record<OrderEventType, string> = {
  CREATED: "登记",
  UPDATED: "更新",
  DELIVERY_REQUEST_UPDATED: "先交要求",
  DELIVERY_REQUEST_CLEARED: "清除要求",
  PARTIAL: "部分交付",
  FIRST_DELIVERY: "实际交货",
  FIRST_DELIVERY_REMOVED: "撤销交货",
  RETURNED: "返厂修改",
  WRITTEN_OFF: "出货核销",
  RETURN_RESOLVED: "完成返厂",
  UNDO_WRITTEN_OFF: "撤销核销",
};

const eventTone: Record<OrderEventType, string> = {
  CREATED: "border-zinc-200 bg-zinc-50 text-zinc-700",
  UPDATED: "border-blue-200 bg-blue-50 text-blue-800",
  DELIVERY_REQUEST_UPDATED: "border-orange-200 bg-orange-50 text-orange-800",
  DELIVERY_REQUEST_CLEARED: "border-amber-200 bg-amber-50 text-amber-800",
  PARTIAL: "border-cyan-200 bg-cyan-50 text-cyan-800",
  FIRST_DELIVERY: "border-cyan-200 bg-cyan-50 text-cyan-800",
  FIRST_DELIVERY_REMOVED: "border-amber-200 bg-amber-50 text-amber-800",
  RETURNED: "border-violet-200 bg-violet-50 text-violet-800",
  WRITTEN_OFF: "border-emerald-200 bg-emerald-50 text-emerald-800",
  RETURN_RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  UNDO_WRITTEN_OFF: "border-amber-200 bg-amber-50 text-amber-800",
};

export default async function EventsPage() {
  await requireAuthenticatedPage();

  const events = listOrderEvents(500);

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-4 sm:px-6">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回
          </Link>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <History className="h-4 w-4" aria-hidden="true" />
            操作日志
          </div>
        </div>

        <section className="rounded-md border border-zinc-200 bg-white">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div className="text-sm font-semibold">最近 500 条操作</div>
            <div className="text-xs text-zinc-500">{events.length} 条</div>
          </div>
          <div className="divide-y divide-zinc-100">
            {events.length > 0 ? (
              events.map((event) => (
                <div
                  key={event.id}
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_112px_136px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-zinc-950">
                      {event.orderCode || "未知订单"}
                    </div>
                    {event.detail ? (
                      <div className="mt-1 break-words text-xs text-zinc-600">
                        {event.detail}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <span
                      className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium ${eventTone[event.type]}`}
                    >
                      {eventLabels[event.type]}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 sm:text-right">
                    {formatDateTime(event.createdAt)}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-10 text-sm text-zinc-500">暂无记录</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
