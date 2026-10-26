/**
 * SWAI KH-02 — TikTok Organic Video Research Adapter
 *
 * Researches public product videos, play counts, engagement ratios,
 * and creator diversity without confusing viral spikes with evergreen demand.
 *
 * Rules:
 * 1. Video views must be source-observed values — never derived from likes.
 * 2. Engagement ratio = (likes + comments + shares) / views.
 * 3. Lifetime views/day is distinct from multi-observation growth velocity.
 *    Single observation = no verified view velocity.
 * 4. Unless US region is verified, labels: Video popularity: OBSERVED, US popularity: NOT_VERIFIED.
 * 5. Respects paid credit limits and budget authorization (AUTO_PAID_RESEARCH = false).
 * 6. Hardens normalization against malformed dates, negative metrics, and integer overflows.
 */

import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  TikTokOrganicVideo,
} from "../types";
import { estimateResearchProviderCost } from "./sourceRegistry";

export interface ProviderCostPolicy {
  creditsPerRequest: number;
  pageSize: number;
  maximumPages: number;
  freeMonthlyAllowance?: number;
  quotaVerifiedAt: string | null;
}

export const TIKTOK_ORGANIC_COST_POLICY: ProviderCostPolicy = {
  creditsPerRequest: 1,
  pageSize: 20,
  maximumPages: 2,
  freeMonthlyAllowance: 0,
  quotaVerifiedAt: "2026-10-26T00:00:00.000Z",
};

function parseSafeMetric(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val) && Number.isSafeInteger(val)) {
    return val >= 0 ? val : null;
  }
  if (typeof val === "string" && /^\d+$/.test(val.trim())) {
    const parsed = parseInt(val.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function parseSafeDate(raw: unknown): string | null {
  if (!raw) return null;
  try {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // Milliseconds or seconds
      const ms = raw < 1e11 ? raw * 1000 : raw;
      const d = new Date(ms);
      return !isNaN(d.getTime()) ? d.toISOString() : null;
    }
    if (typeof raw === "string") {
      const d = new Date(raw);
      return !isNaN(d.getTime()) ? d.toISOString() : null;
    }
  } catch {
    return null;
  }
  return null;
}

function isValidHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return null;
}

/**
 * Normalizes raw TikTok organic video payload into typed TikTokOrganicVideo.
 * Fail-safe against unexpected data shapes, corrupted timestamps, and metric overflows.
 */
export function normalizeTikTokOrganicVideo(raw: any): TikTokOrganicVideo {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid TikTok video payload: object required");
  }

  const videoId = String(raw.id || raw.videoId || raw.aweme_id || "").trim();
  if (!videoId) {
    throw new Error("Invalid TikTok video payload: nonempty videoId required");
  }

  const views = parseSafeMetric(raw.views ?? raw.play_count);
  const likes = parseSafeMetric(raw.likes ?? raw.digg_count);
  const comments = parseSafeMetric(raw.comments ?? raw.comment_count);
  const shares = parseSafeMetric(raw.shares ?? raw.share_count);
  const saves = parseSafeMetric(raw.saves ?? raw.collect_count);

  // Calculate observed engagement ratio
  let observedEngagementRatio: number | null = null;
  if (views && views > 0 && (likes != null || comments != null || shares != null)) {
    const totalInteractions = (likes || 0) + (comments || 0) + (shares || 0);
    observedEngagementRatio = Math.round((totalInteractions / views) * 10000) / 100; // e.g. 5.42%
  }

  // Parse published timestamp strictly without mixing branches
  let publishedAt: string | null = null;
  if (raw.publishedAt) {
    publishedAt = parseSafeDate(raw.publishedAt);
  } else if (raw.create_time) {
    publishedAt = parseSafeDate(raw.create_time);
  }

  // Calculate lifetime views per day estimate
  let lifetimeViewsPerDayEstimate: number | null = null;
  if (views && publishedAt) {
    const pubTime = new Date(publishedAt).getTime();
    if (!isNaN(pubTime)) {
      const ageDays = Math.max(1, (Date.now() - pubTime) / (1000 * 60 * 60 * 24));
      lifetimeViewsPerDayEstimate = Math.round(views / ageDays);
    }
  }

  const creatorHandle = typeof raw.author?.unique_id === "string"
    ? raw.author.unique_id
    : (typeof raw.creatorHandle === "string" ? raw.creatorHandle : (typeof raw.author_username === "string" ? raw.author_username : null));

  const canonicalUrl = isValidHttpUrl(raw.canonicalUrl) ||
    (creatorHandle ? `https://www.tiktok.com/@${creatorHandle}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`);

  const rawThumbnail = raw.video?.cover?.url_list?.[0] || raw.thumbnailUrl || raw.cover || null;
  const rawVideoUrl = raw.video?.play_addr?.url_list?.[0] || raw.videoUrl || null;

  return {
    videoId,
    canonicalUrl,
    creatorId: raw.author?.uid ? String(raw.author.uid) : (raw.creatorId ? String(raw.creatorId) : null),
    creatorHandle,
    caption: typeof raw.desc === "string" ? raw.desc : (typeof raw.caption === "string" ? raw.caption : (typeof raw.title === "string" ? raw.title : null)),
    hashtags: Array.isArray(raw.hashtags)
      ? raw.hashtags.filter((h: any) => typeof h === "string")
      : (Array.isArray(raw.text_extra)
          ? raw.text_extra.map((t: any) => t?.hashtag_name).filter(Boolean)
          : []),
    publishedAt,
    views,
    likes,
    comments,
    shares,
    saves,
    thumbnailUrl: isValidHttpUrl(rawThumbnail),
    videoUrl: isValidHttpUrl(rawVideoUrl),
    observedAt: new Date().toISOString(),
    observedEngagementRatio,
    lifetimeViewsPerDayEstimate,
    productMatchConfidence: raw.productMatchConfidence || "PROBABLE",
    sourceProvenance: raw.sourceProvenance || "UNKNOWN",
    targetMarketEvidence: raw.targetMarketEvidence === "US" ? "US" : null,
  };
}

/**
 * Collects public TikTok organic product videos for a research topic.
 */
export async function collectTikTokOrganicSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check budget safeguards
  const costEstimate = estimateResearchProviderCost("TIKTOK_ORGANIC", query);
  if (!costEstimate.isAllowed) {
    warnings.push(costEstimate.reason || "TikTok organic metered search is disabled in zero-cost mode.");
    return {
      source: "TIKTOK_ORGANIC",
      status: "NOT_CONFIGURED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: costEstimate.estimatedCredits,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }

  const apiKey = process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
  if (!apiKey) {
    warnings.push("TikTok Organic API key (HASDATA_API_KEY) not provided. Live organic search unavailable.");
    return {
      source: "TIKTOK_ORGANIC",
      status: "NOT_CONFIGURED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }

  try {
    const count = Math.min(query.maxResults || 10, TIKTOK_ORGANIC_COST_POLICY.pageSize);
    const searchUrl = `https://api.hasdata.com/scrape/tiktok/search?keyword=${encodeURIComponent(query.topic)}&type=video&count=${count}`;
    
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
      signal: query.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          source: "TIKTOK_ORGANIC",
          status: "NOT_CONFIGURED",
          observations: [],
          retrievedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          estimatedCredits: costEstimate.estimatedCredits,
          consumedCredits: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          errors: ["TikTok Organic provider credentials invalid or unauthorized."],
          warnings,
        };
      }
      if (response.status === 429) {
        return {
          source: "TIKTOK_ORGANIC",
          status: "RATE_LIMITED",
          observations: [],
          retrievedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          estimatedCredits: costEstimate.estimatedCredits,
          consumedCredits: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          errors: ["TikTok Organic search rate limit exceeded."],
          warnings,
        };
      }
      throw new Error(`HasData TikTok Organic API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawItems = Array.isArray(data.items) ? data.items : (Array.isArray(data.data) ? data.data : []);

    const videos: TikTokOrganicVideo[] = [];
    for (const raw of rawItems) {
      try {
        const v = normalizeTikTokOrganicVideo({
          ...raw,
          sourceProvenance: "REAL_UPSTREAM",
        });
        videos.push(v);
      } catch (normErr: any) {
        warnings.push(`Skipped malformed TikTok video: ${normErr.message}`);
      }
    }

    const observations: SourceObservation[] = videos.map((v) => ({
      source: "TIKTOK_ORGANIC",
      sourceRecordId: v.videoId,
      sourceUrl: v.canonicalUrl,
      advertiserOrCreator: v.creatorHandle,
      advertiserDomain: null,
      productMatchHint: v.caption,
      reportedPublishedAt: v.publishedAt,
      reportedFirstShownAt: v.publishedAt,
      reportedLastShownAt: null,
      observedAt: v.observedAt,
      requestedMarket: "US",
      verifiedDeliveryMarket: v.targetMarketEvidence, // null unless US audience confirmed
      title: v.caption ? v.caption.slice(0, 80) : null,
      description: v.caption,
      metrics: {
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        saves: v.saves,
        observedEngagementRatio: v.observedEngagementRatio,
        lifetimeViewsPerDayEstimate: v.lifetimeViewsPerDayEstimate,
      },
      media: {
        thumbnailUrl: v.thumbnailUrl,
        videoUrl: v.videoUrl,
        embedUrl: v.canonicalUrl,
        mediaType: "VIDEO",
      },
      provenance: v.sourceProvenance,
      evidenceReference: `TikTokVideo:${v.videoId}`,
    }));

    return {
      source: "TIKTOK_ORGANIC",
      status: "PASSED",
      observations,
      retrievedCount: rawItems.length,
      acceptedCount: observations.length,
      rejectedCount: rawItems.length - observations.length,
      estimatedCredits: costEstimate.estimatedCredits,
      consumedCredits: TIKTOK_ORGANIC_COST_POLICY.creditsPerRequest,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  } catch (err: any) {
    errors.push(err.message || "Failed to execute TikTok organic search.");
    return {
      source: "TIKTOK_ORGANIC",
      status: "FAILED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: costEstimate.estimatedCredits,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }
}
