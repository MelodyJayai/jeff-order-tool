import {
  ArrowLeft,
  CheckCircle2,
  Database,
  HardDrive,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { requireAuthenticatedPage, getAdminPasswordSource } from "@/lib/auth";
import { formatDateTime } from "@/lib/date";
import { getBackupSummary, getDatabaseSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

function sizeText(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateTimeText(value: string | null) {
  return value ? formatDateTime(value) : "暂无";
}

function StatusCard({
  icon: Icon,
  label,
  lines,
}: {
  icon: typeof CheckCircle2;
  label: string;
  lines: string[];
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <Icon className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        {label}
      </div>
      <div className="grid gap-2 p-4 text-sm">
        {lines.map((line) => (
          <div key={line} className="break-all text-zinc-700">
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function HealthPage() {
  await requireAuthenticatedPage();

  const database = getDatabaseSummary();
  const backup = getBackupSummary();

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
            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            工具状态正常
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <StatusCard
            icon={ShieldCheck}
            label="登录保护"
            lines={[
              "状态：已开启",
              `管理员密码来源：${getAdminPasswordSource()}`,
              "电脑和手机访问都需要先登录。",
            ]}
          />
          <StatusCard
            icon={Database}
            label="数据库"
            lines={[
              database.exists ? "状态：正常" : "状态：未找到数据库文件",
              `订单数量：${database.orders}`,
              `操作日志：${database.events}`,
              `结构版本：${database.schemaVersion}`,
              `数据库大小：${sizeText(database.sizeBytes)}`,
              `最近更新：${dateTimeText(database.updatedAt)}`,
            ]}
          />
          <StatusCard
            icon={HardDrive}
            label="自动备份"
            lines={[
              `备份数量：${backup.files.length}`,
              `最近备份：${backup.latest ? dateTimeText(backup.latest.createdAt) : "暂无"}`,
              `最近每日备份日期：${backup.lastDailyBackupDate ?? "暂无"}`,
              `保留天数：${backup.retentionDays} 天`,
              `备份目录：${backup.directory}`,
            ]}
          />
          <StatusCard
            icon={CheckCircle2}
            label="使用建议"
            lines={[
              "导入 CSV 前系统会自动备份。",
              "每次打开工具会检查当天是否已有每日备份。",
              "云端正式开放前继续保留登录和 HTTPS。",
            ]}
          />
        </div>
      </div>
    </main>
  );
}
