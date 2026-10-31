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
 * 7. Segregates TikTok Organic capabilities from TikTok Ads.
 */

import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  TikTokOrganicVideo,
  SourceRunStatus,
} from "../types";
import {
  fetchHasDataCreditStatus,
  evaluateHasDataQuota,
  ProviderOperationCost,
  getHasDataOperationCost,
  hasVerifiedFreeAllowance,
} from "./hasDataCreditService";
import { evaluateProviderCostGuard } from "./providerCostPolicy";

export interface ProviderCostPolicy {
  creditsPerRequest: number;
  pageSize: number;
  maximumPages: number;
  freeMonthlyAllowance?: number;
  quotaVerifiedAt: string | null;
}

export const TIKTOK_ORGANIC_COST_POLICY: ProviderCostPolicy = {
  creditsPerRequest: 10, // HasData MCP tool call costs 10 credits per query
  pageSize: 20,
  maximumPages: 2,
  freeMonthlyAllowance: 1000, // HasData free monthly allowance is 1,000 credits
  quotaVerifiedAt: "2026-10-26T00:00:00.000Z",
};

export interface TikTokContext {
  apiKey?: string;
  targetMarket?: string;
  hasDataUrl?: string;
}

export interface TikTokCapabilities {
  organicVideoSearchSupported: boolean;
  videoMetricsSupported: boolean;
  paidAdsSupported: boolean;
  creatorMetadataSupported: boolean;
  geographicFilterSupported: boolean;
  provider: "HASDATA" | "OFFICIAL_API" | "NONE";
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "NOT_CONFIGURED";
  reason?: string;
}

export interface TikTokOrganicQuery {
  topic: string;
  maxResults?: number;
  market?: string;
  signal?: AbortSignal;
}

export interface TikTokOrganicCollectionResult {
  success: boolean;
  status: SourceRunStatus;
  videos: TikTokOrganicVideo[];
  observations: SourceObservation[];
  retrievedCount: number;
  creditsConsumed: number;
  errors: string[];
  warnings: string[];
}

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
 * Resolves truthful capabilities for TikTok Organic vs TikTok Ads.
 */
export async function resolveTikTokCapabilities(
  context: TikTokContext = {}
): Promise<TikTokCapabilities> {
  const apiKey = context.apiKey || process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;

  if (!apiKey) {
    return {
      organicVideoSearchSupported: false,
      videoMetricsSupported: false,
      paidAdsSupported: false,
      creatorMetadataSupported: false,
      geographicFilterSupported: false,
      provider: "NONE",
      status: "NOT_CONFIGURED",
      reason: "HASDATA_API_KEY is not configured.",
    };
  }

  return {
    organicVideoSearchSupported: true,
    videoMetricsSupported: true,
    paidAdsSupported: false, // Paid ads is a separate capability handled via TikTok Ads Center
    creatorMetadataSupported: true,
    geographicFilterSupported: false, // Organic search keyword does not strictly guarantee US-only viewer distribution
    provider: "HASDATA",
    status: "AVAILABLE",
    reason: "HasData TikTok Organic API configured.",
  };
}

/**
 * Normalizes raw TikTok organic video payload into typed TikTokOrganicVideo.
 * Fail-safe against unexpected data shapes, corrupted timestamps, and metric overflows.
 */
export function normalizeTikTokOrganicVideo(raw: any, sourceContext?: any): TikTokOrganicVideo {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid TikTok video payload: object required");
  }

  const videoId = String(raw.id || raw.videoId || raw.aweme_id || "").trim();
  if (!videoId) {
    throw new Error("Invalid TikTok video payload: nonempty videoId required");
  }

  const views = parseSafeMetric(raw.views ?? raw.plays ?? raw.play_count);
  const likes = parseSafeMetric(raw.likes ?? raw.digg_count);
  const comments = parseSafeMetric(raw.comments ?? raw.comment_count);
  const shares = parseSafeMetric(raw.shares ?? raw.share_count);
  const saves = parseSafeMetric(raw.saves ?? raw.collects ?? raw.collect_count);

  let observedEngagementRatio: number | null = null;
  if (views !== null && views > 0 && likes !== null) {
    const totalEngagement = likes + (comments || 0) + (shares || 0);
    observedEngagementRatio = Math.round((totalEngagement / views) * 10000) / 100;
  }

  let publishedAt = parseSafeDate(raw.publishedAt);
  if (!publishedAt && (raw.create_time || raw.createTime)) {
    publishedAt = parseSafeDate(raw.create_time || raw.createTime);
  }

  let lifetimeViewsPerDayEstimate: number | null = null;
  if (views !== null && views > 0 && publishedAt) {
    const pubTime = new Date(publishedAt).getTime();
    const daysSincePub = Math.max(1, (Date.now() - pubTime) / (1000 * 60 * 60 * 24));
    lifetimeViewsPerDayEstimate = Math.round(views / daysSincePub);
  }

  const rawThumbnail = raw.thumbnailUrl || raw.coverUrl || raw.cover || raw.dynamic_cover?.url_list?.[0] || null;
  const rawVideoUrl = raw.videoUrl || raw.playUrl || raw.play_addr?.url_list?.[0] || raw.share_url || `https://www.tiktok.com/@${raw.author?.unique_id || raw.author?.username || "video"}/video/${videoId}`;

  return {
    videoId,
    canonicalUrl: isValidHttpUrl(raw.url) || `https://www.tiktok.com/@${raw.author?.unique_id || raw.author?.username || "video"}/video/${videoId}`,
    creatorId: raw.author?.uid || raw.author?.id ? String(raw.author.uid || raw.author.id) : null,
    creatorHandle: raw.author?.unique_id || raw.author?.username || raw.author?.nickname || null,
    caption: typeof raw.desc === "string" ? raw.desc : (typeof raw.caption === "string" ? raw.caption : (typeof raw.title === "string" ? raw.title : (typeof raw.description === "string" ? raw.description : null))),
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

export const normalizeTikTokOrganicRecord = normalizeTikTokOrganicVideo;

/**
 * Collects public TikTok organic product videos with quota checking and fail-safe parsing.
 */
export async function collectTikTokOrganicEvidence(
  query: TikTokOrganicQuery,
  context: TikTokContext = {}
): Promise<TikTokOrganicCollectionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const videos: TikTokOrganicVideo[] = [];
  const observations: SourceObservation[] = [];

  const apiKey = context.apiKey || process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
  if (!apiKey) {
    warnings.push("TikTok Organic API key (HASDATA_API_KEY) not provided. Live organic search unavailable.");
    return {
      success: false,
      status: "NOT_CONFIGURED",
      videos: [],
      observations: [],
      retrievedCount: 0,
      creditsConsumed: 0,
      errors,
      warnings,
    };
  }

  // Balance lookup is non-metered; only provider-verified Free allowance is exempt.
  const creditStatus = await fetchHasDataCreditStatus({ apiKey });
  const costDecision = evaluateProviderCostGuard("HASDATA", "TIKTOK_ORGANIC_SEARCH", 10);
  if (!costDecision.allowed && !hasVerifiedFreeAllowance(creditStatus, 10)) {
    const reason = `Free-tier research blocked: HasData did not confirm a Free plan with at least 10 credits. ${creditStatus.errorMessage || "Check the account plan and quota response."} Paid research remains disabled.`;
    warnings.push(reason);
    return {
      success: false,
      status: "COST_BLOCKED",
      videos: [],
      observations: [],
      retrievedCount: 0,
      creditsConsumed: 0,
      errors: [reason],
      warnings,
    };
  }

  // Authoritative credit check
  const quotaDecision = evaluateHasDataQuota(creditStatus, {
    operationType: "TIKTOK_ORGANIC_SEARCH",
    estimatedRequests: 1,
    creditsPerRequest: 10,
  });

  if (!quotaDecision.isAllowed) {
    warnings.push(quotaDecision.reason);
    return {
      success: false,
      status: "BLOCKED",
      videos: [],
      observations: [],
      retrievedCount: 0,
      creditsConsumed: 0,
      errors: [quotaDecision.reason],
      warnings,
    };
  }

  try {
    const count = Math.min(query.maxResults || 20, 20);
    const searchUrl = `https://api.hasdata.com/scrape/tiktok/search?keyword=${encodeURIComponent(query.topic)}&type=video`;

    const res = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      signal: query.signal ? AbortSignal.any([query.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        errors.push(`HasData API key authentication failed (HTTP ${res.status}).`);
        return {
          success: false,
          status: "AUTHENTICATION_FAILED",
          videos: [],
          observations: [],
          retrievedCount: 0,
          creditsConsumed: 0,
          errors,
          warnings,
        };
      }
      if (res.status === 402) {
        errors.push("TikTok Organic provider credit balance exhausted (HTTP 402 Payment Required).");
        return {
          success: false,
          status: "COST_BLOCKED",
          videos: [],
          observations: [],
          retrievedCount: 0,
          creditsConsumed: 0,
          errors,
          warnings,
        };
      }
      if (res.status === 429) {
        errors.push("TikTok Organic provider rate limit exceeded (HTTP 429).");
        return {
          success: false,
          status: "RATE_LIMITED",
          videos: [],
          observations: [],
          retrievedCount: 0,
          creditsConsumed: 0,
          errors,
          warnings,
        };
      }
      if (res.status >= 500) {
        errors.push(`HasData upstream server error (HTTP ${res.status}).`);
        return {
          success: false,
          status: "FAILED",
          videos: [],
          observations: [],
          retrievedCount: 0,
          creditsConsumed: 0,
          errors,
          warnings,
        };
      }
      throw new Error(`HasData HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const json = await res.json();
    if (json?.error || (json?.success === false && json?.message)) {
      const errMsg = json.error || json.message || "HasData reported query failure";
      errors.push(`TikTok Organic provider returned error: ${errMsg}`);
      return {
        success: false,
        status: "QUERY_FAILED",
        videos: [],
        observations: [],
        retrievedCount: 0,
        creditsConsumed: 0,
        errors,
        warnings,
      };
    }

    const rawItems: any[] = Array.isArray(json.data)
      ? json.data
      : (Array.isArray(json.items) ? json.items : (Array.isArray(json.videos) ? json.videos : []));

    for (const raw of rawItems.slice(0, count)) {
      try {
        const normVideo = normalizeTikTokOrganicVideo(raw);
        videos.push(normVideo);

        observations.push({
          source: "TIKTOK_ORGANIC",
          sourceRecordId: normVideo.videoId,
          sourceUrl: normVideo.canonicalUrl,
          advertiserOrCreator: normVideo.creatorHandle,
          advertiserDomain: null,
          productMatchHint: normVideo.caption,
          reportedPublishedAt: normVideo.publishedAt,
          reportedFirstShownAt: normVideo.publishedAt,
          reportedLastShownAt: null,
          observedAt: normVideo.observedAt,
          requestedMarket: query.market || "US",
          verifiedDeliveryMarket: normVideo.targetMarketEvidence,
          title: normVideo.caption?.slice(0, 80) || "TikTok Product Video",
          description: normVideo.caption,
          metrics: {
            views: normVideo.views,
            likes: normVideo.likes,
            comments: normVideo.comments,
            shares: normVideo.shares,
            engagementRatio: normVideo.observedEngagementRatio,
            lifetimeViewsPerDay: normVideo.lifetimeViewsPerDayEstimate,
          },
          media: {
            thumbnailUrl: normVideo.thumbnailUrl,
            videoUrl: normVideo.videoUrl,
            mediaType: "VIDEO",
          },
          provenance: "REAL_UPSTREAM",
          evidenceReference: `TikTokVideo:${normVideo.videoId}`,
        });
      } catch (parseErr: any) {
        warnings.push(`Skipped malformed TikTok video: ${parseErr.message}`);
      }
    }

    return {
      success: true,
      status: videos.length > 0 ? "PASSED" : "QUERY_SUCCEEDED_EMPTY",
      videos,
      observations,
      retrievedCount: videos.length,
      creditsConsumed: 10,
      errors,
      warnings,
    };
  } catch (err: any) {
    errors.push(err.message || "Failed to execute TikTok organic search");
    return {
      success: false,
      status: "FAILED",
      videos: [],
      observations: [],
      retrievedCount: 0,
      creditsConsumed: 0,
      errors,
      warnings,
    };
  }
}

/**
 * Collects public TikTok organic product videos for a research topic (IntelligenceQuery wrapper).
 */
export async function collectTikTokOrganicSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();

  // Check budget safeguards
  // The collector verifies actual Free-plan quota before allowing any paid-policy exception.
  const result = await collectTikTokOrganicEvidence(
    {
      topic: query.topic,
      maxResults: query.maxResults,
      market: query.market,
      signal: query.signal,
    },
    { targetMarket: query.market }
  );

  return {
    source: "TIKTOK_ORGANIC",
    status: result.status,
    observations: result.observations,
    retrievedCount: result.retrievedCount,
    acceptedCount: result.observations.length,
    rejectedCount: 0,
    estimatedCredits: 10,
    consumedCredits: result.creditsConsumed,
    startedAt,
    completedAt: new Date().toISOString(),
    errors: result.errors,
    warnings: result.warnings,
  };
}
