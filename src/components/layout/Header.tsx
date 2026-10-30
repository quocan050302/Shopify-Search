"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  PlusCircle,
  Globe2,
  Package,
  Film,
  ExternalLink,
  Loader2,
  X,
  Menu,
} from "lucide-react";
import { ImportAdModal } from "@/components/ads/ImportAdModal";

interface SearchResultItem {
  id: string;
  title: string;
  category?: string;
  advertiser?: string;
  platform?: string;
  domain?: string | null;
  url: string;
  type: "PRODUCT" | "AD";
}

interface SearchResponse {
  success: boolean;
  data: {
    products: SearchResultItem[];
    ads: SearchResultItem[];
  };
}

export function Header({
  onImportSuccess,
  onToggleSidebar,
}: {
  onImportSuccess?: () => void;
  onToggleSidebar?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ products: SearchResultItem[]; ads: SearchResultItem[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Cmd/Ctrl + K or "/"
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsDropdownOpen(true);
      } else if (e.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search query with request cancellation and stale response protection
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, {
          signal: abortController.signal,
        });
        if (res.ok) {
          const json: SearchResponse = await res.json();
          if (json.success && !abortController.signal.aborted) {
            setSearchResults(json.data);
            setIsDropdownOpen(true);
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Global search error:", err);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [searchQuery]);

  // Derive breadcrumb from pathname
  const formatBreadcrumb = () => {
    if (pathname === "/") return "Overview";
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "meta-discovery") return "Meta Ads Research";
    if (segments[0] === "explorer") return "Ads Explorer";
    if (segments[0] === "products") return "Product Intelligence";
    if (segments[0] === "analyzer") return "AI Creative Analyzer";
    if (segments[0] === "tracker") return "Competitor Tracker";
    if (segments[0] === "watchlist") return "Watchlist";
    if (segments[0] === "reports") return "Reports & Exports";
    if (segments[0] === "settings") return "Settings";
    if (segments[0] === "discovery") return "TikTok Research";
    return segments[0] || "SWAI";
  };

  const handleSelectResult = (url: string) => {
    setIsDropdownOpen(false);
    setSearchQuery("");
    router.push(url);
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-[#0B1020]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 select-none">
      {/* Left: Sidebar Toggle & Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (onToggleSidebar) onToggleSidebar();
            window.dispatchEvent(new CustomEvent("swai:toggle-sidebar"));
          }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer md:hidden"
          aria-label="Toggle navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
          <span className="text-slate-500 hidden sm:inline">SWAI</span>
          <span className="text-slate-600 hidden sm:inline">/</span>
          <span className="text-slate-200 font-semibold">{formatBreadcrumb()}</span>
        </div>
      </div>

      {/* Center: Global Search */}
      <div ref={searchContainerRef} className="relative w-72 sm:w-96 max-w-full">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => {
              if (searchQuery.trim().length >= 2) setIsDropdownOpen(true);
            }}
            placeholder="Search ads, products, brands... (⌘K)"
            suppressHydrationWarning
            className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSearchResults(null);
                setIsDropdownOpen(false);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Global Search Dropdown */}
        {isDropdownOpen && (searchResults || isSearching) && (
          <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl border border-slate-800 bg-[#0D1424] shadow-2xl overflow-hidden z-50 animate-in fade-in-50 duration-150">
            {isSearching ? (
              <div className="p-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                <span>Searching verified database...</span>
              </div>
            ) : searchResults && (searchResults.products.length > 0 || searchResults.ads.length > 0) ? (
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60 p-2">
                {searchResults.products.length > 0 && (
                  <div className="p-1">
                    <p className="px-2 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Products
                    </p>
                    {searchResults.products.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSelectResult(item.url)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs hover:bg-slate-800/80 cursor-pointer transition-colors"
                      >
                        <Package className="h-4 w-4 text-indigo-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-200 font-medium truncate">{item.title}</p>
                          <p className="text-slate-400 text-[10px] truncate">{item.domain || item.category || "Research Product"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {searchResults.ads.length > 0 && (
                  <div className="p-1">
                    <p className="px-2 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Advertisements
                    </p>
                    {searchResults.ads.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSelectResult(item.url)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs hover:bg-slate-800/80 cursor-pointer transition-colors"
                      >
                        <Film className="h-4 w-4 text-emerald-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-200 font-medium truncate">{item.title}</p>
                          <p className="text-slate-400 text-[10px] truncate">{item.advertiser || item.platform}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                No matching ads or products found for &quot;{searchQuery}&quot;.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Market & Actions */}
      <div className="flex items-center gap-2.5">
        {/* Market Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
          <Globe2 className="h-3.5 w-3.5 text-indigo-400" />
          <span>Market: <strong className="text-slate-100 font-semibold">US</strong></span>
        </div>

        {/* Import Ads Button */}
        <button
          onClick={() => setIsImportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-medium shadow-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          <span>Import Ads</span>
        </button>
      </div>

      <ImportAdModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => {
          setIsImportOpen(false);
          if (onImportSuccess) onImportSuccess();
        }}
      />
    </header>
  );
}
