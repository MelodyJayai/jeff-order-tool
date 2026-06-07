import { createDatabaseBackup } from "@/lib/db";
import { isAuthenticated, isAdminPasswordConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

export async function GET() {
  if (!isAdminPasswordConfigured() || !(await isAuthenticated())) {
    return Response.json({ ok: false, message: "请先登录" }, { status: 401 });
  }

  const backup = await createDatabaseBackup();
  const filename = `jeff-order-backup-${timestamp()}.db`;

  return new Response(backup, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/octet-stream",
    },
  });
}
