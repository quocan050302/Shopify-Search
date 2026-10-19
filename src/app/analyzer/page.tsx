"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  PlaySquare,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Film,
  Zap,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { AdVideoPlayer } from "@/components/ads/AdVideoPlayer";

export default function AnalyzerPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [selectedAdId, setSelectedAdId] = useState<string>("");
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v1/ads?pageSize=20")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data.length > 0) {
          setAds(json.data);
          setSelectedAdId(json.data[0].id);
        }
      });
  }, []);

  const activeAd = ads.find((a) => a.id === selectedAdId);

  useEffect(() => {
    if (!selectedAdId) return;
    setLoading(true);
    fetch(`/api/v1/ads/${selectedAdId}/analyze`, { method: "POST" })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setAnalysis(json.data);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedAdId]);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            <span>AI Creative Analyzer</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Grounded structural analysis of 0-3s hook techniques, retention pacing, and original ad script generation
          </p>
        </div>

        {/* Ad Selector Bar */}
        <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex items-center gap-3 text-xs">
          <span className="text-slate-400 font-semibold whitespace-nowrap">Select Advertisement to Inspect:</span>
          <select
            value={selectedAdId}
            onChange={(e) => setSelectedAdId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
          >
            {ads.map((ad) => (
              <option key={ad.id} value={ad.id}>
                {ad.advertiser?.name} — {ad.headline || ad.category} ({ad.platform})
              </option>
            ))}
          </select>
        </div>

        {/* Main Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Media & Original Copy */}
          <div className="lg:col-span-5 space-y-4">
            {activeAd && (
              <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                <div className="max-w-[280px] mx-auto">
                  <AdVideoPlayer
                    videoUrl={activeAd.mediaAssets?.[0]?.videoUrl}
                    embedUrl={activeAd.mediaAssets?.[0]?.embedUrl}
                    thumbnailUrl={activeAd.mediaAssets?.[0]?.thumbnailUrl}
                    originalAdUrl={activeAd.originalAdUrl}
                    platform={activeAd.platform}
                    aspectRatio="9:16"
                  />
                </div>

                <div className="space-y-1 text-xs">
                  <span className="text-slate-500 font-semibold uppercase text-[10px]">Brand / Merchant</span>
                  <p className="text-white font-bold">{activeAd.advertiser?.name}</p>
                </div>

                <div className="space-y-1 text-xs">
                  <span className="text-slate-500 font-semibold uppercase text-[10px]">Observable Copy</span>
                  <p className="text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                    {activeAd.bodyText || activeAd.headline || "No text available"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: AI Analysis Cards */}
          <div className="lg:col-span-7 space-y-4">
            {loading ? (
              <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center text-slate-500">
                Running grounded video & copy analysis...
              </div>
            ) : analysis ? (
              <>
                {/* Hook Metric Card */}
                <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-semibold">0-3s Opening Hook Classification</span>
                    <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {analysis.hookType}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                      <span className="text-[11px] text-slate-400 block mb-0.5">Hook Retention Score</span>
                      <span className="text-2xl font-black text-white font-mono">
                        {analysis.hookQualityScore} <span className="text-xs text-slate-500 font-normal">/ 100</span>
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800">
                      <span className="text-[11px] text-slate-400 block mb-0.5">Video Pacing & Dynamics</span>
                      <span className="text-2xl font-black text-white font-mono">
                        {analysis.pacingScore} <span className="text-xs text-slate-500 font-normal">/ 100</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selling Points & Weaknesses */}
                <div className="p-5 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
                  <div>
                    <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>Identified Core Selling Points</span>
                    </h3>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {analysis.sellingPoints?.map((pt: string, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-slate-800">
                    <h3 className="text-xs font-bold text-white mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <span>Creative Weaknesses & Missed Opportunities</span>
                    </h3>
                    <ul className="space-y-1.5 text-xs text-slate-400">
                      {analysis.weaknesses?.map((w: string, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Generated Original Concepts */}
                {analysis.originalConcepts && (
                  <div className="p-5 rounded-xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-900/40 space-y-4">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-xs font-bold text-white">
                        AI-Generated Original Concepts Inspired by This Ad
                      </h3>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <strong className="text-indigo-300 block mb-1">Recommended Hook Concept:</strong>
                        <p className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-200 border border-slate-800">
                          {analysis.originalConcepts.hookConcept}
                        </p>
                      </div>

                      <div>
                        <strong className="text-indigo-300 block mb-1">15-Second High-Conversion Script:</strong>
                        <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border border-slate-800">
                          {analysis.originalConcepts.script15s}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
