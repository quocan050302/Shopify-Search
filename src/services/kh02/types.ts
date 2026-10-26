/**
 * SWAI KH-02 — Multi-Source Intelligence Types & Contracts
 *
 * Defines unified contracts for cross-platform research:
 * 1. Meta Ads (Facebook/Instagram competitor advertising)
 * 2. TikTok Ads (US-relevant paid advertising creatives)
 * 3. TikTok Organic (public product videos, view counts, engagement)
 * 4. Google Ads (Google Ads Transparency Center advertiser & creative evidence)
 * 5. Demand History (Google Trends time series & persistence observations)
 */

export type IntelligenceSource =
  | "META_ADS"
  | "TIKTOK_ADS"
  | "TIKTOK_ORGANIC"
  | "GOOGLE_ADS"
  | "DEMAND_HISTORY";

export type SourceRunStatus =
  | "PASSED"
  | "PARTIAL"
  | "NOT_CONFIGURED"
  | "NOT_VERIFIED"
  | "UNSUPPORTED_REGION"
  | "BLOCKED_SOURCE"
  | "RATE_LIMITED"
  | "NO_RESULTS"
  | "FAILED"
  | "SKIPPED";

export type ObservationProvenance =
  | "REAL_UPSTREAM"
  | "USER_IMPORTED"
  | "VERIFIED_SOURCE"
  | "UNKNOWN"
  | "TEST_FIXTURE";

export type ProductMatchConfidence =
  | "EXACT"
  | "HIGH_CONFIDENCE"
  | "PROBABLE"
  | "AMBIGUOUS"
  | "REJECTED";

export interface SourceCapabilities {
  source: IntelligenceSource;
  displayName: string;
  supportsUS: boolean;
  supportsKeywordSearch: boolean;
  supportsAdvertiserSearch: boolean;
  supportsPagination: boolean;
  supportsDateFiltering: boolean;
  supportsNewestSorting: boolean;
  supportsVideoMetadata: boolean;
  supportsEngagementMetrics: boolean;
  supportsHistoricalObservations: boolean;
  coverageDescription: string;
  isOfficialAPI: boolean;
  isPaidOrMetered: boolean;
  estimatedCostPerQueryCredits: number;
}

export interface IntelligenceQuery {
  workspaceId: string;
  researchRunId: string;
  topic: string;
  market: "US";
  productKeywords?: string[];
  advertiserNames?: string[];
  advertiserDomains?: string[];
  lookbackDays: number;
  maxResults: number;
  signal?: AbortSignal;
}

export interface SourceObservation {
  source: IntelligenceSource;
  sourceRecordId: string;
  sourceUrl: string | null;
  advertiserOrCreator: string | null;
  advertiserDomain: string | null;
  productMatchHint: string | null;
  reportedPublishedAt: string | null;
  reportedFirstShownAt: string | null;
  reportedLastShownAt: string | null;
  observedAt: string;
  requestedMarket: string;
  verifiedDeliveryMarket: string | null;
  title: string | null;
  description: string | null;
  metrics: Record<string, unknown>;
  media: {
    thumbnailUrl?: string | null;
    videoUrl?: string | null;
    embedUrl?: string | null;
    mediaType?: string | null;
  };
  provenance: ObservationProvenance;
  evidenceReference: string | null;
}

export interface SourceResearchResult {
  source: IntelligenceSource;
  status: SourceRunStatus;
  observations: SourceObservation[];
  retrievedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  nextCursor?: string | null;
  estimatedCredits: number;
  consumedCredits: number;
  startedAt: string;
  completedAt: string;
  errors: string[];
  warnings: string[];
}

// ─── Source-Specific Normalized Models ────────────────────────────────────────

export interface TikTokOrganicVideo {
  videoId: string;
  canonicalUrl: string;
  creatorId: string | null;
  creatorHandle: string | null;
  caption: string | null;
  hashtags: string[];
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  observedAt: string;
  observedEngagementRatio: number | null; // (likes + comments + shares) / views
  lifetimeViewsPerDayEstimate: number | null;
  productMatchConfidence: ProductMatchConfidence;
  sourceProvenance: ObservationProvenance;
  targetMarketEvidence: string | null;
}

export interface GoogleTransparencyAd {
  advertiserId: string;
  advertiserName: string;
  domain: string;
  creativeId: string;
  adFormat: "VIDEO" | "IMAGE" | "TEXT" | "UNKNOWN";
  observedContent: string | null;
  lastShownDate: string | null;
  googleSourceUrl: string | null;
  observedAt: string;
  productRelevance: "PRODUCT_SPECIFIC" | "BRAND_RELATED" | "UNRELATED" | "UNKNOWN";
  productRelevanceReason?: string;
  sourceProvenance: ObservationProvenance;
}

export interface MetaResearchSignals {
  adId: string;
  externalAdId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  storeDomain: string | null;
  headline: string | null;
  bodyText: string | null;
  landingPageUrl: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysRunning: number;
  status: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  mediaType: string;
  observationsCount: number;
  sourceConfidence: string;
  productMatchHint: string | null;
}

export interface TikTokAdsSignals {
  adId: string;
  advertiserName: string | null;
  advertiserDomain: string | null;
  caption: string | null;
  landingPageUrl: string | null;
  observedAt: string;
  reportedRunDays?: number | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  isUSVerified: boolean;
  sourceStatus: SourceRunStatus;
}
