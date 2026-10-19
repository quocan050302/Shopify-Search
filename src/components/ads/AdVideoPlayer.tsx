"use client";

import { useState } from "react";
import { Play, ExternalLink, AlertCircle, VideoOff, Film } from "lucide-react";
import {
  resolvePlayableMedia,
  isSampleOrFakeMedia,
  isStockImage,
} from "@/services/links/linkValidationService";

interface AdVideoPlayerProps {
  videoUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  originalAdUrl: string;
  platform: string;
  aspectRatio?: string;
  autoplay?: boolean;
}

type PlayerState = "IDLE" | "PLAYING" | "ERROR" | "UNAVAILABLE";

export function AdVideoPlayer({
  videoUrl,
  embedUrl,
  thumbnailUrl,
  originalAdUrl,
  platform,
  aspectRatio = "9:16",
  autoplay = false,
}: AdVideoPlayerProps) {
  const [playerState, setPlayerState] = useState<PlayerState>(
    autoplay ? "PLAYING" : "IDLE"
  );
  const [errorMessage, setErrorMessage] = useState<string>("");

  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
      ? "aspect-video"
      : "aspect-[9/16]";

  // Resolve what playback strategy is available
  const mediaResolution = resolvePlayableMedia({
    platform,
    originalAdUrl,
    mediaAssets: [{ videoUrl, embedUrl, thumbnailUrl }],
  });

  // Determine if the thumbnail is valid (not a stock image, not null)
  const validThumbnail =
    thumbnailUrl && !isStockImage(thumbnailUrl) ? thumbnailUrl : null;

  const isSample = isSampleOrFakeMedia(videoUrl);

  // ── Error / Unavailable State ──────────────────────────────────────────────
  if (playerState === "ERROR" || playerState === "UNAVAILABLE") {
    const platformLabel =
      platform === "META" ? "Meta Ad Library" : platform === "TIKTOK" ? "TikTok" : platform;

    return (
      <div
        className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center text-slate-400`}
      >
        <VideoOff className="h-8 w-8 text-amber-500 mb-2" />
        <p className="text-xs font-medium text-slate-300 mb-1">
          {playerState === "ERROR"
            ? "Video Playback Failed"
            : "Video Unavailable In-App"}
        </p>
        <p className="text-[11px] text-slate-500 mb-3 max-w-xs leading-relaxed">
          {errorMessage ||
            mediaResolution.reason ||
            "This video cannot be played inline. Open the source link to view the original creative."}
        </p>
        {(originalAdUrl || mediaResolution.originalSourceUrl) && (
          <a
            href={mediaResolution.originalSourceUrl || originalAdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
          >
            <span>
              Open on {platformLabel}
            </span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  // ── Active Playback State ──────────────────────────────────────────────────
  if (playerState === "PLAYING") {
    const strategy = mediaResolution.strategy;

    // Sample media: refuse to play — redirect to open source
    if (mediaResolution.isSampleMedia) {
      return (
        <div
          className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-amber-700/40 flex flex-col items-center justify-center p-4 text-center`}
        >
          <Film className="h-8 w-8 text-amber-400 mb-2" />
          <p className="text-xs font-medium text-amber-300 mb-1">
            Sample Video Detected
          </p>
          <p className="text-[11px] text-slate-500 mb-3 max-w-xs leading-relaxed">
            This record contains a demonstration video, not the actual
            advertisement. Open the original source to view the real creative.
          </p>
          {originalAdUrl && (
            <a
              href={originalAdUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600/20 text-amber-400 border border-amber-500/30 text-xs font-medium hover:bg-amber-600/30 transition-colors"
            >
              <span>Open Original Source</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      );
    }

    // DIRECT_VIDEO strategy — HTML5 player
    if (strategy === "DIRECT_VIDEO" && mediaResolution.url) {
      return (
        <div
          className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}
        >
          <video
            src={mediaResolution.url}
            controls
            autoPlay
            playsInline
            onError={(e) => {
              setErrorMessage("Video stream failed to load. The URL may be expired or restricted.");
              setPlayerState("ERROR");
            }}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    // OFFICIAL_EMBED strategy — iframe (may still fail silently)
    if (strategy === "OFFICIAL_EMBED" && mediaResolution.url) {
      return (
        <div
          className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}
        >
          <iframe
            src={mediaResolution.url}
            title="Ad Creative Embed"
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-popups"
            onError={() => {
              setErrorMessage(
                "Embed failed to load. The platform may restrict embedding."
              );
              setPlayerState("ERROR");
            }}
          />
          {/* Note: iframe onError is unreliable — add a visible fallback button */}
          <div className="absolute bottom-2 right-2">
            <a
              href={originalAdUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/70 text-[10px] text-slate-300 hover:text-white transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              <span>Open source</span>
            </a>
          </div>
        </div>
      );
    }

    // OPEN_SOURCE or UNAVAILABLE — show message + external link
    return (
      <div
        className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center text-slate-400`}
      >
        <VideoOff className="h-8 w-8 text-amber-500 mb-2" />
        <p className="text-xs font-medium text-slate-300 mb-1">
          Video Unavailable In-App
        </p>
        <p className="text-[11px] text-slate-500 mb-3 max-w-xs leading-relaxed">
          {mediaResolution.reason}
        </p>
        {(mediaResolution.url || originalAdUrl) && (
          <a
            href={mediaResolution.url || originalAdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
          >
            <span>Open Original Video</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  // ── Idle / Thumbnail State ─────────────────────────────────────────────────

  const canPlay =
    mediaResolution.strategy === "DIRECT_VIDEO" ||
    mediaResolution.strategy === "OFFICIAL_EMBED";

  const playUnavailable =
    mediaResolution.strategy === "OPEN_SOURCE" ||
    mediaResolution.strategy === "UNAVAILABLE" ||
    mediaResolution.isSampleMedia;

  return (
    <div
      onClick={() => {
        if (playUnavailable) {
          // Open source directly instead of attempting inline playback
          if (originalAdUrl) {
            window.open(originalAdUrl, "_blank", "noopener,noreferrer");
          }
        } else {
          setPlayerState("PLAYING");
        }
      }}
      className={`relative w-full ${aspectClass} bg-slate-900 rounded-lg overflow-hidden border border-slate-800 group cursor-pointer`}
    >
      {/* Thumbnail */}
      {validThumbnail ? (
        <img
          src={validThumbnail}
          alt="Ad Creative Thumbnail"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-600 gap-1">
          <Film className="h-8 w-8" />
          <span className="text-[10px] text-slate-600">No verified thumbnail</span>
        </div>
      )}

      {/* Stock image warning overlay */}
      {thumbnailUrl && isStockImage(thumbnailUrl) && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-900/80 px-2 py-0.5 text-[9px] text-amber-300 text-center">
          Stock image — not actual ad creative
        </div>
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-slate-950/30 group-hover:bg-slate-950/20 transition-colors" />

      {/* Play Button / External Link Icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        {playUnavailable ? (
          <div className="h-12 w-12 rounded-full bg-slate-700/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-slate-600 transition-all">
            <ExternalLink className="h-5 w-5" />
          </div>
        ) : (
          <div className="h-12 w-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-indigo-500 transition-all">
            <Play className="h-5 w-5 ml-0.5 fill-current" />
          </div>
        )}
      </div>

      {/* Media availability notice for unavailable sources */}
      {playUnavailable && (
        <div className="absolute top-2 left-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-900/80 backdrop-blur-sm text-[9px] font-medium text-amber-300 border border-amber-700/30">
          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
          <span>Opens on {platform === "META" ? "Meta Ad Library" : "TikTok"}</span>
        </div>
      )}

      {/* Sample media badge */}
      {isSample && (
        <div className="absolute top-7 left-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/80 text-[9px] font-medium text-red-300 border border-red-700/30">
          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
          <span>Demo video — not real ad</span>
        </div>
      )}

      {/* Platform Attribution Tag */}
      <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-semibold text-white tracking-wide border border-white/10 uppercase">
        {platform}
      </div>
    </div>
  );
}
