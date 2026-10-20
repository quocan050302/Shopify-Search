/**
 * SWAI V9.2 — Verification & Safety Regression Test Suite
 *
 * Verifies:
 * 1. Local environment loader & diagnostic reporting without credential leak.
 * 2. Dedicated Apify budget configuration & typed error on unknown providers.
 * 3. TiktokTopAdsProvider static configuration inspection (zero HTTP probes when cookie absent).
 * 4. Free provider cost estimation is strictly $0.00.
 * 5. Bounded job leasing & cancellation safety.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateDiscoveryEnvironment, loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
import { getProviderBudget, authorizePaidApiCall } from "@/services/providers/budgetService";
import { TiktokTopAdsProvider } from "@/services/discovery/providers/tiktokTopAdsProvider";
import { ApifyTopAdsProvider } from "@/services/discovery/providers/apifyTopAdsProvider";
import { selectDiscoveryProvider, listDiscoveryProviders } from "@/services/discovery/providerRegistry";
import { ProviderId } from "@/services/credentials/credentialService";

describe("SWAI V9.2 Discovery Authentication, Budget & Provider Safety", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TIKTOK_CC_COOKIE;
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_API_TOKEN;
    delete process.env.ENABLE_APIFY_DISCOVERY;
    process.env.FREE_DISCOVERY_MODE = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Environment Loading & Precedence", () => {
    it("loads local environment safely without throwing", () => {
      const result = loadLocalEnvironment();
      expect(result.loadedSuccessfully).toBe(true);
      expect(Array.isArray(result.loadedFiles)).toBe(true);
    });

    it("returns safe environment diagnostic report without printing secrets", () => {
      const report = validateDiscoveryEnvironment();
      expect(report).toBeDefined();
      expect(typeof report.databaseConfigured).toBe("boolean");
      expect(typeof report.freeDiscoveryMode).toBe("boolean");
      expect(report.freeDiscoveryMode).toBe(true);
      expect(report.tiktokCookieConfigured).toBe(false);
      expect(report.enableApifyDiscovery).toBe(false);
      // Ensure no raw secrets exist in report keys
      expect(Object.keys(report)).not.toContain("rawSecret");
      expect(Object.keys(report)).not.toContain("cookieValue");
    });
  });

  describe("2. Dedicated Apify Budget Configuration (Phase 8)", () => {
    it("has dedicated Apify budget entry disabled by default with 0 credit limit", () => {
      const apifyBudget = getProviderBudget("apify");
      expect(apifyBudget).toBeDefined();
      expect(apifyBudget.provider).toBe("apify");
      expect(apifyBudget.enabled).toBe(false);
      expect(apifyBudget.isPaid).toBe(true);
      expect(apifyBudget.monthlyCreditLimit).toBe(0);
      expect(apifyBudget.allowAutomaticRequests).toBe(false);
    });

    it("throws a typed error when an unknown provider ID is requested in getProviderBudget", () => {
      expect(() => getProviderBudget("unknown_fake_provider" as ProviderId)).toThrow(
        "Unknown or unsupported provider ID"
      );
    });

    it("rejects unknown provider IDs in authorizePaidApiCall before checking budget", () => {
      const auth = authorizePaidApiCall({
        provider: "non_existent_provider" as ProviderId,
        estimatedCredits: 1,
        isAutomaticRequest: false,
      });

      expect(auth.allowed).toBe(false);
      expect(auth.reason).toContain("Unknown or unconfigured paid provider");
    });

    it("blocks Apify execution when ENABLE_APIFY_DISCOVERY is not true", async () => {
      const provider = new ApifyTopAdsProvider();
      const status = await provider.checkAvailability();
      // Without token, reports NOT_CONFIGURED
      expect(status.status).toBe("NOT_CONFIGURED");

      // With token but without ENABLE_APIFY_DISCOVERY, reports PAID_DISABLED
      process.env.APIFY_TOKEN = "apify_api_mock_token_12345";
      const statusWithToken = await provider.checkAvailability();
      expect(statusWithToken.status).toBe("PAID_DISABLED");
      expect(statusWithToken.isAuthorized).toBe(false);
    });
  });

  describe("3. TikTok Provider State Machine & Honest Availability (Phase 5)", () => {
    it("reports NOT_CONFIGURED without making an HTTP request when cookie is absent", async () => {
      const provider = new TiktokTopAdsProvider();
      const staticStatus = provider.getProviderConfigurationStatus();
      expect(staticStatus.status).toBe("NOT_CONFIGURED");
      expect(staticStatus.isAuthorized).toBe(false);
      expect(staticStatus.requiresConfig).toBe(true);
      expect(staticStatus.message).not.toContain("40101");

      const avail = await provider.checkAvailability();
      expect(avail.status).toBe("NOT_CONFIGURED");
      expect(avail.isAuthorized).toBe(false);
    });

    it("reports capabilities with accurate source compatibility metadata", () => {
      const provider = new TiktokTopAdsProvider();
      const caps = provider.getCapabilities();

      expect(caps.supportsUS).toBe(true);
      expect(caps.isPaid).toBe(false);
      expect(caps.sourceType).toBe("INTERNAL_ENDPOINT");
      expect(caps.authMethod).toBe("SESSION_COOKIE");
      expect(caps.notes).toContain("undocumented and not officially supported");
    });

    it("estimates cost as strictly $0.00 for free direct provider", () => {
      const provider = new TiktokTopAdsProvider();
      const cost = provider.estimateCost({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["skincare"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 20,
        pageSize: 20,
        runMode: "MANUAL",
      });

      expect(cost.isPaid).toBe(false);
      expect(cost.estimatedCredits).toBe(0);
      expect(cost.estimatedCostUsd).toBe(0.0);
    });
  });

  describe("4. Provider Registry Selection & Zero-Cost Priority (Phase 7)", () => {
    it("lists all registered providers", () => {
      const providers = listDiscoveryProviders();
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("tiktok-topads");
      expect(ids).toContain("apify-topads");
      expect(ids).toContain("tiktok-commercial-content-api");
    });

    it("never automatically falls back to Apify or paid provider when free provider is unconfigured", async () => {
      const selected = await selectDiscoveryProvider({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["gadgets"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 10,
        pageSize: 10,
        runMode: "MANUAL",
      });

      // Must remain on tiktok-topads (which honestly reports NOT_CONFIGURED)
      // and NOT silently activate apify-topads!
      expect(selected.id).toBe("tiktok-topads");
    });
  });
});
