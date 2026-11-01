/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Jina Reader Free Pilot Policy
 *
 * Server-only flags (default OFF):
 *   KH02_WALMART_US_ENABLED=false
 *   KH02_WALMART_US_LIVE_ALLOWED=false
 *
 * Optional strict operational bounds:
 *   KH02_WALMART_JINA_MAX_REQUESTS_PER_MINUTE=6 (never > 6)
 *   KH02_WALMART_JINA_HTTP_TIMEOUT_MS=40000
 *   KH02_WALMART_JINA_MAX_ATTEMPTS=2 (never > 2)
 *   KH02_WALMART_US_MAX_OPERATIONS_PER_RUN=4 (never > 4)
 *
 * No API key is required or accepted. Disabled state reports "Server pilot disabled",
 * never "Key Required", and is completely independent of Amazon US flags/credentials.
 */

import {
  WALMART_NON_INFLATION_NOTICE,
  WalmartEvidenceSummary,
  WalmartPilotPolicy,
  WalmartPilotPolicyLimits,
  WalmartProductEvidence,
  WalmartProviderTelemetry,
  WalmartQueryExecutionStatus,
} from "./walmartJinaTypes";

export const DEFAULT_WALMART_PILOT_LIMITS: WalmartPilotPolicyLimits = {
  maxConcurrentOperationsPerProviderGroup: 1,
  maxLogicalOperationsPerRun: 4,
  maxAttemptsPerOperation: 2,
  maxNetworkAttemptsPerRun: 8,
  maxRequestsPerMinuteAcrossWorkers: 6,
  rollingWindowMs: 60_000,
  httpTimeoutMs: 40_000,
  minRetryBackoffMs: 3_000,
  maxOperationDeadlineMs: 120_000,
  maxResponseBytes: 8 * 1024 * 1024, // 8 MiB ceiling on outer Jina response
  maxNextDataBytes: 4 * 1024 * 1024, // 4 MiB ceiling on script#__NEXT_DATA__ payload
};

function parsePositiveIntClamped(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

export function resolveWalmartUsPilotPolicy(
  env: Record<string, string | undefined> = process.env
): WalmartPilotPolicy {
  const featureEnabled =
    String(env.KH02_WALMART_US_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const liveAllowed =
    featureEnabled &&
    String(env.KH02_WALMART_US_LIVE_ALLOWED || "")
      .trim()
      .toLowerCase() === "true";

  const maxRequestsPerMinuteAcrossWorkers = parsePositiveIntClamped(
    env.KH02_WALMART_JINA_MAX_REQUESTS_PER_MINUTE,
    DEFAULT_WALMART_PILOT_LIMITS.maxRequestsPerMinuteAcrossWorkers,
    1,
    6
  );

  const httpTimeoutMs = parsePositiveIntClamped(
    env.KH02_WALMART_JINA_HTTP_TIMEOUT_MS,
    DEFAULT_WALMART_PILOT_LIMITS.httpTimeoutMs,
    500,
    60_000
  );

  const maxAttemptsPerOperation = parsePositiveIntClamped(
    env.KH02_WALMART_JINA_MAX_ATTEMPTS,
    DEFAULT_WALMART_PILOT_LIMITS.maxAttemptsPerOperation,
    1,
    2
  );

  const maxLogicalOperationsPerRun = parsePositiveIntClamped(
    env.KH02_WALMART_US_MAX_OPERATIONS_PER_RUN,
    DEFAULT_WALMART_PILOT_LIMITS.maxLogicalOperationsPerRun,
    1,
    4
  );

  const limits: WalmartPilotPolicyLimits = {
    ...DEFAULT_WALMART_PILOT_LIMITS,
    maxConcurrentOperationsPerProviderGroup: 1,
    maxLogicalOperationsPerRun,
    maxAttemptsPerOperation,
    maxNetworkAttemptsPerRun: maxLogicalOperationsPerRun * maxAttemptsPerOperation,
    maxRequestsPerMinuteAcrossWorkers,
    httpTimeoutMs,
  };

  let status: WalmartQueryExecutionStatus = "DISABLED";
  let reason = "Server pilot disabled (KH02_WALMART_US_ENABLED=false)";

  if (!featureEnabled) {
    status = "DISABLED";
    reason = "Server pilot disabled";
  } else if (!liveAllowed) {
    status = "NOT_ATTEMPTED";
    reason =
      "Walmart US pilot enabled in fixture/offline mode only; live Jina Reader requests blocked by policy (KH02_WALMART_US_LIVE_ALLOWED=false)";
  } else {
    status = "PENDING";
    reason =
      "Walmart US free Jina Reader REST pilot enabled (no API key required; rate cap <=6 req/60s, <=4 ops/run)";
  }

  return {
    provider: "WALMART_US",
    featureEnabled,
    liveAllowed,
    freeReaderMode: true,
    requiresApiKey: false,
    authenticated: false,
    paidFallbackAllowed: false,
    status,
    reason,
    limits,
  };
}

export interface EffectiveWalmartRunAuthorization {
  policy: WalmartPilotPolicy;
  operatorOptIn: boolean;
  effectiveEnabled: boolean;
  liveNetworkPermitted: boolean;
  fixtureTransportPermitted: boolean;
  initialQueryStatus: WalmartQueryExecutionStatus;
  reason: string;
}

/**
 * Evaluates server-side policy together with the operator's per-run opt-in (`enableWalmartUsPilot`).
 * Never allows client input to enable Walmart when `KH02_WALMART_US_ENABLED` is false,
 * and never allows live requests when `KH02_WALMART_US_LIVE_ALLOWED` is false.
 */
export function resolveEffectiveWalmartRunAuthorization(
  operatorOptIn: boolean | undefined,
  env: Record<string, string | undefined> = process.env,
  hasControlledTestFixtureTransport: boolean = false
): EffectiveWalmartRunAuthorization {
  const policy = resolveWalmartUsPilotPolicy(env);
  const optIn = Boolean(operatorOptIn);

  if (!policy.featureEnabled) {
    return {
      policy,
      operatorOptIn: optIn,
      effectiveEnabled: false,
      liveNetworkPermitted: false,
      fixtureTransportPermitted: false,
      initialQueryStatus: "DISABLED",
      reason: "Server pilot disabled",
    };
  }

  if (!optIn) {
    return {
      policy,
      operatorOptIn: false,
      effectiveEnabled: false,
      liveNetworkPermitted: false,
      fixtureTransportPermitted: false,
      initialQueryStatus: "NOT_ATTEMPTED",
      reason: "Walmart US pilot was not enabled for this research run",
    };
  }

  if (!policy.liveAllowed) {
    if (hasControlledTestFixtureTransport) {
      return {
        policy,
        operatorOptIn: true,
        effectiveEnabled: true,
        liveNetworkPermitted: false,
        fixtureTransportPermitted: true,
        initialQueryStatus: "PENDING",
        reason:
          "Walmart US pilot running via controlled offline test fixture transport (KH02_WALMART_US_LIVE_ALLOWED=false)",
      };
    }
    return {
      policy,
      operatorOptIn: true,
      effectiveEnabled: false,
      liveNetworkPermitted: false,
      fixtureTransportPermitted: false,
      initialQueryStatus: "NOT_ATTEMPTED",
      reason:
        "Live Walmart US Jina Reader requests are disabled by server policy (KH02_WALMART_US_LIVE_ALLOWED=false)",
    };
  }

  return {
    policy,
    operatorOptIn: true,
    effectiveEnabled: true,
    liveNetworkPermitted: true,
    fixtureTransportPermitted: hasControlledTestFixtureTransport,
    initialQueryStatus: "PENDING",
    reason: policy.reason,
  };
}

export function formatWalmartPriceDisplay(
  price: number | null | undefined,
  currency: string | null | undefined
): string {
  if (
    typeof price === "number" &&
    Number.isFinite(price) &&
    price > 0 &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/.test(currency.trim())
  ) {
    const code = currency.trim().toUpperCase();
    if (code === "USD") {
      return `$${price.toFixed(2)} USD`;
    }
    return `${price.toFixed(2)} ${code}`;
  }
  return "Not verified";
}

export function formatWalmartLocationDisplay(
  postalCode: string | null | undefined,
  storeIds: string[] | null | undefined
): string | null {
  const parts: string[] = [];
  if (postalCode && postalCode.trim()) {
    parts.push(`ZIP ${postalCode.trim()}`);
  }
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    parts.push(`Store #${storeIds.join(", #")}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(" · ")} (Observed store scope)`;
}

function buildStatusReasonForSummary(
  row: WalmartProductEvidence | null,
  telemetry?: WalmartProviderTelemetry | null,
  policy?: WalmartPilotPolicy
): string {
  if (row) {
    if (row.isStale && row.isCached) {
      return `Current check ${row.queryStatus}; showing cached Walmart observation from ${
        row.observedAt || "prior run"
      }.`;
    }
    if (row.queryStatus === "SUCCEEDED") {
      if (row.presence === "NO_MATCH_IN_SCOPE") {
        return `Scoped Walmart US search completed for '${
          row.queryScope.query || "candidate"
        }'; no matching listing in checked search scope (not a global absence claim).`;
      }
      if (row.presence === "FOUND") {
        return `Walmart US listing observed (${row.matchLevel} match, stock: ${row.availability}).`;
      }
    }
    if (row.queryStatus === "BLOCKED_PROVIDER") {
      return "Walmart / Jina Reader returned anti-bot verification or HTTP 403 block; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "TIMED_OUT") {
      return "Walmart Jina Reader request timed out and was aborted; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "RATE_LIMITED") {
      return "Walmart Jina Reader rate limit (HTTP 429) or cooldown active; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "PARSE_ERROR") {
      return "Walmart response failed JSON/__NEXT_DATA__ schema validation; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "BUDGET_EXHAUSTED" || row.queryStatus === "DEFERRED") {
      return `Walmart pilot cap reached (${row.queryStatus}); candidate check deferred.`;
    }
    if (row.queryStatus === "KEY_OR_PAYMENT_REQUIRED") {
      return "Jina Reader free mode restricted (401/402); stopped free pilot without requesting API keys.";
    }
    if (row.rejectionReasons.length > 0) {
      return row.rejectionReasons.join("; ");
    }
  }
  if (telemetry) {
    return telemetry.statusReason;
  }
  const resolvedPolicy = policy || resolveWalmartUsPilotPolicy();
  return resolvedPolicy.reason;
}

export function summarizeWalmartEvidenceForCandidate(
  candidateId: string,
  researchRunId: string,
  evidenceRows: WalmartProductEvidence[],
  options: {
    telemetry?: WalmartProviderTelemetry | null;
    policy?: WalmartPilotPolicy;
  } = {}
): WalmartEvidenceSummary {
  const candidateRows = (evidenceRows || []).filter(
    (r) => r && r.candidateId === candidateId && r.researchRunId === researchRunId
  );

  const rankRow = (r: WalmartProductEvidence): number => {
    let score = 0;
    if (r.presence === "FOUND") score += 100;
    if (r.matchLevel === "EXACT") score += 50;
    else if (r.matchLevel === "SIMILAR") score += 25;
    if (r.queryStatus === "SUCCEEDED") score += 20;
    if (!r.isStale) score += 10;
    return score;
  };

  candidateRows.sort((a, b) => rankRow(b) - rankRow(a));
  const primary = candidateRows[0] || null;
  const telemetry = options.telemetry || null;
  const policy = options.policy || resolveWalmartUsPilotPolicy();

  if (!primary) {
    const fallbackStatus: WalmartQueryExecutionStatus = telemetry
      ? telemetry.overallStatus
      : policy.status;
    return {
      visible: Boolean(telemetry || policy.featureEnabled),
      provider: "WALMART_US",
      candidateId,
      researchRunId,
      queryStatus: fallbackStatus,
      presence: "UNKNOWN",
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      itemId: null,
      canonicalWalmartUrl: null,
      title: null,
      brand: null,
      model: null,
      upc: null,
      price: null,
      currency: null,
      priceDisplay: "Not verified",
      seller: null,
      locationPostalCode: null,
      locationStoreIds: [],
      locationDisplay: null,
      availability: "UNKNOWN",
      evidenceOrigin: "REAL_JINA_READER",
      isCached: false,
      isStale: false,
      observedAt: null,
      lastAttemptAt: telemetry?.lastAttemptAt || null,
      lastSuccessfulLiveQueryAt: telemetry?.lastSuccessfulLiveQueryAt || null,
      rawEvidenceHash: null,
      statusReason: buildStatusReasonForSummary(null, telemetry, policy),
      matchReasons: [],
      rejectionReasons: [],
      missingFields: [],
      appearanceProvenance: [],
      queryScope: {
        query: null,
        normalizedQuery: null,
        market: "US",
        checkedSearchCount: 0,
        checkedPdpCount: 0,
        rawSearchResultCount: null,
        dedupedSearchResultCount: null,
        completeSearchScope: false,
      },
      nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
    };
  }

  return {
    visible: true,
    provider: "WALMART_US",
    candidateId,
    researchRunId,
    queryStatus: primary.queryStatus,
    presence: primary.presence,
    matchLevel: primary.matchLevel,
    verifiedIdentity: primary.verifiedIdentity,
    itemId: primary.itemId,
    canonicalWalmartUrl: primary.canonicalProductUrl,
    title: primary.title,
    brand: primary.brand,
    model: primary.model,
    upc: primary.upc,
    price: primary.price,
    currency: primary.currency,
    priceDisplay: formatWalmartPriceDisplay(primary.price, primary.currency),
    seller: primary.seller,
    locationPostalCode: primary.locationPostalCode,
    locationStoreIds: primary.locationStoreIds || [],
    locationDisplay: formatWalmartLocationDisplay(
      primary.locationPostalCode,
      primary.locationStoreIds
    ),
    availability: primary.availability,
    evidenceOrigin: primary.evidenceOrigin,
    isCached: primary.isCached,
    isStale: primary.isStale,
    observedAt: primary.observedAt,
    lastAttemptAt: primary.lastAttemptAt,
    lastSuccessfulLiveQueryAt: primary.lastSuccessfulLiveQueryAt,
    rawEvidenceHash: primary.rawEvidenceHash,
    statusReason: buildStatusReasonForSummary(primary, telemetry, policy),
    matchReasons: primary.matchReasons || [],
    rejectionReasons: primary.rejectionReasons || [],
    missingFields: primary.missingFields || [],
    appearanceProvenance: primary.appearanceProvenance || [],
    queryScope: primary.queryScope,
    nonInflationNotice: primary.nonInflationNotice || WALMART_NON_INFLATION_NOTICE,
  };
}
