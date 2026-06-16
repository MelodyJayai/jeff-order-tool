import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  calculateTotalQuantity,
  type ProductQuantityKey,
} from "@/lib/catalog";
import { chinaToday, cleanDate, nowIso, optionalDate } from "@/lib/date";
import type {
  CreateOrdersInput,
  ImportOrderInput,
  ImportOrdersResult,
  OrderEventType,
  OrderEventRecord,
  OrderRecord,
  OrderStatus,
  ReturnOrderInput,
  UpdateOrderInput,
  UrgencyLevel,
} from "@/lib/types";

type OrderRow = {
  id: string;
  code: string;
  company_name: string | null;
  factory_name: string | null;
  first_delivery: string | null;
  customer_name: string | null;
  product_name: string | null;
  quantity: number;
  suit_quantity: number | null;
  jacket_quantity: number | null;
  pant_quantity: number | null;
  vest_quantity: number | null;
  coat_quantity: number | null;
  extra_fee: number | null;
  registered_at: string;
  status: string;
  written_off_at: string | null;
  returned_at: string | null;
  return_note: string | null;
  return_suit_quantity: number | null;
  return_jacket_quantity: number | null;
  return_pant_quantity: number | null;
  return_vest_quantity: number | null;
  return_coat_quantity: number | null;
  urgency: string;
  partial_quantity: number | null;
  partial_date: string | null;
  partial_note: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type OrderEventRow = {
  id: string;
  order_id: string;
  order_code: string | null;
  type: string;
  detail: string | null;
  created_at: string;
};

const globalForDb = globalThis as typeof globalThis & {
  __jeffOrderDb?: Database.Database;
};

const DB_PATH = process.env.JEFF_ORDER_DB_PATH
  ? path.resolve(process.env.JEFF_ORDER_DB_PATH)
  : path.join(process.cwd(), "data", "orders.db");
const BACKUP_DIR = process.env.JEFF_BACKUP_DIR
  ? path.resolve(process.env.JEFF_BACKUP_DIR)
  : path.join(path.dirname(DB_PATH), "backups");
const SCHEMA_VERSION = "2026-06-08-v5-first-delivery";

function productValues(input: Record<ProductQuantityKey, number>) {
  return {
    suitQuantity: input.suitQuantity,
    jacketQuantity: input.jacketQuantity,
    pantQuantity: input.pantQuantity,
    vestQuantity: input.vestQuantity,
    coatQuantity: input.coatQuantity,
  };
}

type ReturnQuantityKey =
  | "returnSuitQuantity"
  | "returnJacketQuantity"
  | "returnPantQuantity"
  | "returnVestQuantity"
  | "returnCoatQuantity";

const RETURN_QUANTITY_FIELDS = [
  { key: "suitQuantity", returnKey: "returnSuitQuantity", label: "套装" },
  { key: "jacketQuantity", returnKey: "returnJacketQuantity", label: "单衫" },
  { key: "pantQuantity", returnKey: "returnPantQuantity", label: "单裤" },
  { key: "vestQuantity", returnKey: "returnVestQuantity", label: "马甲" },
  { key: "coatQuantity", returnKey: "returnCoatQuantity", label: "大衣" },
] as const satisfies ReadonlyArray<{
  key: ProductQuantityKey;
  returnKey: ReturnQuantityKey;
  label: string;
}>;

function returnProductValues(input: ReturnOrderInput | ImportOrderInput) {
  return {
    returnSuitQuantity: input.returnSuitQuantity,
    returnJacketQuantity: input.returnJacketQuantity,
    returnPantQuantity: input.returnPantQuantity,
    returnVestQuantity: input.returnVestQuantity,
    returnCoatQuantity: input.returnCoatQuantity,
  };
}

function returnQuantityTotal(
  input: Pick<
    ReturnOrderInput,
    | "returnSuitQuantity"
    | "returnJacketQuantity"
    | "returnPantQuantity"
    | "returnVestQuantity"
    | "returnCoatQuantity"
  >,
) {
  return (
    input.returnSuitQuantity +
    input.returnJacketQuantity +
    input.returnPantQuantity +
    input.returnVestQuantity +
    input.returnCoatQuantity
  );
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(db: Database.Database, table: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;

  return new Set(rows.map((row) => row.name));
}

function textValue(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim();
}

function positiveValue(
  row: Record<string, unknown>,
  key: string,
  fallback = 0,
) {
  const value = Number.parseInt(textValue(row, key), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nullablePositiveValue(row: Record<string, unknown>, key: string) {
  const value = positiveValue(row, key, 0);
  return value > 0 ? value : null;
}

function sqliteImportStatus(
  row: Record<string, unknown>,
  writtenOffAt: string | null,
  returnedAt: string | null,
): OrderStatus {
  const status = toStatus(textValue(row, "status"));

  if (status !== "PENDING") {
    return status;
  }

  if (returnedAt) {
    return "RETURNED";
  }

  if (writtenOffAt) {
    return "WRITTEN_OFF";
  }

  if (
    nullablePositiveValue(row, "partial_quantity") ||
    optionalDate(textValue(row, "partial_date")) ||
    textValue(row, "partial_note")
  ) {
    return "PARTIAL";
  }

  return "PENDING";
}

function returnQuantityLimitMessage(
  input: ReturnOrderInput,
  order: OrderRecord,
) {
  const categoryTotal = calculateTotalQuantity(productValues(order));

  if (categoryTotal <= 0) {
    return returnQuantityTotal(input) > order.quantity
      ? "返厂总数不能超过原订单总数"
      : null;
  }

  const exceededLabels = RETURN_QUANTITY_FIELDS.filter(
    (item) => input[item.returnKey] > order[item.key],
  ).map((item) => item.label);

  return exceededLabels.length > 0
    ? `${exceededLabels.join("、")}返厂数量不能超过原订单数量`
    : null;
}

function totalQuantity(input: Record<ProductQuantityKey, number>, fallback = 1) {
  const total = calculateTotalQuantity(input);
  return total > 0 ? total : fallback;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;

  if (!columns.some((item) => item.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  }
}

function createOrdersTableSql(tableName: string) {
  return `
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE,
      company_name TEXT,
      factory_name TEXT,
      first_delivery TEXT,
      customer_name TEXT,
      product_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      suit_quantity INTEGER NOT NULL DEFAULT 0,
      jacket_quantity INTEGER NOT NULL DEFAULT 0,
      pant_quantity INTEGER NOT NULL DEFAULT 0,
      vest_quantity INTEGER NOT NULL DEFAULT 0,
      coat_quantity INTEGER NOT NULL DEFAULT 0,
      extra_fee INTEGER NOT NULL DEFAULT 0,
      registered_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      written_off_at TEXT,
      returned_at TEXT,
      return_note TEXT,
      return_suit_quantity INTEGER NOT NULL DEFAULT 0,
      return_jacket_quantity INTEGER NOT NULL DEFAULT 0,
      return_pant_quantity INTEGER NOT NULL DEFAULT 0,
      return_vest_quantity INTEGER NOT NULL DEFAULT 0,
      return_coat_quantity INTEGER NOT NULL DEFAULT 0,
      urgency TEXT NOT NULL DEFAULT 'NORMAL',
      partial_quantity INTEGER,
      partial_date TEXT,
      partial_note TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;
}

function hasGlobalCodeUniqueConstraint(db: Database.Database) {
  const indexes = db.prepare("PRAGMA index_list('orders')").all() as Array<{
    name: string;
    unique: number;
  }>;

  return indexes.some((index) => {
    if (!index.unique) {
      return false;
    }

    const columns = db
      .prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`)
      .all() as Array<{ name: string }>;

    return columns.length === 1 && columns[0]?.name === "code";
  });
}

function rebuildOrdersWithoutGlobalCodeUnique(db: Database.Database) {
  if (!hasGlobalCodeUniqueConstraint(db)) {
    return;
  }

  const previousForeignKeys = db.pragma("foreign_keys", { simple: true }) as
    | number
    | string;
  db.pragma("foreign_keys = OFF");

  try {
    db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS orders_v3_company_code");
      db.exec(createOrdersTableSql("orders_v3_company_code"));
      db.exec(`
        INSERT INTO orders_v3_company_code (
          id, code, company_name, factory_name, first_delivery, customer_name, product_name,
          quantity, suit_quantity, jacket_quantity, pant_quantity,
          vest_quantity, coat_quantity, extra_fee, registered_at, status,
          written_off_at, returned_at, return_note,
          return_suit_quantity, return_jacket_quantity, return_pant_quantity,
          return_vest_quantity, return_coat_quantity, urgency,
          partial_quantity, partial_date, partial_note, note, created_at, updated_at
        )
        SELECT
          id, code, company_name, factory_name, first_delivery, customer_name, product_name,
          quantity, suit_quantity, jacket_quantity, pant_quantity,
          vest_quantity, coat_quantity, extra_fee, registered_at, status,
          written_off_at, returned_at, return_note,
          return_suit_quantity, return_jacket_quantity, return_pant_quantity,
          return_vest_quantity, return_coat_quantity, urgency,
          partial_quantity, partial_date, partial_note, note, created_at, updated_at
        FROM orders
      `);
      db.exec("DROP TABLE orders");
      db.exec("ALTER TABLE orders_v3_company_code RENAME TO orders");
    })();
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? "ON" : "OFF"}`);
  }

  recordMigration(db, "2026-06-07-v3-remove-global-code-unique");
}

function ensureOrderIndexes(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
    CREATE INDEX IF NOT EXISTS idx_orders_status_urgency ON orders(status, urgency);
    CREATE INDEX IF NOT EXISTS idx_orders_registered_at ON orders(registered_at);
    CREATE INDEX IF NOT EXISTS idx_orders_written_off_at ON orders(written_off_at);
    CREATE INDEX IF NOT EXISTS idx_orders_company_factory ON orders(company_name, factory_name);
  `);

  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_company_code_unique
     ON orders(lower(trim(ifnull(company_name, ''))), lower(trim(code)))`,
  ).run();
}

function recordMigration(db: Database.Database, name: string) {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (name, applied_at)
     VALUES (?, ?)`,
  ).run(name, nowIso());
}

function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

function getMeta(db: Database.Database, key: string) {
  const row = db
    .prepare("SELECT value FROM app_meta WHERE key = ? LIMIT 1")
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_events_created_at ON order_events(created_at);
  `);

  const ordersTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
    )
    .get();

  if (!ordersTable) {
    db.exec(createOrdersTableSql("orders"));
  }

  ensureColumn(db, "orders", "company_name", "company_name TEXT");
  ensureColumn(db, "orders", "factory_name", "factory_name TEXT");
  ensureColumn(db, "orders", "first_delivery", "first_delivery TEXT");
  ensureColumn(
    db,
    "orders",
    "suit_quantity",
    "suit_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "jacket_quantity",
    "jacket_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "pant_quantity",
    "pant_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "vest_quantity",
    "vest_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "coat_quantity",
    "coat_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(db, "orders", "extra_fee", "extra_fee INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "returned_at", "returned_at TEXT");
  ensureColumn(db, "orders", "return_note", "return_note TEXT");
  ensureColumn(
    db,
    "orders",
    "return_suit_quantity",
    "return_suit_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "return_jacket_quantity",
    "return_jacket_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "return_pant_quantity",
    "return_pant_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "return_vest_quantity",
    "return_vest_quantity INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "orders",
    "return_coat_quantity",
    "return_coat_quantity INTEGER NOT NULL DEFAULT 0",
  );
  rebuildOrdersWithoutGlobalCodeUnique(db);
  ensureOrderIndexes(db);
  recordMigration(db, "2026-06-03-v1-core-orders");
  recordMigration(db, "2026-06-03-v1-product-quantities");
  recordMigration(db, "2026-06-06-v2-company-factory");
  recordMigration(db, "2026-06-07-v3-company-code-identity");
  recordMigration(db, "2026-06-07-v4-return-quantities");
  recordMigration(db, "2026-06-08-v5-first-delivery");
  setMeta(db, "schema_version", SCHEMA_VERSION);
  setMeta(db, "app_name", "jeff-order-tool");
}

function getDb() {
  if (globalForDb.__jeffOrderDb) {
    ensureSchema(globalForDb.__jeffOrderDb);
    return globalForDb.__jeffOrderDb;
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);

  globalForDb.__jeffOrderDb = db;
  return db;
}

function toStatus(value: string): OrderStatus {
  if (value === "PARTIAL" || value === "RETURNED" || value === "WRITTEN_OFF") {
    return value;
  }
  return "PENDING";
}

function toUrgency(value: string): UrgencyLevel {
  if (value === "URGENT" || value === "VERY_URGENT") {
    return value;
  }
  return "NORMAL";
}

function mapOrder(row: OrderRow): OrderRecord {
  const quantities = {
    suitQuantity: row.suit_quantity ?? 0,
    jacketQuantity: row.jacket_quantity ?? 0,
    pantQuantity: row.pant_quantity ?? 0,
    vestQuantity: row.vest_quantity ?? 0,
    coatQuantity: row.coat_quantity ?? 0,
  };
  const returnQuantities = {
    returnSuitQuantity: row.return_suit_quantity ?? 0,
    returnJacketQuantity: row.return_jacket_quantity ?? 0,
    returnPantQuantity: row.return_pant_quantity ?? 0,
    returnVestQuantity: row.return_vest_quantity ?? 0,
    returnCoatQuantity: row.return_coat_quantity ?? 0,
  };

  return {
    id: row.id,
    code: row.code,
    companyName: row.company_name ?? "",
    factoryName: row.factory_name ?? "",
    firstDelivery: row.first_delivery ?? "",
    customerName: row.customer_name ?? "",
    quantity: row.quantity,
    ...quantities,
    ...returnQuantities,
    registeredAt: row.registered_at,
    status: toStatus(row.status),
    writtenOffAt: row.written_off_at,
    returnedAt: row.returned_at,
    returnNote: row.return_note ?? "",
    urgency: toUrgency(row.urgency),
    partialQuantity: row.partial_quantity,
    partialDate: row.partial_date,
    partialNote: row.partial_note ?? "",
    note: row.note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertEvent(
  db: Database.Database,
  orderId: string,
  type: OrderEventType,
  detail?: string,
) {
  db.prepare(
    `INSERT INTO order_events (id, order_id, type, detail, created_at)
     VALUES (@id, @orderId, @type, @detail, @createdAt)`,
  ).run({
    id: randomUUID(),
    orderId,
    type,
    detail: detail ?? null,
    createdAt: nowIso(),
  });
}

function toEventType(value: string): OrderEventType {
  if (
    value === "UPDATED" ||
    value === "PARTIAL" ||
    value === "RETURNED" ||
    value === "WRITTEN_OFF" ||
    value === "RETURN_RESOLVED" ||
    value === "UNDO_WRITTEN_OFF"
  ) {
    return value;
  }

  return "CREATED";
}

function mapEvent(row: OrderEventRow): OrderEventRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    orderCode: row.order_code ?? "",
    type: toEventType(row.type),
    detail: row.detail ?? "",
    createdAt: row.created_at,
  };
}

export function listOrders() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM orders
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all() as OrderRow[];

  return rows.map(mapOrder);
}

export function getAppMeta(key: string) {
  return getMeta(getDb(), key);
}

export function setAppMeta(key: string, value: string) {
  setMeta(getDb(), key, value);
}

export function getStoredAdminPasswordHash() {
  return getAppMeta("admin_password_hash");
}

export function setStoredAdminPasswordHash(hash: string) {
  setAppMeta("admin_password_hash", hash);
}

export function getDatabasePath() {
  return DB_PATH;
}

export function getDataDirectory() {
  return path.dirname(DB_PATH);
}

export function getOrCreateSessionSecret() {
  const db = getDb();
  const current = getMeta(db, "session_secret");

  if (current) {
    return current;
  }

  const secret = randomBytes(32).toString("base64url");
  setMeta(db, "session_secret", secret);
  return secret;
}

function retentionDays() {
  const parsed = Number.parseInt(
    process.env.JEFF_BACKUP_RETENTION_DAYS ?? "30",
    10,
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function backupTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

function cleanupBackupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return;
  }

  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;

  for (const item of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
    if (!item.isFile() || !/^jeff-order-.*\.db$/u.test(item.name)) {
      continue;
    }

    const filePath = path.join(BACKUP_DIR, item.name);
    const stat = fs.statSync(filePath);

    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function findOrderByCompanyCode(
  db: Database.Database,
  companyName: string,
  code: string,
  excludeId?: string,
) {
  return db
    .prepare(
      `SELECT id FROM orders
       WHERE lower(trim(code)) = lower(trim(@code))
         AND lower(trim(ifnull(company_name, ''))) = lower(trim(@companyName))
         AND (@excludeId IS NULL OR id <> @excludeId)
       LIMIT 1`,
    )
    .get({
      code,
      companyName,
      excludeId: excludeId ?? null,
    }) as { id: string } | undefined;
}

function duplicateLabel(companyName: string, code: string) {
  return `${companyName || "未选公司"} / ${code}`;
}

export async function createDatabaseBackupFile(kind = "manual") {
  const db = getDb();
  const cleanKind = kind.replaceAll(/[^a-z0-9-]/giu, "-").toLowerCase();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const filename = `jeff-order-${cleanKind}-${backupTimestamp()}.db`;
  const backupPath = path.join(BACKUP_DIR, filename);
  await db.backup(backupPath);
  cleanupBackupFiles();

  const stat = fs.statSync(backupPath);
  setMeta(db, `last_${cleanKind}_backup_at`, nowIso());

  return {
    filename,
    path: backupPath,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  };
}

export async function ensureDailyDatabaseBackup() {
  const db = getDb();
  const today = chinaToday();

  if (getMeta(db, "last_daily_backup_date") === today) {
    return null;
  }

  const backup = await createDatabaseBackupFile("daily");
  setMeta(db, "last_daily_backup_date", today);
  return backup;
}

export function getBackupSummary() {
  const db = getDb();
  const files = fs.existsSync(BACKUP_DIR)
    ? fs
        .readdirSync(BACKUP_DIR, { withFileTypes: true })
        .filter((item) => item.isFile() && /^jeff-order-.*\.db$/u.test(item.name))
        .map((item) => {
          const filePath = path.join(BACKUP_DIR, item.name);
          const stat = fs.statSync(filePath);

          return {
            filename: item.name,
            path: filePath,
            sizeBytes: stat.size,
            createdAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return {
    directory: BACKUP_DIR,
    files,
    latest: files[0] ?? null,
    lastDailyBackupDate: getMeta(db, "last_daily_backup_date"),
    retentionDays: retentionDays(),
  };
}

export function getDatabaseSummary() {
  const db = getDb();
  const orderRow = db.prepare("SELECT COUNT(*) AS count FROM orders").get() as {
    count: number;
  };
  const eventRow = db
    .prepare("SELECT COUNT(*) AS count FROM order_events")
    .get() as { count: number };
  const stat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;

  return {
    path: DB_PATH,
    exists: Boolean(stat),
    sizeBytes: stat?.size ?? 0,
    orders: orderRow.count,
    events: eventRow.count,
    schemaVersion: getMeta(db, "schema_version") ?? SCHEMA_VERSION,
    updatedAt: stat?.mtime.toISOString() ?? null,
  };
}

export async function createDatabaseBackup() {
  const db = getDb();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-order-backup-"));
  const backupPath = path.join(tempDir, "orders-backup.db");

  try {
    await db.backup(backupPath);
    return fs.readFileSync(backupPath);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

export function listOrderEvents(limit = 80) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.id,
              e.order_id,
              o.code AS order_code,
              e.type,
              e.detail,
              e.created_at
       FROM order_events e
       LEFT JOIN orders o ON o.id = e.order_id
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as OrderEventRow[];

  return rows.map(mapEvent);
}

export function getOrder(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as
    | OrderRow
    | undefined;

  return row ? mapOrder(row) : null;
}

export function createOrders(input: CreateOrdersInput) {
  const db = getDb();

  return db.transaction(() => {
    const now = nowIso();
    const skipped: string[] = [];
    let created = 0;

    const insert = db.prepare(`
      INSERT INTO orders (
        id, code, company_name, factory_name, first_delivery, customer_name, quantity,
        suit_quantity, jacket_quantity, pant_quantity, vest_quantity,
        coat_quantity, registered_at, status, urgency, note,
        created_at, updated_at
      )
      VALUES (
        @id, @code, @companyName, @factoryName, @firstDelivery, @customerName, @quantity,
        @suitQuantity, @jacketQuantity, @pantQuantity, @vestQuantity,
        @coatQuantity, @registeredAt, 'PENDING', @urgency, @note,
        @createdAt, @updatedAt
      )
    `);
    const quantities = productValues(input);
    const quantity = totalQuantity(quantities, input.quantity);

    for (const code of input.codes) {
      if (findOrderByCompanyCode(db, input.companyName, code)) {
        skipped.push(duplicateLabel(input.companyName, code));
        continue;
      }

      const id = randomUUID();
      insert.run({
        id,
        code,
        companyName: input.companyName || null,
        factoryName: input.factoryName || null,
        firstDelivery: input.firstDelivery || null,
        customerName: input.customerName || null,
        quantity,
        ...quantities,
        registeredAt: input.registeredAt,
        urgency: input.urgency,
        note: input.note || null,
        createdAt: now,
        updatedAt: now,
      });
      insertEvent(
        db,
        id,
        "CREATED",
        `登记号码 ${code}；公司 ${input.companyName || "未选公司"}${
          input.firstDelivery ? `；${input.firstDelivery}` : ""
        }`,
      );
      created += 1;
    }

    return { created, skipped };
  })();
}

export function importOrders(input: ImportOrderInput[]): ImportOrdersResult {
  const db = getDb();

  return db.transaction(() => {
    const now = nowIso();
    const skipped: string[] = [];
    let created = 0;
    let updated = 0;

    const insert = db.prepare(`
      INSERT INTO orders (
        id, code, company_name, factory_name, first_delivery, customer_name, quantity,
        suit_quantity, jacket_quantity, pant_quantity, vest_quantity,
        coat_quantity, registered_at, status, written_off_at, urgency,
        returned_at, return_note, return_suit_quantity, return_jacket_quantity,
        return_pant_quantity, return_vest_quantity, return_coat_quantity,
        partial_quantity, partial_date, partial_note, note,
        created_at, updated_at
      )
      VALUES (
        @id, @code, @companyName, @factoryName, @firstDelivery, @customerName, @quantity,
        @suitQuantity, @jacketQuantity, @pantQuantity, @vestQuantity,
        @coatQuantity, @registeredAt, @status, @writtenOffAt, @urgency,
        @returnedAt, @returnNote, @returnSuitQuantity, @returnJacketQuantity,
        @returnPantQuantity, @returnVestQuantity, @returnCoatQuantity,
        @partialQuantity, @partialDate, @partialNote, @note,
        @createdAt, @updatedAt
      )
    `);
    const update = db.prepare(`
      UPDATE orders
      SET company_name = @companyName,
          factory_name = @factoryName,
          first_delivery = @firstDelivery,
          customer_name = @customerName,
          quantity = @quantity,
          suit_quantity = @suitQuantity,
          jacket_quantity = @jacketQuantity,
          pant_quantity = @pantQuantity,
          vest_quantity = @vestQuantity,
          coat_quantity = @coatQuantity,
          registered_at = @registeredAt,
          status = @status,
          written_off_at = @writtenOffAt,
          returned_at = @returnedAt,
          return_note = @returnNote,
          return_suit_quantity = @returnSuitQuantity,
          return_jacket_quantity = @returnJacketQuantity,
          return_pant_quantity = @returnPantQuantity,
          return_vest_quantity = @returnVestQuantity,
          return_coat_quantity = @returnCoatQuantity,
          urgency = @urgency,
          partial_quantity = @partialQuantity,
          partial_date = @partialDate,
          partial_note = @partialNote,
          note = @note,
          updated_at = @updatedAt
      WHERE id = @id
    `);

    for (const item of input) {
      const code = item.code.trim();

      if (!code) {
        skipped.push("(空订单号)");
        continue;
      }

      const quantities = productValues(item);
      const returnQuantities = returnProductValues(item);
      const quantity = totalQuantity(quantities, item.quantity);
      const current = findOrderByCompanyCode(db, item.companyName, code);
      const values = {
        id: current?.id ?? randomUUID(),
        code,
        companyName: item.companyName || null,
        factoryName: item.factoryName || null,
        firstDelivery: item.firstDelivery || null,
        customerName: item.customerName || null,
        quantity,
        ...quantities,
        registeredAt: item.registeredAt,
        status: item.status,
        writtenOffAt: item.status === "WRITTEN_OFF" ? item.writtenOffAt : null,
        returnedAt: item.status === "RETURNED" ? item.returnedAt : null,
        returnNote: item.returnNote || null,
        ...returnQuantities,
        urgency: item.urgency,
        partialQuantity: item.partialQuantity,
        partialDate: item.partialDate,
        partialNote: item.partialNote || null,
        note: item.note || null,
        createdAt: now,
        updatedAt: now,
      };

      if (current) {
        update.run(values);
        insertEvent(db, current.id, "UPDATED", `导入更新 ${code}`);
        updated += 1;
      } else {
        insert.run(values);
        insertEvent(db, values.id, "CREATED", `导入订单 ${code}`);
        created += 1;
      }
    }

    return { created, updated, skipped };
  })();
}

export function importOrdersFromSqliteBackup(sourcePath: string) {
  const sourceDb = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    if (!tableExists(sourceDb, "orders")) {
      return { created: 0, updated: 0, skipped: ["文件里没有 orders 表"] };
    }

    const columns = tableColumns(sourceDb, "orders");

    if (!columns.has("code")) {
      return { created: 0, updated: 0, skipped: ["orders 表里没有订单号字段"] };
    }

    const orderBy = columns.has("created_at") ? " ORDER BY created_at" : "";
    const rows = sourceDb
      .prepare(`SELECT * FROM orders${orderBy}`)
      .all() as Array<Record<string, unknown>>;
    const importRows = rows.flatMap((row): ImportOrderInput[] => {
      const code = textValue(row, "code");

      if (!code) {
        return [];
      }

      const writtenOffAt = optionalDate(textValue(row, "written_off_at"));
      const returnedAt = optionalDate(textValue(row, "returned_at"));
      const status = sqliteImportStatus(row, writtenOffAt, returnedAt);

      return [
        {
          code,
          codes: [code],
          companyName: textValue(row, "company_name"),
          factoryName: textValue(row, "factory_name"),
          firstDelivery: textValue(row, "first_delivery"),
          customerName: textValue(row, "customer_name"),
          quantity: positiveValue(row, "quantity", 1),
          suitQuantity: positiveValue(row, "suit_quantity"),
          jacketQuantity: positiveValue(row, "jacket_quantity"),
          pantQuantity: positiveValue(row, "pant_quantity"),
          vestQuantity: positiveValue(row, "vest_quantity"),
          coatQuantity: positiveValue(row, "coat_quantity"),
          registeredAt: cleanDate(textValue(row, "registered_at"), chinaToday()),
          status,
          writtenOffAt,
          returnedAt,
          returnNote: textValue(row, "return_note"),
          returnSuitQuantity: positiveValue(row, "return_suit_quantity"),
          returnJacketQuantity: positiveValue(row, "return_jacket_quantity"),
          returnPantQuantity: positiveValue(row, "return_pant_quantity"),
          returnVestQuantity: positiveValue(row, "return_vest_quantity"),
          returnCoatQuantity: positiveValue(row, "return_coat_quantity"),
          urgency: toUrgency(textValue(row, "urgency")),
          partialQuantity: nullablePositiveValue(row, "partial_quantity"),
          partialDate: optionalDate(textValue(row, "partial_date")),
          partialNote: textValue(row, "partial_note"),
          note: textValue(row, "note"),
        },
      ];
    });

    if (importRows.length === 0) {
      return { created: 0, updated: 0, skipped: ["没有找到可导入的订单号"] };
    }

    return importOrders(importRows);
  } finally {
    sourceDb.close();
  }
}

export function updateOrder(input: UpdateOrderInput) {
  const db = getDb();
  const current = getOrder(input.id);

  if (!current) {
    return "missing" as const;
  }

  if (findOrderByCompanyCode(db, input.companyName, current.code, input.id)) {
    return "duplicate" as const;
  }

  const now = nowIso();
  const quantities = productValues(input);
  const quantity = totalQuantity(quantities, input.quantity);
  const hasPartial =
    Boolean(input.partialQuantity) ||
    Boolean(input.partialDate) ||
    input.partialNote.trim().length > 0;
  const status =
    current.status === "WRITTEN_OFF" || current.status === "RETURNED"
      ? current.status
      : hasPartial
        ? "PARTIAL"
        : "PENDING";

  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET company_name = @companyName,
          factory_name = @factoryName,
          first_delivery = @firstDelivery,
          customer_name = @customerName,
          quantity = @quantity,
          suit_quantity = @suitQuantity,
          jacket_quantity = @jacketQuantity,
          pant_quantity = @pantQuantity,
          vest_quantity = @vestQuantity,
          coat_quantity = @coatQuantity,
          registered_at = @registeredAt,
          status = @status,
          urgency = @urgency,
          partial_quantity = @partialQuantity,
          partial_date = @partialDate,
          partial_note = @partialNote,
          note = @note,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: input.id,
      companyName: input.companyName || null,
      factoryName: input.factoryName || null,
      firstDelivery: input.firstDelivery || null,
      customerName: input.customerName || null,
      quantity,
      ...quantities,
      registeredAt: input.registeredAt,
      status,
      urgency: input.urgency,
      partialQuantity: input.partialQuantity,
      partialDate: input.partialDate,
      partialNote: input.partialNote || null,
      note: input.note || null,
      updatedAt: now,
    });
    insertEvent(
      db,
      input.id,
      hasPartial ? "PARTIAL" : "UPDATED",
      hasPartial ? "更新部分交付信息" : "更新订单信息",
    );
  })();

  return "updated" as const;
}

export function writeOffOrder(id: string, writtenOffAt: string) {
  const db = getDb();
  const current = getOrder(id);

  if (!current) {
    return "missing" as const;
  }

  if (current.status === "WRITTEN_OFF") {
    return "already" as const;
  }

  const updated = db.transaction(() => {
    const result = db.prepare(`
      UPDATE orders
      SET status = 'WRITTEN_OFF',
          written_off_at = COALESCE(written_off_at, @writtenOffAt),
          updated_at = @updatedAt
      WHERE id = @id
        AND status <> 'WRITTEN_OFF'
    `).run({
      id,
      writtenOffAt,
      updatedAt: nowIso(),
    });

    if (result.changes === 0) {
      return false;
    }

    if (current.status === "RETURNED") {
      insertEvent(db, id, "RETURN_RESOLVED", `完成返厂 ${writtenOffAt}`);
      return "resolved" as const;
    }

    insertEvent(db, id, "WRITTEN_OFF", `出货日期 ${writtenOffAt}`);
    return "updated" as const;
  })();

  return updated || ("already" as const);
}

export function markOrderReturned(input: ReturnOrderInput) {
  const db = getDb();
  const current = getOrder(input.id);

  if (!current) {
    return "missing" as const;
  }

  if (current.status !== "WRITTEN_OFF" && current.status !== "RETURNED") {
    return "not_written_off" as const;
  }

  if (returnQuantityTotal(input) <= 0) {
    return "empty" as const;
  }

  if (returnQuantityLimitMessage(input, current)) {
    return "exceeds_quantity" as const;
  }

  const now = nowIso();
  const returnQuantities = returnProductValues(input);
  const eventPrefix =
    current.status === "RETURNED" ? "更新返厂修改" : "返厂修改";

  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET status = 'RETURNED',
          returned_at = @returnedAt,
          return_note = @returnNote,
          return_suit_quantity = @returnSuitQuantity,
          return_jacket_quantity = @returnJacketQuantity,
          return_pant_quantity = @returnPantQuantity,
          return_vest_quantity = @returnVestQuantity,
          return_coat_quantity = @returnCoatQuantity,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: input.id,
      returnedAt: input.returnedAt,
      returnNote: input.returnNote || null,
      ...returnQuantities,
      updatedAt: now,
    });

    const quantityText = [
      input.returnSuitQuantity ? `套装${input.returnSuitQuantity}` : "",
      input.returnJacketQuantity ? `单衫${input.returnJacketQuantity}` : "",
      input.returnPantQuantity ? `单裤${input.returnPantQuantity}` : "",
      input.returnVestQuantity ? `马甲${input.returnVestQuantity}` : "",
      input.returnCoatQuantity ? `大衣${input.returnCoatQuantity}` : "",
    ]
      .filter(Boolean)
      .join("、");

    insertEvent(
      db,
      input.id,
      "RETURNED",
      `${eventPrefix} ${input.returnedAt}：${quantityText}${
        input.returnNote ? `；${input.returnNote}` : ""
      }`,
    );
  })();

  return "updated" as const;
}

export function undoWriteOffOrder(id: string) {
  const db = getDb();
  const current = getOrder(id);

  if (!current) {
    return false;
  }

  const hasPartial =
    Boolean(current.partialQuantity) ||
    Boolean(current.partialDate) ||
    current.partialNote.trim().length > 0;

  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET status = @status,
          written_off_at = NULL,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      status: hasPartial ? "PARTIAL" : "PENDING",
      updatedAt: nowIso(),
    });
    insertEvent(db, id, "UNDO_WRITTEN_OFF", "撤销核销");
  })();

  return true;
}
