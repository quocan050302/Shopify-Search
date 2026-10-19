"use client";

import { useState } from "react";
import { Play, ExternalLink, AlertCircle } from "lucide-react";

interface AdVideoPlayerProps {
  videoUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  originalAdUrl: string;
  platform: string;
  aspectRatio?: string;
  autoplay?: boolean;
}

export function AdVideoPlayer({
  videoUrl,
  embedUrl,
  thumbnailUrl,
  originalAdUrl,
  platform,
  aspectRatio = "9:16",
  autoplay = false,
}: AdVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [hasError, setHasError] = useState(false);

  // Check aspect ratio styling
  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
      ? "aspect-video"
      : "aspect-[9/16]";

  if (hasError) {
    return (
      <div
        className={`w-full ${aspectClass} bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center p-4 text-center text-slate-400`}
      >
        <AlertCircle className="h-8 w-8 text-amber-500 mb-2" />
        <p className="text-xs font-medium text-slate-300 mb-1">
          Direct Video Stream Restricted
        </p>
        <p className="text-[11px] text-slate-500 mb-3 max-w-xs">
          The advertising platform requires authenticated viewer session.
        </p>
        <a
          href={originalAdUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
        >
          <span>Open on {platform === "META" ? "Meta Ad Library" : "TikTok"}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  // Active Playback State
  if (isPlaying) {
    if (videoUrl) {
      return (
        <div className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}>
          <video
            src={videoUrl}
            controls
            autoPlay
            playsInline
            onError={() => setHasError(true)}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    if (embedUrl) {
      return (
        <div className={`relative w-full ${aspectClass} bg-black rounded-lg overflow-hidden border border-slate-800`}>
          <iframe
            src={embedUrl}
            title="Ad Creative Embed"
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-popups"
            onError={() => setHasError(true)}
          />
        </div>
      );
    }
  }

  // Thumbnail with Play Overlay
  return (
    <div
      onClick={() => setIsPlaying(true)}
      className={`relative w-full ${aspectClass} bg-slate-900 rounded-lg overflow-hidden border border-slate-800 group cursor-pointer`}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt="Ad Creative Thumbnail"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-600">
          No Thumbnail
        </div>
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-slate-950/30 group-hover:bg-slate-950/20 transition-colors" />

      {/* Play Button Icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-12 w-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-indigo-500 transition-all">
          <Play className="h-5 w-5 ml-0.5 fill-current" />
        </div>
      </div>

      {/* Platform Attribution Tag */}
      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-semibold text-white tracking-wide border border-white/10 uppercase">
        {platform}
      </div>
    </div>
  );
}
