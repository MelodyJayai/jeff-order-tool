"use server";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { calculateTotalQuantity, PRODUCT_COLUMNS } from "@/lib/catalog";
import { ensureActionAuthenticated } from "@/lib/auth";
import { chinaToday, cleanDate, optionalDate } from "@/lib/date";
import { areInAppUpdatesDisabled } from "@/lib/deployment";
import {
  addOrderDelivery,
  createDatabaseBackupFile,
  createOrders,
  getDataDirectory,
  importOrders,
  importOrdersFromSqliteBackup,
  markOrderReturned,
  removeOrderDelivery,
  undoWriteOffOrder,
  updateOrder,
  updateOrderDeliveryRequest,
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
import { getMigrationMaintenance } from "@/lib/maintenance";
import { checkForUpdates } from "@/lib/update";

const urgencySchema = z.enum(URGENCY_LEVELS);

const deliveryFormKeys = {
  suitQuantity: "deliverySuitQuantity",
  jacketQuantity: "deliveryJacketQuantity",
  pantQuantity: "deliveryPantQuantity",
  vestQuantity: "deliveryVestQuantity",
  coatQuantity: "deliveryCoatQuantity",
} as const;

const deliveryRequestFormKeys = {
  suitQuantity: "requestSuitQuantity",
  jacketQuantity: "requestJacketQuantity",
  pantQuantity: "requestPantQuantity",
  vestQuantity: "requestVestQuantity",
  coatQuantity: "requestCoatQuantity",
} as const;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function positiveInt(formData: FormData, key: string, fallback = 1) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function deliveryProductQuantities(formData: FormData) {
  return PRODUCT_COLUMNS.reduce(
    (values, item) => ({
      ...values,
      [item.key]: nonNegativeInt(formData, deliveryFormKeys[item.key]),
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

function deliveryRequestProductQuantities(formData: FormData) {
  return PRODUCT_COLUMNS.reduce(
    (values, item) => ({
      ...values,
      [item.key]: nonNegativeInt(
        formData,
        deliveryRequestFormKeys[item.key],
      ),
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

function returnProductQuantities(formData: FormData) {
  return {
    returnSuitQuantity: nonNegativeInt(formData, "returnSuitQuantity"),
    returnJacketQuantity: nonNegativeInt(formData, "returnJacketQuantity"),
    returnPantQuantity: nonNegativeInt(formData, "returnPantQuantity"),
    returnVestQuantity: nonNegativeInt(formData, "returnVestQuantity"),
    returnCoatQuantity: nonNegativeInt(formData, "returnCoatQuantity"),
  };
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

async function mutationBlockedResult() {
  if (!(await ensureActionAuthenticated())) {
    return result(false, "请先登录后再操作");
  }

  const maintenance = getMigrationMaintenance();
  return maintenance
    ? result(false, `云端数据库正在维护：${maintenance.reason}，请稍后再操作`)
    : null;
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

  if (
    clean === "VERY_URGENT" ||
    value === urgencyLabels.VERY_URGENT ||
    value === "最急"
  ) {
    return "VERY_URGENT";
  }

  return "NORMAL";
}

function csvStatus(value: string, writtenOffAt: string): OrderStatus {
  const clean = value.trim().toUpperCase();

  if (clean === "RETURNED" || value === statusLabels.RETURNED) {
    return "RETURNED";
  }

  if (clean === "WRITTEN_OFF" || value === statusLabels.WRITTEN_OFF || writtenOffAt) {
    return "WRITTEN_OFF";
  }

  if (
    clean === "PARTIAL" ||
    value === statusLabels.PARTIAL ||
    value === "部分交付"
  ) {
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
    const returnedAt = optionalDate(
      rowValue(row, ["返厂日期", "return date", "returned at"]),
    );
    const status = csvStatus(
      rowValue(row, ["状态", "status"]),
      writtenOffAt ?? "",
    );
    const registeredAt = cleanDate(
      rowValue(row, ["登记日期", "registered at", "registration date"]),
      chinaToday(),
    );
    const partialDate = optionalDate(
      rowValue(row, ["部分交付日期", "partial date"]),
    );
    const partialNote = rowValue(row, ["部分交付备注", "partial note"]);
    const deliveryRequestQuantities = {
      suitQuantity: csvInt(
        rowValue(row, ["客户要求先交套装", "requested suit"]),
      ),
      jacketQuantity: csvInt(
        rowValue(row, ["客户要求先交单衫", "requested jacket"]),
      ),
      pantQuantity: csvInt(
        rowValue(row, ["客户要求先交单裤", "requested pants"]),
      ),
      vestQuantity: csvInt(
        rowValue(row, ["客户要求先交马甲", "requested vest"]),
      ),
      coatQuantity: csvInt(
        rowValue(row, ["客户要求先交大衣", "requested coat"]),
      ),
    };
    const deliveryRequestNote = rowValue(row, [
      "客户先交要求备注",
      "delivery request note",
    ]);
    const hasDeliveryRequest =
      calculateTotalQuantity(deliveryRequestQuantities) > 0 ||
      Boolean(deliveryRequestNote);
    const initialDeliveryQuantities = {
      suitQuantity: csvInt(rowValue(row, ["累计先交套装"])),
      jacketQuantity: csvInt(rowValue(row, ["累计先交单衫"])),
      pantQuantity: csvInt(rowValue(row, ["累计先交单裤"])),
      vestQuantity: csvInt(rowValue(row, ["累计先交马甲"])),
      coatQuantity: csvInt(rowValue(row, ["累计先交大衣"])),
    };
    const initialUncategorizedQuantity = csvInt(
      rowValue(row, ["先交未分细类"]),
    );
    const initialDeliveryTotal =
      calculateTotalQuantity(initialDeliveryQuantities) +
      initialUncategorizedQuantity;

    return [
      {
        code,
        codes: [code],
        companyName: rowValue(row, ["公司", "公司名称", "company", "company name"]),
        factoryName: rowValue(row, ["工厂", "加工厂", "factory", "factory name"]),
        firstDelivery: rowValue(row, [
          "先交",
          "先交要求",
          "first delivery",
          "early delivery",
        ]),
        customerName: rowValue(row, ["客户", "客户名", "customer", "customer name"]),
        suitQuantity: csvInt(rowValue(row, ["套装", "suit set", "suit"])),
        jacketQuantity: csvInt(rowValue(row, ["单衫", "shirt", "top"])),
        pantQuantity: csvInt(rowValue(row, ["单裤", "pants"])),
        vestQuantity: csvInt(rowValue(row, ["马甲", "vest"])),
        coatQuantity: csvInt(rowValue(row, ["大衣", "coat"])),
        quantity: csvInt(rowValue(row, ["数量小计", "数量", "quantity"]), 1),
        registeredAt,
        status,
        writtenOffAt,
        returnedAt,
        returnNote: rowValue(row, ["返厂备注", "return note"]),
        returnSuitQuantity: csvInt(rowValue(row, ["返厂套装", "return suit"])),
        returnJacketQuantity: csvInt(rowValue(row, ["返厂单衫", "return jacket", "return shirt"])),
        returnPantQuantity: csvInt(rowValue(row, ["返厂单裤", "return pants"])),
        returnVestQuantity: csvInt(rowValue(row, ["返厂马甲", "return vest"])),
        returnCoatQuantity: csvInt(rowValue(row, ["返厂大衣", "return coat"])),
        urgency: csvUrgency(rowValue(row, ["急单等级", "急度", "urgency"])),
        partialQuantity: csvNullableInt(
          rowValue(row, ["部分交付数量", "partial quantity"]),
        ),
        partialDate,
        partialNote,
        note: rowValue(row, ["备注", "note"]),
        deliveryRequest: hasDeliveryRequest
          ? {
              requestedAt: cleanDate(
                rowValue(row, [
                  "客户先交要求日期",
                  "delivery request date",
                ]),
                registeredAt,
              ),
              note: deliveryRequestNote,
              ...deliveryRequestQuantities,
            }
          : null,
        initialDelivery:
          initialDeliveryTotal > 0
            ? {
                deliveredAt: cleanDate(
                  rowValue(row, ["最近先交日期"]),
                  partialDate ?? registeredAt,
                ),
                uncategorizedQuantity: initialUncategorizedQuantity,
                note: rowValue(row, ["先交明细"]),
                ...initialDeliveryQuantities,
              }
            : null,
      },
    ];
  });
}

export async function createOrdersAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const codes = splitCodes(text(formData, "codes"));

  if (codes.length === 0) {
    return result(false, "请先填写订单号");
  }

  const companyName = text(formData, "companyName");

  if (!companyName) {
    return result(false, "请先选择公司；不同公司可以使用相同订单号");
  }

  const quantities = productQuantities(formData);
  const deliveryRequestQuantities =
    deliveryRequestProductQuantities(formData);
  const deliveryRequestNote = text(formData, "deliveryRequestNote");
  const hasDeliveryRequest =
    calculateTotalQuantity(deliveryRequestQuantities) > 0 ||
    Boolean(deliveryRequestNote);
  const exceededLabels = PRODUCT_COLUMNS.filter(
    (item) => deliveryRequestQuantities[item.key] > quantities[item.key],
  ).map((item) => item.label);

  if (exceededLabels.length > 0) {
    return result(
      false,
      `${exceededLabels.join("、")}的客户先交要求不能超过订单数量`,
    );
  }

  const { created, skipped } = createOrders({
    codes,
    companyName,
    factoryName: text(formData, "factoryName"),
    firstDelivery: "",
    customerName: "",
    quantity: positiveInt(formData, "quantity"),
    ...quantities,
    registeredAt: cleanDate(text(formData, "registeredAt"), chinaToday()),
    urgency: urgency(formData),
    note: text(formData, "note"),
    deliveryRequest: hasDeliveryRequest
      ? {
          requestedAt: cleanDate(
            text(formData, "deliveryRequestDate"),
            chinaToday(),
          ),
          note: deliveryRequestNote,
          ...deliveryRequestQuantities,
        }
      : null,
    initialDelivery: null,
  });

  revalidatePath("/");

  if (created === 0) {
    return result(false, "这家公司下面的订单号已经在总表里", skipped);
  }

  if (skipped.length > 0) {
    const savedText =
      created === 1 ? "已保存到订单总表" : `已保存 ${created} 个订单号到订单总表`;
    return result(true, `${savedText}，跳过 ${skipped.length} 个同公司重复订单号`, skipped);
  }

  return result(
    true,
    created === 1 ? "已保存到订单总表" : `已保存 ${created} 个订单号到订单总表`,
  );
}

export async function updateOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const id = text(formData, "id");

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = updateOrder({
    id,
    companyName: text(formData, "companyName"),
    factoryName: text(formData, "factoryName"),
    quantity: positiveInt(formData, "quantity"),
    ...productQuantities(formData),
    registeredAt: cleanDate(text(formData, "registeredAt"), chinaToday()),
    urgency: urgency(formData),
    note: text(formData, "note"),
  });

  revalidatePath("/");

  if (updated === "updated") {
    return result(true, "已保存");
  }

  if (updated === "duplicate") {
    return result(false, "这家公司下面已经有相同订单号");
  }

  if (updated === "below_delivered") {
    return result(false, "订单数量不能小于已经先交的细分类数量");
  }

  if (updated === "below_requested") {
    return result(false, "订单数量不能小于已经登记的客户先交要求");
  }

  return result(false, "记录不存在");
}

export async function updateOrderDeliveryRequestAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const orderId = text(formData, "orderId");

  if (!orderId) {
    return result(false, "没有找到这条订单");
  }

  const updated = updateOrderDeliveryRequest({
    orderId,
    requestedAt: cleanDate(
      text(formData, "deliveryRequestDate"),
      chinaToday(),
    ),
    note: text(formData, "deliveryRequestNote"),
    ...deliveryRequestProductQuantities(formData),
  });

  revalidatePath("/");
  revalidatePath("/events");

  if (updated === "updated") {
    return result(
      true,
      "客户先交要求已保存；这不是交货记录，剩余未交数量没有变化",
    );
  }

  if (updated === "cleared") {
    return result(true, "客户先交要求已清除；剩余未交数量没有变化");
  }

  if (updated === "closed") {
    return result(false, "已核销或返厂中的订单不能修改客户先交要求");
  }

  if (typeof updated === "object" && updated.status === "exceeds") {
    return result(
      false,
      `${updated.labels.join("、")}的客户先交要求不能超过订单数量`,
    );
  }

  return result(false, "记录不存在");
}

export async function addOrderDeliveryAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const orderId = text(formData, "orderId");

  if (!orderId) {
    return result(false, "没有找到这条订单");
  }

  const added = addOrderDelivery({
    orderId,
    deliveredAt: cleanDate(text(formData, "deliveryDate"), chinaToday()),
    note: text(formData, "deliveryNote"),
    ...deliveryProductQuantities(formData),
  });

  revalidatePath("/");
  revalidatePath("/events");

  if (added === "added") {
    return result(true, "本次实际交货已记录；累计已交增加，剩余未交已减少");
  }

  if (added === "empty") {
    return result(false, "请至少填写一种实际交货数量");
  }

  if (added === "closed") {
    return result(false, "已核销或返厂中的订单不能再登记实际交货");
  }

  if (added === "missing_categories") {
    return result(false, "这条旧订单没有细分类数量，请先补齐订单的细分类数量");
  }

  if (added === "would_complete") {
    return result(false, "本次会交完全部剩余数量，请直接使用出货核销");
  }

  if (typeof added === "object" && added.status === "exceeds") {
    return result(
      false,
      `${added.labels.join("、")}的实际交货数量超过剩余未交数量`,
    );
  }

  return result(false, "记录不存在");
}

export async function removeOrderDeliveryAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const orderId = text(formData, "orderId");
  const deliveryId = text(formData, "deliveryId");

  if (!orderId || !deliveryId) {
    return result(false, "没有找到这次实际交货记录");
  }

  const removed = removeOrderDelivery(orderId, deliveryId);

  revalidatePath("/");
  revalidatePath("/events");

  if (removed === "removed") {
    return result(true, "这次实际交货已撤销，剩余未交数量已恢复");
  }

  if (removed === "protected") {
    return result(false, "旧版迁移的部分交付记录不能直接撤销");
  }

  if (removed === "closed") {
    return result(false, "请先撤销核销后再修改实际交货记录");
  }

  return result(false, "实际交货记录不存在");
}

export async function writeOffOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

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

  if (updated === "resolved") {
    return result(true, "返厂修改已完成");
  }

  if (updated === "already") {
    return result(false, "已经核销过，不重复记录");
  }

  return result(false, "记录不存在");
}

export async function undoWriteOffOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const id = text(formData, "id");

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = undoWriteOffOrder(id);

  revalidatePath("/");
  return updated ? result(true, "已撤销核销") : result(false, "记录不存在");
}

export async function markReturnedOrderAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const id = text(formData, "id");

  if (!id) {
    return result(false, "没有找到这条记录");
  }

  const updated = markOrderReturned({
    id,
    returnedAt: cleanDate(text(formData, "returnedAt"), chinaToday()),
    returnNote: text(formData, "returnNote"),
    ...returnProductQuantities(formData),
  });

  revalidatePath("/");

  if (updated === "updated") {
    return result(true, "已标记返厂修改");
  }

  if (updated === "empty") {
    return result(false, "请填写至少一个返厂细分类数量");
  }

  if (updated === "exceeds_quantity") {
    return result(false, "返厂数量不能超过原订单对应细分类数量");
  }

  if (updated === "not_written_off") {
    return result(false, "只有已核销或返厂中的订单才能标记返厂修改");
  }

  return result(false, "记录不存在");
}

function appBaseDirectory() {
  return path.dirname(getDataDirectory());
}

function copyUpdaterToTemp(updaterPath: string) {
  const updateDir = path.join(getDataDirectory(), "updates");
  const tempUpdaterPath = path.join(
    updateDir,
    `JeffOrderToolUpdater-${process.pid}-${Date.now()}.exe`,
  );

  fs.mkdirSync(updateDir, { recursive: true });
  fs.copyFileSync(updaterPath, tempUpdaterPath);
  return tempUpdaterPath;
}

function safeInstallerFilename(name: string | null, latestVersion: string) {
  const fallback = `JeffOrderToolSetup-v${latestVersion}.exe`;
  const base = path.basename(name || fallback);

  return /^[\w .()[\]-]+\.exe$/iu.test(base) ? base : fallback;
}

async function downloadUpdateInstaller(
  downloadUrl: string,
  assetName: string | null,
  latestVersion: string,
) {
  const response = await fetch(downloadUrl, {
    cache: "no-store",
    headers: { "User-Agent": "jeff-order-tool" },
  });

  if (!response.ok) {
    throw new Error(`下载安装包失败：HTTP ${response.status}`);
  }

  const updateDir = path.join(getDataDirectory(), "updates");
  const filename = safeInstallerFilename(assetName, latestVersion);
  const installerPath = path.join(updateDir, filename);
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.mkdirSync(updateDir, { recursive: true });
  fs.writeFileSync(installerPath, buffer);

  return installerPath;
}

export async function installUpdateAction(): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  if (areInAppUpdatesDisabled()) {
    return result(false, "云端版本由服务器统一维护更新，不在网页内安装 Windows 更新包");
  }

  const update = await checkForUpdates();

  if (!update.updateAvailable) {
    return result(false, update.message || "当前已是最新版本");
  }

  if (!update.downloadUrl || !update.latestVersion) {
    return result(false, "找到了新版本，但没有可自动安装的安装包");
  }

  const appDir = appBaseDirectory();
  const updaterPath = path.join(appDir, "SupportFiles", "JeffOrderToolUpdater.exe");

  if (!fs.existsSync(updaterPath)) {
    return result(false, "当前版本缺少更新助手，请先手动安装新版安装包");
  }

  let backupFilename = "";

  try {
    const backup = await createDatabaseBackupFile("before-update");
    backupFilename = backup.filename;
  } catch {
    return result(false, "更新前自动备份失败，已停止更新");
  }

  let installerPath = "";

  try {
    installerPath = await downloadUpdateInstaller(
      update.downloadUrl,
      update.assetName,
      update.latestVersion,
    );
  } catch (error) {
    return result(
      false,
      error instanceof Error ? error.message : "下载安装包失败",
    );
  }

  const updaterCopyPath = copyUpdaterToTemp(updaterPath);
  const child = spawn(updaterCopyPath, [installerPath, appDir], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return result(
    true,
    `已开始更新到 ${update.latestVersion}；更新前备份 ${backupFilename}`,
  );
}

export async function importCsvAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const file = formData.get("csvFile");

  if (!(file instanceof File)) {
    return result(false, "请选择 CSV 文件");
  }

  const rows = csvImportRows(await file.text());

  if (rows.length === 0) {
    return result(false, "CSV 里没有找到订单号");
  }

  let backupFilename = "";

  try {
    const backup = await createDatabaseBackupFile("before-import");
    backupFilename = backup.filename;
  } catch {
    return result(false, "导入前自动备份失败，已停止导入");
  }

  const imported = importOrders(rows);

  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/health");

  return result(
    true,
    `导入完成：新增 ${imported.created} 条，更新 ${imported.updated} 条；导入前已自动备份 ${backupFilename}`,
    imported.skipped,
  );
}

export async function importSqliteBackupAction(
  formData: FormData,
): Promise<ActionResult> {
  const blocked = await mutationBlockedResult();
  if (blocked) return blocked;

  const file = formData.get("dbFile");

  if (!(file instanceof File)) {
    return result(false, "请选择旧版 .db 备份文件");
  }

  if (file.size === 0) {
    return result(false, "选择的 .db 文件是空的");
  }

  let backupFilename = "";

  try {
    const backup = await createDatabaseBackupFile("before-sqlite-import");
    backupFilename = backup.filename;
  } catch {
    return result(false, "导入旧库前自动备份失败，已停止导入");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jeff-sqlite-import-"));
  const tempDbPath = path.join(tempDir, "source.db");

  try {
    fs.writeFileSync(tempDbPath, Buffer.from(await file.arrayBuffer()));
    const imported = importOrdersFromSqliteBackup(tempDbPath);

    revalidatePath("/");
    revalidatePath("/events");
    revalidatePath("/health");

    if (imported.created === 0 && imported.updated === 0) {
      return result(
        false,
        `没有导入订单；导入前已自动备份 ${backupFilename}`,
        imported.skipped,
      );
    }

    return result(
      true,
      `旧版 .db 导入完成：新增 ${imported.created} 条，更新 ${imported.updated} 条；导入前已自动备份 ${backupFilename}`,
      imported.skipped,
    );
  } catch (error) {
    return result(
      false,
      error instanceof Error
        ? `旧版 .db 导入失败：${error.message}`
        : "旧版 .db 导入失败",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
