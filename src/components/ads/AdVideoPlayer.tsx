"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play,
  ExternalLink,
  AlertCircle,
  VideoOff,
  Film,
  Loader2,
  Volume2,
  VolumeX,
  RefreshCw,
} from "lucide-react";
import {
  resolveVideoSource,
  isSampleOrFakeMedia,
  isStockImage,
  type VideoSourceResult,
} from "@/services/video/videoSourceResolver";

interface AdVideoPlayerProps {
  mediaType?: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  videoUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  originalAdUrl?: string | null;
  externalAdId?: string | null;
  platform: string;
  aspectRatio?: string;
  autoplay?: boolean;
  status?: string;
}

type PlayerPhase = "IDLE" | "LOADING" | "PLAYING" | "ERROR";

function getPlatformLabel(platform: string) {
  if (platform === "META") return "Meta Ad Library";
  if (platform === "TIKTOK") return "TikTok";
  return platform;
}

// ─── Error / Unavailable Panel ────────────────────────────────────────────────

function UnavailablePanel({
  resolution,
  aspectClass,
  platform,
  onRetry,
}: {
  resolution: VideoSourceResult;
  aspectClass: string;
  platform: string;
  onRetry?: () => void;
}) {
  const label = getPlatformLabel(platform);

  const restrictionMsg: Record<string, string> = {
    META_RENDER_AD_REQUIRES_AUTH:
      "Meta Ad Library requires an authenticated Meta account. Click below to open the source.",
    TIKTOK_TOPADS_NOT_EMBEDDABLE:
      "TikTok Creative Center Top Ads are not embeddable. Click below to view the original ad.",
    SAMPLE_MEDIA_REJECTED:
      "Stored video is a Google demonstration file — not the real advertisement creative.",
    SYNTHETIC_SOURCE:
      "This is a demonstration record. The advertising ID is fictional.",
    PLATFORM_EMBED_RESTRICTED:
      "This platform restricts embedding. Open the source link to view.",
    NO_VIDEO_SOURCE:
      "No video source is available for this advertisement record.",
    EXPIRED_OR_UNAVAILABLE:
      "This media has expired or is no longer available from the platform CDN.",
  };

  const msg =
    resolution.restriction
      ? restrictionMsg[resolution.restriction] || resolution.reason
      : resolution.reason;

  return (
    <div
      className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center`}
    >
      <VideoOff className="h-7 w-7 text-amber-500 mb-2" />
      <p className="text-[11px] font-semibold text-slate-300 mb-1">
        {resolution.restriction === "SAMPLE_MEDIA_REJECTED"
          ? "Demo Video — Not Real Ad"
          : resolution.restriction === "SYNTHETIC_SOURCE"
          ? "Demonstration Record"
          : "Media Unavailable Inline"}
      </p>
      <p className="text-[10px] text-slate-500 mb-3 max-w-xs leading-relaxed">{msg}</p>

      <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
        {resolution.sourceUrl && (
          <a
            href={resolution.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium hover:bg-indigo-600/30 transition-colors"
          >
            <span>Open on {label}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {onRetry && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded-md bg-slate-800 text-slate-400 text-[10px] hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            <span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── TikTok oEmbed Player ─────────────────────────────────────────────────────

function TikTokOEmbedPlayer({
  playbackUrl,
  sourceUrl,
  aspectClass,
}: {
  playbackUrl: string;
  sourceUrl?: string;
  aspectClass: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center`}
      >
        <VideoOff className="h-7 w-7 text-amber-500 mb-2" />
        <p className="text-[11px] text-slate-300 mb-2">TikTok embed failed to load</p>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium"
          >
            <span>Open on TikTok</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}>
      <iframe
        src={playbackUrl}
        title="TikTok Video"
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin allow-top-navigation"
        onError={() => setFailed(true)}
      />
      <div className="absolute bottom-1.5 right-1.5">
        <a
          href={sourceUrl || playbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-slate-300 hover:text-white transition-colors"
        >
          <ExternalLink className="h-2 w-2" />
          <span>TikTok</span>
        </a>
      </div>
    </div>
  );
}

// ─── Direct Video Player (HTML5) ──────────────────────────────────────────────

function DirectVideoPlayer({
  playbackUrl,
  sourceUrl,
  thumbnailUrl,
  aspectClass,
  autoplay,
}: {
  playbackUrl: string;
  sourceUrl?: string;
  thumbnailUrl?: string | null;
  aspectClass: string;
  autoplay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const validThumb = thumbnailUrl && !isStockImage(thumbnailUrl) ? thumbnailUrl : undefined;

  if (errMsg) {
    return (
      <div
        className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center`}
      >
        <VideoOff className="h-7 w-7 text-amber-500 mb-2" />
        <p className="text-[11px] text-slate-300 mb-1">Video Playback Failed</p>
        <p className="text-[10px] text-slate-500 mb-2">{errMsg}</p>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium"
          >
            <span>Open Source</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}>
      <video
        ref={videoRef}
        src={playbackUrl}
        poster={validThumb}
        controls
        autoPlay={autoplay}
        playsInline
        muted={muted}
        onError={() => {
          setErrMsg("Video stream failed to load. The URL may have expired or be access-restricted.");
        }}
        className="w-full h-full object-cover"
      />
      <button
        onClick={() => setMuted((m) => !m)}
        className="absolute top-2 left-2 p-1 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors"
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ─── Idle Thumbnail / Image Creative State ─────────────────────────────────────

function IdleThumbnail({
  resolution,
  thumbnailUrl,
  aspectClass,
  platform,
  mediaType,
  onPlay,
}: {
  resolution: VideoSourceResult;
  thumbnailUrl?: string | null;
  aspectClass: string;
  platform: string;
  mediaType?: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  onPlay: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const validThumb = thumbnailUrl && !isStockImage(thumbnailUrl) && !imageError ? thumbnailUrl : null;

  const isImageOrCarousel = mediaType === "IMAGE" || mediaType === "CAROUSEL";
  const canPlayInline =
    !isImageOrCarousel &&
    (resolution.strategy === "TIKTOK_OEMBED" || resolution.strategy === "DIRECT_VIDEO");

  const isUnavailable =
    !canPlayInline &&
    (resolution.strategy === "OPEN_SOURCE" || resolution.strategy === "UNAVAILABLE");

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canPlayInline) {
      onPlay();
    } else if (resolution.sourceUrl) {
      window.open(resolution.sourceUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`relative w-full ${aspectClass} bg-slate-900 rounded-lg overflow-hidden border border-slate-800 group cursor-pointer transition-all`}
    >
      {/* Thumbnail or Creative Image */}
      {validThumb ? (
        <img
          src={validThumb}
          alt="Ad creative preview"
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-3 text-center gap-1.5">
          <Film className="h-7 w-7 text-slate-700" />
          <span className="text-[10px] font-medium text-slate-500">
            {imageError ? "Media Unavailable" : "No preview available"}
          </span>
          {resolution.sourceUrl && (
            <span className="text-[9px] text-indigo-400 hover:underline">
              Inspect on {getPlatformLabel(platform)}
            </span>
          )}
        </div>
      )}

      {/* Stock image badge */}
      {thumbnailUrl && isStockImage(thumbnailUrl) && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-900/90 px-2 py-0.5 text-[9px] text-amber-300 text-center">
          Stock image — not actual ad
        </div>
      )}

      {/* Overlay */}
      {validThumb && (
        <div className="absolute inset-0 bg-slate-950/20 group-hover:bg-slate-950/5 transition-colors" />
      )}

      {/* Play Icon (Video only) vs External Link / Creative Badge */}
      {validThumb && !isImageOrCarousel && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {canPlayInline ? (
            <div className="h-10 w-10 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-indigo-500 transition-all">
              <Play className="h-4 w-4 ml-0.5 fill-current" />
            </div>
          ) : (
            <div className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center shadow-md group-hover:scale-110 group-hover:bg-black/80 transition-all">
              <ExternalLink className="h-4 w-4 text-slate-200" />
            </div>
          )}
        </div>
      )}

      {/* Format badge in top-right */}
      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[9px] font-semibold text-white uppercase border border-white/10 flex items-center gap-1 pointer-events-none">
        {mediaType === "IMAGE"
          ? "IMAGE"
          : mediaType === "CAROUSEL"
          ? "CAROUSEL"
          : mediaType === "VIDEO"
          ? "VIDEO"
          : platform}
      </div>

      {/* Open on source badge in bottom-left */}
      {validThumb && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[9px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="h-2.5 w-2.5" />
          <span>{getPlatformLabel(platform)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main AdVideoPlayer Component ────────────────────────────────────────────

export function AdVideoPlayer({
  mediaType = "UNKNOWN",
  videoUrl,
  embedUrl,
  thumbnailUrl,
  originalAdUrl,
  externalAdId,
  platform,
  aspectRatio,
  autoplay = false,
  status,
}: AdVideoPlayerProps) {
  const [phase, setPhase] = useState<PlayerPhase>(autoplay ? "PLAYING" : "IDLE");

  // Determine aspect ratio class honestly (Phase 7, Item 82)
  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
      ? "aspect-video"
      : aspectRatio === "4:5"
      ? "aspect-[4/5]"
      : aspectRatio === "9:16"
      ? "aspect-[9/16]"
      : mediaType === "IMAGE"
      ? "aspect-square"
      : "aspect-[4/5]";

  const resolution = resolveVideoSource({
    platform,
    originalAdUrl,
    externalAdId,
    status,
    mediaAssets: [{ videoUrl, embedUrl, thumbnailUrl }],
  });

  if (phase === "IDLE") {
    return (
      <IdleThumbnail
        resolution={resolution}
        thumbnailUrl={thumbnailUrl}
        aspectClass={aspectClass}
        platform={platform}
        mediaType={mediaType}
        onPlay={() => setPhase("PLAYING")}
      />
    );
  }

  if (phase === "PLAYING") {
    // TikTok oEmbed
    if (resolution.strategy === "TIKTOK_OEMBED" && resolution.playbackUrl) {
      return (
        <TikTokOEmbedPlayer
          playbackUrl={resolution.playbackUrl}
          sourceUrl={resolution.sourceUrl}
          aspectClass={aspectClass}
        />
      );
    }

    // Direct HTML5 video
    if (resolution.strategy === "DIRECT_VIDEO" && resolution.playbackUrl) {
      return (
        <DirectVideoPlayer
          playbackUrl={resolution.playbackUrl}
          sourceUrl={resolution.sourceUrl}
          thumbnailUrl={thumbnailUrl}
          aspectClass={aspectClass}
          autoplay={autoplay}
        />
      );
    }

    // All other strategies — show unavailable panel
    return (
      <UnavailablePanel
        resolution={resolution}
        aspectClass={aspectClass}
        platform={platform}
        onRetry={() => setPhase("IDLE")}
      />
    );
  }

  return null;
}
