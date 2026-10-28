import { ArrowLeft, BarChart3, CheckCircle2, Clock3, ListChecks } from "lucide-react";
import Link from "next/link";

import { requireAuthenticatedPage } from "@/lib/auth";
import { formatDateTime } from "@/lib/date";
import { getMonthlyOrderStatistics, listOrders } from "@/lib/db";
import { statusLabels } from "@/lib/types";

export const dynamic = "force-dynamic";

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return year && month ? `${year}年${Number(month)}月` : value;
}

function statusTone(status: string) {
  if (status === "WRITTEN_OFF") return "text-emerald-700";
  if (status === "PARTIAL") return "text-amber-700";
  if (status === "RETURNED") return "text-violet-700";
  return "text-zinc-700";
}

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAuthenticatedPage();

  const monthly = getMonthlyOrderStatistics();
  const requestedMonth = (await searchParams).month ?? "";
  const selectedMonth =
    /^\d{4}-\d{2}$/u.test(requestedMonth) &&
    monthly.some((item) => item.month === requestedMonth)
      ? requestedMonth
      : monthly[0]?.month ?? "";
  const selectedSummary = monthly.find((item) => item.month === selectedMonth);
  const orders = selectedMonth ? listOrders(selectedMonth) : [];

  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-4 text-zinc-950 sm:px-5 sm:py-6">
      <div className="mx-auto grid w-full max-w-6xl gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              订单统计
            </div>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">按月份查询登记数量</h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回订单
          </Link>
        </header>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
              选择登记月份
              <select
                name="month"
                defaultValue={selectedMonth}
                className="h-10 min-w-48 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-950"
              >
                {monthly.length === 0 ? <option value="">暂无登记数据</option> : null}
                {monthly.map((item) => (
                  <option key={item.month} value={item.month}>
                    {monthLabel(item.month)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              查询
            </button>
          </form>
        </section>

        {selectedSummary ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard icon={ListChecks} label="登记订单数" value={selectedSummary.orderCount} />
              <SummaryCard icon={BarChart3} label="登记数量总计" value={selectedSummary.quantity} />
              <SummaryCard icon={Clock3} label="未核销订单" value={selectedSummary.pendingOrders + selectedSummary.partialOrders} detail={`待核销 ${selectedSummary.pendingOrders} · 已先交 ${selectedSummary.partialOrders}`} />
              <SummaryCard icon={CheckCircle2} label="已核销订单" value={selectedSummary.writtenOffOrders} detail={`返厂 ${selectedSummary.returnedOrders} · 已核销 ${selectedSummary.writtenOffOrders}`} />
            </section>

            <section className="overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
                <div className="font-semibold">{monthLabel(selectedMonth)}登记明细</div>
                <div className="text-xs text-zinc-500">共 {orders.length} 笔订单</div>
              </div>
              {orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-zinc-50 text-xs text-zinc-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">订单号</th>
                        <th className="px-4 py-3 font-medium">公司</th>
                        <th className="px-4 py-3 font-medium">工厂</th>
                        <th className="px-4 py-3 font-medium">登记日期</th>
                        <th className="px-4 py-3 text-right font-medium">数量</th>
                        <th className="px-4 py-3 font-medium">状态</th>
                        <th className="px-4 py-3 font-medium">最后更新</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {orders.map((order) => (
                        <tr key={order.id}>
                          <td className="px-4 py-3 font-semibold">{order.code}</td>
                          <td className="px-4 py-3">{order.companyName || "-"}</td>
                          <td className="px-4 py-3">{order.factoryName || "-"}</td>
                          <td className="px-4 py-3">{order.registeredAt}</td>
                          <td className="px-4 py-3 text-right font-medium">{order.quantity}</td>
                          <td className={`px-4 py-3 font-medium ${statusTone(order.status)}`}>
                            {statusLabels[order.status]}
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500">{formatDateTime(order.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-zinc-500">这个月份没有登记记录。</div>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-md border border-zinc-200 bg-white px-4 py-8 text-sm text-zinc-500">
            还没有可统计的登记数据。
          </section>
        )}

        <section className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          数量按订单登记时的数量统计；同一公司重复登记相同订单号会分别计为独立订单。
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {detail ? <div className="mt-1 text-xs text-zinc-500">{detail}</div> : null}
    </div>
  );
}
