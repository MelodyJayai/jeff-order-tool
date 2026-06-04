import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jeff 制衣订单出货核销",
  description: "订单号码登记、细分类数量和出货核销工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
