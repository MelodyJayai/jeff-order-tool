"use client";

import { RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f8] px-4 text-zinc-950">
      <section className="grid w-full max-w-xl gap-4 rounded-md border border-zinc-200 bg-white p-6">
        <div>
          <h1 className="text-xl font-semibold">工具暂时打不开</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            可以先点重试。如果仍然失败，请保留 data 文件夹，并查看绿色版目录下的
            logs/server.log。
          </p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          {error.message || error.digest || "未知错误"}
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          重试
        </button>
      </section>
    </main>
  );
}
