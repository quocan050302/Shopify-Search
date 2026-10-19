"use client";

import Link from "next/link";
import { Store, Lock, ArrowRight, ShieldAlert, BarChart3 } from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function MyStorePage() {
  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-4xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Store className="h-5 w-5 text-indigo-400" />
            <span>Store Performance & Advertising Attribution</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Private financial reconciliation of Shopify orders, net revenue, ad spend, and true contribution profit
          </p>
        </div>

        {/* Honest Disconnected State Container */}
        <div className="p-10 rounded-2xl bg-[#111827] border border-[#1f293d] text-center space-y-5">
          <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="h-8 w-8" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-lg font-bold text-white">Your Shopify store is not connected yet.</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              This analytics section unlocks once you launch and connect an active Shopify store. SWAI will then calculate verified net sales, ad ROAS, cost-per-acquisition (CPA), and true contribution profit.
            </p>
          </div>

          {/* Truthfulness Notice */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 max-w-lg mx-auto flex items-center gap-2 text-left">
            <ShieldAlert className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Zero Fabricated Data Policy</strong>: We do not display cosmetic fake orders, synthetic conversion charts, or placeholder revenue figures before real connection.
            </span>
          </div>

          <div className="pt-2">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
            >
              <span>View Connection Settings</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
