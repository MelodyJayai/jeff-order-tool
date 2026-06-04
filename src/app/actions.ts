"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PRODUCT_COLUMNS } from "@/lib/catalog";
import { chinaToday, cleanDate, optionalDate } from "@/lib/date";
import {
  createOrders,
  importOrders,
  undoWriteOffOrder,
  updateOrder,
  writeOffOrder,
} from "@/lib/db";
import {
  type ActionResult,
  type ImportOrderInput,
  type OrderStatus,
  type UrgencyLevel,
  statusLabels,
  URGENCY_LEVELS,
  urgencyLabels,
} from "@/lib/types";

const urgencySchema = z.enum(URGENCY_LEVELS);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function positiveInt(formData: FormData, key: string, fallback = 1) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nullablePositiveInt(formData: FormData, key: string) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeInt(formData: FormData, key: string) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function productQuantities(formData: FormData) {
  return PRODUCT_COLUMNS.reduce(
    (values, item) => ({
      ...values,
      [item.key]: nonNegativeInt(formData, item.key),
    }),
    {
      suitQuantity: 0,
      jacketQuantity: 0,
      pantQuantity: 0,
      vestQuantity: 0,
      coatQuantity: 0,
    },
  );
}

function urgency(formData: FormData): UrgencyLevel {
  const parsed = urgencySchema.safeParse(text(formData, "urgency"));
  return parsed.success ? parsed.data : "NORMAL";
}

function splitCodes(value: string) {
  const seen = new Set<string>();
  const codes: string[] = [];

  for (const raw of value.split(/[\s,，;；、]+/u)) {
    const code = raw.trim();
    const key = code.toLowerCase();

    if (!code || seen.has(key)) {
      continue;
    }

    seen.add(key);
    codes.push(code);
  }

  return codes;
}

function result(ok: boolean, message: string, skipped?: string[]): ActionResult {
  return { ok, message, skipped };
}

function parseCsv(textValue: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    const next = textValue[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.trim()));
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, "");
}

function rowValue(
  row: Record<string, string>,
  names: string[],
  fallback = "",
) {
  for (const name of names.map(normalizeHeader)) {
    if (row[name]) {
      return row[name].trim();
    }
  }

  return fallback;
}

function csvInt(value: string, fallback = 0) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function csvNullableInt(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function csvUrgency(value: string): UrgencyLevel {
  const clean = value.trim().toUpperCase();

  if (clean === "URGENT" || value === urgencyLabels.URGENT) {
    return "URGENT";
  }

  if (clean === "VERY_URGENT" || value === urgencyLabels.VERY_URGENT) {
    return "VERY_URGENT";
  }

  return "NORMAL";
}

function csvStatus(value: string, writtenOffAt: string): OrderStatus {
  const clean = value.trim().toUpperCase();

  if (clean === "WRITTEN_OFF" || value === statusLabels.WRITTEN_OFF || writtenOffAt) {
    return "WRITTEN_OFF";
  }

  if (clean === "PARTIAL" || value === statusLabels.PARTIAL) {
    return "PARTIAL";
  }

  return "PENDING";
}

function csvImportRows(csvText: string): ImportOrderInput[] {
  const rows = parseCsv(csvText.replace(/^\uFEFF/u, ""));

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).flatMap((cells) => {
    const row = Object.fromEntries(
      headers.map((header, index) => [header, cells[index]?.trim() ?? ""]),
    );
    const code = rowValue(row, ["号码", "订单号", "code", "order code"]);

    if (!code) {
      return [];
    }

    const writtenOffAt = optionalDate(
      rowValue(row, ["出货日期", "核销日期", "written off at", "shipment date"]),
    );
    const status = csvStatus(
      rowValue(row, ["状态", "status"]),
      writtenOffAt ?? "",
    );

    return [
      {
        code,
        codes: [code],
        customerName: rowValue(row, ["客户", "客户名", "customer", "customer name"]),
        suitQuantity: csvInt(rowValue(row, ["套装", "suit set", "suit"])),
        jacketQuantity: csvInt(rowValue(row, ["单衫", "shirt", "top"])),
        pantQuantity: csvInt(rowValue(row, ["单裤", "pants"])),
        vestQuantity: csvInt(rowValue(row, ["马甲", "vest"])),
        coatQuantity: csvInt(rowValue(row, ["大衣", "coat"])),
        quantity: csvInt(rowValue(row, ["数量小计", "数量", "quantity"]), 1),
        registeredAt: cleanDate(
          rowValue(row, ["登记日期", "registered at", "registration date"]),
          chinaToday(),
        ),
        status,
        writtenOffAt,
        urgency: csvUrgency(rowValue(row, ["急单等级", "急度", "urgency"])),
        partialQuantity: csvNullableInt(
          rowValue(row, ["部分交付数量", "partial quantity"]),
        ),
        partialDate: optionalDate(
          rowValue(row, ["部分交付日期", "partial date"]),
        ),
        partialNote: rowValue(row, ["部分交付备注", "partial note"]),
        note: rowValue(row, ["备注", "note"]),
      },
    ];
  });
}

export async function createOrdersAction(
  formData: FormData,
): Promise<ActionResult> {
  const codes = splitCodes(text(formData, "codes"));

  if (codes.length === 0) {
    return result(false, "请先填写订单号");
  }

  const { created, skipped } = createOrders({
    codes,
    customerName: text(formData, "customerName"),
    quantity: positiveInt(formData, "quantity"),
    ...productQuantities(formData),
    registeredAt: cleanDate(text(formData, "registeredAt"), chinaToday()),
    urgency: urgency(formData),
    note: text(formData, "note"),
  });

  revalidatePath("/");

  if (created === 0) {
    return result(false, "订单号已经在总表里", skipped);
  }

  if (skipped.length > 0) {
    const savedText =
      created === 1 ? "已保存到订单总表" : `已保存 ${created} 个订单号到订单总表`;
    return result(true, `${savedText}，跳过 ${skipped.length} 个重复订单号`, skipped);
  }

  return result(
    true,
    created === 1 ? "已保存到订单总表" : `已保存 ${created} 个订单号到订单总表`,
  );
}

export async function updateOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, "id");

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = updateOrder({
    id,
    customerName: text(formData, "customerName"),
    quantity: positiveInt(formData, "quantity"),
    ...productQuantities(formData),
    registeredAt: cleanDate(text(formData, "registeredAt"), chinaToday()),
    urgency: urgency(formData),
    partialQuantity: nullablePositiveInt(formData, "partialQuantity"),
    partialDate: optionalDate(text(formData, "partialDate")),
    partialNote: text(formData, "partialNote"),
    note: text(formData, "note"),
  });

  revalidatePath("/");
  return updated ? result(true, "已保存") : result(false, "记录不存在");
}

export async function writeOffOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, "id");
  const writtenOffAt = cleanDate(text(formData, "writtenOffAt"), chinaToday());

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = writeOffOrder(id, writtenOffAt);

  revalidatePath("/");

  if (updated === "updated") {
    return result(true, "已核销");
  }

  if (updated === "already") {
    return result(false, "已经核销过，不重复记录");
  }

  return result(false, "记录不存在");
}

export async function undoWriteOffOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const id = text(formData, "id");

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = undoWriteOffOrder(id);

  revalidatePath("/");
  return updated ? result(true, "已撤销核销") : result(false, "记录不存在");
}

export async function importCsvAction(
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("csvFile");

  if (!(file instanceof File)) {
    return result(false, "请选择 CSV 文件");
  }

  const rows = csvImportRows(await file.text());

  if (rows.length === 0) {
    return result(false, "CSV 里没有找到订单号");
  }

  const imported = importOrders(rows);

  revalidatePath("/");

  return result(
    true,
    `导入完成：新增 ${imported.created} 条，更新 ${imported.updated} 条`,
    imported.skipped,
  );
}
