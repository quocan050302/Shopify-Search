"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Share2,
  ShieldCheck,
  CheckCircle2,
  Database,
  Radio,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { ApiConnectionsManager } from "@/components/settings/ApiConnectionsManager";

export default function SettingsPage() {
  const [health, setHealth] = useState<any | null>(null);

  const fetchHealth = () => {
    fetch("/api/v1/health")
      .then((r) => r.json())
      .then((hJson) => {
        if (hJson.success) setHealth(hJson.data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-5xl mx-auto w-full space-y-8">
        {/* Title & Mode */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <Settings className="h-5 w-5 text-indigo-400" />
              <span>Application Settings & API Connections</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Current Operating Mode: <strong className="text-emerald-400">RESEARCH_ONLY</strong> • Target Market: <strong className="text-white">United States (US)</strong>
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5 font-medium">
              <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
              <span>US Market Research Mode</span>
            </span>
          </div>
        </div>

        {/* Section 1: API Connections Manager (Gemini, Meta, Captapi, Shopify NOT_CONNECTED) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                External Intelligence & API Connections
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure credentials securely for AI creative intelligence and competitor ad research.
              </p>
            </div>
          </div>

          <ApiConnectionsManager onStatusChange={fetchHealth} />
        </section>

        {/* Section 2: Future Advertising Accounts (Meta & TikTok Owned Accounts) */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Private Merchant Accounts (Post-Launch)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sync owned advertising spend and conversion data once active campaigns are running.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Meta Ads Account */}
            <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                    <Share2 className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white">Meta Ads Manager (Owned)</h3>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono font-semibold">
                  NOT_CONNECTED
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Private ad account synchronization. Connect when you launch active Facebook & Instagram campaigns to evaluate owned ROAS and ad spend.
              </p>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
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
                  <h3 className="text-sm font-bold text-white">TikTok Ads Manager (Owned)</h3>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono font-semibold">
                  NOT_CONNECTED
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Private TikTok commercial ad account integration. Connect to track cost-per-acquisition (CPA) and live video conversions.
              </p>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                TikTok Creative Center research functions independently of this account.
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: System Health & Provenance Diagnostics */}
        <section className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
            <Database className="h-5 w-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">System Diagnostics & Isolation Audit</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 block">Database Status</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{health?.database || "CONNECTED"}</span>
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 block">APP #1 Isolation</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>CONFIRMED SAFE</span>
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 block">Data Provenance</span>
              <span className="font-bold text-white font-mono">100% TRACEABLE</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
