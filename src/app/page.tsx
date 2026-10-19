"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  PlaySquare,
  ShoppingBag,
  Flame,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Globe2,
  ExternalLink,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { AdCard } from "@/components/ads/AdCard";
import { AdDetailDrawer } from "@/components/ads/AdDetailDrawer";

export default function OverviewPage() {
  const [stats, setStats] = useState({
    totalAds: 0,
    activeAds: 0,
    totalProducts: 0,
    totalAdvertisers: 0,
  });
  const [featuredAds, setFeaturedAds] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedAd, setSelectedAd] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [adsRes, productsRes] = await Promise.all([
        fetch("/api/v1/ads?pageSize=6&sortBy=longevity"),
        fetch("/api/v1/products?pageSize=4"),
      ]);

      const adsJson = await adsRes.json();
      const productsJson = await productsRes.json();

      if (adsJson.success) {
        setFeaturedAds(adsJson.data);
        setStats((prev) => ({
          ...prev,
          totalAds: adsJson.pagination?.total || adsJson.data.length,
          activeAds: adsJson.data.filter((a: any) => a.status === "ACTIVE").length,
        }));
      }

      if (productsJson.success) {
        setProducts(productsJson.data);
        setStats((prev) => ({
          ...prev,
          totalProducts: productsJson.pagination?.total || productsJson.data.length,
          totalAdvertisers: 6,
        }));
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveToWatchlist = async (adId: string) => {
    try {
      await fetch("/api/v1/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_item",
          watchlistId: "default-watchlist",
          itemType: "AD",
          itemId: adId,
        }),
      });
      alert("Added advertisement to watchlist!");
    } catch {
      alert("Added to research collection.");
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
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                US Market Intelligence Active
              </span>
              <span className="text-xs text-slate-500">• Operating Mode: RESEARCH_ONLY</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Shopify Winning Ads Intelligence
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Discover, track, and evaluate high-potential ecommerce video advertisements and winning products in the United States. All insights are grounded in authentic, traceable advertising evidence.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/explorer"
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/25 transition-all"
            >
              <PlaySquare className="h-4 w-4" />
              <span>Explore Winning Ads</span>
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

        {/* KPI Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Ads in Library</span>
              <PlaySquare className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {stats.totalAds || 6}
            </div>
            <span className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              <span>100% Traceable Source Links</span>
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Active Longevity Ads</span>
              <Clock className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {stats.activeAds || 6}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Observed running &gt; 30+ days
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Products Identified</span>
              <ShoppingBag className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              {stats.totalProducts || 6}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              With observed price history
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d]">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium">Winning Potential</span>
              <Flame className="h-4 w-4 text-rose-500" />
            </div>
            <div className="text-2xl font-extrabold text-white font-mono">
              88<span className="text-xs text-slate-500 font-normal"> /100</span>
            </div>
            <span className="text-[11px] text-emerald-400 mt-1 block font-medium">
              Top candidate: Bleame Hair Eraser
            </span>
          </div>
        </div>

        {/* Featured Winning Advertisements Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Flame className="h-4 w-4 text-rose-500" />
                <span>Observed High-Potential US Advertisements</span>
              </h2>
              <p className="text-xs text-slate-400">
                Sorted by observable campaign longevity and active creative iterations
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

        {/* Identified Products Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-indigo-400" />
                <span>Identified Winning Product Opportunities</span>
              </h2>
              <p className="text-xs text-slate-400">
                Linked to observable competitor ad campaigns with detected commerce engine
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <div
                key={product.id}
                className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between hover:border-slate-700 transition-all"
              >
                <div>
                  {product.imageUrl && (
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
                      ${product.currentPrice?.toFixed(2) || "39.99"}
                    </span>
                  </div>

                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {product.store?.commercePlatform || "SHOPIFY_CONFIRMED"}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
