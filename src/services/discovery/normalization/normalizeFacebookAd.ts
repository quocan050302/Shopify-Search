/**
 * SWAI — Meta (Facebook) Ad Library Normalization Utilities
 *
 * Provides shared URL validation, canonical public Facebook Ad Library URLs,
 * and advertiser attribution helpers for Meta discovery providers.
 */

import { NormalizedDiscoveredAd } from "../types";
import {
  normalizeMetaCollectorAd,
  META_COLLECTOR_PROVIDER_ID,
  MetaCollectorRawAd,
  MetaResearchContext,
} from "./normalizeMetaCollectorAd";

/**
 * Validates external HTTP/HTTPS URLs against SSRF and illegal schemes.
 */
export function isSafeHttpUrl(urlStr: unknown): boolean {
  if (typeof urlStr !== "string") return false;
  const trimmed = urlStr.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "169.254.169.254" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the canonical public Meta Ad Library URL for an ad Library ID.
 */
export function buildFacebookAdLibraryUrl(libraryId: string): string {
  const cleanId = String(libraryId).trim();
  return `https://www.facebook.com/ads/library/?id=${cleanId}`;
}

/**
 * Resolves advertiser identity without merging unrelated unknown advertisers.
 */
export function resolveFacebookAdvertiser(
  rawName?: string | null,
  rawPageId?: string | null
): { name: string; externalId: string | null } {
  const cleanName = typeof rawName === "string" ? rawName.trim().slice(0, 200) : "";
  const cleanPageId = typeof rawPageId === "string" ? rawPageId.trim().slice(0, 100) : "";

  if (cleanName && cleanName.toUpperCase() !== "UNKNOWN") {
    return { name: cleanName, externalId: cleanPageId || null };
  }
  if (cleanPageId) {
    return { name: `Facebook Page ${cleanPageId}`, externalId: cleanPageId };
  }
  return { name: "Facebook Advertiser (Unattributed)", externalId: null };
}

/**
 * Transparent confidence calculation based on actual verifiable source evidence.
 */
export function calculateMetaEvidenceConfidence(params: {
  isLibraryIdValid: boolean;
  hasAdvertiserPageId: boolean;
  hasAdvertiserName: boolean;
  hasValidStartDate: boolean;
  hasActiveStatus: boolean;
  hasCopy: boolean;
  hasValidLandingPage: boolean;
}): number {
  if (!params.isLibraryIdValid) return 0.0;

  let score = 0.65; // Base confidence for valid Library ID format
  if (params.hasAdvertiserPageId && params.hasAdvertiserName) score += 0.10;
  if (params.hasValidStartDate) score += 0.10;
  if (params.hasActiveStatus) score += 0.05;
  if (params.hasCopy) score += 0.05;
  if (params.hasValidLandingPage) score += 0.05;

  return Math.min(0.95, Math.max(0.60, Math.round(score * 100) / 100));
}

/**
 * Alias for normalizeMetaCollectorAd for backward compatibility.
 */
export function normalizeFacebookAd(
  raw: MetaCollectorRawAd,
  context: MetaResearchContext = {}
): NormalizedDiscoveredAd {
  return normalizeMetaCollectorAd(raw, context);
}

export { normalizeMetaCollectorAd, META_COLLECTOR_PROVIDER_ID };
