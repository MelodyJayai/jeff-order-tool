import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f8] px-4 text-zinc-950">
      <section className="grid w-full max-w-lg gap-4 rounded-md border border-zinc-200 bg-white p-6">
        <div>
          <h1 className="text-xl font-semibold">没有找到这个页面</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            如果只是要使用订单工具，请回到订单总表。
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          回到订单总表
        </Link>
      </section>
    </main>
  );
}
