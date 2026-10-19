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
      "This video has been removed or is no longer available.",
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
          : "Video Not Available Inline"}
      </p>
      <p className="text-[10px] text-slate-500 mb-3 max-w-xs leading-relaxed">{msg}</p>

      <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
        {resolution.sourceUrl && (
          <a
            href={resolution.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium hover:bg-indigo-600/30 transition-colors"
          >
            <span>Open on {label}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
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
      {/* Reliable external fallback — iframe onError is unreliable in browsers */}
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
      {/* Mute toggle */}
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

// ─── Idle Thumbnail / Preview State ──────────────────────────────────────────

function IdleThumbnail({
  resolution,
  thumbnailUrl,
  aspectClass,
  platform,
  onPlay,
}: {
  resolution: VideoSourceResult;
  thumbnailUrl?: string | null;
  aspectClass: string;
  platform: string;
  onPlay: () => void;
}) {
  const validThumb = thumbnailUrl && !isStockImage(thumbnailUrl) ? thumbnailUrl : null;
  const canPlayInline =
    resolution.strategy === "TIKTOK_OEMBED" ||
    resolution.strategy === "DIRECT_VIDEO";

  const isUnavailable =
    resolution.strategy === "OPEN_SOURCE" ||
    resolution.strategy === "UNAVAILABLE";

  const handleClick = () => {
    if (isUnavailable && resolution.sourceUrl) {
      window.open(resolution.sourceUrl, "_blank", "noopener,noreferrer");
    } else if (canPlayInline) {
      onPlay();
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`relative w-full ${aspectClass} bg-slate-900 rounded-lg overflow-hidden border border-slate-800 group cursor-pointer`}
    >
      {/* Thumbnail */}
      {validThumb ? (
        <img
          src={validThumb}
          alt="Ad creative thumbnail"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 gap-1">
          <Film className="h-8 w-8 text-slate-700" />
          <span className="text-[9px] text-slate-600">No thumbnail</span>
        </div>
      )}

      {/* Stock image badge */}
      {thumbnailUrl && isStockImage(thumbnailUrl) && (
        <div className="absolute inset-x-0 bottom-0 bg-amber-900/90 px-2 py-0.5 text-[9px] text-amber-300 text-center">
          Stock image — not actual ad
        </div>
      )}

      {/* Overlay */}
      <div className="absolute inset-0 bg-slate-950/30 group-hover:bg-slate-950/10 transition-colors" />

      {/* Play / External button */}
      <div className="absolute inset-0 flex items-center justify-center">
        {canPlayInline ? (
          <div className="h-12 w-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-indigo-500 transition-all">
            <Play className="h-5 w-5 ml-0.5 fill-current" />
          </div>
        ) : (
          <div className="h-12 w-12 rounded-full bg-slate-700/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-slate-600 transition-all">
            <ExternalLink className="h-4 w-4" />
          </div>
        )}
      </div>

      {/* Restriction notice */}
      {isUnavailable && (
        <div className="absolute top-2 inset-x-2 flex items-center gap-1 px-2 py-0.5 rounded bg-amber-900/80 backdrop-blur-sm text-[9px] font-medium text-amber-300 border border-amber-700/30">
          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            {resolution.restriction === "META_RENDER_AD_REQUIRES_AUTH"
              ? "Opens on Meta Ad Library"
              : resolution.restriction === "TIKTOK_TOPADS_NOT_EMBEDDABLE"
              ? "Opens on TikTok Creative Center"
              : resolution.restriction === "SYNTHETIC_SOURCE"
              ? "Demo record"
              : resolution.restriction === "SAMPLE_MEDIA_REJECTED"
              ? "Demo video — not real ad"
              : `Opens on ${getPlatformLabel(platform)}`}
          </span>
        </div>
      )}

      {/* Strategy badge */}
      {canPlayInline && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-semibold text-white uppercase border border-white/10">
          {resolution.strategy === "TIKTOK_OEMBED" ? "TIKTOK" : platform}
        </div>
      )}
    </div>
  );
}

// ─── Main AdVideoPlayer Component ────────────────────────────────────────────

export function AdVideoPlayer({
  videoUrl,
  embedUrl,
  thumbnailUrl,
  originalAdUrl,
  externalAdId,
  platform,
  aspectRatio = "9:16",
  autoplay = false,
  status,
}: AdVideoPlayerProps) {
  const [phase, setPhase] = useState<PlayerPhase>(autoplay ? "PLAYING" : "IDLE");

  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
      ? "aspect-video"
      : "aspect-[9/16]";

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
