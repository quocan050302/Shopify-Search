import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  testKH02SourceConnection,
  getLatestProbe,
  recordLatestProbe,
  sanitizeSecretPatterns,
  diagnoseKH02Source,
} from "@/services/kh02/providers/sourceRegistry";
import {
  resolveGoogleMcpConfig,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";

describe("SWAI KH-02 — Test Connections Flow & Truthful Diagnostics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Google MCP Executable & Arguments Resolution (.env.local compliance)", () => {
    it("strips outer quotes from GOOGLE_TRANSPARENCY_MCP_COMMAND and parses JSON array arguments", () => {
      process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND = "'D:/Project_github/Running-Ads/services/google-transparency/.venv/Scripts/python.exe'";
      process.env.GOOGLE_TRANSPARENCY_MCP_ARGS = '["D:/Project_github/Running-Ads/scripts/googleTransparencyServer.py"]';

      const config = resolveGoogleMcpConfig();
      expect(config.command).toBe("D:/Project_github/Running-Ads/services/google-transparency/.venv/Scripts/python.exe");
      expect(config.args).toEqual(["D:/Project_github/Running-Ads/scripts/googleTransparencyServer.py"]);
    });

    it("handles double-quoted commands and bracketed single-quoted arguments", () => {
      process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND = '"C:/Python311/python.exe"';
      process.env.GOOGLE_TRANSPARENCY_MCP_ARGS = "['C:/path/server.py']";

      const config = resolveGoogleMcpConfig();
      expect(config.command).toBe("C:/Python311/python.exe");
      expect(config.args).toEqual(["C:/path/server.py"]);
    });
  });

  describe("2. Secret & Cookie Redaction (Zero Leakage Guard)", () => {
    it("redacts access tokens, bearer headers, session IDs, and cookies from diagnostic reasons", () => {
      const mockToken = ["AQ", "sample_mock_redacted_token_xyz987654321"].join(".");
      const dirty = `Failed connecting with token ${mockToken} and cookie=session_12345; auth error`;
      const sanitized = sanitizeSecretPatterns(dirty);

      expect(sanitized).not.toContain(mockToken);
      expect(sanitized).toContain("[REDACTED_TOKEN]");
      expect(sanitized).not.toContain("session_12345");
      expect(sanitized).toContain("cookie=[REDACTED]");
    });
  });

  describe("3. Truthful Connection State: Does not auto-switch to CONNECTED merely on configuration", () => {
    it("reports CONFIGURED with transport NOT_TESTED when credentials/endpoint exist but unprobed", async () => {
      // Simulate TikTok Organic configured with API key
      process.env.HASDATA_API_KEY = "dummy_hasdata_test_key";

      // Diagnose without checking live transport (static check)
      const diag = await diagnoseKH02Source("TIKTOK_ORGANIC", { checkLiveTransport: false });
      expect(diag.configured).toBe(true);
      expect(diag.status).toBe("CONFIGURED");
      expect(diag.transportStatus).toBe("NOT_TESTED");
      expect(diag.dimensions?.transportStatus).toBe("NOT_TESTED");
      // Must NOT be CONNECTED
      expect(diag.status).not.toBe("CONNECTED");
      expect(diag.transportConnected).toBe(null);
    });

    it("reports Google Ads as CONFIGURED with transport NOT_TESTED when endpoint is configured but unprobed", async () => {
      process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND = "D:/Project_github/Running-Ads/services/google-transparency/.venv/Scripts/python.exe";
      process.env.GOOGLE_TRANSPARENCY_MCP_ARGS = '["D:/Project_github/Running-Ads/scripts/googleTransparencyServer.py"]';

      const diag = await diagnoseKH02Source("GOOGLE_ADS", { checkLiveTransport: false });
      expect(diag.configured).toBe(true);
      expect(diag.status).toBe("CONFIGURED");
      expect(diag.transportStatus).toBe("NOT_TESTED");
      expect(diag.dimensions?.transportStatus).toBe("NOT_TESTED");
      // Must NOT be CONNECTED
      expect(diag.status).not.toBe("CONNECTED");
    });
  });

  describe("4. Probe Results Caching & Timeout Handling", () => {
    it("caches latest probe result in memory and retrieves it via getLatestProbe", () => {
      const mockResult: any = {
        source: "GOOGLE_ADS",
        status: "CONNECTED",
        transportStatus: "CONNECTED",
        reason: "Google Ads Transparency MCP server connected (2 tools discovered). Operations verified.",
        dimensions: {
          transportStatus: "CONNECTED",
          authStatus: "AUTH_NOT_REQUIRED",
        },
      };

      recordLatestProbe("GOOGLE_ADS", mockResult);
      const retrieved = getLatestProbe("GOOGLE_ADS");
      expect(retrieved).toBeDefined();
      expect(retrieved?.status).toBe("CONNECTED");
      expect(retrieved?.transportStatus).toBe("CONNECTED");
      expect(retrieved?.reason).toContain("Operations verified");
    });

    it("marks status as TIMEOUT when connection test exceeds deadline", async () => {
      process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND = "D:/Project_github/Running-Ads/services/google-transparency/.venv/Scripts/python.exe";
      process.env.GOOGLE_TRANSPARENCY_MCP_ARGS = '["D:/Project_github/Running-Ads/scripts/googleTransparencyServer.py"]';

      // Test with tiny 1ms timeout to ensure timeout branch triggers
      const result = await testKH02SourceConnection("GOOGLE_ADS", { timeoutMs: 1 });
      expect(result.source).toBe("GOOGLE_ADS");
      expect(result.status).toBe("TIMEOUT");
      expect(result.reason).toContain("timed out");
      expect(result.transportStatus).toBe("TRANSPORT_FAILED");
      expect(result.dimensions?.transportStatus).toBe("TRANSPORT_FAILED");
    });

    it("live probes Google Ads via local python FastMCP server and connects successfully", async () => {
      // Using .env.local configuration
      process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND = "D:/Project_github/Running-Ads/services/google-transparency/.venv/Scripts/python.exe";
      process.env.GOOGLE_TRANSPARENCY_MCP_ARGS = '["D:/Project_github/Running-Ads/scripts/googleTransparencyServer.py"]';

      const result = await testKH02SourceConnection("GOOGLE_ADS", { timeoutMs: 10000 });
      expect(result.source).toBe("GOOGLE_ADS");
      expect(result.status).toBe("CONNECTED");
      expect(result.transportStatus).toBe("CONNECTED");
      expect(result.dimensions?.transportStatus).toBe("CONNECTED");
      expect(result.reason).toContain("Google Ads Transparency MCP server connected");
    });
  });
});
