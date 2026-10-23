/**
 * SWAI — Meta (Facebook) Ad Library Normalizer for the Muse External-Agent Provider
 *
 * Muse (an external AI agent) researches the public Meta Ad Library with a real browser
 * and submits source-verified ad records to SWAI through the queue results API.
 *
 * Core Integrity & Provenance Principles:
 * 1. Strict numeric Meta Library ID verification (minimum 5 digits).
 *    Records without a valid Library ID are rejected — never synthesized.
 * 2. Stable identity derived deterministically: SHA256("META:muse-ad-library:<libraryId>").
 *    Cannot collide with TikTok hashes or other providers.
 * 3. Commercial Facebook Ad Library for US commercial ads publishes NO spend, impressions,
 *    ROAS, CPA, CTR, or revenue metrics. Any such fields in payloads are rejected and excluded.
 * 4. Facebook creatives are not embeddable inline in SWAI (render_ad requires auth):
 *    mediaAvailability is RESTRICTED, embedUrl is null.
 * 5. Media type is honest: "VIDEO" only when video format is confirmed, "IMAGE" for image,
 *    "CAROUSEL" for carousel, and "UNKNOWN" when unverified. Never default to VIDEO.
 * 6. Product / landing page images are kept distinct from creative screenshots.
 * 7. Safe URL validation on all external references (SSRF / invalid protocol protection).
 * 8. Evidence-based confidence scoring reflecting documented observation density.
 */

import { NormalizedDiscoveredAd, SourceEvidence } from "../types";
import { generateStableSourceHash } from "@/services/tiktok/tiktokUrlParser";
import { validateSourceReportedDates } from "./normalizeTikTokTopAd";

export const MUSE_PROVIDER_ID = "muse-ad-library";

/**
 * Raw Facebook ad record as submitted by the Muse agent after live verification
 * on the public Meta Ad Library.
 */
export interface MuseFacebookAdRecord {
  libraryId: string;
  advertiserName?: string;
  advertiserPageId?: string;
  headline?: string;
  bodyText?: string;
  callToAction?: string;
  landingPageUrl?: string;
  mediaType?: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  durationSeconds?: number;
  aspectRatio?: string;
  thumbnailUrl?: string;
  productImageUrl?: string;
  category?: string;
  sourceReportedStartAt?: string;
  sourceReportedEndAt?: string;
  activeStatus?: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  facebookPlacement?: "CONFIRMED" | "POSSIBLE" | "UNKNOWN";
  marketEvidence?: "QUERY_FILTER" | "CONFIRMED_DELIVERY" | "UNKNOWN";
  notes?: string;

  // Untrusted financial / performance claims to be rejected
  roas?: unknown;
  revenue?: unknown;
  spend?: unknown;
  cpa?: unknown;
  sales?: unknown;
  views?: unknown;
  conversions?: unknown;
}

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
 * Normalizes one Muse-submitted Facebook record into the shared discovery shape.
 * Throws when the record has no valid Library ID (caller records it as rejected).
 */
export function normalizeFacebookAd(
  record: MuseFacebookAdRecord,
  context: { queryMarket?: string; retrievedAt?: Date } = {}
): NormalizedDiscoveredAd {
  // 1. Validate Library ID
  const rawId = record && typeof record.libraryId === "string" ? record.libraryId.trim() : "";
  if (!/^\d{5,25}$/.test(rawId)) {
    throw new Error(
      `Muse Facebook record rejected: missing or invalid Meta Library ID ('${record?.libraryId}'). Must be a numeric string of at least 5 digits.`
    );
  }
  const libraryId = rawId;

  const now = context.retrievedAt || new Date();
  const canonicalUrl = buildFacebookAdLibraryUrl(libraryId);
  const stableIdentityHash = generateStableSourceHash("META", MUSE_PROVIDER_ID, libraryId);

  // 2. Resolve Advertiser
  const { name: advertiserName, externalId: advertiserExternalId } = resolveFacebookAdvertiser(
    record.advertiserName,
    record.advertiserPageId
  );

  // 3. Validate Dates
  const dateValidation = validateSourceReportedDates(
    record.sourceReportedStartAt,
    record.sourceReportedEndAt
  );

  // 4. Validate URLs safely
  const landingPageUrl = isSafeHttpUrl(record.landingPageUrl)
    ? record.landingPageUrl!.trim()
    : null;
  const thumbnailUrl = isSafeHttpUrl(record.thumbnailUrl)
    ? record.thumbnailUrl!.trim()
    : isSafeHttpUrl(record.productImageUrl)
    ? record.productImageUrl!.trim()
    : null;

  // 5. Media Type Honesty (Do NOT default to VIDEO!)
  let mediaType: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN" = "UNKNOWN";
  if (record.mediaType === "VIDEO") mediaType = "VIDEO";
  else if (record.mediaType === "IMAGE") mediaType = "IMAGE";
  else if (record.mediaType === "CAROUSEL") mediaType = "CAROUSEL";
  else if (record.mediaType === "UNKNOWN") mediaType = "UNKNOWN";

  // 6. Text Content Trimming
  const headline = typeof record.headline === "string" && record.headline.trim().length > 0
    ? record.headline.trim().slice(0, 500)
    : null;
  const bodyText = typeof record.bodyText === "string" && record.bodyText.trim().length > 0
    ? record.bodyText.trim().slice(0, 5000)
    : null;
  const callToAction = typeof record.callToAction === "string" && record.callToAction.trim().length > 0
    ? record.callToAction.trim().slice(0, 100)
    : null;

  // 7. Calculate Evidence-Based Confidence
  const confidenceScore = calculateMetaEvidenceConfidence({
    isLibraryIdValid: true,
    hasAdvertiserPageId: Boolean(advertiserExternalId),
    hasAdvertiserName: advertiserName !== "Facebook Advertiser (Unattributed)",
    hasValidStartDate: Boolean(dateValidation.startAt),
    hasActiveStatus: record.activeStatus === "ACTIVE" || record.activeStatus === "INACTIVE",
    hasCopy: Boolean(headline || bodyText),
    hasValidLandingPage: Boolean(landingPageUrl),
  });

  // 8. Compile SourceEvidence object
  const sourceEvidence: SourceEvidence = {
    sourceUrl: canonicalUrl,
    observedAt: now.toISOString(),
    observationMethod: "MUSE_BROWSER_INSPECTION",
    verifiedLibraryId: true,
    reportedStartDate: dateValidation.startAt ? dateValidation.startAt.toISOString() : null,
    reportedStatus: record.activeStatus || "UNKNOWN",
    facebookPlacement: record.facebookPlacement || "CONFIRMED",
    marketEvidence: record.marketEvidence || "QUERY_FILTER",
    notes: record.notes || null,
  };

  const targetMarket = (context.queryMarket || "US").toUpperCase();

  return {
    platform: "META",
    providerId: MUSE_PROVIDER_ID,
    mediaType,
    sourceNamespace: `META:${MUSE_PROVIDER_ID.toUpperCase()}`,
    sourceExternalId: libraryId,
    stableIdentityHash,
    advertiserName,
    advertiserExternalId,
    headline,
    bodyText,
    callToAction,
    creativeUrl: canonicalUrl,
    videoUrl: null, // Facebook Ad Library creatives cannot be played inline via raw mp4
    embedUrl: null, // Meta does not expose an unauthenticated embed player
    thumbnailUrl,
    durationSeconds:
      mediaType === "VIDEO" && typeof record.durationSeconds === "number" && record.durationSeconds > 0
        ? record.durationSeconds
        : null,
    aspectRatio: record.aspectRatio || (mediaType === "VIDEO" ? "9:16" : "1:1"),
    mediaAvailability: "RESTRICTED",
    landingPageUrl,
    targetMarket,
    marketEvidenceType: record.marketEvidence || "QUERY_FILTER",
    industry: record.category ? record.category.slice(0, 100) : null,
    objective: null,
    sourceReportedStartAt: dateValidation.startAt,
    sourceReportedEndAt: dateValidation.endAt,
    reportedMetrics: {
      rawMetricsNotice:
        "Meta Ad Library exposes no spend/impressions for US commercial ads; none recorded.",
    },
    retrievedAt: now,
    confidenceScore,
    rawEvidenceReference: canonicalUrl,
    sourceEvidence,
  };
}
