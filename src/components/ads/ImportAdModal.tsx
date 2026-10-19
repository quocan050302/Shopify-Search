"use client";

import { useState } from "react";
import { X, PlusCircle, CheckCircle2, AlertCircle, Link as LinkIcon } from "lucide-react";

interface ImportAdModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportAdModal({ isOpen, onClose, onSuccess }: ImportAdModalProps) {
  const [url, setUrl] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [headline, setHeadline] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [category, setCategory] = useState("Home & Kitchen");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please paste a valid advertisement URL.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          advertiserName: advertiserName.trim() || undefined,
          headline: headline.trim() || undefined,
          landingPageUrl: landingPageUrl.trim() || undefined,
          category,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || "Failed to import advertisement.");
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0c121e] border border-[#1f293d] rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#1f293d] flex items-center justify-between bg-[#111827]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Import Real Competitor Ad</h3>
              <p className="text-xs text-slate-400">Paste a Meta Ad Library or TikTok ad link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center gap-2 text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Ad Source URL <span className="text-rose-400">*</span>
            </label>
            <input
              type="url"
              required
              placeholder="https://www.facebook.com/ads/library/?id=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Supports Meta Ad Library, TikTok Creative Center, or TikTok video permalinks.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Advertiser / Brand Name</label>
              <input
                type="text"
                placeholder="e.g. Ridge, BlendJet..."
                value={advertiserName}
                onChange={(e) => setAdvertiserName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
              >
                <option>Home & Kitchen</option>
                <option>Beauty & Personal Care</option>
                <option>Health & Wellness Products</option>
                <option>Pet Supplies</option>
                <option>Fitness</option>
                <option>Fashion</option>
                <option>Electronics & Gadgets</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Product Landing Page URL</label>
            <input
              type="url"
              placeholder="https://brand.com/products/..."
              value={landingPageUrl}
              onChange={(e) => setLandingPageUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Observed Copy / Headline</label>
            <textarea
              rows={2}
              placeholder="Opening hook or primary text observed..."
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs resize-none"
            />
          </div>

          {/* Form Actions */}
          <div className="pt-3 border-t border-[#1f293d] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loading ? (
                <span>Resolving & Ingesting...</span>
              ) : (
                <>
                  <PlusCircle className="h-4 w-4" />
                  <span>Import Advertisement</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
