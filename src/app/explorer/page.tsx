"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  LayoutGrid,
  ListFilter,
  PlaySquare,
  ExternalLink,
  Leaf,
  TrendingUp,
  Zap,
  Clock,
  Eye,
  AlertTriangle,
  RefreshCw,
  Flame,
  Compass,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { AdCard } from "@/components/ads/AdCard";
import { AdDetailDrawer } from "@/components/ads/AdDetailDrawer";

type ResearchMode = "EVERGREEN" | "EMERGING" | "TRENDING";

const MODE_CONFIG: Record<
  ResearchMode,
  { label: string; icon: React.ReactNode; description: string; color: string }
> = {
  EVERGREEN: {
    label: "Evergreen",
    icon: <Leaf className="h-3.5 w-3.5" />,
    description: "Ads with credible longevity evidence — sustained investment over time",
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  EMERGING: {
    label: "Emerging",
    icon: <Zap className="h-3.5 w-3.5" />,
    description: "Newer ads with early signals — watch for longevity development",
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  },
  TRENDING: {
    label: "Trending",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    description: "Ads sorted by evidence confidence — may include short-lived signals",
    color: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  },
};

const AGE_FILTER_OPTIONS = [
  { value: "", label: "Any age" },
  { value: "14", label: "14+ days" },
  { value: "30", label: "30+ days" },
  { value: "60", label: "60+ days" },
  { value: "90", label: "90+ days" },
  { value: "180", label: "180+ days" },
];

function LongevityBadge({ category }: { category?: string }) {
  if (!category || category === "UNKNOWN") return null;
  const map: Record<string, { label: string; color: string }> = {
    NEW_TESTING: { label: "New", color: "text-slate-400 border-slate-600" },
    EARLY_POTENTIAL: { label: "Early Signal", color: "text-amber-400 border-amber-600/40" },
    PROMISING: { label: "30+ Days", color: "text-yellow-400 border-yellow-600/40" },
    STRONG_CANDIDATE: { label: "60+ Days", color: "text-lime-400 border-lime-600/40" },
    EVERGREEN_CANDIDATE: { label: "90+ Days ✦", color: "text-emerald-400 border-emerald-500/40" },
    LONG_TERM_REFERENCE: { label: "180+ Days ★", color: "text-teal-300 border-teal-500/40" },
  };
  const cfg = map[category];
  if (!cfg) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${cfg.color}`}
    >
      <Clock className="h-2 w-2" />
      {cfg.label}
    </span>
  );
}

function EvidenceSourceBadge({ source }: { source?: string }) {
  if (!source || source === "NONE") {
    return (
      <span className="text-[9px] text-slate-600 italic">No date evidence</span>
    );
  }
  if (source === "SOURCE_REPORTED") {
    return (
      <span className="text-[9px] text-slate-500">
        <span className="text-slate-600">⚠ </span>Source-reported date
      </span>
    );
  }
  return (
    <span className="text-[9px] text-slate-600">Est. from first observation</span>
  );
}

export default function ExplorerPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Research mode
  const [researchMode, setResearchMode] = useState<ResearchMode>("EVERGREEN");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [platform, setPlatform] = useState("META"); // Meta is primary platform
  const [category, setCategory] = useState("ALL");
  const [minAgeDays, setMinAgeDays] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Read URL query parameters on initial mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlPlatform = sp.get("platform");
      if (urlPlatform) setPlatform(urlPlatform.toUpperCase());
      const urlMode = sp.get("mode");
      if (urlMode && (urlMode === "EVERGREEN" || urlMode === "EMERGING" || urlMode === "TRENDING")) {
        setResearchMode(urlMode as ResearchMode);
      }
    }
  }, []);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchAds = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "12",
        mode: researchMode,
      });

      if (searchQuery.trim()) params.append("query", searchQuery.trim());
      if (platform !== "ALL") params.append("platform", platform);
      if (minAgeDays) params.append("minAgeDays", minAgeDays);

      // Use evergreen API for mode-based ranking
      const evRes = await fetch(`/api/v1/evergreen/ads?${params.toString()}`);
      const evJson = await evRes.json();

      if (evJson.success) {
        setAds(evJson.data);
        setTotalPages(evJson.pagination.totalPages || 1);
        setTotalCount(evJson.pagination.total || 0);
        return;
      }

      // Fallback to legacy ads API
      const legacyParams = new URLSearchParams({
        page: page.toString(),
        pageSize: "12",
      });
      if (searchQuery.trim()) legacyParams.append("query", searchQuery.trim());
      if (platform !== "ALL") legacyParams.append("platform", platform);
      if (category !== "ALL") legacyParams.append("category", category);

      const legacyRes = await fetch(`/api/v1/ads?${legacyParams.toString()}`);
      const legacyJson = await legacyRes.json();

      if (legacyJson.success) {
        setAds(legacyJson.data);
        setTotalPages(legacyJson.pagination.totalPages || 1);
        setTotalCount(legacyJson.pagination.total || 0);
      }
    } catch (err: any) {
      console.error("Failed to fetch ads:", err);
      setError("Failed to load advertisements.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, [page, platform, category, researchMode, minAgeDays]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAds();
  };

  const modeInfo = MODE_CONFIG[researchMode];

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header onImportSuccess={fetchAds} />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Page Title */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <PlaySquare className="h-5 w-5 text-indigo-400" />
              <span>Evergreen Ads Intelligence</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Research ads by longevity evidence, not viral popularity
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/discovery"
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-semibold transition-all shadow-sm"
            >
              <Compass className="h-3.5 w-3.5 text-indigo-400" />
              <span>Auto Discovery</span>
            </Link>
            <a
              href="https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all"
            >
              <Flame className="h-3.5 w-3.5 text-amber-400" />
              <span>Open TikTok Top Ads (US)</span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              📁 Local Database
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {totalCount} record{totalCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Research Mode Tabs */}
        <div className="flex items-start gap-2 flex-wrap">
          {(Object.keys(MODE_CONFIG) as ResearchMode[]).map((mode) => {
            const cfg = MODE_CONFIG[mode];
            const isActive = researchMode === mode;
            return (
              <button
                key={mode}
                onClick={() => {
                  setResearchMode(mode);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                  isActive
                    ? cfg.color
                    : "text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600"
                }`}
              >
                {cfg.icon}
                {cfg.label}
              </button>
            );
          })}
          <span className="text-[10px] text-slate-600 self-center ml-1 max-w-xs">
            {modeInfo.description}
          </span>
        </div>

        {/* Disclaimer — Evergreen mode */}
        {researchMode === "EVERGREEN" && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-800/20 text-[10px] text-amber-600/80">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-600" />
            <span>
              <strong>Research Signal Only.</strong> Longevity tiers reflect evidence quality,
              not confirmed profitability. Long-running ads do not guarantee sales or positive ROAS.
            </span>
          </div>
        )}

        {/* Filter Controls */}
        <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search by brand, product, or headline..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-colors"
            >
              Search
            </button>
          </form>

          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-800/60 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Platform */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Platform:</span>
                <select
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value);
                    setPage(1);
                    if (typeof window !== "undefined") {
                      const sp = new URLSearchParams(window.location.search);
                      sp.set("platform", e.target.value);
                      window.history.replaceState(null, "", `?${sp.toString()}`);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 text-xs cursor-pointer"
                >
                  <option value="META">Meta / Facebook Ads (Primary)</option>
                  <option value="TIKTOK">TikTok Ads</option>
                  <option value="ALL">All Platforms</option>
                </select>
              </div>

              {/* Min Age */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Min Age:</span>
                <select
                  value={minAgeDays}
                  onChange={(e) => { setMinAgeDays(e.target.value); setPage(1); }}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  {AGE_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Category:</span>
                <select
                  value={category}
                  onChange={(e) => { setCategory(e.target.value); setPage(1); }}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Home & Kitchen">Home & Kitchen</option>
                  <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                  <option value="Health & Wellness Products">Health & Wellness</option>
                  <option value="Pet Supplies">Pet Supplies</option>
                  <option value="Fitness">Fitness</option>
                  <option value="Fashion">Fashion</option>
                  <option value="Electronics & Gadgets">Electronics</option>
                </select>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1 rounded ${viewMode === "grid" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"}`}
                title="Grid View"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1 rounded ${viewMode === "list" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"}`}
                title="List View"
              >
                <ListFilter className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => fetchAds()}
                className="p-1 rounded text-slate-500 hover:text-slate-300"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-16 text-center text-slate-500 text-sm">
            Loading research library...
          </div>
        ) : error ? (
          <div className="p-16 text-center text-red-400 text-sm">{error}</div>
        ) : ads.length === 0 ? (
          <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
            <PlaySquare className="h-10 w-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">No verified ads in your research library</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Import a real Meta Ad Library URL or TikTok post URL using the &quot;Import Ad URL&quot; button.
              All 6 original seed records are quarantined as synthetic demo data and excluded from results.
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {ads.map((ad) => {
              const evScore = ad.evergreenScore;
              return (
                <div key={ad.id || ad.adId} className="relative group">
                  <AdCard
                    ad={{
                      ...ad,
                      // Merge evergreen data into ad for card display
                      longevityCategory: evScore?.longevityCategory ?? ad.longevityCategory,
                      calendarAgeDays: evScore?.calendarAgeDays ?? ad.calendarAgeDays,
                      ageEvidenceSource: evScore?.ageEvidenceSource ?? ad.ageEvidenceSource,
                    }}
                    onSelect={(selected) => setSelectedAd(selected)}
                  />
                  {/* Evergreen score overlay */}
                  {evScore && (
                    <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
                      <LongevityBadge category={evScore.longevityCategory} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="rounded-xl bg-[#111827] border border-[#1f293d] overflow-hidden text-xs">
            <div className="grid grid-cols-12 p-3 font-semibold text-slate-400 border-b border-[#1f293d] bg-slate-900/50">
              <span className="col-span-1">Platform</span>
              <span className="col-span-3">Advertiser & Headline</span>
              <span className="col-span-2">Category</span>
              <span className="col-span-2">Age Evidence</span>
              <span className="col-span-2">Longevity Tier</span>
              <span className="col-span-2 text-right">Source</span>
            </div>
            {ads.map((ad) => {
              const evScore = ad.evergreenScore;
              const tierColors: Record<string, string> = {
                HIGH_RESEARCH_PRIORITY: "text-emerald-400",
                MEDIUM_RESEARCH_PRIORITY: "text-yellow-400",
                LOW_RESEARCH_PRIORITY: "text-slate-400",
                INSUFFICIENT_EVIDENCE: "text-slate-600",
              };
              return (
                <div
                  key={ad.id || ad.adId}
                  onClick={() => setSelectedAd(ad)}
                  className="grid grid-cols-12 p-3.5 border-b border-slate-800/60 hover:bg-slate-800/30 cursor-pointer items-center transition-colors"
                >
                  <span className="col-span-1 font-bold text-indigo-400 uppercase">
                    {ad.platform}
                  </span>
                  <div className="col-span-3 pr-2">
                    <strong className="text-white block truncate">{ad.advertiser?.name || ad.advertiserName}</strong>
                    <span className="text-slate-400 truncate block text-[11px]">{ad.headline}</span>
                  </div>
                  <span className="col-span-2 text-slate-300">{ad.category}</span>
                  <div className="col-span-2">
                    {evScore ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-slate-300">
                          {evScore.calendarAgeDays != null ? `${evScore.calendarAgeDays}d` : "—"}
                        </span>
                        <EvidenceSourceBadge source={evScore.ageEvidenceSource} />
                      </div>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    <div className="flex flex-col gap-0.5">
                      <span className={`font-semibold text-[10px] ${tierColors[evScore?.tier ?? ""] ?? "text-slate-600"}`}>
                        {evScore?.tier?.replace(/_/g, " ") ?? "—"}
                      </span>
                      {evScore?.totalScore != null && (
                        <span className="text-[9px] text-slate-500">{evScore.totalScore}/100</span>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <a
                      href={ad.originalAdUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-400"
                    >
                      <span>Inspect</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-[#1f293d] text-xs text-slate-400">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 disabled:opacity-40 hover:bg-slate-800 transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 disabled:opacity-40 hover:bg-slate-800 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      <AdDetailDrawer
        ad={selectedAd}
        onClose={() => setSelectedAd(null)}
      />
    </div>
  );
}
