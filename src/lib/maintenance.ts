import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDataDirectory } from "@/lib/db";

export type MigrationMaintenance = {
  token: string;
  pid: number;
  reason: string;
  startedAt: string;
};

const STALE_AFTER_MS = 30 * 60 * 1000;

function lockPath() {
  return path.join(getDataDirectory(), "cloud-migration.lock");
}

function processExists(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readLock(): MigrationMaintenance | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(lockPath(), "utf8"),
    ) as Partial<MigrationMaintenance>;

    if (
      typeof parsed.token !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.reason !== "string" ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }

    return parsed as MigrationMaintenance;
  } catch {
    return null;
  }
}

function removeStaleLock(lock: MigrationMaintenance | null) {
  if (!lock) {
    fs.rmSync(lockPath(), { force: true });
    return true;
  }

  const age = Date.now() - Date.parse(lock.startedAt);
  const stale =
    lock.pid !== process.pid &&
    (!processExists(lock.pid) || !Number.isFinite(age) || age > STALE_AFTER_MS);

  if (stale) {
    fs.rmSync(lockPath(), { force: true });
  }

  return stale;
}

export function getMigrationMaintenance() {
  if (!fs.existsSync(lockPath())) {
    return null;
  }

  const lock = readLock();
  return removeStaleLock(lock) ? null : lock;
}

export function acquireMigrationMaintenance(reason: string) {
  fs.mkdirSync(getDataDirectory(), { recursive: true });

  const existing = getMigrationMaintenance();
  if (existing) {
    throw new Error(`数据库正在维护：${existing.reason}`);
  }

  const lock: MigrationMaintenance = {
    token: randomUUID(),
    pid: process.pid,
    reason,
    startedAt: new Date().toISOString(),
  };
  const handle = fs.openSync(lockPath(), "wx");

  try {
    fs.writeFileSync(handle, JSON.stringify(lock, null, 2), "utf8");
  } finally {
    fs.closeSync(handle);
  }

  return () => {
    const current = readLock();
    if (current?.token === lock.token) {
      fs.rmSync(lockPath(), { force: true });
    }
  };
}
