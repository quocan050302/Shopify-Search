import { describe, it, expect } from "vitest";
import {
  DiscoveryQuerySchema,
  RawDiscoveredAdSchema,
  NormalizedDiscoveredAdSchema,
  DISCOVERY_ERROR_CODES,
  DISCOVERY_PROVIDER_STATUS,
  DISCOVERY_JOB_STATUS,
} from "@/services/discovery/types";

describe("Discovery Domain Types & Zod Schemas", () => {
  it("validates a standard DiscoveryQuery and applies defaults", () => {
    const parsed = DiscoveryQuerySchema.parse({
      workspaceId: "ws_default",
      keywords: ["skincare", "glow"],
    });

    expect(parsed.workspaceId).toBe("ws_default");
    expect(parsed.platform).toBe("TIKTOK");
    expect(parsed.market).toBe("US");
    expect(parsed.keywords).toEqual(["skincare", "glow"]);
    expect(parsed.searchWindowDays).toBe(30);
    expect(parsed.requestedLimit).toBe(50);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.sortBy).toBe("relevance");
    expect(parsed.runMode).toBe("MANUAL");
  });

  it("rejects invalid DiscoveryQuery inputs", () => {
    // Negative or zero limit
    expect(() =>
      DiscoveryQuerySchema.parse({
        workspaceId: "ws_default",
        requestedLimit: 0,
      })
    ).toThrow();

    // Excessive limit > 500
    expect(() =>
      DiscoveryQuerySchema.parse({
        workspaceId: "ws_default",
        requestedLimit: 999,
      })
    ).toThrow();
  });

  it("validates RawDiscoveredAd schema", () => {
    const raw = RawDiscoveredAdSchema.parse({
      providerId: "tiktok_creative_center_direct",
      sourceUrl: "https://ads.tiktok.com/business/creativecenter/topads/7680863927458562066/pc/en",
      sourceId: "7680863927458562066",
      rawMetadata: { brand_name: "Glossy Co", likes: 1200 },
      retrievedAt: new Date(),
    });

    expect(raw.providerId).toBe("tiktok_creative_center_direct");
    expect(raw.sourceId).toBe("7680863927458562066");
    expect(raw.rawMetadata).toHaveProperty("brand_name", "Glossy Co");
  });

  it("validates NormalizedDiscoveredAd schema with strict provenance", () => {
    const normalized = NormalizedDiscoveredAdSchema.parse({
      platform: "TIKTOK",
      providerId: "tiktok_creative_center_direct",
      sourceNamespace: "tiktok_creative_center_direct",
      sourceExternalId: "7680863927458562066",
      stableIdentityHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      advertiserName: "Glossy Co",
      headline: "Get 20% off today only!",
      industry: "BEAUTY_PERSONAL_CARE",
      objective: "CONVERSIONS",
      creativeUrl: "https://ads.tiktok.com/business/creativecenter/topads/7680863927458562066/pc/en",
      targetMarket: "US",
      marketEvidenceType: "QUERY_FILTER",
      reportedMetrics: {
        likes: 1200,
      },
      mediaAvailability: "RESTRICTED",
      retrievedAt: new Date(),
      confidenceScore: 0.85,
    });

    expect(normalized.platform).toBe("TIKTOK");
    expect(normalized.reportedMetrics.likes).toBe(1200);
    expect(normalized.mediaAvailability).toBe("RESTRICTED");
  });

  it("includes all required explicit error codes", () => {
    const expectedCodes = [
      "NO_AUTHORIZED_PROVIDER",
      "PROVIDER_NOT_CONFIGURED",
      "PROVIDER_PERMISSION_DENIED",
      "PROVIDER_RATE_LIMITED",
      "PROVIDER_REGION_UNSUPPORTED",
      "PROVIDER_RESPONSE_INVALID",
      "PROVIDER_BUDGET_BLOCKED",
      "PROVIDER_UNAVAILABLE",
      "DISCOVERY_CANCELLED",
      "DISCOVERY_PARTIAL",
      "DISCOVERY_DATABASE_ERROR",
    ];

    for (const code of expectedCodes) {
      expect(DISCOVERY_ERROR_CODES).toContain(code);
    }
  });

  it("includes correct provider status and job status definitions", () => {
    expect(DISCOVERY_PROVIDER_STATUS.LIVE_VERIFIED).toBe("LIVE_VERIFIED");
    expect(DISCOVERY_PROVIDER_STATUS.BLOCKED_SOURCE).toBe("BLOCKED_SOURCE");
    expect(DISCOVERY_PROVIDER_STATUS.REQUIRES_AUTH).toBe("REQUIRES_AUTH");

    expect(DISCOVERY_JOB_STATUS.PENDING).toBe("PENDING");
    expect(DISCOVERY_JOB_STATUS.RUNNING).toBe("RUNNING");
    expect(DISCOVERY_JOB_STATUS.COMPLETED).toBe("COMPLETED");
    expect(DISCOVERY_JOB_STATUS.FAILED).toBe("FAILED");
  });
});
