/**
 * SWAI V9 — Ad Discovery Provider Contract
 *
 * Defines the standard interface and contracts for external ad discovery providers.
 * All discovery adapters (TikTok Top Ads, Apify, Manual Import) must implement this interface.
 */

import {
  DiscoveryQuery,
  DiscoveryPageResult,
  DiscoveryProviderCapabilities,
  ProviderAvailabilityStatus,
} from "./types";

export interface ProviderAvailabilityResult {
  status: ProviderAvailabilityStatus;
  message?: string;
  isAuthorized: boolean;
  requiresConfig: boolean;
  rateLimitRemaining?: number;
}

export interface ProviderCostEstimate {
  estimatedCredits: number;
  estimatedCostUsd?: number;
  isPaid: boolean;
  isMetered?: boolean;
  isBudgetAvailable: boolean;
  budgetWarning?: string;
}

export interface ProviderRequestContext {
  jobId?: string;
  scheduleId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AdDiscoveryProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  /**
   * Returns metadata and capability flags supported by this provider.
   */
  getCapabilities(): DiscoveryProviderCapabilities;

  /**
   * Performs an authorized availability check (connectivity, authentication, permissions).
   * Does NOT consume paid credits or make heavy requests.
   */
  checkAvailability(): Promise<ProviderAvailabilityResult>;

  /**
   * Estimates the credit and monetary cost of executing the given query.
   */
  estimateCost(query: DiscoveryQuery): ProviderCostEstimate;

  /**
   * Retrieves a single page of genuine advertisement records from the provider.
   * Throws DiscoveryError on access denial, rate limit, or invalid response.
   */
  discoverPage(
    query: DiscoveryQuery,
    cursor?: string | null,
    context?: ProviderRequestContext
  ): Promise<DiscoveryPageResult>;
}
