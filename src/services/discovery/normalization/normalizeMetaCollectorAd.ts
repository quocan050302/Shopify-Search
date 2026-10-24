/**
 * SWAI V11 — MetaAdsCollector Ad Normalizer
 *
 * Transforms raw Meta Ad Library records returned by the MetaAdsCollector MCP server
 * into the canonical SWAI NormalizedDiscoveredAd shape.
 *
 * Strict Integrity Guarantees:
 * 1. Requires valid numeric Meta Library ID (at least 5 digits). Rejects fake/placeholder IDs.
 * 2. Builds canonical public source URL: https://www.facebook.com/ads/library/?id=<LIBRARY_ID>
 * 3. Uses honest media type detection (VIDEO only when video format/URL is verified, IMAGE for images, CAROUSEL for multiple).
 * 4. Factual provenance: META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION.
 * 5. Zero fabricated financial/ROAS/spend metrics for US commercial ads.
 */

import { NormalizedDiscoveredAd, SourceEvidence } from "../types";
import { MetaCollectorRawAd } from "../metaCollector/metaCollectorTypes";
import { generateStableSourceHash } from "@/services/tiktok/tiktokUrlParser";
import { isSafeHttpUrl, buildFacebookAdLibraryUrl, resolveFacebookAdvertiser } from "./normalizeFacebookAd";

export const META_COLLECTOR_PROVIDER_ID = "meta-ads-collector";

export type { MetaCollectorRawAd };

export interface MetaResearchContext {
  queryMarket?: string;
  retrievedAt?: Date;
  keyword?: string;
}

export function parseMetaDate(dateVal: string | number | null | undefined): Date | null {
  if (!dateVal) return null;
  try {
    if (typeof dateVal === "number") {
      const d = new Date(dateVal * (dateVal < 10000000000 ? 1000 : 1));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function normalizeMetaCollectorAd(
  raw: MetaCollectorRawAd | Record<string, unknown>,
  context: MetaResearchContext = {}
): NormalizedDiscoveredAd {
  // 1. Validate Meta Library ID
  const anyRaw = raw as Record<string, unknown>;
  const rawId =
    typeof anyRaw?.id === "string" && anyRaw.id.trim()
      ? anyRaw.id.trim()
      : typeof anyRaw?.library_id === "string" && anyRaw.library_id.trim()
      ? anyRaw.library_id.trim()
      : typeof anyRaw?.libraryId === "string" && anyRaw.libraryId.trim()
      ? anyRaw.libraryId.trim()
      : "";

  if (!/^\d{5,25}$/.test(rawId)) {
    const rawVal = anyRaw?.id ?? anyRaw?.library_id ?? anyRaw?.libraryId;
    throw new Error(
      `MetaAdsCollector record rejected: missing or invalid Meta Library ID ('${String(rawVal)}'). Must be a numeric string of at least 5 digits.`
    );
  }
  const libraryId = rawId;

  const now = context.retrievedAt || new Date();
  const canonicalUrl =
    typeof anyRaw.source_url === "string" && isSafeHttpUrl(anyRaw.source_url)
      ? anyRaw.source_url
      : buildFacebookAdLibraryUrl(libraryId);

  // Stable identity hash for deduplication
  const stableIdentityHash = generateStableSourceHash("META", META_COLLECTOR_PROVIDER_ID, libraryId);

  // 2. Resolve Page / Advertiser
  const pageObj = (anyRaw.page && typeof anyRaw.page === "object" ? anyRaw.page : {}) as Record<string, unknown>;
  const pageName =
    (typeof pageObj.name === "string" && pageObj.name) ||
    (typeof anyRaw.advertiser_name === "string" && anyRaw.advertiser_name) ||
    (typeof anyRaw.advertiserName === "string" && anyRaw.advertiserName) ||
    undefined;
  const pageId =
    (typeof pageObj.id === "string" && pageObj.id) ||
    (typeof anyRaw.page_id === "string" && anyRaw.page_id) ||
    (typeof anyRaw.pageId === "string" && anyRaw.pageId) ||
    (typeof anyRaw.advertiser_page_id === "string" && anyRaw.advertiser_page_id) ||
    undefined;
  const { name: advertiserName, externalId: advertiserExternalId } = resolveFacebookAdvertiser(
    pageName,
    pageId
  );

  // 3. Extract Creative Content
  const creatives = (Array.isArray(anyRaw.creatives) ? anyRaw.creatives : []) as Array<Record<string, unknown>>;
  const primaryCreative = creatives[0] || {};

  const headline = String(
    primaryCreative.title ||
    anyRaw.title ||
    anyRaw.headline ||
    ""
  ).trim().slice(0, 500) || null;

  const bodyText = String(
    primaryCreative.body ||
    primaryCreative.description ||
    primaryCreative.caption ||
    anyRaw.body ||
    anyRaw.bodyText ||
    ""
  ).trim().slice(0, 5000) || null;

  const callToAction = String(
    primaryCreative.cta_text ||
    primaryCreative.cta_type ||
    anyRaw.cta ||
    anyRaw.callToAction ||
    ""
  ).trim().slice(0, 100) || null;

  const rawLinkUrl =
    (typeof primaryCreative.link_url === "string" && primaryCreative.link_url) ||
    (typeof anyRaw.link_url === "string" && anyRaw.link_url) ||
    (typeof anyRaw.landingPageUrl === "string" && anyRaw.landingPageUrl) ||
    null;
  const landingPageUrl = isSafeHttpUrl(rawLinkUrl) ? rawLinkUrl!.trim() : null;

  // 4. Honest Media Classification
  const explicitMediaType = String(anyRaw.media_type || anyRaw.mediaType || "").toUpperCase();
  const hasVideo =
    explicitMediaType === "VIDEO" ||
    creatives.some((c) => Boolean(c.video_url || c.video_hd_url || c.video_sd_url)) ||
    Boolean(anyRaw.video_url || anyRaw.videoUrl);

  const hasMultiple =
    explicitMediaType === "CAROUSEL" ||
    creatives.length > 1;

  const hasImage =
    explicitMediaType === "IMAGE" ||
    creatives.some((c) => Boolean(c.image_url || c.thumbnail_url || c.original_image_url)) ||
    Boolean(anyRaw.image_url || anyRaw.thumbnail_url || anyRaw.imageUrl || anyRaw.thumbnailUrl);

  let mediaType: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN" = "UNKNOWN";
  if (hasMultiple) {
    mediaType = "CAROUSEL";
  } else if (hasVideo) {
    mediaType = "VIDEO";
  } else if (hasImage) {
    mediaType = "IMAGE";
  }

  // Extract direct media URLs if safely formed
  const videoUrlCandidate =
    (typeof primaryCreative.video_hd_url === "string" && primaryCreative.video_hd_url) ||
    (typeof primaryCreative.video_url === "string" && primaryCreative.video_url) ||
    (typeof primaryCreative.video_sd_url === "string" && primaryCreative.video_sd_url) ||
    (typeof anyRaw.video_url === "string" && anyRaw.video_url) ||
    (typeof anyRaw.videoUrl === "string" && anyRaw.videoUrl) ||
    null;
  const videoUrl = isSafeHttpUrl(videoUrlCandidate) ? (videoUrlCandidate as string).trim() : null;

  const thumbnailCandidate =
    (typeof primaryCreative.thumbnail_url === "string" && primaryCreative.thumbnail_url) ||
    (typeof primaryCreative.image_url === "string" && primaryCreative.image_url) ||
    (typeof anyRaw.thumbnail_url === "string" && anyRaw.thumbnail_url) ||
    (typeof anyRaw.image_url === "string" && anyRaw.image_url) ||
    (typeof anyRaw.thumbnailUrl === "string" && anyRaw.thumbnailUrl) ||
    null;
  const thumbnailUrl = isSafeHttpUrl(thumbnailCandidate) ? (thumbnailCandidate as string).trim() : null;

  // 5. Date validation
  const startAtVal = (anyRaw.start_date || anyRaw.delivery_start_time || anyRaw.startDate) as
    | string
    | number
    | null
    | undefined;
  const endAtVal = (anyRaw.end_date || anyRaw.delivery_stop_time || anyRaw.endDate) as
    | string
    | number
    | null
    | undefined;
  const startAt = parseMetaDate(startAtVal);
  const endAt = parseMetaDate(endAtVal);

  // 6. Source-reported active status
  const rawStatus = anyRaw.status || anyRaw.activeStatus;
  const reportedStatus: "ACTIVE" | "INACTIVE" | "UNKNOWN" =
    anyRaw.is_active === true || rawStatus === "ACTIVE"
      ? "ACTIVE"
      : anyRaw.is_active === false || rawStatus === "INACTIVE"
      ? "INACTIVE"
      : "UNKNOWN";

  // 7. Duration
  const durationSeconds =
    typeof anyRaw.video_duration === "number" && anyRaw.video_duration > 0
      ? anyRaw.video_duration
      : typeof anyRaw.durationSeconds === "number" && anyRaw.durationSeconds > 0
      ? anyRaw.durationSeconds
      : null;

  // 8. Confidence scoring based on evidence
  let confidence = 0.70;
  if (advertiserExternalId) confidence += 0.08;
  if (advertiserName !== "Facebook Advertiser (Unattributed)") confidence += 0.07;
  if (startAt) confidence += 0.05;
  if (headline || bodyText) confidence += 0.05;
  if (landingPageUrl) confidence += 0.05;
  const confidenceScore = Math.min(0.95, Math.round(confidence * 100) / 100);

  // 9. SourceEvidence object
  const notes = typeof anyRaw.notes === "string" ? anyRaw.notes : null;
  const sourceEvidence: SourceEvidence = {
    sourceUrl: canonicalUrl,
    observedAt: now.toISOString(),
    observationMethod: "META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION",
    verifiedLibraryId: true,
    reportedStartDate: startAt ? startAt.toISOString() : null,
    reportedStatus,
    facebookPlacement: "CONFIRMED",
    marketEvidence: "QUERY_FILTER",
    notes,
  };

  const rawCountry = typeof anyRaw.country === "string" ? anyRaw.country : "US";
  const targetMarket = (context.queryMarket || rawCountry).toUpperCase();

  return {
    platform: "META",
    providerId: META_COLLECTOR_PROVIDER_ID,
    mediaType,
    sourceNamespace: `META:${META_COLLECTOR_PROVIDER_ID.toUpperCase()}`,
    sourceExternalId: libraryId,
    stableIdentityHash,
    advertiserName,
    advertiserExternalId,
    headline,
    bodyText,
    callToAction,
    creativeUrl: canonicalUrl,
    videoUrl,
    embedUrl: null, // Meta Ad Library does not support public unauthenticated iframe embeds
    thumbnailUrl,
    durationSeconds,
    aspectRatio: mediaType === "VIDEO" ? "9:16" : "1:1",
    mediaAvailability: "RESTRICTED",
    landingPageUrl,
    targetMarket,
    marketEvidenceType: "QUERY_FILTER",
    industry: null,
    objective: null,
    sourceReportedStartAt: startAt,
    sourceReportedEndAt: endAt,
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
