/**
 * TikTok URL Parsing & Validation Service — SWAI V7.3
 *
 * Implements strict parsing and validation for genuine TikTok source links:
 * 1. Validates hostnames against genuine TikTok domains (rejects phishing/spoofs).
 * 2. Distinguishes TikTok Creative Center Top Ads from official organic/ad post links.
 * 3. Enforces that Creative Center Top Ads are NOT embeddable inline.
 * 4. Generates official TikTok player/v1 URLs for genuine post links.
 * 5. CRITICAL (Rule 12): Extracts search window parameter (e.g. period=180) without
 *    ever claiming 180 days of continuous ad activity.
 */

import crypto from "crypto";
import { URL } from "url";
import { validateExternalResourceUrl } from "@/lib/security";

export type TikTokSourceType =
  | "TIKTOK_CREATIVE_CENTER"
  | "TIKTOK_SEARCH_PAGE"
  | "TIKTOK_POST"
  | "TIKTOK_LIBRARY"
  | "INVALID";

export interface TikTokUrlParseResult {
  isValid: boolean;
  isTikTok: boolean;
  platform: "TIKTOK";
  sourceType: TikTokSourceType;
  sourceSubtype?: string;
  isCreativeCenter: boolean;
  isSearchPage?: boolean;
  creativeId?: string | null;
  postId?: string | null;
  externalId: string | null;
  authorUsername?: string | null;
  authorHandle?: string | null;
  regionParam?: string | null;
  targetRegion?: string | null;
  /**
   * Filter search window period from Creative Center query (e.g. 7, 30, 180).
   * NOTE: This indicates the search filtering window, NOT the ad's run duration.
   */
  searchWindowPeriodDays?: number | null;
  isSearchWindowOnly: boolean;
  searchWindowNotice?: string;
  searchWindowWarning?: string;
  isEmbeddable: boolean;
  embedUrl?: string | null;
  canonicalUrl: string;
  originalUrl: string;
  reason: string;
}

const ALLOWED_TIKTOK_HOSTS = new Set([
  "ads.tiktok.com",
  "www.tiktok.com",
  "tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "library.tiktok.com",
]);

/**
 * Checks whether a hostname belongs strictly to the authentic TikTok platform.
 * Rejects domain spoofing like 'tiktok.com.attacker.com' or 'fake-tiktok.com'.
 */
export function isAuthenticTikTokHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (ALLOWED_TIKTOK_HOSTS.has(lower)) return true;

  // Check subdomains of tiktok.com
  if (lower.endsWith(".tiktok.com")) {
    const parts = lower.split(".");
    // Ensure the last two segments are strictly ['tiktok', 'com']
    if (parts.length >= 3 && parts[parts.length - 2] === "tiktok" && parts[parts.length - 1] === "com") {
      return true;
    }
  }

  return false;
}

/**
 * Builds official TikTok embed player URL for genuine TikTok posts.
 */
export function buildTikTokPlayerUrl(postId: string, options?: { withParams?: boolean }): string | null {
  if (!postId || !/^\d+$/.test(postId)) return null;
  if (options?.withParams) {
    return `https://www.tiktok.com/player/v1/${postId}?autoplay=0&controls=1&loop=0&rel=0`;
  }
  return `https://www.tiktok.com/player/v1/${postId}`;
}

/**
 * Canonicalizes a TikTok advertisement URL by retaining only identity and region parameters,
 * stripping extraneous tracking and session tags.
 */
export function canonicalizeTikTokDiscoveryUrl(rawUrl: string): string {
  try {
    const sec = validateExternalResourceUrl(rawUrl.trim());
    if (!sec.isValid || !sec.sanitizedUrl) return rawUrl.trim();
    const parsed = new URL(sec.sanitizedUrl);
    const cleanParams = new URLSearchParams();

    // Retain only identity-relevant and region params
    for (const [key, value] of parsed.searchParams.entries()) {
      const k = key.toLowerCase();
      if (["id", "material_id", "ad_id", "period", "region", "countrycode"].includes(k)) {
        cleanParams.set(k === "countrycode" ? "region" : k, value);
      }
    }
    parsed.search = cleanParams.toString();
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Generates a stable source identity hash for deduplication.
 */
export function generateStableSourceHash(platform: string, providerId: string, identifierOrUrl: string): string {
  const norm = `${platform.toUpperCase()}:${providerId.toLowerCase()}:${identifierOrUrl.trim()}`;
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

/**
 * Parses and validates an advertisement URL from TikTok.
 */
export function parseAndValidateTikTokUrl(rawUrl: string): TikTokUrlParseResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      isValid: false,
      isTikTok: false,
      platform: "TIKTOK",
      sourceType: "INVALID",
      isCreativeCenter: false,
      externalId: null,
      isSearchWindowOnly: false,
      isEmbeddable: false,
      canonicalUrl: "",
      originalUrl: rawUrl || "",
      reason: "URL must be a non-empty string.",
    };
  }

  // 1. SSRF and protocol security guard
  const sec = validateExternalResourceUrl(rawUrl.trim());
  if (!sec.isValid || !sec.sanitizedUrl) {
    return {
      isValid: false,
      isTikTok: false,
      platform: "TIKTOK",
      sourceType: "INVALID",
      isCreativeCenter: false,
      externalId: null,
      isSearchWindowOnly: false,
      isEmbeddable: false,
      canonicalUrl: rawUrl,
      originalUrl: rawUrl,
      reason: sec.reason || "Invalid URL format or restricted host.",
    };
  }

  try {
    const parsed = new URL(sec.sanitizedUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // 2. Validate genuine TikTok domain
    if (!isAuthenticTikTokHostname(host)) {
      return {
        isValid: false,
        isTikTok: false,
        platform: "TIKTOK",
        sourceType: "INVALID",
        isCreativeCenter: false,
        externalId: null,
        isSearchWindowOnly: false,
        isEmbeddable: false,
        canonicalUrl: rawUrl,
        originalUrl: rawUrl,
        reason: `Host '${host}' is not a genuine TikTok domain.`,
      };
    }

    // Clean tracking query params
    const cleanParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const k = key.toLowerCase();
      if (!k.startsWith("utm_") && !["ttclid", "fbclid", "gclid", "ref", "referral"].includes(k)) {
        cleanParams.set(key, value);
      }
    }

    // ── CASE A: TikTok Creative Center Top Ads ─────────────────────────────
    if (
      host === "ads.tiktok.com" &&
      (pathname.includes("/creativecenter/inspiration/topads") ||
        pathname.includes("/creativecenter/topads") ||
        pathname.includes("/inspiration/popular/video"))
    ) {
      // Support path-based ID e.g. /creativecenter/topads/7680863927458562066/pc/en
      const pathMatch = pathname.match(/\/topads\/(\d+)/i) || pathname.match(/\/detail\/(\d+)/i);
      const pathAdId = pathMatch ? pathMatch[1] : null;

      const adId =
        pathAdId ||
        cleanParams.get("id") ||
        cleanParams.get("material_id") ||
        cleanParams.get("ad_id") ||
        null;

      const region = cleanParams.get("region")?.toUpperCase() || cleanParams.get("countrycode")?.toUpperCase() || null;
      const periodStr = cleanParams.get("period");
      const periodDays = periodStr ? parseInt(periodStr, 10) : null;

      parsed.search = cleanParams.toString();

      const warningNotice = periodDays
        ? `URL specified search filter period=${periodDays}d. This ${periodDays}-day search window reflects the search filter on TikTok Creative Center, and does NOT verify ${periodDays} days of active ad delivery.`
        : undefined;

      // Distinguish search page from specific ad detail
      if (!adId) {
        return {
          isValid: true,
          isTikTok: true,
          platform: "TIKTOK",
          sourceType: "TIKTOK_SEARCH_PAGE",
          sourceSubtype: "TIKTOK_SEARCH_PAGE",
          isCreativeCenter: true,
          isSearchPage: true,
          creativeId: null,
          externalId: null,
          regionParam: region,
          targetRegion: region,
          searchWindowPeriodDays: !isNaN(periodDays as number) ? periodDays : null,
          isSearchWindowOnly: true,
          searchWindowNotice: warningNotice,
          searchWindowWarning: warningNotice,
          isEmbeddable: false,
          embedUrl: null,
          canonicalUrl: parsed.toString(),
          originalUrl: rawUrl,
          reason:
            "TikTok Creative Center Top Ads search index page. Contains filter criteria but does not reference an individual ad material ID.",
        };
      }

      return {
        isValid: true,
        isTikTok: true,
        platform: "TIKTOK",
        sourceType: "TIKTOK_CREATIVE_CENTER",
        isCreativeCenter: true,
        isSearchPage: false,
        creativeId: adId,
        externalId: adId,
        regionParam: region,
        targetRegion: region,
        searchWindowPeriodDays: !isNaN(periodDays as number) ? periodDays : null,
        isSearchWindowOnly: true,
        searchWindowNotice: warningNotice,
        searchWindowWarning: warningNotice,
        // Rule 8: Creative Center Top Ads are NOT embeddable
        isEmbeddable: false,
        embedUrl: null,
        canonicalUrl: parsed.toString(),
        originalUrl: rawUrl,
        reason:
          "TikTok Creative Center Top Ads link identified. Creative Center detail pages cannot be embedded in third-party iframes per TikTok platform policy.",
      };
    }

    // ── CASE B: TikTok Library (EU DSA Transparency) ─────────────────────────
    if (host === "library.tiktok.com") {
      const adId = cleanParams.get("ad_id") || cleanParams.get("id") || null;
      parsed.search = cleanParams.toString();

      return {
        isValid: true,
        isTikTok: true,
        platform: "TIKTOK",
        sourceType: "TIKTOK_LIBRARY",
        isCreativeCenter: false,
        externalId: adId,
        isSearchWindowOnly: false,
        isEmbeddable: false,
        embedUrl: null,
        canonicalUrl: parsed.toString(),
        originalUrl: rawUrl,
        reason: "TikTok Commercial Content Library link identified (EU DSA compliance archive).",
      };
    }

    // ── CASE C: Genuine TikTok Post (Video Permalink) ───────────────────────
    // Matches: /@username/video/1234567890123456789 or /v/1234567890123456789
    const postMatch = pathname.match(/(?:@([^/]+)\/video\/|(?:\/v\/))(\d+)/i);
    if (postMatch) {
      const authorUsername = postMatch[1] || null;
      const postId = postMatch[2];

      parsed.search = cleanParams.toString();

      // Rule 7: Genuine TikTok post IDs are embeddable via official player/v1
      return {
        isValid: true,
        isTikTok: true,
        platform: "TIKTOK",
        sourceType: "TIKTOK_POST",
        isCreativeCenter: false,
        postId,
        externalId: postId,
        authorUsername,
        authorHandle: authorUsername,
        isSearchWindowOnly: false,
        isEmbeddable: true,
        embedUrl: buildTikTokPlayerUrl(postId),
        canonicalUrl: parsed.toString(),
        originalUrl: rawUrl,
        reason: `Authentic TikTok post ID ${postId} identified. Embeddable via official TikTok player/v1.`,
      };
    }

    // ── CASE D: Shortlinks (vm.tiktok.com or vt.tiktok.com) ───────────────────
    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
      parsed.search = cleanParams.toString();
      return {
        isValid: true,
        isTikTok: true,
        platform: "TIKTOK",
        sourceType: "TIKTOK_POST",
        isCreativeCenter: false,
        externalId: null, // requires HTTP resolution in production to get numeric ID
        isSearchWindowOnly: false,
        isEmbeddable: false,
        embedUrl: null,
        canonicalUrl: parsed.toString(),
        originalUrl: rawUrl,
        reason: "TikTok shortlink detected. Open in browser or resolve redirect to inspect post ID.",
      };
    }

    // ── CASE E: Other TikTok URL ────────────────────────────────────────────
    parsed.search = cleanParams.toString();
    const fallbackId = cleanParams.get("id") || cleanParams.get("material_id") || null;
    return {
      isValid: true,
      isTikTok: true,
      platform: "TIKTOK",
      sourceType: "TIKTOK_CREATIVE_CENTER",
      isCreativeCenter: true,
      creativeId: fallbackId,
      externalId: fallbackId,
      isSearchWindowOnly: false,
      isEmbeddable: false,
      embedUrl: null,
      canonicalUrl: parsed.toString(),
      originalUrl: rawUrl,
      reason: "TikTok platform link identified.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed URL structure";
    return {
      isValid: false,
      isTikTok: false,
      platform: "TIKTOK",
      sourceType: "INVALID",
      isCreativeCenter: false,
      externalId: null,
      isSearchWindowOnly: false,
      isEmbeddable: false,
      canonicalUrl: rawUrl,
      originalUrl: rawUrl,
      reason: msg,
    };
  }
}
