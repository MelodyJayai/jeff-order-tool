import { createDatabaseBackup } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").slice(0, 19);
}

export async function GET() {
  const backup = await createDatabaseBackup();
  const filename = `jeff-order-backup-${timestamp()}.db`;

  return new Response(backup, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/octet-stream",
    },
  });
}
