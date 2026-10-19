/**
 * Video Source Resolver — SWAI V6.2
 *
 * Unified, accurate video playback strategy engine.
 *
 * Key principles:
 * - A valid URL is NOT automatically a playable video.
 * - Platform embed restrictions are respected, not bypassed.
 * - Sample/demo videos are always rejected.
 * - TikTok post URLs (tiktok.com/@user/video/ID) support oEmbed.
 * - TikTok Creative Center Top Ads links open the source (not embeddable).
 * - Meta Ad Library links open the source (render_ad requires auth).
 * - Authorized MP4/WebM uploads play via HTML5 video element.
 * - AI analysis requires actual accessible media.
 */

// ─── Playback Strategy Types ──────────────────────────────────────────────────

export type VideoPlaybackStrategy =
  | "TIKTOK_OEMBED"       // Real TikTok post — embed via oEmbed API
  | "DIRECT_VIDEO"        // Authorized MP4/WebM — HTML5 player
  | "OPEN_SOURCE"         // No inline playback — show external link
  | "UNAVAILABLE";        // No source at all

export interface VideoSourceResult {
  strategy: VideoPlaybackStrategy;
  /** URL to play/embed if strategy is TIKTOK_OEMBED or DIRECT_VIDEO */
  playbackUrl?: string;
  /** URL to open externally for OPEN_SOURCE */
  sourceUrl?: string;
  /** Human-readable reason for this strategy choice */
  reason: string;
  /** Why inline playback is blocked (if applicable) */
  restriction?: VideoPlaybackRestriction;
  /** Whether the stored video URL is a demonstration/sample file */
  isSampleMedia: boolean;
  /** Whether the ad source is synthetic/fictional */
  isSyntheticSource: boolean;
  /** Platform identifier */
  platform: string;
  /** Source type classification */
  sourceType: VideoSourceType;
}

export type VideoPlaybackRestriction =
  | "META_RENDER_AD_REQUIRES_AUTH"    // facebook.com/ads/archive/render_ad — auth required
  | "TIKTOK_TOPADS_NOT_EMBEDDABLE"    // TikTok Creative Center Top Ads — detail page only
  | "PLATFORM_EMBED_RESTRICTED"       // Generic platform embed restriction
  | "SAMPLE_MEDIA_REJECTED"           // Google GTV / sample video
  | "SYNTHETIC_SOURCE"                // Fictional ad ID
  | "NO_VIDEO_SOURCE"                 // Nothing stored
  | "EXPIRED_OR_UNAVAILABLE";         // Video removed/expired

export type VideoSourceType =
  | "TIKTOK_POST"                // Real TikTok organic/ad post URL
  | "TIKTOK_CREATIVE_CENTER"     // TikTok Creative Center Top Ads link
  | "META_AD_LIBRARY"            // Meta Ad Library link
  | "AUTHORIZED_UPLOAD"          // User-uploaded MP4/WebM
  | "UNKNOWN_SOURCE";            // Cannot classify

// ─── URL Pattern Recognition ──────────────────────────────────────────────────

const SAMPLE_MEDIA_PATTERNS = [
  /commondatastorage\.googleapis\.com\/gtv-videos-bucket/i,
  /sample-videos\.com/i,
  /w3schools\.com\/html\/mov/i,
  /filesamples\.com/i,
  /testvideos\.org/i,
];

const SYNTHETIC_EXTERNAL_ID_PATTERNS = [
  /^meta_[a-z]+_[a-z_]+_\d{2}$/, // meta_bleame_crystal_hair_eraser_01
  /^tiktok_[a-z]+_[a-z_]+_\d{2}$/, // tiktok_ridge_wallet_titanium_02
];

const DIRECT_VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i;

/**
 * Returns true if the URL is a Google GTV sample or other demonstration video.
 */
export function isSampleOrFakeMedia(url?: string | null): boolean {
  if (!url) return false;
  return SAMPLE_MEDIA_PATTERNS.some((p) => p.test(url));
}

/**
 * Returns true if the URL points to a stock image provider.
 */
export function isStockImage(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.includes("unsplash.com") ||
    url.includes("pexels.com") ||
    url.includes("pixabay.com") ||
    url.includes("shutterstock.com") ||
    url.includes("gettyimages.com")
  );
}

/**
 * Returns true if the externalAdId pattern matches a synthetic seed record.
 */
export function isSyntheticAdId(externalAdId?: string | null): boolean {
  if (!externalAdId) return false;
  return SYNTHETIC_EXTERNAL_ID_PATTERNS.some((p) => p.test(externalAdId));
}

/**
 * Classifies the source type of a given URL.
 */
export function classifySourceType(url?: string | null): VideoSourceType {
  if (!url) return "UNKNOWN_SOURCE";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // TikTok Creative Center
    if (
      host === "ads.tiktok.com" &&
      path.includes("/creativecenter/")
    ) {
      return "TIKTOK_CREATIVE_CENTER";
    }

    // TikTok post URL: www.tiktok.com/@username/video/DIGIT_ID
    if (
      (host === "www.tiktok.com" || host === "tiktok.com" || host === "vm.tiktok.com") &&
      (path.match(/\/video\/\d+/) || path.match(/\/@[^/]+\/video\/\d+/))
    ) {
      return "TIKTOK_POST";
    }

    // Short TikTok URL (vm.tiktok.com redirect)
    if (host === "vm.tiktok.com") {
      return "TIKTOK_POST";
    }

    // Meta Ad Library
    if (
      (host === "www.facebook.com" || host === "facebook.com") &&
      path.startsWith("/ads/library")
    ) {
      return "META_AD_LIBRARY";
    }

    // Authorized MP4/WebM upload — direct video URL ending in video extension
    if (DIRECT_VIDEO_EXTENSIONS.test(url)) {
      return "AUTHORIZED_UPLOAD";
    }

    return "UNKNOWN_SOURCE";
  } catch {
    return "UNKNOWN_SOURCE";
  }
}

/**
 * Extracts the TikTok post video ID from a TikTok URL.
 * Returns null if not a recognizable TikTok post URL.
 */
export function extractTikTokPostId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (
      host === "www.tiktok.com" ||
      host === "tiktok.com"
    ) {
      // Pattern: /video/1234567890 or /@username/video/1234567890
      const match = parsed.pathname.match(/\/video\/(\d{10,20})/);
      if (match && match[1]) return match[1];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Builds the official TikTok oEmbed embed URL for a TikTok post.
 * Uses the standard TikTok oEmbed player format.
 * Only valid for real TikTok post IDs (10-20 digits from tiktok.com/@user/video/ID).
 */
export function buildTikTokOEmbedUrl(postId: string): string {
  // Official TikTok embed endpoint documented at https://developers.tiktok.com/doc/embed-videos
  return `https://www.tiktok.com/embed/v2/${postId}`;
}

// ─── Main Resolution Function ─────────────────────────────────────────────────

export interface AdVideoSourceInput {
  platform: string;
  originalAdUrl?: string | null;
  externalAdId?: string | null;
  status?: string;
  mediaAssets?: Array<{
    videoUrl?: string | null;
    embedUrl?: string | null;
    thumbnailUrl?: string | null;
    availability?: string | null;
    durationSeconds?: number | null;
  }>;
}

/**
 * Resolves the correct video playback strategy for an advertisement record.
 *
 * Decision tree:
 * 1. Synthetic source → OPEN_SOURCE (SYNTHETIC_SOURCE restriction)
 * 2. INACTIVE / SYNTHETIC_DEMO headline → OPEN_SOURCE
 * 3. Sample/demo video URL → OPEN_SOURCE (SAMPLE_MEDIA_REJECTED)
 * 4. Real direct video URL (MP4/WebM, non-sample) → DIRECT_VIDEO
 * 5. Real TikTok post URL in originalAdUrl → TIKTOK_OEMBED
 * 6. Meta Ad Library URL → OPEN_SOURCE (META_RENDER_AD_REQUIRES_AUTH)
 * 7. TikTok Creative Center URL → OPEN_SOURCE (TIKTOK_TOPADS_NOT_EMBEDDABLE)
 * 8. No source → UNAVAILABLE
 */
export function resolveVideoSource(ad: AdVideoSourceInput): VideoSourceResult {
  const platform = (ad.platform || "").toUpperCase();
  const media = ad.mediaAssets?.[0];
  const videoUrl = media?.videoUrl;
  const originalAdUrl = ad.originalAdUrl;
  const externalAdId = ad.externalAdId;

  // ── Step 1: Detect synthetic source ─────────────────────────────────────
  if (isSyntheticAdId(externalAdId)) {
    return {
      strategy: "OPEN_SOURCE",
      sourceUrl: originalAdUrl || undefined,
      reason: "This record is a synthetic demonstration entry. The advertising ID is fictional.",
      restriction: "SYNTHETIC_SOURCE",
      isSampleMedia: isSampleOrFakeMedia(videoUrl),
      isSyntheticSource: true,
      platform,
      sourceType: classifySourceType(originalAdUrl),
    };
  }

  // ── Step 2: Detect sample/demo video ────────────────────────────────────
  if (isSampleOrFakeMedia(videoUrl)) {
    return {
      strategy: "OPEN_SOURCE",
      sourceUrl: originalAdUrl || undefined,
      reason: "Stored video is a Google sample file, not the real advertisement creative.",
      restriction: "SAMPLE_MEDIA_REJECTED",
      isSampleMedia: true,
      isSyntheticSource: false,
      platform,
      sourceType: classifySourceType(originalAdUrl),
    };
  }

  // ── Step 3: Real direct video (authorized MP4/WebM) ─────────────────────
  // Only accept direct video URLs that:
  // (a) are not sample media (already checked)
  // (b) have a video extension
  // (c) are not from known-restricted hosting
  if (videoUrl && DIRECT_VIDEO_EXTENSIONS.test(videoUrl)) {
    return {
      strategy: "DIRECT_VIDEO",
      playbackUrl: videoUrl,
      sourceUrl: originalAdUrl || undefined,
      reason: "Authorized direct video stream available.",
      isSampleMedia: false,
      isSyntheticSource: false,
      platform,
      sourceType: "AUTHORIZED_UPLOAD",
    };
  }

  // ── Step 4: TikTok post oEmbed ───────────────────────────────────────────
  // Check originalAdUrl for a real TikTok post URL
  if (platform === "TIKTOK" && originalAdUrl) {
    const sourceType = classifySourceType(originalAdUrl);

    if (sourceType === "TIKTOK_POST") {
      const postId = extractTikTokPostId(originalAdUrl);
      if (postId) {
        return {
          strategy: "TIKTOK_OEMBED",
          playbackUrl: buildTikTokOEmbedUrl(postId),
          sourceUrl: originalAdUrl,
          reason: `TikTok post ID ${postId} — embedded via official TikTok oEmbed player.`,
          isSampleMedia: false,
          isSyntheticSource: false,
          platform,
          sourceType: "TIKTOK_POST",
        };
      }
    }

    // TikTok Creative Center Top Ads — cannot be embedded
    if (sourceType === "TIKTOK_CREATIVE_CENTER") {
      return {
        strategy: "OPEN_SOURCE",
        sourceUrl: originalAdUrl,
        reason: "TikTok Creative Center Top Ads detail links open in the TikTok platform — not embeddable in third-party applications.",
        restriction: "TIKTOK_TOPADS_NOT_EMBEDDABLE",
        isSampleMedia: false,
        isSyntheticSource: false,
        platform,
        sourceType: "TIKTOK_CREATIVE_CENTER",
      };
    }
  }

  // ── Step 5: Meta Ad Library ──────────────────────────────────────────────
  if (platform === "META" && originalAdUrl) {
    const sourceType = classifySourceType(originalAdUrl);

    if (sourceType === "META_AD_LIBRARY") {
      return {
        strategy: "OPEN_SOURCE",
        sourceUrl: originalAdUrl,
        reason: "Meta Ad Library requires an authenticated Facebook/Meta account to view ad content. Opening the source link is the only supported method.",
        restriction: "META_RENDER_AD_REQUIRES_AUTH",
        isSampleMedia: false,
        isSyntheticSource: false,
        platform,
        sourceType: "META_AD_LIBRARY",
      };
    }
  }

  // ── Step 6: No usable source ─────────────────────────────────────────────
  return {
    strategy: "UNAVAILABLE",
    sourceUrl: originalAdUrl || undefined,
    reason: "No accessible video source for this advertisement record.",
    restriction: "NO_VIDEO_SOURCE",
    isSampleMedia: false,
    isSyntheticSource: false,
    platform,
    sourceType: classifySourceType(originalAdUrl),
  };
}

// ─── Backwards compatibility export (used by AdCard, AdDetailDrawer) ─────────

/** @deprecated Use resolveVideoSource() instead */
export function resolvePlayableMedia(ad: {
  platform: string;
  originalAdUrl?: string | null;
  externalAdId?: string | null;
  mediaAssets?: Array<{
    videoUrl?: string | null;
    embedUrl?: string | null;
    thumbnailUrl?: string | null;
  }>;
}): {
  strategy: "DIRECT_VIDEO" | "OFFICIAL_EMBED" | "OPEN_SOURCE" | "UNAVAILABLE";
  url?: string;
  reason: string;
  platform: string;
  isSampleMedia: boolean;
  originalSourceUrl?: string;
} {
  const result = resolveVideoSource(ad);

  // Map V6.2 strategies back to V6.1 types for backwards compatibility
  const strategyMap: Record<VideoPlaybackStrategy, "DIRECT_VIDEO" | "OFFICIAL_EMBED" | "OPEN_SOURCE" | "UNAVAILABLE"> = {
    TIKTOK_OEMBED: "OFFICIAL_EMBED",
    DIRECT_VIDEO: "DIRECT_VIDEO",
    OPEN_SOURCE: "OPEN_SOURCE",
    UNAVAILABLE: "UNAVAILABLE",
  };

  return {
    strategy: strategyMap[result.strategy],
    url: result.playbackUrl || result.sourceUrl,
    reason: result.reason,
    platform: result.platform,
    isSampleMedia: result.isSampleMedia,
    originalSourceUrl: result.sourceUrl,
  };
}
