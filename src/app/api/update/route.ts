import { isAuthenticated } from "@/lib/auth";
import { checkForUpdates } from "@/lib/update";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  return Response.json(await checkForUpdates());
}
