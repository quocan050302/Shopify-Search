"use client";

import { useState } from "react";
import {
  X,
  ExternalLink,
  Flame,
  Clock,
  Sparkles,
  ShoppingBag,
  ShieldCheck,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Store,
  Upload,
  FileVideo,
} from "lucide-react";
import { AdVideoPlayer } from "./AdVideoPlayer";
import { isSampleOrFakeMedia, isStockImage } from "@/services/links/linkValidationService";

interface AdDetailDrawerProps {
  ad: any | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSaveToWatchlist?: (adId: string) => void;
}

export function AdDetailDrawer({
  ad,
  onClose,
  onNext,
  onPrev,
  onSaveToWatchlist,
}: AdDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "score" | "provenance">("analysis");

  // Video Upload State (Requirement 9)
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  if (!ad) return null;

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadFeedback(null);

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("adId", ad.id);

      const res = await fetch("/api/v1/media/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || "Failed to upload video.");
      }

      setUploadedVideoUrl(json.data.playbackUrl);
      setUploadFeedback({
        type: "success",
        message: `Video uploaded (${json.data.format} container, verified via magic bytes). Ready for playback and Gemini AI analysis!`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Video upload failed.";
      setUploadFeedback({ type: "error", message: msg });
    } finally {
      setUploading(false);
    }
  };

  const media = ad.mediaAssets?.[0];
  const score = ad.researchScores?.[0];
  const analysis = ad.analyses?.[0];
  const linkedProduct = ad.productLinks?.[0]?.product;

  // Detect data quality issues
  const hasSampleVideo = isSampleOrFakeMedia(media?.videoUrl);
  const hasStockThumbnail = isStockImage(media?.thumbnailUrl);
  const hasLegacyFakeAnalysis =
    analysis && analysis.hookQualityScore === 88 && analysis.pacingScore === 82;

  let concepts: any = null;
  if (analysis?.scriptIdeas) {
    try {
      concepts = JSON.parse(analysis.scriptIdeas);
    } catch {
      // fallback
    }
  }

  let sellingPoints: string[] = [];
  if (analysis?.sellingPoints) {
    try {
      sellingPoints = JSON.parse(analysis.sellingPoints);
    } catch {
      // fallback
    }
  }

  let weaknesses: string[] = [];
  if (analysis?.weaknesses) {
    try {
      weaknesses = JSON.parse(analysis.weaknesses);
    } catch {
      // fallback
    }
  }

  const scoreBreakdown = score?.scoreBreakdown
    ? (() => {
        try {
          return JSON.parse(score.scoreBreakdown);
        } catch {
          return null;
        }
      })()
    : null;

  // Score tier display
  const tierLabel =
    !score
      ? "NOT SCORED"
      : score.tier?.replace(/_/g, " ") || "INSUFFICIENT EVIDENCE";

  const tierClass =
    score?.tier === "HIGH_POTENTIAL"
      ? "bg-emerald-500/20 text-emerald-400"
      : score?.tier === "MEDIUM_POTENTIAL"
      ? "bg-amber-500/20 text-amber-400"
      : "bg-slate-700/40 text-slate-400";

  // Determine if storefront URL is likely valid
  const storefrontUrl = linkedProduct?.productUrl || ad.landingPageUrl;
  const storefrontDomain = linkedProduct?.store?.domain;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0c121e] border-l border-[#1f293d] h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="p-4 px-6 border-b border-[#1f293d] flex items-center justify-between bg-[#111827]">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 uppercase">
              {ad.platform}
            </span>
            <h2 className="text-sm font-bold text-white truncate max-w-sm">
              {ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN"
                ? ad.advertiser.name
                : "Unknown Advertiser"}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {onPrev && (
              <button
                onClick={onPrev}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Previous Ad"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {onNext && (
              <button
                onClick={onNext}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Next Ad"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors ml-2"
              title="Close Drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Data Quality Warnings */}
        {(hasSampleVideo || hasStockThumbnail || hasLegacyFakeAnalysis) && (
          <div className="px-6 pt-4 space-y-1.5">
            {hasSampleVideo && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/40 text-[11px] text-red-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
                <span>
                  <strong>Sample video detected</strong> — the stored video URL is a Google
                  demonstration file, not the actual advertisement creative.
                </span>
              </div>
            )}
            {hasStockThumbnail && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/40 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Stock thumbnail</strong> — thumbnail is a stock photo, not the
                  actual ad creative image.
                </span>
              </div>
            )}
            {hasLegacyFakeAnalysis && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/40 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Legacy analysis</strong> — hook quality score (88) and pacing
                  score (82) are hardcoded placeholders, not from real video analysis.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Video Player & Primary Facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            <div className="max-w-[280px] mx-auto w-full space-y-3">
              <AdVideoPlayer
                videoUrl={uploadedVideoUrl || media?.videoUrl}
                embedUrl={uploadedVideoUrl ? null : media?.embedUrl}
                thumbnailUrl={media?.thumbnailUrl}
                originalAdUrl={ad.originalAdUrl}
                externalAdId={ad.externalAdId}
                platform={ad.platform}
                status={ad.status}
                aspectRatio="9:16"
              />

              {/* Authorized Video Upload for AI Analysis (Requirement 9) */}
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Upload Video for AI</span>
                  </span>
                  {uploadedVideoUrl && (
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Attached
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Attach an authorized MP4 or WebM video to unlock inline playback and Gemini AI creative analysis.
                </p>

                {uploadFeedback && (
                  <div
                    className={`p-2 rounded-lg text-[10px] ${
                      uploadFeedback.type === "success"
                        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-800/40"
                        : "bg-rose-950/40 text-rose-300 border border-rose-800/40"
                    }`}
                  >
                    {uploadFeedback.message}
                  </div>
                )}

                <label className="block">
                  <input
                    type="file"
                    accept="video/mp4,video/webm"
                    onChange={handleVideoUpload}
                    disabled={uploading}
                    className="hidden"
                    id={`upload-video-${ad.id}`}
                  />
                  <span
                    className={`w-full py-1.5 px-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      uploading ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    <FileVideo className="h-3.5 w-3.5 text-indigo-400" />
                    <span>{uploading ? "Validating & Uploading..." : "Attach MP4 / WebM File"}</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              {/* Score Highlight Card */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 font-medium">Winning Potential</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${tierClass}`}>
                    {tierLabel}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">
                    {score?.totalScore ?? "—"}
                  </span>
                  <span className="text-slate-500 font-bold">/ 100</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Evidence Confidence:{" "}
                  {score?.confidenceScore != null
                    ? `${score.confidenceScore}%`
                    : "Not calculated"}
                </p>
                {!score && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Score not yet calculated for this record.
                  </p>
                )}
              </div>

              {/* Ad Copy */}
              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Headline</span>
                <p className="text-slate-200 font-medium leading-relaxed">
                  {ad.headline || "No headline observed"}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Primary Text</span>
                <p className="text-slate-400 leading-relaxed max-h-32 overflow-y-auto pr-1">
                  {ad.bodyText || "No additional creative copy provided"}
                </p>
              </div>

              {/* Status & Data Confidence */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                    ad.status === "ACTIVE"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : ad.status === "INACTIVE"
                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {ad.status}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                  {ad.dataConfidence || "UNVERIFIED"}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {onSaveToWatchlist && (
                    <button
                      onClick={() => onSaveToWatchlist(ad.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition-colors"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" />
                      <span>Save to Watchlist</span>
                    </button>
                  )}
                  {ad.originalAdUrl && (
                    <a
                      href={ad.originalAdUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Inspect Source</span>
                    </a>
                  )}
                </div>

                {/* Storefront Actions */}
                {storefrontUrl && (
                  <div className="flex items-center gap-2">
                    <a
                      href={storefrontUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-800/30 hover:bg-emerald-700/30 text-emerald-300 font-medium text-xs border border-emerald-700/30 transition-colors"
                    >
                      <Store className="h-3.5 w-3.5" />
                      <span>Visit Product Page</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[#1f293d] gap-4">
            <button
              onClick={() => setActiveTab("analysis")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "analysis"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Creative Breakdown</span>
            </button>
            <button
              onClick={() => setActiveTab("score")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "score"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              <span>Score Decomposition</span>
            </button>
            <button
              onClick={() => setActiveTab("provenance")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "provenance"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Provenance & Links</span>
            </button>
          </div>

          {/* Tab 1: Creative Analysis */}
          {activeTab === "analysis" && (
            <div className="space-y-4">
              {!analysis ? (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  <Sparkles className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                  <p className="font-medium text-slate-300 mb-1">No Analysis Yet</p>
                  <p className="text-slate-500">
                    Click "Analyze Creative" to run a copy-based analysis.
                    Video inspection requires actual video access.
                  </p>
                </div>
              ) : (
                <>
                  {/* Hook Analysis */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-semibold">
                        Hook Technique (from ad copy)
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {analysis.hookType || "Unknown"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-slate-500 text-[10px] block">Hook Quality Score</span>
                        {hasLegacyFakeAnalysis ? (
                          <span className="text-xs text-amber-400 italic">Hardcoded — not real</span>
                        ) : (
                          <span className="text-base font-bold text-white">
                            {analysis.hookQualityScore > 0
                              ? `${analysis.hookQualityScore} / 100`
                              : "N/A — copy only"}
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                        <span className="text-slate-500 text-[10px] block">Pacing & Dynamics</span>
                        {hasLegacyFakeAnalysis ? (
                          <span className="text-xs text-amber-400 italic">Hardcoded — not real</span>
                        ) : (
                          <span className="text-base font-bold text-white">
                            {analysis.pacingScore > 0
                              ? `${analysis.pacingScore} / 100`
                              : "N/A — video not analyzed"}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Analysis source: ad copy text only. Video frames were not inspected.
                    </p>
                  </div>

                  {/* Selling Points */}
                  {sellingPoints.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                      <span className="text-xs text-slate-400 font-semibold block">
                        Observed from Ad Copy
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {sellingPoints.map((pt, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Weaknesses */}
                  {weaknesses.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                      <span className="text-xs text-slate-400 font-semibold block">
                        Research Notes
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-400">
                        {weaknesses.map((w, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Original Concepts */}
                  {concepts && (
                    <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/30 space-y-3">
                      <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Original Script Ideas (Category-Based)</span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div>
                          <strong className="text-slate-300 block mb-1">15-Second Script:</strong>
                          <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border border-slate-800">
                            {concepts.script15s}
                          </pre>
                        </div>
                        <div>
                          <strong className="text-slate-300 block mb-1">UGC Angle:</strong>
                          <p className="text-slate-400 italic bg-slate-950/50 p-2.5 rounded-lg border border-slate-800">
                            &ldquo;{concepts.ugcAngle}&rdquo;
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tab 2: Score Breakdown */}
          {activeTab === "score" && (
            <div className="space-y-3 text-xs">
              {!score ? (
                <p className="text-slate-400 text-center py-4">No score calculated yet.</p>
              ) : (
                <>
                  <p className="text-slate-400">
                    Formula Version{" "}
                    <strong>{score.formulaVersion || "unknown"}</strong>.
                    Evidence-aware scoring — missing data is not substituted.
                  </p>

                  {scoreBreakdown?.missingSignals?.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/30 text-[11px] text-amber-300">
                      <strong className="block mb-1">Missing signals:</strong>
                      <ul className="list-disc list-inside space-y-0.5">
                        {scoreBreakdown.missingSignals.map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-2">
                    {[
                      {
                        label: "Observed Longevity",
                        sub: `Weight: 25% • ${ad.daysRunning} days since first seen`,
                        value: score.longevityScore,
                      },
                      {
                        label: "Creative Diversity",
                        sub: "Weight: 20% • Confirmed variant count",
                        value: score.diversityScore,
                      },
                      {
                        label: "Active Recency",
                        sub: "Weight: 15% • Freshness of last observation",
                        value: score.recencyScore,
                      },
                      {
                        label: "Product & Offer Clarity",
                        sub: "Weight: 10% • Landing page and CTA presence",
                        value: score.clarityScore,
                      },
                      {
                        label: "Performance Signals",
                        sub:
                          scoreBreakdown?.missingSignals?.includes("GENUINE_ENGAGEMENT_METRICS")
                            ? "Weight: 20% • UNAVAILABLE — no genuine metrics"
                            : "Weight: 20% • From verified platform data",
                        value: score.performanceScore,
                        unavailable:
                          scoreBreakdown?.missingSignals?.includes("GENUINE_ENGAGEMENT_METRICS"),
                      },
                      {
                        label: "AI Creative Quality",
                        sub:
                          scoreBreakdown?.missingSignals?.includes("AI_CREATIVE_ANALYSIS")
                            ? "Weight: 10% • UNAVAILABLE — no AI analysis performed"
                            : "Weight: 10% • From AI model analysis",
                        value: score.aiQualityScore,
                        unavailable:
                          scoreBreakdown?.missingSignals?.includes("AI_CREATIVE_ANALYSIS"),
                      },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center"
                      >
                        <div>
                          <span className="font-semibold text-white block">{item.label}</span>
                          <span className="text-[11px] text-slate-500">{item.sub}</span>
                        </div>
                        <span
                          className={`font-mono font-bold ${
                            item.unavailable ? "text-slate-500 italic" : "text-indigo-400"
                          }`}
                        >
                          {item.unavailable ? "N/A" : `${item.value ?? "—"}/100`}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab 3: Provenance & Links */}
          {activeTab === "provenance" && (
            <div className="space-y-3 text-xs">
              {ad.originalAdUrl && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-500 font-semibold text-[10px] uppercase">
                    Original Source Link
                  </span>
                  <a
                    href={ad.originalAdUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline break-all block"
                  >
                    {ad.originalAdUrl}
                  </a>
                </div>
              )}

              {ad.landingPageUrl && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-500 font-semibold text-[10px] uppercase">
                    Observed Landing Page
                  </span>
                  <a
                    href={ad.landingPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline break-all block"
                  >
                    {ad.landingPageUrl}
                  </a>
                  <p className="text-[10px] text-amber-400">
                    ⚠ Link not validated — may return 404 or redirect to a different product.
                  </p>
                </div>
              )}

              {linkedProduct && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-500 font-semibold text-[10px] uppercase">
                    Linked Research Product
                  </span>
                  <p className="text-slate-300">{linkedProduct.title}</p>
                  {linkedProduct.productUrl && (
                    <a
                      href={linkedProduct.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline break-all block"
                    >
                      {linkedProduct.productUrl}
                    </a>
                  )}
                </div>
              )}

              {/* Observation Time vs Actual Calendar Age (Requirement 11 & 12) */}
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider block">
                  Observation History vs. Actual Ad Age
                </span>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">SWAI Observation Span</span>
                    <strong className="text-white block font-mono">
                      {ad.observations?.length || 1} observation{(ad.observations?.length || 1) !== 1 ? "s" : ""}
                    </strong>
                    <span className="text-[10px] text-slate-400">
                      Since {new Date(ad.firstSeenAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Provider Calendar Age</span>
                    <strong className="text-white block font-mono">
                      {ad.sourceReportedStartAt
                        ? `${Math.max(1, Math.round((Date.now() - new Date(ad.sourceReportedStartAt).getTime()) / (1000 * 60 * 60 * 24)))} days`
                        : "Not reported by source"}
                    </strong>
                    <span className="text-[10px] text-slate-400">
                      {ad.sourceReportedStartAt ? "Source reported launch" : "Unverified calendar runtime"}
                    </span>
                  </div>
                </div>

                {ad.originalAdUrl?.includes("period=180") && (
                  <div className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-[10px] text-indigo-300">
                    ℹ <strong>Search Window Integrity:</strong> This creative was imported from a TikTok Creative Center 180-day search filter. A result appearing in a 180-day window does NOT prove 180 days of continuous ad delivery.
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 font-semibold text-[10px] uppercase">
                  Data Confidence & Status
                </span>
                <p className="text-slate-300">
                  Confidence: <strong>{ad.dataConfidence || "UNVERIFIED"}</strong>
                  {" • "}
                  Status: <strong>{ad.status || "UNKNOWN"}</strong>
                  {" • "}
                  Market: <strong>{ad.targetMarket || "UNKNOWN"}</strong>
                </p>
                <p className="text-[10px] text-slate-500">
                  Note: Observation records require active verification checks. Status remains UNKNOWN unless actively confirmed.
                </p>
              </div>

              {/* Media provenance warnings */}
              {(hasSampleVideo || hasStockThumbnail) && (
                <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/30 space-y-1">
                  <span className="text-red-400 font-semibold text-[10px] uppercase">
                    Media Integrity Issues
                  </span>
                  {hasSampleVideo && (
                    <p className="text-red-300 text-[11px]">
                      Video URL points to a Google sample file (gtv-videos-bucket), not the real ad.
                    </p>
                  )}
                  {hasStockThumbnail && (
                    <p className="text-amber-300 text-[11px]">
                      Thumbnail is an Unsplash stock photo, not the actual creative.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
