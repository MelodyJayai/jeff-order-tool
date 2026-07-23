import { getCloudSyncSessionResult } from "@/lib/cloud-sync-service";
import { authenticateCloudSyncToken } from "@/lib/cloud-sync-store";
import { isCloudDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isCloudDeployment()) {
    return Response.json({ ok: false, message: "当前不是云端服务" }, { status: 404 });
  }

  const device = authenticateCloudSyncToken(
    request.headers.get("authorization"),
  );
  if (!device) {
    return Response.json(
      { ok: false, message: "同步授权已失效，请重新配对" },
      { status: 401 },
    );
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return Response.json(
      { ok: false, message: "缺少同步会话编号" },
      { status: 400 },
    );
  }

  const result = getCloudSyncSessionResult(device, sessionId);
  if (!result) {
    return Response.json(
      { ok: false, message: "没有找到这次同步记录" },
      { status: 404 },
    );
  }

  return Response.json(result);
}
