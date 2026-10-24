"use client";

import { ExternalLink, Flame, Clock, ShieldCheck, BookmarkPlus, AlertCircle, Image as ImageIcon, Video, Layers } from "lucide-react";
import { AdVideoPlayer } from "./AdVideoPlayer";
import { isSampleOrFakeMedia } from "@/services/links/linkValidationService";
import { AdViewModel } from "@/types/adViewModel";

interface AdCardProps {
  ad: AdViewModel | any;
  onSelect: (ad: any) => void;
  onSaveToWatchlist?: (adId: string) => void;
}

export function AdCard({ ad, onSelect, onSaveToWatchlist }: AdCardProps) {
  // Support both unified AdViewModel and legacy shapes
  const media = ad.media || ad.mediaAssets?.[0];
  const scoreRecord = ad.score || ad.researchScores?.[0] || ad.evergreenScore;
  const totalScore = scoreRecord?.totalScore ?? null;
  const hasSampleVideo = isSampleOrFakeMedia(media?.videoUrl);
  const mediaType: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN" =
    media?.mediaType || "UNKNOWN";
  const aspectRatio = media?.aspectRatio || "1:1";

  // Score badge style
  const getScoreBadgeClass = (s: number | null) => {
    if (s === null) return "bg-slate-800 text-slate-400 border-slate-700";
    if (s >= 75) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    if (s >= 50) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return "bg-slate-800 text-slate-400 border-slate-700";
  };

  // Start Date calculation (Meta-reported delivery start)
  const getStartAgeInfo = () => {
    if (ad.sourceReportedStartAt) {
      try {
        const startMs = new Date(ad.sourceReportedStartAt).getTime();
        if (!isNaN(startMs)) {
          const daysAgo = Math.max(0, Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24)));
          const dateStr = new Date(ad.sourceReportedStartAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          if (daysAgo === 0) {
            return {
              short: "Started today",
              full: `Started today (${dateStr}, Meta-reported)`,
              daysAgo: 0,
            };
          }
          return {
            short: `Started ${daysAgo}d ago`,
            full: `Started ${daysAgo} days ago (${dateStr}, Meta-reported)`,
            daysAgo,
          };
        }
      } catch {}
    }
    return null;
  };

  // SWAI Discovery Date calculation
  const getDiscoveredInfo = () => {
    if (ad.firstSeenAt) {
      try {
        const seenMs = new Date(ad.firstSeenAt).getTime();
        if (!isNaN(seenMs)) {
          const daysAgo = Math.max(0, Math.floor((Date.now() - seenMs) / (1000 * 60 * 60 * 24)));
          if (daysAgo === 0) return "Discovered today (SWAI)";
          return `Discovered ${daysAgo}d ago (SWAI)`;
        }
      } catch {}
    }
    return null;
  };

  const startAge = getStartAgeInfo();
  const discoveredText = getDiscoveredInfo();

  return (
    <div
      tabIndex={0}
      role="article"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(ad);
        }
      }}
      className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden hover:border-slate-600 focus:border-indigo-500 focus:outline-none transition-all flex flex-col group shadow-sm hover:shadow-md"
    >
      {/* Media Preview Container */}
      <div className="relative p-2.5 pb-0 bg-slate-950/40">
        <AdVideoPlayer
          videoUrl={media?.videoUrl}
          embedUrl={media?.embedUrl}
          thumbnailUrl={media?.thumbnailUrl}
          originalAdUrl={ad.originalAdUrl}
          externalAdId={ad.externalAdId}
          platform={ad.platform}
          status={ad.status}
          aspectRatio={aspectRatio}
          mediaType={mediaType}
        />

        {/* Floating Format Badge */}
        <div className="absolute top-4 left-4 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-semibold text-slate-300 border border-white/10 pointer-events-none">
          {mediaType === "VIDEO" ? (
            <>
              <Video className="h-3 w-3 text-indigo-400" />
              <span>Video</span>
            </>
          ) : mediaType === "IMAGE" ? (
            <>
              <ImageIcon className="h-3 w-3 text-emerald-400" />
              <span>Image</span>
            </>
          ) : mediaType === "CAROUSEL" ? (
            <>
              <Layers className="h-3 w-3 text-sky-400" />
              <span>Carousel</span>
            </>
          ) : (
            <span>Ad</span>
          )}
        </div>

        {/* Floating Quick Action: Save to Watchlist */}
        {onSaveToWatchlist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSaveToWatchlist(ad.id);
            }}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-black/60 backdrop-blur-md text-slate-300 hover:text-white hover:bg-black/80 transition-all cursor-pointer"
            title="Save to Watchlist"
            aria-label="Save to Watchlist"
          >
            <BookmarkPlus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content & Metadata */}
      <div
        className="p-3.5 flex-1 flex flex-col justify-between cursor-pointer"
        onClick={() => onSelect(ad)}
      >
        <div>
          {/* Advertiser & Launch Age */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span
              className="text-xs font-bold text-white truncate max-w-[150px]"
              title={ad.advertiser?.name || "Unknown Advertiser"}
            >
              {ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN"
                ? ad.advertiser.name
                : "Unknown Advertiser"}
            </span>
            <div
              className="flex items-center gap-1 text-[11px] text-slate-400 font-mono"
              title={startAge?.full || (discoveredText ?? "Age unverified")}
            >
              <Clock className="h-3 w-3 text-slate-500 shrink-0" />
              <span className="truncate">
                {startAge ? startAge.short : discoveredText ? discoveredText : "Date unrecorded"}
              </span>
            </div>
          </div>

          {/* Headline / Copy */}
          <p className="text-xs text-slate-300 line-clamp-2 mb-2 leading-relaxed">
            {ad.headline || ad.bodyText || (
              <span className="text-slate-600 italic">No ad copy recorded</span>
            )}
          </p>

          {/* Sample media warning */}
          {hasSampleVideo && (
            <div className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-950/30 border border-amber-800/30 rounded px-1.5 py-0.5 mb-2">
              <AlertCircle className="h-2.5 w-2.5 shrink-0" />
              <span>Demo video — not real ad</span>
            </div>
          )}

          {/* Date Provenance Subline */}
          <div className="text-[10px] text-slate-500 flex items-center justify-between gap-2 mb-2">
            <span>
              {ad.sourceReportedStartAt ? (
                <>Start: {new Date(ad.sourceReportedStartAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
              ) : (
                <span className="italic">Start date unrecorded</span>
              )}
            </span>
            {discoveredText && (
              <span className="text-slate-500 truncate">{discoveredText}</span>
            )}
          </div>
        </div>

        <div>
          {/* Category & IDs & Status */}
          <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
            {ad.platform === "META" && ad.externalAdId && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30 truncate max-w-[150px]"
                title={`Meta Library ID: ${ad.externalAdId}`}
              >
                FB ID: {ad.externalAdId}
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {ad.category || "General"}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                ad.status === "ACTIVE"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : ad.status === "INACTIVE"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-slate-800 text-slate-500 border-slate-700"
              }`}
            >
              {ad.status || "UNKNOWN"}
            </span>
          </div>

          {/* Research Score & Provenance Link */}
          <div className="pt-2 border-t border-[#1f293d] flex items-center justify-between">
            {/* Score Pill — labeled clearly as Research Priority */}
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-bold ${getScoreBadgeClass(
                totalScore
              )}`}
              title="Research Priority indicator based on evidence quality and persistence. Not a guarantee of profitability."
            >
              <Flame className="h-3.5 w-3.5 fill-current" />
              <span>{totalScore !== null ? `${totalScore}/100` : "N/A"}</span>
              <span className="text-[9px] font-normal text-slate-400 ml-0.5 hidden sm:inline">Priority</span>
            </div>

            {/* Clickable Original Link */}
            <a
              href={ad.originalAdUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-400 transition-colors"
              title={ad.platform === "META" ? "Open on Meta Ad Library" : "Inspect original source record"}
            >
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span>{ad.platform === "META" ? "Meta Library" : "Source"}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
