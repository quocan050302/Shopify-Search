"use client";

import { useState } from "react";
import {
  X,
  PlusCircle,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  ExternalLink,
  Layers,
  Sparkles,
  Info,
  Flame,
} from "lucide-react";
import { TIKTOK_TOP_ADS_US_DEFAULT_URL, TOP_ADS_PRESETS } from "@/services/tiktok/tiktokResearchService";

interface ImportAdModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportAdModal({ isOpen, onClose, onSuccess }: ImportAdModalProps) {
  const [tab, setTab] = useState<"single" | "batch">("single");

  // Single import state
  const [url, setUrl] = useState("");
  const [advertiserName, setAdvertiserName] = useState("");
  const [headline, setHeadline] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [category, setCategory] = useState("Home & Kitchen");
  const [targetMarket, setTargetMarket] = useState("US");

  // Batch import state
  const [batchText, setBatchText] = useState("");
  const [batchCategory, setBatchCategory] = useState("Home & Kitchen");
  const [batchTargetMarket, setBatchTargetMarket] = useState("US");
  const [batchResults, setBatchResults] = useState<{
    total: number;
    importedCount: number;
    failedCount: number;
    results: any[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Single URL Submit
  const handleSingleSubmit = async (e: React.FormEvent) => {
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
          targetMarket,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || "Failed to import advertisement.");
      }

      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Batch URLs Submit
  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrls = batchText
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (rawUrls.length === 0) {
      setError("Please paste at least one advertisement URL.");
      return;
    }

    if (rawUrls.length > 50) {
      setError("Maximum batch size is 50 URLs. Please reduce the number of URLs.");
      return;
    }

    setLoading(true);
    setError(null);
    setBatchResults(null);

    try {
      const res = await fetch("/api/v1/ads/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: rawUrls,
          category: batchCategory,
          targetMarket: batchTargetMarket,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || "Failed to process batch import.");
      }

      setBatchResults(data.data);
      if (data.data.importedCount > 0) {
        onSuccess();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected batch error occurred.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const detectedBatchCount = batchText
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0c121e] border border-[#1f293d] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-[#1f293d] flex items-center justify-between bg-[#111827]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Import Competitor Ads</h3>
              <p className="text-xs text-slate-400">
                Prioritizing TikTok Creative Center US without paid API calls
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Primary Research Banner: Open Top Ads Prefiltered for US */}
        <div className="px-6 py-3.5 bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/40 border-b border-[#1f293d] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                Primary Manual Source
              </span>
              <span className="text-xs font-semibold text-slate-200">
                TikTok Creative Center (US)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Browse authentic winning ads prefiltered for United States.
            </p>
          </div>

          <a
            href={TIKTOK_TOP_ADS_US_DEFAULT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-600/20 transition-all shrink-0 cursor-pointer"
          >
            <Flame className="h-3.5 w-3.5 text-amber-300" />
            <span>Open Top Ads (US)</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Quick Filter Presets Notice */}
        <div className="px-6 py-2 bg-slate-950/60 border-b border-slate-900 flex items-center justify-between text-[11px] text-slate-400 overflow-x-auto gap-2">
          <span className="text-slate-500 shrink-0 font-medium">Quick Open:</span>
          <div className="flex items-center gap-2">
            {TOP_ADS_PRESETS.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-[10px] transition-colors whitespace-nowrap"
                title={p.description}
              >
                {p.period}d US
              </a>
            ))}
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-[#1f293d] bg-slate-950 px-6">
          <button
            type="button"
            onClick={() => {
              setTab("single");
              setError(null);
            }}
            className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              tab === "single"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Single URL Import
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("batch");
              setError(null);
            }}
            className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              tab === "batch"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Batch Import (Up to 50)</span>
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center gap-2 text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: SINGLE URL IMPORT */}
          {tab === "single" && (
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Ad Source URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Paste a TikTok Creative Center Top Ads link, a TikTok video post URL, or Meta Ad Library link.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Advertiser / Brand Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ridge, BlendJet (or leave empty)"
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Target Market</label>
                  <select
                    value={targetMarket}
                    onChange={(e) => setTargetMarket(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    <option value="US">United States (US)</option>
                    <option value="CA">Canada (CA)</option>
                    <option value="GB">United Kingdom (GB)</option>
                    <option value="AU">Australia (AU)</option>
                    <option value="UNKNOWN">Unknown / Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Product Landing Page</label>
                  <input
                    type="url"
                    placeholder="https://brand.com/products/..."
                    value={landingPageUrl}
                    onChange={(e) => setLandingPageUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
                  />
                </div>
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
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? (
                    <span>Validating & Ingesting...</span>
                  ) : (
                    <>
                      <PlusCircle className="h-4 w-4" />
                      <span>Import Advertisement</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: BATCH URL IMPORT */}
          {tab === "batch" && (
            <form onSubmit={handleBatchSubmit} className="space-y-4">
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/40 text-[11px] text-slate-300 flex items-start gap-2">
                <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Batch Top Ads Ingestion:</strong> Paste multiple TikTok Creative Center or TikTok post URLs (one per line, up to 50 URLs). SWAI validates each genuine link and stores source-backed metadata without claiming false 180-day activity.
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-semibold">
                    Paste Advertisement URLs <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Detected: <strong className="text-white">{detectedBatchCount}</strong> / 50
                  </span>
                </div>
                <textarea
                  rows={6}
                  required
                  placeholder={
                    "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US&id=7123456789012\n" +
                    "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US&id=7987654321098\n" +
                    "https://www.tiktok.com/@brand/video/7123456789012345678"
                  }
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono text-[11px] resize-none leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Default Category</label>
                  <select
                    value={batchCategory}
                    onChange={(e) => setBatchCategory(e.target.value)}
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

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Target Market</label>
                  <select
                    value={batchTargetMarket}
                    onChange={(e) => setBatchTargetMarket(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    <option value="US">United States (US) — Primary</option>
                    <option value="CA">Canada (CA)</option>
                    <option value="GB">United Kingdom (GB)</option>
                    <option value="AU">Australia (AU)</option>
                    <option value="UNKNOWN">Auto / Unknown</option>
                  </select>
                </div>
              </div>

              {/* Batch Results Summary */}
              {batchResults && (
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">Batch Import Results</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">
                        ✓ {batchResults.importedCount} Imported
                      </span>
                      {batchResults.failedCount > 0 && (
                        <span className="text-rose-400 font-semibold">
                          × {batchResults.failedCount} Failed
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {batchResults.results.map((r, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded-lg text-[11px] flex items-start justify-between gap-2 ${
                          r.success
                            ? "bg-emerald-950/30 border border-emerald-800/40 text-emerald-300"
                            : "bg-rose-950/30 border border-rose-800/40 text-rose-300"
                        }`}
                      >
                        <div className="truncate flex-1">
                          <span className="font-mono">{r.url}</span>
                          {r.warning && (
                            <span className="block text-[10px] text-amber-300 mt-0.5">
                              ⚠ {r.warning}
                            </span>
                          )}
                          {r.error && (
                            <span className="block text-[10px] text-rose-400 mt-0.5">
                              {r.error}
                            </span>
                          )}
                        </div>
                        <span className="font-bold shrink-0">
                          {r.success ? "IMPORTED" : "FAILED"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-3 border-t border-[#1f293d] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={loading || detectedBatchCount === 0}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? (
                    <span>Processing Batch...</span>
                  ) : (
                    <>
                      <Layers className="h-4 w-4" />
                      <span>Import {detectedBatchCount} Ads</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
