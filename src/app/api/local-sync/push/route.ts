import { isAuthenticated, isAdminPasswordConfigured } from "@/lib/auth";
import { isCloudDeployment } from "@/lib/deployment";
import { pushLocalCloudChanges } from "@/lib/local-cloud-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (
    isCloudDeployment() ||
    !isAdminPasswordConfigured() ||
    !(await isAuthenticated())
  ) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const result = await pushLocalCloudChanges({ automatic: false });
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
