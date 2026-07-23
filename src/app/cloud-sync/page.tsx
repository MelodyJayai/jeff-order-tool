import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CloudUpload,
  KeyRound,
  Link2,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createCloudSyncPairingAction,
  revokeCloudSyncDeviceAction,
} from "@/app/cloud-sync-actions";
import { MigrationSubmitButton } from "@/app/migration/migration-submit-button";
import { requireAuthenticatedPage } from "@/lib/auth";
import { getCloudSyncAdminState } from "@/lib/cloud-sync-store";
import { formatDateTime } from "@/lib/date";
import {
  isCloudDeployment,
  isCloudWriteProtected,
} from "@/lib/deployment";
import { getLanAccessUrls } from "@/lib/network";

export const dynamic = "force-dynamic";

const attemptLabels = {
  processing: "正在合并",
  conflict: "等待处理",
  applied: "同步完成",
  already_synced: "已经同步",
  failed: "同步失败",
  rolled_back: "已经回滚",
} as const;

const attemptTones = {
  processing: "text-blue-700",
  conflict: "text-red-700",
  applied: "text-emerald-700",
  already_synced: "text-emerald-700",
  failed: "text-red-700",
  rolled_back: "text-yellow-800",
} as const;

export default async function CloudSyncPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    expires?: string;
    revoked?: string;
  }>;
}) {
  await requireAuthenticatedPage();
  if (!isCloudDeployment()) {
    redirect("/");
  }

  const params = await searchParams;
  const state = getCloudSyncAdminState();
  const publicUrl = getLanAccessUrls()[0] ?? "";
  const pairingCode = /^\d{6}$/u.test(params.code ?? "")
    ? params.code ?? ""
    : "";
  const activeDevices = state.devices.filter((device) => !device.revokedAt);
  const conflictAttempts = state.attempts.filter(
    (attempt) => attempt.status === "conflict",
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
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
              离线版同步管理
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回订单
          </Link>
        </header>

        <section
          className={`rounded-md border px-4 py-3 text-sm ${
            isCloudWriteProtected()
              ? "border-cyan-200 bg-cyan-50 text-cyan-950"
              : "border-yellow-200 bg-yellow-50 text-yellow-950"
          }`}
        >
          <div className="font-semibold">
            {isCloudWriteProtected()
              ? "当前为过渡期只读模式"
              : "当前允许直接修改云端订单"}
          </div>
          <div className="mt-1 leading-6">
            {isCloudWriteProtected()
              ? "Jeff 在本地电脑录入，云端供手机查询并接收安全同步。"
              : "两端同时修改同一张订单可能产生冲突；正式切换前建议启用 JEFF_CLOUD_SYNC_READ_ONLY=true。"}
          </div>
        </section>

        {params.revoked ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
            这台电脑的同步授权已经撤销。
          </div>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
            连接 Jeff 的离线版
          </div>
          <div className="mt-2 text-sm leading-6 text-zinc-600">
            在 Jeff 电脑的“云端同步”中填写服务器地址和一次性配对码。配对码十五分钟内有效，使用一次后立即作废。
          </div>

          {pairingCode ? (
            <div className="mt-4 grid gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="text-xs font-medium text-emerald-800">
                  服务器地址
                </div>
                <div className="mt-1 break-all font-medium">{publicUrl || "请先配置 JEFF_PUBLIC_URL"}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-emerald-800">
                  一次性配对码
                </div>
                <div className="mt-1 font-mono text-3xl font-semibold tracking-normal">
                  {pairingCode.slice(0, 3)} {pairingCode.slice(3)}
                </div>
                <div className="mt-1 text-xs text-emerald-800">
                  有效至 {params.expires ? formatDateTime(params.expires) : "十五分钟后"}
                </div>
              </div>
            </div>
          ) : state.pairing ? (
            <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              已有一个尚未过期的配对码。出于安全原因不能再次显示原码；需要时可直接生成新码，旧码会失效。
            </div>
          ) : null}

          <form action={createCloudSyncPairingAction} className="mt-4">
            <MigrationSubmitButton
              label={pairingCode ? "重新生成配对码" : "生成一次性配对码"}
              pendingLabel="正在生成"
            />
          </form>
        </section>

        {conflictAttempts.length > 0 ? (
          <section className="rounded-md border border-red-200 bg-white p-4">
            <div className="flex items-center gap-2 font-semibold text-red-800">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              有 {conflictAttempts.length} 次同步等待确认
            </div>
            <div className="mt-3 divide-y divide-red-100">
              {conflictAttempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {attempt.sourceFilename} · {attempt.conflictCount} 张冲突订单
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {formatDateTime(attempt.createdAt)} · 云端尚未覆盖冲突订单
                    </div>
                  </div>
                  <Link
                    href={`/migration?session=${encodeURIComponent(attempt.sessionId)}`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-800"
                  >
                    逐单处理
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 font-semibold">
            <Link2 className="h-5 w-5" aria-hidden="true" />
            已连接电脑
          </div>
          {activeDevices.length > 0 ? (
            <div className="mt-3 divide-y divide-zinc-100">
              {activeDevices.map((device) => (
                <div
                  key={device.id}
                  className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{device.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      版本 {device.appVersion || "未知"} · 最近连接 {formatDateTime(device.lastSeenAt)}
                    </div>
                  </div>
                  <form action={revokeCloudSyncDeviceAction}>
                    <input type="hidden" name="deviceId" value={device.id} />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      <Unplug className="h-4 w-4" aria-hidden="true" />
                      撤销授权
                    </button>
                  </form>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-zinc-500">还没有连接离线版电脑。</div>
          )}
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 font-semibold">
            <CloudUpload className="h-5 w-5" aria-hidden="true" />
            最近同步
          </div>
          {state.attempts.length > 0 ? (
            <div className="mt-3 divide-y divide-zinc-100">
              {state.attempts.slice(0, 12).map((attempt) => (
                <div key={attempt.id} className="grid gap-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{attempt.sourceFilename}</span>
                    <span className={`text-xs font-semibold ${attemptTones[attempt.status]}`}>
                      {attemptLabels[attempt.status]}
                    </span>
                  </div>
                  <div className="text-xs leading-5 text-zinc-500">
                    {formatDateTime(attempt.createdAt)} · {attempt.sourceOrders} 张订单 · {attempt.message}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              暂无同步记录
            </div>
          )}
        </section>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/migration"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 font-medium hover:bg-zinc-50"
          >
            <CloudUpload className="h-4 w-4" aria-hidden="true" />
            打开云端数据迁移
          </Link>
          <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            设备令牌只能上传同步，不能取得管理员密码
          </div>
        </div>
      </div>
    </main>
  );
}
