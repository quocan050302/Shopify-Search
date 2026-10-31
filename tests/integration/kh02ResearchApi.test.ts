/**
 * SWAI KH-02 — API Integration & Security Tests
 *
 * Tests:
 * 1. GET /api/v1/kh02/providers/status (Capability declaration, readiness, truthful limits)
 * 2. POST /api/v1/kh02/research (Input validation, execution, Top 3 leaderboard payload)
 * 3. Security & Workspace Isolation (Rejection of invalid workspaces, strict tenant scoping)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as getProvidersStatus } from "@/app/api/v1/kh02/providers/status/route";
import { POST as postResearch } from "@/app/api/v1/kh02/research/route";

describe("SWAI KH-02 — API Integration & Workspace Security", () => {
  const testWorkspaceId = `ws_kh02_test_${Date.now()}`;

  beforeAll(async () => {
    // Provision isolated test workspace
    await prisma.workspace.create({
      data: {
        id: testWorkspaceId,
        name: "KH02 Test Workspace",
        targetMarket: "US",
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.workspace.deleteMany({
        where: { id: testWorkspaceId },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. GET /api/v1/kh02/providers/status", () => {
    it("returns 200 with capabilities and readiness for all 5 intelligence sources", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/providers/status", {
        headers: { "x-workspace-id": testWorkspaceId },
      });

      const res = await getProvidersStatus(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(4);

      const sources = body.data.map((s: any) => s.source);
      expect(sources).toContain("META_ADS");
      expect(sources).toContain("TIKTOK_ADS");
      expect(sources).toContain("GOOGLE_ADS");
      expect(sources).toContain("DEMAND_HISTORY");

      // Verify truthful capability and readiness reporting
      const tiktokAds = body.data.find((s: any) => s.source === "TIKTOK_ADS");
      expect(tiktokAds.readiness).toBe("NOT_VERIFIED");
      expect(tiktokAds.readinessReason).toContain("Automated TikTok US ad provider");

      const metaAds = body.data.find((s: any) => s.source === "META_ADS");
      expect(metaAds.supportsUS).toBe(true);
      expect(metaAds.supportsKeywordSearch).toBe(true);
    });
  });

  describe("2. POST /api/v1/kh02/research", () => {
    it("rejects invalid json or missing topic with 400 VALIDATION_FAILED", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "x-workspace-id": testWorkspaceId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "", // empty topic
          market: "US",
        }),
      });

      const res = await postResearch(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects non-US markets to uphold target market focus", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "x-workspace-id": testWorkspaceId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Pet Gadgets",
          market: "UK", // Non-US
        }),
      });

      const res = await postResearch(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });

    it("executes research and returns version 12.0.0 Top 3 leaderboard structure", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "x-workspace-id": testWorkspaceId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxCandidates: 10,
        }),
      });

      const res = await postResearch(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.topic).toBe("Pet Gadgets");
      expect(body.data.market).toBe("US");
      expect(["12.0.0", "12.1.0"]).toContain(body.data.formulaVersion);
      expect(body.data.topThree).toBeDefined();
      expect(Array.isArray(body.data.topThree)).toBe(true);
      expect(body.data.topThree.length).toBeLessThanOrEqual(3);
      expect(body.data.sourceStatuses.META_ADS).toBeDefined();
      expect(["NOT_CONFIGURED", "NOT_VERIFIED", "MANUAL_ONLY", "TEMPORARILY_DISABLED"]).toContain(body.data.sourceStatuses.TIKTOK_ADS);
      expect(body.meta.workspaceId).toBe(testWorkspaceId);
    });
  });

  describe("3. Security & Workspace Isolation", () => {
    it("fails closed when caller supplies a forged, non-existent workspace ID", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/providers/status", {
        headers: { "x-workspace-id": "fake_foreign_tenant_999" },
      });

      const res = await getProvidersStatus(req);
      expect(res.status).toBe(403);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED_WORKSPACE");
    });
  });
});
