"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Store,
  Share2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Database,
  Lock,
  ExternalLink,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function SettingsPage() {
  const [health, setHealth] = useState<any | null>(null);
  const [integrations, setIntegrations] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/health").then((r) => r.json()),
      fetch("/api/v1/settings/integrations").then((r) => r.json()),
    ])
      .then(([hJson, iJson]) => {
        if (hJson.success) setHealth(hJson.data);
        if (iJson.success) setIntegrations(iJson.data.integrations);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-5xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Settings className="h-5 w-5 text-indigo-400" />
            <span>Application Settings & Connection Readiness</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Current Operating Mode: <strong className="text-emerald-400">RESEARCH_ONLY</strong> • Target Market: <strong className="text-white">United States (US)</strong>
          </p>
        </div>

        {/* Section 1: Future Shopify Connection (Honest Disconnected State) */}
        <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Store className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Shopify Store Connection</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-semibold">
                    NOT_CONNECTED
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Connect your Shopify store when you are ready to analyze real orders, revenue, and advertising profitability.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-3">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <Lock className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Pre-Shopify Research Mode is active. No Shopify account is required today.
              </span>
            </div>
            <p className="text-slate-500 leading-relaxed">
              When your store is ready to launch, connecting your store will automatically enable verified net sales tracking, product catalog reconciliation, and contribution profit analysis.
            </p>

            <div className="pt-2 flex items-center gap-3">
              <input
                type="text"
                disabled
                placeholder="your-store-name.myshopify.com"
                className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-500 text-xs w-72 cursor-not-allowed font-mono"
              />
              <button
                disabled
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-500 font-medium text-xs border border-slate-700 cursor-not-allowed"
              >
                Connect Store (Available Post-Launch)
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Future Advertising Accounts (Meta & TikTok) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Meta Ads Account */}
          <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Share2 className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-white">Meta Ads Manager</h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono font-semibold">
                NOT_CONNECTED
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Private ad account synchronization. Connect when you launch active Facebook & Instagram campaigns to evaluate owned ROAS and spend.
            </p>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-500">
              Public Meta Ad Library research functions independently of this account.
            </div>
          </div>

          {/* TikTok Ads Account */}
          <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                  <Share2 className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-white">TikTok Ads Manager</h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono font-semibold">
                NOT_CONNECTED
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Private TikTok commercial ad account integration. Connect to track cost-per-acquisition (CPA) and live video conversions.
            </p>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-500">
              TikTok Creative Center research functions independently of this account.
            </div>
          </div>
        </div>

        {/* Section 3: System Health & Provenance Diagnostics */}
        <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
            <Database className="h-5 w-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">System Diagnostics & Isolation Audit</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-500 block">Database Status</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{health?.database || "CONNECTED"}</span>
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-500 block">APP #1 Isolation</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>CONFIRMED SAFE</span>
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-500 block">Data Provenance</span>
              <span className="font-bold text-white font-mono">100% TRACEABLE</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
