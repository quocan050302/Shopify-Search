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
  WalmartPilotPolicy,
  WalmartPilotPolicyLimits,
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
