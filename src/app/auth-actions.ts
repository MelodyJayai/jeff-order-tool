"use server";

import { redirect } from "next/navigation";

import {
  clearLoginSession,
  createLoginSession,
  isAdminPasswordConfigured,
  setAdminPassword,
  verifyAdminPassword,
} from "@/lib/auth";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function setupAdminPasswordAction(formData: FormData) {
  if (isAdminPasswordConfigured()) {
    redirect("/login");
  }

  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");

  if (password.length < 8) {
    redirect("/setup?error=short");
  }

  if (password !== confirmPassword) {
    redirect("/setup?error=match");
  }

  setAdminPassword(password);
  await createLoginSession();
  redirect("/");
}

export async function loginAction(formData: FormData) {
  if (!isAdminPasswordConfigured()) {
    redirect("/setup");
  }

  if (!verifyAdminPassword(text(formData, "password"))) {
    redirect("/login?error=1");
  }

  await createLoginSession();
  redirect("/");
}

export async function logoutAction() {
  await clearLoginSession();
  redirect("/login");
}
