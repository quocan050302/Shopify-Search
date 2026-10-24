import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "SWAI — Shopify Winning Ads Intelligence",
  description: "Discover, analyze, and track promising ecommerce video advertisements and winning products in the US market.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="bg-[#0a0e17] text-slate-100 flex min-h-screen">
        <Suspense fallback={<aside className="w-64 border-r border-slate-800 bg-[#070a10]" />}>
          <Sidebar />
        </Suspense>
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {children}
        </div>
      </body>
    </html>
  );
}
