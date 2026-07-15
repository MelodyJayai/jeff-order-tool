"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ensureActionAuthenticated } from "@/lib/auth";
import {
  applyMigration,
  createMigrationPreview,
  getMigrationPreview,
  rollbackLatestMigration,
  type MigrationMode,
  type MigrationResolution,
} from "@/lib/cloud-migration";
import { isCloudDeployment } from "@/lib/deployment";

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function migrationRedirect(params: Record<string, string>): never {
  redirect(`/migration?${new URLSearchParams(params).toString()}`);
}

async function requireMigrationAccess() {
  if (!(await ensureActionAuthenticated())) {
    redirect("/login");
  }
  if (!isCloudDeployment()) {
    redirect("/");
  }
}

export async function createMigrationPreviewAction(formData: FormData) {
  await requireMigrationAccess();
  const file = formData.get("databaseFile");

  if (!(file instanceof File) || file.size === 0) {
    migrationRedirect({ error: "请选择软件生成的 .db 数据库备份" });
  }

  let sessionId = "";
  try {
    const preview = await createMigrationPreview(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    sessionId = preview.sessionId;
  } catch (error) {
    migrationRedirect({ error: errorMessage(error) });
  }

  migrationRedirect({ session: sessionId });
}

export async function applyCloudMigrationAction(formData: FormData) {
  await requireMigrationAccess();
  const sessionId = formText(formData, "sessionId");
  const modeText = formText(formData, "mode");

  if (modeText !== "replace" && modeText !== "merge") {
    migrationRedirect({ session: sessionId, error: "迁移方式无效" });
  }
  const mode: MigrationMode = modeText;
  const expectedConfirmation = mode === "replace" ? "完整替换" : "安全合并";
  if (formText(formData, "confirmation") !== expectedConfirmation) {
    migrationRedirect({
      session: sessionId,
      error: `请输入“${expectedConfirmation}”确认本次操作`,
    });
  }

  const resolutions: Record<string, MigrationResolution> = {};
  let reportId = "";
  try {
    const preview = getMigrationPreview(sessionId);
    for (const diff of preview.diffs) {
      if (diff.category !== "conflict") {
        continue;
      }
      const resolution = formText(formData, `resolution-${diff.id}`);
      if (resolution === "source" || resolution === "cloud") {
        resolutions[diff.id] = resolution;
      }
    }

    const report = await applyMigration(sessionId, mode, resolutions);
    revalidatePath("/");
    revalidatePath("/events");
    revalidatePath("/health");
    revalidatePath("/migration");
    reportId = report.id;
  } catch (error) {
    migrationRedirect({ session: sessionId, error: errorMessage(error) });
  }

  migrationRedirect({ result: reportId });
}

export async function rollbackLatestMigrationAction(formData: FormData) {
  await requireMigrationAccess();
  const reportId = formText(formData, "reportId");
  if (formText(formData, "confirmation") !== "回滚迁移") {
    migrationRedirect({ error: "请输入“回滚迁移”确认恢复" });
  }

  let rolledBackReportId = "";
  try {
    const report = await rollbackLatestMigration(reportId);
    revalidatePath("/");
    revalidatePath("/events");
    revalidatePath("/health");
    revalidatePath("/migration");
    rolledBackReportId = report.id;
  } catch (error) {
    migrationRedirect({ error: errorMessage(error) });
  }

  migrationRedirect({ rollback: rolledBackReportId });
}
