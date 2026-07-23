import {
  applyMigration,
  createMigrationPreview,
  discardMigrationPreview,
  findMigrationReportBySessionId,
  getMigrationPreview,
} from "@/lib/cloud-migration";
import {
  type CloudSyncAttempt,
  type CloudSyncDevice,
  getCloudSyncAttempt,
  markCloudSyncAttemptApplied,
  recordCloudSyncAttempt,
  updateCloudSyncAttempt,
} from "@/lib/cloud-sync-store";

export type CloudSyncPushResult = {
  ok: boolean;
  status: CloudSyncAttempt["status"];
  message: string;
  sessionId: string;
  sourceOrders: number;
  conflictCount: number;
  created: number;
  updatedFromSource: number;
  keptCloud: number;
  reportId: string | null;
};

function cleanChangeToken(value: string) {
  return /^[a-zA-Z0-9._:-]{1,160}$/u.test(value) ? value : "unknown";
}

function completedMessage(input: {
  created: number;
  updatedFromSource: number;
  keptCloud: number;
}) {
  const changed = input.created + input.updatedFromSource;
  if (changed === 0) {
    return input.keptCloud > 0
      ? `云端已是最新，并保留 ${input.keptCloud} 条云端记录`
      : "云端数据已经是最新";
  }

  return `已同步到云端：新增 ${input.created} 条，更新 ${input.updatedFromSource} 条`;
}

export async function processCloudSyncUpload(input: {
  device: CloudSyncDevice;
  sourceFilename: string;
  sourceChangeToken: string;
  bytes: Buffer;
}): Promise<CloudSyncPushResult> {
  let sessionId = "";

  try {
    const preview = await createMigrationPreview(
      input.sourceFilename,
      input.bytes,
    );
    sessionId = preview.sessionId;
    const sourceChangeToken = cleanChangeToken(input.sourceChangeToken);

    if (preview.alreadyImported) {
      discardMigrationPreview(preview.sessionId);
      recordCloudSyncAttempt({
        sessionId: preview.sessionId,
        deviceId: input.device.id,
        sourceChangeToken,
        sourceSha256: preview.sourceSha256,
        sourceFilename: preview.sourceFilename,
        sourceOrders: preview.source.orders,
        conflictCount: 0,
        status: "already_synced",
        message: "这份本地数据已经同步过",
        reportId: null,
      });
      return {
        ok: true,
        status: "already_synced",
        message: "这份本地数据已经同步过",
        sessionId: preview.sessionId,
        sourceOrders: preview.source.orders,
        conflictCount: 0,
        created: 0,
        updatedFromSource: 0,
        keptCloud: preview.cloud.orders,
        reportId: null,
      };
    }

    if (preview.counts.conflict > 0) {
      recordCloudSyncAttempt({
        sessionId: preview.sessionId,
        deviceId: input.device.id,
        sourceChangeToken,
        sourceSha256: preview.sourceSha256,
        sourceFilename: preview.sourceFilename,
        sourceOrders: preview.source.orders,
        conflictCount: preview.counts.conflict,
        status: "conflict",
        message: `发现 ${preview.counts.conflict} 张订单两边都修改过，已等待管理员确认`,
        reportId: null,
      });
      return {
        ok: true,
        status: "conflict",
        message: `发现 ${preview.counts.conflict} 张订单需要管理员确认，云端尚未覆盖这些订单`,
        sessionId: preview.sessionId,
        sourceOrders: preview.source.orders,
        conflictCount: preview.counts.conflict,
        created: 0,
        updatedFromSource: 0,
        keptCloud: 0,
        reportId: null,
      };
    }

    recordCloudSyncAttempt({
      sessionId: preview.sessionId,
      deviceId: input.device.id,
      sourceChangeToken,
      sourceSha256: preview.sourceSha256,
      sourceFilename: preview.sourceFilename,
      sourceOrders: preview.source.orders,
      conflictCount: 0,
      status: "processing",
      message: "正在安全合并",
      reportId: null,
    });

    const report = await applyMigration(preview.sessionId, "merge", {});
    const message = completedMessage(report);
    markCloudSyncAttemptApplied(preview.sessionId, report.id, message);

    return {
      ok: true,
      status: "applied",
      message,
      sessionId: preview.sessionId,
      sourceOrders: preview.source.orders,
      conflictCount: 0,
      created: report.created,
      updatedFromSource: report.updatedFromSource,
      keptCloud: report.keptCloud,
      reportId: report.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    if (sessionId) {
      updateCloudSyncAttempt(sessionId, {
        status: "failed",
        message,
        completedAt: new Date().toISOString(),
      });
    }
    throw error;
  }
}

export function getCloudSyncSessionResult(
  device: CloudSyncDevice,
  sessionId: string,
): CloudSyncPushResult | null {
  const attempt = getCloudSyncAttempt(device.id, sessionId);
  if (!attempt) {
    return null;
  }

  if (attempt.status === "conflict" || attempt.status === "processing") {
    const report = findMigrationReportBySessionId(sessionId);
    if (report) {
      const message = completedMessage(report);
      markCloudSyncAttemptApplied(sessionId, report.id, message);
      return {
        ok: true,
        status: "applied",
        message,
        sessionId,
        sourceOrders: attempt.sourceOrders,
        conflictCount: attempt.conflictCount,
        created: report.created,
        updatedFromSource: report.updatedFromSource,
        keptCloud: report.keptCloud,
        reportId: report.id,
      };
    }

    if (attempt.status === "conflict") {
      try {
        getMigrationPreview(sessionId);
      } catch {
        const message = "冲突处理已过期，请在本地重新同步";
        updateCloudSyncAttempt(sessionId, {
          status: "failed",
          message,
          completedAt: new Date().toISOString(),
        });
        return {
          ok: false,
          status: "failed",
          message,
          sessionId,
          sourceOrders: attempt.sourceOrders,
          conflictCount: attempt.conflictCount,
          created: 0,
          updatedFromSource: 0,
          keptCloud: 0,
          reportId: null,
        };
      }
    }
  }

  return {
    ok: attempt.status !== "failed" && attempt.status !== "rolled_back",
    status: attempt.status,
    message: attempt.message,
    sessionId,
    sourceOrders: attempt.sourceOrders,
    conflictCount: attempt.conflictCount,
    created: 0,
    updatedFromSource: 0,
    keptCloud: 0,
    reportId: attempt.reportId,
  };
}
