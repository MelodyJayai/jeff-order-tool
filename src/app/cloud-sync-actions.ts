"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ensureActionAuthenticated } from "@/lib/auth";
import {
  createCloudSyncPairing,
  revokeCloudSyncDevice,
} from "@/lib/cloud-sync-store";
import { isCloudDeployment } from "@/lib/deployment";

async function requireCloudAdmin() {
  if (!(await ensureActionAuthenticated())) {
    redirect("/login");
  }
  if (!isCloudDeployment()) {
    redirect("/");
  }
}

export async function createCloudSyncPairingAction() {
  await requireCloudAdmin();
  const pairing = createCloudSyncPairing();
  revalidatePath("/cloud-sync");
  redirect(
    `/cloud-sync?${new URLSearchParams({
      code: pairing.code,
      expires: pairing.expiresAt,
    }).toString()}`,
  );
}

export async function revokeCloudSyncDeviceAction(formData: FormData) {
  await requireCloudAdmin();
  const deviceId = formData.get("deviceId");
  if (typeof deviceId === "string" && deviceId.trim()) {
    revokeCloudSyncDevice(deviceId.trim());
  }
  revalidatePath("/cloud-sync");
  redirect("/cloud-sync?revoked=1");
}
