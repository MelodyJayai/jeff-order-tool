"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PRODUCT_COLUMNS } from "@/lib/catalog";
import { chinaToday, cleanDate, optionalDate } from "@/lib/date";
import {
  createOrders,
  undoWriteOffOrder,
  updateOrder,
  writeOffOrder,
} from "@/lib/db";
import {
  type ActionResult,
  type UrgencyLevel,
  URGENCY_LEVELS,
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
  return updated ? result(true, "已核销") : result(false, "记录不存在");
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
