import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  GitMerge,
  ShieldCheck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  applyCloudMigrationAction,
  createMigrationPreviewAction,
  rollbackLatestMigrationAction,
} from "@/app/migration-actions";
import { MigrationSubmitButton } from "@/app/migration/migration-submit-button";
import { requireAuthenticatedPage } from "@/lib/auth";
import {
  getMigrationPreview,
  getMigrationReport,
  getRecentMigrationReports,
  type MigrationDatabaseSummary,
  type MigrationDiffCategory,
  type MigrationPreview,
} from "@/lib/cloud-migration";
import { formatDateTime } from "@/lib/date";
import { isCloudDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";

const categoryLabels: Record<MigrationDiffCategory, string> = {
  source_only: "仅备份中有",
  cloud_only: "仅云端有",
  identical: "两边相同",
  local_changed: "仅本地有修改",
  cloud_changed: "仅云端有修改",
  conflict: "两边都有修改",
  unchanged_divergent: "保留的历史差异",
};

const categoryTones: Record<MigrationDiffCategory, string> = {
  source_only: "border-cyan-200 bg-cyan-50 text-cyan-900",
  cloud_only: "border-zinc-200 bg-zinc-100 text-zinc-800",
  identical: "border-emerald-200 bg-emerald-50 text-emerald-900",
  local_changed: "border-blue-200 bg-blue-50 text-blue-900",
  cloud_changed: "border-violet-200 bg-violet-50 text-violet-900",
  conflict: "border-red-200 bg-red-50 text-red-900",
  unchanged_divergent: "border-yellow-200 bg-yellow-50 text-yellow-900",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeMigrationReport(reportId: string | undefined) {
  if (!reportId) {
    return null;
  }
  try {
    return getMigrationReport(reportId);
  } catch {
    return null;
  }
}

function Summary({
  title,
  summary,
}: {
  title: string;
  summary: MigrationDatabaseSummary;
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{summary.orders}</div>
          <div className="text-xs text-zinc-500">订单</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{summary.deliveries}</div>
          <div className="text-xs text-zinc-500">交货记录</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{summary.events}</div>
          <div className="text-xs text-zinc-500">操作记录</div>
        </div>
        <div className="col-span-2 text-xs leading-5 text-zinc-600 sm:col-span-3">
          待核销 {summary.pending} · 部分交货 {summary.partial} · 已退回 {summary.returned} · 已核销 {summary.writtenOff}
        </div>
      </div>
    </section>
  );
}

function DifferenceSummary({ preview }: { preview: MigrationPreview }) {
  const categories = Object.keys(categoryLabels) as MigrationDiffCategory[];
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">差异检查</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {categories.map((category) => (
          <div
            key={category}
            className={`rounded-md border px-3 py-2 ${categoryTones[category]}`}
          >
            <div className="text-xl font-semibold tabular-nums">
              {preview.counts[category]}
            </div>
            <div className="text-xs leading-5">{categoryLabels[category]}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConflictChoices({ preview }: { preview: MigrationPreview }) {
  const conflicts = preview.diffs.filter((diff) => diff.category === "conflict");
  if (conflicts.length === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        没有需要人工决定的冲突订单。
      </div>
    );
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">
        冲突订单逐项选择（{conflicts.length}）
      </legend>
      {conflicts.map((diff) => (
        <div
          key={diff.id}
          className="grid gap-3 rounded-md border border-red-200 bg-red-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="break-words text-sm font-semibold text-zinc-950">
              {diff.companyName || "未选公司"} · {diff.code}
            </div>
            <div className="mt-1 text-xs leading-5 text-zinc-600">
              本地 {diff.sourceUpdatedAt ? formatDateTime(diff.sourceUpdatedAt) : "无时间"} · 云端 {diff.cloudUpdatedAt ? formatDateTime(diff.cloudUpdatedAt) : "无时间"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium">
              <input
                type="radio"
                name={`resolution-${diff.id}`}
                value="source"
                required
              />
              采用本地
            </label>
            <label className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium">
              <input
                type="radio"
                name={`resolution-${diff.id}`}
                value="cloud"
                required
              />
              保留云端
            </label>
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function RecentReports() {
  const reports = getRecentMigrationReports(8);
  if (reports.length === 0) {
    return null;
  }
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        最近迁移
      </h2>
      <div className="mt-3 divide-y divide-zinc-100">
        {reports.map((report, index) => (
          <div key={report.id} className="grid gap-3 py-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{report.sourceFilename}</div>
                <div className="text-xs text-zinc-500">
                  {report.mode === "replace" ? "完整替换" : "安全合并"} · {formatDateTime(report.completedAt)}
                  {report.rolledBackAt
                    ? ` · 已于 ${formatDateTime(report.rolledBackAt)} 回滚`
                    : ""}
                </div>
              </div>
              <div className="text-xs font-medium text-zinc-700">
                {report.cloudOrdersBefore} → {report.cloudOrdersAfter} 单
              </div>
            </div>
            {index === 0 && !report.rolledBackAt ? (
              <details className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-red-800">
                  回滚最近一次迁移
                </summary>
                <form
                  action={rollbackLatestMigrationAction}
                  className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                >
                  <input type="hidden" name="reportId" value={report.id} />
                  <label className="grid gap-1.5 text-xs font-medium text-red-900">
                    输入“回滚迁移”确认；恢复前会再备份当前云端数据
                    <input
                      name="confirmation"
                      autoComplete="off"
                      className="h-10 rounded-md border border-red-300 bg-white px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                      required
                    />
                  </label>
                  <MigrationSubmitButton
                    label="确认回滚"
                    pendingLabel="正在备份并回滚"
                    danger
                  />
                </form>
              </details>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function MigrationPage({
  searchParams,
}: {
  searchParams: Promise<{
    session?: string;
    result?: string;
    rollback?: string;
    error?: string;
  }>;
}) {
  await requireAuthenticatedPage();
  if (!isCloudDeployment()) {
    redirect("/");
  }

  const params = await searchParams;
  let preview: MigrationPreview | null = null;
  let pageError = params.error ?? "";
  if (params.session) {
    try {
      preview = getMigrationPreview(params.session);
    } catch (error) {
      pageError = error instanceof Error ? error.message : "无法读取迁移预览";
    }
  }
  const report = safeMigrationReport(params.result);
  const rollbackReport = safeMigrationReport(params.rollback);
  const replaceBlocked = Boolean(
    preview && preview.source.orders === 0 && preview.cloud.orders > 0,
  );

  return (
    <main className="min-h-screen bg-zinc-100 px-3 py-4 text-zinc-950 sm:px-5 sm:py-6">
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              仅管理员
            </div>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">云端数据迁移</h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回订单
          </Link>
        </header>

        {pageError ? (
          <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="break-words">{pageError}</span>
          </div>
        ) : null}

        {report ? (
          <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              迁移完成，完整性检查通过
            </div>
            <div className="mt-2 text-sm leading-6">
              云端订单 {report.cloudOrdersBefore} → {report.cloudOrdersAfter}；新增 {report.created}，采用本地更新 {report.updatedFromSource}，保留云端 {report.keptCloud}。迁移前备份：{report.backupFilename}
            </div>
          </section>
        ) : null}

        {rollbackReport?.rolledBackAt ? (
          <section className="rounded-md border border-yellow-200 bg-yellow-50 p-4 text-yellow-950">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              已恢复到迁移前的数据
            </div>
            <div className="mt-2 text-sm leading-6">
              回滚前的云端状态也已另存为 {rollbackReport.rollbackBackupFilename}。
            </div>
          </section>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 font-semibold">
            <Upload className="h-5 w-5" aria-hidden="true" />
            上传本地数据库备份
          </div>
          <form action={createMigrationPreviewAction} className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-zinc-700">
              .db 文件
              <input
                name="databaseFile"
                type="file"
                accept=".db,application/octet-stream,application/x-sqlite3"
                required
                className="block min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white text-sm text-zinc-700 file:mr-3 file:min-h-10 file:border-0 file:bg-zinc-950 file:px-3 file:text-sm file:font-medium file:text-white"
              />
            </label>
            <MigrationSubmitButton label="检查备份" pendingLabel="正在检查" />
          </form>
          <div className="mt-3 flex gap-2 text-xs leading-5 text-zinc-500">
            <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            上传只生成预览，不会立即改动云端订单。请使用本地软件“数据工具”下载的数据库备份。
          </div>
        </section>

        {preview ? (
          <>
            <section className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{preview.sourceFilename}</div>
                  <div className="mt-1 break-all text-xs text-zinc-500">
                    {formatBytes(preview.sourceFileSize)} · SHA-256 {preview.sourceSha256.slice(0, 16)}… · 原版本 {preview.originalSchemaVersion}
                  </div>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  数据库完整
                </div>
              </div>
            </section>

            {preview.alreadyImported ? (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-900">
                这份备份已经迁移过，系统已禁止重复执行。
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Summary title="上传的本地备份" summary={preview.source} />
              <Summary title="当前云端数据库" summary={preview.cloud} />
            </div>
            <DifferenceSummary preview={preview} />

            {!preview.alreadyImported ? (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <section className="rounded-md border border-zinc-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <GitMerge className="h-5 w-5" aria-hidden="true" />
                    安全合并
                  </div>
                  <div className="mt-2 text-sm leading-6 text-zinc-600">
                    自动加入仅本地存在的订单；只改过本地的采用本地；只改过云端的保留云端；两边都改过的订单由你逐项选择。
                  </div>
                  <form action={applyCloudMigrationAction} className="mt-4 grid gap-4">
                    <input type="hidden" name="sessionId" value={preview.sessionId} />
                    <input type="hidden" name="mode" value="merge" />
                    <ConflictChoices preview={preview} />
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      输入“安全合并”确认
                      <input
                        name="confirmation"
                        autoComplete="off"
                        className="h-11 rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
                        required
                      />
                    </label>
                    <MigrationSubmitButton label="开始安全合并" pendingLabel="正在合并并校验" />
                  </form>
                </section>

                <section className="rounded-md border border-red-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-semibold text-red-800">
                    <Database className="h-5 w-5" aria-hidden="true" />
                    完整替换
                  </div>
                  <div className="mt-2 text-sm leading-6 text-zinc-600">
                    用上传的备份整体替换云端数据库。适合首次上线且确认本地备份是唯一准确信息源的情况，现有云端订单不会参与合并。
                  </div>
                  {replaceBlocked ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                      备份中没有订单，已禁止覆盖有订单的云端数据库。
                    </div>
                  ) : (
                    <form action={applyCloudMigrationAction} className="mt-4 grid gap-4">
                      <input type="hidden" name="sessionId" value={preview.sessionId} />
                      <input type="hidden" name="mode" value="replace" />
                      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                        输入“完整替换”确认
                        <input
                          name="confirmation"
                          autoComplete="off"
                          className="h-11 rounded-md border border-red-300 px-3 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                          required
                        />
                      </label>
                      <MigrationSubmitButton
                        label="完整替换云端数据"
                        pendingLabel="正在备份并替换"
                        danger
                      />
                    </form>
                  )}
                </section>
              </div>
            ) : null}
          </>
        ) : null}

        <RecentReports />
      </div>
    </main>
  );
}
