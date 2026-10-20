/**
 * SWAI V9.1 — TikTok Creative Center Top Ads Provider Adapter
 *
 * Implements the direct, session-authenticated interface to the TikTok Creative
 * Center internal research API endpoint.
 *
 * IMPORTANT HONESTY NOTES:
 * - The endpoint `ads.tiktok.com/creative_radar_api/...` is NOT an official public
 *   TikTok Business API. It is the internal XHR endpoint backing the Creative Center
 *   web UI. TikTok does not publish its schema or guarantee stability.
 * - When TIKTOK_CC_COOKIE is absent the provider returns NOT_CONFIGURED — it does
 *   NOT claim TikTok returned a 40101 error (that would be fabricated evidence).
 * - A live connectivity probe is only made when the cookie IS present.
 * - No CAPTCHA bypass, proxy rotation, or session impersonation is performed.
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

/** Undocumented internal endpoint backing TikTok Creative Center Top Ads UI */
const CC_TOP_ADS_ENDPOINT =
  "https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list";

export class TiktokTopAdsProvider implements AdDiscoveryProvider {
  readonly id = "tiktok-topads";
  readonly name = "TikTok Creative Center Top Ads (Direct)";
  readonly version = "9.1.0";

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "Session-authenticated interface to TikTok Creative Center internal Top Ads API. " +
        "Free to use with an active CC session cookie. " +
        "WARNING: endpoint is not officially documented and may change without notice.",
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
      notes:
        "Requires TIKTOK_CC_COOKIE (browser session cookie from ads.tiktok.com). " +
        "Without it, the provider is NOT_CONFIGURED — the cookie absence alone does NOT " +
        "prove TikTok returned error 40101. A live probe is performed only when the cookie " +
        "is provided. This endpoint is undocumented and not officially supported by TikTok.",
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    const cookie = process.env.TIKTOK_CC_COOKIE;

    // State 1: NOT_CONFIGURED — credential simply not provided; we make no claims
    // about what TikTok would return because we haven't tried.
    if (!cookie || cookie.trim().length === 0) {
      return {
        status: "NOT_CONFIGURED",
        message:
          "TIKTOK_CC_COOKIE is not set. " +
          "Export a valid session cookie from ads.tiktok.com and add it to your .env.local file. " +
          "Without it, automated collection is unavailable — use Manual URL Import instead.",
        isAuthorized: false,
        requiresConfig: true,
      };
    }

    // State 2: Cookie is present — attempt a minimal 1-item probe to verify.
    try {
      const probeUrl =
        `${CC_TOP_ADS_ENDPOINT}?page=1&limit=1&period=30&region=US`;

      const res = await executeGuardedProviderRequest<{
        code?: number;
        msg?: string;
        data?: unknown;
      }>({
        providerId: this.id,
        url: probeUrl,
        headers: { Cookie: cookie.trim() },
        timeoutMs: 10000,
        isAutomaticRequest: false,
        isPaid: false,
      });

      // HTTP-level auth failure
      if (res.status === 401 || res.status === 403) {
        return {
          status: "BLOCKED_SOURCE",
          message:
            `HTTP ${res.status}: TikTok rejected the session cookie. ` +
            "The cookie may have expired or been invalidated. Re-authenticate in your browser.",
          isAuthorized: false,
          requiresConfig: true,
        };
      }

      // Non-JSON or empty body (likely a WAF HTML block page)
      if (res.data === null || typeof res.data !== "object") {
        return {
          status: "BLOCKED_SOURCE",
          message:
            "TikTok returned a non-JSON response. The endpoint may be WAF-blocked or the " +
            "session cookie is from a different geographic IP than this server.",
          isAuthorized: false,
          requiresConfig: true,
        };
      }

      const apiCode = (res.data as { code?: number }).code;

      // Application-level success
      if (apiCode === 0) {
        return {
          status: "AVAILABLE",
          message:
            "Session validated with TikTok Creative Center. " +
            "Live probe returned code 0 — Top Ads auto-discovery is ready.",
          isAuthorized: true,
          requiresConfig: false,
        };
      }

      // Application-level auth rejection
      if (apiCode === 40101) {
        return {
          status: "BLOCKED_SOURCE",
          message:
            "TikTok Creative Center returned code 40101 ('no permission'). " +
            "The session cookie has expired or lacks the required permissions. " +
            "Please re-authenticate and update TIKTOK_CC_COOKIE.",
          isAuthorized: false,
          requiresConfig: true,
        };
      }

      // Unknown endpoint response (e.g., API schema changed)
      return {
        status: "UNVERIFIED",
        message:
          `Unexpected TikTok API response: code ${apiCode ?? "absent"}, ` +
          `msg: "${(res.data as { msg?: string }).msg ?? "none"}". ` +
          "The internal endpoint schema may have changed.",
        isAuthorized: false,
        requiresConfig: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Network failure: connectivity, DNS, TLS — no claim about TikTok's auth response
      if (
        msg.includes("PROVIDER_PERMISSION_DENIED") ||
        msg.includes("access denied")
      ) {
        return {
          status: "BLOCKED_SOURCE",
          message: `HTTP permission denied by TikTok during probe: ${msg}`,
          isAuthorized: false,
          requiresConfig: true,
        };
      }

      return {
        status: "BLOCKED_SOURCE",
        message: `Connectivity probe failed: ${msg}. Check network access to ads.tiktok.com.`,
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
        code: "PROVIDER_NOT_CONFIGURED",
        message:
          "TIKTOK_CC_COOKIE is not configured. " +
          "Automated TikTok Top Ads collection requires an active session cookie. " +
          "Add TIKTOK_CC_COOKIE to .env.local or use Manual URL Import.",
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

    const endpoint = `${CC_TOP_ADS_ENDPOINT}?${params.toString()}`;

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
      headers: { Cookie: cookie.trim() },
      jobId: context?.jobId,
      timeoutMs: context?.timeoutMs || 15000,
      isAutomaticRequest: query.runMode === "SCHEDULED",
      isPaid: false,
    });

    if (res.data?.code === 40101) {
      throw new DiscoveryError({
        code: "PROVIDER_PERMISSION_DENIED",
        message:
          "TikTok session rejected during data fetch (code 40101: no permission). " +
          "The session cookie has expired. Update TIKTOK_CC_COOKIE and retry.",
        providerId: this.id,
        statusHttp: 403,
      });
    }

    if (res.data?.code !== 0 && res.data?.code !== undefined) {
      throw new DiscoveryError({
        code: "PROVIDER_RESPONSE_INVALID",
        message:
          `TikTok Creative Center API error: ${res.data.msg || "Unknown error"} ` +
          `(code: ${res.data.code}). The undocumented endpoint schema may have changed.`,
        providerId: this.id,
        statusHttp: 502,
      });
    }

    const rawItems =
      res.data?.data?.materials || res.data?.data?.list || [];

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
