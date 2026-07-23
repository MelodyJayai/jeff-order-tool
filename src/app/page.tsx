import { Workbench } from "@/app/components/workbench";
import { requireAuthenticatedPage } from "@/lib/auth";
import { chinaToday } from "@/lib/date";
import {
  isCloudDeployment,
  isReturnWorkflowEnabled,
} from "@/lib/deployment";
import { ensureDailyDatabaseBackup, listOrderEvents, listOrders } from "@/lib/db";
import { getLanAccessUrls } from "@/lib/network";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthenticatedPage();
  await ensureDailyDatabaseBackup();

  const orders = listOrders();
  const returnWorkflowEnabled = isReturnWorkflowEnabled();
  const events = listOrderEvents().filter(
    (event) =>
      returnWorkflowEnabled ||
      (event.type !== "RETURNED" && event.type !== "RETURN_RESOLVED"),
  );
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
      returnWorkflowEnabled={returnWorkflowEnabled}
      today={chinaToday()}
    />
  );
}
