"use client";

import { useEffect, useState } from "react";
import {
  ShoppingBag,
  Search,
  ExternalLink,
  Tag,
  ShieldCheck,
  TrendingUp,
  PlaySquare,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import Link from "next/link";

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.append("query", search.trim());
      if (category !== "ALL") params.append("category", category);

      const res = await fetch(`/api/v1/products?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setProducts(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch products:", err);
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
            Discover verified ecommerce products identified across competitor video advertising campaigns
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

        {/* Product Cards Grid */}
        {loading ? (
          <div className="p-16 text-center text-slate-500">Loading products...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <div
                key={product.id}
                className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
              >
                <div>
                  {product.imageUrl && (
                    <div className="relative h-48 w-full bg-slate-950 overflow-hidden">
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/75 backdrop-blur-md text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                        {product.store?.commercePlatform || "SHOPIFY_CONFIRMED"}
                      </div>
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
                      Domain: <span className="text-indigo-300">{product.store?.domain || "merchant.com"}</span>
                    </p>
                  </div>
                </div>

                <div className="p-4 pt-0 space-y-3">
                  <div className="flex items-center justify-between pt-3 border-t border-[#1f293d]">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Observed Price</span>
                      <span className="text-base font-extrabold text-emerald-400 font-mono">
                        ${product.currentPrice?.toFixed(2) || "N/A"}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">Linked Ads</span>
                      <span className="text-xs font-bold text-white font-mono flex items-center gap-1 justify-end">
                        <PlaySquare className="h-3 w-3 text-indigo-400" />
                        <span>{product.adLinks?.length || 1} creatives</span>
                      </span>
                    </div>
                  </div>

                  {product.productUrl && (
                    <a
                      href={product.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
                    >
                      <span>Visit Storefront</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
