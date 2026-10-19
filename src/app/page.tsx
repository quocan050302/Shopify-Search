"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  PlaySquare,
  ShoppingBag,
  Flame,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { AdCard } from "@/components/ads/AdCard";
import { AdDetailDrawer } from "@/components/ads/AdDetailDrawer";

export default function OverviewPage() {
  const [stats, setStats] = useState<{
    totalAds: number | null;
    activeAds: number | null;
    totalProducts: number | null;
    totalAdvertisers: number | null;
  }>({
    totalAds: null,
    activeAds: null,
    totalProducts: null,
    totalAdvertisers: null,
  });
  const [featuredAds, setFeaturedAds] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedAd, setSelectedAd] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [adsRes, productsRes] = await Promise.all([
        fetch("/api/v1/ads?pageSize=6&sortBy=longevity"),
        fetch("/api/v1/products?pageSize=4"),
      ]);

      if (!adsRes.ok || !productsRes.ok) {
        setError("Failed to load dashboard data. Check server logs.");
        return;
      }

      const adsJson = await adsRes.json();
      const productsJson = await productsRes.json();

      if (adsJson.success) {
        setFeaturedAds(adsJson.data);
        const activeCount = adsJson.data.filter((a: any) => a.status === "ACTIVE").length;
        setStats((prev) => ({
          ...prev,
          totalAds: adsJson.pagination?.total ?? adsJson.data.length,
          activeAds: activeCount,
        }));
      } else {
        setError(adsJson.error?.message || "Failed to fetch ads.");
      }

      if (productsJson.success) {
        setProducts(productsJson.data);
        setStats((prev) => ({
          ...prev,
          totalProducts: productsJson.pagination?.total ?? productsJson.data.length,
        }));
      }
    } catch (err: any) {
      console.error("Failed to load dashboard data:", err);
      setError("Network error — could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveToWatchlist = async (adId: string) => {
    try {
      // Get first available watchlist ID, or create one
      const wlRes = await fetch("/api/v1/watchlists");
      const wlJson = await wlRes.json();

      let watchlistId: string | null = null;
      if (wlJson.success && wlJson.data.length > 0) {
        watchlistId = wlJson.data[0].id;
      } else {
        // Create a default watchlist
        const createRes = await fetch("/api/v1/watchlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            name: "My Research Collection",
            description: "Saved ads for research",
          }),
        });
        const createJson = await createRes.json();
        if (createJson.success) {
          watchlistId = createJson.data.id;
        }
      }

      if (!watchlistId) {
        alert("Failed to find or create a watchlist.");
        return;
      }

      const res = await fetch("/api/v1/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_item",
          watchlistId,
          itemType: "AD",
          itemId: adId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        alert("Advertisement saved to watchlist.");
      } else {
        alert(`Failed to save: ${json.error?.message || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Error saving to watchlist: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header onImportSuccess={loadData} />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-8">
        {/* Hero Welcome & Mode Context */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900/60 border border-indigo-900/30">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-slate-700/50 border border-slate-600/30 text-slate-300 text-xs font-semibold flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                Research Mode — US Market Focus
              </span>
              <span className="text-xs text-slate-500">• RESEARCH_ONLY</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Shopify Winning Ads Intelligence
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Discover, track, and evaluate ecommerce video advertisements and winning
              products. Import real source URLs, research competitor creatives, and
              identify high-potential products for your Shopify store.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/explorer"
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition-all"
            >
              <PlaySquare className="h-4 w-4" />
              <span>Explore Ads</span>
            </Link>
            <Link
              href="/products"
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs flex items-center gap-2 border border-slate-700 transition-all"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Find Products</span>
            </Link>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* KPI Metric Cards — Real data only, no hardcoded fallbacks */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Ads in Library</span>
              <PlaySquare className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {loading ? "…" : (stats.totalAds ?? "0")}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-slate-600" />
              <span>User-imported records</span>
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Active Status</span>
              <Clock className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {loading ? "…" : (stats.activeAds ?? "0")}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Marked ACTIVE (unverified)
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Products Identified</span>
              <ShoppingBag className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {loading ? "…" : (stats.totalProducts ?? "0")}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Linked to observed ads
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Avg Winning Score</span>
              <Flame className="h-4 w-4 text-rose-500" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {loading || !featuredAds.length
                ? "—"
                : (() => {
                    const scores = featuredAds
                      .map((a) => a.researchScores?.[0]?.totalScore)
                      .filter((s) => s != null);
                    if (scores.length === 0) return "—";
                    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                  })()}
              {!loading && featuredAds.length > 0 && (
                <span className="text-xs text-slate-500 font-normal"> /100</span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Evidence-based formula v6.1
            </span>
          </div>
        </div>

        {/* Featured Ads Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Flame className="h-4 w-4 text-rose-500" />
                <span>Research Ad Library</span>
              </h2>
              <p className="text-xs text-slate-400">
                Sorted by observed campaign longevity. Import real ad URLs to add more.
              </p>
            </div>
            <Link
              href="/explorer"
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              <span>View all ads</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500">Loading research advertisements...</div>
          ) : featuredAds.length === 0 ? (
            <div className="p-12 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-2">
              <PlaySquare className="h-10 w-10 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-white">No ads in library yet</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Use the Import button to add real Meta or TikTok advertisement URLs to your research library.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {featuredAds.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onSelect={(selected) => setSelectedAd(selected)}
                  onSaveToWatchlist={handleSaveToWatchlist}
                />
              ))}
            </div>
          )}
        </div>

        {/* Products Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-indigo-400" />
                <span>Identified Product Opportunities</span>
              </h2>
              <p className="text-xs text-slate-400">
                Products linked to observed competitor ad campaigns
              </p>
            </div>
            <Link
              href="/products"
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
            >
              <span>View all products</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading products...</div>
          ) : products.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#111827] border border-[#1f293d] text-center">
              <p className="text-xs text-slate-500">
                No products identified yet. Import ads with landing page URLs to auto-link products.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between hover:border-slate-700 transition-all"
                >
                  <div>
                    {product.imageUrl && !product.imageUrl.includes("unsplash.com") && (
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-full h-36 object-cover rounded-lg mb-3 border border-slate-800"
                      />
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                      {product.category}
                    </span>
                    <h3 className="text-xs font-bold text-white mt-1.5 line-clamp-2">
                      {product.title}
                    </h3>
                  </div>

                  <div className="pt-3 mt-3 border-t border-[#1f293d] flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Observed Price</span>
                      <span className="text-sm font-bold text-emerald-400 font-mono">
                        {product.currentPrice != null
                          ? `$${product.currentPrice.toFixed(2)}`
                          : "—"}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        product.store?.commercePlatform === "SHOPIFY_CONFIRMED"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {product.store?.commercePlatform || "UNKNOWN"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Selected Ad Detail Drawer */}
      <AdDetailDrawer
        ad={selectedAd}
        onClose={() => setSelectedAd(null)}
        onSaveToWatchlist={handleSaveToWatchlist}
      />
    </div>
  );
}
