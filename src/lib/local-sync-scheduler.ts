let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleLocalCloudSync(delayMs = 15_000) {
  if (process.env.JEFF_DEPLOYMENT_MODE?.trim().toLowerCase() === "cloud") {
    return;
  }

  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }

  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    try {
      const sync = await import("@/lib/local-cloud-sync");
      const result = await sync.pushLocalCloudChanges({ automatic: true });
      if (result.retryAfterMs) {
        scheduleLocalCloudSync(result.retryAfterMs);
      }
    } catch {
      scheduleLocalCloudSync(5 * 60 * 1000);
    }
  }, Math.max(1_000, delayMs));

  pendingTimer.unref?.();
}
