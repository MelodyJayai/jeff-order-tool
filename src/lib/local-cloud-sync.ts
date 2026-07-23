import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDatabaseBackup,
  getDataDirectory,
  getDatabaseChangeToken,
  getDatabaseSummary,
} from "@/lib/db";
import { isCloudDeployment } from "@/lib/deployment";
import { getCurrentVersion } from "@/lib/update";

type LocalSyncState = "ready" | "success" | "conflict" | "error";

type LocalCloudSyncConfig = {
  version: 1;
  serverUrl: string;
  deviceId: string;
  installationId: string;
  deviceName: string;
  protectedToken: string;
  autoSync: boolean;
  connectedAt: string;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  lastSyncedChangeToken: string | null;
  lastState: LocalSyncState;
  lastMessage: string;
  pendingSessionId: string | null;
  pendingSourceChangeToken: string | null;
  pendingConflictCount: number;
};

type RemoteSyncResult = {
  ok?: boolean;
  status?:
    | "processing"
    | "conflict"
    | "applied"
    | "already_synced"
    | "failed"
    | "rolled_back";
  message?: string;
  sessionId?: string;
  sourceOrders?: number;
  conflictCount?: number;
  created?: number;
  updatedFromSource?: number;
  keptCloud?: number;
  reportId?: string | null;
  token?: string;
  deviceId?: string;
  deviceName?: string;
};

export type LocalCloudSyncStatus = {
  connected: boolean;
  serverUrl: string | null;
  deviceName: string | null;
  autoSync: boolean;
  needsSync: boolean;
  state: "disconnected" | LocalSyncState;
  message: string;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  pendingSessionId: string | null;
  pendingConflictCount: number;
};

export type LocalCloudSyncPushResult = LocalCloudSyncStatus & {
  ok: boolean;
  retryAfterMs: number | null;
};

const CONFIG_VERSION = 1;
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
let activePush: Promise<LocalCloudSyncPushResult> | null = null;

function configPath() {
  return path.join(getDataDirectory(), "cloud-sync-client.json");
}

function readConfig() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(configPath(), "utf8"),
    ) as Partial<LocalCloudSyncConfig>;
    if (
      parsed.version !== CONFIG_VERSION ||
      typeof parsed.serverUrl !== "string" ||
      typeof parsed.deviceId !== "string" ||
      typeof parsed.installationId !== "string" ||
      typeof parsed.protectedToken !== "string"
    ) {
      return null;
    }
    return parsed as LocalCloudSyncConfig;
  } catch {
    return null;
  }
}

function writeConfig(config: LocalCloudSyncConfig) {
  const filePath = configPath();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
  }
}

function dpapiCommand(mode: "protect" | "unprotect") {
  const transform =
    mode === "protect"
      ? "$bytes=[Text.Encoding]::UTF8.GetBytes($inputText);$result=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)"
      : "$bytes=[Convert]::FromBase64String($inputText);$result=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)";
  const output =
    mode === "protect"
      ? "[Console]::Out.Write([Convert]::ToBase64String($result))"
      : "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($result))";
  return `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd();${transform};${output}`;
}

function runDpapi(mode: "protect" | "unprotect", value: string) {
  if (process.platform !== "win32") {
    throw new Error("离线同步凭据只能在 Windows 版中保存");
  }

  const encodedCommand = Buffer.from(
    dpapiCommand(mode),
    "utf16le",
  ).toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ],
    {
      encoding: "utf8",
      input: value,
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Windows 无法安全保存云端同步凭据");
  }

  return result.stdout.trim();
}

function isPrivateHostname(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }
  if (/^10\./u.test(hostname) || /^192\.168\./u.test(hostname)) {
    return true;
  }
  const match = hostname.match(/^172\.(\d+)\./u);
  const second = match ? Number.parseInt(match[1], 10) : 0;
  return second >= 16 && second <= 31;
}

export function normalizeCloudSyncServerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("服务器地址格式不正确");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务器地址中不能包含账号、参数或锚点");
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (isPrivateHostname(url.hostname) ||
        process.env.JEFF_ALLOW_HTTP_CLOUD_SYNC === "true")
    )
  ) {
    throw new Error("互联网同步必须使用 HTTPS 地址");
  }

  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString().replace(/\/+$/u, "");
}

async function responseJson(response: Response) {
  try {
    return (await response.json()) as RemoteSyncResult;
  } catch {
    return { ok: false, message: `云端返回异常：HTTP ${response.status}` };
  }
}

async function remoteFetch(
  config: LocalCloudSyncConfig,
  pathName: string,
  init: RequestInit,
) {
  const token = runDpapi("unprotect", config.protectedToken);
  return fetch(`${config.serverUrl}${pathName}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "User-Agent": `jeff-order-tool/${getCurrentVersion()}`,
    },
  });
}

function statusFromConfig(
  config: LocalCloudSyncConfig | null,
): LocalCloudSyncStatus {
  if (!config) {
    return {
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
  }

  const needsSync =
    getDatabaseChangeToken() !== config.lastSyncedChangeToken;
  return {
    connected: true,
    serverUrl: config.serverUrl,
    deviceName: config.deviceName,
    autoSync: config.autoSync,
    needsSync,
    state: config.lastState,
    message: config.lastMessage,
    lastAttemptAt: config.lastAttemptAt,
    lastSyncAt: config.lastSyncAt,
    pendingSessionId: config.pendingSessionId,
    pendingConflictCount: config.pendingConflictCount,
  };
}

async function refreshPendingSession(config: LocalCloudSyncConfig) {
  if (!config.pendingSessionId) {
    return config;
  }

  try {
    const response = await remoteFetch(
      config,
      `/api/cloud-sync/session?sessionId=${encodeURIComponent(config.pendingSessionId)}`,
      { method: "GET" },
    );
    const result = await responseJson(response);

    if (response.status === 401) {
      config.lastState = "error";
      config.lastMessage = "云端同步授权已失效，请重新连接";
      config.pendingSessionId = null;
      config.pendingSourceChangeToken = null;
      config.pendingConflictCount = 0;
      writeConfig(config);
      return config;
    }

    if (response.status === 404) {
      config.lastState = "error";
      config.lastMessage = "云端已找不到这次冲突记录，请重新同步";
      config.pendingSessionId = null;
      config.pendingSourceChangeToken = null;
      config.pendingConflictCount = 0;
      writeConfig(config);
      return config;
    }

    if (result.status === "applied" || result.status === "already_synced") {
      config.lastSyncedChangeToken = config.pendingSourceChangeToken;
      config.lastSyncAt = new Date().toISOString();
      config.lastState = "success";
      config.lastMessage = result.message || "云端冲突已处理完成";
      config.pendingSessionId = null;
      config.pendingSourceChangeToken = null;
      config.pendingConflictCount = 0;
      writeConfig(config);
    } else if (result.status === "failed" || result.status === "rolled_back") {
      config.lastState = "error";
      config.lastMessage = result.message || "请重新同步本地数据";
      config.pendingSessionId = null;
      config.pendingSourceChangeToken = null;
      config.pendingConflictCount = 0;
      writeConfig(config);
    }
  } catch {
  }

  return config;
}

export async function getLocalCloudSyncStatus() {
  if (isCloudDeployment()) {
    return statusFromConfig(null);
  }
  const config = readConfig();
  return statusFromConfig(config ? await refreshPendingSession(config) : null);
}

export async function pairLocalCloudSync(input: {
  serverUrl: string;
  code: string;
}) {
  if (isCloudDeployment()) {
    throw new Error("云端服务器不能配对到自身");
  }

  const serverUrl = normalizeCloudSyncServerUrl(input.serverUrl);
  const installationId = readConfig()?.installationId || randomUUID();
  const deviceName = `${os.hostname()} 的 Jeff 订单工具`;
  const response = await fetch(`${serverUrl}/api/cloud-sync/pair`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `jeff-order-tool/${getCurrentVersion()}`,
    },
    body: JSON.stringify({
      code: input.code,
      installationId,
      deviceName,
      appVersion: getCurrentVersion(),
    }),
  });
  const result = await responseJson(response);

  if (
    !response.ok ||
    !result.ok ||
    typeof result.token !== "string" ||
    typeof result.deviceId !== "string"
  ) {
    throw new Error(result.message || `连接云端失败：HTTP ${response.status}`);
  }

  const now = new Date().toISOString();
  const config: LocalCloudSyncConfig = {
    version: CONFIG_VERSION,
    serverUrl,
    deviceId: result.deviceId,
    installationId,
    deviceName: result.deviceName || deviceName,
    protectedToken: runDpapi("protect", result.token),
    autoSync: true,
    connectedAt: now,
    lastAttemptAt: null,
    lastSyncAt: null,
    lastSyncedChangeToken: null,
    lastState: "ready",
    lastMessage: "已经连接云端，等待首次同步",
    pendingSessionId: null,
    pendingSourceChangeToken: null,
    pendingConflictCount: 0,
  };
  writeConfig(config);
  return statusFromConfig(config);
}

async function performPush(options: { automatic: boolean }) {
  if (isCloudDeployment()) {
    return {
      ...statusFromConfig(null),
      ok: false,
      retryAfterMs: null,
    } satisfies LocalCloudSyncPushResult;
  }

  let config = readConfig();
  if (!config) {
    return {
      ...statusFromConfig(null),
      ok: false,
      retryAfterMs: null,
    } satisfies LocalCloudSyncPushResult;
  }

  config = await refreshPendingSession(config);
  if (options.automatic && !config.autoSync) {
    return {
      ...statusFromConfig(config),
      ok: true,
      retryAfterMs: null,
    };
  }
  if (config.pendingSessionId) {
    return {
      ...statusFromConfig(config),
      ok: true,
      retryAfterMs: null,
    };
  }

  const sourceChangeToken = getDatabaseChangeToken();
  if (sourceChangeToken === config.lastSyncedChangeToken) {
    return {
      ...statusFromConfig(config),
      ok: true,
      retryAfterMs: null,
    };
  }

  config.lastAttemptAt = new Date().toISOString();
  config.lastState = "ready";
  config.lastMessage = "正在安全同步到云端";
  writeConfig(config);

  try {
    const backup = await createDatabaseBackup();
    const sourceChangeTokenAfterBackup = getDatabaseChangeToken();
    const summary = getDatabaseSummary();
    const formData = new FormData();
    formData.append(
      "databaseFile",
      new Blob([new Uint8Array(backup)], {
        type: "application/octet-stream",
      }),
      `jeff-order-sync-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.db`,
    );
    formData.append("sourceChangeToken", sourceChangeToken);
    formData.append("schemaVersion", summary.schemaVersion);
    formData.append("appVersion", getCurrentVersion());

    const response = await remoteFetch(config, "/api/cloud-sync/push", {
      method: "POST",
      body: formData,
    });
    const result = await responseJson(response);

    if (response.status === 401) {
      config.lastState = "error";
      config.lastMessage = "云端同步授权已失效，请重新连接";
      writeConfig(config);
      return {
        ...statusFromConfig(config),
        ok: false,
        retryAfterMs: null,
      };
    }

    if (!response.ok || !result.ok || !result.status) {
      throw new Error(result.message || `同步失败：HTTP ${response.status}`);
    }

    if (result.status === "conflict") {
      config.lastState = "conflict";
      config.lastMessage = result.message || "发现需要管理员确认的订单";
      config.pendingSessionId = result.sessionId || null;
      config.pendingSourceChangeToken = sourceChangeToken;
      config.pendingConflictCount = result.conflictCount || 0;
      writeConfig(config);
      return {
        ...statusFromConfig(config),
        ok: true,
        retryAfterMs: null,
      };
    }

    config.lastSyncedChangeToken = sourceChangeToken;
    config.lastSyncAt = new Date().toISOString();
    config.lastState = "success";
    config.lastMessage =
      sourceChangeToken === sourceChangeTokenAfterBackup
        ? result.message || "已经同步到云端"
        : "本次同步完成，刚才又有新操作，软件会继续同步";
    config.pendingSessionId = null;
    config.pendingSourceChangeToken = null;
    config.pendingConflictCount = 0;
    writeConfig(config);

    return {
      ...statusFromConfig(config),
      ok: true,
      retryAfterMs:
        sourceChangeToken === sourceChangeTokenAfterBackup ? null : 15_000,
    };
  } catch (error) {
    config.lastState = "error";
    config.lastMessage =
      error instanceof Error
        ? `${error.message}；数据仍安全保存在本机，稍后会重试`
        : "暂时无法同步；数据仍安全保存在本机，稍后会重试";
    writeConfig(config);
    return {
      ...statusFromConfig(config),
      ok: false,
      retryAfterMs: config.autoSync ? RETRY_AFTER_MS : null,
    };
  }
}

export function pushLocalCloudChanges(options = { automatic: false }) {
  if (!activePush) {
    activePush = performPush(options).finally(() => {
      activePush = null;
    });
  }
  return activePush;
}

export function setLocalCloudSyncAutoSync(enabled: boolean) {
  const config = readConfig();
  if (!config) {
    throw new Error("尚未连接云端");
  }
  config.autoSync = enabled;
  config.lastMessage = enabled
    ? "自动同步已开启"
    : "自动同步已关闭，可以随时手动同步";
  writeConfig(config);
  return statusFromConfig(config);
}

export function disconnectLocalCloudSync() {
  fs.rmSync(configPath(), { force: true });
  return statusFromConfig(null);
}
