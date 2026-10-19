"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Filter,
  SlidersHorizontal,
  LayoutGrid,
  ListFilter,
  PlaySquare,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { AdCard } from "@/components/ads/AdCard";
import { AdDetailDrawer } from "@/components/ads/AdDetailDrawer";

export default function ExplorerPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<any | null>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [platform, setPlatform] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [sortBy, setSortBy] = useState("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchAds = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: "12",
        sortBy,
      });

      if (searchQuery.trim()) params.append("query", searchQuery.trim());
      if (platform !== "ALL") params.append("platform", platform);
      if (category !== "ALL") params.append("category", category);

      const res = await fetch(`/api/v1/ads?${params.toString()}`);
      const json = await res.json();

      if (json.success) {
        setAds(json.data);
        setTotalPages(json.pagination.totalPages || 1);
        setTotalCount(json.pagination.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch ads in explorer:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
  }, [page, platform, category, sortBy]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAds();
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header onImportSuccess={fetchAds} />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Page Title & Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <PlaySquare className="h-5 w-5 text-indigo-400" />
              <span>Winning Ads Explorer</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Search and analyze observed video ads from Meta Ad Library & TikTok Creative Center
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              📁 Local Database Search
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {totalCount} real records
            </span>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] space-y-3">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search by product title, brand, or hook phrase..."
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

          {/* Secondary Filters */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-800/60 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Platform Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Platform:</span>
                <select
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value);
                    setPage(1);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="ALL">All Platforms</option>
                  <option value="META">Meta Ads (FB/IG)</option>
                  <option value="TIKTOK">TikTok Ads</option>
                </select>
              </div>

              {/* Category Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Category:</span>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
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

              {/* Sort Order */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="newest">Newest Observed</option>
                  <option value="longevity">Longest Running</option>
                </select>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1 rounded ${
                  viewMode === "grid" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"
                }`}
                title="Grid View"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1 rounded ${
                  viewMode === "list" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-300"
                }`}
                title="List View"
              >
                <ListFilter className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Display */}
        {loading ? (
          <div className="p-16 text-center text-slate-500">Loading competitor advertisements...</div>
        ) : ads.length === 0 ? (
          <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
            <PlaySquare className="h-10 w-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">No verified ads in your research library</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Import a real Meta Ad Library URL or TikTok post URL using the "Import Ad URL" button.
              All 6 original seed records have been quarantined as synthetic demo data.
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {ads.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                onSelect={(selected) => setSelectedAd(selected)}
              />
            ))}
          </div>
        ) : (
          /* List / Table View */
          <div className="rounded-xl bg-[#111827] border border-[#1f293d] overflow-hidden text-xs">
            <div className="grid grid-cols-12 p-3 font-semibold text-slate-400 border-b border-[#1f293d] bg-slate-900/50">
              <span className="col-span-1">Platform</span>
              <span className="col-span-3">Advertiser & Headline</span>
              <span className="col-span-2">Category</span>
              <span className="col-span-2">Days Running</span>
              <span className="col-span-2">Research Score</span>
              <span className="col-span-2 text-right">Source Link</span>
            </div>
            {ads.map((ad) => {
              const score = ad.researchScores?.[0]?.totalScore ?? "N/A";
              return (
                <div
                  key={ad.id}
                  onClick={() => setSelectedAd(ad)}
                  className="grid grid-cols-12 p-3.5 border-b border-slate-800/60 hover:bg-slate-850 cursor-pointer items-center transition-colors"
                >
                  <span className="col-span-1 font-bold text-indigo-400 uppercase">
                    {ad.platform}
                  </span>
                  <div className="col-span-3 pr-2">
                    <strong className="text-white block truncate">{ad.advertiser?.name}</strong>
                    <span className="text-slate-400 truncate block text-[11px]">{ad.headline}</span>
                  </div>
                  <span className="col-span-2 text-slate-300">{ad.category}</span>
                  <span className="col-span-2 font-mono text-slate-300">{ad.daysRunning}d active</span>
                  <span className="col-span-2 font-mono font-bold text-emerald-400">{score}/100</span>
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

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-[#1f293d] text-xs text-slate-400">
            <span>
              Page {page} of {totalPages}
            </span>
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
