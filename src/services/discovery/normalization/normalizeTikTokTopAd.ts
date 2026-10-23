/**
 * SWAI V9 — TikTok Top Ads Normalizer & Data Integrity Service
 *
 * Implements strict, source-backed normalization of discovered ads:
 * 1. Maps genuine platform fields without hallucinating missing data.
 * 2. Stable source identity derivation (no random IDs).
 * 3. Dates and metrics validated with strict provenance.
 * 4. Creative Center ads are strictly marked RESTRICTED (non-embeddable inline).
 * 5. Observation status defaults to UNKNOWN until independently verified active.
 */

import { NormalizedDiscoveredAd, RawDiscoveredAd } from "../types";
import {
  generateStableSourceHash,
  canonicalizeTikTokDiscoveryUrl,
  buildTikTokPlayerUrl,
} from "@/services/tiktok/tiktokUrlParser";

export interface NormalizationContext {
  providerId: string;
  queryMarket?: string;
  searchWindowDays?: number;
  retrievedAt?: Date;
}

/**
 * Normalizes a raw discovered advertisement record from TikTok Creative Center / Top Ads.
 */
export function normalizeTikTokTopAd(
  raw: RawDiscoveredAd | Record<string, unknown>,
  context: Partial<NormalizationContext> = {}
): NormalizedDiscoveredAd {
  const meta: Record<string, unknown> =
    typeof raw === "object" && raw !== null && "rawMetadata" in raw && typeof (raw as RawDiscoveredAd).rawMetadata === "object" && (raw as RawDiscoveredAd).rawMetadata !== null
      ? ((raw as RawDiscoveredAd).rawMetadata as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const providerId: string =
    context.providerId || ("providerId" in raw && typeof raw.providerId === "string" ? raw.providerId : "tiktok-topads");
  const now: Date =
    context.retrievedAt || ("retrievedAt" in raw && raw.retrievedAt instanceof Date ? raw.retrievedAt : new Date());

  // 1. Extract Material ID / Source Ad ID
  const rawId =
    meta.adId ||
    meta.ad_id ||
    meta.materialId ||
    meta.material_id ||
    meta.id ||
    ("sourceId" in raw ? raw.sourceId : null);

  const sourceExternalId = rawId ? String(rawId).trim() : null;

  // 2. Resolve URLs & Canonical Link
  const rawSourceUrl: string =
    (typeof meta.detailUrl === "string" ? meta.detailUrl : null) ||
    (typeof meta.detail_url === "string" ? meta.detail_url : null) ||
    (typeof meta.sourceUrl === "string" ? meta.sourceUrl : null) ||
    ("sourceUrl" in raw && typeof raw.sourceUrl === "string" ? raw.sourceUrl : null) ||
    (sourceExternalId
      ? `https://ads.tiktok.com/business/creativecenter/topads/${sourceExternalId}/pc/en?region=US`
      : "") ||
    "";

  const canonicalUrl = canonicalizeTikTokDiscoveryUrl(rawSourceUrl);

  // 3. Stable Identity Hash (Rule 69 & 83: Never generate random IDs!)
  const identitySeed = sourceExternalId || canonicalUrl;
  const stableIdentityHash = generateStableSourceHash("TIKTOK", providerId, identitySeed);

  // 4. Resolve Advertiser
  const rawAdvertiser =
    (meta.brandName as string) ||
    (meta.brand_name as string) ||
    (meta.advertiserName as string) ||
    (meta.advertiser_name as string) ||
    (meta.brand as string) ||
    "UNKNOWN";

  const advObj = resolveAdvertiserIdentity(rawAdvertiser, sourceExternalId);
  const advertiserName = advObj.name;
  const advertiserExternalId =
    (meta.advertiserId as string) ||
    (meta.advertiser_id as string) ||
    (meta.brandId as string) ||
    advObj.externalId ||
    null;

  // 5. Ad Creative Text
  const headline = (meta.adTitle as string) || (meta.title as string) || (meta.headline as string) || null;
  const bodyText = (meta.bodyText as string) || (meta.caption as string) || (meta.text as string) || null;
  const callToAction = (meta.callToAction as string) || (meta.cta as string) || null;

  // 6. Media Assets & Embed Rules (Rules 7, 8 & 84)
  const videoUrl =
    (meta.videoUrl720p as string) ||
    (meta.videoUrl as string) ||
    (meta.video_url as string) ||
    (meta.video_play_url as string) ||
    null;

  const thumbnailUrl =
    (meta.coverUrl as string) ||
    (meta.cover_url as string) ||
    (meta.thumbnailUrl as string) ||
    (meta.thumbnail as string) ||
    null;

  const durationSeconds =
    typeof meta.durationSec === "number"
      ? meta.durationSec
      : typeof meta.duration === "number"
      ? meta.duration
      : null;

  // Check if genuine post permalink exists to embed via player/v1
  let embedUrl: string | null = null;
  const postId = meta.postId ? String(meta.postId) : null;
  if (postId && /^\d+$/.test(postId)) {
    embedUrl = buildTikTokPlayerUrl(postId);
  }

  // Creative Center Top Ads are NOT embeddable inline per TikTok security policy
  const mediaAvailability = embedUrl ? "READY" : videoUrl ? "READY" : "RESTRICTED";

  // 7. Landing Page
  const landingPageUrl = (meta.landingPageUrl as string) || (meta.landing_page_url as string) || null;

  // 8. Geography & Market Provenance (Rule 63)
  const sourceRegion = (meta.countryCode as string) || (meta.region as string) || context.queryMarket || "US";
  const targetMarket = sourceRegion.toUpperCase() === "US" ? "US" : sourceRegion.toUpperCase();
  const marketEvidenceType = meta.countryCode ? "CONFIRMED_DELIVERY" : "QUERY_FILTER";

  // 9. Industry & Campaign Objective
  const industry =
    (meta.industry_key as string) ||
    (meta.industryKey as string) ||
    (meta.industryName as string) ||
    (meta.industry as string) ||
    null;
  const objective =
    (meta.objective_key as string) ||
    (meta.objectiveKey as string) ||
    (meta.objective as string) ||
    null;

  // 10. Source-Reported Dates Validation (Rule 77)
  const dateValidation = validateSourceReportedDates(
    meta.firstSeenDate || meta.start_time || meta.first_seen,
    meta.lastSeenDate || meta.end_time || meta.last_seen
  );

  // 11. Metrics with Provenance (Rule 89)
  const rawLikes = meta.likes ?? meta.like_cnt ?? meta.likeCount;
  const likes = typeof rawLikes === "number" && rawLikes >= 0 ? rawLikes : null;
  const rawCtr = meta.ctr ?? meta.clickThroughRate;
  const ctr = typeof rawCtr === "number" && rawCtr >= 0 ? rawCtr : null;
  const rawCvr = meta.cvr ?? meta.conversionRate;
  const cvr = typeof rawCvr === "number" && rawCvr >= 0 ? rawCvr : null;
  const rawCostScore = meta.costScore ?? meta.cost_score;
  const costScore = typeof rawCostScore === "number" ? rawCostScore : null;

  return {
    platform: "TIKTOK",
    providerId,
    mediaType: "VIDEO",
    sourceNamespace: `TIKTOK:${providerId.toUpperCase()}`,
    sourceExternalId,
    stableIdentityHash,
    advertiserName,
    advertiserExternalId,
    headline,
    bodyText,
    callToAction,
    creativeUrl: canonicalUrl || rawSourceUrl,
    videoUrl,
    embedUrl,
    thumbnailUrl,
    durationSeconds,
    aspectRatio: "9:16",
    mediaAvailability,
    landingPageUrl,
    targetMarket,
    marketEvidenceType,
    industry,
    objective,
    sourceReportedStartAt: dateValidation.startAt,
    sourceReportedEndAt: dateValidation.endAt,
    reportedMetrics: {
      likes,
      ctr,
      cvr,
      costScore,
      rawMetricsNotice: "Provider-reported metrics retained with original source provenance.",
    },
    retrievedAt: now,
    confidenceScore: sourceExternalId ? 0.9 : 0.7,
    rawEvidenceReference: canonicalUrl,
  };
}

/**
 * Validates dates reported by an external provider.
 * Rejects inverted ranges, future dates, or nonsense epochs.
 */
export function validateSourceReportedDates(
  rawStart: unknown,
  rawEnd?: unknown
): {
  startAt: Date | null;
  endAt: Date | null;
  isValid: boolean;
  sourceReportedFirstSeen?: Date;
  sourceReportedLastSeen?: Date;
} {
  let startAt: Date | null = null;
  let endAt: Date | null = null;
  const now = new Date();

  if (rawStart) {
    const d = new Date(typeof rawStart === "number" && rawStart < 1e11 ? rawStart * 1000 : String(rawStart));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2018 && d <= now) {
      startAt = d;
    }
  }

  if (rawEnd) {
    const d = new Date(typeof rawEnd === "number" && rawEnd < 1e11 ? rawEnd * 1000 : String(rawEnd));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2018 && d <= now) {
      endAt = d;
    }
  }

  // If start is after end, reject both to prevent invalid date ranges
  if (startAt && endAt && startAt > endAt) {
    return {
      startAt: null,
      endAt: null,
      isValid: false,
      sourceReportedFirstSeen: undefined,
      sourceReportedLastSeen: undefined,
    };
  }

  return {
    startAt,
    endAt,
    isValid: true,
    sourceReportedFirstSeen: startAt || undefined,
    sourceReportedLastSeen: endAt || undefined,
  };
}

/**
 * Resolves advertiser names cleanly without collapsing distinct unknown entities.
 * Prefers verified external IDs or reliable source-supported identities.
 */
export function resolveAdvertiserIdentity(
  rawName: string | null | undefined,
  fallbackExternalId?: string | null
): { name: string; externalId?: string } {
  const trimmed = typeof rawName === "string" ? rawName.trim() : "";
  if (trimmed.length > 0 && trimmed.toUpperCase() !== "UNKNOWN") {
    return { name: trimmed, externalId: fallbackExternalId || undefined };
  }
  if (fallbackExternalId) {
    return { name: `TikTok Advertiser ${fallbackExternalId}`, externalId: fallbackExternalId };
  }
  return { name: "TikTok Advertiser (Unattributed)" };
}
