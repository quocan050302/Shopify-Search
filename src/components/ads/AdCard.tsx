"use client";

import { ExternalLink, Flame, Clock, ShieldCheck, BookmarkPlus, AlertCircle } from "lucide-react";
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

  // Score badge style
  const getScoreBadgeClass = (s: number | null) => {
    if (s === null) return "bg-slate-800 text-slate-400 border-slate-700";
    if (s >= 75) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    if (s >= 50) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return "bg-slate-800 text-slate-400 border-slate-700";
  };

  // Safe age label calculation (Rule 267: Never display malformed "d active")
  const renderAgeLabel = () => {
    if (typeof ad.calendarAgeDays === "number" && ad.calendarAgeDays > 0) {
      return `${ad.calendarAgeDays}d observed`;
    }
    if (ad.sourceReportedStartAt) {
      try {
        const dateStr = new Date(ad.sourceReportedStartAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        return `From ${dateStr}`;
      } catch {}
    }
    return "Age unverified";
  };

  return (
    <div className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden hover:border-slate-700 transition-all flex flex-col group shadow-sm hover:shadow-md">
      {/* Video Container */}
      <div className="relative p-2.5 pb-0">
        <AdVideoPlayer
          videoUrl={media?.videoUrl}
          embedUrl={media?.embedUrl}
          thumbnailUrl={media?.thumbnailUrl}
          originalAdUrl={ad.originalAdUrl}
          externalAdId={ad.externalAdId}
          platform={ad.platform}
          status={ad.status}
          aspectRatio="9:16"
        />

        {/* Floating Quick Action: Save to Watchlist */}
        {onSaveToWatchlist && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSaveToWatchlist(ad.id);
            }}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-black/60 backdrop-blur-md text-slate-300 hover:text-white hover:bg-black/80 transition-all cursor-pointer"
            title="Save to Watchlist"
          >
            <BookmarkPlus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content & Metadata */}
      <div className="p-3.5 flex-1 flex flex-col justify-between" onClick={() => onSelect(ad)}>
        <div>
          {/* Advertiser & Days Running */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold text-white truncate max-w-[140px]">
              {ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN"
                ? ad.advertiser.name
                : "Unknown Advertiser"}
            </span>
            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
              <Clock className="h-3 w-3 text-slate-500" />
              <span>{renderAgeLabel()}</span>
            </div>
          </div>

          {/* Headline / Copy */}
          <p className="text-xs text-slate-300 line-clamp-2 mb-3 leading-relaxed">
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
        </div>

        <div>
          {/* Category & Status */}
          <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
            {ad.platform === "META" && ad.externalAdId && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
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
            {/* Score Pill */}
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-bold ${getScoreBadgeClass(
                totalScore
              )}`}
            >
              <Flame className="h-3.5 w-3.5 fill-current" />
              <span>{totalScore !== null ? `${totalScore}/100` : "N/A"}</span>
            </div>

            {/* Clickable Original Link */}
            <a
              href={ad.originalAdUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-400 transition-colors"
              title="Inspect original source record"
            >
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span>Source</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
