/**
 * SWAI V9 — TikTok Creative Center Top Ads Provider Adapter
 *
 * Implements the direct, authorized interface to TikTok Creative Center Top Ads.
 * Honest status: Returns REQUIRES_AUTH / BLOCKED_SOURCE when session credentials
 * are unconfigured, refusing to fake mock data in production.
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

export class TiktokTopAdsProvider implements AdDiscoveryProvider {
  readonly id = "tiktok-topads";
  readonly name = "TikTok Creative Center Top Ads (Direct)";
  readonly version = "9.0.0";

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "Primary manual & automated research interface for TikTok Creative Center US Top Ads. Free to use with zero external paid credit costs.",
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
      isPaid: false,
      isLiveVerified: false,
      notes: "Requires session authorization (TIKTOK_CC_COOKIE) to prevent 40101 no-permission blocks by TikTok anti-bot WAF.",
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    const cookie = process.env.TIKTOK_CC_COOKIE;

    if (!cookie || cookie.trim().length === 0) {
      return {
        status: "REQUIRES_AUTH",
        message:
          "TikTok Creative Center internal API requires an active session cookie (TIKTOK_CC_COOKIE). " +
          "Without it, TikTok responds with code 40101 ('no permission'). Configure in Settings or use Manual URL Import.",
        isAuthorized: false,
        requiresConfig: true,
      };
    }

    try {
      // Small connectivity probe with the provided cookie
      const res = await executeGuardedProviderRequest<{ code: number; msg: string; data?: unknown }>({
        providerId: this.id,
        url: "https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list?page=1&limit=1&period=30&region=US",
        headers: {
          Cookie: cookie.trim(),
        },
        timeoutMs: 8000,
        isAutomaticRequest: false,
        isPaid: false,
      });

      if (res.data?.code === 0) {
        return {
          status: "AVAILABLE",
          message: "Session authenticated with TikTok Creative Center. Top Ads auto-discovery ready.",
          isAuthorized: true,
          requiresConfig: false,
        };
      }

      if (res.data?.code === 40101) {
        return {
          status: "BLOCKED_SOURCE",
          message: "Provided TIKTOK_CC_COOKIE has expired or lacks permissions (Code 40101). Re-authenticate.",
          isAuthorized: false,
          requiresConfig: true,
        };
      }

      return {
        status: "UNVERIFIED",
        message: `TikTok returned unexpected response: ${res.data?.msg || "Unknown state"}`,
        isAuthorized: false,
        requiresConfig: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "BLOCKED_SOURCE",
        message: `Connectivity probe failed: ${msg}`,
        isAuthorized: false,
        requiresConfig: true,
      };
    }
  }

  estimateCost(_query: DiscoveryQuery): ProviderCostEstimate {
    return {
      estimatedCredits: 0,
      estimatedCostUsd: 0.0,
      isPaid: false,
      isMetered: false,
      isBudgetAvailable: true,
    };
  }

  async discoverPage(
    query: DiscoveryQuery,
    cursor?: string | null,
    context?: ProviderRequestContext
  ): Promise<DiscoveryPageResult> {
    const cookie = process.env.TIKTOK_CC_COOKIE;

    if (!cookie || cookie.trim().length === 0) {
      throw new DiscoveryError({
        code: "NO_AUTHORIZED_PROVIDER",
        message:
          "Authentication required: TikTok Creative Center automated collection requires session authorization. " +
          "TIKTOK_CC_COOKIE is missing. Please configure session credentials in Settings or use free Manual URL Import.",
        providerId: this.id,
        statusHttp: 401,
      });
    }

    const page = cursor ? parseInt(cursor, 10) : 1;
    const limit = Math.min(query.pageSize || 20, 50);
    const period = query.searchWindowDays || 30;
    const region = (query.market || "US").toUpperCase();

    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      period: String(period),
      region,
    });

    if (query.keywords && query.keywords.length > 0) {
      params.set("keyword", query.keywords.join(" "));
    }

    if (query.industries && query.industries.length > 0) {
      params.set("industry", query.industries[0]);
    }

    const endpoint = `https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list?${params.toString()}`;

    const res = await executeGuardedProviderRequest<{
      code: number;
      msg: string;
      data?: {
        list?: Array<Record<string, unknown>>;
        materials?: Array<Record<string, unknown>>;
        pagination?: { has_more?: boolean; page?: number; total?: number };
      };
    }>({
      providerId: this.id,
      url: endpoint,
      headers: {
        Cookie: cookie.trim(),
      },
      jobId: context?.jobId,
      timeoutMs: context?.timeoutMs || 15000,
      isAutomaticRequest: query.runMode === "SCHEDULED",
      isPaid: false,
    });

    if (res.data?.code === 40101) {
      throw new DiscoveryError({
        code: "PROVIDER_PERMISSION_DENIED",
        message: "TikTok session expired or rejected (40101: no permission).",
        providerId: this.id,
        statusHttp: 403,
      });
    }

    if (res.data?.code !== 0 && res.data?.code !== undefined) {
      throw new DiscoveryError({
        code: "PROVIDER_RESPONSE_INVALID",
        message: `TikTok Creative Center API error: ${res.data.msg || "Unknown error"} (code: ${res.data.code})`,
        providerId: this.id,
        statusHttp: 502,
      });
    }

    const rawItems = res.data?.data?.materials || res.data?.data?.list || [];
    const normalizedItems = rawItems.map((item) =>
      normalizeTikTokTopAd(item, {
        providerId: this.id,
        queryMarket: region,
        searchWindowDays: period,
      })
    );

    const hasMore = Boolean(res.data?.data?.pagination?.has_more);
    const nextCursor = hasMore ? String(page + 1) : null;

    return {
      items: normalizedItems,
      nextCursor,
      hasMore,
      requestId: res.providerRequestId,
      usage: { creditsUsed: 0, costUsd: 0 },
    };
  }
}
