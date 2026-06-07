import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { setupAdminPasswordAction } from "@/app/auth-actions";
import { isAdminPasswordConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  match: "两次输入的密码不一致。",
  short: "密码至少需要 8 位。",
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (isAdminPasswordConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-8 text-zinc-950">
      <section className="grid w-full max-w-md gap-4 rounded-md border border-zinc-200 bg-white p-5">
        <div className="grid gap-2 text-center">
          <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-md bg-emerald-700 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">设置管理员密码</h1>
          <p className="text-sm leading-6 text-zinc-500">
            第一次使用先设置密码，以后电脑和手机访问都要先登录。
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <form action={setupAdminPasswordAction} className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            新密码
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              minLength={8}
              className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            再输入一次
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              required
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800"
          >
            保存并进入
          </button>
        </form>
      </section>
    </main>
  );
}
