"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Clock,
  PlaySquare,
  ShieldCheck,
  TrendingUp,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function TrackerPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/ads?pageSize=30")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setAds(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-400" />
            <span>Competitor Advertising Tracker</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Chronological observation timeline of competitor ad testing, creative iterations, and pricing changes
          </p>
        </div>

        {/* Timeline Events List */}
        <div className="rounded-xl bg-[#111827] border border-[#1f293d] p-6 space-y-6">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Calendar className="h-4 w-4 text-emerald-400" />
            <span>Observed Activity Timeline</span>
          </h2>

          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading activity timeline...</div>
          ) : (
            <div className="space-y-4">
              {ads.map((ad, idx) => (
                <div
                  key={ad.id}
                  className="flex items-start gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="p-2.5 rounded-lg bg-indigo-600/20 text-indigo-400 shrink-0">
                    <PlaySquare className="h-5 w-5" />
                  </div>

                  <div className="flex-1 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm">
                        {ad.advertiser?.name}
                      </span>
                      <span className="text-slate-500 font-mono text-[11px]">
                        First seen {new Date(ad.firstSeenAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-slate-300 font-medium">
                      "{ad.headline || "Observed video advertisement"}"
                    </p>

                    <div className="flex items-center gap-3 pt-2 text-[11px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1 font-mono text-emerald-400">
                        <Clock className="h-3 w-3" />
                        <span>{ad.daysRunning} days continuous active run</span>
                      </span>
                      <span>•</span>
                      <span>Platform: <strong className="text-white">{ad.platform}</strong></span>
                      <span>•</span>
                      <a
                        href={ad.originalAdUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:underline"
                      >
                        <span>Official Library Permlink</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
