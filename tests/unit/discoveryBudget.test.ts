import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeProviderRequest } from "@/services/discovery/providerRequestGuard";
import { authorizePaidApiCall, getProviderBudget } from "@/services/providers/budgetService";
import { ApifyTopAdsProvider } from "@/services/discovery/providers/apifyTopAdsProvider";
import { DiscoveryQuery } from "@/services/discovery/types";

describe("Discovery Budget & Zero-Cost Guard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ENABLE_PAID_APIFY;
    process.env.FREE_DISCOVERY_MODE = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("ensures Captapi is disabled by default in provider budgets", () => {
    const budget = getProviderBudget("captapi");
    expect(budget.enabled).toBe(false);
    expect(budget.isPaid).toBe(true);
    expect(budget.isOptional).toBe(true);
  });

  it("blocks paid API calls by default when provider is not enabled", () => {
    const auth = authorizePaidApiCall({
      provider: "captapi",
      estimatedCredits: 10,
      isAutomaticRequest: true,
    });

    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain("disabled by default");
  });

  it("rejects metered requests when FREE_DISCOVERY_MODE is enabled", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(
      executeProviderRequest({
        providerId: "apify_tiktok_top_ads",
        url: "https://api.apify.com/v2/acts/some-actor/runs",
        method: "POST",
        isPaid: true,
        estimatedCostUsd: 0.05,
      })
    ).rejects.toThrow("FREE_DISCOVERY_MODE is active");

    // Strictly verify no network request was dispatched
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ensures Apify adapter refuses execution in free discovery mode", async () => {
    const provider = new ApifyTopAdsProvider();
    const query: DiscoveryQuery = {
      workspaceId: "ws_default",
      platform: "TIKTOK",
      market: "US",
      keywords: ["skincare"],
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

  it("blocks SSRF attempts to private IP ranges or non-approved hostnames", async () => {
    await expect(
      executeProviderRequest({
        providerId: "tiktok_creative_center_direct",
        url: "http://169.254.169.254/latest/meta-data/",
        method: "GET",
      })
    ).rejects.toThrow();

    await expect(
      executeProviderRequest({
        providerId: "tiktok_creative_center_direct",
        url: "http://localhost:3000/api/v1/internal",
        method: "GET",
      })
    ).rejects.toThrow();
  });
});
