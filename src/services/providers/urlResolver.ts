import { URL } from "url";
import { AdPlatform, AdSourceResolution } from "@/types";
import { validateExternalResourceUrl } from "@/lib/security";
import { parseAndValidateTikTokUrl } from "@/services/tiktok/tiktokUrlParser";

/**
 * Resolves, validates, and extracts platform metadata from advertisement links.
 */
export function resolveAdSourceUrl(rawUrl: string): AdSourceResolution {
  const securityCheck = validateExternalResourceUrl(rawUrl);
  if (!securityCheck.isValid || !securityCheck.sanitizedUrl) {
    return {
      platform: "OTHER",
      canonicalUrl: rawUrl,
      originalUrl: rawUrl,
      isValid: false,
      notes: securityCheck.reason || "Invalid URL",
    };
  }

  const parsed = new URL(securityCheck.sanitizedUrl);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // Clean tracking query params
  const cleanParams = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (
      !key.startsWith("utm_") &&
      !["fbclid", "gclid", "ttclid", "ref_src", "referral"].includes(key.toLowerCase())
    ) {
      cleanParams.set(key, value);
    }
  }

  // 1. Meta / Facebook Ad Library
  if (
    host.includes("facebook.com") ||
    host.includes("meta.com") ||
    host.includes("instagram.com")
  ) {
    // e.g. facebook.com/ads/library/?id=123456789
    const adId = cleanParams.get("id") || cleanParams.get("ad_id") || undefined;
    parsed.search = cleanParams.toString();

    return {
      platform: "META",
      canonicalUrl: parsed.toString(),
      originalUrl: rawUrl,
      externalId: adId,
      isValid: true,
      notes: adId ? `Meta Ad Archive ID: ${adId}` : "Meta platform URL identified",
    };
  }

  // 2. TikTok Creative Center or TikTok Ad
  if (
    host.includes("tiktok.com") ||
    host.includes("ads.tiktok.com")
  ) {
    const ttResult = parseAndValidateTikTokUrl(rawUrl);
    if (!ttResult.isValid) {
      return {
        platform: "TIKTOK",
        canonicalUrl: rawUrl,
        originalUrl: rawUrl,
        isValid: false,
        notes: ttResult.reason,
      };
    }

    return {
      platform: "TIKTOK",
      canonicalUrl: ttResult.canonicalUrl,
      originalUrl: rawUrl,
      externalId: ttResult.externalId || undefined,
      extractedAdId: ttResult.externalId || undefined,
      sourceType: ttResult.sourceType,
      isCreativeCenter: ttResult.sourceType === "TIKTOK_CREATIVE_CENTER",
      region: ttResult.regionParam || undefined,
      targetRegion: ttResult.regionParam || undefined,
      searchWindowPeriodDays: ttResult.searchWindowPeriodDays,
      isEmbeddable: ttResult.isEmbeddable,
      embedUrl: ttResult.embedUrl,
      authorUsername: ttResult.authorUsername || undefined,
      isValid: true,
      resolved: true,
      notes: ttResult.reason,
    };
  }

  // 3. Other ecommerce landing page or link
  parsed.search = cleanParams.toString();
  return {
    platform: "OTHER",
    canonicalUrl: parsed.toString(),
    originalUrl: rawUrl,
    isValid: true,
    notes: "Generic ecommerce or landing page source",
  };
}
