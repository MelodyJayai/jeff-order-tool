import { createHash } from "node:crypto";
import path from "node:path";

import { getDataDirectory } from "@/lib/db";

function normalizedPath(value: string) {
  return path
    .resolve(value)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
}

export function getAppBaseDirectory() {
  return path.resolve(
    process.env.JEFF_APP_BASE_DIR?.trim() || path.dirname(getDataDirectory()),
  );
}

export function getAppInstanceId() {
  return createHash("sha256")
    .update(normalizedPath(getAppBaseDirectory()), "utf8")
    .digest("hex");
}
