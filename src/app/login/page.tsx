import { LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";

import { loginAction } from "@/app/auth-actions";
import { isAdminPasswordConfigured, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  "1": "密码不正确，请重新输入。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAdminPasswordConfigured()) {
    redirect("/setup");
  }

  if (await isAuthenticated()) {
    redirect("/");
  }

  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-8 text-zinc-950">
      <section className="grid w-full max-w-sm gap-4 rounded-md border border-zinc-200 bg-white p-5">
        <div className="grid gap-2 text-center">
          <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-md bg-zinc-950 text-white">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Jeff 订单工具</h1>
          <p className="text-sm text-zinc-500">请输入管理员密码</p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <form action={loginAction} className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            管理员密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-200"
              required
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            登录
          </button>
        </form>
      </section>
    </main>
  );
}
