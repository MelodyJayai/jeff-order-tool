"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";

type SyncStatus = {
  ok?: boolean;
  connected: boolean;
  serverUrl: string | null;
  deviceName: string | null;
  autoSync: boolean;
  needsSync: boolean;
  state: "disconnected" | "ready" | "success" | "conflict" | "error";
  message: string;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  pendingSessionId: string | null;
  pendingConflictCount: number;
};

const emptyStatus: SyncStatus = {
  connected: false,
  serverUrl: null,
  deviceName: null,
  autoSync: true,
  needsSync: false,
  state: "disconnected",
  message: "尚未连接云端",
  lastAttemptAt: null,
  lastSyncAt: null,
  pendingSessionId: null,
  pendingConflictCount: 0,
};

function displayTime(value: string | null) {
  if (!value) {
    return "尚未同步";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(state: SyncStatus["state"]) {
  if (state === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (state === "conflict" || state === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  return "border-cyan-200 bg-cyan-50 text-cyan-900";
}

function StatusIcon({ state }: { state: SyncStatus["state"] }) {
  if (state === "success") {
    return <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  if (state === "conflict" || state === "error") {
    return <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  return <CloudUpload className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function CloudSyncCard({ dataVersion }: { dataVersion: string }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<"pair" | "sync" | "setting" | null>(null);
  const [formError, setFormError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/local-sync", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = (await response.json()) as SyncStatus & {
        message?: string;
      };
      if (response.ok) {
        setStatus(result);
        return result;
      }
      setFormError(result.message || "无法读取同步状态");
    } catch {
      setFormError("暂时无法读取同步状态");
    }
    return null;
  }, []);

  const syncNow = useCallback(async () => {
    setBusy("sync");
    setFormError("");
    try {
      const response = await fetch("/api/local-sync/push", {
        method: "POST",
        credentials: "same-origin",
      });
      const result = (await response.json()) as SyncStatus & {
        message?: string;
      };
      setStatus(result);
      if (!response.ok) {
        setFormError(result.message || "同步失败");
      }
    } catch {
      setFormError("网络暂时不可用，本地数据没有丢失");
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [dataVersion, refresh]);

  useEffect(() => {
    if (
      !status?.connected ||
      !status.autoSync ||
      !status.needsSync ||
      status.state === "conflict" ||
      status.state === "error" ||
      busy
    ) {
      return;
    }
    const timer = window.setTimeout(() => void syncNow(), 12_000);
    return () => window.clearTimeout(timer);
  }, [busy, status, syncNow]);

  useEffect(() => {
    if (status?.state !== "conflict") {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.state]);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusy("pair");
    setFormError("");
    try {
      const response = await fetch("/api/local-sync/pair", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: formData.get("serverUrl"),
          code: formData.get("code"),
        }),
      });
      const result = (await response.json()) as SyncStatus & {
        message?: string;
      };
      if (!response.ok) {
        setFormError(result.message || "连接云端失败");
      } else {
        setStatus(result);
        form.reset();
      }
    } catch {
      setFormError("无法连接服务器，请检查地址和网络");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoSync(enabled: boolean) {
    setBusy("setting");
    setFormError("");
    try {
      const response = await fetch("/api/local-sync", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSync: enabled }),
      });
      const result = (await response.json()) as SyncStatus & {
        message?: string;
      };
      if (response.ok) {
        setStatus(result);
      } else {
        setFormError(result.message || "设置失败");
      }
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("确定断开这台电脑与云端的同步吗？本地订单不会删除。")) {
      return;
    }
    setBusy("setting");
    try {
      const response = await fetch("/api/local-sync", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (response.ok) {
        setStatus(emptyStatus);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="hidden rounded-md border border-zinc-200 bg-white md:block">
      <div className="flex h-12 items-center gap-2 border-b border-zinc-200 px-4 text-sm font-semibold">
        <CloudUpload className="h-4 w-4" aria-hidden="true" />
        云端同步
      </div>

      {!status ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-zinc-500">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          正在检查
        </div>
      ) : status.connected ? (
        <div className="grid gap-3 p-4">
          <div className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${statusTone(status.state)}`}>
            <StatusIcon state={status.state} />
            <div className="min-w-0">
              <div className="font-semibold">
                {status.state === "conflict"
                  ? `等待处理 ${status.pendingConflictCount} 张冲突订单`
                  : status.needsSync
                    ? "本地有新修改"
                    : "数据已同步"}
              </div>
              <div className="mt-1 break-words text-xs leading-5">
                {status.message}
              </div>
            </div>
          </div>

          <div className="grid gap-1 text-xs text-zinc-500">
            <div className="break-all">服务器 {status.serverUrl}</div>
            <div>最近完成 {displayTime(status.lastSyncAt)}</div>
          </div>

          <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 text-sm">
            <span>
              自动同步
              <span className="ml-2 text-xs text-zinc-500">修改后自动安全发送</span>
            </span>
            <input
              type="checkbox"
              checked={status.autoSync}
              disabled={Boolean(busy)}
              onChange={(event) => void toggleAutoSync(event.target.checked)}
              className="h-4 w-4 accent-zinc-950"
            />
          </label>

          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={Boolean(busy) || status.state === "conflict"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {busy === "sync" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            {busy === "sync"
              ? "正在同步"
              : status.state === "conflict"
                ? "等待管理员处理"
                : "立即同步"}
          </button>

          <details className="border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer font-medium text-zinc-700">
              连接设置
            </summary>
            <div className="mt-3 grid gap-2">
              <div>{status.deviceName}</div>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={Boolean(busy)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-400"
              >
                <Unplug className="h-4 w-4" aria-hidden="true" />
                断开云端
              </button>
            </div>
          </details>
        </div>
      ) : (
        <form onSubmit={pair} className="grid gap-3 p-4">
          <div className="text-xs leading-5 text-zinc-500">
            首次连接时填写管理员提供的服务器地址和六位配对码，之后不需要再输入。
          </div>
          <label className="grid gap-1.5 text-xs font-medium text-zinc-600">
            服务器地址
            <input
              name="serverUrl"
              type="url"
              placeholder="https://orders.example.com"
              required
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-zinc-600">
            六位配对码
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              placeholder="123 456"
              required
              className="h-10 rounded-md border border-zinc-300 px-3 text-center font-mono text-lg font-semibold tracking-normal text-zinc-950 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
            />
          </label>
          <button
            type="submit"
            disabled={Boolean(busy)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
          >
            {busy === "pair" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            {busy === "pair" ? "正在连接" : "连接云端"}
          </button>
        </form>
      )}

      {formError ? (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-800">
          {formError}
        </div>
      ) : null}
    </section>
  );
}
