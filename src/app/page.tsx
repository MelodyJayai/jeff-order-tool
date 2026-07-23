import { Workbench } from "@/app/components/workbench";
import { requireAuthenticatedPage } from "@/lib/auth";
import { chinaToday } from "@/lib/date";
import {
  isCloudDeployment,
  isCloudWriteProtected,
  isReturnWorkflowEnabled,
} from "@/lib/deployment";
import {
  ensureDailyDatabaseBackup,
  getDatabaseChangeToken,
  listOrderEvents,
  listOrders,
} from "@/lib/db";
import { scheduleLocalCloudSync } from "@/lib/local-sync-scheduler";
import { getLanAccessUrls } from "@/lib/network";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAuthenticatedPage();
  await ensureDailyDatabaseBackup();

  const cloudMode = isCloudDeployment();
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

  if (!cloudMode) {
    scheduleLocalCloudSync(5_000);
  }

  return (
    <Workbench
      cloudMode={cloudMode}
      dataVersion={cloudMode ? "" : getDatabaseChangeToken()}
      initialEvents={events}
      initialOrders={orders}
      phoneAccess={{ primaryUrl, qrDataUrl, urls }}
      returnWorkflowEnabled={returnWorkflowEnabled}
      today={chinaToday()}
      writeProtected={isCloudWriteProtected()}
    />
  );
}
