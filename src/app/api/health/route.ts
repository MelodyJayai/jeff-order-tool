import { listOrders } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const orders = listOrders();

  return Response.json({
    ok: true,
    orders: orders.length,
    checkedAt: new Date().toISOString(),
  });
}
