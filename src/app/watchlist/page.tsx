"use client";

import { useEffect, useState } from "react";
import { Bookmark, PlaySquare, ShoppingBag, Trash2, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function WatchlistPage() {
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWatchlists = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/watchlists");
      const json = await res.json();
      if (json.success) setWatchlists(json.data);
    } catch (err) {
      console.error("Failed to fetch watchlists:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatchlists();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-indigo-400" />
            <span>Research Watchlists</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Curated collections of high-potential advertisements and candidate products for your store
          </p>
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-500">Loading research watchlists...</div>
        ) : watchlists.length === 0 ? (
          <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
            <Bookmark className="h-10 w-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">Your watchlist is currently empty</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Save promising advertisements from the Winning Ads Explorer to review and track them here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {watchlists.map((wl) => (
              <div key={wl.id} className="rounded-xl bg-[#111827] border border-[#1f293d] p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-white">{wl.name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">{wl.description}</p>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {wl.items?.length || 0} items saved
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {wl.items?.map((item: any) => {
                    const ad = item.ad;
                    if (!ad) return null;
                    return (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-white">
                              {ad.advertiser?.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 uppercase">
                              {ad.platform}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 line-clamp-2">
                            {ad.headline || ad.category}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                          <span className="font-mono text-slate-400">{ad.daysRunning}d active</span>
                          <a
                            href={ad.originalAdUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:underline flex items-center gap-1"
                          >
                            <span>Source</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
