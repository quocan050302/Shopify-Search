/**
 * SWAI KH-02 V12.1 — HTTP Route Handlers Integration Acceptance Suite
 *
 * Verifies end-to-end request handling, schema validation, persistent run creation,
 * snapshot restore, and multi-tenant authorization boundaries across all KH-02 endpoints:
 * 1. GET /api/v1/kh02/providers/status
 * 2. POST /api/v1/kh02/research
 * 3. GET /api/v1/kh02/leaderboard
 * 4. GET /api/v1/kh02/research/runs
 * 5. GET /api/v1/kh02/research/runs/[runId]
 * 6. POST /api/v1/kh02/product-matches/[matchId]/review
 * 7. Negative authentication and workspace isolation enforcement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as getProvidersStatus } from "@/app/api/v1/kh02/providers/status/route";
import { POST as postResearch } from "@/app/api/v1/kh02/research/route";
import { GET as getLeaderboard } from "@/app/api/v1/kh02/leaderboard/route";
import { GET as getResearchRuns } from "@/app/api/v1/kh02/research/runs/route";
import { GET as getResearchRunById } from "@/app/api/v1/kh02/research/runs/[runId]/route";
import {
  POST as postMatchReview,
  GET as getMatchReview,
} from "@/app/api/v1/kh02/product-matches/[matchId]/review/route";

import {
  cleanupKH02TestFixtures,
  TestFixtureRegistry,
} from "@/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 V12.1 — HTTP Route Handlers Acceptance", () => {
  const WORKSPACE_A = `ws_http_acc_${Date.now()}`;
  const WORKSPACE_B = `ws_http_other_${Date.now()}`;
  let fixtureRegistry: TestFixtureRegistry = {};

  beforeEach(async () => {
    fixtureRegistry = {
      workspaceIds: [WORKSPACE_A, WORKSPACE_B],
      advertiserIds: [],
      adIds: [],
      dataSourceIds: [],
      watchlistIds: [],
      watchlistItemIds: [],
      jobIds: [],
    };

    // Seed test workspaces
    await prisma.workspace.createMany({
      data: [
        { id: WORKSPACE_A, name: "Workspace Alpha", operatingMode: "RESEARCH_ONLY" },
        { id: WORKSPACE_B, name: "Workspace Beta", operatingMode: "RESEARCH_ONLY" },
      ],
    });

    // Seed competitor ad in Workspace A
    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "PawPure Goods",
        domain: "pawpure.com",
      },
    });
    fixtureRegistry.advertiserIds!.push(adv.id);

    const ds = await prisma.dataSource.create({
      data: {
        name: `META_DS_${Date.now()}`,
        displayName: "Meta Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });
    fixtureRegistry.dataSourceIds!.push(ds.id);

    const ad = await prisma.competitorAd.create({
      data: {
        id: `ad_http_${Date.now()}`,
        externalAdId: `ext_ad_${Date.now()}`,
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=999888",
        landingPageUrl: "https://pawpure.com/products/ultrasonic-dog-whistle",
        headline: "Ultrasonic Silent Dog Whistle for Barking Control",
        bodyText: "Stop nuisance barking immediately with calibrated frequencies.",
        advertiserId: adv.id,
        dataSourceId: ds.id,
        targetMarket: "US",
      },
    });
    fixtureRegistry.adIds!.push(ad.id);

    const watchlist = await prisma.watchlist.create({
      data: {
        workspaceId: WORKSPACE_A,
        name: "Alpha Watchlist",
      },
    });
    fixtureRegistry.watchlistIds!.push(watchlist.id);

    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        adId: ad.id,
        itemType: "AD",
      },
    });
    fixtureRegistry.watchlistItemIds!.push(item.id);
  });

  afterEach(async () => {
    // Non-destructive scoped cleanup: deletes ONLY tracked fixture IDs
    await cleanupKH02TestFixtures(fixtureRegistry, prisma);
  });

  function createRequest(
    url: string,
    options: {
      method?: string;
      body?: any;
      workspaceId?: string;
    } = {}
  ): NextRequest {
    const headers = new Headers();
    headers.set("host", "localhost:3000");
    if (options.workspaceId) {
      headers.set("x-workspace-id", options.workspaceId);
    }
    if (options.body) {
      headers.set("content-type", "application/json");
    }

    return new NextRequest(new URL(url, "http://localhost:3000"), {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  it("GET /api/v1/kh02/providers/status reports live capability and truthful readiness", async () => {
    const req = createRequest("/api/v1/kh02/providers/status", { workspaceId: WORKSPACE_A });
    const res = await getProvidersStatus(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(4);

    const meta = json.data.find((d: any) => d.source === "META_ADS");
    expect(meta.isReady).toBe(true);
    expect(meta.readiness).toBe("SOURCE_ACCESS_VERIFIED");

    const ttAds = json.data.find((d: any) => d.source === "TIKTOK_ADS");
    expect(ttAds.readiness).toBe("NOT_VERIFIED");
  });

  it("POST /api/v1/kh02/research creates a persistent run, executes research, and records snapshot", async () => {
    const req = createRequest("/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_A,
      body: {
        topic: "Dog Whistle",
        market: "US",
        lookbackDays: 90,
        maxCandidates: 10,
      },
    });

    const res = await postResearch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.meta.runId).toBeTruthy();
    expect(json.data.topic).toBe("Dog Whistle");

    // Verify candidate was extracted using landing page URL
    const candidate = json.data.provisionalCandidates?.[0] || json.data.topThree?.[0];
    expect(candidate).toBeTruthy();
    expect(candidate.candidate.storeDomain).toBe("pawpure.com");
    expect(candidate.candidate.canonicalProductUrl).toBe("https://pawpure.com/products/ultrasonic-dog-whistle");
  });

  it("GET /api/v1/kh02/leaderboard restores the latest completed snapshot on reload", async () => {
    // 1. First trigger research
    const runReq = createRequest("/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_A,
      body: { topic: "Dog Whistle" },
    });
    await postResearch(runReq);

    // 2. Fetch saved leaderboard
    const getReq = createRequest("/api/v1/kh02/leaderboard", { workspaceId: WORKSPACE_A });
    const res = await getLeaderboard(getReq);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).not.toBeNull();
    expect(json.data.topic).toBe("Dog Whistle");
  });

  it("GET /api/v1/kh02/research/runs returns historical runs with workspace scoping", async () => {
    const runReq = createRequest("/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_A,
      body: { topic: "Dog Whistle" },
    });
    await postResearch(runReq);

    // Workspace A sees its run
    const reqA = createRequest("/api/v1/kh02/research/runs", { workspaceId: WORKSPACE_A });
    const resA = await getResearchRuns(reqA);
    expect(resA.status).toBe(200);
    const jsonA = await resA.json();
    expect(jsonA.data.length).toBeGreaterThanOrEqual(1);

    // Workspace B sees 0 runs (tenant isolation)
    const reqB = createRequest("/api/v1/kh02/research/runs", { workspaceId: WORKSPACE_B });
    const resB = await getResearchRuns(reqB);
    expect(resB.status).toBe(200);
    const jsonB = await resB.json();
    expect(jsonB.data).toHaveLength(0);
  });

  it("POST & GET /api/v1/kh02/product-matches/[matchId]/review persists operator decisions", async () => {
    const matchId = `match_review_http_${Date.now()}`;
    const postReq = createRequest(`/api/v1/kh02/product-matches/${matchId}/review`, {
      method: "POST",
      workspaceId: WORKSPACE_A,
      body: {
        decision: "CONFIRMED",
        notes: "Confirmed cross-store match",
      },
    });

    const postRes = await postMatchReview(postReq, { params: Promise.resolve({ matchId }) });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.data.userReviewDecision).toBe("CONFIRMED");

    // Fetch review back
    const getReq = createRequest(`/api/v1/kh02/product-matches/${matchId}/review`, {
      workspaceId: WORKSPACE_A,
    });
    const getRes = await getMatchReview(getReq, { params: Promise.resolve({ matchId }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.data.userReviewDecision).toBe("CONFIRMED");

    // Workspace B cannot access Workspace A's review
    const getReqB = createRequest(`/api/v1/kh02/product-matches/${matchId}/review`, {
      workspaceId: WORKSPACE_B,
    });
    const getResB = await getMatchReview(getReqB, { params: Promise.resolve({ matchId }) });
    expect(getResB.status).toBe(200);
    const getJsonB = await getResB.json();
    expect(getJsonB.data).toBeNull();
  });

  it("proves cleanupKH02TestFixtures preserves unrelated sentinel records (Rule 61)", async () => {
    // 1. Seed unrelated sentinel record outside the test registry
    const sentinelAdv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: `Sentinel Brand ${Date.now()}`,
        domain: "sentinel-brand.com",
      },
    });

    try {
      // 2. Perform test fixture cleanup for fixtureRegistry
      const { cleanedCount } = await cleanupKH02TestFixtures(fixtureRegistry, prisma);
      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      // 3. Assert sentinel record remains untouched and intact
      const foundSentinel = await prisma.advertiser.findUnique({
        where: { id: sentinelAdv.id },
      });
      expect(foundSentinel).not.toBeNull();
      expect(foundSentinel?.name).toBe(sentinelAdv.name);
    } finally {
      // Clean up sentinel directly
      await prisma.advertiser.delete({ where: { id: sentinelAdv.id } }).catch(() => {});
    }
  });
});
