"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShoppingBag,
  Search,
  ExternalLink,
  AlertCircle,
  PlaySquare,
  Store,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { isStockImage } from "@/services/video/videoSourceResolver";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.append("query", search.trim());
      if (category !== "ALL") params.append("category", category);

      const res = await fetch(`/api/v1/products?${params.toString()}`);

      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return;
      }

      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
      } else {
        setError(json.error?.message || "Failed to load products.");
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [category]);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header onImportSuccess={fetchProducts} />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-indigo-400" />
            <span>Winning Product Finder</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Products identified from competitor video ad campaigns. Link status is not
            automatically verified — check each URL before use.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col md:flex-row gap-3 items-center justify-between text-xs">
          <div className="relative flex-1 w-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search product title or domain..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchProducts()}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-slate-500 font-medium">Category:</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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

        {/* Error State */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Product Cards Grid */}
        {loading ? (
          <div className="p-16 text-center text-slate-500">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
            <ShoppingBag className="h-10 w-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-white">No products found</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Import ad URLs with landing page links to automatically identify and track products.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => {
              const hasValidImage =
                product.imageUrl && !isStockImage(product.imageUrl);
              const platformStatus =
                product.store?.commercePlatform || "UNKNOWN";
              const isShopifyConfirmed = platformStatus === "SHOPIFY_CONFIRMED";
              const linkedAdsCount = product.adLinks?.length ?? 0;
              const productUrl = product.productUrl;

              return (
                <div
                  key={product.id}
                  className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
                >
                  <div>
                    {hasValidImage ? (
                      <div className="relative h-48 w-full bg-slate-950 overflow-hidden">
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          className="w-full h-full object-cover"
                        />
                        <div
                          className={`absolute top-3 left-3 px-2 py-0.5 rounded backdrop-blur-md text-[10px] font-semibold border ${
                            isShopifyConfirmed
                              ? "bg-black/75 text-emerald-400 border-emerald-500/20"
                              : "bg-black/75 text-slate-400 border-slate-600/20"
                          }`}
                        >
                          {platformStatus}
                        </div>
                      </div>
                    ) : (
                      <div className="h-24 w-full bg-slate-950 flex items-center justify-center relative">
                        <ShoppingBag className="h-10 w-10 text-slate-700" />
                        <div
                          className={`absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            isShopifyConfirmed
                              ? "bg-black/75 text-emerald-400 border-emerald-500/20"
                              : "bg-black/75 text-slate-400 border-slate-600/20"
                          }`}
                        >
                          {platformStatus}
                        </div>
                      </div>
                    )}

                    {/* Stock image warning */}
                    {product.imageUrl && isStockImage(product.imageUrl) && (
                      <div className="flex items-center gap-1 px-3 py-1 bg-amber-950/40 text-[10px] text-amber-400 border-b border-amber-800/30">
                        <AlertTriangle className="h-3 w-3" />
                        Stock image — not actual product photo
                      </div>
                    )}

                    <div className="p-4 space-y-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                        {product.category}
                      </span>
                      <h2 className="text-sm font-bold text-white line-clamp-2">
                        {product.title}
                      </h2>
                      <p className="text-xs text-slate-400 font-mono">
                        Domain:{" "}
                        <span className="text-indigo-300">
                          {product.store?.domain || "Unknown domain"}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="p-4 pt-0 space-y-3">
                    <div className="flex items-center justify-between pt-3 border-t border-[#1f293d]">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Observed Price</span>
                        <span className="text-base font-extrabold text-emerald-400 font-mono">
                          {product.currentPrice != null
                            ? `$${product.currentPrice.toFixed(2)}`
                            : "—"}
                        </span>
                        {product.currentPrice != null && (
                          <span className="text-[9px] text-slate-600 block">
                            Seed data — not live verified
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Linked Ads</span>
                        <span className="text-xs font-bold text-white font-mono flex items-center gap-1 justify-end">
                          <PlaySquare className="h-3 w-3 text-indigo-400" />
                          <span>
                            {linkedAdsCount > 0 ? `${linkedAdsCount} observed` : "None linked"}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Product Intelligence Workspace Link */}
                    <Link
                      href={`/products/${product.id}/intelligence`}
                      className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Product Intelligence</span>
                    </Link>

                    {/* Visit Storefront — with availability warning */}
                    {productUrl ? (
                      <div className="space-y-1">
                        <a
                          href={productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
                        >
                          <Store className="h-3 w-3" />
                          <span>Visit Product Page</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <p className="text-[9px] text-slate-600 text-center">
                          Not verified — may return 404
                        </p>
                      </div>
                    ) : (
                      <div className="w-full py-2 px-3 rounded-lg bg-slate-900 text-slate-600 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-800">
                        <AlertCircle className="h-3 w-3" />
                        <span>No product URL available</span>
                      </div>
                    )}

                    {/* Storefront homepage fallback */}
                    {product.store?.domain && (
                      <a
                        href={`https://${product.store.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-1.5 px-3 rounded-lg bg-transparent text-slate-500 text-[10px] font-medium flex items-center justify-center gap-1.5 border border-slate-800 hover:border-slate-700 hover:text-slate-400 transition-colors"
                      >
                        <span>Visit Store Homepage</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
