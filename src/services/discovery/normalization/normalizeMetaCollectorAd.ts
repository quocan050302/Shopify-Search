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

  // 3. Extract Creative Content & Variants across all creative objects
  const creatives = (Array.isArray(anyRaw.creatives) ? anyRaw.creatives : []) as Array<Record<string, unknown>>;
  const primaryCreative = creatives[0] || {};

  const headline = String(
    primaryCreative.title ||
    creatives.find((c) => typeof c.title === "string" && c.title.trim())?.title ||
    anyRaw.title ||
    anyRaw.headline ||
    ""
  ).trim().slice(0, 500) || null;

  const bodyText = String(
    primaryCreative.body ||
    primaryCreative.description ||
    primaryCreative.caption ||
    creatives.find((c) => typeof (c.body || c.description || c.caption) === "string")?.body ||
    anyRaw.body ||
    anyRaw.bodyText ||
    ""
  ).trim().slice(0, 5000) || null;

  const callToAction = String(
    primaryCreative.cta_text ||
    primaryCreative.cta_type ||
    creatives.find((c) => typeof (c.cta_text || c.cta_type) === "string")?.cta_text ||
    anyRaw.cta ||
    anyRaw.callToAction ||
    ""
  ).trim().slice(0, 100) || null;

  const rawLinkUrl =
    (typeof primaryCreative.link_url === "string" && primaryCreative.link_url) ||
    creatives.find((c) => typeof c.link_url === "string" && c.link_url)?.link_url ||
    (typeof anyRaw.link_url === "string" && anyRaw.link_url) ||
    (typeof anyRaw.landingPageUrl === "string" && anyRaw.landingPageUrl) ||
    null;
  const landingPageUrl = isSafeHttpUrl(rawLinkUrl) ? (rawLinkUrl as string).trim() : null;

  // 4. Honest Media Classification (Phase 3: Support display_format & avoid false carousel)
  const explicitMediaType = String(anyRaw.media_type || anyRaw.mediaType || "").toUpperCase();
  const displayFormat = String(anyRaw.display_format || anyRaw.displayFormat || "").toUpperCase();
  const rawAdType = String(anyRaw.ad_type || "").toUpperCase();

  const isExplicitCarousel =
    explicitMediaType === "CAROUSEL" ||
    displayFormat === "CAROUSEL" ||
    rawAdType === "CAROUSEL";

  const hasVideoMedia =
    explicitMediaType === "VIDEO" ||
    displayFormat === "VIDEO" ||
    creatives.some((c) =>
      Boolean(
        c.video_url ||
        c.video_hd_url ||
        c.video_sd_url ||
        c.watermarked_video_hd_url ||
        c.watermarked_video_sd_url
      )
    ) ||
    Boolean(
      anyRaw.video_url ||
      anyRaw.video_hd_url ||
      anyRaw.video_sd_url ||
      anyRaw.watermarked_video_hd_url ||
      anyRaw.watermarked_video_sd_url ||
      anyRaw.videoUrl
    );

  const hasImageMedia =
    explicitMediaType === "IMAGE" ||
    displayFormat === "IMAGE" ||
    creatives.some((c) =>
      Boolean(
        c.image_url ||
        c.thumbnail_url ||
        c.original_image_url ||
        c.resized_image_url ||
        c.watermarked_image_url
      )
    ) ||
    Boolean(
      anyRaw.image_url ||
      anyRaw.thumbnail_url ||
      anyRaw.imageUrl ||
      anyRaw.thumbnailUrl ||
      anyRaw.original_image_url
    );

  let mediaType: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN" = "UNKNOWN";
  if (isExplicitCarousel) {
    mediaType = "CAROUSEL";
  } else if (hasVideoMedia) {
    mediaType = "VIDEO";
  } else if (hasImageMedia) {
    mediaType = "IMAGE";
  }

  // Extract direct media URLs across all creatives with source-backed priority
  let videoUrl: string | null = null;
  for (const c of creatives) {
    const candidate =
      c.video_hd_url ||
      c.video_url ||
      c.video_sd_url ||
      c.watermarked_video_hd_url ||
      c.watermarked_video_sd_url;
    if (typeof candidate === "string" && isSafeHttpUrl(candidate)) {
      videoUrl = candidate.trim();
      break;
    }
  }
  if (!videoUrl) {
    const rawVideo =
      anyRaw.video_hd_url ||
      anyRaw.video_url ||
      anyRaw.video_sd_url ||
      anyRaw.watermarked_video_hd_url ||
      anyRaw.watermarked_video_sd_url ||
      anyRaw.videoUrl;
    if (typeof rawVideo === "string" && isSafeHttpUrl(rawVideo)) {
      videoUrl = (rawVideo as string).trim();
    }
  }

  // Thumbnail extraction with explicit priority
  let thumbnailUrl: string | null = null;
  if (mediaType === "VIDEO") {
    // For video ads, prioritize genuine video poster/thumbnail preview
    for (const c of creatives) {
      const candidate =
        c.thumbnail_url ||
        c.image_url ||
        c.original_image_url ||
        c.resized_image_url ||
        c.watermarked_image_url;
      if (typeof candidate === "string" && isSafeHttpUrl(candidate)) {
        thumbnailUrl = candidate.trim();
        break;
      }
    }
    if (!thumbnailUrl) {
      const rawThumb =
        anyRaw.thumbnail_url ||
        anyRaw.thumbnailUrl ||
        anyRaw.image_url ||
        anyRaw.imageUrl ||
        anyRaw.original_image_url;
      if (typeof rawThumb === "string" && isSafeHttpUrl(rawThumb)) {
        thumbnailUrl = (rawThumb as string).trim();
      }
    }
  } else {
    // For image or carousel ads, prioritize high-quality genuine creative image
    for (const c of creatives) {
      const candidate =
        c.original_image_url ||
        c.image_url ||
        c.resized_image_url ||
        c.thumbnail_url ||
        c.watermarked_image_url;
      if (typeof candidate === "string" && isSafeHttpUrl(candidate)) {
        thumbnailUrl = candidate.trim();
        break;
      }
    }
    if (!thumbnailUrl) {
      const rawImage =
        anyRaw.original_image_url ||
        anyRaw.image_url ||
        anyRaw.imageUrl ||
        anyRaw.thumbnail_url ||
        anyRaw.thumbnailUrl ||
        anyRaw.resized_image_url;
      if (typeof rawImage === "string" && isSafeHttpUrl(rawImage)) {
        thumbnailUrl = (rawImage as string).trim();
      }
    }
  }

  // Preserve multiple creative variants rather than discarding
  const creativeVariants = creatives.map((c, idx) => {
    const cVideo =
      c.video_hd_url ||
      c.video_url ||
      c.video_sd_url ||
      c.watermarked_video_hd_url ||
      c.watermarked_video_sd_url;
    const cImage =
      c.original_image_url ||
      c.image_url ||
      c.resized_image_url ||
      c.thumbnail_url ||
      c.watermarked_image_url;

    return {
      variantIndex: idx,
      format: cVideo ? "VIDEO" : cImage ? "IMAGE" : "UNKNOWN",
      videoUrl: typeof cVideo === "string" && isSafeHttpUrl(cVideo) ? cVideo.trim() : null,
      thumbnailUrl: typeof cImage === "string" && isSafeHttpUrl(cImage) ? cImage.trim() : null,
      title: typeof c.title === "string" ? c.title.trim() : null,
      body: typeof c.body === "string" ? c.body.trim() : null,
      cta: typeof c.cta_text === "string" ? c.cta_text.trim() : null,
    };
  });

  // Aspect ratio calculation (avoid guessing 9:16 for all videos)
  let aspectRatio = "UNKNOWN";
  for (const c of creatives) {
    const w = typeof c.width === "number" ? c.width : typeof c.original_width === "number" ? c.original_width : null;
    const h = typeof c.height === "number" ? c.height : typeof c.original_height === "number" ? c.original_height : null;
    if (w && h && w > 0 && h > 0) {
      const ratio = w / h;
      if (Math.abs(ratio - 1) < 0.08) {
        aspectRatio = "1:1";
        break;
      } else if (ratio >= 0.5 && ratio <= 0.65) {
        aspectRatio = "9:16";
        break;
      } else if (ratio >= 1.6 && ratio <= 1.85) {
        aspectRatio = "16:9";
        break;
      } else if (ratio >= 0.75 && ratio <= 0.85) {
        aspectRatio = "4:5";
        break;
      }
    }
  }

  if (aspectRatio === "UNKNOWN") {
    const rawW = typeof anyRaw.width === "number" ? anyRaw.width : null;
    const rawH = typeof anyRaw.height === "number" ? anyRaw.height : null;
    if (rawW && rawH && rawW > 0 && rawH > 0) {
      const ratio = rawW / rawH;
      if (Math.abs(ratio - 1) < 0.08) aspectRatio = "1:1";
      else if (ratio >= 0.5 && ratio <= 0.65) aspectRatio = "9:16";
      else if (ratio >= 1.6 && ratio <= 1.85) aspectRatio = "16:9";
      else if (ratio >= 0.75 && ratio <= 0.85) aspectRatio = "4:5";
    }
  }

  // If still unknown and format is image/carousel, neutral 1:1 is appropriate
  if (aspectRatio === "UNKNOWN") {
    if (mediaType === "IMAGE" || mediaType === "CAROUSEL") {
      aspectRatio = "1:1";
    } else {
      aspectRatio = "UNKNOWN";
    }
  }

  // Media availability: READY when authentic HTTPS media asset is available
  const mediaAvailability: "READY" | "RESTRICTED" | "FALLBACK_ONLY" =
    thumbnailUrl || videoUrl ? "READY" : "RESTRICTED";

  // 5. Date validation (Phase 3: map delivery_start_time and delivery_stop_time accurately)
  const startAtVal = (anyRaw.delivery_start_time || anyRaw.start_date || anyRaw.startDate) as
    | string
    | number
    | null
    | undefined;
  const endAtVal = (anyRaw.delivery_stop_time || anyRaw.end_date || anyRaw.endDate) as
    | string
    | number
    | null
    | undefined;
  const startAt = parseMetaDate(startAtVal);
  const endAt = parseMetaDate(endAtVal);

  // 6. Source-reported active status
  const rawStatus = anyRaw.status || anyRaw.activeStatus || anyRaw.ad_status;
  const reportedStatus: "ACTIVE" | "INACTIVE" | "UNKNOWN" =
    anyRaw.is_active === true || rawStatus === "ACTIVE"
      ? "ACTIVE"
      : anyRaw.is_active === false || rawStatus === "INACTIVE" || rawStatus === "PAUSED"
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
  if (thumbnailUrl || videoUrl) confidence += 0.05;
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
    creativeVariants,
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
    aspectRatio,
    mediaAvailability,
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
