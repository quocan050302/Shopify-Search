/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Product Discovery + PDP Evidence via Jina Reader REST (NO API KEY)
 *
 * Strict provider-specific types for Walmart US marketplace evidence.
 * Keeps query execution status, marketplace presence, stock state, and identity match
 * as four independent dimensions. Never conflatesWalmart evidence with Amazon types
 * or treats marketplace presence as proof of 60-day demand or sales.
 */

import crypto from "crypto";

export type WalmartQueryExecutionStatus =
  | "DISABLED"
  | "NOT_ATTEMPTED"
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "TIMED_OUT"
  | "BLOCKED_PROVIDER"
  | "RATE_LIMITED"
  | "PARSE_ERROR"
  | "UNAVAILABLE"
  | "BUDGET_EXHAUSTED"
  | "DEFERRED"
  | "CANCELLED"
  | "KEY_OR_PAYMENT_REQUIRED"
  | "FAILED";

export type MarketplacePresence = "FOUND" | "NO_MATCH_IN_SCOPE" | "UNKNOWN";

export type MatchLevel = "EXACT" | "SIMILAR" | "UNCERTAIN";

export type StockState = "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";

export type EvidenceOrigin =
  | "REAL_JINA_READER"
  | "TEST_FIXTURE"
  | "USER_IMPORTED"
  | "CACHE_ONLY";

export type WalmartSchemaCompatibility =
  | "OBSERVED_BASELINE_SCHEMA"
  | "SUPPORTED_VARIANT"
  | "UNSUPPORTED_SCHEMA";

export type WalmartAppearanceProvenance = "ORGANIC" | "SPONSORED";

export interface WalmartSearchIntent {
  intentId: string;
  candidateId: string;
  rank: number;
  rawQuery: string;
  normalizedQuery: string;
  encodedQuery: string;
  targetWalmartUrl: string;
  jinaReaderUrl: string;
  derivationBasis: Array<
    | "MERCHANT_VERIFIED_NAME"
    | "CANONICAL_PRODUCT_NAME"
    | "BRAND"
    | "MODEL"
    | "GTIN_UPC"
    | "SKU"
  >;
  excludedSignals: string[];
}

export interface WalmartPilotPolicyLimits {
  maxConcurrentOperationsPerProviderGroup: number;
  maxLogicalOperationsPerRun: number;
  maxAttemptsPerOperation: number;
  maxNetworkAttemptsPerRun: number;
  maxRequestsPerMinuteAcrossWorkers: number;
  rollingWindowMs: number;
  httpTimeoutMs: number;
  minRetryBackoffMs: number;
  maxOperationDeadlineMs: number;
  maxResponseBytes: number;
  maxNextDataBytes: number;
}

export interface WalmartPilotPolicy {
  provider: "WALMART_US";
  featureEnabled: boolean;
  liveAllowed: boolean;
  freeReaderMode: true;
  requiresApiKey: false;
  authenticated: false;
  paidFallbackAllowed: false;
  status: WalmartQueryExecutionStatus;
  reason: string;
  limits: WalmartPilotPolicyLimits;
}

export interface WalmartJinaRequestOptions {
  operationKind: "SEARCH" | "PDP";
  query?: string | null;
  itemId?: string | null;
  workspaceId: string;
  researchRunId: string;
  candidateId?: string | null;
  logicalOperationId?: string;
  attemptNumber?: number;
  attemptGeneration?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
  evidenceOrigin?: EvidenceOrigin;
  /**
   * Optional deterministic transport override for offline tests / Mode A emulator ONLY.
   * Any response produced via custom transport or non-r.jina.ai origin is strictly forced to TEST_FIXTURE.
   */
  customFetch?: typeof fetch;
  allowTestFixtureOrigin?: boolean;
}

export interface WalmartJinaEnvelopeData {
  title: string | null;
  description: string | null;
  url: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  html: string | null;
  publishedTime: string | null;
  cacheStatus: string | null;
  fieldAliasUsed: string | null;
}

export interface WalmartJinaResponse {
  ok: boolean;
  queryStatus: WalmartQueryExecutionStatus;
  operationKind: "SEARCH" | "PDP";
  requestUrl: string;
  targetWalmartUrl: string;
  requestHeadersSent: Record<string, string>;
  outerHttpStatus: number | null;
  innerHttpStatus: number | null;
  contentType: string | null;
  retryAfterMs: number | null;
  retryAfterRaw: string | null;
  requestedNoCache: boolean;
  observedCacheMetadata: string | null;
  envelope: WalmartJinaEnvelopeData | null;
  rawBodyBytes: number;
  requestHash: string;
  responseHash: string;
  upstreamRequestId: string | null;
  localRequestRef: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  aborted: boolean;
  timedOut: boolean;
  retryable: boolean;
  stopFreePilot: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  evidenceOrigin: EvidenceOrigin;
}

export interface WalmartSearchListing {
  itemId: string;
  usItemId: string;
  title: string;
  brand: string | null;
  canonicalProductUrl: string;
  rawCanonicalUrl: string | null;
  price: number | null;
  currency: string | null;
  sellerName: string | null;
  availability: StockState;
  isSponsored: boolean;
  appearanceProvenance: WalmartAppearanceProvenance[];
  positionIndex: number;
  modelNumber: string | null;
  upc: string | null;
  variantSummary: string | null;
  rawItemHash: string;
}

export interface WalmartPdpProduct {
  itemId: string;
  usItemId: string;
  title: string;
  brand: string | null;
  model: string | null;
  upc: string | null;
  gtin: string | null;
  price: number | null;
  currency: string | null;
  sellerDisplayName: string | null;
  availabilityStatusV2: string | null;
  availability: StockState;
  canonicalUrl: string;
  rawCanonicalUrl: string | null;
  locationPostalCode: string | null;
  locationStoreIds: string[];
  locationCityOrState: string | null;
  variantAttributes: Record<string, string>;
  condition: "NEW" | "REFURBISHED" | "USED" | "UNKNOWN";
  packSizeCount: number | null;
  isAccessoryOrPart: boolean;
  schemaCompatibility: WalmartSchemaCompatibility;
  schemaFieldPaths: string[];
  rawProductHash: string;
}

export interface WalmartIdentityDecision {
  candidateId: string;
  walmartItemId: string | null;
  matchLevel: MatchLevel;
  verifiedIdentity: boolean;
  presence: MarketplacePresence;
  matchedByGtinUpc: boolean;
  matchedByModel: boolean;
  matchedByBrand: boolean;
  titleTokenOverlapRatio: number;
  isAccessoryMismatch: boolean;
  isPackOrBundleMismatch: boolean;
  isConditionMismatch: boolean;
  isVariantMismatch: boolean;
  isWrongModelMismatch: boolean;
  matchReasons: string[];
  rejectionReasons: string[];
  missingFields: string[];
}

export interface WalmartQueryScopeMetadata {
  query: string | null;
  normalizedQuery: string | null;
  market: "US";
  checkedSearchCount: number;
  checkedPdpCount: number;
  rawSearchResultCount: number | null;
  dedupedSearchResultCount: number | null;
  completeSearchScope: boolean;
}

export interface WalmartProductEvidence {
  id: string;
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  provider: "WALMART_US";
  itemId: string | null;
  canonicalProductUrl: string | null;
  sourceUrl: string;
  finalUrl: string | null;
  title: string | null;
  brand: string | null;
  model: string | null;
  /**
   * Barcode / UPC / GTIN preserved strictly as a digit string (including leading zeros, e.g. "027242930698").
   * Never coerced to JS number or scientific notation.
   */
  upc: string | null;
  price: number | null;
  currency: string | null;
  seller: string | null;
  locationPostalCode: string | null;
  locationStoreIds: string[];
  availability: StockState;
  queryStatus: WalmartQueryExecutionStatus;
  presence: MarketplacePresence;
  matchLevel: MatchLevel;
  verifiedIdentity: boolean;
  matchReasons: string[];
  rejectionReasons: string[];
  missingFields: string[];
  appearanceProvenance: WalmartAppearanceProvenance[];
  schemaCompatibility: WalmartSchemaCompatibility;
  schemaFieldPaths: string[];
  evidenceOrigin: EvidenceOrigin;
  isCached: boolean;
  isStale: boolean;
  requestedNoCache: boolean;
  observedCacheMetadata: string | null;
  requestHash: string;
  responseHash: string;
  rawEvidenceHash: string;
  extractedFieldsHash: string;
  localRequestRef: string;
  upstreamRequestId: string | null;
  lastAttemptAt: string | null;
  observedAt: string | null;
  lastSuccessfulLiveQueryAt: string | null;
  queryScope: WalmartQueryScopeMetadata;
  nonInflationNotice: string;
}

export interface WalmartProviderRequestRecord {
  requestId: string;
  localRequestRef: string;
  upstreamRequestId: string | null;
  workspaceId: string;
  researchRunId: string;
  candidateId: string | null;
  logicalOperationId: string;
  operationKind: "SEARCH" | "PDP";
  attemptNumber: number;
  attemptGeneration: number;
  query: string | null;
  itemId: string | null;
  requestUrl: string;
  targetWalmartUrl: string;
  headersSent: Record<string, string>;
  outerHttpStatus: number | null;
  innerHttpStatus: number | null;
  queryStatus: WalmartQueryExecutionStatus;
  evidenceOrigin: EvidenceOrigin;
  requestedNoCache: boolean;
  observedCacheMetadata: string | null;
  retryAfterMs: number | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  aborted: boolean;
  timedOut: boolean;
  requestHash: string;
  responseHash: string;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WalmartProviderTelemetry {
  provider: "WALMART_US";
  workspaceId: string;
  researchRunId: string;
  featureEnabled: boolean;
  liveAllowed: boolean;
  freeReaderMode: true;
  requiresApiKey: false;
  authenticated: false;
  chargedCreditsOrDollars: 0;
  overallStatus: WalmartQueryExecutionStatus;
  statusReason: string;
  shortlistedTargetsCount: number;
  logicalOperationsUsed: number;
  logicalOperationsLimit: number;
  networkAttemptsUsed: number;
  networkAttemptsLimit: number;
  searchOperationsCount: number;
  pdpOperationsCount: number;
  succeededCount: number;
  partialCount: number;
  deferredCount: number;
  timedOutCount: number;
  rateLimitedCount: number;
  blockedProviderCount: number;
  parseErrorCount: number;
  cancelledCount: number;
  foundCount: number;
  noMatchInScopeCount: number;
  unknownPresenceCount: number;
  exactMatchCount: number;
  similarMatchCount: number;
  uncertainMatchCount: number;
  realJinaVerifiedCount: number;
  fixtureOrCachedCount: number;
  rollingMinuteRequestsObserved: number;
  rollingMinuteLimit: number;
  cooldownUntil: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulLiveQueryAt: string | null;
  persistenceStatus: "NOT_APPLICABLE" | "PERSISTED" | "PERSISTENCE_FAILED" | "SKIPPED_DISABLED";
  persistenceError: string | null;
  requestLedger: WalmartProviderRequestRecord[];
}

export interface WalmartEvidenceSummary {
  visible: boolean;
  provider: "WALMART_US";
  candidateId: string;
  researchRunId: string;
  queryStatus: WalmartQueryExecutionStatus;
  presence: MarketplacePresence;
  matchLevel: MatchLevel;
  verifiedIdentity: boolean;
  itemId: string | null;
  canonicalWalmartUrl: string | null;
  title: string | null;
  brand: string | null;
  model: string | null;
  upc: string | null;
  price: number | null;
  currency: string | null;
  priceDisplay: string;
  seller: string | null;
  locationPostalCode: string | null;
  locationStoreIds: string[];
  locationDisplay: string | null;
  availability: StockState;
  evidenceOrigin: EvidenceOrigin;
  isCached: boolean;
  isStale: boolean;
  observedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulLiveQueryAt: string | null;
  rawEvidenceHash: string | null;
  statusReason: string;
  matchReasons: string[];
  rejectionReasons: string[];
  missingFields: string[];
  appearanceProvenance: WalmartAppearanceProvenance[];
  queryScope: WalmartQueryScopeMetadata;
  nonInflationNotice: string;
}

export const WALMART_NON_INFLATION_NOTICE =
  "Walmart US listing evidence is a read-only marketplace reference via Jina Reader REST (no API key). It does NOT prove unit sales, 60-day demand persistence (G15), or merchant product-page verification (G16), and does NOT inflate KH-02 opportunity scores.";

export function computeWalmartDeterministicHash(payload: unknown): string {
  const canonical = JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (value as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return value;
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
