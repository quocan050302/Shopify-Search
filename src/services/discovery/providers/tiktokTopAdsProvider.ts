/**
 * SWAI V9.2 — TikTok Creative Center Top Ads Provider Adapter
 *
 * Implements the session-authenticated interface to the TikTok Creative
 * Center internal research API endpoint.
 *
 * HONESTY & COMPLIANCE DISCLOSURE:
 * - The endpoint `ads.tiktok.com/creative_radar_api/...` is an UNDOCUMENTED, INTERNAL
 *   endpoint backing TikTok's Creative Center web application. TikTok does not publish
 *   an official third-party API for automated competitor Top Ads discovery in the US.
 * - When TIKTOK_CC_COOKIE is absent, the provider reports NOT_CONFIGURED.
 *   No network requests are dispatched and error 40101 is NEVER fabricated.
 * - Live probes separate: HTTP 401 (REQUIRES_AUTH), HTTP 403 (PERMISSION_DENIED),
 *   HTTP 404 (ENDPOINT_UNSUPPORTED), HTTP 429 (RATE_LIMITED), HTML responses (BLOCKED_SOURCE/WAF),
 *   and code 0 (AVAILABLE).
 * - Zero unauthorized CAPTCHA bypass, rotating proxy evasion, or session forgery is performed.
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
  readonly version = "9.2.0";

  private cachedAvailability: ProviderAvailabilityResult | null = null;
  private cacheTimestampMs = 0;
  private lastVerifiedAt: Date | null = null;
  private lastVerificationError: string | null = null;

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "Session-authenticated interface to TikTok Creative Center internal Top Ads API. " +
        "Free to use with an active CC session cookie. " +
        "WARNING: Endpoint is undocumented, experimental, and subject to TikTok WAF policies.",
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
      isLiveVerified: Boolean(this.cachedAvailability?.status === "AVAILABLE" || this.cachedAvailability?.status === "LIVE_VERIFIED"),
      notes:
        "Requires TIKTOK_CC_COOKIE (session cookie from ads.tiktok.com). " +
        "Without it, status is NOT_CONFIGURED. Endpoint is undocumented and not officially " +
        "supported for third-party automated access. Detail pages are protected from iframe embedding.",
      authMethod: "SESSION_COOKIE",
      allowedDataAccess: "TikTok Creative Center inspiration Top Ads ranking index",
      supportedRegions: ["US"],
      termsBasis: "Undocumented internal web application endpoint (Experimental/Unverified)",
      sourceType: "INTERNAL_ENDPOINT",
      apiDocumentationUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en",
      lastLiveVerificationAt: this.lastVerifiedAt ? this.lastVerifiedAt.toISOString() : null,
      lastVerificationError: this.lastVerificationError,
    };
  }

  /**
   * Static configuration check. Does NOT send any HTTP request.
   */
  getProviderConfigurationStatus(): ProviderAvailabilityResult {
    const cookie = process.env.TIKTOK_CC_COOKIE;

    if (!cookie || cookie.trim().length === 0) {
      return {
        status: "NOT_CONFIGURED",
        message:
          "TIKTOK_CC_COOKIE is not set. " +
          "Automated direct collection requires an active browser session cookie in .env.local, " +
          "or use zero-cost Manual URL Import / Batch Import at /explorer.",
        isAuthorized: false,
        requiresConfig: true,
      };
    }

    return {
      status: "READY_UNVERIFIED",
      message:
        "TIKTOK_CC_COOKIE is configured locally. Ready for authorized connectivity verification probe.",
      isAuthorized: false,
      requiresConfig: false,
    };
  }

  /**
   * Explicit live verification probe against the TikTok endpoint.
   */
  async verifyProviderConnection(): Promise<ProviderAvailabilityResult> {
    const staticStatus = this.getProviderConfigurationStatus();
    if (staticStatus.status === "NOT_CONFIGURED") {
      this.cachedAvailability = staticStatus;
      this.cacheTimestampMs = Date.now();
      return staticStatus;
    }

    const cookie = process.env.TIKTOK_CC_COOKIE!;

    try {
      const probeUrl = `${CC_TOP_ADS_ENDPOINT}?page=1&limit=1&period=30&region=US`;

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

      this.lastVerifiedAt = new Date();

      // HTTP-level Auth & Permission Denials
      if (res.status === 401) {
        const result: ProviderAvailabilityResult = {
          status: "REQUIRES_AUTH",
          message:
            "HTTP 401 Unauthorized: TikTok rejected the session cookie. " +
            "The session has expired or was revoked. Re-authenticate in browser.",
          isAuthorized: false,
          requiresConfig: true,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      if (res.status === 403) {
        const result: ProviderAvailabilityResult = {
          status: "PERMISSION_DENIED",
          message:
            "HTTP 403 Forbidden: TikTok denied access. Web Application Firewall (WAF) or IP block detected.",
          isAuthorized: false,
          requiresConfig: true,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      if (res.status === 404) {
        const result: ProviderAvailabilityResult = {
          status: "ENDPOINT_UNSUPPORTED",
          message:
            "HTTP 404 Not Found: The undocumented TikTok Creative Center endpoint is unavailable or changed.",
          isAuthorized: false,
          requiresConfig: true,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      if (res.status === 429) {
        const result: ProviderAvailabilityResult = {
          status: "RATE_LIMITED",
          message: "HTTP 429: TikTok rate limit exceeded. Please back off before retrying.",
          isAuthorized: false,
          requiresConfig: false,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      // Non-JSON or empty response (WAF HTML challenge)
      if (res.data === null || typeof res.data !== "object") {
        const result: ProviderAvailabilityResult = {
          status: "BLOCKED_SOURCE",
          message:
            "TikTok returned a non-JSON HTML response (WAF / bot detection challenge). " +
            "Direct automation is blocked on this network IP.",
          isAuthorized: false,
          requiresConfig: true,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      const apiCode = (res.data as { code?: number }).code;

      // Upstream Application-level success
      if (apiCode === 0) {
        const result: ProviderAvailabilityResult = {
          status: "AVAILABLE",
          message:
            "Session validated with TikTok Creative Center. " +
            "Live probe returned code 0 — US Top Ads discovery ready.",
          isAuthorized: true,
          requiresConfig: false,
        };
        this.lastVerificationError = null;
        this.cacheResult(result);
        return result;
      }

      // Upstream Application-level auth rejection
      if (apiCode === 40101) {
        const result: ProviderAvailabilityResult = {
          status: "PERMISSION_DENIED",
          message:
            "TikTok Creative Center returned API code 40101 ('no permission'). " +
            "The session cookie has expired or lacks authorization.",
          isAuthorized: false,
          requiresConfig: true,
        };
        this.lastVerificationError = result.message || null;
        this.cacheResult(result);
        return result;
      }

      // Unknown JSON schema response
      const result: ProviderAvailabilityResult = {
        status: "INVALID_RESPONSE",
        message:
          `Unexpected TikTok API response: code ${apiCode ?? "absent"}, ` +
          `msg: "${(res.data as { msg?: string }).msg ?? "none"}".`,
        isAuthorized: false,
        requiresConfig: true,
      };
      this.lastVerificationError = result.message || null;
      this.cacheResult(result);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastVerificationError = msg;

      if (msg.includes("PROVIDER_PERMISSION_DENIED") || msg.includes("access denied") || msg.includes("HTTP 403")) {
        const result: ProviderAvailabilityResult = {
          status: "PERMISSION_DENIED",
          message: `HTTP permission denied by TikTok: ${msg}`,
          isAuthorized: false,
          requiresConfig: true,
        };
        this.cacheResult(result);
        return result;
      }

      if (msg.includes("PROVIDER_RATE_LIMITED") || msg.includes("HTTP 429")) {
        const result: ProviderAvailabilityResult = {
          status: "RATE_LIMITED",
          message: `TikTok rate limit reached: ${msg}`,
          isAuthorized: false,
          requiresConfig: false,
        };
        this.cacheResult(result);
        return result;
      }

      const result: ProviderAvailabilityResult = {
        status: "BLOCKED_SOURCE",
        message: `Connectivity probe failed: ${msg}. Check network route to ads.tiktok.com.`,
        isAuthorized: false,
        requiresConfig: true,
      };
      this.cacheResult(result);
      return result;
    }
  }

  /**
   * Cached availability check to prevent spamming TikTok on every page render.
   * Cache lifetime: 5 minutes.
   */
  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    const staticStatus = this.getProviderConfigurationStatus();
    if (staticStatus.status === "NOT_CONFIGURED") {
      return staticStatus;
    }

    const fiveMinutes = 5 * 60 * 1000;
    if (this.cachedAvailability && Date.now() - this.cacheTimestampMs < fiveMinutes) {
      return this.cachedAvailability;
    }

    return this.verifyProviderConnection();
  }

  private cacheResult(result: ProviderAvailabilityResult): void {
    this.cachedAvailability = result;
    this.cacheTimestampMs = Date.now();
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
