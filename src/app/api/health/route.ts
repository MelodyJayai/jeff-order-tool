import { getCurrentVersion } from "@/lib/update";
import { getAppInstanceId } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    app: "jeff-order-tool",
    version: getCurrentVersion(),
    instanceId: getAppInstanceId(),
    checkedAt: new Date().toISOString(),
  });
}
