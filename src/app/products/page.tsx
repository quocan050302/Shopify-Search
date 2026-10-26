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
  Filter,
  CheckCircle2,
  Clock,
  ChevronRight,
  Layers,
  ShoppingBag,
  Info,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { isStockImage } from "@/services/video/videoSourceResolver";

interface RankedItem {
  rank: number | null;
  candidate: {
    candidateId: string;
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
  };
  score: {
    opportunityScore: number | null;
    evidenceConfidence: number;
    scoreStatus: "VERIFIED" | "PROVISIONAL" | "INSUFFICIENT_EVIDENCE";
    demandClass: string;
    strengths: string[];
    risks: string[];
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
  remainingCandidates: RankedItem[];
  insufficientEvidenceCandidates: RankedItem[];
  totalCandidatesDiscovered: number;
}

export default function ProductsPage() {
  // Research State
  const [topic, setTopic] = useState("Pet Gadgets");
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [isResearching, setIsResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);

  // Database Products Tab State (for backward compatibility)
  const [viewMode, setViewMode] = useState<"LEADERBOARD" | "STORED_PRODUCTS">("LEADERBOARD");
  const [storedProducts, setStoredProducts] = useState<any[]>([]);
  const [storedLoading, setStoredLoading] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategory, setStoredCategory] = useState("ALL");

  // Run KH-02 Research
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
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to execute evergreen product research.");
      }

      setLeaderboard(json.data);
      setViewMode("LEADERBOARD");
    } catch (err: any) {
      setResearchError(err.message || "Failed to conduct evergreen product research.");
    } finally {
      setIsResearching(false);
    }
  };

  // Fetch Database Stored Products
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

  // Initial research run on mount
  useEffect(() => {
    executeResearch("Pet Gadgets", 90);
    fetchStoredProducts();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0B1020] text-slate-100">
      <Header onImportSuccess={() => fetchStoredProducts()} />

      <main className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
        {/* Hero Title & Subheader */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 text-xs font-semibold mb-2">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>SWAI V12.0 — Evergreen Winning Products Intelligence</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <Trophy className="h-7 w-7 text-amber-400" />
              <span>Evergreen Opportunity Leaderboard</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1 max-w-2xl">
              Cross-platform market intelligence across Meta Ads, TikTok Ads, TikTok Organic, and Google Ads Transparency. Identifying sustainable products for a long-term branded Shopify store.
            </p>
          </div>

          {/* View Mode Toggle */}
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

        {/* Research Filter & Niche Selector Panel */}
        <div className="p-5 rounded-2xl bg-[#161228] border border-[#2e234d] shadow-lg space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Topic Input */}
            <div className="md:col-span-6 relative">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400" />
              <input
                type="text"
                placeholder="Enter niche or topic (e.g. Pet Gadgets, Home Cleaning, Kitchen Organization)..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && executeResearch()}
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
                onClick={() => executeResearch()}
                disabled={isResearching}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs md:text-sm flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
              >
                {isResearching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Researching Evidence...</span>
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

          {/* Source Status Bar */}
          <div className="pt-3 border-t border-[#2e234d]/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-400 font-medium">
              <span>Source Status:</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[11px]">
                <CheckCircle2 className="h-3 w-3" /> Meta Ads: Active
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-500/30 text-amber-400 text-[11px]">
                <Clock className="h-3 w-3" /> TikTok Ads: Top Ads US
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-500/30 text-purple-300 text-[11px]">
                <PlaySquare className="h-3 w-3" /> TikTok Organic: Metered
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-950/60 border border-blue-500/30 text-blue-300 text-[11px]">
                <Store className="h-3 w-3" /> Google Ads: Domains
              </span>
            </div>
            <div className="text-slate-500 text-[11px]">
              Target Market: <span className="text-slate-300 font-semibold">United States (US)</span> · Zero unapproved credit spend
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
            {/* Section Title */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Medal className="h-5 w-5 text-amber-400" />
                  <span>Top 3 Sustainable Product Opportunities</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ranked by Demand Stability (25%), Problem-Solution Fit (20%), Multi-Platform Signals (20%), and Brandability (15%).
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
                  Inspecting Meta ad observations, TikTok video metrics, Google advertiser domains, and historical demand series.
                </p>
              </div>
            ) : leaderboard && leaderboard.topThree.length > 0 ? (
              <div className="space-y-4">
                {leaderboard.topThree.map((item) => {
                  const rank = item.rank || 1;
                  const isGold = rank === 1;
                  const isSilver = rank === 2;
                  const isBronze = rank === 3;

                  // Podium Visual Tokens
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
                      className={`p-5 rounded-2xl bg-[#1D1733] border-2 ${borderColor} transition-all flex flex-col md:flex-row items-center gap-6 justify-between`}
                    >
                      {/* Left: Thumbnail & Rank Badge */}
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="relative shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                          {item.candidate.thumbnailUrl && !isStockImage(item.candidate.thumbnailUrl) ? (
                            <img
                              src={item.candidate.thumbnailUrl}
                              alt={item.candidate.title}
                              className="w-full h-full object-cover"
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
                          {item.candidate.videoUrl && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/20 transition-all">
                              <div className="w-8 h-8 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg">
                                <Play className="h-4 w-4 fill-white" />
                              </div>
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
                          <span className="text-[10px] text-slate-500 block">
                            {item.score.scoreStatus}
                          </span>
                        </div>

                        {/* Intelligence Action */}
                        <div>
                          <Link
                            href={item.candidate.canonicalProductUrl ? `/products/${encodeURIComponent(item.candidate.candidateId)}/intelligence` : `/products`}
                            className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                          >
                            <span>Inspect Analysis</span>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-12 rounded-2xl bg-[#161228] border border-[#2e234d] text-center space-y-3">
                <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto" />
                <p className="text-sm font-bold text-white">No eligible evergreen candidates found for &quot;{topic}&quot;</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Try broadening the niche keyword or selecting a 180D or 365D lookback window to allow deeper historical demand analysis.
                </p>
              </div>
            )}

            {/* REMAINING CANDIDATES (#4+) */}
            {leaderboard && leaderboard.remainingCandidates.length > 0 && (
              <div className="space-y-3 pt-6 border-t border-[#1f293d]">
                <h3 className="text-sm font-bold text-slate-300">
                  Other Researched Candidates (#{leaderboard.remainingCandidates[0]?.rank || 4} and below)
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
                        <Link
                          href={`/products`}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                        >
                          View
                        </Link>
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
    </div>
  );
}
