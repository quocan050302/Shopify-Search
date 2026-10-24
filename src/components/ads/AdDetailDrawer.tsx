"use client";

import { useState, useEffect } from "react";
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
  DollarSign,
  Calculator,
  RefreshCw,
  HelpCircle,
  CheckSquare,
  Package,
  Layers,
  Video as VideoIcon,
  Image as ImageIcon,
} from "lucide-react";
import { AdVideoPlayer } from "./AdVideoPlayer";
import { isSampleOrFakeMedia, isStockImage } from "@/services/links/linkValidationService";
import { AdViewModel, AdDetailViewModel, ProductEconomics, ResearchChecklist, MissingCostState } from "@/types/adViewModel";
import { calculateEconomics, deriveRecommendation } from "@/lib/economics";

interface AdDetailDrawerProps {
  ad: AdViewModel | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSaveToWatchlist?: (adId: string) => void;
  onProductCandidateSaved?: () => void;
}

export function AdDetailDrawer({
  ad,
  onClose,
  onNext,
  onPrev,
  onSaveToWatchlist,
  onProductCandidateSaved,
}: AdDetailDrawerProps) {
  const [detail, setDetail] = useState<AdDetailViewModel | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"analysis" | "score" | "product" | "provenance">("analysis");

  // Video Upload State
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Creative Analysis Action State
  const [analyzingCreative, setAnalyzingCreative] = useState(false);
  const [analysisFeedback, setAnalysisFeedback] = useState<string | null>(null);

  // Product Candidate Economics State (P1 & Decision Safety)
  const [sellingPrice, setSellingPrice] = useState<string>("");
  const [supplierCost, setSupplierCost] = useState<string>("");
  const [shippingCost, setShippingCost] = useState<string>("");
  const [platformFees, setPlatformFees] = useState<string>("");
  const [returnAllowancePercent, setReturnAllowancePercent] = useState<string>("5");
  const [targetProfitPerUnit, setTargetProfitPerUnit] = useState<string>("5.00");
  const [isConfirmedByUser, setIsConfirmedByUser] = useState<boolean>(false);
  const [costVerificationSource, setCostVerificationSource] = useState<"USER_ESTIMATE" | "SUPPLIER_INVOICE" | "USER_VERIFIED_QUOTE">("USER_ESTIMATE");
  const [candidateNotes, setCandidateNotes] = useState<string>("");
  const [userDecision, setUserDecision] = useState<"READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED" | "">("");

  // Product Candidate Checklist State with explicit UNKNOWN support
  const [checklist, setChecklist] = useState<{
    demandEvidence: "UNKNOWN" | "UNVERIFIED" | "VERIFIED";
    demandEvidenceSource: string;
    competitionLevel: "UNKNOWN" | "LOW" | "MODERATE" | "HIGH" | "SATURATED";
    creativeAppeal: "UNKNOWN" | "STRONG" | "MODERATE" | "WEAK";
    differentiationFeasibility: "UNKNOWN" | "VIABLE" | "UNCERTAIN" | "NOT_VIABLE";
    deliveryFeasibility: "UNKNOWN" | "CONFIRMED" | "UNCERTAIN" | "HIGH_RISK";
    returnRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  }>({
    demandEvidence: "UNKNOWN",
    demandEvidenceSource: "",
    competitionLevel: "UNKNOWN",
    creativeAppeal: "UNKNOWN",
    differentiationFeasibility: "UNKNOWN",
    deliveryFeasibility: "UNKNOWN",
    returnRisk: "UNKNOWN",
  });

  const [savingCandidate, setSavingCandidate] = useState(false);
  const [candidateFeedback, setCandidateFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetch full details whenever `ad?.id` changes
  useEffect(() => {
    if (!ad?.id) {
      setDetail(null);
      setLoadingDetail(false);
      setDetailError(null);
      return;
    }

    // Reset transient states
    setUploadedVideoUrl(null);
    setUploadFeedback(null);
    setAnalysisFeedback(null);
    setCandidateFeedback(null);

    // Rule 29: Reset all editable economics fields when switching ads
    setSellingPrice("");
    setSupplierCost("");
    setShippingCost("");
    setPlatformFees("");
    setReturnAllowancePercent("5");
    setTargetProfitPerUnit("5.00");
    setIsConfirmedByUser(false);
    setCostVerificationSource("USER_ESTIMATE");
    setCandidateNotes("");
    setUserDecision("");
    setChecklist({
      demandEvidence: "UNKNOWN",
      demandEvidenceSource: "",
      competitionLevel: "UNKNOWN",
      creativeAppeal: "UNKNOWN",
      differentiationFeasibility: "UNKNOWN",
      deliveryFeasibility: "UNKNOWN",
      returnRisk: "UNKNOWN",
    });

    const controller = new AbortController();
    setLoadingDetail(true);
    setDetailError(null);

    fetch(`/api/v1/ads/${ad.id}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load ad details`);
        return res.json();
      })
      .then((json) => {
        if (json.success && json.data) {
          setDetail(json.data);
          // Initialize economics from existing linked product data if available
          const existingEcon = json.data.linkedProduct?.economics;
          if (existingEcon) {
            if (existingEcon.observedSellingPrice != null) setSellingPrice(String(existingEcon.observedSellingPrice));
            if (existingEcon.estimatedSupplierCost != null) setSupplierCost(String(existingEcon.estimatedSupplierCost));
            if (existingEcon.shippingCost != null) setShippingCost(String(existingEcon.shippingCost));
            if (existingEcon.platformFees != null) setPlatformFees(String(existingEcon.platformFees));
            if (existingEcon.returnAllowancePercent != null) setReturnAllowancePercent(String(existingEcon.returnAllowancePercent));
            if (existingEcon.targetProfitPerUnit != null) setTargetProfitPerUnit(String(existingEcon.targetProfitPerUnit));
            if (existingEcon.isConfirmedByUser != null) setIsConfirmedByUser(Boolean(existingEcon.isConfirmedByUser));
            if (existingEcon.costVerificationSource) {
              setCostVerificationSource(existingEcon.costVerificationSource as any);
            }
          } else if (json.data.linkedProduct?.currentPrice != null) {
            setSellingPrice(String(json.data.linkedProduct.currentPrice));
          }

          if (json.data.linkedProduct?.checklist) {
            const c = json.data.linkedProduct.checklist;
            setChecklist({
              demandEvidence: typeof c.demandEvidence === "string" ? c.demandEvidence : c.demandEvidence ? "VERIFIED" : "UNKNOWN",
              demandEvidenceSource: c.demandEvidenceSource ?? "",
              competitionLevel: c.competitionLevel ?? "UNKNOWN",
              creativeAppeal: c.creativeAppeal ?? "UNKNOWN",
              differentiationFeasibility: typeof c.differentiationFeasibility === "string" ? c.differentiationFeasibility : c.differentiationFeasibility ? "VIABLE" : "NOT_VIABLE",
              deliveryFeasibility: typeof c.deliveryFeasibility === "string" ? c.deliveryFeasibility : c.deliveryFeasibility ? "CONFIRMED" : "HIGH_RISK",
              returnRisk: c.returnRisk ?? "UNKNOWN",
            });
          }

          if (json.data.linkedProduct?.userDecision) {
            setUserDecision(json.data.linkedProduct.userDecision);
          }
        } else {
          throw new Error(json.error?.message || "Failed to parse ad details");
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("Ad detail fetch failed:", err);
        setDetailError(err.message || "Failed to load full ad details.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDetail(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [ad?.id]);

  if (!ad) return null;

  // Active view model: use full detail if loaded, otherwise fall back to cached card data
  const activeMedia = detail?.media || ad.media || null;
  const activeScore = detail?.score || ad.score || null;
  const scoreDetails = detail?.scoreDetails || null;
  const analysis = detail?.analysis || null;
  const linkedProduct = detail?.linkedProduct || null;
  const distinctDates = detail?.distinctDates || {
    sourceReportedStartAt: ad.sourceReportedStartAt || null,
    sourceReportedEndAt: ad.sourceReportedEndAt || null,
    firstSwaiObservationAt: null,
    lastSwaiObservationAt: null,
    firstSeenAt: ad.firstSeenAt || null,
    lastSeenAt: ad.lastSeenAt || null,
  };
  const observations = detail?.observations || [];
  const provenance = detail?.provenance || {
    dataSourceName: ad.platform === "META" ? "META_AD_LIBRARY" : "TIKTOK_CREATIVE_CENTER",
    dataSourceDisplayName: ad.platform === "META" ? "Meta Ad Library" : "TikTok Creative Center",
    externalAdId: ad.externalAdId,
    originalAdUrl: ad.originalAdUrl,
    landingPageUrl: ad.landingPageUrl,
    storefrontDomain: null,
    dataConfidence: "UNVERIFIED",
    hasSampleMedia: isSampleOrFakeMedia(activeMedia?.videoUrl),
    hasStockThumbnail: isStockImage(activeMedia?.thumbnailUrl),
    missingFields: [],
  };

  // Live Economics Calculation using Canonical Engine
  const parsedPrice = sellingPrice ? parseFloat(sellingPrice) : null;
  const parsedCost = supplierCost ? parseFloat(supplierCost) : null;
  const parsedShipping = shippingCost !== "" ? parseFloat(shippingCost) : null;
  const parsedFees = platformFees !== "" ? parseFloat(platformFees) : null;
  const parsedReturnRate = returnAllowancePercent !== "" ? parseFloat(returnAllowancePercent) : null;
  const parsedTargetProfit = targetProfitPerUnit !== "" ? parseFloat(targetProfitPerUnit) : null;

  const liveEconomics = calculateEconomics({
    observedSellingPrice: parsedPrice,
    estimatedSupplierCost: parsedCost,
    shippingCost: parsedShipping,
    platformFees: parsedFees,
    returnAllowancePercent: parsedReturnRate,
    targetProfitPerUnit: parsedTargetProfit,
    isConfirmedByUser,
    costVerificationSource,
    sourceStatus: "USER_ENTERED",
  });

  const liveRecommendation = deriveRecommendation({
    contributionMargin: liveEconomics.contributionMargin,
    observedSellingPrice: parsedPrice,
    missingCostState: liveEconomics.missingCostState,
    isConfirmedByUser: liveEconomics.isConfirmedByUser,
    costVerificationSource: (liveEconomics.costVerificationSource as any),
    demandEvidence: checklist.demandEvidence,
    demandEvidenceSource: checklist.demandEvidenceSource,
    competitionLevel: checklist.competitionLevel,
    creativeAppeal: checklist.creativeAppeal,
    differentiationFeasibility: checklist.differentiationFeasibility,
    deliveryFeasibility: checklist.deliveryFeasibility,
    returnRisk: checklist.returnRisk,
  });

  const recColor =
    liveRecommendation.recommendation === "READY_FOR_SMALL_TEST"
      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : liveRecommendation.recommendation === "REJECTED"
      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
      : "bg-amber-500/20 text-amber-400 border border-amber-500/30";

  // Handle Save Candidate
  const handleSaveProductCandidate = async () => {
    setSavingCandidate(true);
    setCandidateFeedback(null);
    try {
      const res = await fetch(`/api/v1/ads/${ad.id}/product-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observedSellingPrice: parsedPrice,
          estimatedSupplierCost: parsedCost,
          shippingCost: parsedShipping,
          platformFees: parsedFees,
          returnAllowancePercent: parsedReturnRate,
          targetProfitPerUnit: parsedTargetProfit,
          isConfirmedByUser,
          costVerificationSource,
          checklist,
          userDecision: userDecision || null,
          notes: candidateNotes,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Failed to save candidate");
      setCandidateFeedback({
        type: "success",
        message: "Saved to ResearchProduct! Candidate economics, scenario decision, and checklist recorded.",
      });
      if (onProductCandidateSaved) onProductCandidateSaved();
    } catch (err: any) {
      setCandidateFeedback({
        type: "error",
        message: err.message || "Failed to save candidate",
      });
    } finally {
      setSavingCandidate(false);
    }
  };

  // Handle Video Upload
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
        message: `Video attached (${json.data.format} container). Ready for playback and Gemini AI analysis!`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Video upload failed.";
      setUploadFeedback({ type: "error", message: msg });
    } finally {
      setUploading(false);
    }
  };

  // Handle Analyze Creative Action
  const handleAnalyzeCreative = async () => {
    setAnalyzingCreative(true);
    setAnalysisFeedback(null);
    try {
      const res = await fetch(`/api/v1/ads/${ad.id}/analyze`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Analysis failed");

      setAnalysisFeedback(
        json.data?.analysisMode === "GEMINI_VIDEO_ANALYSIS"
          ? "Gemini Multimodal video analysis completed."
          : "Copy-Only analysis completed. Video frames were not inspected."
      );

      // Refresh detail
      const refreshed = await fetch(`/api/v1/ads/${ad.id}`);
      const refreshedJson = await refreshed.json();
      if (refreshedJson.success && refreshedJson.data) {
        setDetail(refreshedJson.data);
      }
    } catch (err: any) {
      setAnalysisFeedback(`Analysis error: ${err.message}`);
    } finally {
      setAnalyzingCreative(false);
    }
  };

  const hasSampleVideo = provenance.hasSampleMedia;
  const hasStockThumbnail = provenance.hasStockThumbnail;

  const tierLabel = activeScore?.tier ? activeScore.tier.replace(/_/g, " ") : "INSUFFICIENT EVIDENCE";
  const tierClass =
    activeScore?.tier === "HIGH_RESEARCH_PRIORITY" || activeScore?.tier === "HIGH_POTENTIAL"
      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : activeScore?.tier === "MEDIUM_RESEARCH_PRIORITY" || activeScore?.tier === "MEDIUM_POTENTIAL"
      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
      : "bg-slate-800 text-slate-400 border border-slate-700";

  const storefrontUrl = linkedProduct?.productUrl || ad.landingPageUrl;
  const storefrontDomain = provenance.storefrontDomain || (storefrontUrl ? new URL(storefrontUrl.startsWith("http") ? storefrontUrl : `https://${storefrontUrl}`).hostname.replace(/^www\./, "") : null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0c121e] border-l border-[#1f293d] h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header Bar */}
        <div className="p-4 px-6 border-b border-[#1f293d] flex items-center justify-between bg-[#111827] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 uppercase shrink-0">
              {ad.platform}
            </span>
            <h2 className="text-sm font-bold text-white truncate max-w-sm" title={ad.advertiser?.name || "Advertiser"}>
              {ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN"
                ? ad.advertiser.name
                : "Unknown Advertiser"}
            </h2>
            {loadingDetail && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/40">
                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                <span>Loading full details...</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
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
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors ml-1"
              title="Close Drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Retry Banner on detail fetch error */}
        {detailError && (
          <div className="px-6 py-2 bg-amber-950/40 border-b border-amber-800/40 text-[11px] text-amber-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>Showing cached card data. Full detail fetch failed: {detailError}</span>
            </div>
            <button
              onClick={() => {
                setDetailError(null);
                setLoadingDetail(true);
                fetch(`/api/v1/ads/${ad.id}`)
                  .then((res) => res.json())
                  .then((json) => {
                    if (json.success) setDetail(json.data);
                  })
                  .finally(() => setLoadingDetail(false));
              }}
              className="text-xs underline font-semibold text-white hover:text-amber-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Data Quality Warnings */}
        {(hasSampleVideo || hasStockThumbnail) && (
          <div className="px-6 pt-3 space-y-1.5 shrink-0">
            {hasSampleVideo && (
              <div className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-800/40 text-[11px] text-red-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
                <span>
                  <strong>Sample video detected</strong> — stored video URL is a Google sample file, not the real ad creative.
                </span>
              </div>
            )}
            {hasStockThumbnail && (
              <div className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/40 text-[11px] text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Stock thumbnail</strong> — thumbnail is an Unsplash/Pexels stock image, not the actual ad thumbnail.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Main Creative Preview & Primary Facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            <div className="max-w-[280px] mx-auto w-full space-y-3">
              <AdVideoPlayer
                videoUrl={uploadedVideoUrl || activeMedia?.videoUrl}
                embedUrl={uploadedVideoUrl ? null : activeMedia?.embedUrl}
                thumbnailUrl={activeMedia?.thumbnailUrl}
                originalAdUrl={ad.originalAdUrl}
                externalAdId={ad.externalAdId}
                platform={ad.platform}
                status={ad.status}
                aspectRatio={activeMedia?.aspectRatio || "1:1"}
                mediaType={activeMedia?.mediaType || "UNKNOWN"}
              />

              {/* Upload local video file */}
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
                  Attach an authorized MP4 or WebM file to unlock inline playback and Gemini AI analysis.
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
                    <span>{uploading ? "Uploading..." : "Attach MP4 / WebM"}</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              {/* Research Priority Score Card */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Research Priority</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${tierClass}`}>
                    {tierLabel}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-white">
                    {activeScore?.totalScore ?? "—"}
                  </span>
                  <span className="text-slate-500 font-bold">/ 100</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Signal based on verified longevity & observation frequency. Not a measure of sales or profitability.
                </p>
                {activeScore?.evidenceConfidence != null && (
                  <p className="text-[11px] text-slate-400">
                    Evidence Confidence:{" "}
                    <strong>{Math.round(activeScore.evidenceConfidence * 100)}%</strong>
                  </p>
                )}
              </div>

              {/* Ad Headline */}
              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Headline</span>
                <p className="text-slate-200 font-medium leading-relaxed">
                  {ad.headline || <span className="text-slate-600 italic">No headline recorded</span>}
                </p>
              </div>

              {/* Primary Copy */}
              <div className="space-y-1">
                <span className="text-slate-500 font-semibold uppercase text-[10px]">Primary Text</span>
                <p className="text-slate-400 leading-relaxed max-h-28 overflow-y-auto pr-1">
                  {ad.bodyText || <span className="text-slate-600 italic">No primary copy recorded</span>}
                </p>
              </div>

              {/* Status & CTA */}
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
                {ad.callToAction && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950/40 text-indigo-300 border border-indigo-800/40 font-medium">
                    CTA: {ad.callToAction}
                  </span>
                )}
                {ad.platform === "META" && ad.externalAdId && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/40 text-blue-300 border border-blue-800/40 font-mono">
                    FB ID: {ad.externalAdId}
                  </span>
                )}
              </div>

              {/* Actions */}
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

                {storefrontUrl && (
                  <a
                    href={storefrontUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/40 text-emerald-300 font-medium text-xs border border-emerald-800/40 transition-colors"
                  >
                    <Store className="h-3.5 w-3.5" />
                    <span>Visit Landing Page ({storefrontDomain || "Storefront"})</span>
                  </a>
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
              onClick={() => setActiveTab("product")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "product"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>Product Research & Candidate</span>
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
              <span>Provenance & Dates</span>
            </button>
          </div>

          {/* Tab 1: Creative Analysis */}
          {activeTab === "analysis" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  Creative Angle & Copy Intelligence
                </span>
                <button
                  onClick={handleAnalyzeCreative}
                  disabled={analyzingCreative}
                  className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{analyzingCreative ? "Analyzing..." : "Analyze Creative (Copy-Based)"}</span>
                </button>
              </div>

              {analysisFeedback && (
                <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-xs text-indigo-300">
                  {analysisFeedback}
                </div>
              )}

              {!analysis ? (
                <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400 space-y-2">
                  <Sparkles className="h-6 w-6 text-slate-600 mx-auto" />
                  <p className="font-medium text-slate-300">No Creative Analysis Yet</p>
                  <p className="text-slate-500 max-w-sm mx-auto">
                    Click &ldquo;Analyze Creative (Copy-Based)&rdquo; to analyze the hook technique, selling angles, and script ideas from observed ad copy.
                  </p>
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-400 font-semibold block">
                          Hook Classification
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {analysis.isCopyOnly ? "Source: Ad copy text only. Video frames not inspected." : "Source: Multimodal AI Analysis"}
                        </span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {analysis.hookType || "Emotional / Story"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-slate-500 text-[10px] block">Hook Quality</span>
                        <span className="text-base font-bold text-white">
                          {analysis.hookQualityScore != null && analysis.hookQualityScore > 0
                            ? `${analysis.hookQualityScore}/100`
                            : "N/A — copy only"}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-slate-500 text-[10px] block">Pacing & Dynamics</span>
                        <span className="text-base font-bold text-white">
                          {analysis.pacingScore != null && analysis.pacingScore > 0
                            ? `${analysis.pacingScore}/100`
                            : "N/A — video not analyzed"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {analysis.sellingPoints.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                      <span className="text-xs text-slate-400 font-semibold block">
                        Observed Selling Angles
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {analysis.sellingPoints.map((pt, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.weaknesses.length > 0 && (
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                      <span className="text-xs text-slate-400 font-semibold block">
                        Research Notes & Limits
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-400">
                        {analysis.weaknesses.map((w, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.scriptIdeas && (
                    <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/30 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Script Ideas (Category-Based)</span>
                      </div>
                      {Boolean(analysis.scriptIdeas.script15s) && (
                        <div>
                          <strong className="text-slate-300 text-[11px] block mb-1">15-Second Concept:</strong>
                          <pre className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap border border-slate-800">
                            {String(analysis.scriptIdeas.script15s)}
                          </pre>
                        </div>
                      )}
                      {Boolean(analysis.scriptIdeas.ugcAngle) && (
                        <div>
                          <strong className="text-slate-300 text-[11px] block mb-1">UGC Angle:</strong>
                          <p className="text-slate-400 italic bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 text-[11px]">
                            &ldquo;{String(analysis.scriptIdeas.ugcAngle)}&rdquo;
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tab 2: Score Breakdown */}
          {activeTab === "score" && (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/30 text-amber-300/90 text-[11px] flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Evergreen Research Priority Signal:</strong> This score measures observed runtime longevity,
                  observation frequency, and evidence confidence. It is <strong>NOT</strong> a verified profitability score,
                  competitor ROAS, or store performance metric.
                </span>
              </div>

              {scoreDetails ? (
                <>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Scoring Model</span>
                      <strong className="text-white text-xs">Evergreen Formula V{scoreDetails.formulaVersion}</strong>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 block text-[10px]">Evidence Quality</span>
                      <span className="font-semibold text-emerald-400">
                        {Math.round((scoreDetails.evidenceConfidence || 0) * 100)}% Confidence
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {/* Component 1: Longevity */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-white block">Observed Longevity</span>
                        <span className="text-[11px] text-slate-400">
                          Weight: {scoreDetails.componentWeights.longevity}% •{" "}
                          {scoreDetails.calendarAgeDays != null ? `${scoreDetails.calendarAgeDays} days elapsed` : "Age unrecorded"}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-indigo-400 text-sm">
                        {scoreDetails.longevityComponent ?? 0} / {scoreDetails.componentWeights.longevity}
                      </span>
                    </div>

                    {/* Component 2: Observation */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-white block">Observation Continuity</span>
                        <span className="text-[11px] text-slate-400">
                          Weight: {scoreDetails.componentWeights.observation}% •{" "}
                          {ad.observationCount ?? observations.length} total observation{(ad.observationCount ?? observations.length) !== 1 ? "s" : ""},{" "}
                          {ad.verifiedActiveCount ?? 0} confirmed active
                        </span>
                      </div>
                      <span className="font-mono font-bold text-indigo-400 text-sm">
                        {scoreDetails.observationComponent ?? 0} / {scoreDetails.componentWeights.observation}
                      </span>
                    </div>

                    {/* Component 3: Coverage */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-white block">Continuity Coverage</span>
                        <span className="text-[11px] text-slate-400">
                          Weight: {scoreDetails.componentWeights.coverage}% • Status:{" "}
                          {scoreDetails.coverageStatus?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-indigo-400 text-sm">
                        {scoreDetails.coverageComponent ?? 0} / {scoreDetails.componentWeights.coverage}
                      </span>
                    </div>

                    {/* Component 4: Source Reliability */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-white block">Source Reliability</span>
                        <span className="text-[11px] text-slate-400">
                          Weight: {scoreDetails.componentWeights.sourceReliability}% •{" "}
                          {provenance.dataSourceDisplayName}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-indigo-400 text-sm">
                        {scoreDetails.sourceReliabilityComponent ?? 0} / {scoreDetails.componentWeights.sourceReliability}
                      </span>
                    </div>
                  </div>

                  {scoreDetails.missingSignals && scoreDetails.missingSignals.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] text-slate-500 font-semibold uppercase block">
                        Unobserved Evidence Signals
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {scoreDetails.missingSignals.map((sig, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono">
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-6 text-center text-slate-500 bg-slate-900 rounded-xl border border-slate-800">
                  Score breakdown details are being computed from observation records...
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Shopify Product Research & Economics (P1) */}
          {activeTab === "product" && (
            <div className="space-y-5 text-xs">
              {/* Store & Landing Page Detection */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold text-xs flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-emerald-400" />
                    <span>Storefront & Landing Page</span>
                  </span>
                  {storefrontDomain && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 font-mono font-semibold">
                      {storefrontDomain.includes("myshopify") ? "Shopify Confirmed" : "Shopify / Direct"}
                    </span>
                  )}
                </div>

                <div className="text-[11px] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Store Domain:</span>
                    <strong className="text-white font-mono">{storefrontDomain || "Not detected"}</strong>
                  </div>
                  {ad.landingPageUrl && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Landing URL:</span>
                      <a
                        href={ad.landingPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline truncate max-w-xs block font-mono"
                      >
                        {ad.landingPageUrl}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Unit Economics Calculator */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-200 font-bold text-xs">
                    <Calculator className="h-4 w-4 text-indigo-400" />
                    <span>Unit Economics & Margin Calculator</span>
                  </div>
                  <span className="text-[10px] text-amber-400 italic">
                    Never invent supplier costs — enter verified quotes
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Observed Selling Price ($) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 49.99"
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Est. Supplier Cost / COGS ($) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 12.50"
                      value={supplierCost}
                      onChange={(e) => setSupplierCost(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Shipping to Customer ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Leave blank if unknown"
                      value={shippingCost}
                      onChange={(e) => setShippingCost(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Platform & Fees ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Leave blank if unknown"
                      value={platformFees}
                      onChange={(e) => setPlatformFees(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Return Allowance (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      placeholder="Default 5%"
                      value={returnAllowancePercent}
                      onChange={(e) => setReturnAllowancePercent(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Target Profit / Unit ($)
                    </label>
                    <input
                      type="number"
                      step="0.50"
                      placeholder="e.g. 5.00"
                      value={targetProfitPerUnit}
                      onChange={(e) => setTargetProfitPerUnit(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Verification Source & Confirmation Checkbox */}
                <div className="pt-2 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={isConfirmedByUser}
                      onChange={(e) => setIsConfirmedByUser(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                    />
                    <span>I have confirmed these costs from a supplier price sheet or invoice</span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500">Source:</span>
                    <select
                      value={costVerificationSource}
                      onChange={(e) => setCostVerificationSource(e.target.value as any)}
                      className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 text-[10px]"
                    >
                      <option value="USER_ESTIMATE">User Estimate</option>
                      <option value="USER_VERIFIED_QUOTE">Verified Supplier Quote</option>
                      <option value="SUPPLIER_INVOICE">Supplier Invoice</option>
                    </select>
                  </div>
                </div>

                {/* Missing Cost State Alert */}
                {liveEconomics.missingCostState === "MISSING_SHIPPING_AND_FEES" && (
                  <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Warning:</strong> Shipping or gateway fees are unspecified. Margin calculation assumes $0 shipping/fees for preliminary modeling only and cannot produce a small test recommendation.
                    </span>
                  </div>
                )}
                {liveEconomics.missingCostState === "MISSING_SUPPLIER_COST" && (
                  <div className="p-2.5 rounded-lg bg-blue-950/30 border border-blue-800/40 text-[11px] text-blue-300 flex items-start gap-2">
                    <HelpCircle className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <span>
                      Enter estimated supplier cost (COGS) to calculate contribution margin, break-even ROAS, and max allowable CPA.
                    </span>
                  </div>
                )}

                {/* Economics Output Grid */}
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Est. Contribution Margin</span>
                    {liveEconomics.contributionMargin !== null ? (
                      <span className={`text-base sm:text-lg font-bold font-mono ${liveEconomics.contributionMargin > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        ${liveEconomics.contributionMargin.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">Requires price & cost</span>
                    )}
                    <span className="text-[9px] text-slate-500 block">Hypothetical model</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">Break-even CPA (Max Ad Cost)</span>
                    {liveEconomics.breakEvenCPA !== null ? (
                      <span className={`text-base sm:text-lg font-bold font-mono ${liveEconomics.breakEvenCPA > 0 ? "text-indigo-400" : "text-rose-400"}`}>
                        ${liveEconomics.breakEvenCPA.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">Uncalculated</span>
                    )}
                    <span className="text-[9px] text-slate-500 block">Zero profit threshold</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">Break-even ROAS</span>
                    {liveEconomics.breakEvenROAS !== null ? (
                      <span className="text-base sm:text-lg font-bold font-mono text-cyan-400">
                        {liveEconomics.breakEvenROAS.toFixed(2)}x
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">N/A</span>
                    )}
                    <span className="text-[9px] text-slate-500 block">Price / Margin</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">Target CPA</span>
                    {liveEconomics.targetCPA != null ? (
                      <span className="text-base sm:text-lg font-bold font-mono text-purple-400">
                        ${liveEconomics.targetCPA.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">N/A</span>
                    )}
                    <span className="text-[9px] text-slate-500 block">After target profit</span>
                  </div>
                </div>
              </div>

              {/* Structured Research Checklist */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-200 font-bold text-xs block">
                    Structured Research Checklist (Evidence Gates)
                  </span>
                  <span className="text-[10px] text-slate-500">
                    All gates must be evaluated (no UNKNOWN allowed for small test)
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Demand Evidence */}
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-300">
                        Market Demand Evidence
                      </label>
                      <select
                        value={checklist.demandEvidence}
                        onChange={(e) => setChecklist({ ...checklist, demandEvidence: e.target.value as any })}
                        className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px]"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not yet investigated</option>
                        <option value="UNVERIFIED">UNVERIFIED — No external proof</option>
                        <option value="VERIFIED">VERIFIED — External evidence cited</option>
                      </select>
                    </div>

                    {checklist.demandEvidence === "VERIFIED" && (
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 block">
                          Demand Source Citation (Required for VERIFIED):
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Google Trends index > 60, Amazon Best Seller #12, 400+ genuine reviews"
                          value={checklist.demandEvidenceSource}
                          onChange={(e) => setChecklist({ ...checklist, demandEvidenceSource: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                        />
                        {checklist.demandEvidenceSource &&
                          (checklist.demandEvidenceSource.toLowerCase().includes("headline") ||
                            checklist.demandEvidenceSource.toLowerCase().includes("ad copy") ||
                            checklist.demandEvidenceSource.toLowerCase().includes("body")) && (
                            <span className="text-[10px] text-rose-400 block font-semibold">
                              ⚠ Ad headline or body text is commercial copy, not verified market demand proof.
                            </span>
                          )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Competition Level */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Competition Level</label>
                      <select
                        value={checklist.competitionLevel}
                        onChange={(e) => setChecklist({ ...checklist, competitionLevel: e.target.value as any })}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not researched</option>
                        <option value="LOW">LOW — Few active competitors</option>
                        <option value="MODERATE">MODERATE — Established category</option>
                        <option value="HIGH">HIGH — Multiple active sellers</option>
                        <option value="SATURATED">SATURATED — Intense bidding wars</option>
                      </select>
                    </div>

                    {/* Creative Appeal */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Creative Angle Appeal</label>
                      <select
                        value={checklist.creativeAppeal}
                        onChange={(e) => setChecklist({ ...checklist, creativeAppeal: e.target.value as any })}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not reviewed</option>
                        <option value="STRONG">STRONG — Visual & clear problem hook</option>
                        <option value="MODERATE">MODERATE — Standard commercial angle</option>
                        <option value="WEAK">WEAK — Generic commodity ad</option>
                      </select>
                    </div>

                    {/* Differentiation Feasibility */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Differentiation Feasibility</label>
                      <select
                        value={checklist.differentiationFeasibility}
                        onChange={(e) => setChecklist({ ...checklist, differentiationFeasibility: e.target.value as any })}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not evaluated</option>
                        <option value="VIABLE">VIABLE — Feasible packaging/UGC/angle</option>
                        <option value="UNCERTAIN">UNCERTAIN — Difficult to differentiate</option>
                        <option value="NOT_VIABLE">NOT VIABLE — Undifferentiated commodity</option>
                      </select>
                    </div>

                    {/* Delivery Feasibility */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Delivery Feasibility</label>
                      <select
                        value={checklist.deliveryFeasibility}
                        onChange={(e) => setChecklist({ ...checklist, deliveryFeasibility: e.target.value as any })}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not evaluated</option>
                        <option value="CONFIRMED">CONFIRMED — Standard packet, durable</option>
                        <option value="UNCERTAIN">UNCERTAIN — Requires packaging test</option>
                        <option value="HIGH_RISK">HIGH RISK — Fragile, hazardous, oversize</option>
                      </select>
                    </div>

                    {/* Return Risk */}
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block mb-1">Return & Quality Risk</label>
                      <select
                        value={checklist.returnRisk}
                        onChange={(e) => setChecklist({ ...checklist, returnRisk: e.target.value as any })}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs"
                      >
                        <option value="UNKNOWN">UNKNOWN — Not evaluated</option>
                        <option value="LOW">LOW — Simple durable goods, no sizing</option>
                        <option value="MEDIUM">MEDIUM — Apparel sizing, minor tech</option>
                        <option value="HIGH">HIGH — Complex electronics, breakables</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Research Recommendation (Algorithm vs Researcher Decision) */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Algorithm Recommendation</span>
                  <span className={`text-xs px-2.5 py-1 rounded font-bold tracking-wide uppercase ${recColor}`}>
                    {liveRecommendation.recommendation.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">
                  {liveRecommendation.rationale}
                </p>

                {/* Explicit Researcher Decision Selector */}
                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-400">
                      Researcher Decision (Override/Confirmation):
                    </label>
                    <select
                      value={userDecision}
                      onChange={(e) => setUserDecision(e.target.value as any)}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-semibold"
                    >
                      <option value="">(Default: Follow Algorithm)</option>
                      <option value="READY_FOR_SMALL_TEST">READY FOR SMALL TEST</option>
                      <option value="RESEARCH_MORE">RESEARCH MORE</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>
                  <span className="text-[10px] text-slate-500 italic block">
                    The algorithmic recommendation is computed from verified gates. Your decision is preserved separately for research accountability.
                  </span>
                </div>
              </div>

              {/* Historical Decisions / Scenario Scenarios */}
              {linkedProduct?.history && linkedProduct.history.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                    Scenario Audit Trail ({linkedProduct.history.length} logged decision{linkedProduct.history.length !== 1 ? "s" : ""})
                  </span>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                    {linkedProduct.history.map((h, i) => (
                      <div key={h.id || i} className="text-[10px] p-1.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
                        <span className="font-semibold text-slate-300">{h.decision}</span>
                        <span className="text-slate-500 font-mono">
                          {new Date(h.decidedAt || h.createdAt || Date.now()).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes & Save Button */}
              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 block">Candidate Research Notes</label>
                <textarea
                  rows={2}
                  placeholder="Supplier links, target audience insights, or test strategy notes..."
                  value={candidateNotes}
                  onChange={(e) => setCandidateNotes(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-indigo-500"
                />

                {candidateFeedback && (
                  <div
                    className={`p-2.5 rounded-lg text-xs ${
                      candidateFeedback.type === "success"
                        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-800/40"
                        : "bg-rose-950/40 text-rose-300 border border-rose-800/40"
                    }`}
                  >
                    {candidateFeedback.message}
                  </div>
                )}

                <button
                  onClick={handleSaveProductCandidate}
                  disabled={savingCandidate}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShoppingBag className="h-4 w-4" />
                  <span>{savingCandidate ? "Saving Candidate..." : "Save as Product Candidate"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 4: Provenance & Dates */}
          {activeTab === "provenance" && (
            <div className="space-y-4 text-xs">
              {/* Distinct Dates Box (Requirement 14) */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <span className="text-slate-200 font-bold text-xs block">
                  Distinct Provenance Dates & Times
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Source Launch Date</span>
                    <strong className="text-white block font-mono">
                      {distinctDates.sourceReportedStartAt
                        ? new Date(distinctDates.sourceReportedStartAt).toLocaleDateString()
                        : "Not reported"}
                    </strong>
                    <span className="text-[9px] text-slate-500">Reported by provider API</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">First SWAI Observation</span>
                    <strong className="text-white block font-mono">
                      {distinctDates.firstSwaiObservationAt
                        ? new Date(distinctDates.firstSwaiObservationAt).toLocaleDateString()
                        : distinctDates.firstSeenAt
                        ? new Date(distinctDates.firstSeenAt).toLocaleDateString()
                        : "Unrecorded"}
                    </strong>
                    <span className="text-[9px] text-slate-500">First indexed by SWAI</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Most Recent Observation</span>
                    <strong className="text-white block font-mono">
                      {distinctDates.lastSwaiObservationAt
                        ? new Date(distinctDates.lastSwaiObservationAt).toLocaleDateString()
                        : distinctDates.lastSeenAt
                        ? new Date(distinctDates.lastSeenAt).toLocaleDateString()
                        : "Unrecorded"}
                    </strong>
                    <span className="text-[9px] text-slate-500">Latest active check</span>
                  </div>
                </div>
              </div>

              {/* Source Links */}
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <span className="text-slate-500 font-semibold text-[10px] uppercase block">
                  Original Source Links
                </span>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Canonical Link:</span>
                    <a
                      href={ad.originalAdUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:underline break-all truncate max-w-sm font-mono text-[11px]"
                    >
                      {ad.originalAdUrl}
                    </a>
                  </div>
                  {ad.landingPageUrl && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Landing Page:</span>
                      <a
                        href={ad.landingPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline break-all truncate max-w-sm font-mono text-[11px]"
                      >
                        {ad.landingPageUrl}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Observations Log */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-200 font-bold text-xs">
                    SWAI Observation Log ({observations.length})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {ad.verifiedActiveCount ?? 0} confirmed ACTIVE
                  </span>
                </div>

                {observations.length === 0 ? (
                  <p className="text-slate-500 italic text-[11px]">
                    No explicit historical observation records attached to this record yet.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {observations.map((obs) => (
                      <div
                        key={obs.id}
                        className="p-2 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              obs.observationStatus === "ACTIVE"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : obs.observationStatus === "INACTIVE"
                                ? "bg-rose-500/20 text-rose-400"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {obs.observationStatus}
                          </span>
                          <span className="text-slate-300 font-mono">
                            {new Date(obs.observedAt).toLocaleString()}
                          </span>
                        </div>
                        <span className="text-slate-500 text-[10px]">
                          {obs.verificationMethod || obs.evidenceType}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Missing Fields and Uncertainty (Requirement 15) */}
              {provenance.missingFields.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-semibold text-[10px] uppercase block">
                    Data Quality & Uncertainty Disclosure
                  </span>
                  <p className="text-slate-400 text-[11px]">
                    The following fields are unobserved or unavailable from provider responses:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {provenance.missingFields.map((field, idx) => (
                      <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-amber-400 border border-slate-800">
                        Missing: {field}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
