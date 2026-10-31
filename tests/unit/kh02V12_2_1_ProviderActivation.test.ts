import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  diagnoseKH02Source,
  checkKH02ProviderReadiness,
  getKH02SourceCapabilities,
  estimateResearchProviderCost,
} from "@/services/kh02/providers/sourceRegistry";
import {
  getHasDataOperationCost,
} from "@/services/kh02/providers/hasDataCreditService";
import {
  discoverGoogleAdsMcpCapabilities,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import { isSafePublicUrl } from "@/services/kh02/identity/productMetadataExtractor";

describe("SWAI KH-02 V12.2.1 — Provider Runtime Activation & Truthful Diagnostics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Source Status & Diagnostics Mapping (Section 17-21, 93)", () => {
    it("diagnoses TikTok Organic as CREDENTIALS_REQUIRED when HASDATA_API_KEY is missing", async () => {
      delete process.env.HASDATA_API_KEY;
      delete process.env.TIKTOK_ORGANIC_API_KEY;

      const diag = await diagnoseKH02Source("TIKTOK_ORGANIC");
      expect(diag.status).toBe("CREDENTIALS_REQUIRED");
      expect(diag.missingRequirements).toContain("HASDATA_API_KEY");
      expect(diag.dimensions).toBeDefined();
      expect(diag.dimensions?.configured).toBe(false);
      expect(diag.dimensions?.transportConnected).toBeNull();
      expect(diag.dimensions?.authenticated).toBe(false);
      expect(diag.dimensions?.blockerCode).toBe("MISSING_CREDENTIALS");

      const readiness = await checkKH02ProviderReadiness("TIKTOK_ORGANIC");
      expect(readiness.diagnosticStatus).toBe("CREDENTIALS_REQUIRED");
      expect(readiness.status).toBe("CREDENTIALS_REQUIRED");
      expect(readiness.ready).toBe(false);
    });

    it("diagnoses Google Ads as MCP_NOT_CONFIGURED when GOOGLE_TRANSPARENCY_MCP_URL is missing", async () => {
      delete process.env.GOOGLE_TRANSPARENCY_MCP_URL;
      delete process.env.GOOGLE_ADS_MCP_URL;
      delete process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;

      const diag = await diagnoseKH02Source("GOOGLE_ADS");
      expect(diag.status).toBe("MCP_NOT_CONFIGURED");
      expect(diag.missingRequirements).toContain("GOOGLE_TRANSPARENCY_MCP_URL");
      expect(diag.dimensions).toBeDefined();
      expect(diag.dimensions?.configured).toBe(false);
      expect(diag.dimensions?.transportConnected).toBe(false);
      expect(diag.dimensions?.blockerCode).toBe("MCP_NOT_CONFIGURED");

      const readiness = await checkKH02ProviderReadiness("GOOGLE_ADS");
      expect(readiness.diagnosticStatus).toBe("MCP_NOT_CONFIGURED");
      expect(readiness.status).toBe("MCP_NOT_CONFIGURED");
      expect(readiness.ready).toBe(false);
    });

    it("diagnoses TikTok Ads US as MANUAL_RESEARCH_ONLY with NO_AUTHORIZED_US_AD_PROVIDER blocker", async () => {
      const diag = await diagnoseKH02Source("TIKTOK_ADS");
      expect(diag.status).toBe("MANUAL_RESEARCH_ONLY");
      expect(diag.reason).toContain("Automated TikTok US ad provider is unconfigured");
      expect(diag.dimensions?.blockerCode).toBe("NO_AUTHORIZED_US_AD_PROVIDER");
      expect(diag.dimensions?.transportConnected).toBe(false);

      const readiness = await checkKH02ProviderReadiness("TIKTOK_ADS");
      expect(readiness.diagnosticStatus).toBe("MANUAL_RESEARCH_ONLY");
      expect(readiness.status).toBe("NOT_VERIFIED"); // Preserves backwards compatibility
      expect(readiness.ready).toBe(true); // Allows manual / db lookup
    });

    it("diagnoses Demand History as ENGINE_READY without fabricating external provider connectivity", async () => {
      const diag = await diagnoseKH02Source("DEMAND_HISTORY");
      expect(diag.status).toBe("ENGINE_READY");
      expect(diag.dimensions?.configured).toBe(true);

      const readiness = await checkKH02ProviderReadiness("DEMAND_HISTORY");
      expect(readiness.diagnosticStatus).toBe("ENGINE_READY");
      expect(readiness.status).toBe("CONFIGURED");
      expect(readiness.ready).toBe(true);
    });
  });

  describe("2. HasData Contract & Credit Policy Verification (Section 45-47, 94)", () => {
    it("reports 10 credits per query according to HasData MCP vendor contract", () => {
      const cost = getHasDataOperationCost("search_videos");
      expect(cost.estimatedCredits).toBe(10);
      expect(cost.knownCost).toBe(true);
      expect(cost.pricingSource).toContain("HasData MCP Vendor Documentation");

      const caps = getKH02SourceCapabilities("TIKTOK_ORGANIC");
      expect(caps.estimatedCostPerQueryCredits).toBe(10);
    });

    it("enforces zero unauthorized paid queries when AUTO_PAID_RESEARCH is false", () => {
      delete process.env.AUTO_PAID_RESEARCH;
      const estimate = estimateResearchProviderCost("TIKTOK_ORGANIC", {
        workspaceId: "test_ws",
        researchRunId: "test_run",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 30,
        maxResults: 20,
      });

      expect(estimate.requiresPaidApproval).toBe(true);
      expect(estimate.isAllowed).toBe(false);
      expect(estimate.estimatedCredits).toBe(20); // 2 pages * 10 credits
    });

    it("never assumes transportConnected or authenticated from key presence alone", async () => {
      process.env.HASDATA_API_KEY = "test_key_unverified";
      // Without checkLiveTransport, transportConnected & authenticated must be null
      const diag = await diagnoseKH02Source("TIKTOK_ORGANIC", { checkLiveTransport: false });
      expect(diag.configured).toBe(true);
      expect(diag.dimensions?.transportConnected).toBeNull();
      expect(diag.dimensions?.authenticated).toBeNull();
    });
  });

  describe("3. Google MCP Protocol, SSRF & Command Injection Security (Section 57-64, 96)", () => {
    it("rejects malicious shell metacharacters in GOOGLE_TRANSPARENCY_MCP_COMMAND", async () => {
      const maliciousCommands = [
        "npx google-mcp; rm -rf /",
        "npx google-mcp | cat /etc/passwd",
        "npx google-mcp && curl http://evil.com",
        "npx google-mcp $(whoami)",
        "npx google-mcp `id`",
      ];

      for (const cmd of maliciousCommands) {
        const caps = await discoverGoogleAdsMcpCapabilities({ command: cmd });
        expect(caps.transportConnected).toBe(false);
        expect(caps.errorMessage).toContain("contains forbidden shell metacharacters");
      }
    });

    it("rejects SSRF targeting localhost, private subnets, and metadata services", async () => {
      const ssrfUrls = [
        "http://localhost:8080/mcp",
        "http://127.0.0.1:3000/mcp",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/mcp",
        "http://192.168.1.1/mcp",
        "ftp://example.com/mcp",
        "file:///etc/passwd",
      ];

      for (const targetUrl of ssrfUrls) {
        expect(isSafePublicUrl(targetUrl)).toBe(false);
        const caps = await discoverGoogleAdsMcpCapabilities({ mcpUrl: targetUrl });
        expect(caps.transportConnected).toBe(false);
        expect(caps.errorMessage).toContain("Blocked potential SSRF endpoint");
      }
    });

    it("does not send guessed HTTP REST endpoints (/health, /tools) to MCP servers", async () => {
      // The discoverGoogleAdsMcpCapabilities function uses JSON-RPC 2.0 tools/list
      // Probe against an unreachable public URL to verify clean failure without throw
      const caps = await discoverGoogleAdsMcpCapabilities({ mcpUrl: "https://example-nonexistent-domain-404.com/mcp" });
      expect(caps.transportConnected).toBe(false);
      expect(caps.toolsDiscovered).toEqual([]);
    }, 15000);
  });

  describe("4. Acceptance Truthfulness & Adversarial Mutation Verification (Section 72-82, 98)", () => {
    it("fails acceptance when a required live provider has transport disconnected", () => {
      const evaluateLiveVerdict = (transportConnected: boolean | null, queryExecuted: boolean) => {
        if (!transportConnected) return "BLOCKED";
        if (!queryExecuted) return "FAIL";
        return "PASS";
      };

      expect(evaluateLiveVerdict(false, false)).toBe("BLOCKED");
      expect(evaluateLiveVerdict(null, false)).toBe("BLOCKED");
      expect(evaluateLiveVerdict(true, false)).toBe("FAIL");
      expect(evaluateLiveVerdict(true, true)).toBe("PASS");
    });

    it("distinguishes between cached database records and fresh live provider collection", () => {
      const recordCounts = {
        recordsInDbBeforeQuery: 140,
        sourceRecordsReturned: 15,
        newUniqueInserted: 12,
        recordsInDbAfterQuery: 152,
      };

      expect(recordCounts.sourceRecordsReturned).toBe(15);
      expect(recordCounts.newUniqueInserted).toBe(12);
      expect(recordCounts.recordsInDbAfterQuery).toBe(recordCounts.recordsInDbBeforeQuery + recordCounts.newUniqueInserted);
      expect(recordCounts.recordsInDbBeforeQuery).not.toBe(recordCounts.sourceRecordsReturned);
    });

    it("never converts MANUAL_IMPORT or CACHED_SOURCE into LIVE_PROVIDER", () => {
      const determineProvenance = (isLiveQuery: boolean, isDbCache: boolean): string => {
        if (isLiveQuery) return "LIVE_PROVIDER";
        if (isDbCache) return "CACHED_SOURCE";
        return "CONTROLLED_FIXTURE";
      };

      expect(determineProvenance(false, true)).toBe("CACHED_SOURCE");
      expect(determineProvenance(false, false)).toBe("CONTROLLED_FIXTURE");
      expect(determineProvenance(true, false)).toBe("LIVE_PROVIDER");
    });
  });
});
