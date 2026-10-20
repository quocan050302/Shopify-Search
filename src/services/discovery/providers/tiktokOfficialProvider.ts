/**
 * SWAI V9 — TikTok Official Platform API Adapter
 *
 * Implements the official TikTok Developer Platform adapter.
 * Accurately reports CAPABILITY_UNAVAILABLE / REGION_UNSUPPORTED for commercial
 * US competitor Top Ads discovery since standard TikTok Marketing API permissions
 * only grant access to accounts owned by the authenticated advertiser, and the
 * EU Commercial Content Library API is legally restricted to European Union regions.
 */

import {
  AdDiscoveryProvider,
  ProviderAvailabilityResult,
  ProviderCostEstimate,
} from "../providerContract";
import {
  DiscoveryQuery,
  DiscoveryPageResult,
  DiscoveryProviderCapabilities,
  DiscoveryError,
} from "../types";

export class TiktokOfficialProvider implements AdDiscoveryProvider {
  readonly id = "tiktok-commercial-content-api";
  readonly name = "TikTok Official Platform API";
  readonly version = "9.0.0";

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "Official TikTok Developer Platform API. Commercial US competitor ad discovery is not exposed on public developer tiers.",
      supportsUS: false, // Official EU Library only covers EU; Marketing API only covers owned accounts
      supportsKeywordFiltering: false,
      supportsIndustryFiltering: false,
      supportsPagination: false,
      supportsAdDetails: false,
      supportsVideoMetadata: false,
      supportsLifecycleMetadata: false,
      requiresAuthentication: true,
      isPaid: false,
      isLiveVerified: false,
      notes: "Official TikTok Research API is restricted to accredited university researchers. Commercial Content Library API is restricted to EU DSA compliance.",
      authMethod: "OAUTH2",
      allowedDataAccess: "European Union public commercial repository only (DSA)",
      supportedRegions: ["EU"],
      termsBasis: "Official TikTok Commercial Content API (EU DSA Compliance)",
      sourceType: "OFFICIAL_API",
      apiDocumentationUrl: "https://developers.tiktok.com/doc/commercial-content-api-overview",
      lastLiveVerificationAt: null,
      lastVerificationError: null,
    };
  }

  getProviderConfigurationStatus(): ProviderAvailabilityResult {
    return {
      status: "REGION_UNSUPPORTED",
      message:
        "Official TikTok Commercial Content Library API is legally restricted to European Union member states (EU DSA). " +
        "United States commercial competitor ad discovery is not supported on this official endpoint.",
      isAuthorized: false,
      requiresConfig: false,
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    return this.getProviderConfigurationStatus();
  }

  estimateCost(_query: DiscoveryQuery): ProviderCostEstimate {
    return {
      estimatedCredits: 0,
      estimatedCostUsd: 0,
      isPaid: false,
      isBudgetAvailable: true,
    };
  }

  async discoverPage(query: DiscoveryQuery): Promise<DiscoveryPageResult> {
    if (query.market?.toUpperCase() === "US") {
      throw new DiscoveryError({
        code: "PROVIDER_REGION_UNSUPPORTED",
        message:
          "Official TikTok API does not provide third-party commercial ad discovery in the United States. " +
          "Please select 'TikTok Creative Center Top Ads' or 'Manual URL Import' for US ecommerce research.",
        providerId: this.id,
        statusHttp: 400,
      });
    }

    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      usage: { creditsUsed: 0, costUsd: 0 },
    };
  }
}
