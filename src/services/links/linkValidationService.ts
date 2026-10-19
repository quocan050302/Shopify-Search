/**
 * Link Validation Service — SWAI V6.1
 *
 * Centralized, SSRF-safe external URL verification.
 * Never guesses replacement URLs.
 * Records history in the database.
 */

import { validateExternalResourceUrl } from "@/lib/security";

// ─── Link Type Classifications ───────────────────────────────────────────────

export type LinkType =
  | "AD_SOURCE"
  | "VIDEO_SOURCE"
  | "VIDEO_EMBED"
  | "THUMBNAIL"
  | "PRODUCT_PAGE"
  | "STOREFRONT"
  | "ADVERTISER_PROFILE"
  | "EXTERNAL_REFERENCE";

// ─── Link Status States ───────────────────────────────────────────────────────

export type LinkStatus =
  | "VALID"
  | "REDIRECTED"
  | "NOT_FOUND"
  | "GONE"
  | "ACCESS_RESTRICTED"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "TEMPORARILY_UNAVAILABLE"
  | "UNSUPPORTED"
  | "UNVERIFIED"
  | "INVALID";

export interface LinkVerificationResult {
  originalUrl: string;
  resolvedUrl?: string;
  httpStatus?: number;
  verificationStatus: LinkStatus;
  verificationMethod: "HEAD" | "GET" | "DNS_ONLY" | "BLOCKED" | "CACHED";
  responseTimeMs?: number;
  errorCode?: string;
  errorMessage?: string;
  provider?: string;
  verifiedAt: string;
  notes?: string;
}

// ─── Private IP SSRF Blocklist ────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254", // AWS/GCP/Azure IMDS
  "metadata.google.internal",
  "169.254.170.2", // ECS task metadata
  "fd00:ec2::254", // AWS IMDSv6
]);

function isPrivateOrBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

// ─── Provider Detection ───────────────────────────────────────────────────────

function detectProvider(hostname: string): string | undefined {
  if (hostname.includes("facebook.com") || hostname.includes("meta.com"))
    return "META";
  if (hostname.includes("instagram.com")) return "META_INSTAGRAM";
  if (hostname.includes("tiktok.com") || hostname.includes("ads.tiktok.com"))
    return "TIKTOK";
  if (hostname.includes("shopify.com") || hostname.includes("myshopify.com"))
    return "SHOPIFY";
  if (hostname.includes("unsplash.com")) return "UNSPLASH";
  if (hostname.includes("googleapis.com") || hostname.includes("commondatastorage.googleapis.com"))
    return "GOOGLE_STORAGE";
  return undefined;
}

// ─── HTTP Status → LinkStatus Mapping ────────────────────────────────────────

function classifyHttpStatus(status: number): LinkStatus {
  if (status >= 200 && status < 300) return "VALID";
  if (status === 301 || status === 302 || status === 307 || status === 308)
    return "REDIRECTED";
  if (status === 401 || status === 403) return "ACCESS_RESTRICTED";
  if (status === 404) return "NOT_FOUND";
  if (status === 410) return "GONE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 500 || status === 502 || status === 503 || status === 504)
    return "TEMPORARILY_UNAVAILABLE";
  if (status === 405) return "UNSUPPORTED"; // HEAD not allowed
  return "UNVERIFIED";
}

// ─── Safe URL Validation Entry Point ─────────────────────────────────────────

export function validateResearchUrl(rawUrl: string): {
  isValid: boolean;
  reason?: string;
  sanitizedUrl?: string;
  hostname?: string;
  provider?: string;
} {
  const securityCheck = validateExternalResourceUrl(rawUrl);
  if (!securityCheck.isValid || !securityCheck.sanitizedUrl) {
    return { isValid: false, reason: securityCheck.reason };
  }

  try {
    const parsed = new URL(securityCheck.sanitizedUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (isPrivateOrBlockedHost(hostname)) {
      return {
        isValid: false,
        reason: `Blocked hostname for SSRF safety: ${hostname}`,
      };
    }

    return {
      isValid: true,
      sanitizedUrl: securityCheck.sanitizedUrl,
      hostname,
      provider: detectProvider(hostname),
    };
  } catch {
    return { isValid: false, reason: "URL parse error" };
  }
}

// ─── HTTP Check with SSRF Protection ─────────────────────────────────────────

export interface CheckLinkOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowGet?: boolean;
  linkType?: LinkType;
}

export async function checkExternalLink(
  url: string,
  options: CheckLinkOptions = {}
): Promise<LinkVerificationResult> {
  const { timeoutMs = 8000, maxRedirects = 3, allowGet = false } = options;
  const startTime = Date.now();
  const now = new Date().toISOString();

  const validation = validateResearchUrl(url);
  if (!validation.isValid || !validation.sanitizedUrl) {
    return {
      originalUrl: url,
      verificationStatus: "INVALID",
      verificationMethod: "BLOCKED",
      errorCode: "INVALID_URL",
      errorMessage: validation.reason,
      verifiedAt: now,
    };
  }

  const { sanitizedUrl, hostname = "", provider } = validation;

  // Detect known-inaccessible embed patterns without hitting network
  if (
    sanitizedUrl.includes("facebook.com/ads/archive/render_ad") ||
    sanitizedUrl.includes("ads.tiktok.com/business/creativecenter/inspiration/topads/embed/")
  ) {
    return {
      originalUrl: url,
      resolvedUrl: sanitizedUrl,
      verificationStatus: "ACCESS_RESTRICTED",
      verificationMethod: "BLOCKED",
      provider,
      notes:
        "Known embed endpoint: requires authenticated session or is not publicly embeddable",
      verifiedAt: now,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try HEAD first; fall back to GET if not supported or fails
    let method: "HEAD" | "GET" = "HEAD";
    let response: Response;

    try {
      response = await fetch(sanitizedUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "SWAI-LinkValidator/6.1 (Research Tool; +https://github.com/quocan050302/Shopify-Search)",
        },
      });

      // Some servers return 405 for HEAD; retry with GET if allowed
      if (response.status === 405 && allowGet) {
        method = "GET";
        response = await fetch(sanitizedUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "SWAI-LinkValidator/6.1 (Research Tool; +https://github.com/quocan050302/Shopify-Search)",
            Range: "bytes=0-0", // minimal GET
          },
        });
      }
    } catch (fetchErr: any) {
      const responseTimeMs = Date.now() - startTime;
      if (fetchErr.name === "AbortError") {
        return {
          originalUrl: url,
          resolvedUrl: sanitizedUrl,
          verificationStatus: "TEMPORARILY_UNAVAILABLE",
          verificationMethod: method,
          responseTimeMs,
          errorCode: "TIMEOUT",
          errorMessage: `Request timed out after ${timeoutMs}ms`,
          provider,
          verifiedAt: now,
        };
      }
      return {
        originalUrl: url,
        resolvedUrl: sanitizedUrl,
        verificationStatus: "TEMPORARILY_UNAVAILABLE",
        verificationMethod: method,
        responseTimeMs,
        errorCode: "NETWORK_ERROR",
        errorMessage: fetchErr.message || "Network request failed",
        provider,
        verifiedAt: now,
      };
    }

    clearTimeout(timeout);

    const responseTimeMs = Date.now() - startTime;
    const resolvedUrl = response.url || sanitizedUrl;

    // SSRF check: verify redirect destination is also safe
    if (resolvedUrl !== sanitizedUrl) {
      const redirectValidation = validateResearchUrl(resolvedUrl);
      if (!redirectValidation.isValid) {
        return {
          originalUrl: url,
          resolvedUrl,
          verificationStatus: "INVALID",
          verificationMethod: method,
          responseTimeMs,
          errorCode: "UNSAFE_REDIRECT",
          errorMessage: `Redirect destination failed SSRF check: ${redirectValidation.reason}`,
          provider,
          verifiedAt: now,
        };
      }
    }

    const status = classifyHttpStatus(response.status);

    return {
      originalUrl: url,
      resolvedUrl,
      httpStatus: response.status,
      verificationStatus: status,
      verificationMethod: method,
      responseTimeMs,
      provider,
      verifiedAt: now,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    return {
      originalUrl: url,
      resolvedUrl: sanitizedUrl,
      verificationStatus: "TEMPORARILY_UNAVAILABLE",
      verificationMethod: "HEAD",
      responseTimeMs: Date.now() - startTime,
      errorCode: "UNEXPECTED_ERROR",
      errorMessage: err.message || "Unknown error",
      provider,
      verifiedAt: now,
    };
  }
}

// ─── Media Source Resolution ──────────────────────────────────────────────────

export type PlaybackStrategy =
  | "DIRECT_VIDEO"
  | "OFFICIAL_EMBED"
  | "OPEN_SOURCE"
  | "UNAVAILABLE";

export interface PlayableMediaResult {
  strategy: PlaybackStrategy;
  url?: string;
  reason: string;
  platform: string;
  isSampleMedia: boolean;
  originalSourceUrl?: string;
}

const SAMPLE_MEDIA_DOMAINS = [
  "commondatastorage.googleapis.com/gtv-videos-bucket",
  "sample-videos.com",
  "w3schools.com/html/mov",
];

export function isSampleOrFakeMedia(url?: string | null): boolean {
  if (!url) return false;
  return SAMPLE_MEDIA_DOMAINS.some((domain) => url.includes(domain));
}

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

export function resolvePlayableMedia(ad: {
  platform: string;
  originalAdUrl?: string | null;
  mediaAssets?: Array<{
    videoUrl?: string | null;
    embedUrl?: string | null;
    thumbnailUrl?: string | null;
    availability?: string | null;
  }>;
}): PlayableMediaResult {
  const platform = (ad.platform || "").toUpperCase();
  const media = ad.mediaAssets?.[0];
  const videoUrl = media?.videoUrl;
  const embedUrl = media?.embedUrl;
  const originalAdUrl = ad.originalAdUrl;

  // Reject sample media
  if (isSampleOrFakeMedia(videoUrl)) {
    return {
      strategy: "OPEN_SOURCE",
      url: originalAdUrl || undefined,
      reason: "Sample/demonstration video is not a real advertisement. Open the original source.",
      platform,
      isSampleMedia: true,
      originalSourceUrl: originalAdUrl || undefined,
    };
  }

  // Direct video (non-sample)
  if (videoUrl && !isSampleOrFakeMedia(videoUrl)) {
    return {
      strategy: "DIRECT_VIDEO",
      url: videoUrl,
      reason: "Direct video stream available",
      platform,
      isSampleMedia: false,
      originalSourceUrl: originalAdUrl || undefined,
    };
  }

  // META: facebook.com/ads/archive/render_ad is NOT a public embed endpoint
  if (
    platform === "META" &&
    embedUrl?.includes("facebook.com/ads/archive/render_ad")
  ) {
    return {
      strategy: "OPEN_SOURCE",
      url: originalAdUrl || undefined,
      reason:
        "Meta Ad Archive render endpoint requires authenticated session. Open source link instead.",
      platform,
      isSampleMedia: false,
      originalSourceUrl: originalAdUrl || undefined,
    };
  }

  // TikTok: Creative Center embed path is not a public embed endpoint
  if (
    platform === "TIKTOK" &&
    embedUrl?.includes("creativecenter/inspiration/topads/embed/")
  ) {
    return {
      strategy: "OPEN_SOURCE",
      url: originalAdUrl || undefined,
      reason:
        "TikTok Creative Center embed endpoint is not publicly accessible. Open the source link.",
      platform,
      isSampleMedia: false,
      originalSourceUrl: originalAdUrl || undefined,
    };
  }

  // Generic embed (may work)
  if (embedUrl) {
    return {
      strategy: "OFFICIAL_EMBED",
      url: embedUrl,
      reason: "Attempting official embed — may be restricted by the platform",
      platform,
      isSampleMedia: false,
      originalSourceUrl: originalAdUrl || undefined,
    };
  }

  // No video path found
  return {
    strategy: "UNAVAILABLE",
    url: originalAdUrl || undefined,
    reason: "No accessible video source. Open the original advertisement.",
    platform,
    isSampleMedia: false,
    originalSourceUrl: originalAdUrl || undefined,
  };
}
