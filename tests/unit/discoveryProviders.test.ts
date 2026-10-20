import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TiktokTopAdsProvider } from "@/services/discovery/providers/tiktokTopAdsProvider";
import { ApifyTopAdsProvider } from "@/services/discovery/providers/apifyTopAdsProvider";
import { TiktokOfficialProvider } from "@/services/discovery/providers/tiktokOfficialProvider";
import {
  registerDiscoveryProvider,
  getDiscoveryProvider,
  listDiscoveryProviders,
  selectDiscoveryProvider,
} from "@/services/discovery/providerRegistry";
import { DiscoveryQuery } from "@/services/discovery/types";

describe("Discovery Provider Contracts & Adapters", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TIKTOK_CC_COOKIE;
    delete process.env.APIFY_API_TOKEN;
    delete process.env.ENABLE_PAID_APIFY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("TiktokTopAdsProvider (Free-First Direct Source)", () => {
    it("reports accurate capability flags", () => {
      const provider = new TiktokTopAdsProvider();
      const caps = provider.getCapabilities();

      expect(caps.supportsUS).toBe(true);
      expect(caps.supportsKeywords).toBe(true);
      expect(caps.supportsIndustries).toBe(true);
      expect(caps.isPaid).toBe(false);
      expect(caps.requiresAuth).toBe(true);
    });

    it("estimates cost as exactly $0.00", () => {
      const provider = new TiktokTopAdsProvider();
      const cost = provider.estimateCost({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: [],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 50,
        pageSize: 20,
        runMode: "MANUAL",
      });

      expect(cost.estimatedCostUsd).toBe(0);
      expect(cost.isMetered).toBe(false);
    });

    it("honestly reports NOT_CONFIGURED when no browser session cookie is configured", async () => {
      const provider = new TiktokTopAdsProvider();
      const configStatus = provider.getProviderConfigurationStatus();
      expect(configStatus.status).toBe("NOT_CONFIGURED");
      expect(configStatus.message).toContain("TIKTOK_CC_COOKIE");

      const status = await provider.checkAvailability();
      expect(status.status).toBe("NOT_CONFIGURED");
      expect(status.message).toContain("TIKTOK_CC_COOKIE");
      expect(status.message).not.toContain("40101");
    });

    it("halts safely on missing cookie without attempting evasion or fake data", async () => {
      const provider = new TiktokTopAdsProvider();
      const query: DiscoveryQuery = {
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["beauty"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "likes",
        requestedLimit: 10,
        pageSize: 10,
        runMode: "MANUAL",
      };

      await expect(provider.discoverPage(query)).rejects.toThrow("TIKTOK_CC_COOKIE is not configured");
    });
  });

  describe("ApifyTopAdsProvider (Optional Paid Provider - Disabled by Default)", () => {
    it("reports capability as paid and requiring authentication", () => {
      const provider = new ApifyTopAdsProvider();
      const caps = provider.getCapabilities();

      expect(caps.isPaid).toBe(true);
      expect(caps.requiresAuth).toBe(true);
    });

    it("reports NOT_CONFIGURED when APIFY_API_TOKEN is absent", async () => {
      const provider = new ApifyTopAdsProvider();
      const status = await provider.checkAvailability();

      expect(status.status).toBe("NOT_CONFIGURED");
    });

    it("estimates positive metered cost", () => {
      const provider = new ApifyTopAdsProvider();
      const cost = provider.estimateCost({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: [],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 20,
        pageSize: 20,
        runMode: "MANUAL",
      });

      expect(cost.estimatedCostUsd).toBeGreaterThan(0);
      expect(cost.isMetered).toBe(true);
    });

    it("blocks execution if paid provider is disabled or unauthorized", async () => {
      const provider = new ApifyTopAdsProvider();
      const query: DiscoveryQuery = {
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["fitness"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "likes",
        requestedLimit: 10,
        pageSize: 10,
        runMode: "MANUAL",
      };

      await expect(provider.discoverPage(query)).rejects.toThrow();
    });
  });

  describe("TiktokOfficialProvider (Official API Capability Limitations)", () => {
    it("reports REGION_UNSUPPORTED for US commercial ads research", async () => {
      const provider = new TiktokOfficialProvider();
      const status = await provider.checkAvailability();

      expect(status.status).toBe("REGION_UNSUPPORTED");
      expect(status.message).toContain("commercial competitor ad discovery");
    });
  });

  describe("Discovery Provider Registry & Selection Priority", () => {
    it("lists all registered providers with distinct IDs", () => {
      const providers = listDiscoveryProviders();
      expect(providers.length).toBeGreaterThanOrEqual(3);

      const ids = providers.map((p) => p.id);
      expect(ids).toContain("tiktok-topads");
      expect(ids).toContain("apify-topads");
      expect(ids).toContain("tiktok-commercial-content-api");
    });

    it("selects free direct provider by default without auto-falling back to paid", async () => {
      const selected = await selectDiscoveryProvider({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["beauty"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 10,
        pageSize: 10,
        runMode: "MANUAL",
      });
      expect(selected.id).toBe("tiktok-topads");
      expect(selected.getCapabilities().isPaid).toBe(false);
    });

    it("only selects paid provider when explicitly requested", async () => {
      const selected = await selectDiscoveryProvider({
        workspaceId: "ws_default",
        platform: "TIKTOK",
        market: "US",
        keywords: ["beauty"],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 10,
        pageSize: 10,
        providerId: "apify-topads",
        runMode: "MANUAL",
      });
      expect(selected.id).toBe("apify-topads");
    });
  });
});
