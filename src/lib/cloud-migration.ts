import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  closeDatabaseForMigration,
  createDatabaseBackupFile,
  ensureDatabaseSchema,
  getAppMeta,
  getBackupDirectory,
  getDataDirectory,
  getDatabasePath,
  reopenDatabaseAfterMigration,
} from "@/lib/db";
import { acquireMigrationMaintenance } from "@/lib/maintenance";

export type MigrationMode = "replace" | "merge";
export type MigrationResolution = "source" | "cloud";
export type MigrationDiffCategory =
  | "source_only"
  | "cloud_only"
  | "identical"
  | "local_changed"
  | "cloud_changed"
  | "conflict"
  | "unchanged_divergent";

export type MigrationDatabaseSummary = {
  orders: number;
  deliveries: number;
  events: number;
  pending: number;
  partial: number;
  returned: number;
  writtenOff: number;
  schemaVersion: string;
};

export type MigrationOrderDiff = {
  id: string;
  key: string;
  code: string;
  companyName: string;
  category: MigrationDiffCategory;
  sourceHash: string | null;
  cloudHash: string | null;
  sourceUpdatedAt: string | null;
  cloudUpdatedAt: string | null;
};

export type MigrationPreview = {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  sourceFilename: string;
  sourceFileSize: number;
  sourceSha256: string;
  sourceIntegrity: string;
  originalSchemaVersion: string;
  source: MigrationDatabaseSummary;
  cloud: MigrationDatabaseSummary;
  cloudFingerprint: string;
  alreadyImported: boolean;
  counts: Record<MigrationDiffCategory, number>;
  diffs: MigrationOrderDiff[];
};

export type MigrationReport = {
  id: string;
  sessionId: string;
  mode: MigrationMode;
  sourceFilename: string;
  sourceSha256: string;
  backupFilename: string;
  startedAt: string;
  completedAt: string;
  sourceOrders: number;
  cloudOrdersBefore: number;
  cloudOrdersAfter: number;
  created: number;
  updatedFromSource: number;
  keptCloud: number;
  conflictsResolved: number;
  integrity: string;
  rolledBackAt?: string;
  rollbackBackupFilename?: string;
};

type MigrationSession = MigrationPreview & {
  originalPath: string;
  preparedPath: string;
};

type OrderSnapshot = {
  id: string;
  key: string;
  code: string;
  companyName: string;
  updatedAt: string;
  hash: string;
};

type MigrationBaseline = {
  order_key: string;
  source_hash: string | null;
  cloud_hash: string | null;
};

const SESSION_HOURS = 24;
const MAX_DATABASE_BYTES = 100 * 1024 * 1024;
const MIGRATION_ID_PATTERN = /^[0-9a-f-]{36}$/u;
const ORDER_HASH_IGNORED_COLUMNS = new Set(["id", "created_at", "updated_at"]);

function migrationRoot() {
  return path.join(getDataDirectory(), "migrations");
}

function pendingRoot() {
  return path.join(migrationRoot(), "pending");
}

function reportRoot() {
  return path.join(migrationRoot(), "reports");
}

function safeSessionId(value: string) {
  if (!MIGRATION_ID_PATTERN.test(value)) {
    throw new Error("迁移会话编号无效");
  }
  return value;
}

function sessionDirectory(sessionId: string) {
  return path.join(pendingRoot(), safeSessionId(sessionId));
}

function sessionJsonPath(sessionId: string) {
  return path.join(sessionDirectory(sessionId), "session.json");
}

function reportJsonPath(reportId: string) {
  return path.join(reportRoot(), `${safeSessionId(reportId)}.json`);
}

function removeSessionDirectory(sessionId: string) {
  const root = path.resolve(pendingRoot());
  const directory = path.resolve(sessionDirectory(sessionId));
  if (path.dirname(directory) !== root) {
    throw new Error("迁移会话目录无效");
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

function pruneExpiredMigrationSessions() {
  if (!fs.existsSync(pendingRoot())) {
    return;
  }

  for (const item of fs.readdirSync(pendingRoot(), { withFileTypes: true })) {
    if (!item.isDirectory() || !MIGRATION_ID_PATTERN.test(item.name)) {
      continue;
    }
    try {
      const session = JSON.parse(
        fs.readFileSync(sessionJsonPath(item.name), "utf8"),
      ) as { expiresAt?: unknown };
      if (
        typeof session.expiresAt !== "string" ||
        Date.parse(session.expiresAt) <= Date.now()
      ) {
        removeSessionDirectory(item.name);
      }
    } catch {
      const directory = sessionDirectory(item.name);
      let age = 0;
      try {
        age = Date.now() - fs.statSync(directory).mtimeMs;
      } catch {
        continue;
      }
      if (age > SESSION_HOURS * 60 * 60 * 1000) {
        removeSessionDirectory(item.name);
      }
    }
  }
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(db: Database.Database, table: string) {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function hashBuffer(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedKey(companyName: string, code: string) {
  return `${companyName.trim().toLocaleLowerCase()}\u001f${code
    .trim()
    .toLocaleLowerCase()}`;
}

function cleanRecord(row: Record<string, unknown>, ignored = new Set<string>()) {
  return Object.fromEntries(
    Object.keys(row)
      .filter((key) => !ignored.has(key))
      .sort()
      .map((key) => [key, row[key] ?? null]),
  );
}

function orderSnapshots(db: Database.Database) {
  if (!tableExists(db, "orders")) {
    return new Map<string, OrderSnapshot>();
  }

  const orders = db.prepare("SELECT * FROM orders").all() as Array<
    Record<string, unknown>
  >;
  const deliveries = tableExists(db, "order_deliveries")
    ? (db
        .prepare(
          "SELECT * FROM order_deliveries ORDER BY order_id, delivered_at, created_at, id",
        )
        .all() as Array<Record<string, unknown>>)
    : [];
  const deliveriesByOrder = new Map<string, Array<Record<string, unknown>>>();
  const events = tableExists(db, "order_events")
    ? (db
        .prepare(
          "SELECT * FROM order_events ORDER BY order_id, created_at, id",
        )
        .all() as Array<Record<string, unknown>>)
    : [];
  const eventsByOrder = new Map<string, Array<Record<string, unknown>>>();

  for (const delivery of deliveries) {
    const orderId = String(delivery.order_id ?? "");
    const existing = deliveriesByOrder.get(orderId) ?? [];
    existing.push(cleanRecord(delivery, new Set(["order_id"])));
    deliveriesByOrder.set(orderId, existing);
  }

  for (const event of events) {
    const orderId = String(event.order_id ?? "");
    const existing = eventsByOrder.get(orderId) ?? [];
    existing.push(cleanRecord(event, new Set(["order_id"])));
    eventsByOrder.set(orderId, existing);
  }

  const snapshots = new Map<string, OrderSnapshot>();

  for (const order of orders) {
    const id = String(order.id ?? "");
    const code = String(order.code ?? "").trim();
    const companyName = String(order.company_name ?? "").trim();
    const key = normalizedKey(companyName, code);
    const hash = hashBuffer(
      JSON.stringify({
        order: cleanRecord(order, ORDER_HASH_IGNORED_COLUMNS),
        deliveries: deliveriesByOrder.get(id) ?? [],
        events: eventsByOrder.get(id) ?? [],
      }),
    );

    snapshots.set(key, {
      id,
      key,
      code,
      companyName,
      updatedAt: String(order.updated_at ?? ""),
      hash,
    });
  }

  return snapshots;
}

function databaseFingerprint(snapshots: Map<string, OrderSnapshot>) {
  return hashBuffer(
    JSON.stringify(
      [...snapshots.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((item) => [item.key, item.hash]),
    ),
  );
}

function scalarCount(db: Database.Database, sql: string) {
  return (db.prepare(sql).get() as { count: number }).count;
}

function databaseSummary(db: Database.Database): MigrationDatabaseSummary {
  const hasOrders = tableExists(db, "orders");
  const orders = hasOrders
    ? scalarCount(db, "SELECT COUNT(*) AS count FROM orders")
    : 0;
  const statusCount = (status: string) =>
    hasOrders
      ? (
          db
            .prepare("SELECT COUNT(*) AS count FROM orders WHERE status = ?")
            .get(status) as { count: number }
        ).count
      : 0;
  const schemaVersion = tableExists(db, "app_meta")
    ? (
        db
          .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
          .get() as { value?: string } | undefined
      )?.value ?? "未知"
    : "未知";

  return {
    orders,
    deliveries: tableExists(db, "order_deliveries")
      ? scalarCount(db, "SELECT COUNT(*) AS count FROM order_deliveries")
      : 0,
    events: tableExists(db, "order_events")
      ? scalarCount(db, "SELECT COUNT(*) AS count FROM order_events")
      : 0,
    pending: statusCount("PENDING"),
    partial: statusCount("PARTIAL"),
    returned: statusCount("RETURNED"),
    writtenOff: statusCount("WRITTEN_OFF"),
    schemaVersion,
  };
}

function ensureMigrationTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_migrations (
      id TEXT PRIMARY KEY,
      source_sha256 TEXT NOT NULL UNIQUE,
      source_filename TEXT NOT NULL,
      mode TEXT NOT NULL,
      report_json TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloud_migration_baselines (
      order_key TEXT PRIMARY KEY,
      source_hash TEXT,
      cloud_hash TEXT,
      migration_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function readBaselines(db: Database.Database) {
  if (!tableExists(db, "cloud_migration_baselines")) {
    return new Map<string, MigrationBaseline>();
  }

  const rows = db
    .prepare(
      "SELECT order_key, source_hash, cloud_hash FROM cloud_migration_baselines",
    )
    .all() as MigrationBaseline[];
  return new Map(rows.map((row) => [row.order_key, row]));
}

function wasSourceImported(db: Database.Database, sourceSha256: string) {
  return (
    tableExists(db, "cloud_migrations") &&
    Boolean(
      db
        .prepare("SELECT id FROM cloud_migrations WHERE source_sha256 = ?")
        .get(sourceSha256),
    )
  );
}

function emptyCounts(): Record<MigrationDiffCategory, number> {
  return {
    source_only: 0,
    cloud_only: 0,
    identical: 0,
    local_changed: 0,
    cloud_changed: 0,
    conflict: 0,
    unchanged_divergent: 0,
  };
}

function classifyDifference(
  source: OrderSnapshot | undefined,
  cloud: OrderSnapshot | undefined,
  baseline: MigrationBaseline | undefined,
): MigrationDiffCategory {
  if (source && !cloud) {
    return "source_only";
  }
  if (!source && cloud) {
    return "cloud_only";
  }
  if (!source || !cloud) {
    throw new Error("订单差异分类失败");
  }
  if (source.hash === cloud.hash) {
    return "identical";
  }
  if (!baseline) {
    return "conflict";
  }

  const sourceChanged = source.hash !== baseline.source_hash;
  const cloudChanged = cloud.hash !== baseline.cloud_hash;

  if (sourceChanged && !cloudChanged) {
    return "local_changed";
  }
  if (!sourceChanged && cloudChanged) {
    return "cloud_changed";
  }
  if (!sourceChanged && !cloudChanged) {
    return "unchanged_divergent";
  }
  return "conflict";
}

function buildDiffs(sourceDb: Database.Database, cloudDb: Database.Database) {
  const sourceSnapshots = orderSnapshots(sourceDb);
  const cloudSnapshots = orderSnapshots(cloudDb);
  const baselines = readBaselines(cloudDb);
  const keys = new Set([...sourceSnapshots.keys(), ...cloudSnapshots.keys()]);
  const counts = emptyCounts();
  const diffs: MigrationOrderDiff[] = [];

  for (const key of [...keys].sort()) {
    const source = sourceSnapshots.get(key);
    const cloud = cloudSnapshots.get(key);
    const category = classifyDifference(source, cloud, baselines.get(key));
    counts[category] += 1;
    diffs.push({
      id: hashBuffer(key).slice(0, 20),
      key,
      code: source?.code ?? cloud?.code ?? "",
      companyName: source?.companyName ?? cloud?.companyName ?? "",
      category,
      sourceHash: source?.hash ?? null,
      cloudHash: cloud?.hash ?? null,
      sourceUpdatedAt: source?.updatedAt || null,
      cloudUpdatedAt: cloud?.updatedAt || null,
    });
  }

  return {
    counts,
    diffs,
    sourceSnapshots,
    cloudSnapshots,
    cloudFingerprint: databaseFingerprint(cloudSnapshots),
  };
}

function rawDatabaseInfo(filePath: string) {
  const db = new Database(filePath, { fileMustExist: true, readonly: true });

  try {
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    if (integrity !== "ok") {
      throw new Error(`SQLite 完整性检查失败：${integrity}`);
    }
    if (!tableExists(db, "orders")) {
      throw new Error("备份文件中没有 orders 表；请使用软件里的“下载数据库备份”");
    }
    if (!tableColumns(db, "orders").includes("code")) {
      throw new Error("备份文件缺少订单号字段");
    }

    return {
      integrity,
      schemaVersion: databaseSummary(db).schemaVersion,
    };
  } finally {
    db.close();
  }
}

async function prepareDatabaseCopy(sourcePath: string, outputPath: string) {
  const workingPath = `${outputPath}.working`;
  fs.copyFileSync(sourcePath, workingPath);
  const db = new Database(workingPath);

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    ensureDatabaseSchema(db);
    await db.backup(outputPath);
  } finally {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
    }
    db.close();
    fs.rmSync(workingPath, { force: true });
    fs.rmSync(`${workingPath}-wal`, { force: true });
    fs.rmSync(`${workingPath}-shm`, { force: true });
  }
}

function readSession(sessionId: string): MigrationSession {
  const filePath = sessionJsonPath(sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error("迁移预览已不存在，请重新上传备份");
  }

  const session = JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationSession;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error("迁移预览已过期，请重新上传备份");
  }
  return session;
}

function writeSession(session: MigrationSession) {
  fs.writeFileSync(sessionJsonPath(session.sessionId), JSON.stringify(session, null, 2));
}

export async function createMigrationPreview(
  sourceFilename: string,
  bytes: Buffer,
) {
  pruneExpiredMigrationSessions();
  if (bytes.length < 4096) {
    throw new Error("数据库备份过小，无法包含有效订单");
  }
  if (bytes.length > MAX_DATABASE_BYTES) {
    throw new Error("数据库备份超过 100 MB，已停止上传");
  }

  const sessionId = randomUUID();
  const directory = sessionDirectory(sessionId);
  const originalPath = path.join(directory, "original.db");
  const preparedPath = path.join(directory, "prepared.db");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(originalPath, bytes);

  try {
    const raw = rawDatabaseInfo(originalPath);
    await prepareDatabaseCopy(originalPath, preparedPath);
    const sourceDb = new Database(preparedPath, {
      fileMustExist: true,
      readonly: true,
    });
    const cloudDb = new Database(getDatabasePath(), {
      fileMustExist: true,
      readonly: true,
    });

    try {
      const comparison = buildDiffs(sourceDb, cloudDb);
      const createdAt = new Date();
      const session: MigrationSession = {
        sessionId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(
          createdAt.getTime() + SESSION_HOURS * 60 * 60 * 1000,
        ).toISOString(),
        sourceFilename: path.basename(sourceFilename) || "orders-backup.db",
        sourceFileSize: bytes.length,
        sourceSha256: hashBuffer(bytes),
        sourceIntegrity: raw.integrity,
        originalSchemaVersion: raw.schemaVersion,
        source: databaseSummary(sourceDb),
        cloud: databaseSummary(cloudDb),
        cloudFingerprint: comparison.cloudFingerprint,
        alreadyImported: wasSourceImported(cloudDb, hashBuffer(bytes)),
        counts: comparison.counts,
        diffs: comparison.diffs,
        originalPath,
        preparedPath,
      };
      writeSession(session);
      return session;
    } finally {
      sourceDb.close();
      cloudDb.close();
    }
  } catch (error) {
    removeSessionDirectory(sessionId);
    throw error;
  }
}

export function getMigrationPreview(sessionId: string): MigrationPreview {
  return readSession(sessionId);
}

function insertRecord(
  db: Database.Database,
  table: string,
  row: Record<string, unknown>,
) {
  const columns = tableColumns(db, table).filter((column) => column in row);
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
    .map(() => "?")
    .join(", ")})`;
  db.prepare(sql).run(columns.map((column) => row[column] ?? null));
}

function idExists(db: Database.Database, table: string, id: string) {
  return Boolean(db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id));
}

function copyChildren(
  sourceDb: Database.Database,
  cloudDb: Database.Database,
  table: "order_deliveries" | "order_events",
  sourceOrderId: string,
  cloudOrderId: string,
) {
  if (!tableExists(sourceDb, table)) {
    return;
  }

  const rows = sourceDb
    .prepare(`SELECT * FROM ${table} WHERE order_id = ? ORDER BY created_at, id`)
    .all(sourceOrderId) as Array<Record<string, unknown>>;

  for (const sourceRow of rows) {
    const row: Record<string, unknown> = {
      ...sourceRow,
      order_id: cloudOrderId,
    };
    const sourceId = String(row.id ?? randomUUID());
    row.id = idExists(cloudDb, table, sourceId) ? randomUUID() : sourceId;
    insertRecord(cloudDb, table, row);
  }
}

function replaceOrderFromSource(
  sourceDb: Database.Database,
  cloudDb: Database.Database,
  source: OrderSnapshot,
  cloud: OrderSnapshot | undefined,
) {
  const sourceRow = sourceDb
    .prepare("SELECT * FROM orders WHERE id = ?")
    .get(source.id) as Record<string, unknown> | undefined;
  if (!sourceRow) {
    throw new Error(`备份中的订单不存在：${source.companyName} / ${source.code}`);
  }

  if (cloud) {
    cloudDb.prepare("DELETE FROM orders WHERE id = ?").run(cloud.id);
  }

  let cloudOrderId = source.id;
  if (idExists(cloudDb, "orders", cloudOrderId)) {
    cloudOrderId = cloud?.id && !idExists(cloudDb, "orders", cloud.id)
      ? cloud.id
      : randomUUID();
  }

  insertRecord(cloudDb, "orders", { ...sourceRow, id: cloudOrderId });
  copyChildren(
    sourceDb,
    cloudDb,
    "order_deliveries",
    source.id,
    cloudOrderId,
  );
  copyChildren(sourceDb, cloudDb, "order_events", source.id, cloudOrderId);
}

function setMetaValue(db: Database.Database, key: string, value: string | null) {
  if (!value) {
    return;
  }
  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

function preservePreviousMigrationHistory(
  previousDbPath: string,
  cloudDb: Database.Database,
) {
  const previous = new Database(previousDbPath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    if (tableExists(previous, "cloud_migrations")) {
      const rows = previous.prepare("SELECT * FROM cloud_migrations").all() as Array<
        Record<string, unknown>
      >;
      for (const row of rows) {
        cloudDb
          .prepare(`
            INSERT OR IGNORE INTO cloud_migrations
              (id, source_sha256, source_filename, mode, report_json, applied_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            row.id,
            row.source_sha256,
            row.source_filename,
            row.mode,
            row.report_json,
            row.applied_at,
          );
      }
    }
  } finally {
    previous.close();
  }
}

function saveBaselines(
  cloudDb: Database.Database,
  sourceDb: Database.Database,
  migrationId: string,
) {
  const source = orderSnapshots(sourceDb);
  const cloud = orderSnapshots(cloudDb);
  const keys = new Set([...source.keys(), ...cloud.keys()]);
  const now = new Date().toISOString();
  const upsert = cloudDb.prepare(`
    INSERT INTO cloud_migration_baselines
      (order_key, source_hash, cloud_hash, migration_id, updated_at)
    VALUES (@key, @sourceHash, @cloudHash, @migrationId, @updatedAt)
    ON CONFLICT(order_key) DO UPDATE SET
      source_hash = excluded.source_hash,
      cloud_hash = excluded.cloud_hash,
      migration_id = excluded.migration_id,
      updated_at = excluded.updated_at
  `);

  for (const key of keys) {
    upsert.run({
      key,
      sourceHash: source.get(key)?.hash ?? null,
      cloudHash: cloud.get(key)?.hash ?? null,
      migrationId,
      updatedAt: now,
    });
  }
}

function removeDatabaseSidecars(databasePath: string) {
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
}

function restoreDatabase(backupPath: string) {
  closeDatabaseForMigration();
  const databasePath = getDatabasePath();
  fs.rmSync(databasePath, { force: true });
  removeDatabaseSidecars(databasePath);
  fs.copyFileSync(backupPath, databasePath);
  reopenDatabaseAfterMigration();
}

function writeReport(report: MigrationReport) {
  fs.mkdirSync(reportRoot(), { recursive: true });
  fs.writeFileSync(reportJsonPath(report.id), JSON.stringify(report, null, 2));
}

function recordMigration(
  db: Database.Database,
  report: MigrationReport,
) {
  db.prepare(`
    INSERT INTO cloud_migrations
      (id, source_sha256, source_filename, mode, report_json, applied_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    report.id,
    report.sourceSha256,
    report.sourceFilename,
    report.mode,
    JSON.stringify(report),
    report.completedAt,
  );
}

export async function applyMigration(
  sessionId: string,
  mode: MigrationMode,
  resolutions: Record<string, MigrationResolution>,
) {
  const session = readSession(sessionId);
  const release = acquireMigrationMaintenance(
    mode === "replace" ? "正在完整替换云端数据库" : "正在安全合并订单数据库",
  );
  let backupPath = "";
  let changedDatabase = false;

  try {
    const sourceDb = new Database(session.preparedPath, {
      fileMustExist: true,
      readonly: true,
    });
    const cloudBefore = new Database(getDatabasePath(), {
      fileMustExist: true,
      readonly: true,
    });
    let comparison: ReturnType<typeof buildDiffs>;

    try {
      comparison = buildDiffs(sourceDb, cloudBefore);
      if (comparison.cloudFingerprint !== session.cloudFingerprint) {
        throw new Error("预览后云端订单已经变化，请重新上传并生成预览");
      }
      if (wasSourceImported(cloudBefore, session.sourceSha256)) {
        throw new Error("这份备份已经迁移过，系统已阻止重复执行");
      }
      if (
        mode === "replace" &&
        session.source.orders === 0 &&
        session.cloud.orders > 0
      ) {
        throw new Error(
          "备份中没有订单，系统已阻止用空库覆盖现有云端订单",
        );
      }
    } finally {
      sourceDb.close();
      cloudBefore.close();
    }

    const backup = await createDatabaseBackupFile("before-cloud-migration");
    backupPath = backup.path;
    const sessionSecret = getAppMeta("session_secret");
    const adminPasswordHash = getAppMeta("admin_password_hash");
    const startedAt = new Date().toISOString();
    const reportId = randomUUID();
    let created = 0;
    let updatedFromSource = 0;
    let keptCloud = 0;
    let conflictsResolved = 0;

    closeDatabaseForMigration();

    if (mode === "replace") {
      const swapPath = path.join(
        getDataDirectory(),
        `.orders-migration-${reportId}.db`,
      );
      fs.copyFileSync(session.preparedPath, swapPath);
      const swapDb = new Database(swapPath);
      try {
        ensureDatabaseSchema(swapDb);
        ensureMigrationTables(swapDb);
        setMetaValue(swapDb, "session_secret", sessionSecret);
        setMetaValue(swapDb, "admin_password_hash", adminPasswordHash);
        swapDb.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        swapDb.close();
        removeDatabaseSidecars(swapPath);
      }

      const displacedPath = path.join(
        path.dirname(backupPath),
        `jeff-order-displaced-${reportId}.db`,
      );
      removeDatabaseSidecars(getDatabasePath());
      fs.renameSync(getDatabasePath(), displacedPath);
      changedDatabase = true;
      fs.renameSync(swapPath, getDatabasePath());
      created = session.source.orders;
    } else {
      const source = new Database(session.preparedPath, {
        fileMustExist: true,
        readonly: true,
      });
      const cloud = new Database(getDatabasePath());
      try {
        cloud.pragma("foreign_keys = ON");
        ensureDatabaseSchema(cloud);
        ensureMigrationTables(cloud);
        const sourceSnapshots = orderSnapshots(source);
        const cloudSnapshots = orderSnapshots(cloud);

        cloud.transaction(() => {
          for (const diff of comparison.diffs) {
            const sourceOrder = sourceSnapshots.get(diff.key);
            const cloudOrder = cloudSnapshots.get(diff.key);
            const automaticSource =
              diff.category === "source_only" ||
              diff.category === "local_changed";
            const sourceChosen =
              automaticSource ||
              (diff.category === "conflict" &&
                resolutions[diff.id] === "source");

            if (diff.category === "conflict") {
              if (!resolutions[diff.id]) {
                throw new Error(
                  `请选择冲突订单的处理方式：${diff.companyName || "未选公司"} / ${diff.code}`,
                );
              }
              conflictsResolved += 1;
            }

            if (sourceChosen && sourceOrder) {
              replaceOrderFromSource(source, cloud, sourceOrder, cloudOrder);
              if (cloudOrder) {
                updatedFromSource += 1;
              } else {
                created += 1;
              }
            } else if (cloudOrder) {
              keptCloud += 1;
            }
          }
        })();
        cloud.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        source.close();
        cloud.close();
      }
      changedDatabase = true;
    }

    const finalCloud = new Database(getDatabasePath());
    const finalSource = new Database(session.preparedPath, {
      fileMustExist: true,
      readonly: true,
    });
    let report: MigrationReport;

    try {
      finalCloud.pragma("foreign_keys = ON");
      ensureDatabaseSchema(finalCloud);
      ensureMigrationTables(finalCloud);
      preservePreviousMigrationHistory(backupPath, finalCloud);
      const integrity = String(
        finalCloud.pragma("integrity_check", { simple: true }),
      );
      if (integrity !== "ok") {
        throw new Error(`迁移后数据库完整性检查失败：${integrity}`);
      }

      report = {
        id: reportId,
        sessionId,
        mode,
        sourceFilename: session.sourceFilename,
        sourceSha256: session.sourceSha256,
        backupFilename: path.basename(backupPath),
        startedAt,
        completedAt: new Date().toISOString(),
        sourceOrders: session.source.orders,
        cloudOrdersBefore: session.cloud.orders,
        cloudOrdersAfter: databaseSummary(finalCloud).orders,
        created,
        updatedFromSource,
        keptCloud,
        conflictsResolved,
        integrity,
      };
      saveBaselines(finalCloud, finalSource, reportId);
      recordMigration(finalCloud, report);
      finalCloud.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      finalSource.close();
      finalCloud.close();
    }

    reopenDatabaseAfterMigration();
    writeReport(report);
    removeSessionDirectory(sessionId);
    return report;
  } catch (error) {
    if (changedDatabase && backupPath) {
      restoreDatabase(backupPath);
    } else {
      reopenDatabaseAfterMigration();
    }
    throw error;
  } finally {
    release();
  }
}

export function getMigrationReport(reportId: string) {
  const filePath = reportJsonPath(reportId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationReport;
}

export function getRecentMigrationReports(limit = 10) {
  if (!fs.existsSync(reportRoot())) {
    return [];
  }

  return fs
    .readdirSync(reportRoot(), { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".json"))
    .map((item) => getMigrationReport(item.name.replace(/\.json$/u, "")))
    .filter((item): item is MigrationReport => Boolean(item))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, limit);
}

export async function rollbackLatestMigration(reportId: string) {
  const report = getMigrationReport(reportId);
  if (!report) {
    throw new Error("迁移报告不存在");
  }
  if (report.rolledBackAt) {
    throw new Error("这次迁移已经回滚过");
  }

  const backupRoot = path.resolve(getBackupDirectory());
  if (path.basename(report.backupFilename) !== report.backupFilename) {
    throw new Error("迁移备份文件名无效");
  }
  const restorePath = path.resolve(backupRoot, report.backupFilename);
  if (path.dirname(restorePath) !== backupRoot || !fs.existsSync(restorePath)) {
    throw new Error("迁移前备份已不存在，不能自动回滚");
  }

  const release = acquireMigrationMaintenance("正在回滚最近一次云端数据迁移");
  let safetyBackupPath = "";
  let restoreStarted = false;

  try {
    const current = new Database(getDatabasePath(), {
      fileMustExist: true,
      readonly: true,
    });
    try {
      if (!tableExists(current, "cloud_migrations")) {
        throw new Error("当前数据库没有可回滚的迁移记录");
      }
      const latest = current
        .prepare(
          "SELECT id FROM cloud_migrations ORDER BY applied_at DESC, id DESC LIMIT 1",
        )
        .get() as { id: string } | undefined;
      if (latest?.id !== report.id) {
        throw new Error("只能回滚当前数据库最近一次迁移");
      }
    } finally {
      current.close();
    }

    const safetyBackup = await createDatabaseBackupFile(
      "before-migration-rollback",
    );
    safetyBackupPath = safetyBackup.path;
    closeDatabaseForMigration();
    restoreStarted = true;
    restoreDatabase(restorePath);

    const restored = new Database(getDatabasePath(), {
      fileMustExist: true,
      readonly: true,
    });
    try {
      const integrity = String(
        restored.pragma("integrity_check", { simple: true }),
      );
      if (integrity !== "ok") {
        throw new Error(`回滚后数据库完整性检查失败：${integrity}`);
      }
    } finally {
      restored.close();
    }

    const rolledBackAt = new Date().toISOString();
    const updatedReport: MigrationReport = {
      ...report,
      rolledBackAt,
      rollbackBackupFilename: path.basename(safetyBackupPath),
    };
    writeReport(updatedReport);
    return updatedReport;
  } catch (error) {
    if (restoreStarted && safetyBackupPath) {
      restoreDatabase(safetyBackupPath);
    } else {
      reopenDatabaseAfterMigration();
    }
    throw error;
  } finally {
    release();
  }
}
