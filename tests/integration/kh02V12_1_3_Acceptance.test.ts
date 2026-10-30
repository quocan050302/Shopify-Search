/**
 * SWAI KH-02 V12.1.3 — Final Integration Acceptance & Deterministic Pipeline E2E
 *
 * Verifies:
 * 1. Track A: Deterministic Fixture E2E (HTTP 202 Async -> Queue -> Worker -> Terminal DB -> HTTP Readback)
 * 2. True atomic worker ownership transition (Claim -> Execution -> Complete)
 * 3. Cross-layer reconciliation across Database, HTTP Route Handlers, and Snapshots
 * 4. Zero-result semantics (valid empty discovery distinct from software failure)
 * 5. Multi-tenant isolation and scoped non-destructive test fixture cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as postResearch } from "@/app/api/v1/kh02/research/route";
import { GET as getResearchRunById } from "@/app/api/v1/kh02/research/runs/[runId]/route";
import { GET as getLeaderboard } from "@/app/api/v1/kh02/leaderboard/route";
import {
  claimNextResearchJob,
  executeResearchJob,
} from "@/workers/kh02Worker";
import {
  cleanupKH02TestFixtures,
  reconcileResearchAcrossLayers,
  TestFixtureRegistry,
} from "@/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 V12.1.3 — Final Integration Acceptance & Deterministic E2E", () => {
  const WORKSPACE_ALPHA = `ws_v12_1_3_alpha_${Date.now()}`;
  const WORKSPACE_BETA = `ws_v12_1_3_beta_${Date.now()}`;
  let fixtureRegistry: TestFixtureRegistry = {};

  beforeEach(async () => {
    fixtureRegistry = {
      workspaceIds: [WORKSPACE_ALPHA, WORKSPACE_BETA],
      advertiserIds: [],
      adIds: [],
      dataSourceIds: [],
      watchlistIds: [],
      watchlistItemIds: [],
      jobIds: [],
    };

    // 1. Seed isolated test workspaces
    await prisma.workspace.createMany({
      data: [
        { id: WORKSPACE_ALPHA, name: "Workspace Alpha", operatingMode: "RESEARCH_ONLY" },
        { id: WORKSPACE_BETA, name: "Workspace Beta", operatingMode: "RESEARCH_ONLY" },
      ],
    });

    // 2. Seed controlled fixture dataSource
    const ds = await prisma.dataSource.create({
      data: {
        name: `DS_CONTROLLED_${Date.now()}`,
        displayName: "Controlled Meta Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });
    fixtureRegistry.dataSourceIds!.push(ds.id);

    // 3. Seed controlled fixture advertiser
    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "BarkBreeze Pets",
        domain: "barkbreeze.com",
      },
    });
    fixtureRegistry.advertiserIds!.push(adv.id);

    // 4. Seed controlled fixture competitor ad (Ultrasonic Dog Silencer)
    const ad = await prisma.competitorAd.create({
      data: {
        id: `ad_v1213_${Date.now()}`,
        externalAdId: `ext_ad_v1213_${Date.now()}`,
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=777666",
        landingPageUrl: "https://barkbreeze.com/products/ultrasonic-anti-bark-device",
        headline: "Ultrasonic Anti-Barking Device - Harmless Dog Trainer",
        bodyText: "Stop dog barking instantly with humane ultrasonic sound pulses.",
        advertiserId: adv.id,
        dataSourceId: ds.id,
        targetMarket: "US",
        firstSeenAt: new Date(Date.now() - 120 * 86400000),
        lastSeenAt: new Date(),
      },
    });
    fixtureRegistry.adIds!.push(ad.id);

    // 5. Seed watchlist item in Workspace Alpha
    const watchlist = await prisma.watchlist.create({
      data: {
        workspaceId: WORKSPACE_ALPHA,
        name: "Alpha Watchlist V12.1.3",
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
    // Scoped non-destructive cleanup
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
    headers.set("content-type", "application/json");
    if (options.workspaceId) {
      headers.set("x-workspace-id", options.workspaceId);
    }

    return new NextRequest(new URL(url, "http://localhost:3000"), {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  // ── TRACK A: ASYNC HTTP -> QUEUE -> WORKER -> PERSISTENCE -> READBACK ──

  it("executes Track A deterministic pipeline: HTTP 202 -> Worker Claim & Execution -> Readback", async () => {
    // Step 1: Submit asynchronous research request via HTTP API
    const req = createRequest("http://localhost:3000/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_ALPHA,
      body: {
        topic: "Barking Device",
        market: "US",
        lookbackDays: 90,
        maxCandidates: 10,
        mode: "async",
      },
    });

    const res = await postResearch(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.runId).toBeDefined();

    const runId = body.data.runId;
    fixtureRegistry.jobIds!.push(runId);

    // Verify initial job state in database
    const initialJob = await prisma.syncJob.findUnique({ where: { id: runId } });
    expect(initialJob).toBeDefined();
    expect(initialJob?.status).toBe("PENDING");
    expect(initialJob?.workspaceId).toBe(WORKSPACE_ALPHA);

    // Step 2: Worker claims job atomically
    const claimedJob = await claimNextResearchJob("worker-acc-e2e", prisma);
    expect(claimedJob).toBeDefined();
    expect(claimedJob?.id).toBe(runId);
    expect(claimedJob?.ownership.workerId).toBe("worker-acc-e2e");
    expect(claimedJob?.ownership.fencingGeneration).toBeGreaterThanOrEqual(1);

    // Step 3: Worker executes the job to terminal completion
    const executionResult = await executeResearchJob(claimedJob!, prisma);
    expect(executionResult.success).toBe(true);
    expect(executionResult.result).toBeDefined();

    // Step 4: Verify terminal state in database
    const terminalJob = await prisma.syncJob.findUnique({ where: { id: runId } });
    expect(terminalJob?.status).toBe("COMPLETED");
    expect(terminalJob?.progress).toBe(100);
    expect(terminalJob?.completedAt).toBeDefined();

    // Step 5: Readback through HTTP GET /runs/[runId]
    const readbackReq = createRequest(`http://localhost:3000/api/v1/kh02/research/runs/${runId}`, {
      workspaceId: WORKSPACE_ALPHA,
    });
    const readbackRes = await getResearchRunById(readbackReq, { params: Promise.resolve({ runId }) });
    expect(readbackRes.status).toBe(200);
    const readbackJson = await readbackRes.json();
    expect(readbackJson.success).toBe(true);
    expect(readbackJson.data.status).toBe("COMPLETED");
    expect(readbackJson.data.result).toBeDefined();
    expect(readbackJson.data.result.topic).toBe("Barking Device");

    // Step 6: Verify leaderboard snapshot readback
    const lbReq = createRequest("http://localhost:3000/api/v1/kh02/leaderboard", {
      workspaceId: WORKSPACE_ALPHA,
    });
    const lbRes = await getLeaderboard(lbReq);
    expect(lbRes.status).toBe(200);
    const lbJson = await lbRes.json();
    expect(lbJson.success).toBe(true);
    expect(lbJson.data).toBeDefined();
  });

  // ── CROSS-LAYER RECONCILIATION ───────────────────────────────────────────

  it("reconciles research across database, HTTP readback, and snapshot layers", async () => {
    // Submit and execute a research run
    const req = createRequest("http://localhost:3000/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_ALPHA,
      body: {
        topic: "Pet Ultrasonic",
        market: "US",
        lookbackDays: 90,
        mode: "async",
      },
    });

    const res = await postResearch(req);
    const body = await res.json();
    const runId = body.data.runId;
    fixtureRegistry.jobIds!.push(runId);

    const claimed = await claimNextResearchJob("worker-recon-test", prisma);
    if (claimed && claimed.id === runId) {
      await executeResearchJob(claimed, prisma);
    }

    // Call reconcileResearchAcrossLayers
    const recon = await reconcileResearchAcrossLayers(runId, {
      workspaceId: WORKSPACE_ALPHA,
      db: prisma,
    });
    expect(recon.status).toBe("COMPLETED");
    expect(recon.reconciliationVerdict).toBe("RECONCILED");
    expect(recon.candidatesCount).toBeGreaterThanOrEqual(0);
  });

  // ── ZERO-RESULT SEMANTICS ────────────────────────────────────────────────

  it("accurately handles zero-result discovery without software failure", async () => {
    // Search for a topic with zero ads
    const req = createRequest("http://localhost:3000/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_ALPHA,
      body: {
        topic: "NonExistentTopic9999XYZ",
        market: "US",
        lookbackDays: 30,
        mode: "async",
      },
    });

    const res = await postResearch(req);
    const body = await res.json();
    const runId = body.data.runId;
    fixtureRegistry.jobIds!.push(runId);

    const claimed = await claimNextResearchJob("worker-zero-test", prisma);
    if (claimed && claimed.id === runId) {
      const exec = await executeResearchJob(claimed, prisma);
      expect(exec.success).toBe(true);
      expect(exec.result?.totalCandidatesDiscovered).toBe(0);
      expect(exec.result?.topThree.length).toBe(0);
    }

    // Terminal job should be COMPLETED, not FAILED
    const job = await prisma.syncJob.findUnique({ where: { id: runId } });
    expect(job?.status).toBe("COMPLETED");
    expect(job?.errorMessage).toBeNull();
  });

  // ── TENANT ISOLATION ─────────────────────────────────────────────────────

  it("enforces workspace boundary: Workspace Beta cannot access Workspace Alpha runs", async () => {
    // Create run in Workspace Alpha
    const req = createRequest("http://localhost:3000/api/v1/kh02/research", {
      method: "POST",
      workspaceId: WORKSPACE_ALPHA,
      body: {
        topic: "Secret Alpha Topic",
        market: "US",
        mode: "async",
      },
    });
    const res = await postResearch(req);
    const body = await res.json();
    const runId = body.data.runId;
    fixtureRegistry.jobIds!.push(runId);

    // Workspace Beta attempts to access runId
    const betaReq = createRequest(`http://localhost:3000/api/v1/kh02/research/runs/${runId}`, {
      workspaceId: WORKSPACE_BETA,
    });
    const betaRes = await getResearchRunById(betaReq, { params: Promise.resolve({ runId }) });
    expect(betaRes.status).toBe(404);
  });
});
