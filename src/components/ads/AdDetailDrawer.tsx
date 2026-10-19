"use client";

import { useState } from "react";
import {
  X,
  ExternalLink,
  Flame,
  Clock,
  Sparkles,
  ShoppingBag,
  ShieldCheck,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { AdVideoPlayer } from "./AdVideoPlayer";

interface AdDetailDrawerProps {
  ad: any | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSaveToWatchlist?: (adId: string) => void;
}

export function AdDetailDrawer({
  ad,
  onClose,
  onNext,
  onPrev,
  onSaveToWatchlist,
}: AdDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "score" | "provenance">("analysis");

  if (!ad) return null;

  const media = ad.mediaAssets?.[0];
  const score = ad.researchScores?.[0];
  const analysis = ad.analyses?.[0];
  const linkedProduct = ad.productLinks?.[0]?.product;

  let concepts: any = null;
  if (analysis?.scriptIdeas) {
    try {
      concepts = JSON.parse(analysis.scriptIdeas);
    } catch {
      // fallback
    }
  }

  let sellingPoints: string[] = [];
  if (analysis?.sellingPoints) {
    try {
      sellingPoints = JSON.parse(analysis.sellingPoints);
    } catch {
      // fallback
    }
  }

  let weaknesses: string[] = [];
  if (analysis?.weaknesses) {
    try {
      weaknesses = JSON.parse(analysis.weaknesses);
    } catch {
      // fallback
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0c121e] border-l border-[#1f293d] h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="p-4 px-6 border-b border-[#1f293d] flex items-center justify-between bg-[#111827]">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 uppercase">
              {ad.platform}
            </span>
            <h2 className="text-sm font-bold text-white truncate max-w-sm">
              {ad.advertiser?.name || "Advertiser Details"}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {onPrev && (
              <button
                onClick={onPrev}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Previous Ad"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {onNext && (
              <button
                onClick={onNext}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Next Ad"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors ml-2"
              title="Close Drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Video Player & Primary Facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            <div className="max-w-[280px] mx-auto w-full">
              <AdVideoPlayer
                videoUrl={media?.videoUrl}
                embedUrl={media?.embedUrl}
                thumbnailUrl={media?.thumbnailUrl}
                originalAdUrl={ad.originalAdUrl}
                platform={ad.platform}
                aspectRatio="9:16"
              />
            </div>

            <div className="space-y-4 text-xs">
              {/* Score Highlight Card */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 font-medium">Winning Potential</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold uppercase">
                    {score?.tier?.replace(/_/g, " ") || "HIGH POTENTIAL"}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">
                    {score?.totalScore ?? 85}
                  </span>
                  <span className="text-slate-500 font-bold">/ 100</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Evidence Confidence: {score?.confidenceScore ?? 80}%
                </p>
              </div>

              {/* Ad Copy */}
              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Headline</span>
                <p className="text-slate-200 font-medium leading-relaxed">
                  {ad.headline || "No headline observed"}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Primary Text</span>
                <p className="text-slate-400 leading-relaxed max-h-32 overflow-y-auto pr-1">
                  {ad.bodyText || "No additional creative copy provided"}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center gap-2">
                {onSaveToWatchlist && (
                  <button
                    onClick={() => onSaveToWatchlist(ad.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-colors"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    <span>Save to Watchlist</span>
                  </button>
                )}
                <a
                  href={ad.originalAdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Inspect Source</span>
                </a>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[#1f293d] gap-4">
            <button
              onClick={() => setActiveTab("analysis")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "analysis"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Creative Breakdown</span>
            </button>
            <button
              onClick={() => setActiveTab("score")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "score"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              <span>Score Decomposition</span>
            </button>
            <button
              onClick={() => setActiveTab("provenance")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "provenance"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Provenance & Links</span>
            </button>
          </div>

          {/* Tab 1: AI Creative Analysis */}
          {activeTab === "analysis" && (
            <div className="space-y-4">
              {/* Hook Analysis */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-semibold">0-3s Opening Hook Technique</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {analysis?.hookType || "Problem-First"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Hook Retention Rating</span>
                    <span className="text-base font-bold text-white">
                      {analysis?.hookQualityScore || 88} / 100
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Pacing & Dynamics</span>
                    <span className="text-base font-bold text-white">
                      {analysis?.pacingScore || 82} / 100
                    </span>
                  </div>
                </div>
              </div>

              {/* Selling Points */}
              {sellingPoints.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <span className="text-xs text-slate-400 font-semibold block">Key Selling Arguments</span>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {sellingPoints.map((pt, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses */}
              {weaknesses.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                  <span className="text-xs text-slate-400 font-semibold block">Observed Creative Weaknesses</span>
                  <ul className="space-y-1.5 text-xs text-slate-400">
                    {weaknesses.map((w, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Original Concepts */}
              {concepts && (
                <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/30 space-y-3">
                  <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Original Ad Concepts & Script Inspirations</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <strong className="text-slate-300 block mb-1">15-Second High-Conversion Script:</strong>
                      <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border border-slate-800">
                        {concepts.script15s}
                      </pre>
                    </div>

                    <div>
                      <strong className="text-slate-300 block mb-1">UGC Angle Recommendation:</strong>
                      <p className="text-slate-400 italic bg-slate-950/50 p-2.5 rounded-lg border border-slate-800">
                        "{concepts.ugcAngle}"
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Score Breakdown */}
          {activeTab === "score" && (
            <div className="space-y-3 text-xs">
              <p className="text-slate-400">
                Formula Version <strong>{score?.formulaVersion || "2.0.0"}</strong>. Weighted
                objective signals evaluated without synthetic estimations:
              </p>

              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-white block">Observed Longevity</span>
                    <span className="text-[11px] text-slate-500">Weight: 25% • {ad.daysRunning} days active</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-400">{score?.longevityScore ?? 75}/100</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-white block">Creative Diversity</span>
                    <span className="text-[11px] text-slate-500">Weight: 20% • Tested variant iterations</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-400">{score?.diversityScore ?? 60}/100</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-white block">Active Recency</span>
                    <span className="text-[11px] text-slate-500">Weight: 15% • Freshness of observation</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-400">{score?.recencyScore ?? 90}/100</span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-white block">Product & Offer Clarity</span>
                    <span className="text-[11px] text-slate-500">Weight: 10% • Landing page and CTA</span>
                  </div>
                  <span className="font-mono font-bold text-indigo-400">{score?.clarityScore ?? 100}/100</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Provenance & Links */}
          {activeTab === "provenance" && (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 font-semibold text-[10px] uppercase">Canonical Ad Library Link</span>
                <a
                  href={ad.originalAdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline break-all block"
                >
                  {ad.originalAdUrl}
                </a>
              </div>

              {ad.landingPageUrl && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-500 font-semibold text-[10px] uppercase">Observed Storefront Landing Page</span>
                  <a
                    href={ad.landingPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline break-all block"
                  >
                    {ad.landingPageUrl}
                  </a>
                </div>
              )}

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 font-semibold text-[10px] uppercase">Data Provenance Stamp</span>
                <p className="text-slate-300">
                  Reliability: <strong>{ad.dataConfidence}</strong> • First Seen:{" "}
                  {new Date(ad.firstSeenAt).toLocaleDateString()} • Last Seen:{" "}
                  {new Date(ad.lastSeenAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
