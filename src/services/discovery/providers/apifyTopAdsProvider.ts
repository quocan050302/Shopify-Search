/**
 * SWAI V9 — Apify Top Ads Actor Provider Adapter (Optional Paid)
 *
 * Implements secondary integration with Apify Actor (e.g. lagenuina_agency/tiktok-top-ads-scraper).
 * Strictly disabled by default. Requires explicit APIFY_TOKEN and budget authorization.
 */

import {
  AdDiscoveryProvider,
  ProviderAvailabilityResult,
  ProviderCostEstimate,
  ProviderRequestContext,
} from "../providerContract";
import {
  DiscoveryQuery,
  DiscoveryPageResult,
  DiscoveryProviderCapabilities,
  DiscoveryError,
} from "../types";
import { executeGuardedProviderRequest } from "../providerRequestGuard";
import { normalizeTikTokTopAd } from "../normalization/normalizeTikTokTopAd";
import { getProviderBudget } from "@/services/providers/budgetService";

export class ApifyTopAdsProvider implements AdDiscoveryProvider {
  readonly id = "apify-topads";
  readonly name = "Apify TikTok Top Ads (Metered)";
  readonly version = "9.0.0";

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "Optional metered Apify Actor integration. Offloads browser automation to cloud actors. Disabled by default to protect user budget.",
      supportsUS: true,
      supportsKeywordFiltering: true,
      supportsKeywords: true,
      supportsIndustryFiltering: true,
      supportsIndustries: true,
      supportsPagination: true,
      supportsAdDetails: true,
      supportsVideoMetadata: true,
      supportsLifecycleMetadata: true,
      requiresAuthentication: true,
      requiresAuth: true,
      isPaid: true,
      isLiveVerified: false,
      notes: "Requires APIFY_TOKEN and explicit budget authorization. Consumes paid credits.",
      authMethod: "BEARER_TOKEN",
      allowedDataAccess: "Apify Actor dataset results",
      supportedRegions: ["US", "GLOBAL"],
      termsBasis: "Apify Platform API & Actor Terms of Service",
      sourceType: "CLOUD_ACTOR",
      apiDocumentationUrl: "https://docs.apify.com/api/v2",
      lastLiveVerificationAt: null,
      lastVerificationError: null,
    };
  }

  getProviderConfigurationStatus(): ProviderAvailabilityResult {
    const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;

    if (!token || token.trim().length === 0) {
      return {
        status: "NOT_CONFIGURED",
        message: "APIFY_TOKEN is not configured. Provider is disabled.",
        isAuthorized: false,
        requiresConfig: true,
      };
    }

    const budget = getProviderBudget("apify");
    const isExplicitlyEnabled = process.env.ENABLE_APIFY_DISCOVERY === "true" || budget.enabled === true;

    if (!isExplicitlyEnabled) {
      return {
        status: "PAID_DISABLED",
        message:
          "Paid discovery providers are disabled by default ($0 spending policy). " +
          "Set ENABLE_APIFY_DISCOVERY=true in .env.local or enable in Settings → API Connections & Budgets.",
        isAuthorized: false,
        requiresConfig: true,
      };
    }

    return {
      status: "READY_UNVERIFIED",
      message: "APIFY_TOKEN is configured and enabled. Ready for live probe.",
      isAuthorized: true,
      requiresConfig: false,
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    const configStatus = this.getProviderConfigurationStatus();
    if (configStatus.status !== "READY_UNVERIFIED") {
      return configStatus;
    }
    return this.verifyProviderConnection();
  }

  async verifyProviderConnection(): Promise<ProviderAvailabilityResult> {
    const configStatus = this.getProviderConfigurationStatus();
    if (configStatus.status !== "READY_UNVERIFIED") {
      return configStatus;
    }

    const token = (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN)!.trim();

    try {
      const res = await executeGuardedProviderRequest<{ data?: { username?: string } }>({
        providerId: this.id,
        url: "https://api.apify.com/v2/users/me",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeoutMs: 5000,
        isAutomaticRequest: false,
        isPaid: false,
      });

      if (res.status === 200 && res.data?.data?.username) {
        return {
          status: "AVAILABLE",
          message: `Connected to Apify as '${res.data.data.username}'. Ready for authorized runs.`,
          isAuthorized: true,
          requiresConfig: false,
        };
      }

      return {
        status: "REQUIRES_AUTH",
        message: "Apify token rejected by upstream API.",
        isAuthorized: false,
        requiresConfig: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "BLOCKED_SOURCE",
        message: `Apify health check failed: ${msg}`,
        isAuthorized: false,
        requiresConfig: true,
      };
    }
  }

  estimateCost(query: DiscoveryQuery): ProviderCostEstimate {
    const pages = Math.ceil(query.requestedLimit / (query.pageSize || 20));
    const estimatedCredits = Math.max(1, pages);
    const estimatedCostUsd = estimatedCredits * 0.05;

    return {
      estimatedCredits,
      estimatedCostUsd,
      isPaid: true,
      isMetered: true,
      isBudgetAvailable: true,
    };
  }

  async discoverPage(
    query: DiscoveryQuery,
    _cursor?: string | null,
    context?: ProviderRequestContext
  ): Promise<DiscoveryPageResult> {
    // Strict Zero-Cost & Authorization Guard
    if (process.env.FREE_DISCOVERY_MODE === "true") {
      throw new DiscoveryError({
        code: "PROVIDER_BUDGET_BLOCKED",
        message: "Apify metered discovery is blocked: FREE_DISCOVERY_MODE is active ($0 spending policy).",
        providerId: this.id,
        statusHttp: 403,
      });
    }

    if (process.env.ENABLE_APIFY_DISCOVERY !== "true") {
      throw new DiscoveryError({
        code: "PROVIDER_BUDGET_BLOCKED",
        message:
          "Apify metered discovery is disabled. " +
          "Explicitly set ENABLE_APIFY_DISCOVERY=true in .env.local and enable Apify in Settings → API Connections.",
        providerId: this.id,
        statusHttp: 403,
      });
    }

    const token = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;

    if (!token || token.trim().length === 0) {
      throw new DiscoveryError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "APIFY_TOKEN is missing. Please configure token in environment.",
        providerId: this.id,
        statusHttp: 401,
      });
    }

    const periodStr = String(query.searchWindowDays || 30);
    const countryCode = (query.market || "US").toUpperCase();
    const actorId = process.env.APIFY_TIKTOK_ACTOR_ID || "lagenuina_agency~tiktok-top-ads-scraper";

    // Run Actor through guarded request
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=60`;

    const runPayload = {
      countryCode,
      period: periodStr,
      orderBy: query.sortBy === "ctr" ? "ctr" : "likes",
      maxItems: Math.min(query.pageSize || 20, 50),
      industry: query.industries?.[0] || undefined,
    };

    const res = await executeGuardedProviderRequest<Array<Record<string, unknown>>>({
      providerId: this.id,
      url: runUrl,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(runPayload),
      jobId: context?.jobId,
      timeoutMs: 65000,
      estimatedCredits: 1,
      isAutomaticRequest: query.runMode === "SCHEDULED",
      isPaid: true,
    });

    const items = Array.isArray(res.data) ? res.data : [];
    const normalizedItems = items.map((item) =>
      normalizeTikTokTopAd(item, {
        providerId: this.id,
        queryMarket: countryCode,
        searchWindowDays: query.searchWindowDays,
      })
    );

    return {
      items: normalizedItems,
      nextCursor: null, // Apify sync run returns the requested limit in one batch
      hasMore: false,
      requestId: res.providerRequestId,
      usage: { creditsUsed: 1, costUsd: 0.05 },
    };
  }
}
