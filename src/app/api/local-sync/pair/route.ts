import { isAuthenticated, isAdminPasswordConfigured } from "@/lib/auth";
import { isCloudDeployment } from "@/lib/deployment";
import { pairLocalCloudSync } from "@/lib/local-cloud-sync";
import { scheduleLocalCloudSync } from "@/lib/local-sync-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (
    isCloudDeployment() ||
    !isAdminPasswordConfigured() ||
    !(await isAuthenticated())
  ) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      serverUrl?: unknown;
      code?: unknown;
    };
    const serverUrl =
      typeof body.serverUrl === "string" ? body.serverUrl.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!serverUrl || !code) {
      return Response.json(
        { ok: false, message: "请填写服务器地址和配对码" },
        { status: 400 },
      );
    }

    const status = await pairLocalCloudSync({ serverUrl, code });
    scheduleLocalCloudSync(1_000);
    return Response.json({ ok: true, ...status });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "连接云端失败",
      },
      { status: 400 },
    );
  }
}
