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
  | "NOT_ATTEMPTED"
  | "NOT_AUTHORIZED"
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

export type MarketplaceObservationClass =
  | "AUTHORIZED_LIVE"
  | "IMPORTED_BY_USER"
  | "CACHED"
  | "TEST_FIXTURE"
  | "UNVERIFIED";

export type MarketplaceVerificationScope =
  | "LISTING_OBSERVED"
  | "IDENTITY_CORROBORATED";

export type AmazonAccessPolicyStatus =
  | "DISABLED_BY_DEFAULT"
  | "LIVE_NOT_ALLOWED"
  | "BLOCKED_POLICY"
  | "AUTHORIZED_CREATORS_API"
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
  userAuthorizedUrlAttested: boolean;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  allowedAccessRoute: "CREATORS_API" | "USER_AUTHORIZED_URL" | "ISOLATED_FIXTURE_ONLY" | "NONE";
  policyReason: string;
}

export interface AmazonProductEvidence {
  id: string;
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  provider: MarketplaceSource;
  requestMode: AmazonRequestMode;
  requestedMarket: "US";
  verifiedDeliveryMarket: "US" | null;
  sourceUrl: string | null;
  finalUrl: string | null;
  canonicalAmazonUrl: string | null;
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
  observationClass: MarketplaceObservationClass;
  verificationScope: MarketplaceVerificationScope | null;
  identityMatch: IdentityMatch;
  isCached: boolean;
  matchedCanonicalKey: string | null;
  matchingReasons: string[];
  missingFields: string[];
  rejectionReasons: string[];
  sanitizationWarnings?: string[];
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
  };
  g15DemandUnchanged: true;
  g16MerchantGateUnchanged: true;
  reasons: string[];
  blockers: string[];
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
  productTitle: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  identityMatch: IdentityMatch;
  identityMatchLabel: string;
  observationClass: MarketplaceObservationClass;
  verificationScope: MarketplaceVerificationScope | null;
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
  env: NodeJS.ProcessEnv = process.env
): AmazonPolicyContext {
  const featureEnabled =
    String(env.KH02_AMAZON_US_ENABLED || "false").trim().toLowerCase() === "true";
  const liveAllowed =
    String(env.KH02_AMAZON_US_LIVE_ALLOWED || "false").trim().toLowerCase() === "true";
  const creatorsApiConfigured = Boolean(
    env.AMAZON_CREATORS_API_CREDENTIAL_ID?.trim() &&
      env.AMAZON_CREATORS_API_CREDENTIAL_SECRET?.trim() &&
      env.AMAZON_CREATORS_API_PARTNER_TAG?.trim()
  );
  const userAuthorizedUrlAttested =
    String(env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED || "false")
      .trim()
      .toLowerCase() === "true";

  if (!featureEnabled) {
    return {
      featureEnabled: false,
      liveAllowed: false,
      creatorsApiConfigured,
      userAuthorizedUrlAttested,
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
      userAuthorizedUrlAttested,
      accessPolicyStatus: "LIVE_NOT_ALLOWED",
      allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
      policyReason:
        "KH02_AMAZON_US_ENABLED=true but KH02_AMAZON_US_LIVE_ALLOWED=false. Live Amazon requests are blocked by policy; only isolated fixture or manual user-imported evidence may be evaluated.",
    };
  }

  if (creatorsApiConfigured) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      creatorsApiConfigured: true,
      userAuthorizedUrlAttested,
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      allowedAccessRoute: "CREATORS_API",
      policyReason:
        "Live Amazon US access authorized via configured official Amazon Creators API credentials.",
    };
  }

  if (userAuthorizedUrlAttested) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      creatorsApiConfigured: false,
      userAuthorizedUrlAttested: true,
      accessPolicyStatus: "AUTHORIZED_USER_LIMITED_URL",
      allowedAccessRoute: "USER_AUTHORIZED_URL",
      policyReason:
        "Live Amazon US limited product-URL verification attested via KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED=true within strict pilot budget caps.",
    };
  }

  return {
    featureEnabled: true,
    liveAllowed: false,
    creatorsApiConfigured: false,
    userAuthorizedUrlAttested: false,
    accessPolicyStatus: "BLOCKED_POLICY",
    allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
    policyReason:
      "BLOCKED_POLICY: KH02_AMAZON_US_LIVE_ALLOWED=true was requested, but neither official Amazon Creators API credentials nor explicit user-authorized URL verification attestation (KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED=true) is present.",
  };
}
