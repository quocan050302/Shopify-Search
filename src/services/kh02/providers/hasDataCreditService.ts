/**
 * SWAI KH-02 — HasData Credit Authority Service
 *
 * Provides authoritative HasData credit inspection, quota evaluation,
 * and usage reconciliation.
 *
 * Rules:
 * 1. Never assume request count == credits remaining.
 * 2. If provider balance endpoint is unconfigured or unsupported, return explicit
 *    authority: "UNSUPPORTED" or "UNCONFIGURED" (never fabricate credits).
 * 3. Default AUTO_PAID_RESEARCH = false: fail-closed when quota is unverified or billable.
 */

export interface HasDataContext {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface HasDataCreditStatus {
  totalCredits: number | null;
  usedCredits: number | null;
  remainingCredits: number | null;
  billingPeriod: string | null;
  retrievedAt: string;
  unit: string;
  authority: "AUTHORITATIVE_API" | "CONFIGURED_ESTIMATE" | "UNSUPPORTED" | "UNCONFIGURED";
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "BLOCKED";
  accountPlan?: string | null;
  errorMessage?: string;
}

export interface ProviderOperationCost {
  provider: string;
  operation: string;
  estimatedCredits: number | null;
  knownCost: boolean;
  pricingSource: string | null;
  verifiedAt: string | null;
}

export function getHasDataOperationCost(
  operation: string
): ProviderOperationCost {
  const opUpper = (operation || "").toUpperCase();
  if (
    opUpper.includes("TIKTOK") ||
    opUpper.includes("SEARCH_VIDEOS") ||
    opUpper.includes("VIDEO") ||
    opUpper.includes("MCP_TOOL_CALL") ||
    opUpper.includes("ORGANIC")
  ) {
    return {
      provider: "HASDATA",
      operation,
      estimatedCredits: 10, // HasData MCP tool call is 10 credits (1,000 free credits/mo)
      knownCost: true,
      pricingSource: "HasData MCP Vendor Documentation (10 credits/tool call)",
      verifiedAt: "2026-10-26T00:00:00.000Z",
    };
  }

  return {
    provider: "HASDATA",
    operation,
    estimatedCredits: null,
    knownCost: false,
    pricingSource: null,
    verifiedAt: null,
  };
}

export interface HasDataOperation {
  operationType: "TIKTOK_ORGANIC_SEARCH" | "TIKTOK_VIDEO_METRICS" | "GENERAL_SCRAPE";
  estimatedRequests: number;
  creditsPerRequest: number;
}

export type QuotaDecisionType =
  | "SUFFICIENT_QUOTA"
  | "INSUFFICIENT_QUOTA"
  | "QUOTA_UNAVAILABLE"
  | "QUOTA_UNKNOWN"
  | "AUTHENTICATION_INVALID";

export interface QuotaDecision {
  decision: QuotaDecisionType;
  isAllowed: boolean;
  requiredCredits: number;
  availableCredits: number | null;
  reason: string;
  evaluatedAt: string;
}

export interface ResearchOperation {
  id: string;
  type: string;
  estimatedCredits: number;
  observedSuccess: boolean;
  timestamp: string;
}

export interface UsageReconciliation {
  creditsConsumedEstimated: number;
  creditsConsumedObserved: number | null;
  reconciliationStatus: "MATCHED" | "DISCREPANCY" | "UNVERIFIED";
  notes: string;
}

/**
 * Fetches authoritative credit and quota balance from HasData API.
 */
export async function fetchHasDataCreditStatus(
  context: HasDataContext = {}
): Promise<HasDataCreditStatus> {
  const apiKey = context.apiKey || process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
  const retrievedAt = new Date().toISOString();

  if (!apiKey) {
    return {
      totalCredits: null,
      usedCredits: null,
      remainingCredits: null,
      billingPeriod: null,
      retrievedAt,
      unit: "CREDITS",
      authority: "UNCONFIGURED",
      verificationStatus: "UNVERIFIED",
      errorMessage: "HASDATA_API_KEY is not configured in environment.",
    };
  }

  const baseUrl = context.baseUrl || "https://api.hasdata.com";
  const timeoutMs = context.timeoutMs || 5000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // HasData account usage endpoint (docs: /user/me/usage)
    let res = await fetch(`${baseUrl}/user/me/usage`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
      signal: controller.signal,
    }).catch(() => null);

    // Fallback to /account/balance for compatibility with alternate proxies
    if (!res || res.status === 404) {
      res = await fetch(`${baseUrl}/account/balance`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "Accept": "application/json",
        },
        signal: controller.signal,
      }).catch(() => null);
    }

    clearTimeout(timer);

    if (!res) {
      return {
        totalCredits: null,
        usedCredits: null,
        remainingCredits: null,
        billingPeriod: null,
        retrievedAt,
        unit: "CREDITS",
        authority: "UNSUPPORTED",
        verificationStatus: "UNVERIFIED",
        errorMessage: "Network or transport error connecting to HasData usage endpoint.",
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        totalCredits: null,
        usedCredits: null,
        remainingCredits: null,
        billingPeriod: null,
        retrievedAt,
        unit: "CREDITS",
        authority: "AUTHORITATIVE_API",
        verificationStatus: "BLOCKED",
        errorMessage: `HasData API key authentication failed (HTTP ${res.status}).`,
      };
    }

    if (res.status === 404) {
      // Balance endpoint not exposed by vendor on this route; report honest unsupported status
      return {
        totalCredits: null,
        usedCredits: null,
        remainingCredits: null,
        billingPeriod: null,
        retrievedAt,
        unit: "CREDITS",
        authority: "UNSUPPORTED",
        verificationStatus: "UNVERIFIED",
        errorMessage: "Authoritative balance/usage endpoint is not exposed by HasData API route.",
      };
    }

    if (!res.ok) {
      return {
        totalCredits: null,
        usedCredits: null,
        remainingCredits: null,
        billingPeriod: null,
        retrievedAt,
        unit: "CREDITS",
        authority: "UNSUPPORTED",
        verificationStatus: "UNVERIFIED",
        errorMessage: `HasData returned unexpected status ${res.status}.`,
      };
    }

    const data = await res.json();
    const remaining = typeof data?.remaining_credits === "number"
      ? data.remaining_credits
      : (typeof data?.credits === "number"
        ? data.credits
        : (typeof data?.remainingCredits === "number" ? data.remainingCredits : null));
    const total = typeof data?.total_credits === "number"
      ? data.total_credits
      : (typeof data?.limit === "number"
        ? data.limit
        : (typeof data?.totalCredits === "number" ? data.totalCredits : null));
    const used = typeof data?.used_credits === "number"
      ? data.used_credits
      : (typeof data?.usedCredits === "number" ? data.usedCredits : null);

    return {
      totalCredits: total,
      usedCredits: used,
      remainingCredits: remaining,
      billingPeriod: data?.billing_period || null,
      retrievedAt,
      unit: "CREDITS",
      authority: "AUTHORITATIVE_API",
      verificationStatus: remaining !== null ? "VERIFIED" : "UNVERIFIED",
      accountPlan: data?.plan || null,
    };
  } catch (err: any) {
    return {
      totalCredits: null,
      usedCredits: null,
      remainingCredits: null,
      billingPeriod: null,
      retrievedAt,
      unit: "CREDITS",
      authority: "UNSUPPORTED",
      verificationStatus: "UNVERIFIED",
      errorMessage: err.message || "Unknown error inspecting HasData credit balance.",
    };
  }
}

/** A credit balance alone does not prove that the account has no paid billing. */
export function hasVerifiedFreeAllowance(status: HasDataCreditStatus, requiredCredits: number): boolean {
  return status.authority === "AUTHORITATIVE_API" && status.verificationStatus === "VERIFIED" &&
    typeof status.accountPlan === "string" && /^free(?: plan)?$/i.test(status.accountPlan.trim()) &&
    typeof status.remainingCredits === "number" && Number.isFinite(status.remainingCredits) &&
    status.remainingCredits >= requiredCredits;
}

/**
 * Evaluates whether an intended operation is authorized within remaining credit quota.
 */
export function evaluateHasDataQuota(
  creditStatus: HasDataCreditStatus,
  expectedOperation?: HasDataOperation
): QuotaDecision {
  const evaluatedAt = new Date().toISOString();
  const autoPaidAllowed = process.env.AUTO_PAID_RESEARCH === "true";
  const reqCredits = expectedOperation
    ? expectedOperation.estimatedRequests * expectedOperation.creditsPerRequest
    : 1;

  if (creditStatus.authority === "UNCONFIGURED") {
    return {
      decision: "QUOTA_UNAVAILABLE",
      isAllowed: false,
      requiredCredits: reqCredits,
      availableCredits: null,
      reason: "HasData API key not configured.",
      evaluatedAt,
    };
  }

  if (creditStatus.verificationStatus === "BLOCKED") {
    return {
      decision: "AUTHENTICATION_INVALID",
      isAllowed: false,
      requiredCredits: reqCredits,
      availableCredits: null,
      reason: creditStatus.errorMessage || "HasData credentials invalid or blocked.",
      evaluatedAt,
    };
  }

  // If AUTO_PAID_RESEARCH is disabled, refuse paid spend unless free allowance is confirmed
  if (!autoPaidAllowed && !hasVerifiedFreeAllowance(creditStatus, reqCredits)) {
    return {
      decision: "QUOTA_UNAVAILABLE",
      isAllowed: false,
      requiredCredits: reqCredits,
      availableCredits: creditStatus.remainingCredits,
      reason: "AUTO_PAID_RESEARCH is false. Paid upstream provider calls are blocked by safety policy.",
      evaluatedAt,
    };
  }

  // If authoritative balance is known
  if (creditStatus.remainingCredits !== null) {
    if (creditStatus.remainingCredits >= reqCredits) {
      return {
        decision: "SUFFICIENT_QUOTA",
        isAllowed: true,
        requiredCredits: reqCredits,
        availableCredits: creditStatus.remainingCredits,
        reason: `Sufficient balance: ${creditStatus.remainingCredits} credits available for ${reqCredits} requested.`,
        evaluatedAt,
      };
    } else {
      return {
        decision: "INSUFFICIENT_QUOTA",
        isAllowed: false,
        requiredCredits: reqCredits,
        availableCredits: creditStatus.remainingCredits,
        reason: `Insufficient balance: ${creditStatus.remainingCredits} credits remaining, ${reqCredits} needed.`,
        evaluatedAt,
      };
    }
  }

  // Quota unknown/unsupported by API
  return {
    decision: "QUOTA_UNKNOWN",
    isAllowed: false,
    requiredCredits: reqCredits,
    availableCredits: null,
    reason: "HasData does not expose real-time balance. Cannot verify credit availability.",
    evaluatedAt,
  };
}

/**
 * Reconciles estimated credit consumption against observed balance deltas.
 */
export function reconcileHasDataUsage(
  before: HasDataCreditStatus,
  after: HasDataCreditStatus,
  operations: ResearchOperation[] = []
): UsageReconciliation {
  const estimatedTotal = operations.reduce((sum, op) => sum + op.estimatedCredits, 0);

  if (before.remainingCredits !== null && after.remainingCredits !== null) {
    const delta = before.remainingCredits - after.remainingCredits;
    const isMatched = Math.abs(delta - estimatedTotal) <= 1;
    return {
      creditsConsumedEstimated: estimatedTotal,
      creditsConsumedObserved: Math.max(0, delta),
      reconciliationStatus: isMatched ? "MATCHED" : "DISCREPANCY",
      notes: `Observed credit delta: ${delta}. Estimated: ${estimatedTotal}.`,
    };
  }

  return {
    creditsConsumedEstimated: estimatedTotal,
    creditsConsumedObserved: null,
    reconciliationStatus: "UNVERIFIED",
    notes: "Authoritative credit balance was not available before and after run.",
  };
}
