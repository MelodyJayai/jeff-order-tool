import { Workbench } from "@/app/components/workbench";
import { chinaToday } from "@/lib/date";
import { listOrderEvents, listOrders } from "@/lib/db";
import { getLanAccessUrls } from "@/lib/network";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function Home() {
  const orders = listOrders();
  const events = listOrderEvents();
  const urls = getLanAccessUrls();
  const primaryUrl = urls[0] ?? null;
  const qrDataUrl = primaryUrl
    ? await QRCode.toDataURL(primaryUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      })
    : null;

  return (
    <Workbench
      initialEvents={events}
      initialOrders={orders}
      phoneAccess={{ primaryUrl, qrDataUrl, urls }}
      today={chinaToday()}
    />
  );
}
