/**
 * SWAI KH-02 V12.4.3.5.0 — Marketplace Product Evidence Types & Contracts
 *
 * Defines strict, typed contracts for the Amazon US Product Evidence Pilot.
 * Designed as a clean marketplace adapter contract (supporting future V12.4.3.5.1
 * Walmart US extension without implementing Walmart in V12.4.3.5.0).
 *
 * Core Invariants:
 * 1. Separate from IntelligenceSource ad-source maps so existing Meta/Google/Demand
 *    exhaustive switch/record maps remain unregressed.
 * 2. Strict separation between local `providerInvocationRef` and upstream `providerRequestId` (null when absent).
 * 3. `verificationScope` is strictly `LISTING_OBSERVED` or `IDENTITY_CORROBORATED` — never `SALES_VERIFIED`.
 * 4. `observationClass` distinguishes `AUTHORIZED_LIVE`, `IMPORTED_BY_USER`, `CACHED`, `TEST_FIXTURE`, and `UNVERIFIED`.
 */

import crypto from "crypto";

export type MarketplaceSource = "AMAZON_US";

export type MarketplaceEvidenceStatus =
  | "DISABLED"
  | "CREDENTIALS_REQUIRED"
  | "ACCESS_NOT_GRANTED"
  | "AUTHENTICATION_FAILED"
  | "PROVIDER_ERROR"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_ATTEMPTED"
  | "NOT_AUTHORIZED"
  | "NOT_IMPLEMENTED"
  | "NOT_EXECUTED"
  | "PDP_NOT_EXECUTED"
  | "SEARCH_BLOCKED_POLICY"
  | "MCP_NOT_CONFIGURED"
  | "BLOCKED_POLICY"
  | "BLOCKED_PROVIDER"
  | "RATE_LIMITED"
  | "CAPTCHA_BLOCKED"
  | "TIMED_OUT"
  | "QUERY_SUCCEEDED_EMPTY"
  | "OBSERVED_UNVERIFIED"
  | "IDENTITY_VERIFIED"
  | "PARTIAL"
  | "FAILED";

export type IdentityMatch =
  | "EXACT_PRODUCT"
  | "PROBABLE_PRODUCT"
  | "BRAND_ONLY"
  | "NO_MATCH"
  | "AMBIGUOUS";

export type AmazonSearchIdentityVerdict =
  | "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
  | "MISMATCH_ASIN"
  | "MISMATCH_TITLE"
  | "INSUFFICIENT_EVIDENCE"
  | "DIRECT_PDP_ONLY"
  | "SEARCH_ONLY_NOT_VERIFIED";

export type AmazonMetaCandidateEquivalenceVerdict =
  | "EXACT_PRODUCT"
  | "PROBABLE_SAME_FAMILY"
  | "CATEGORY_ONLY"
  | "CONTRADICTORY_MODEL"
  | "CONTRADICTORY_BRAND"
  | "MISSING_IDENTIFIERS"
  | "UNVERIFIED";

export type AmazonCombinedIdentityVerdict =
  | "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
  | "AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED"
  | "AMAZON_DIRECT_PDP_OBSERVED_META_MATCH_UNVERIFIED"
  | "DISCOVERED_NOT_VERIFIED"
  | "REJECTED_IDENTITY";

export type MarketplaceObservationClass =
  | "AUTHORIZED_LIVE"
  | "IMPORTED_BY_USER"
  | "CACHED"
  | "TEST_FIXTURE"
  | "UNVERIFIED";

export type MarketplaceVerificationScope =
  | "LISTING_OBSERVED"
  | "IDENTITY_CORROBORATED";

export type AmazonProviderSourceOrigin =
  | "AUTHORIZED_CREATORS_API"
  | "PINNED_PLAYWRIGHT_MCP"
  | "LOCAL_MCP_TEST_DOUBLE"
  | "USER_IMPORTED"
  | "TEST_FIXTURE"
  | "NONE";

export type AmazonHttpStatusOrigin = "OBSERVED" | "UNOBSERVED_NULL";

export type AmazonAccessPolicyStatus =
  | "DISABLED_BY_DEFAULT"
  | "LIVE_NOT_ALLOWED"
  | "CREDENTIALS_REQUIRED"
  | "ACCESS_NOT_GRANTED"
  | "BLOCKED_POLICY"
  | "AUTHORIZED_CREATORS_API"
  | "AUTHORIZED_CREATORS_API_CONFIGURED"
  | "AUTHORIZED_USER_LIMITED_URL"
  | "FIXTURE_OR_USER_IMPORT_ONLY";

export type AmazonRequestMode =
  | "URL_VERIFICATION"
  | "AUTHORIZED_SEARCH"
  | "USER_IMPORTED"
  | "TEST_FIXTURE"
  | "NONE";

export interface AmazonPolicyContext {
  featureEnabled: boolean;
  liveAllowed: boolean;
  creatorsApiConfigured: boolean;
  creatorsApiEntitlementVerified?: boolean;
  userAuthorizedUrlAttested: boolean;
  localMcpSearchAttested?: boolean;
  pilotRouteId?:
    | "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT"
    | "AMAZON_CREATORS_API"
    | "ISOLATED_FIXTURE_ONLY"
    | "NONE";
  localMcpPilotPermitted?: boolean;
  localMcpSearchPermitted?: boolean;
  creatorsApiIndependentOfLocalMcp?: boolean;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  allowedAccessRoute:
    | "OFFICIAL_CREATORS_API"
    | "CREATORS_API"
    | "CREATORS_API_NOT_IMPLEMENTED"
    | "USER_AUTHORIZED_URL"
    | "ISOLATED_FIXTURE_ONLY"
    | "NONE";
  policyReason: string;
}

export interface AmazonProductEvidence {
  id: string;
  operationId?: string | null;
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  provider: MarketplaceSource;
  requestMode: AmazonRequestMode;
  requestedMarket: "US";
  verifiedDeliveryMarket: "US" | null;
  observedDeliveryPostalCode?: string | null;
  sourceUrl: string | null;
  finalUrl: string | null;
  canonicalAmazonUrl: string | null;
  observedCanonicalUrl?: string | null;
  canonicalUrlOrigin?: "OBSERVED_CANONICAL" | "DERIVED_NORMALIZED_DP" | "NONE";
  observedSearchHref?: string | null;
  observedSearchHrefOrigin?: "OBSERVED_HREF" | "DERIVED_NORMALIZED_DP" | "NONE";
  searchRankPosition?: number | null;
  asin: string | null;
  parentAsin: string | null;
  variationAsin: string | null;
  productTitle: string | null;
  brand: string | null;
  merchant: string | null;
  seller: string | null;
  currency: string | null;
  price: number | null;
  availability: string | null;
  modelNumber?: string | null;
  sku?: string | null;
  gtin?: string | null;
  observedAt: string;
  sourceTimestamp: string | null;
  rawEvidenceHash: string | null;
  extractedFieldsHash: string | null;
  providerInvocationRef: string | null;
  providerRequestId: string | null;
  responseEvidenceRef: string | null;
  evidenceOrigin: string;
  providerSourceOrigin?: AmazonProviderSourceOrigin;
  httpStatus?: number | null;
  httpStatusOrigin?: AmazonHttpStatusOrigin;
  observationClass: MarketplaceObservationClass;
  verificationScope: MarketplaceVerificationScope | null;
  identityMatch: IdentityMatch;
  searchIdentityVerdict?: AmazonSearchIdentityVerdict;
  metaCandidateEquivalenceVerdict?: AmazonMetaCandidateEquivalenceVerdict;
  combinedIdentityVerdict?: AmazonCombinedIdentityVerdict;
  searchTitleTokenCoverage?: number | null;
  searchBrandCrossConfirmed?: boolean;
  searchModelCrossConfirmed?: boolean;
  commercialUsStatus?: "US_COMMERCIAL_VERIFIED" | "PARTIAL_US_COMMERCIAL" | "UNVERIFIED";
  sellerStatus?: "OBSERVED" | "NOT_OBSERVED";
  availabilityStatus?: "OBSERVED" | "NOT_OBSERVED";
  provenanceStatus?: "PROVENANCE_VERIFIED" | "UNVERIFIED";
  sessionLifecycleStatus?: "CLOSED_CLEANLY" | "UNVERIFIED";
  isCached: boolean;
  matchedCanonicalKey: string | null;
  productFamilyKey?: string | null;
  matchingReasons: string[];
  missingFields: string[];
  rejectionReasons: string[];
  sanitizationWarnings?: string[];
  extractionWarnings?: string[];
  fixtureSource?: string | null;
  referenceOrigin?: string | null;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  status: MarketplaceEvidenceStatus;
}

export interface AmazonProviderOperationRecord {
  operationId: string;
  providerInvocationRef: string;
  providerRequestId: string | null;
  providerRequestIdOrigin: "UPSTREAM" | "ABSENT";
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  provider: MarketplaceSource;
  requestMode: AmazonRequestMode;
  sourceUrl: string | null;
  finalUrl: string | null;
  attemptCount: number;
  maxAttemptsAllowed: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestHash: string | null;
  responseHash: string | null;
  status: MarketplaceEvidenceStatus;
  outcomeCategory: string;
  observationClass: MarketplaceObservationClass;
  transportSessionId: string | null;
  aborted: boolean;
  errorMessage: string | null;
}

export interface AmazonEvidenceGateEvaluation {
  evaluatedAt: string;
  researchRunId: string;
  workspaceId: string;
  provider: MarketplaceSource;
  engineeringVerdict: "ENGINEERING_READY" | "ENGINEERING_FAILED";
  realProviderVerdict:
    | "REAL_PROVIDER_VERIFIED"
    | "BLOCKED_POLICY"
    | "BLOCKED_PROVIDER"
    | "INSUFFICIENT_EVIDENCE"
    | "NOT_ATTEMPTED"
    | "DISABLED";
  overallPilotStatus:
    | "FEATURE_ACCEPTED"
    | "ENGINEERING_COMPLETE_EXTERNAL_BLOCKED"
    | "ENGINEERING_FAILED";
  policyStatus: AmazonAccessPolicyStatus;
  verifiedLiveAsins?: string[];
  distinctVerifiedProductFamilies?: number;
  distinctVerifiedProductFamilyKeys?: string[];
  distinctCandidateIds?: number;
  usDeliveryConfirmedCount?: number;
  USDeliveryConfirmedCount?: number;
  observedUsdPriceCount?: number;
  requiredLiveTargetsMet?: boolean;
  mcpSessionClosedCleanly?: boolean | null;
  mcpSessionLifecycle?: AmazonMcpSessionLifecycleProof | null;
  mcpSessionLifecycleProof?: AmazonMcpSessionLifecycleProof | null;
  mcpSessionVerifiedForLiveOperations?: boolean;
  counts: {
    totalEvidenceRows: number;
    sameRunWorkspaceVerifiedRows: number;
    authorizedLiveRows: number;
    fixtureOrCachedRowsExcludedFromLive: number;
    identityExactMatchCount: number;
    identityProbableMatchCount: number;
    brandOnlyMatchCount: number;
    rejectedCount: number;
    verifiedLiveUsProductIdentitiesCount: number;
    requiredLiveUsProductIdentitiesTarget: number;
    distinctVerifiedProductFamiliesCount?: number;
    distinctCandidateIdsCount?: number;
    usDeliveryConfirmedCount?: number;
    observedUsdPriceCount?: number;
  };
  g15DemandUnchanged: true;
  g16MerchantGateUnchanged: true;
  reasons: string[];
  blockers: string[];
}

export interface AmazonMcpSessionLifecycleProof {
  sessionId: string | null;
  transportMode:
    | "REAL_STDIO_MCP"
    | "TEST_DOUBLE"
    | "CREATORS_API_HTTP"
    | "FIXTURE_SNAPSHOT"
    | "NONE"
    | string
    | null;
  serverOrigin:
    | "PINNED_PLAYWRIGHT_MCP"
    | "LOCAL_TEST_SERVER"
    | "LOCAL_MCP_TEST_DOUBLE"
    | "TEST_FIXTURE"
    | "NONE";
  ownershipMode: "ADAPTER_OWNED" | "CALLER_BORROWED" | "OWNED" | "BORROWED" | "NONE";
  ownedChildPid: number | null;
  startedAt: string | null;
  lastToolCompletedAt: string | null;
  closeStartedAt: string | null;
  closeFinishedAt: string | null;
  closedCleanly: boolean | "UNKNOWN";
  ownedChildPidTerminated: boolean | "UNKNOWN";
  closeError: string | null;
  toolInvocationsCount?: number;
  observedOperationIds: string[];
  allLiveOpsMatchSessionId?: boolean;
  // Backward-compatible telemetry fields
  sessionCreated?: boolean;
  transportKind?: string | null;
  reusedAcrossCandidates?: boolean;
  closedInFinally?: boolean;
  toolCallCount?: number;
}

export interface AmazonMarketplaceTelemetry {
  provider: MarketplaceSource;
  featureEnabled: boolean;
  liveAllowed: boolean;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  allowedAccessRoute: string;
  runStatus: MarketplaceEvidenceStatus;
  operationsAttempted: number;
  operationsSucceeded: number;
  operationsBlocked: number;
  candidatesEvaluated: number;
  identityVerifiedCount: number;
  probableMatchCount: number;
  brandOnlyCount: number;
  rejectedCount: number;
  notAttemptedCount: number;
  operationLedger: AmazonProviderOperationRecord[];
  rejectionLedger: Array<{
    candidateId: string;
    sourceUrl: string | null;
    asin: string | null;
    status: MarketplaceEvidenceStatus;
    rejectionReasons: string[];
    observedAt: string;
    researchRunId: string;
  }>;
  gateEvaluation?: AmazonEvidenceGateEvaluation;
  persistenceStatus?: "PERSISTED" | "NOT_REQUIRED" | "FAILED";
  persistenceError?: string | null;
  mcpSessionLifecycle?: AmazonMcpSessionLifecycleProof;
  discoverySummary?: {
    discoveryAttempted: boolean;
    discoveryStatus: MarketplaceEvidenceStatus;
    searchQueriesPlanned: number;
    searchOperationsAttempted: number;
    getItemsOperationsAttempted: number;
    listingsReturnedCount: number;
    exactMatchesSelectedCount: number;
    probableMatchesSelectedCount: number;
    brandOnlyMatchesCount: number;
    rejectedListingsCount: number;
  };
  localMcpPilotDiagnostics?: {
    routeId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT";
    transportHandshakeStatus: "SUCCEEDED" | "FAILED" | "NOT_ATTEMPTED";
    actualBrowserToolExecutionStatus:
      | "SUCCEEDED"
      | "FAILED"
      | "BLOCKED_POLICY"
      | "NOT_ATTEMPTED";
    realAmazonPageObservationStatus:
      | "PUBLIC_PAGE_OBSERVED"
      | "BLOCKED_CAPTCHA_OR_BOT_WALL"
      | "FAILED"
      | "NOT_ATTEMPTED";
    productIdentityVerificationStatus:
      | "IDENTITY_VERIFIED"
      | "OBSERVED_UNVERIFIED"
      | "REJECTED_IDENTITY"
      | "NOT_ATTEMPTED";
    creatorsApiAvailabilityStatus:
      | "ELIGIBLE_CONFIGURED"
      | "CREDENTIALS_ABSENT"
      | "NOT_REQUIRED_FOR_LOCAL_MCP_PILOT";
    searchBlockedPolicyCount: number;
    pdpNotExecutedCount: number;
  };
}

export interface ProductAmazonEvidenceSummary {
  candidateId: string;
  researchRunId: string;
  provider: MarketplaceSource;
  visible: boolean;
  status: MarketplaceEvidenceStatus;
  statusLabel: string;
  asin: string | null;
  parentAsin: string | null;
  variationAsin: string | null;
  canonicalAmazonUrl: string | null;
  observedCanonicalUrl?: string | null;
  canonicalUrlOrigin?: "OBSERVED_CANONICAL" | "DERIVED_NORMALIZED_DP" | "NONE";
  observedSearchHref?: string | null;
  observedSearchHrefOrigin?: "OBSERVED_HREF" | "DERIVED_NORMALIZED_DP" | "NONE";
  searchRankPosition?: number | null;
  productTitle: string | null;
  brand: string | null;
  modelNumber?: string | null;
  seller?: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  observedDeliveryPostalCode?: string | null;
  identityMatch: IdentityMatch;
  identityMatchLabel: string;
  searchIdentityVerdict?: AmazonSearchIdentityVerdict;
  metaCandidateEquivalenceVerdict?: AmazonMetaCandidateEquivalenceVerdict;
  combinedIdentityVerdict?: AmazonCombinedIdentityVerdict;
  commercialUsStatus?: "US_COMMERCIAL_VERIFIED" | "PARTIAL_US_COMMERCIAL" | "UNVERIFIED";
  sellerStatus?: "OBSERVED" | "NOT_OBSERVED";
  availabilityStatus?: "OBSERVED" | "NOT_OBSERVED";
  provenanceStatus?: "PROVENANCE_VERIFIED" | "UNVERIFIED";
  observationClass: MarketplaceObservationClass;
  verificationScope: MarketplaceVerificationScope | null;
  providerSourceOrigin?: AmazonProviderSourceOrigin;
  httpStatus?: number | null;
  httpStatusOrigin?: AmazonHttpStatusOrigin;
  observedAt: string | null;
  providerInvocationRef: string | null;
  providerRequestId: string | null;
  rawEvidenceHash: string | null;
  extractedFieldsHash: string | null;
  matchingReasons: string[];
  missingFields: string[];
  rejectionReasons: string[];
  nonInflationNotice: string;
}

function canonicalizeForDigest(val: unknown): unknown {
  if (val === null || val === undefined || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeForDigest);
  }
  const obj = val as Record<string, unknown>;
  const sorted = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sorted) {
    if (obj[k] !== undefined) {
      out[k] = canonicalizeForDigest(obj[k]);
    }
  }
  return out;
}

/**
 * Deterministic SHA-256 hex digest over canonicalized JSON value.
 */
export function computeDeterministicEvidenceHash(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  try {
    const json = JSON.stringify(canonicalizeForDigest(payload));
    if (!json) return null;
    return crypto.createHash("sha256").update(json, "utf8").digest("hex");
  } catch {
    return null;
  }
}

/**
 * Evaluates current server-side policy flags and allowed access route for Amazon US Pilot.
 * Default: KH02_AMAZON_US_ENABLED=false and KH02_AMAZON_US_LIVE_ALLOWED=false.
 * User-supplied request parameters can NEVER override server-side policy flags.
 */
export function resolveAmazonUsPolicyContext(
  env: Record<string, string | undefined> = process.env,
  options?: {
    creatorsApiEntitlementVerified?: boolean;
    allowLocalMcpSearch?: boolean;
  }
): AmazonPolicyContext {
  const featureEnabled =
    String(env.KH02_AMAZON_US_ENABLED || "false").trim().toLowerCase() === "true";
  const liveAllowed =
    String(env.KH02_AMAZON_US_LIVE_ALLOWED || "false").trim().toLowerCase() === "true";
  const credId = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_ID ||
    env.AMAZON_CREATORS_API_CREDENTIAL_ID ||
    ""
  ).trim();
  const credSecret = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    env.AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    ""
  ).trim();
  const partnerTag = (
    env.KH02_AMAZON_ASSOCIATES_PARTNER_TAG ||
    env.AMAZON_CREATORS_API_PARTNER_TAG ||
    ""
  ).trim();
  const creatorsApiConfigured = Boolean(credId && credSecret && partnerTag);
  const creatorsApiEntitlementVerified = Boolean(
    creatorsApiConfigured && options?.creatorsApiEntitlementVerified === true
  );
  const localMcpSearchAttested =
    String(env.KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED || "false")
      .trim()
      .toLowerCase() === "true" || Boolean(options?.allowLocalMcpSearch);
  const userAuthorizedUrlAttested =
    String(
      env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED ||
        env.KH02_AMAZON_US_PUBLIC_URL_ATTESTED ||
        "false"
    )
      .trim()
      .toLowerCase() === "true" || localMcpSearchAttested;

  if (!featureEnabled) {
    return {
      featureEnabled: false,
      liveAllowed: false,
      creatorsApiConfigured,
      creatorsApiEntitlementVerified: false,
      userAuthorizedUrlAttested,
      localMcpSearchAttested,
      pilotRouteId: "NONE",
      localMcpPilotPermitted: false,
      localMcpSearchPermitted: false,
      creatorsApiIndependentOfLocalMcp: true,
      accessPolicyStatus: "DISABLED_BY_DEFAULT",
      allowedAccessRoute: "NONE",
      policyReason:
        "Amazon US pilot is disabled by default (KH02_AMAZON_US_ENABLED=false).",
    };
  }

  if (!liveAllowed) {
    return {
      featureEnabled: true,
      liveAllowed: false,
      creatorsApiConfigured,
      creatorsApiEntitlementVerified: false,
      userAuthorizedUrlAttested,
      localMcpSearchAttested,
      pilotRouteId: "ISOLATED_FIXTURE_ONLY",
      localMcpPilotPermitted: false,
      localMcpSearchPermitted: false,
      creatorsApiIndependentOfLocalMcp: true,
      accessPolicyStatus: "LIVE_NOT_ALLOWED",
      allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
      policyReason:
        "KH02_AMAZON_US_ENABLED=true but KH02_AMAZON_US_LIVE_ALLOWED=false. Live Amazon requests are blocked by policy; only isolated fixture or manual user-imported evidence may be evaluated.",
    };
  }

  if (creatorsApiConfigured && creatorsApiEntitlementVerified) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      creatorsApiConfigured: true,
      creatorsApiEntitlementVerified: true,
      userAuthorizedUrlAttested,
      localMcpSearchAttested,
      pilotRouteId: "AMAZON_CREATORS_API",
      localMcpPilotPermitted: userAuthorizedUrlAttested,
      localMcpSearchPermitted: localMcpSearchAttested,
      creatorsApiIndependentOfLocalMcp: true,
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      allowedAccessRoute: "OFFICIAL_CREATORS_API",
      policyReason:
        "Official Amazon Associates Creators API entitlement verified for US marketplace (www.amazon.com).",
    };
  }

  if (userAuthorizedUrlAttested) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      creatorsApiConfigured,
      creatorsApiEntitlementVerified: false,
      userAuthorizedUrlAttested: true,
      localMcpSearchAttested,
      pilotRouteId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT",
      localMcpPilotPermitted: true,
      localMcpSearchPermitted: localMcpSearchAttested,
      creatorsApiIndependentOfLocalMcp: true,
      accessPolicyStatus: "AUTHORIZED_USER_LIMITED_URL",
      allowedAccessRoute: "USER_AUTHORIZED_URL",
      policyReason:
        "Live Amazon US limited product-URL verification attested via KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED=true within strict pilot budget caps (independent of Creators API credentials).",
    };
  }

  if (creatorsApiConfigured) {
    return {
      featureEnabled: true,
      liveAllowed: false,
      creatorsApiConfigured: true,
      creatorsApiEntitlementVerified: false,
      userAuthorizedUrlAttested: false,
      localMcpSearchAttested: false,
      pilotRouteId: "NONE",
      localMcpPilotPermitted: false,
      localMcpSearchPermitted: false,
      creatorsApiIndependentOfLocalMcp: true,
      accessPolicyStatus: "BLOCKED_POLICY",
      allowedAccessRoute: "CREATORS_API_NOT_IMPLEMENTED",
      policyReason:
        "NOT_IMPLEMENTED: Official Amazon Creators API credentials were detected in env, but live entitlement has not been verified by an upstream OAuth handshake/request; Playwright scraping is never substituted for Creators API.",
    };
  }

  return {
    featureEnabled: true,
    liveAllowed: false,
    creatorsApiConfigured: false,
    creatorsApiEntitlementVerified: false,
    userAuthorizedUrlAttested: false,
    localMcpSearchAttested: false,
    pilotRouteId: "ISOLATED_FIXTURE_ONLY",
    localMcpPilotPermitted: false,
    localMcpSearchPermitted: false,
    creatorsApiIndependentOfLocalMcp: true,
    accessPolicyStatus: "BLOCKED_POLICY",
    allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
    policyReason:
      "BLOCKED_POLICY: KH02_AMAZON_US_LIVE_ALLOWED=true was requested, but neither official Amazon Creators API credentials nor explicit user-authorized URL verification attestation (KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED=true) is present.",
  };
}

export const NON_INFLATION_NOTICE =
  "Listing existence corroborates product identity only; never implies unit sales, 60-day demand (G15), or live ad/merchant verification (G16).";

function formatAmazonStatusLabel(status: MarketplaceEvidenceStatus): string {
  switch (status) {
    case "IDENTITY_VERIFIED":
      return "Amazon US Identity Verified";
    case "OBSERVED_UNVERIFIED":
      return "Amazon US Listing Observed (Unverified Match)";
    case "PARTIAL":
      return "Amazon US Listing Observed (Partial Metadata)";
    case "BLOCKED_POLICY":
      return "Amazon US Blocked by Policy Guard";
    case "BLOCKED_PROVIDER":
      return "Amazon US Access Blocked by Provider";
    case "MCP_NOT_CONFIGURED":
      return "Amazon US MCP Session Not Configured";
    case "NOT_IMPLEMENTED":
      return "Amazon US Access Route Not Implemented";
    case "NOT_EXECUTED":
    case "PDP_NOT_EXECUTED":
      return "Amazon US Navigation Not Executed";
    case "SEARCH_BLOCKED_POLICY":
      return "Amazon US Search Blocked by Policy Guard";
    case "CAPTCHA_BLOCKED":
      return "Amazon US CAPTCHA Challenge";
    case "RATE_LIMITED":
      return "Amazon US Rate Limited (Budget Cap)";
    case "TIMED_OUT":
      return "Amazon US Timed Out";
    case "QUERY_SUCCEEDED_EMPTY":
      return "Amazon US No Product Found";
    case "NOT_AUTHORIZED":
      return "Amazon US Not Authorized";
    case "CREDENTIALS_REQUIRED":
      return "Amazon US Credentials Required";
    case "ACCESS_NOT_GRANTED":
      return "Amazon US Access Not Granted";
    case "AUTHENTICATION_FAILED":
      return "Amazon US Authentication Failed";
    case "PROVIDER_ERROR":
      return "Amazon US Provider Error";
    case "INSUFFICIENT_EVIDENCE":
      return "Amazon US Insufficient Evidence";
    case "NOT_ATTEMPTED":
      return "Amazon US Not Attempted";
    case "DISABLED":
      return "Amazon US Pilot Disabled";
    case "FAILED":
    default:
      return "Amazon US Verification Rejected";
  }
}

function formatAmazonIdentityMatchLabel(match: AmazonProductEvidence["identityMatch"]): string {
  switch (match) {
    case "EXACT_PRODUCT":
      return "Exact Product Match";
    case "PROBABLE_PRODUCT":
      return "Probable Product Match";
    case "BRAND_ONLY":
      return "Brand-Only Match (Product Unverified)";
    case "AMBIGUOUS":
      return "Ambiguous Match";
    case "NO_MATCH":
    default:
      return "No Verified Match";
  }
}

export function summarizeAmazonEvidenceForProduct(
  candidateId: string,
  runId: string,
  evidenceRows: AmazonProductEvidence[] | undefined | null,
  options?: {
    policyContext?: AmazonPolicyContext;
    telemetry?: AmazonMarketplaceTelemetry | null;
  }
): ProductAmazonEvidenceSummary {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const matchingRows = rows.filter(
    (r) =>
      r &&
      r.candidateId === candidateId &&
      (!runId || r.researchRunId === runId) &&
      r.provider === "AMAZON_US"
  );

  const bestRow =
    matchingRows.find((r) => r.status === "IDENTITY_VERIFIED") ||
    matchingRows.find((r) => r.status === "PARTIAL" || r.status === "OBSERVED_UNVERIFIED") ||
    matchingRows[0] ||
    null;

  if (bestRow) {
    return {
      candidateId,
      researchRunId: bestRow.researchRunId,
      provider: "AMAZON_US",
      visible: true,
      status: bestRow.status,
      statusLabel: formatAmazonStatusLabel(bestRow.status),
      asin: bestRow.asin,
      parentAsin: bestRow.parentAsin,
      variationAsin: bestRow.variationAsin,
      canonicalAmazonUrl: bestRow.canonicalAmazonUrl,
      observedCanonicalUrl: bestRow.observedCanonicalUrl ?? bestRow.canonicalAmazonUrl,
      canonicalUrlOrigin: bestRow.canonicalUrlOrigin ?? (bestRow.canonicalAmazonUrl ? "DERIVED_NORMALIZED_DP" : "NONE"),
      observedSearchHref: bestRow.observedSearchHref ?? null,
      observedSearchHrefOrigin: bestRow.observedSearchHrefOrigin ?? (bestRow.observedSearchHref ? "OBSERVED_HREF" : "NONE"),
      searchRankPosition: bestRow.searchRankPosition ?? null,
      productTitle: bestRow.productTitle,
      brand: bestRow.brand,
      modelNumber: bestRow.modelNumber ?? null,
      seller: bestRow.seller ?? bestRow.merchant ?? null,
      price: bestRow.price,
      currency: bestRow.currency,
      availability: bestRow.availability,
      observedDeliveryPostalCode: bestRow.observedDeliveryPostalCode ?? null,
      identityMatch: bestRow.identityMatch,
      identityMatchLabel: formatAmazonIdentityMatchLabel(bestRow.identityMatch),
      searchIdentityVerdict: bestRow.searchIdentityVerdict,
      metaCandidateEquivalenceVerdict: bestRow.metaCandidateEquivalenceVerdict,
      combinedIdentityVerdict: bestRow.combinedIdentityVerdict,
      commercialUsStatus: bestRow.commercialUsStatus,
      sellerStatus: bestRow.sellerStatus,
      availabilityStatus: bestRow.availabilityStatus,
      provenanceStatus: bestRow.provenanceStatus,
      observationClass: bestRow.observationClass,
      verificationScope: bestRow.verificationScope,
      providerSourceOrigin:
        bestRow.providerSourceOrigin ||
        (bestRow.evidenceOrigin === "AMAZON_US_CREATORS_API"
          ? "AUTHORIZED_CREATORS_API"
          : bestRow.observationClass === "IMPORTED_BY_USER"
          ? "USER_IMPORTED"
          : bestRow.observationClass === "TEST_FIXTURE"
          ? "TEST_FIXTURE"
          : bestRow.observationClass === "AUTHORIZED_LIVE"
          ? "PINNED_PLAYWRIGHT_MCP"
          : "NONE"),
      httpStatus: bestRow.httpStatus ?? null,
      httpStatusOrigin:
        bestRow.httpStatusOrigin ||
        (typeof bestRow.httpStatus === "number" ? "OBSERVED" : "UNOBSERVED_NULL"),
      observedAt: bestRow.observedAt,
      providerInvocationRef: bestRow.providerInvocationRef,
      providerRequestId: bestRow.providerRequestId,
      rawEvidenceHash: bestRow.rawEvidenceHash,
      extractedFieldsHash: bestRow.extractedFieldsHash,
      matchingReasons: [...(bestRow.matchingReasons || [])],
      missingFields: [...(bestRow.missingFields || [])],
      rejectionReasons: [...(bestRow.rejectionReasons || [])],
      nonInflationNotice: NON_INFLATION_NOTICE,
    };
  }

  const policy = options?.policyContext || resolveAmazonUsPolicyContext();
  const telemetryStatus = options?.telemetry?.runStatus;
  const fallbackStatus: MarketplaceEvidenceStatus =
    telemetryStatus && telemetryStatus !== "DISABLED"
      ? "NOT_ATTEMPTED"
      : policy.featureEnabled
      ? "NOT_ATTEMPTED"
      : "DISABLED";

  return {
    candidateId,
    researchRunId: runId,
    provider: "AMAZON_US",
    visible: false,
    status: fallbackStatus,
    statusLabel: formatAmazonStatusLabel(fallbackStatus),
    asin: null,
    parentAsin: null,
    variationAsin: null,
    canonicalAmazonUrl: null,
    productTitle: null,
    brand: null,
    price: null,
    currency: null,
    availability: null,
    identityMatch: "NO_MATCH",
    identityMatchLabel: formatAmazonIdentityMatchLabel("NO_MATCH"),
    observationClass: "UNVERIFIED",
    verificationScope: null,
    providerSourceOrigin: "NONE",
    httpStatus: null,
    httpStatusOrigin: "UNOBSERVED_NULL",
    observedAt: null,
    providerInvocationRef: null,
    providerRequestId: null,
    rawEvidenceHash: null,
    extractedFieldsHash: null,
    matchingReasons: [],
    missingFields: [],
    rejectionReasons: [],
    nonInflationNotice: NON_INFLATION_NOTICE,
  };
}

// Re-export V12.4.3.5.1 Walmart US Jina Reader REST contracts (kept strictly distinct from Amazon types)
export type {
  WalmartQueryExecutionStatus,
  MarketplacePresence,
  MatchLevel,
  StockState,
  EvidenceOrigin,
  WalmartSchemaCompatibility,
  WalmartAppearanceProvenance,
  WalmartSearchIntent,
  WalmartPilotPolicyLimits,
  WalmartPilotPolicy,
  WalmartJinaRequestOptions,
  WalmartJinaEnvelopeData,
  WalmartJinaResponse,
  WalmartSearchListing,
  WalmartPdpProduct,
  WalmartIdentityDecision,
  WalmartQueryScopeMetadata,
  WalmartProductEvidence,
  WalmartProviderRequestRecord,
  WalmartProviderTelemetry,
  WalmartEvidenceSummary,
} from "./walmartJinaTypes";
export {
  WALMART_NON_INFLATION_NOTICE,
  computeWalmartDeterministicHash,
} from "./walmartJinaTypes";
export {
  summarizeWalmartEvidenceForCandidate,
  formatWalmartPriceDisplay,
  formatWalmartLocationDisplay,
} from "./walmartJinaPolicy";


