/**
 * TikTok Embed Service — SWAI V7.1
 *
 * Implements official TikTok embed support for real TikTok post URLs.
 *
 * KEY DISTINCTIONS:
 * - TikTok POST URLs (www.tiktok.com/@user/video/ID): embeddable via player/v1
 * - TikTok Creative Center Top Ads (ads.tiktok.com/creativecenter/...): NOT embeddable
 * - TikTok Commercial Content API IDs: different format, EU-only, NOT post IDs
 *
 * OFFICIAL EMBED ENDPOINT:
 * https://www.tiktok.com/player/v1/{postId}
 * Documented: https://developers.tiktok.com/doc/embed-videos
 *
 * OEMBED METADATA ENDPOINT:
 * https://www.tiktok.com/oembed?url=https://www.tiktok.com/@user/video/{id}
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TikTokPostIdExtraction {
  postId: string | null;
  sourceType: "TIKTOK_POST" | "TIKTOK_CREATIVE_CENTER" | "TIKTOK_SHORT_URL" | "UNKNOWN";
  reason: string;
}

export interface TikTokEmbedMetadata {
  postId: string;
  embedUrl: string;          // https://www.tiktok.com/player/v1/{postId}
  sourceUrl: string;          // Original TikTok post URL
  authorName?: string;
  authorUrl?: string;
  title?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  providerName: "TikTok";
  providerUrl: "https://www.tiktok.com";
  // Validation
  metadataVerified: boolean;
  verificationMethod: "OEMBED_API" | "URL_PATTERN_ONLY";
  verificationNote: string;
}

export interface TikTokEmbedMetadataResult {
  success: boolean;
  data?: TikTokEmbedMetadata;
  error?: {
    code: "POST_NOT_FOUND" | "POST_REMOVED" | "ACCESS_RESTRICTED" | "INVALID_URL" |
          "NOT_A_TIKTOK_POST" | "CREATIVE_CENTER_NOT_EMBEDDABLE" | "NETWORK_ERROR";
    message: string;
  };
}

export interface TikTokPlayerSourceResult {
  strategy: "TIKTOK_OEMBED" | "OPEN_SOURCE" | "UNAVAILABLE";
  playerUrl?: string;          // https://www.tiktok.com/player/v1/{postId}
  sourceUrl?: string;
  postId?: string;
  metadata?: TikTokEmbedMetadata;
  reason: string;
  restriction?: string;
}

// ─── URL Pattern Analysis ─────────────────────────────────────────────────────

/**
 * Identifies the type and post ID from any TikTok-related URL.
 *
 * TikTok post URL forms:
 * - https://www.tiktok.com/@username/video/7123456789012345678
 * - https://tiktok.com/@username/video/7123456789012345678
 * - https://vm.tiktok.com/AbCdEf/ (short URL — needs redirect follow)
 *
 * Creative Center forms (NOT embeddable):
 * - https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7123456789
 * - https://library.tiktok.com/ads?...
 *
 * NOT embeddable (Commercial Content API format):
 * - Creative Center IDs in URL params (material_id, id params on ads.tiktok.com)
 */
export function extractTikTokPostIdFromUrl(url: string): TikTokPostIdExtraction {
  if (!url) {
    return { postId: null, sourceType: "UNKNOWN", reason: "Empty URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { postId: null, sourceType: "UNKNOWN", reason: "Invalid URL format" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;

  // ── TikTok Creative Center / Ads Manager — NOT embeddable ──────────────
  if (host === "ads.tiktok.com" || host === "library.tiktok.com") {
    return {
      postId: null,
      sourceType: "TIKTOK_CREATIVE_CENTER",
      reason:
        "TikTok Creative Center and Ads Library URLs are NOT embeddable. " +
        "These are ad metadata pages, not TikTok post URLs. " +
        "To embed a TikTok ad, you need the organic TikTok post URL (tiktok.com/@user/video/ID).",
    };
  }

  // ── Short TikTok URL (vm.tiktok.com) ────────────────────────────────────
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return {
      postId: null,
      sourceType: "TIKTOK_SHORT_URL",
      reason:
        "Short TikTok URL (vm.tiktok.com) cannot be embedded directly. " +
        "Resolve the redirect first to get the full post URL with a numeric ID. " +
        "SWAI does not automatically follow redirects for short URLs.",
    };
  }

  // ── Standard TikTok post URL ─────────────────────────────────────────────
  if (host === "tiktok.com") {
    // Pattern: /@username/video/DIGIT_ID
    const videoMatch = path.match(/\/@[^/]+\/video\/(\d{10,30})/);
    if (videoMatch && videoMatch[1]) {
      return {
        postId: videoMatch[1],
        sourceType: "TIKTOK_POST",
        reason: `TikTok post ID ${videoMatch[1]} extracted from URL path.`,
      };
    }

    // Pattern: /video/DIGIT_ID (without @username)
    const directMatch = path.match(/\/video\/(\d{10,30})/);
    if (directMatch && directMatch[1]) {
      return {
        postId: directMatch[1],
        sourceType: "TIKTOK_POST",
        reason: `TikTok post ID ${directMatch[1]} extracted from short video path.`,
      };
    }

    return {
      postId: null,
      sourceType: "UNKNOWN",
      reason: "TikTok URL recognized but no numeric post ID found in path. Expected format: tiktok.com/@username/video/ID",
    };
  }

  return {
    postId: null,
    sourceType: "UNKNOWN",
    reason: `URL host "${host}" is not a recognized TikTok domain.`,
  };
}

// ─── oEmbed Metadata Fetch ────────────────────────────────────────────────────

/**
 * TikTok oEmbed response shape (official API).
 * Ref: https://www.tiktok.com/oembed?url=...
 */
interface TikTokOEmbedResponse {
  version: string;
  type: string;
  title?: string;
  author_url?: string;
  author_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  provider_name: string;
  provider_url: string;
  html?: string;
  // Non-standard extensions TikTok may include
  video_id?: string;
}

/**
 * Fetches TikTok oEmbed metadata for a given TikTok post URL.
 *
 * Uses the official TikTok oEmbed endpoint to verify the post exists
 * and retrieve metadata. Only works with real, public TikTok post URLs.
 *
 * Will return an error if the post is removed, private, or inaccessible.
 */
export async function getTikTokEmbedMetadata(
  postUrl: string,
  timeoutMs = 8000
): Promise<TikTokEmbedMetadataResult> {
  // Extract the post ID first
  const extraction = extractTikTokPostIdFromUrl(postUrl);

  if (extraction.sourceType === "TIKTOK_CREATIVE_CENTER") {
    return {
      success: false,
      error: {
        code: "CREATIVE_CENTER_NOT_EMBEDDABLE",
        message: extraction.reason,
      },
    };
  }

  if (extraction.sourceType === "TIKTOK_SHORT_URL") {
    return {
      success: false,
      error: {
        code: "INVALID_URL",
        message: extraction.reason,
      },
    };
  }

  if (!extraction.postId) {
    return {
      success: false,
      error: {
        code: "NOT_A_TIKTOK_POST",
        message: extraction.reason || "Could not extract a TikTok post ID from this URL.",
      },
    };
  }

  const postId = extraction.postId;
  const oEmbedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`;

  // Fetch oEmbed metadata to verify the post exists
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(oEmbedUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SWAI-Research-Tool/7.1 (research-only; not a bot)",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (response.status === 404) {
      return {
        success: false,
        error: {
          code: "POST_NOT_FOUND",
          message: "TikTok post not found (404). The video may have been deleted or the URL is incorrect.",
        },
      };
    }

    if (response.status === 403 || response.status === 401) {
      return {
        success: false,
        error: {
          code: "ACCESS_RESTRICTED",
          message: "TikTok post is private, restricted, or requires authentication.",
        },
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: `TikTok oEmbed returned status ${response.status}. Post may be unavailable.`,
        },
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json") && !contentType.includes("text/json")) {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: `Unexpected response type from TikTok oEmbed: ${contentType}`,
        },
      };
    }

    const data: TikTokOEmbedResponse = await response.json();

    const embedUrl = buildTikTokPlayerUrl(postId);

    return {
      success: true,
      data: {
        postId,
        embedUrl,
        sourceUrl: postUrl,
        authorName: data.author_name,
        authorUrl: data.author_url,
        title: data.title,
        thumbnailUrl: data.thumbnail_url,
        thumbnailWidth: data.thumbnail_width,
        thumbnailHeight: data.thumbnail_height,
        providerName: "TikTok",
        providerUrl: "https://www.tiktok.com",
        metadataVerified: true,
        verificationMethod: "OEMBED_API",
        verificationNote:
          `Post verified via TikTok oEmbed API at ${new Date().toISOString()}. ` +
          `Author: ${data.author_name || "unknown"}.`,
      },
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return {
        success: false,
        error: {
          code: "NETWORK_ERROR",
          message: `TikTok oEmbed request timed out after ${timeoutMs}ms. The post may exist but the API is unreachable.`,
        },
      };
    }
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: `Network error fetching TikTok oEmbed: ${err.message || "unknown error"}`,
      },
    };
  }
}

// ─── Player URL Builder ───────────────────────────────────────────────────────

/**
 * Builds the official TikTok player URL for embedding.
 *
 * Uses /player/v1/ format (documented):
 * https://developers.tiktok.com/doc/embed-videos
 *
 * Parameters:
 *   autoplay: 1 to autoplay (muted by default due to browser policies)
 *   loop: 0 | 1
 *   music_info: 1 to show music info panel
 *   description: 1 to show description
 *   controls: 1 to show player controls
 *   rel: 0 to not show related videos after playback
 */
export function buildTikTokPlayerUrl(
  postId: string,
  options: {
    autoplay?: boolean;
    loop?: boolean;
    controls?: boolean;
    rel?: boolean;
  } = {}
): string {
  const params = new URLSearchParams({
    autoplay: options.autoplay ? "1" : "0",
    loop: options.loop ? "1" : "0",
    controls: options.controls !== false ? "1" : "0",
    rel: options.rel ? "1" : "0",
  });
  return `https://www.tiktok.com/player/v1/${postId}?${params.toString()}`;
}

// ─── Main Resolver ────────────────────────────────────────────────────────────

/**
 * Resolves TikTok playback source for an ad URL.
 * Validates post existence via oEmbed before declaring TIKTOK_OEMBED strategy.
 *
 * If validation fails, returns OPEN_SOURCE or UNAVAILABLE with clear reason.
 */
export async function resolveTikTokPlayerSource(
  url: string,
  options: {
    validateViaOEmbed?: boolean; // Default: true — validate post exists
    timeoutMs?: number;
  } = {}
): Promise<TikTokPlayerSourceResult> {
  const validate = options.validateViaOEmbed !== false;

  const extraction = extractTikTokPostIdFromUrl(url);

  // Creative Center URL — clearly not embeddable
  if (extraction.sourceType === "TIKTOK_CREATIVE_CENTER") {
    return {
      strategy: "OPEN_SOURCE",
      sourceUrl: url,
      reason: extraction.reason,
      restriction: "TIKTOK_CREATIVE_CENTER_NOT_EMBEDDABLE",
    };
  }

  // Short URL — cannot resolve without following redirect
  if (extraction.sourceType === "TIKTOK_SHORT_URL") {
    return {
      strategy: "OPEN_SOURCE",
      sourceUrl: url,
      reason: extraction.reason,
      restriction: "SHORT_URL_REQUIRES_RESOLUTION",
    };
  }

  // Not a recognizable TikTok post URL
  if (!extraction.postId) {
    return {
      strategy: "UNAVAILABLE",
      reason: extraction.reason,
    };
  }

  const postId = extraction.postId;

  // Skip oEmbed validation if caller explicitly opts out
  if (!validate) {
    const playerUrl = buildTikTokPlayerUrl(postId);
    return {
      strategy: "TIKTOK_OEMBED",
      playerUrl,
      sourceUrl: url,
      postId,
      reason: `TikTok post ID ${postId} — embedded via player/v1 (URL pattern only, oEmbed not validated).`,
    };
  }

  // Validate via oEmbed
  const metaResult = await getTikTokEmbedMetadata(url, options.timeoutMs);

  if (!metaResult.success || !metaResult.data) {
    const errCode = metaResult.error?.code;

    if (errCode === "POST_NOT_FOUND" || errCode === "POST_REMOVED") {
      return {
        strategy: "UNAVAILABLE",
        sourceUrl: url,
        postId,
        reason: metaResult.error!.message,
        restriction: "POST_REMOVED_OR_UNAVAILABLE",
      };
    }

    if (errCode === "ACCESS_RESTRICTED") {
      return {
        strategy: "OPEN_SOURCE",
        sourceUrl: url,
        postId,
        reason: metaResult.error!.message,
        restriction: "POST_ACCESS_RESTRICTED",
      };
    }

    // Network error — still attempt embed but warn caller
    const playerUrl = buildTikTokPlayerUrl(postId);
    return {
      strategy: "TIKTOK_OEMBED",
      playerUrl,
      sourceUrl: url,
      postId,
      reason:
        `TikTok post ID ${postId} — embedded via player/v1. ` +
        `oEmbed validation failed (${metaResult.error?.message}) — post existence unconfirmed.`,
    };
  }

  // Post verified and accessible
  const { data } = metaResult;
  return {
    strategy: "TIKTOK_OEMBED",
    playerUrl: data.embedUrl,
    sourceUrl: url,
    postId,
    metadata: data,
    reason:
      `TikTok post verified via oEmbed API. Author: ${data.authorName || "unknown"}. ` +
      `Embedded via player/v1/${postId}.`,
  };
}
