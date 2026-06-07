import { Workbench } from "@/app/components/workbench";
import { requireAuthenticatedPage } from "@/lib/auth";
import { chinaToday } from "@/lib/date";
import { isCloudDeployment } from "@/lib/deployment";
import { ensureDailyDatabaseBackup, listOrderEvents, listOrders } from "@/lib/db";
import { getLanAccessUrls } from "@/lib/network";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthenticatedPage();
  await ensureDailyDatabaseBackup();

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
      cloudMode={isCloudDeployment()}
      initialEvents={events}
      initialOrders={orders}
      phoneAccess={{ primaryUrl, qrDataUrl, urls }}
      today={chinaToday()}
    />
  );
}
