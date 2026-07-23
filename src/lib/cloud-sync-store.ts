import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDataDirectory, getOrCreateSessionSecret } from "@/lib/db";

export type CloudSyncAttemptStatus =
  | "processing"
  | "conflict"
  | "applied"
  | "already_synced"
  | "failed"
  | "rolled_back";

type StoredPairing = {
  id: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  failedAttempts: number;
};

type StoredDevice = {
  id: string;
  installationId: string;
  name: string;
  appVersion: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type CloudSyncAttempt = {
  id: string;
  sessionId: string;
  deviceId: string;
  sourceChangeToken: string;
  sourceSha256: string;
  sourceFilename: string;
  sourceOrders: number;
  conflictCount: number;
  status: CloudSyncAttemptStatus;
  message: string;
  createdAt: string;
  completedAt: string | null;
  reportId: string | null;
};

type CloudSyncStore = {
  version: 1;
  pairing: StoredPairing | null;
  devices: StoredDevice[];
  attempts: CloudSyncAttempt[];
};

export type CloudSyncDevice = Omit<StoredDevice, "tokenHash">;

const STORE_VERSION = 1;
const PAIRING_TTL_MS = 15 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 10;
const MAX_ATTEMPTS = 100;

function storePath() {
  return path.join(getDataDirectory(), "cloud-sync-devices.json");
}

function emptyStore(): CloudSyncStore {
  return {
    version: STORE_VERSION,
    pairing: null,
    devices: [],
    attempts: [],
  };
}

function readStore() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(storePath(), "utf8"),
    ) as Partial<CloudSyncStore>;

    if (
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.devices) ||
      !Array.isArray(parsed.attempts)
    ) {
      return emptyStore();
    }

    return {
      version: STORE_VERSION,
      pairing: parsed.pairing ?? null,
      devices: parsed.devices,
      attempts: parsed.attempts,
    } satisfies CloudSyncStore;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CloudSyncStore) {
  const filePath = storePath();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
  }
}

function hashSecret(value: string) {
  return createHmac("sha256", getOrCreateSessionSecret())
    .update(value, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function cleanPairingCode(value: string) {
  return value.replace(/\D/gu, "").slice(0, 6);
}

function publicDevice(device: StoredDevice): CloudSyncDevice {
  return {
    id: device.id,
    installationId: device.installationId,
    name: device.name,
    appVersion: device.appVersion,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
  };
}

function prune(store: CloudSyncStore) {
  if (
    store.pairing &&
    Date.parse(store.pairing.expiresAt) <= Date.now()
  ) {
    store.pairing = null;
  }

  store.attempts = store.attempts
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_ATTEMPTS);
}

export function createCloudSyncPairing() {
  const store = readStore();
  const code = String(randomInt(100_000, 1_000_000));
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_MS);

  store.pairing = {
    id: randomUUID(),
    codeHash: hashSecret(code),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    failedAttempts: 0,
  };
  prune(store);
  writeStore(store);

  return {
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export function consumeCloudSyncPairing(input: {
  code: string;
  installationId: string;
  name: string;
  appVersion: string;
}) {
  const store = readStore();
  prune(store);
  const pairing = store.pairing;
  const code = cleanPairingCode(input.code);

  if (!pairing || Date.parse(pairing.expiresAt) <= Date.now()) {
    writeStore(store);
    throw new Error("配对码已失效，请在云端重新生成");
  }

  if (pairing.failedAttempts >= MAX_PAIRING_ATTEMPTS) {
    store.pairing = null;
    writeStore(store);
    throw new Error("配对尝试次数过多，请在云端重新生成配对码");
  }

  if (!code || !safeEqual(hashSecret(code), pairing.codeHash)) {
    pairing.failedAttempts += 1;
    writeStore(store);
    throw new Error("配对码不正确");
  }

  const now = new Date().toISOString();
  const token = randomBytes(32).toString("base64url");
  const device: StoredDevice = {
    id: randomUUID(),
    installationId: input.installationId.trim().slice(0, 100),
    name: input.name.trim().slice(0, 80) || "Jeff 的电脑",
    appVersion: input.appVersion.trim().slice(0, 40),
    tokenHash: hashSecret(token),
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };

  store.devices.push(device);
  store.pairing = null;
  writeStore(store);

  return {
    device: publicDevice(device),
    token,
  };
}

export function authenticateCloudSyncToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  if (!match) {
    return null;
  }

  const tokenHash = hashSecret(match[1].trim());
  const store = readStore();
  const device = store.devices.find(
    (item) => !item.revokedAt && safeEqual(item.tokenHash, tokenHash),
  );

  if (!device) {
    return null;
  }

  device.lastSeenAt = new Date().toISOString();
  writeStore(store);
  return publicDevice(device);
}

export function revokeCloudSyncDevice(deviceId: string) {
  const store = readStore();
  const device = store.devices.find((item) => item.id === deviceId);
  if (!device || device.revokedAt) {
    return false;
  }
  device.revokedAt = new Date().toISOString();
  writeStore(store);
  return true;
}

export function recordCloudSyncAttempt(
  attempt: Omit<CloudSyncAttempt, "id" | "createdAt" | "completedAt">,
) {
  const store = readStore();
  const record: CloudSyncAttempt = {
    ...attempt,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    completedAt:
      attempt.status === "processing" || attempt.status === "conflict"
        ? null
        : new Date().toISOString(),
  };
  store.attempts.unshift(record);
  prune(store);
  writeStore(store);
  return record;
}

export function updateCloudSyncAttempt(
  sessionId: string,
  values: Partial<
    Pick<
      CloudSyncAttempt,
      "status" | "message" | "reportId" | "completedAt"
    >
  >,
) {
  const store = readStore();
  const attempt = store.attempts.find((item) => item.sessionId === sessionId);
  if (!attempt) {
    return null;
  }
  Object.assign(attempt, values);
  writeStore(store);
  return attempt;
}

export function getCloudSyncAttempt(deviceId: string, sessionId: string) {
  return (
    readStore().attempts.find(
      (item) => item.deviceId === deviceId && item.sessionId === sessionId,
    ) ?? null
  );
}

export function markCloudSyncAttemptApplied(
  sessionId: string,
  reportId: string,
  message: string,
) {
  return updateCloudSyncAttempt(sessionId, {
    status: "applied",
    reportId,
    message,
    completedAt: new Date().toISOString(),
  });
}

export function markCloudSyncAttemptRolledBack(reportId: string) {
  const store = readStore();
  const attempt = store.attempts.find((item) => item.reportId === reportId);
  if (!attempt) {
    return null;
  }
  attempt.status = "rolled_back";
  attempt.message = "这次同步后来已由管理员回滚";
  attempt.completedAt = new Date().toISOString();
  writeStore(store);
  return attempt;
}

export function getCloudSyncAdminState() {
  const store = readStore();
  prune(store);
  writeStore(store);
  return {
    pairing: store.pairing
      ? {
          createdAt: store.pairing.createdAt,
          expiresAt: store.pairing.expiresAt,
          failedAttempts: store.pairing.failedAttempts,
        }
      : null,
    devices: store.devices.map(publicDevice),
    attempts: store.attempts.slice(0, 30),
  };
}
