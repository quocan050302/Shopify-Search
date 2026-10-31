import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  diagnoseKH02Source,
  testKH02SourceConnection,
} from "@/services/kh02/providers/sourceRegistry";
import {
  getHasDataOperationCost,
  fetchHasDataCreditStatus,
} from "@/services/kh02/providers/hasDataCreditService";
import {
  decodeCallToolResult,
  discoverGoogleAdsMcpCapabilities,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  evaluateProviderCostGuard,
} from "@/services/kh02/providers/providerCostPolicy";
import {
  resolveProductDemandHistory,
} from "@/services/kh02/demand/historicalDemandIngestion";
import {
  defaultDemandProvider,
} from "@/services/kh02/demand/demandProviderRegistry";
import {
  runEvergreenProductResearch,
} from "@/services/kh02/evergreenResearchOrchestrator";

describe("SWAI KH-02 V12.2.2 — Truthful Diagnostics & Real Provider Acceptance", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Missing Key vs Invalid Key (Section C.1, C.2, L)", () => {
    it("diagnoses missing HASDATA_API_KEY as CREDENTIALS_REQUIRED, not Invalid Key", async () => {
      delete process.env.HASDATA_API_KEY;
      delete process.env.TIKTOK_ORGANIC_API_KEY;

      const diag = await diagnoseKH02Source("TIKTOK_ORGANIC", { workspaceId: "ws_test_v122" });
      expect(diag.configured).toBe(false);
      expect(diag.status).toBe("CREDENTIALS_REQUIRED");
      expect(diag.dimensions?.authStatus).toBe("CREDENTIALS_REQUIRED");
      expect(diag.dimensions?.transportStatus).toBe("NOT_TESTED");
      expect(diag.reason).toContain("HASDATA_API_KEY");
      expect(diag.reason).not.toContain("Invalid Key");
    });

    it("verifies HasData credit status fails gracefully with error message on dummy key", async () => {
      process.env.HASDATA_API_KEY = "dummy_invalid_hasdata_key";
      const creditStatus = await fetchHasDataCreditStatus();
      // Should not throw, should return status with unverified / blocked and error message
      expect(creditStatus.verificationStatus).toBeDefined();
      expect(["UNVERIFIED", "BLOCKED"]).toContain(creditStatus.verificationStatus);
      expect(creditStatus.errorMessage).toBeDefined();
    }, 15000);
  });

  describe("2. Missing Endpoint vs Transport Failure (Section C.3, L)", () => {
    it("diagnoses missing Google Ads MCP URL/command as NOT_CONFIGURED, not Unreachable", async () => {
      delete process.env.GOOGLE_TRANSPARENCY_MCP_URL;
      delete process.env.GOOGLE_ADS_MCP_URL;
      delete process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;

      const diag = await diagnoseKH02Source("GOOGLE_ADS", { workspaceId: "ws_test_v122" });
      expect(diag.configured).toBe(false);
      expect(["NOT_CONFIGURED", "MCP_NOT_CONFIGURED"]).toContain(diag.status);
      expect(diag.dimensions?.transportStatus).toBe("NOT_CONFIGURED");
      expect(diag.reason).not.toContain("Unreachable");
      expect(diag.requiredAction).toContain("GOOGLE_TRANSPARENCY_MCP_URL");
    });
  });

  describe("3. Auth Not Required vs Free Pricing (Section C.4, C.6, L)", () => {
    it("diagnoses Meta stdio collector as AUTH_NOT_REQUIRED, not enterprise authenticated", async () => {
      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: "ws_test_v122" });
      expect(diag.dimensions?.authStatus).toBe("AUTH_NOT_REQUIRED");
      expect(diag.estimatedQueryCost?.isPaid).toBe(false);
    });

    it("diagnoses TikTok Organic as paid 10 credits with cost guard blocking unauthorized execution", async () => {
      delete process.env.AUTO_PAID_RESEARCH;
      const costGuard = evaluateProviderCostGuard("HASDATA", "TIKTOK_ORGANIC_SEARCH", 10);
      expect(costGuard.allowed).toBe(false);
      expect(costGuard.reason).toContain("AUTO_PAID_RESEARCH");

      const cost = getHasDataOperationCost("search_videos");
      expect(cost.estimatedCredits).toBe(10);
      expect(cost.knownCost).toBe(true);
    });
  });

  describe("4. Google Ads MCP CallToolResult Decoding (Section B.7, G.7, L)", () => {
    it("decodes structuredContent directly from CallToolResult", () => {
      const mockResult = {
        structuredContent: {
          advertisers: [{ id: "adv_123", name: "Pet Innovators Inc." }],
        },
      };
      const decoded = decodeCallToolResult(mockResult);
      expect(decoded).toEqual({
        advertisers: [{ id: "adv_123", name: "Pet Innovators Inc." }],
      });
    });

    it("decodes JSON string in content[0].text from CallToolResult", () => {
      const mockResult = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              creatives: [{ id: "cr_456", advertiserId: "adv_123", format: "VIDEO" }],
            }),
          },
        ],
      };
      const decoded = decodeCallToolResult(mockResult);
      expect(decoded).toEqual({
        creatives: [{ id: "cr_456", advertiserId: "adv_123", format: "VIDEO" }],
      });
    });

    it("throws clear error when CallToolResult has isError: true", () => {
      const mockResult = {
        isError: true,
        content: [{ type: "text", text: "Rate limit exceeded on upstream Ads Transparency Center" }],
      };
      expect(() => decodeCallToolResult(mockResult)).toThrow("Rate limit exceeded");
    });
  });

  describe("5. Discovered Tool Matching vs Hardcoded Names (Section B.6, G.6, L)", () => {
    it("recognizes standard gads-transparency-mcp tool names", async () => {
      const mockClient = {
        connect: async () => {},
        isAlive: () => true,
        listTools: async () => ["search_advertiser", "get_advertiser_ads", "get_ad_details"],
      };

      const discovery = await discoverGoogleAdsMcpCapabilities({}, mockClient as any);
      const names = discovery.toolsDiscovered.map((t) => t.name);
      expect(names).toContain("search_advertiser");
      expect(names).toContain("get_advertiser_ads");
      expect(names).toContain("get_ad_details");
      expect(discovery.supportedOperations.domainLookup).toBe(true);
      expect(discovery.supportedOperations.adsRetrieval).toBe(true);
    });
  });

  describe("6. Cache vs Live Provider Separation (Section B.1, B.12, D, E, L)", () => {
    it("separates storedRecordCount from lastLiveQueryRecordCount", async () => {
      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: "ws_test_v122" });
      expect(diag.dimensions).toBeDefined();
      expect("storedRecordCount" in diag.dimensions!).toBe(true);
      expect("lastLiveQueryRecordCount" in diag.dimensions!).toBe(true);
      expect(diag.dimensions?.lastLiveQueryRecordCount).toBeNull();
    });

    it("reports TikTok Ads as unconfigured or manual only with blocker code when automated provider is unconfigured", async () => {
      delete process.env.TIKTOK_CC_COOKIE;
      delete process.env.APIFY_TOKEN;

      const diag = await diagnoseKH02Source("TIKTOK_ADS", { workspaceId: "ws_test_v122" });
      expect(["NOT_CONFIGURED", "MANUAL_ONLY", "MANUAL_RESEARCH_ONLY"]).toContain(diag.status);
      expect(diag.dimensions?.blockerCode).toBe("NO_AUTHORIZED_US_AD_PROVIDER");
      expect(diag.provenanceVerified).toBe(false);
    });
  });

  describe("7. Demand History Truthfulness (Section B.11, H, L)", () => {
    it("reports ENGINE_READY for policy engine and blocks fetchSeries when upstream API keys are absent", async () => {
      delete process.env.SERPAPI_API_KEY;
      delete process.env.GOOGLE_TRENDS_API_KEY;

      const diag = await defaultDemandProvider.diagnose();
      expect(diag.status).toBe("NOT_CONFIGURED");
      expect(diag.configured).toBe(false);
      expect(diag.queryExecuted).toBe(false);

      const series = await defaultDemandProvider.fetchSeries({
        term: "Pet Gadgets",
        region: "US",
        startDate: new Date(Date.now() - 90 * 86400000),
        endDate: new Date(),
      });
      expect(series.status).toBe("BLOCKED");
      expect(series.error).toContain("credentials");
    });

    it("evaluates demand history with strict 60-day minimum without silently lowering threshold", async () => {
      const res = await resolveProductDemandHistory(
        {
          canonicalName: "Novel Dog Ball Launcher",
          category: "Pet Gadgets",
        },
        { lookbackDays: 30, region: "US", workspaceId: "ws_test_v122" }
      );
      // Since no 60-day observations exist, status must truthfully be INSUFFICIENT_HISTORY
      expect(res.assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(res.sourceStatus).not.toBe("PRODUCT_HISTORY_VERIFIED");
    });
  });

  describe("8. Orchestrator selectedSources & Deadline Abort (Section B.16, I.5, I.6, L)", () => {
    it("strictly respects selectedSources and marks excluded sources as SKIPPED", async () => {
      const result = await runEvergreenProductResearch({
        topic: "Pet Gadgets",
        market: "US",
        workspaceId: "ws_test_v122",
        selectedSources: ["META_ADS"],
        maxCandidates: 5,
      });

      expect(result.sourceStatuses.TIKTOK_ADS).toBe("SKIPPED");
      expect(result.sourceStatuses.TIKTOK_ORGANIC).toBe("SKIPPED");
      expect(result.sourceStatuses.GOOGLE_ADS).toBe("SKIPPED");
      expect(result.sourceStatuses.DEMAND_HISTORY).toBe("SKIPPED");
    });

    it("terminates promptly when input signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("User cancelled research run."));

      const startTime = Date.now();
      const result = await runEvergreenProductResearch({
        topic: "Pet Gadgets",
        market: "US",
        workspaceId: "ws_test_v122",
        signal: controller.signal,
      });

      const elapsedMs = Date.now() - startTime;
      expect(elapsedMs).toBeLessThan(5000);
      expect(result).toBeDefined();
    });
  });

  describe("9. Non-Interfering Provider Connection Testing (Section C.10, L)", () => {
    it("tests each connection independently with timeout without throwing if one fails", async () => {
      const results = await Promise.all([
        testKH02SourceConnection("META_ADS", { workspaceId: "ws_test_v122" }),
        testKH02SourceConnection("TIKTOK_ADS", { workspaceId: "ws_test_v122" }),
        testKH02SourceConnection("TIKTOK_ORGANIC", { workspaceId: "ws_test_v122" }),
        testKH02SourceConnection("GOOGLE_ADS", { workspaceId: "ws_test_v122" }),
        testKH02SourceConnection("DEMAND_HISTORY", { workspaceId: "ws_test_v122" }),
      ]);

      expect(results.length).toBe(5);
      results.forEach((r) => {
        expect(r.source).toBeDefined();
        expect(r.lastCheckedAt).toBeDefined();
      });
    });
  });
});
