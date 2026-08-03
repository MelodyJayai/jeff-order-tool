import { getDatabaseSummary } from "@/lib/db";
import { getCurrentVersion } from "@/lib/update";
import { getAppInstanceId } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const database = getDatabaseSummary();

  return Response.json({
    ok: true,
    app: "jeff-order-tool",
    version: getCurrentVersion(),
    instanceId: getAppInstanceId(),
    schemaVersion: database.schemaVersion,
    checkedAt: new Date().toISOString(),
  });
}
