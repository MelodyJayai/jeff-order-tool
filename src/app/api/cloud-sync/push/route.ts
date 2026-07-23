import { processCloudSyncUpload } from "@/lib/cloud-sync-service";
import { authenticateCloudSyncToken } from "@/lib/cloud-sync-store";
import { isCloudDeployment } from "@/lib/deployment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
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

  try {
    const formData = await request.formData();
    const file = formData.get("databaseFile");
    const sourceChangeToken = formData.get("sourceChangeToken");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { ok: false, message: "没有收到数据库备份" },
        { status: 400 },
      );
    }

    const result = await processCloudSyncUpload({
      device,
      sourceFilename: file.name || "jeff-order-sync.db",
      sourceChangeToken:
        typeof sourceChangeToken === "string" ? sourceChangeToken : "unknown",
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    const status = /维护|变化|冲突/u.test(message) ? 409 : 400;
    return Response.json({ ok: false, status: "failed", message }, { status });
  }
}
