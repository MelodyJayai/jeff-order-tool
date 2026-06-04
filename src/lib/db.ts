import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  calculateTotalQuantity,
  type ProductQuantityKey,
} from "@/lib/catalog";
import { nowIso } from "@/lib/date";
import type {
  CreateOrdersInput,
  OrderEventType,
  OrderRecord,
  OrderStatus,
  UpdateOrderInput,
  UrgencyLevel,
} from "@/lib/types";

type OrderRow = {
  id: string;
  code: string;
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
  urgency: string;
  partial_quantity: number | null;
  partial_date: string | null;
  partial_note: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const globalForDb = globalThis as typeof globalThis & {
  __jeffOrderDb?: Database.Database;
};

const DB_PATH = process.env.JEFF_ORDER_DB_PATH
  ? path.resolve(process.env.JEFF_ORDER_DB_PATH)
  : path.join(process.cwd(), "data", "orders.db");
const SCHEMA_VERSION = "2026-06-03-v1";

function productValues(input: Record<ProductQuantityKey, number>) {
  return {
    suitQuantity: input.suitQuantity,
    jacketQuantity: input.jacketQuantity,
    pantQuantity: input.pantQuantity,
    vestQuantity: input.vestQuantity,
    coatQuantity: input.coatQuantity,
  };
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

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
      urgency TEXT NOT NULL DEFAULT 'NORMAL',
      partial_quantity INTEGER,
      partial_date TEXT,
      partial_note TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
    CREATE INDEX IF NOT EXISTS idx_orders_status_urgency ON orders(status, urgency);
    CREATE INDEX IF NOT EXISTS idx_orders_registered_at ON orders(registered_at);
    CREATE INDEX IF NOT EXISTS idx_orders_written_off_at ON orders(written_off_at);

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
  recordMigration(db, "2026-06-03-v1-core-orders");
  recordMigration(db, "2026-06-03-v1-product-quantities");
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
  if (value === "PARTIAL" || value === "WRITTEN_OFF") {
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

  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name ?? "",
    quantity: row.quantity,
    ...quantities,
    registeredAt: row.registered_at,
    status: toStatus(row.status),
    writtenOffAt: row.written_off_at,
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

    const exists = db.prepare(
      "SELECT id FROM orders WHERE code = ? COLLATE NOCASE LIMIT 1",
    );
    const insert = db.prepare(`
      INSERT INTO orders (
        id, code, customer_name, quantity,
        suit_quantity, jacket_quantity, pant_quantity, vest_quantity,
        coat_quantity, registered_at, status, urgency, note,
        created_at, updated_at
      )
      VALUES (
        @id, @code, @customerName, @quantity,
        @suitQuantity, @jacketQuantity, @pantQuantity, @vestQuantity,
        @coatQuantity, @registeredAt, 'PENDING', @urgency, @note,
        @createdAt, @updatedAt
      )
    `);
    const quantities = productValues(input);
    const quantity = totalQuantity(quantities, input.quantity);

    for (const code of input.codes) {
      if (exists.get(code)) {
        skipped.push(code);
        continue;
      }

      const id = randomUUID();
      insert.run({
        id,
        code,
        customerName: input.customerName || null,
        quantity,
        ...quantities,
        registeredAt: input.registeredAt,
        urgency: input.urgency,
        note: input.note || null,
        createdAt: now,
        updatedAt: now,
      });
      insertEvent(db, id, "CREATED", `登记号码 ${code}`);
      created += 1;
    }

    return { created, skipped };
  })();
}

export function updateOrder(input: UpdateOrderInput) {
  const db = getDb();
  const current = getOrder(input.id);

  if (!current) {
    return false;
  }

  const now = nowIso();
  const quantities = productValues(input);
  const quantity = totalQuantity(quantities, input.quantity);
  const hasPartial =
    Boolean(input.partialQuantity) ||
    Boolean(input.partialDate) ||
    input.partialNote.trim().length > 0;
  const status =
    current.status === "WRITTEN_OFF"
      ? "WRITTEN_OFF"
      : hasPartial
        ? "PARTIAL"
        : "PENDING";

  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET customer_name = @customerName,
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

  return true;
}

export function writeOffOrder(id: string, writtenOffAt: string) {
  const db = getDb();
  const current = getOrder(id);

  if (!current) {
    return false;
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET status = 'WRITTEN_OFF',
          written_off_at = @writtenOffAt,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      writtenOffAt,
      updatedAt: nowIso(),
    });
    insertEvent(db, id, "WRITTEN_OFF", `出货日期 ${writtenOffAt}`);
  })();

  return true;
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
