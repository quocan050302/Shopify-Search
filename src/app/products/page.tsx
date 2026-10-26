"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Medal,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  PlaySquare,
  Play,
  Store,
  ExternalLink,
  Search,
  CheckCircle2,
  Clock,
  ChevronRight,
  ShoppingBag,
  RefreshCw,
  X,
  Eye,
  SlidersHorizontal,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { isStockImage } from "@/services/video/videoSourceResolver";

interface RankedItem {
  rank: number | null;
  candidate: {
    candidateId: string;
    researchProductId?: string | null;
    title: string;
    category: string;
    problemStatement: string | null;
    targetAudience: string | null;
    thumbnailUrl: string | null;
    videoUrl: string | null;
    canonicalProductUrl: string | null;
    storeDomain: string | null;
    advertiserNames: string[];
    supportingAdIds: string[];
    supportingSourceTypes: string[];
    totalObservationCount: number;
    distinctAdvertisersCount: number;
    sourceObservations?: any[];
  };
  score: {
    opportunityScore: number | null;
    evidenceConfidence: number;
    scoreStatus: "VERIFIED" | "PROVISIONAL" | "INSUFFICIENT_EVIDENCE";
    tier?: string;
    demandClass: string;
    strengths: string[];
    risks: string[];
    missingEvidence: string[];
    recommendation: string;
    recommendationRationale: string;
    pillars: Record<string, { score: number | null; maxWeight: number; status: string; explanation: string }>;
  };
}

interface LeaderboardData {
  researchRunId: string;
  topic: string;
  market: "US";
  lookbackDays: number;
  formulaVersion: string;
  runStatus: string;
  sourceStatuses: Record<string, string>;
  topThree: RankedItem[];
  provisionalCandidates?: RankedItem[];
  remainingCandidates: RankedItem[];
  insufficientEvidenceCandidates: RankedItem[];
  totalCandidatesDiscovered: number;
  generatedAt?: string;
}

interface ProviderStatusItem {
  source: string;
  displayName: string;
  readiness: string;
  isReady: boolean;
  readinessReason: string;
}

export default function ProductsPage() {
  // Research State
  const [topic, setTopic] = useState("Pet Gadgets");
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [isResearching, setIsResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);

  // Live Provider Status State
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusItem[]>([]);

  // Database Products Tab State
  const [viewMode, setViewMode] = useState<"LEADERBOARD" | "STORED_PRODUCTS">("LEADERBOARD");
  const [storedProducts, setStoredProducts] = useState<any[]>([]);
  const [storedLoading, setStoredLoading] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategory, setStoredCategory] = useState("ALL");

  // Video / Media Modal State
  const [activeMediaItem, setActiveMediaItem] = useState<{
    title: string;
    videoUrl?: string | null;
    thumbnailUrl?: string | null;
    sourceUrl?: string | null;
    platform?: string;
  } | null>(null);

  // Candidate Inspection Modal State (for unlinked candidates)
  const [inspectCandidate, setInspectCandidate] = useState<RankedItem | null>(null);

  // Fetch Latest Leaderboard Snapshot from DB (No network research on reload)
  const fetchLatestLeaderboard = async () => {
    try {
      const res = await fetch("/api/v1/kh02/leaderboard");
      const json = await res.json();
      if (json.success && json.data) {
        setLeaderboard(json.data);
        if (json.data.topic) setTopic(json.data.topic);
        if (json.data.lookbackDays) setLookbackDays(json.data.lookbackDays);
      }
    } catch (err) {
      console.error("Failed to load saved leaderboard snapshot:", err);
    }
  };

  // Fetch Live Provider Readiness Statuses
  const fetchProviderStatuses = async () => {
    try {
      const res = await fetch("/api/v1/kh02/providers/status");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setProviderStatuses(json.data);
      }
    } catch (err) {
      console.error("Failed to load provider statuses:", err);
    }
  };

  // Polling helper with bounded attempts and explicit terminal classification
  const pollJobExecution = async (runId: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
      try {
        const runRes = await fetch(`/api/v1/kh02/research/runs/${runId}`);
        if (runRes.ok) {
          const runJson = await runRes.json();
          const status = runJson.data?.status;
          if (status === "COMPLETED" || status === "PARTIALLY_COMPLETED") {
            if (runJson.data?.result) {
              setLeaderboard(runJson.data.result);
            } else {
              await fetchLatestLeaderboard();
            }
            setViewMode("LEADERBOARD");
            return;
          } else if (status === "FAILED") {
            throw new Error(runJson.data?.errorMessage || "Background research job failed.");
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes("Background research job failed")) {
          throw err;
        }
      }
    }
    throw new Error("Research execution timed out waiting for worker snapshot.");
  };

  // Explicit User-Triggered Asynchronous Research Execution
  const executeResearch = async (selectedTopic: string = topic, days: number = lookbackDays) => {
    try {
      setIsResearching(true);
      setResearchError(null);

      const res = await fetch("/api/v1/kh02/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: selectedTopic.trim() || "Pet Gadgets",
          market: "US",
          lookbackDays: days,
          maxCandidates: 15,
          mode: "async",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to execute evergreen product research.");
      }

      if (res.status === 202 && (json.data?.runId || json.data?.jobId)) {
        const runId = json.data.runId || json.data.jobId;
        await pollJobExecution(runId);
      } else if (json.data?.result) {
        setLeaderboard(json.data.result);
        setViewMode("LEADERBOARD");
      } else if (json.data) {
        setLeaderboard(json.data);
        setViewMode("LEADERBOARD");
      }
    } catch (err: any) {
      setResearchError(err.message || "Failed to conduct evergreen product research.");
    } finally {
      setIsResearching(false);
    }
  };

  // Fetch Database Stored Products (Catalog)
  const fetchStoredProducts = async () => {
    try {
      setStoredLoading(true);
      const params = new URLSearchParams();
      if (storedSearch.trim()) params.append("query", storedSearch.trim());
      if (storedCategory !== "ALL") params.append("category", storedCategory);

      const res = await fetch(`/api/v1/products?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setStoredProducts(json.data);
      }
    } catch (err: any) {
      console.error("Error fetching stored products:", err);
    } finally {
      setStoredLoading(false);
    }
  };

  // On page mount: Restore saved state (NO automatic network research)
  useEffect(() => {
    fetchLatestLeaderboard();
    fetchProviderStatuses();
    fetchStoredProducts();
  }, []);

  const getSourceBadge = (sourceKey: string, defaultLabel: string) => {
    const live = providerStatuses.find((p) => p.source === sourceKey);
    const status = live?.readiness || leaderboard?.sourceStatuses?.[sourceKey] || "NOT_CONFIGURED";

    if (status === "SOURCE_DATA_VERIFIED" || status === "PASSED") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          {defaultLabel}: Verified
        </span>
      );
    }
    if (status === "CONFIGURED") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-950/70 border border-blue-500/40 text-blue-300 text-[11px] font-medium">
          <Clock className="h-3 w-3 text-blue-400" />
          {defaultLabel}: Configured
        </span>
      );
    }
    if (status === "NOT_VERIFIED") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-medium">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          {defaultLabel}: Not Verified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700/50 text-slate-400 text-[11px] font-medium">
        <Clock className="h-3 w-3 text-slate-500" />
        {defaultLabel}: Not Configured
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0B1020] text-slate-100">
      <Header onImportSuccess={() => fetchStoredProducts()} />

      <main className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
        {/* Header / Subheader */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 text-xs font-semibold mb-2">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>SWAI V12.1 — Evidence-Driven Evergreen Product Intelligence</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <Trophy className="h-7 w-7 text-amber-400" />
              <span>Evergreen Opportunity Leaderboard</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1 max-w-2xl">
              Cross-platform market intelligence across Meta Ads, TikTok Ads, TikTok Organic, and Google Ads Transparency. Identifying sustainable products for a long-term branded Shopify store.
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-[#111827] border border-[#1f293d] p-1 rounded-xl text-xs">
            <button
              onClick={() => setViewMode("LEADERBOARD")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "LEADERBOARD"
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Top 3 Leaderboard
            </button>
            <button
              onClick={() => setViewMode("STORED_PRODUCTS")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "STORED_PRODUCTS"
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All Researched SKUs ({storedProducts.length})
            </button>
          </div>
        </div>

        {/* Research Filter & Niche Selector */}
        <div className="p-5 rounded-2xl bg-[#161228] border border-[#2e234d] shadow-lg space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Topic Input */}
            <div className="md:col-span-6 relative">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400" />
              <input
                type="text"
                data-testid="kh02-research-input"
                placeholder="Enter niche or topic (e.g. Pet Gadgets, Home Cleaning, Kitchen Organization)..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && executeResearch()}
                suppressHydrationWarning
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0e0b1c] border border-[#3b2d63] text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 placeholder-slate-500"
              />
            </div>

            {/* Time Window Selector */}
            <div className="md:col-span-3 flex items-center bg-[#0e0b1c] border border-[#3b2d63] p-1 rounded-xl">
              {[30, 90, 180, 365].map((days) => (
                <button
                  key={days}
                  onClick={() => {
                    setLookbackDays(days);
                    executeResearch(topic, days);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    lookbackDays === days
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {days}D
                </button>
              ))}
            </div>

            {/* Action Button */}
            <div className="md:col-span-3">
              <button
                data-testid="kh02-analyze-button"
                onClick={() => executeResearch()}
                disabled={isResearching}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs md:text-sm flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
              >
                {isResearching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Analyzing Multi-Source Data...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Analyze Evergreen Niche</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dynamic Source Status Bar */}
          <div data-testid="kh02-source-status-bar" className="pt-3 border-t border-[#2e234d]/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400 font-medium">
              <span>Source Status:</span>
              {getSourceBadge("META_ADS", "Meta Ads")}
              {getSourceBadge("TIKTOK_ADS", "TikTok Ads US")}
              {getSourceBadge("TIKTOK_ORGANIC", "TikTok Organic")}
              {getSourceBadge("GOOGLE_ADS", "Google Ads")}
              {getSourceBadge("DEMAND_HISTORY", "Demand History")}
            </div>
            <div className="text-slate-500 text-[11px]">
              Market: <span className="text-slate-300 font-semibold">United States</span> · Zero unapproved credit spend
            </div>
          </div>
        </div>

        {/* Error Notification */}
        {researchError && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 text-sm text-red-300 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
            <span>{researchError}</span>
          </div>
        )}

        {/* VIEW MODE 1: LEADERBOARD PRESENTATION */}
        {viewMode === "LEADERBOARD" && (
          <div className="space-y-8">
            {/* Top 3 Section Title */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Medal className="h-5 w-5 text-amber-400" />
                  <span>Top 3 Evidence-Qualified Evergreen Products</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Strictly gated on verified long-term demand stability (≥15/25 pts), multi-month coverage, and high confidence (≥65%).
                </p>
              </div>
              {leaderboard && (
                <span className="text-xs text-purple-400 font-mono">
                  {leaderboard.totalCandidatesDiscovered} candidates evaluated · Formula V{leaderboard.formulaVersion}
                </span>
              )}
            </div>

            {/* TOP 3 PODIUM CONTAINER */}
            {isResearching ? (
              <div className="p-16 rounded-2xl bg-[#161228] border border-[#2e234d] text-center space-y-4">
                <RefreshCw className="h-8 w-8 text-purple-400 animate-spin mx-auto" />
                <p className="text-sm font-semibold text-white">Aggregating cross-platform intelligence...</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Inspecting Meta ad observations, TikTok video metrics, Google advertiser domains, and historical demand time series.
                </p>
              </div>
            ) : leaderboard && leaderboard.topThree.length > 0 ? (
              <div data-testid="kh02-leaderboard-container" className="space-y-4">
                {leaderboard.topThree.map((item) => {
                  const rank = item.rank || 1;
                  const isGold = rank === 1;
                  const isSilver = rank === 2;

                  const borderColor = isGold
                    ? "border-[#F4C95D] shadow-[0_0_25px_rgba(244,201,93,0.15)]"
                    : isSilver
                    ? "border-[#66C9EB] shadow-[0_0_20px_rgba(102,201,235,0.15)]"
                    : "border-[#F48B87] shadow-[0_0_20px_rgba(244,139,135,0.15)]";

                  const badgeBg = isGold
                    ? "bg-[#F4C95D] text-black font-extrabold"
                    : isSilver
                    ? "bg-[#66C9EB] text-black font-extrabold"
                    : "bg-[#F48B87] text-black font-extrabold";

                  const rankLabel = isGold ? "#1 EVERGREEN WINNER" : isSilver ? "#2 STRONG CONTENDER" : "#3 VIABLE OPPORTUNITY";

                  return (
                    <div
                      key={item.candidate.candidateId}
                      data-testid="kh02-ranked-product-card"
                      className={`p-5 rounded-2xl bg-[#1D1733] border-2 ${borderColor} transition-all flex flex-col md:flex-row items-center gap-6 justify-between`}
                    >
                      {/* Left: Thumbnail & Video Trigger */}
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div
                          onClick={() => {
                            if (item.candidate.videoUrl || item.candidate.thumbnailUrl) {
                              setActiveMediaItem({
                                title: item.candidate.title,
                                videoUrl: item.candidate.videoUrl,
                                thumbnailUrl: item.candidate.thumbnailUrl,
                                sourceUrl: item.candidate.canonicalProductUrl,
                                platform: item.candidate.supportingSourceTypes[0] || "Meta",
                              });
                            }
                          }}
                          className="relative shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 cursor-pointer group"
                        >
                          {item.candidate.thumbnailUrl && !isStockImage(item.candidate.thumbnailUrl) ? (
                            <img
                              src={item.candidate.thumbnailUrl}
                              alt={item.candidate.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-purple-950/40 text-purple-300">
                              <ShoppingBag className="h-8 w-8 text-purple-400" />
                            </div>
                          )}
                          {/* Rank Badge */}
                          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[11px] ${badgeBg}`}>
                            #{rank}
                          </div>
                          {/* Video Play Overlay */}
                          {item.candidate.videoUrl ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-all">
                              <div className="w-8 h-8 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg">
                                <Play className="h-4 w-4 fill-white" />
                              </div>
                            </div>
                          ) : (
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                              <Eye className="h-2.5 w-2.5" /> Preview
                            </div>
                          )}
                        </div>

                        {/* Title & Core Problem */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40">
                              {rankLabel}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              {item.candidate.category}
                            </span>
                          </div>
                          <h3 className="text-base md:text-lg font-bold text-white leading-tight">
                            {item.candidate.title}
                          </h3>
                          {item.candidate.problemStatement && (
                            <p className="text-xs text-slate-300 line-clamp-2">
                              <span className="text-purple-400 font-semibold">Problem:</span> {item.candidate.problemStatement}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                            {item.candidate.storeDomain && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <Store className="h-3 w-3 text-indigo-400" />
                                {item.candidate.storeDomain}
                              </span>
                            )}
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400">
                              {item.candidate.distinctAdvertisersCount} active advertiser(s)
                            </span>
                            <span className="text-slate-600">•</span>
                            <span className="text-purple-300">
                              {item.candidate.supportingSourceTypes.join(", ")}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Scores & Action */}
                      <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-[#2e234d]">
                        {/* Score Metric */}
                        <div className="text-center md:text-right">
                          <span className="text-[10px] text-slate-400 block font-medium">Evergreen Score</span>
                          <span className="text-2xl md:text-3xl font-black text-white font-mono">
                            {item.score.opportunityScore ?? "—"}<span className="text-xs text-slate-500">/100</span>
                          </span>
                          <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                            {item.score.demandClass.replace("_", " ")}
                          </div>
                        </div>

                        {/* Evidence Confidence */}
                        <div className="text-center md:text-right">
                          <span className="text-[10px] text-slate-400 block font-medium">Confidence</span>
                          <span className="text-lg md:text-xl font-extrabold text-purple-300 font-mono">
                            {item.score.evidenceConfidence}%
                          </span>
                          <span className="text-[10px] text-emerald-400 block font-semibold">
                            {item.score.scoreStatus}
                          </span>
                        </div>

                        {/* Intelligence Action */}
                        <div>
                          {item.candidate.researchProductId ? (
                            <Link
                              href={`/products/${item.candidate.researchProductId}/intelligence`}
                              className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                            >
                              <span>Inspect Analysis</span>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          ) : (
                            <button
                              onClick={() => setInspectCandidate(item)}
                              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                            >
                              <span>Inspect Candidate</span>
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div data-testid="kh02-empty-state" className="p-8 rounded-2xl bg-[#161228] border border-amber-500/30 text-center space-y-3">
                <AlertTriangle className="h-7 w-7 text-amber-400 mx-auto" />
                <h3 className="text-sm font-bold text-white">No verified evergreen winners yet for &quot;{topic}&quot;</h3>
                <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                  To protect against false evergreen claims, candidates require proven non-declining multi-month historical demand stability (≥15/25 pts) and high evidence confidence (≥65%). Promising products are shown under Provisional Opportunities below.
                </p>
              </div>
            )}

            {/* PROVISIONAL OPPORTUNITIES SHORTLIST */}
            {leaderboard && leaderboard.provisionalCandidates && leaderboard.provisionalCandidates.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-[#1f293d]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-400" />
                      <span>Provisional Opportunities (Pending Long-Term Demand Confirmation)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Promising commercial presence observed across ads, but historical demand or supplier margins remain provisional.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-purple-400">
                    {leaderboard.provisionalCandidates.length} provisional candidates
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {leaderboard.provisionalCandidates.slice(0, 6).map((item) => (
                    <div
                      key={item.candidate.candidateId}
                      data-testid="kh02-provisional-product-card"
                      className="p-4 rounded-xl bg-[#130f24] border border-[#2b214a] hover:border-purple-500/40 transition-all flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div
                          onClick={() => {
                            if (item.candidate.videoUrl || item.candidate.thumbnailUrl) {
                              setActiveMediaItem({
                                title: item.candidate.title,
                                videoUrl: item.candidate.videoUrl,
                                thumbnailUrl: item.candidate.thumbnailUrl,
                                sourceUrl: item.candidate.canonicalProductUrl,
                                platform: item.candidate.supportingSourceTypes[0] || "Meta",
                              });
                            }
                          }}
                          className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 cursor-pointer"
                        >
                          {item.candidate.thumbnailUrl && !isStockImage(item.candidate.thumbnailUrl) ? (
                            <img src={item.candidate.thumbnailUrl} alt={item.candidate.title} className="w-full h-full object-cover" />
                          ) : (
                            <ShoppingBag className="h-6 w-6 text-purple-400 m-auto mt-5" />
                          )}
                          {item.candidate.videoUrl && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Play className="h-3 w-3 fill-white text-white" />
                            </div>
                          )}
                        </div>

                        <div className="space-y-1 flex-1">
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40">
                            PROVISIONAL
                          </span>
                          <h4 className="text-xs font-bold text-white line-clamp-1">{item.candidate.title}</h4>
                          <p className="text-[11px] text-slate-400 line-clamp-1">
                            {item.candidate.storeDomain || "Multi-store"} · {item.candidate.distinctAdvertisersCount} advertiser(s)
                          </p>
                          <div className="text-[10px] text-purple-300 font-mono pt-1">
                            Score: {item.score.opportunityScore ?? "—"}/100 · Conf: {item.score.evidenceConfidence}%
                          </div>
                        </div>
                      </div>

                      <div>
                        {item.candidate.researchProductId ? (
                          <Link
                            href={`/products/${item.candidate.researchProductId}/intelligence`}
                            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-semibold flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <button
                            onClick={() => setInspectCandidate(item)}
                            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-semibold flex items-center gap-1"
                          >
                            <span>Details</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* REMAINING CANDIDATES (#4+) */}
            {leaderboard && leaderboard.remainingCandidates.length > 0 && (
              <div className="space-y-3 pt-6 border-t border-[#1f293d]">
                <h3 className="text-sm font-bold text-slate-300">
                  Other Verified Candidates (#{leaderboard.remainingCandidates[0]?.rank || 4} and below)
                </h3>
                <div className="space-y-2">
                  {leaderboard.remainingCandidates.map((item) => (
                    <div
                      key={item.candidate.candidateId}
                      className="p-3.5 rounded-xl bg-[#141026] border border-[#261d40] hover:border-purple-500/40 transition-all flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-center font-bold text-slate-400 font-mono">
                          #{item.rank}
                        </span>
                        <div>
                          <h4 className="font-semibold text-white">{item.candidate.title}</h4>
                          <p className="text-[11px] text-slate-500">{item.candidate.category} · {item.candidate.storeDomain || "Multiple stores"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <span className="text-slate-400 text-[10px] block">Score</span>
                          <span className="font-bold text-white font-mono">{item.score.opportunityScore ?? "—"}/100</span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 text-[10px] block">Confidence</span>
                          <span className="font-semibold text-purple-300 font-mono">{item.score.evidenceConfidence}%</span>
                        </div>
                        {item.candidate.researchProductId ? (
                          <Link
                            href={`/products/${item.candidate.researchProductId}/intelligence`}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                          >
                            Inspect
                          </Link>
                        ) : (
                          <button
                            onClick={() => setInspectCandidate(item)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                          >
                            Details
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW MODE 2: STORED DATABASE SKUS (PRESERVES EXISTING FUNCTIONALITY) */}
        {viewMode === "STORED_PRODUCTS" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between text-xs">
              <div className="relative flex-1 w-full">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search catalog products by title or domain..."
                  value={storedSearch}
                  onChange={(e) => setStoredSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchStoredProducts()}
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <span className="text-slate-500 font-medium">Category:</span>
                <select
                  value={storedCategory}
                  onChange={(e) => setStoredCategory(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Home & Kitchen">Home & Kitchen</option>
                  <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                  <option value="Health & Wellness Products">Health & Wellness</option>
                  <option value="Pet Supplies">Pet Supplies</option>
                  <option value="Fitness">Fitness</option>
                  <option value="Fashion">Fashion</option>
                </select>
              </div>
            </div>

            {storedLoading ? (
              <div className="p-16 text-center text-slate-500">Loading catalog products...</div>
            ) : storedProducts.length === 0 ? (
              <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
                <ShoppingBag className="h-10 w-10 text-slate-600 mx-auto" />
                <p className="text-sm font-bold text-white">No products found in catalog</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {storedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
                  >
                    <div>
                      <div className="relative h-44 w-full bg-slate-950 overflow-hidden flex items-center justify-center">
                        {product.imageUrl && !isStockImage(product.imageUrl) ? (
                          <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag className="h-8 w-8 text-slate-700" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                          {product.category}
                        </span>
                        <h2 className="text-sm font-bold text-white line-clamp-2">{product.title}</h2>
                        <p className="text-xs text-slate-400 font-mono">
                          Domain: <span className="text-indigo-300">{product.store?.domain || "Unknown"}</span>
                        </p>
                      </div>
                    </div>

                    <div className="p-4 pt-0 space-y-3">
                      <div className="flex items-center justify-between pt-3 border-t border-[#1f293d]">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Observed Price</span>
                          <span className="text-base font-extrabold text-emerald-400 font-mono">
                            {product.currentPrice != null ? `$${product.currentPrice.toFixed(2)}` : "—"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block">Linked Ads</span>
                          <span className="text-xs font-bold text-white font-mono">
                            {product.adLinks?.length ?? 0} observed
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/products/${product.id}/intelligence`}
                        className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Product Intelligence</span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* VIDEO / MEDIA PREVIEW MODAL */}
      {activeMediaItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161228] border border-[#2e234d] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40 font-bold">
                  {activeMediaItem.platform || "Media Creative"}
                </span>
                <h3 className="text-base font-bold text-white mt-1 line-clamp-1">{activeMediaItem.title}</h3>
              </div>
              <button
                onClick={() => setActiveMediaItem(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
              {activeMediaItem.videoUrl ? (
                <video
                  src={activeMediaItem.videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              ) : activeMediaItem.thumbnailUrl ? (
                <img
                  src={activeMediaItem.thumbnailUrl}
                  alt={activeMediaItem.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <p className="text-xs text-slate-500">Media source unavailable for preview.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-400">Verified platform creative demonstration</span>
              {activeMediaItem.sourceUrl && (
                <a
                  href={activeMediaItem.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                >
                  <span>Open Canonical Source</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CANDIDATE INSPECTION MODAL (For Unlinked Candidates) */}
      {inspectCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161228] border border-[#2e234d] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40 font-bold">
                  CANDIDATE INTELLIGENCE SUMMARY
                </span>
                <h3 className="text-lg font-bold text-white mt-1">{inspectCandidate.candidate.title}</h3>
                <p className="text-xs text-slate-400">
                  {inspectCandidate.candidate.category} · {inspectCandidate.candidate.storeDomain || "Multiple Storefronts"}
                </p>
              </div>
              <button
                onClick={() => setInspectCandidate(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Score Overview */}
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[#0e0b1c] border border-[#2e234d]">
              <div>
                <span className="text-[10px] text-slate-400 block">Opportunity Score</span>
                <span className="text-xl font-bold text-white font-mono">{inspectCandidate.score.opportunityScore ?? "—"}/100</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Evidence Confidence</span>
                <span className="text-xl font-bold text-purple-300 font-mono">{inspectCandidate.score.evidenceConfidence}%</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Recommendation</span>
                <span className="text-xs font-bold text-amber-400">{inspectCandidate.score.recommendation}</span>
              </div>
            </div>

            {/* Problem Statement */}
            {inspectCandidate.candidate.problemStatement && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-purple-400">Identified Problem / Pain Point</span>
                <p className="text-xs text-slate-300 bg-[#0e0b1c] p-3 rounded-lg border border-[#2e234d]">
                  {inspectCandidate.candidate.problemStatement}
                </p>
              </div>
            )}

            {/* Pillars Breakdown */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300">Six-Pillar Evaluation</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(inspectCandidate.score.pillars).map(([key, val]) => (
                  <div key={key} className="p-2.5 rounded-lg bg-[#0e0b1c] border border-[#261d40] space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 capitalize text-[11px]">{key.replace(/([A-Z])/g, " $1")}</span>
                      <span className="font-bold text-white font-mono">{val.score ?? 0}/{val.maxWeight}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 line-clamp-1">{val.explanation}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Missing Evidence */}
            {inspectCandidate.score.missingEvidence.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-amber-400">Missing Signals For Full Evergreening</span>
                <ul className="text-[11px] text-slate-400 space-y-1 bg-[#0e0b1c] p-3 rounded-lg border border-[#2e234d] list-disc list-inside">
                  {inspectCandidate.score.missingEvidence.map((m, idx) => (
                    <li key={idx}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Canonical Link */}
            {inspectCandidate.candidate.canonicalProductUrl && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">Store Destination URL</span>
                <a
                  href={inspectCandidate.candidate.canonicalProductUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                >
                  <span>Visit Storefront</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
