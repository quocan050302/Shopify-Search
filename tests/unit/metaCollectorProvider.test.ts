import { describe, it, expect } from "vitest";
import { MetaAdsCollectorProvider } from "@/services/discovery/providers/metaAdsCollectorProvider";
import {
  getDiscoveryProvider,
  selectDiscoveryProvider,
} from "@/services/discovery/providerRegistry";
import { DiscoveryQuery } from "@/services/discovery/types";

describe("MetaAdsCollectorProvider Contract & Capabilities", () => {
  it("reports accurate capability flags", () => {
    const provider = new MetaAdsCollectorProvider();
    const caps = provider.getCapabilities();

    expect(caps.providerId).toBe("meta-ads-collector");
    expect(caps.supportsUS).toBe(true);
    expect(caps.supportsKeywordFiltering).toBe(true);
    expect(caps.supportsPagination).toBe(true);
    expect(caps.isPaid).toBe(false);
    expect(caps.requiresAuthentication).toBe(false);
    expect(caps.sourceType).toBe("INTERNAL_ENDPOINT");
    expect(caps.displayName).toContain("Local Collector");
  });

  it("estimates cost as exactly $0.00 (not metered)", () => {
    const provider = new MetaAdsCollectorProvider();
    const query: DiscoveryQuery = {
      workspaceId: "ws_default",
      platform: "META",
      market: "US",
      keywords: ["pet hair remover"],
      industries: [],
      objectives: [],
      searchWindowDays: 30,
      sortBy: "relevance",
      requestedLimit: 25,
      pageSize: 20,
      runMode: "MANUAL",
    };

    const cost = provider.estimateCost(query);
    expect(cost.estimatedCostUsd).toBe(0);
    expect(cost.isPaid).toBe(false);
    expect(cost.isMetered).toBe(false);
  });

  it("checks provider configuration status locally without network calls", () => {
    const provider = new MetaAdsCollectorProvider();
    const status = provider.getProviderConfigurationStatus();

    expect(["READY_UNVERIFIED", "NOT_CONFIGURED"]).toContain(status.status);
    expect(status.message).toBeDefined();
  });

  it("is registered in providerRegistry and selected for META queries", async () => {
    const registered = getDiscoveryProvider("meta-ads-collector");
    expect(registered).toBeDefined();
    expect(registered?.id).toBe("meta-ads-collector");

    const query: DiscoveryQuery = {
      workspaceId: "ws_default",
      platform: "META",
      market: "US",
      keywords: ["laser hair removal"],
      industries: [],
      objectives: [],
      searchWindowDays: 30,
      sortBy: "relevance",
      requestedLimit: 10,
      pageSize: 10,
      runMode: "MANUAL",
    };

    const selected = await selectDiscoveryProvider(query);
    expect(selected.id).toBe("meta-ads-collector");
  });
});
