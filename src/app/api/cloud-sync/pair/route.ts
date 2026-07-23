import { consumeCloudSyncPairing } from "@/lib/cloud-sync-store";
import { isCloudDeployment } from "@/lib/deployment";
import { getCurrentVersion } from "@/lib/update";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request) {
  if (!isCloudDeployment()) {
    return Response.json({ ok: false, message: "当前不是云端服务" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const code = text(body.code, 20);
    const installationId = text(body.installationId, 100);

    if (!code || !installationId) {
      return Response.json(
        { ok: false, message: "配对信息不完整" },
        { status: 400 },
      );
    }

    const paired = consumeCloudSyncPairing({
      code,
      installationId,
      name: text(body.deviceName, 80),
      appVersion: text(body.appVersion, 40),
    });

    return Response.json({
      ok: true,
      message: "已连接云端",
      deviceId: paired.device.id,
      deviceName: paired.device.name,
      token: paired.token,
      serverVersion: getCurrentVersion(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "配对失败",
      },
      { status: 400 },
    );
  }
}
