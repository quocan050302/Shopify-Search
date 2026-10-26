import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveAcceptanceSourceMode,
  assertNoMockSourceForLiveAcceptance,
  verifyLiveMetaSource,
} from "../../scripts/kh01/runFullAcceptance";
import { createMetaCollectorClient } from "../../src/services/discovery/metaCollector/metaCollectorMcpClient";
import { MetaAdsCollectorProvider } from "../../src/services/discovery/providers/metaAdsCollectorProvider";

describe("KH-01 Live Source Integrity (FINAL-01)", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.SWAI_MOCK_META_BOUNDARY;
    delete process.env.SWAI_ACCEPTANCE_SOURCE_MODE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("resolveAcceptanceSourceMode()", () => {
    it("resolves REAL_LIVE_META when runLiveSource option is true", () => {
      const mode = resolveAcceptanceSourceMode({ runLiveSource: true });
      expect(mode).toBe("REAL_LIVE_META");
    });

    it("resolves OFFLINE_FIXTURE when runLiveSource is false or omitted", () => {
      expect(resolveAcceptanceSourceMode({ runLiveSource: false })).toBe("OFFLINE_FIXTURE");
      expect(resolveAcceptanceSourceMode({})).toBe("OFFLINE_FIXTURE");
    });
  });

  describe("assertNoMockSourceForLiveAcceptance()", () => {
    it("throws LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN when sourceMode is REAL_LIVE_META and SWAI_MOCK_META_BOUNDARY is true", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "REAL_LIVE_META",
          environment: { SWAI_MOCK_META_BOUNDARY: "true" },
        });
      }).toThrow("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("throws LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN when sourceMode is REAL_LIVE_META and SWAI_MOCK_META_BOUNDARY is fail", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "REAL_LIVE_META",
          environment: { SWAI_MOCK_META_BOUNDARY: "fail" },
        });
      }).toThrow("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("throws LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN when provider transport is mock_test_boundary", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "REAL_LIVE_META",
          environment: {},
          providerTransport: "mock_test_boundary",
        });
      }).toThrow("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("throws LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN when providerSourceType is TEST_FIXTURE", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "REAL_LIVE_META",
          environment: {},
          providerSourceType: "TEST_FIXTURE",
        });
      }).toThrow("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("succeeds when sourceMode is REAL_LIVE_META and no mock is present", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "REAL_LIVE_META",
          environment: { SWAI_MOCK_META_BOUNDARY: "" },
          providerTransport: "mcp_stream",
          providerSourceType: "REAL_UPSTREAM",
        });
      }).not.toThrow();
    });

    it("succeeds when sourceMode is OFFLINE_FIXTURE even if mock boundary is set", () => {
      expect(() => {
        assertNoMockSourceForLiveAcceptance({
          sourceMode: "OFFLINE_FIXTURE",
          environment: { SWAI_MOCK_META_BOUNDARY: "true" },
          providerTransport: "mock_test_boundary",
          providerSourceType: "TEST_FIXTURE",
        });
      }).not.toThrow();
    });
  });

  describe("createMetaCollectorClient() Defense-in-Depth Guard", () => {
    it("throws when SWAI_MOCK_META_BOUNDARY is true and SWAI_ACCEPTANCE_SOURCE_MODE is REAL_LIVE_META", async () => {
      process.env.SWAI_MOCK_META_BOUNDARY = "true";
      process.env.SWAI_ACCEPTANCE_SOURCE_MODE = "REAL_LIVE_META";

      await expect(createMetaCollectorClient()).rejects.toThrow("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("returns mock client in offline mode when SWAI_MOCK_META_BOUNDARY is true", async () => {
      process.env.SWAI_MOCK_META_BOUNDARY = "true";
      process.env.SWAI_ACCEPTANCE_SOURCE_MODE = "OFFLINE_FIXTURE";

      const client = await createMetaCollectorClient();
      expect(client).toBeDefined();
      const caps = await client.getCapabilities();
      expect(caps.transport).toBe("mock_test_boundary");
      if (client.close) await client.close();
    });
  });

  describe("MetaAdsCollectorProvider Guard", () => {
    it("getProviderConfigurationStatus() reports NOT_CONFIGURED when mock requested in REAL_LIVE_META", () => {
      process.env.SWAI_MOCK_META_BOUNDARY = "true";
      process.env.SWAI_ACCEPTANCE_SOURCE_MODE = "REAL_LIVE_META";

      const provider = new MetaAdsCollectorProvider();
      const status = provider.getProviderConfigurationStatus();
      expect(status.status).toBe("NOT_CONFIGURED");
      expect(status.message).toContain("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN");
    });

    it("verifyProviderConnection() marks mock transport as READY_UNVERIFIED and refuses LIVE_VERIFIED", async () => {
      process.env.SWAI_MOCK_META_BOUNDARY = "true";
      delete process.env.SWAI_ACCEPTANCE_SOURCE_MODE;

      const provider = new MetaAdsCollectorProvider();
      const health = await provider.verifyProviderConnection();
      expect(health.status).toBe("READY_UNVERIFIED");
      expect(health.message).toContain("Mock test boundary verified for offline testing");
    });
  });

  describe("verifyLiveMetaSource() Orchestration Guard", () => {
    it("returns NOT_RUN with detailedOutcome NOT_RUN when runLiveSource is false", async () => {
      const res = await verifyLiveMetaSource({ runLiveSource: false });
      expect(res.status).toBe("NOT_RUN");
      expect(res.detailedOutcome).toBe("NOT_RUN");
      expect(res.validCount).toBe(0);
      expect(res.linkedCount).toBe(0);
      expect(res.displayedCount).toBe(0);
    });

    it("returns BLOCKED with reason when runLiveSource is true but SWAI_MOCK_META_BOUNDARY is set", async () => {
      process.env.SWAI_MOCK_META_BOUNDARY = "true";
      const res = await verifyLiveMetaSource({ runLiveSource: true });
      expect(res.status).toBe("BLOCKED");
      expect(res.detailedOutcome).toBe("BLOCKED_SOURCE");
      expect(res.evidenceReferences.some((r) => r.includes("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN"))).toBe(true);
      expect(res.validCount).toBe(0);
      expect(res.linkedCount).toBe(0);
      expect(res.displayedCount).toBe(0);
    });
  });
});
