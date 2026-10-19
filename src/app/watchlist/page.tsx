"use client";

import { useEffect, useState } from "react";
import {
  Bookmark,
  PlaySquare,
  Trash2,
  ExternalLink,
  Plus,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

export default function WatchlistPage() {
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const fetchWatchlists = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/v1/watchlists");

      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return;
      }

      const json = await res.json();
      if (json.success) {
        setWatchlists(json.data);
      } else {
        setError(json.error?.message || "Failed to load watchlists.");
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatchlists();
  }, []);

  const handleCreateWatchlist = async () => {
    if (!newName.trim()) return;
    try {
      setCreating(true);
      const res = await fetch("/api/v1/watchlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newName.trim(),
          description: "Research collection",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error?.message || "Failed to create watchlist.");
        return;
      }

      setNewName("");
      setSuccessMsg("Watchlist created successfully.");
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchWatchlists(); // Reload to confirm persistence
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRemoveItem = async (watchlistItemId: string) => {
    try {
      const res = await fetch(`/api/v1/watchlists?itemId=${watchlistItemId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error?.message || "Failed to remove item.");
        return;
      }
      setSuccessMsg("Item removed.");
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchWatchlists();
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <Bookmark className="h-5 w-5 text-indigo-400" />
              <span>Research Watchlists</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Curated collections of high-potential advertisements and candidate products
            </p>
          </div>

          {/* Create watchlist inline */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="New collection name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateWatchlist()}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 w-48"
            />
            <button
              onClick={handleCreateWatchlist}
              disabled={creating || !newName.trim()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{creating ? "Creating..." : "Create"}</span>
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-xs text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="p-16 text-center text-slate-500">Loading research watchlists...</div>
        ) : watchlists.length === 0 ? (
          <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
            <Bookmark className="h-10 w-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">Your watchlist is empty</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Save promising advertisements from the Explorer to review and track them here.
              Use the form above to create your first collection.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {watchlists.map((wl) => (
              <div
                key={wl.id}
                className="rounded-xl bg-[#111827] border border-[#1f293d] p-6 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-white">{wl.name}</h2>
                    {wl.description && (
                      <p className="text-xs text-slate-400 mt-0.5">{wl.description}</p>
                    )}
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {wl.items?.length || 0} items saved
                  </span>
                </div>

                {!wl.items || wl.items.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No items in this collection yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {wl.items.map((item: any) => {
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
                                {ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN"
                                  ? ad.advertiser.name
                                  : "Unknown Advertiser"}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 uppercase">
                                {ad.platform}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 line-clamp-2">
                              {ad.headline || ad.category || "No headline"}
                            </p>
                            {ad.researchScores?.[0] && (
                              <p className="text-[10px] text-slate-500 mt-1">
                                Score:{" "}
                                <span className="text-indigo-400 font-bold">
                                  {ad.researchScores[0].totalScore}
                                </span>
                                {" / 100 "}
                                <span className="text-slate-600">
                                  ({ad.researchScores[0].tier?.replace(/_/g, " ")})
                                </span>
                              </p>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                            <span className="font-mono text-slate-400">
                              {ad.daysRunning}d observed
                            </span>
                            <div className="flex items-center gap-2">
                              {ad.originalAdUrl && (
                                <a
                                  href={ad.originalAdUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-400 hover:underline flex items-center gap-1"
                                  title="Open original source"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <button
                                onClick={() => handleRemoveItem(item.id)}
                                className="text-slate-600 hover:text-red-400 transition-colors"
                                title="Remove from watchlist"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
