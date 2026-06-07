import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getDataDirectory,
  getOrCreateSessionSecret,
  getStoredAdminPasswordHash,
  setStoredAdminPasswordHash,
} from "@/lib/db";

const COOKIE_NAME = "jeff_order_session";
const HASH_ALGORITHM = "sha256";
const HASH_ITERATIONS = 210_000;
const HASH_KEY_LENGTH = 32;
const SESSION_DAYS = 7;
const AUTH_FILE_NAME = "admin-password.json";
const RESET_FLAG_NAME = "reset-admin-password.flag";

function configuredEnvPassword() {
  return process.env.JEFF_ADMIN_PASSWORD?.trim() || "";
}

function hmacSecret() {
  return getOrCreateSessionSecret();
}

function authFilePath() {
  return path.join(getDataDirectory(), AUTH_FILE_NAME);
}

function resetFlagPath() {
  return path.join(getDataDirectory(), RESET_FLAG_NAME);
}

function isPasswordResetRequested() {
  return fs.existsSync(resetFlagPath());
}

function readStoredPasswordHashFile() {
  try {
    const raw = fs.readFileSync(authFilePath(), "utf8");
    const parsed = JSON.parse(raw) as { adminPasswordHash?: unknown };
    return typeof parsed.adminPasswordHash === "string"
      ? parsed.adminPasswordHash
      : null;
  } catch {
    return null;
  }
}

function writeStoredPasswordHashFile(hash: string) {
  const filePath = authFilePath();
  const tempPath = `${filePath}.${process.pid}.tmp`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      {
        adminPasswordHash: hash,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.renameSync(tempPath, filePath);
}

function clearPasswordResetRequest() {
  try {
    fs.rmSync(resetFlagPath(), { force: true });
  } catch {
  }
}

function storedAdminPasswordHash() {
  if (isPasswordResetRequested()) {
    return null;
  }

  const fileHash = readStoredPasswordHashFile();

  if (fileHash) {
    return fileHash;
  }

  const dbHash = getStoredAdminPasswordHash();

  if (dbHash) {
    try {
      writeStoredPasswordHashFile(dbHash);
    } catch {
    }
  }

  return dbHash;
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPayload(payload: string) {
  return createHmac(HASH_ALGORITHM, hmacSecret())
    .update(payload)
    .digest("base64url");
}

function timingSafeTextEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function sessionCookieSecure() {
  if (process.env.JEFF_COOKIE_SECURE === "true") {
    return true;
  }

  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(
    password,
    salt,
    HASH_ITERATIONS,
    HASH_KEY_LENGTH,
    HASH_ALGORITHM,
  ).toString("base64url");

  return `pbkdf2:${HASH_ITERATIONS}:${salt}:${hash}`;
}

function verifyPasswordHash(password: string, record: string) {
  const [type, iterationsText, salt, expected] = record.split(":");
  const iterations = Number.parseInt(iterationsText, 10);

  if (type !== "pbkdf2" || !Number.isFinite(iterations) || !salt || !expected) {
    return false;
  }

  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    HASH_KEY_LENGTH,
    HASH_ALGORITHM,
  ).toString("base64url");

  return timingSafeTextEqual(actual, expected);
}

export function getAdminPasswordSource() {
  if (configuredEnvPassword()) {
    return "环境变量";
  }

  if (isPasswordResetRequested()) {
    return "等待重新设置";
  }

  if (readStoredPasswordHashFile()) {
    return "本地密码文件";
  }

  if (storedAdminPasswordHash()) {
    return "首次设置";
  }

  return "未设置";
}

export function isAdminPasswordConfigured() {
  return Boolean(configuredEnvPassword() || storedAdminPasswordHash());
}

export function setAdminPassword(password: string) {
  const hash = hashPassword(password);
  writeStoredPasswordHashFile(hash);
  clearPasswordResetRequest();

  try {
    setStoredAdminPasswordHash(hash);
  } catch {
  }
}

export function verifyAdminPassword(password: string) {
  const envPassword = configuredEnvPassword();

  if (envPassword) {
    return timingSafeTextEqual(password, envPassword);
  }

  const stored = storedAdminPasswordHash();
  return stored ? verifyPasswordHash(password, stored) : false;
}

export async function createLoginSession() {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const payload = base64UrlJson({
    exp: Date.now() + maxAge * 1000,
    nonce: randomUUID(),
    v: 1,
  });
  const signature = signPayload(payload);
  const cookieStore = await cookies();

  cookieStore.set({
    name: COOKIE_NAME,
    value: `${payload}.${signature}`,
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax",
    secure: sessionCookieSecure(),
  });
}

export async function clearLoginSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isAuthenticated() {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;

  if (!value) {
    return false;
  }

  const [payload, signature] = value.split(".");

  if (!payload || !signature || !timingSafeTextEqual(signPayload(payload), signature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      exp?: number;
    };

    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export async function requireAuthenticatedPage() {
  if (!isAdminPasswordConfigured()) {
    redirect("/setup");
  }

  if (!(await isAuthenticated())) {
    redirect("/login");
  }
}

export async function ensureActionAuthenticated() {
  if (!isAdminPasswordConfigured()) {
    return false;
  }

  return isAuthenticated();
}
