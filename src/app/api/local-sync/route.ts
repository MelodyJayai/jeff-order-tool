import { isAuthenticated, isAdminPasswordConfigured } from "@/lib/auth";
import { isCloudDeployment } from "@/lib/deployment";
import {
  disconnectLocalCloudSync,
  getLocalCloudSyncStatus,
  setLocalCloudSyncAutoSync,
} from "@/lib/local-cloud-sync";
import { scheduleLocalCloudSync } from "@/lib/local-sync-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowed() {
  return (
    !isCloudDeployment() &&
    isAdminPasswordConfigured() &&
    (await isAuthenticated())
  );
}

export async function GET() {
  if (!(await allowed())) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  return Response.json({ ok: true, ...(await getLocalCloudSyncStatus()) });
}

export async function PATCH(request: Request) {
  if (!(await allowed())) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { autoSync?: unknown };
    if (typeof body.autoSync !== "boolean") {
      return Response.json(
        { ok: false, message: "自动同步设置无效" },
        { status: 400 },
      );
    }
    const status = setLocalCloudSyncAutoSync(body.autoSync);
    if (body.autoSync) {
      scheduleLocalCloudSync(1_000);
    }
    return Response.json({ ok: true, ...status });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "设置失败",
      },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  if (!(await allowed())) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  return Response.json({ ok: true, ...disconnectLocalCloudSync() });
}
