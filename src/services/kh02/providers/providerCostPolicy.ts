/**
 * SWAI KH-02 — Provider Cost Policy & Credit Safety Guard
 *
 * Enforces zero-cost default policy (AUTO_PAID_RESEARCH=false).
 * Guarantees that automated research routines and diagnostics NEVER execute
 * unapproved billable or metered API calls.
 */

export interface ProviderCostDecision {
  allowed: boolean;
  provider: string;
  operation: string;
  reason: string;
  estimatedCostCredits: number;
}

export function isAutoPaidResearchAllowed(): boolean {
  return process.env.AUTO_PAID_RESEARCH === "true";
}

/**
 * Validates whether a requested provider operation is permitted under current cost policy.
 */
export function evaluateProviderCostGuard(
  provider: string,
  operation: string,
  estimatedCostCredits = 0,
  explicitAllowPaid = false
): ProviderCostDecision {
  // Free / zero-cost operations are always permitted
  if (estimatedCostCredits === 0) {
    return {
      allowed: true,
      provider,
      operation,
      reason: "Operation is zero-cost (free local MCP or internal database search).",
      estimatedCostCredits: 0,
    };
  }

  // Metered operations require explicit authorization or AUTO_PAID_RESEARCH=true
  if (explicitAllowPaid || isAutoPaidResearchAllowed()) {
    return {
      allowed: true,
      provider,
      operation,
      reason: "Metered operation explicitly authorized by caller or AUTO_PAID_RESEARCH=true.",
      estimatedCostCredits,
    };
  }

  return {
    allowed: false,
    provider,
    operation,
    reason: `Operation blocked: AUTO_PAID_RESEARCH=false and explicit authorization was not provided. Estimated credits: ${estimatedCostCredits}.`,
    estimatedCostCredits,
  };
}
