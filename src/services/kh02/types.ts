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
  | "NOT_INSTALLED"
  | "CREDENTIALS_REQUIRED"
  | "NOT_CONFIGURED"
  | "NOT_PROBED"
  | "MCP_NOT_CONFIGURED"
  | "MCP_TRANSPORT_FAILURE"
  | "CONFIGURED"
  | "CONNECTING"
  | "CONNECTED"
  | "TRANSPORT_CONNECTED"
  | "TRANSPORT_FAILED"
  | "AUTHENTICATED"
  | "AUTHENTICATION_FAILED"
  | "AUTH_NOT_REQUIRED"
  | "CAPABILITY_VERIFIED"
  | "UNSUPPORTED_CAPABILITY"
  | "COST_BLOCKED"
  | "QUOTA_UNKNOWN"
  | "QUOTA_EXCEEDED"
  | "QUERY_EXECUTED"
  | "QUERY_FAILED"
  | "QUERY_SUCCEEDED_EMPTY"
  | "LIVE_DATA_VERIFIED"
  | "CACHE_ONLY"
  | "MANUAL_ONLY"
  | "SOURCE_ACCESS_VERIFIED"
  | "SOURCE_DATA_VERIFIED"
  | "MANUAL_RESEARCH_ONLY"
  | "ENGINE_READY"
  | "INSUFFICIENT_HISTORY"
  | "NOT_VERIFIED"
  | "UNSUPPORTED_REGION"
  | "BLOCKED"
  | "BLOCKED_SOURCE"
  | "RATE_LIMITED"
  | "NO_RESULTS"
  | "FAILED"
  | "SKIPPED";

export type ProviderAccessClass =
  | "ZERO_KEY_AUTHORIZED"
  | "FREE_ACCOUNT_REQUIRED"
  | "FREE_API_KEY_REQUIRED"
  | "PAID_CREDENTIAL_REQUIRED"
  | "LOCAL_COLLECTOR_AVAILABLE"
  | "MANUAL_IMPORT_ONLY"
  | "UNSUPPORTED";

export interface ProviderReadiness {
  providerId: string;
  accessClass: ProviderAccessClass;

  installed: boolean;
  configured: boolean;
  transportConnected: boolean;
  authenticated: boolean | null;
  requiredCapabilityAvailable: boolean;

  realQueryExecuted: boolean;
  realQuerySucceeded: boolean;
  realRecordsObserved: number;

  lastSuccessfulQueryAt: string | null;
  dataFreshness: string | null;

  costApprovalRequired: boolean;
  blockerCode: string | null;
  blockerReason: string | null;
}

export interface ProviderDiscoveryContext {
  workspaceId?: string;
  allowPaidOperations?: boolean;
}

export interface ProviderProbeContext {
  workspaceId?: string;
  timeoutMs?: number;
  allowPaidOperations?: boolean;
}

export interface ProviderCapabilities {
  providerId: string;
  accessClass: ProviderAccessClass;
  installed: boolean;
  configured: boolean;
  transportConnected: boolean;
  supportedTools: string[];
  supportsUS: boolean;
  supportsKeywordSearch: boolean;
  supportsDateFiltering: boolean;
  estimatedCostPerQueryCredits: number;
  pricingSource: string;
  blockerReason: string | null;
}

export interface ProviderDiscoveryResult {
  providerId: string;
  displayName: string;
  accessClass: ProviderAccessClass;
  readiness: ProviderReadiness;
  capabilities: ProviderCapabilities;
  recommendedAction?: string;
}

export interface ProviderReadinessDimensions {
  adapterInstalled: boolean;
  configured: boolean;
  transportConnected: boolean | null;
  authenticated: boolean | null;
  supportedOperationsVerified: boolean;
  queryExecuted: boolean;
  sourceDataVerified: boolean;
  lastLiveQueryAt: string | null;
  blockerCode: string | null;

  // V12.2.2 Explicit Separated Diagnostic Telemetry
  storedRecordCount?: number | null;
  lastLiveQueryRecordCount?: number | null;
  currentRunRecordCount?: number | null;
  lastSuccessfulLiveQueryAt?: string | null;
  lastProbeAt?: string | null;
  authStatus?: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED";
  transportStatus?: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED";
  capabilityStatus?: "VERIFIED" | "UNSUPPORTED" | "NOT_TESTED";

  // KH-02 Truthful Query Provenance & Failure Trace
  queryStatus?: SourceRunStatus | string | null;
  queryProvenance?: ObservationProvenance | null;
  isLive?: boolean | null;
  queryError?: string | null;
  lastSuccessfulRecordCount?: number | null;
}

export interface ProviderSourceTelemetry {
  source: IntelligenceSource;
  status: SourceRunStatus;
  queryExecuted: boolean;
  isLive: boolean;
  retrievedCount: number | null;
  acceptedCount: number | null;
  productAssociatedCount?: number | null;
  storedRecordCount?: number | null;
  provenance: ObservationProvenance;
  lastLiveQueryAt: string | null;
  lastSuccessfulLiveQueryAt: string | null;
  lastSuccessfulRecordCount?: number | null;
  error?: string | null;
  warning?: string | null;
}

export type ObservationProvenance =
  | "REAL_UPSTREAM"
  | "USER_IMPORTED"
  | "VERIFIED_SOURCE"
  | "UNKNOWN"
  | "TEST_FIXTURE"
  | "LIVE_PROVIDER"
  | "VERIFIED_IMPORTED"
  | "MANUAL_IMPORT"
  | "CACHED_SOURCE"
  | "CONTROLLED_FIXTURE"
  | "UNVERIFIED";


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
  landingPageUrl?: string | null;
  sourceExternalAdId?: string | null;
  storeDomainEvidence?: string | null;
  advertiserOrCreator: string | null;
  advertiserDomain: string | null;
  productMatchHint?: string | null;
  reportedPublishedAt?: string | null;
  reportedFirstShownAt?: string | null;
  reportedLastShownAt?: string | null;
  observedAt: string;
  requestedMarket: string;
  verifiedDeliveryMarket: string | null;
  title: string | null;
  description?: string | null;
  metrics?: Record<string, unknown>;
  media: {
    thumbnailUrl?: string | null;
    videoUrl?: string | null;
    embedUrl?: string | null;
    mediaType?: string | null;
  };
  provenance: ObservationProvenance;
  evidenceReference?: string | null;
  researchProductId?: string | null;
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

export interface ProductEvidenceMatchResult {
  candidateId: string;
  sourceRecordId: string;
  source: IntelligenceSource;
  matchConfidence:
    | "EXACT"
    | "HIGH_CONFIDENCE"
    | "PROBABLE"
    | "AMBIGUOUS"
    | "REJECTED";
  relevance:
    | "PRODUCT_SPECIFIC"
    | "BRAND_RELATED"
    | "CATEGORY_RELATED"
    | "UNRELATED"
    | "UNKNOWN";
  acceptedForScoring: boolean;
  requiresManualReview: boolean;
  matchReasons: string[];
  evidenceReference: string | null;
}

