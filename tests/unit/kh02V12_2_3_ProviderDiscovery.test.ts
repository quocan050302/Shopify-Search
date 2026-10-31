/**
 * SWAI KH-02 V12.2.3 — Zero-Key Provider Auto-Discovery & Capability Probing Test Suite
 *
 * Verifies:
 * 1. Automatic discovery across all 5 intelligence providers
 * 2. Provider access classes (LOCAL_COLLECTOR_AVAILABLE, FREE_API_KEY_REQUIRED, etc.)
 * 3. Non-metered safe capability probing
 * 4. Zero unapproved credit spend compliance ($0 budget)
 * 5. Accurate blocker reporting without false positive connections
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  discoverAvailableKH02Providers,
  probeKH02ProviderCapabilities,
} from "@/services/kh02/providers/providerDiscoveryService";
import { ProviderAccessClass } from "@/services/kh02/types";

describe("SWAI KH-02 V12.2.3 — Zero-Key Provider Discovery Engine", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("discovers all supported intelligence sources without incurring costs", async () => {
    const results = await discoverAvailableKH02Providers({ allowPaidOperations: false });

    expect(results.length).toBeGreaterThanOrEqual(4);
    const providerIds = results.map((r) => r.providerId);
    expect(providerIds).toContain("META_ADS");
    expect(providerIds).toContain("TIKTOK_ADS");
    expect(providerIds).toContain("GOOGLE_ADS");
    expect(providerIds).toContain("DEMAND_HISTORY");
  });

  it("correctly assigns access classes to each provider", async () => {
    delete process.env.HASDATA_API_KEY;
    delete process.env.TIKTOK_ORGANIC_API_KEY;
    delete process.env.TIKTOK_CC_COOKIE;
    delete process.env.APIFY_TOKEN;
    delete process.env.GOOGLE_TRANSPARENCY_MCP_URL;
    delete process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;
    delete process.env.SERPAPI_API_KEY;

    const results = await discoverAvailableKH02Providers({ allowPaidOperations: false });
    const byId = Object.fromEntries(results.map((r) => [r.providerId, r]));

    // Meta Ads uses local Python MCP stdio
    expect(byId.META_ADS.accessClass).toBe<ProviderAccessClass>("LOCAL_COLLECTOR_AVAILABLE");

    // TikTok Ads defaults to manual import if no session cookie or apify token
    expect(byId.TIKTOK_ADS.accessClass).toBe<ProviderAccessClass>("MANUAL_IMPORT_ONLY");

    // TikTok Organic is hidden/disabled or requires credentials if probed
    if (byId.TIKTOK_ORGANIC) {
      expect(["FREE_API_KEY_REQUIRED", "UNSUPPORTED"]).toContain(byId.TIKTOK_ORGANIC.accessClass);
    }

    // Google Ads Transparency is unsupported without configured MCP
    expect(byId.GOOGLE_ADS.accessClass).toBe<ProviderAccessClass>("UNSUPPORTED");

    // Local calculation / Google Free demand is zero-key authorized or manual import
    expect(["MANUAL_IMPORT_ONLY", "ZERO_KEY_AUTHORIZED"]).toContain(byId.DEMAND_HISTORY.accessClass);
  });

  it("promotes TikTok Ads access class when free Creative Center session cookie is provided", async () => {
    process.env.TIKTOK_CC_COOKIE = "session_cookie_mock_value";

    const caps = await probeKH02ProviderCapabilities("TIKTOK_ADS");
    expect(caps.accessClass).toBe<ProviderAccessClass>("FREE_ACCOUNT_REQUIRED");
    expect(caps.configured).toBe(true);
    expect(caps.supportedTools).toContain("tiktok_cc_top_ads_search");
  });

  it("promotes Google Ads access class when MCP URL is configured", async () => {
    process.env.GOOGLE_TRANSPARENCY_MCP_URL = "http://127.0.0.1:8999/mcp";

    const caps = await probeKH02ProviderCapabilities("GOOGLE_ADS");
    expect(caps.accessClass).toBe<ProviderAccessClass>("ZERO_KEY_AUTHORIZED");
    expect(caps.configured).toBe(true);
  });

  it("probes Meta Ads capabilities and identifies local MCP tools", async () => {
    const caps = await probeKH02ProviderCapabilities("META_ADS");
    expect(caps.providerId).toBe("META_ADS");
    expect(caps.supportsUS).toBe(true);
    expect(caps.supportsKeywordSearch).toBe(true);
    expect(caps.supportsDateFiltering).toBe(true);
    expect(caps.estimatedCostPerQueryCredits).toBe(0);
  });

  it("accurately reports blocker reasons for unconfigured external providers", async () => {
    delete process.env.HASDATA_API_KEY;
    delete process.env.TIKTOK_ORGANIC_API_KEY;
    delete process.env.TIKTOK_CC_COOKIE;
    delete process.env.APIFY_TOKEN;
    delete process.env.GOOGLE_TRANSPARENCY_MCP_URL;
    delete process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;
    delete process.env.SERPAPI_API_KEY;

    const results = await discoverAvailableKH02Providers({ allowPaidOperations: false });
    const byId = Object.fromEntries(results.map((r) => [r.providerId, r]));

    // TikTok Organic (if present in discovery)
    if (byId.TIKTOK_ORGANIC) {
      expect(["MISSING_CREDENTIALS", "DISABLED_BY_POLICY"]).toContain(byId.TIKTOK_ORGANIC.readiness.blockerCode);
    }

    // TikTok Ads
    expect(byId.TIKTOK_ADS.readiness.blockerCode).toBe("NO_AUTHORIZED_US_AD_PROVIDER");
    expect(byId.TIKTOK_ADS.readiness.blockerReason).toContain("TIKTOK_CC_COOKIE");

    // Google Ads
    expect(byId.GOOGLE_ADS.readiness.blockerCode).toBe("MCP_NOT_CONFIGURED");
    expect(byId.GOOGLE_ADS.readiness.blockerReason).toContain("GOOGLE_TRANSPARENCY_MCP_URL");

    // In Google Free mode or internal policy, blockerCode is null or UPSTREAM_PROVIDER_NOT_CONFIGURED
    expect(["UPSTREAM_PROVIDER_NOT_CONFIGURED", null]).toContain(byId.DEMAND_HISTORY.readiness.blockerCode);
  });

  it("strictly enforces zero unapproved credit spend on all discovered providers", async () => {
    const results = await discoverAvailableKH02Providers({ allowPaidOperations: false });

    for (const r of results) {
      if (r.providerId !== "TIKTOK_ORGANIC") {
        expect(r.capabilities.estimatedCostPerQueryCredits).toBe(0);
      } else {
        expect(r.readiness.costApprovalRequired).toBe(true);
      }
    }
  });
});
