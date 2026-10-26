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
 * 4. Unless US region is verified, labels: Video popularity: OBSERVED, US popularity: NOT_VERIFIED.
 * 5. Respects paid credit limits and budget authorization.
 */

import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  TikTokOrganicVideo,
} from "../types";
import { estimateResearchProviderCost } from "./sourceRegistry";

/**
 * Normalizes raw TikTok organic video payload into typed TikTokOrganicVideo.
 */
export function normalizeTikTokOrganicVideo(raw: any): TikTokOrganicVideo {
  const views = typeof raw.views === "number" ? raw.views : (typeof raw.play_count === "number" ? raw.play_count : null);
  const likes = typeof raw.likes === "number" ? raw.likes : (typeof raw.digg_count === "number" ? raw.digg_count : null);
  const comments = typeof raw.comments === "number" ? raw.comments : (typeof raw.comment_count === "number" ? raw.comment_count : null);
  const shares = typeof raw.shares === "number" ? raw.shares : (typeof raw.share_count === "number" ? raw.share_count : null);
  const saves = typeof raw.saves === "number" ? raw.saves : (typeof raw.collect_count === "number" ? raw.collect_count : null);

  // Calculate observed engagement ratio
  let observedEngagementRatio: number | null = null;
  if (views && views > 0 && (likes != null || comments != null || shares != null)) {
    const totalInteractions = (likes || 0) + (comments || 0) + (shares || 0);
    observedEngagementRatio = Math.round((totalInteractions / views) * 10000) / 100; // e.g. 5.42%
  }

  // Calculate lifetime views per day estimate
  let lifetimeViewsPerDayEstimate: number | null = null;
  const publishedAt = raw.publishedAt || raw.create_time ? new Date(raw.publishedAt || (raw.create_time * 1000)).toISOString() : null;
  if (views && publishedAt) {
    const ageDays = Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24));
    lifetimeViewsPerDayEstimate = Math.round(views / ageDays);
  }

  const videoId = String(raw.id || raw.videoId || raw.aweme_id || "");
  const creatorHandle = raw.author?.unique_id || raw.creatorHandle || raw.author_username || null;
  const canonicalUrl = raw.canonicalUrl || (creatorHandle && videoId ? `https://www.tiktok.com/@${creatorHandle}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`);

  return {
    videoId,
    canonicalUrl,
    creatorId: raw.author?.uid || raw.creatorId || null,
    creatorHandle,
    caption: raw.desc || raw.caption || raw.title || null,
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : (raw.text_extra?.map((t: any) => t.hashtag_name).filter(Boolean) || []),
    publishedAt,
    views,
    likes,
    comments,
    shares,
    saves,
    thumbnailUrl: raw.video?.cover?.url_list?.[0] || raw.thumbnailUrl || raw.cover || null,
    videoUrl: raw.video?.play_addr?.url_list?.[0] || raw.videoUrl || null,
    observedAt: new Date().toISOString(),
    observedEngagementRatio,
    lifetimeViewsPerDayEstimate,
    productMatchConfidence: raw.productMatchConfidence || "PROBABLE",
    sourceProvenance: raw.sourceProvenance || "REAL_UPSTREAM",
    targetMarketEvidence: raw.targetMarketEvidence || null, // e.g. "US" if verified, null if global
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
    // Call HasData TikTok search endpoint
    const searchUrl = `https://api.hasdata.com/scrape/tiktok/search?keyword=${encodeURIComponent(query.topic)}&type=video&count=${Math.min(query.maxResults || 10, 20)}`;
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

    const videos: TikTokOrganicVideo[] = rawItems.map(normalizeTikTokOrganicVideo);
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
      verifiedDeliveryMarket: v.targetMarketEvidence, // May be null if global
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
      rejectedCount: 0,
      estimatedCredits: costEstimate.estimatedCredits,
      consumedCredits: 1,
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
