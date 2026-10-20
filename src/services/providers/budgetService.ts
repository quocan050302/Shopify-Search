/**
 * Provider Usage Budget & Paid API Protection Service — SWAI
 *
 * Implements strict usage budgeting and credit protection for paid providers:
 * 1. Captapi is optional and disabled by default.
 * 2. Automatic paid API requests are completely disabled until explicitly authorized.
 * 3. Enforces monthly credit budget caps.
 * 4. Tracks usage and persists settings safely in server storage.
 */

import fs from "fs";
import path from "path";
import { ProviderId } from "@/services/credentials/credentialService";

export interface ProviderBudgetConfig {
  provider: ProviderId;
  enabled: boolean;
  isOptional: boolean;
  isPaid: boolean;
  monthlyCreditLimit: number;
  creditsUsedThisMonth: number;
  allowAutomaticRequests: boolean;
  requireManualAuthorization: boolean;
  lastResetDate: string;
  notes?: string;
}

export type AllProviderBudgets = Record<ProviderId, ProviderBudgetConfig>;

const BUDGETS_FILE = path.join(process.cwd(), ".provider-budgets.json");

const DEFAULT_BUDGETS: AllProviderBudgets = {
  gemini: {
    provider: "gemini",
    enabled: true,
    isOptional: false,
    isPaid: false, // Standard AI studio free tier / direct quota
    monthlyCreditLimit: 1000,
    creditsUsedThisMonth: 0,
    allowAutomaticRequests: true,
    requireManualAuthorization: false,
    lastResetDate: new Date().toISOString(),
    notes: "Google Gemini API key for video analysis and creative intelligence.",
  },
  meta: {
    provider: "meta",
    enabled: true,
    isOptional: false,
    isPaid: false, // Free public transparency library & Graph API
    monthlyCreditLimit: 1000,
    creditsUsedThisMonth: 0,
    allowAutomaticRequests: true,
    requireManualAuthorization: false,
    lastResetDate: new Date().toISOString(),
    notes: "Meta Ad Library manual import & optional Graph API access.",
  },
  captapi: {
    provider: "captapi",
    enabled: false, // Optional and DISABLED by default
    isOptional: true,
    isPaid: true, // Consumes paid subscription credits
    monthlyCreditLimit: 100, // Safe default cap
    creditsUsedThisMonth: 0,
    allowAutomaticRequests: false, // Automatic background requests strictly blocked
    requireManualAuthorization: true, // Manual confirmation required before spending
    lastResetDate: new Date().toISOString(),
    notes:
      "Captapi is an optional third-party licensed provider. Disabled by default. " +
      "Core research prioritizes free manual research via TikTok Creative Center US and Meta Ad Library.",
  },
};

/**
 * Loads the current provider budget configurations.
 */
export function loadProviderBudgets(): AllProviderBudgets {
  try {
    if (fs.existsSync(BUDGETS_FILE)) {
      const content = fs.readFileSync(BUDGETS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      return {
        gemini: { ...DEFAULT_BUDGETS.gemini, ...(parsed.gemini || {}) },
        meta: { ...DEFAULT_BUDGETS.meta, ...(parsed.meta || {}) },
        captapi: { ...DEFAULT_BUDGETS.captapi, ...(parsed.captapi || {}) },
      };
    }
  } catch (err) {
    console.warn("Could not read .provider-budgets.json, using defaults:", err);
  }

  return { ...DEFAULT_BUDGETS };
}

/**
 * Saves updated provider budget configurations.
 */
export function saveProviderBudgets(budgets: AllProviderBudgets): void {
  try {
    fs.writeFileSync(BUDGETS_FILE, JSON.stringify(budgets, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write .provider-budgets.json:", err);
    throw err;
  }
}

/**
 * Retrieves budget configuration for a specific provider.
 */
export function getProviderBudget(provider: ProviderId): ProviderBudgetConfig {
  const all = loadProviderBudgets();
  return all[provider] || DEFAULT_BUDGETS[provider];
}

/**
 * Updates budget configuration for a specific provider.
 */
export function updateProviderBudget(
  provider: ProviderId,
  updates: Partial<ProviderBudgetConfig>
): ProviderBudgetConfig {
  const all = loadProviderBudgets();
  const current = all[provider] || DEFAULT_BUDGETS[provider];

  const updated: ProviderBudgetConfig = {
    ...current,
    ...updates,
    provider, // keep provider immutable
  };

  all[provider] = updated;
  saveProviderBudgets(all);
  return updated;
}

/**
 * Checks authorization and budget before executing a paid provider API call.
 * Blocks calls if the provider is disabled, if automatic calls are disallowed,
 * or if the credit budget would be exceeded.
 */
export function authorizePaidApiCall(options: {
  provider: ProviderId;
  estimatedCredits?: number;
  isAutomaticRequest?: boolean;
}): {
  allowed: boolean;
  reason?: string;
  config: ProviderBudgetConfig;
} {
  const { provider, estimatedCredits = 1, isAutomaticRequest = false } = options;
  const config = getProviderBudget(provider);

  // 1. Check if provider is enabled
  if (!config.enabled) {
    return {
      allowed: false,
      reason:
        `${config.provider.toUpperCase()} is optional and disabled by default. ` +
        `Enable it explicitly in Settings → API Connections before making requests.`,
      config,
    };
  }

  // 2. For paid providers, block automatic background calls if not explicitly allowed
  if (config.isPaid && isAutomaticRequest && !config.allowAutomaticRequests) {
    return {
      allowed: false,
      reason:
        `Automatic paid API requests are disabled for ${config.provider.toUpperCase()} to protect your budget. ` +
        `Only user-initiated manual actions are allowed, or enable automatic requests in Settings.`,
      config,
    };
  }

  // 3. Check monthly credit limit
  if (config.isPaid && config.creditsUsedThisMonth + estimatedCredits > config.monthlyCreditLimit) {
    return {
      allowed: false,
      reason:
        `Credit budget exceeded for ${config.provider.toUpperCase()}. ` +
        `Used ${config.creditsUsedThisMonth} of ${config.monthlyCreditLimit} monthly credits. ` +
        `Increase your budget limit in Settings to proceed.`,
      config,
    };
  }

  return {
    allowed: true,
    config,
  };
}

/**
 * Records credit consumption after a successful paid API call.
 */
export function recordPaidApiUsage(provider: ProviderId, creditsConsumed: number): void {
  if (creditsConsumed <= 0) return;
  const all = loadProviderBudgets();
  const current = all[provider] || DEFAULT_BUDGETS[provider];
  current.creditsUsedThisMonth += creditsConsumed;
  all[provider] = current;
  saveProviderBudgets(all);
}

/**
 * Resets monthly credit usage (e.g., at beginning of new billing cycle).
 */
export function resetMonthlyCreditUsage(provider: ProviderId): void {
  const all = loadProviderBudgets();
  const current = all[provider] || DEFAULT_BUDGETS[provider];
  current.creditsUsedThisMonth = 0;
  current.lastResetDate = new Date().toISOString();
  all[provider] = current;
  saveProviderBudgets(all);
}
