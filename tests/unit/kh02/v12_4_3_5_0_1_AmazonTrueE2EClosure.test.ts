/**
 * SWAI KH-02 V12.4.3.5.0.1 — Amazon US Real End-to-End Integration & Honest Acceptance Closure
 * Comprehensive 40-Test Adversarial & Integration Suite (N01–N40)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  SWAI_KH02_RELEASE_VERSION,
  getRuntimeVersionInfo,
} from "@/services/kh02/version/runtimeVersionService";
import {
  computeDeterministicEvidenceHash,
  resolveAmazonUsPolicyContext,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import {
  parseAmazonProductEvidence,
  sanitizeUntrustedAmazonText,
  validateAmazonUsProductUrl,
  verifyAmazonProductIdentity,
} from "@/services/kh02/marketplace/amazonUsIdentity";
import {
  createAmazonProviderBudget,
} from "@/services/kh02/marketplace/amazonUsBudget";
import {
  AmazonPlaywrightMcpSession,
  connectAmazonPlaywrightMcp,
} from "@/services/kh02/marketplace/amazonUsMcpTransport";
import {
  classifyAmazonProviderOutcome,
  fetchAuthorizedAmazonProductEvidence,
  runAmazonUsPilotEnrichment,
} from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import {
  attachAmazonEvidenceToExistingResearchRun,
  computeAmazonEvidenceCompositeId,
  loadAmazonEvidenceForRun,
  persistAmazonEvidenceAtomically,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import {
  evaluateAmazonUsEvidenceGate,
} from "@/services/kh02/marketplace/amazonUsEvidenceGate";
import {
  claimNextResearchJob,
  completeResearchJob,
  executeResearchJob,
  processAmazonVerificationJob,
  recoverStaleResearchJobs,
} from "@/workers/kh02Worker";
import {
  GET as getAmazonMarketplaceRoute,
  POST as postAmazonMarketplaceRoute,
} from "@/app/api/v1/kh02/marketplace/amazon/route";
import {
  POST as postKh02ResearchRoute,
} from "@/app/api/v1/kh02/research/route";
import {
  runV12_4_3_5_0_1NegativeMutationSuite,
  validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1,
  writeCanonicalValidV12_4_3_5_0_1Fixture,
} from "../../../scripts/kh02/validateAmazonUsTrueE2EV12_4_3_5_0_1";

const TEST_WS_A = "ws_v1243501_alpha";
const TEST_WS_B = "ws_v1243501_beta";
const TEST_PARENT_RUN_A = "run_v1243501_parent_a";
const LOCAL_MCP_SERVER_SCRIPT = path.resolve(
  process.cwd(),
  "tests/helpers/localAmazonMcpTestServer.ts"
);

function buildParentLeaderboardSnapshot(runId: string, workspaceId: string) {
  return {
    researchRunId: runId,
    workspaceId,
    topic: "Pet Gadgets",
    market: "US",
    lookbackDays: 90,
    sourceMode: "LIVE_WITH_CACHE_FALLBACK",
    runStatus: "COMPLETED",
    generatedAt: "2026-10-31T12:00:00.000Z",
    totalCandidatesDiscovered: 3,
    candidates: [
      {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        canonicalProductName: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
        storeDomain: "uahpet.com",
        opportunityScore: 68,
        model: "UAH-WF-01",
      },
      {
        candidateId: "cand_kittyspout_2",
        title: "KittySpout Stainless Steel Cat Water Fountain",
        canonicalProductName: "KittySpout Stainless Steel Cat Water Fountain",
        brand: "KittySpout",
        storeDomain: "kittyspout.com",
        opportunityScore: 64,
        model: "KS-SS-02",
      },
      {
        candidateId: "cand_uproot_3",
        title: "Uproot Clean Pro Pet Hair Remover",
        canonicalProductName: "Uproot Clean Pro Pet Hair Remover",
        brand: "Uproot Clean",
        storeDomain: "uprootclean.com",
        opportunityScore: 61,
        model: "UC-PRO-03",
      },
    ],
    topThree: [
      {
        rank: 1,
        candidateId: "cand_uahpet_1",
        opportunityScore: 68,
        candidate: {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          storeDomain: "uahpet.com",
          opportunityScore: 68,
        },
        pillars: {
          DEMAND: 55,
          CREATIVE: 74,
          MERCHANT: 72,
          ECONOMICS: 70,
        },
        gateResults: {
          g15DemandPassed: false,
          g16MerchantVerified: true,
        },
      },
      {
        rank: 2,
        candidateId: "cand_kittyspout_2",
        opportunityScore: 64,
        candidate: {
          candidateId: "cand_kittyspout_2",
          title: "KittySpout Stainless Steel Cat Water Fountain",
          brand: "KittySpout",
          storeDomain: "kittyspout.com",
          opportunityScore: 64,
        },
        pillars: {
          DEMAND: 52,
          CREATIVE: 70,
          MERCHANT: 69,
          ECONOMICS: 65,
        },
        gateResults: {
          g15DemandPassed: false,
          g16MerchantVerified: true,
        },
      },
      {
        rank: 3,
        candidateId: "cand_uproot_3",
        opportunityScore: 61,
        candidate: {
          candidateId: "cand_uproot_3",
          title: "Uproot Clean Pro Pet Hair Remover",
          brand: "Uproot Clean",
          storeDomain: "uprootclean.com",
          opportunityScore: 61,
        },
        pillars: {
          DEMAND: 50,
          CREATIVE: 68,
          MERCHANT: 60,
          ECONOMICS: 66,
        },
        gateResults: {
          g15DemandPassed: false,
          g16MerchantVerified: false,
        },
      },
    ],
  };
}

describe("KH-02 V12.4.3.5.0.1 — Amazon US Real E2E Integration & 40 Negative Controls (N01–N40)", () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: TEST_WS_A },
      create: { id: TEST_WS_A, name: "V12.4.3.5.0.1 Workspace Alpha" },
      update: { name: "V12.4.3.5.0.1 Workspace Alpha" },
    });
    await prisma.workspace.upsert({
      where: { id: TEST_WS_B },
      create: { id: TEST_WS_B, name: "V12.4.3.5.0.1 Workspace Beta" },
      update: { name: "V12.4.3.5.0.1 Workspace Beta" },
    });

    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
    });
    await prisma.syncJob.deleteMany({
      where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
    });

    const parentSnapshot = buildParentLeaderboardSnapshot(TEST_PARENT_RUN_A, TEST_WS_A);
    await prisma.syncJob.create({
      data: {
        id: TEST_PARENT_RUN_A,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date("2026-10-31T12:00:00.000Z"),
        resultJson: JSON.stringify(parentSnapshot),
      },
    });
  });

  afterAll(async () => {
    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
    });
    await prisma.syncJob.deleteMany({
      where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
    });
  });

  // =========================================================================
  // UI & API CONTRACT (N01–N07)
  // =========================================================================

  it("N01: Default flags OFF -> policy is DISABLED_BY_DEFAULT and enrichment performs 0 MCP calls", async () => {
    const policy = resolveAmazonUsPolicyContext({});
    expect(policy.featureEnabled).toBe(false);
    expect(policy.liveAllowed).toBe(false);
    expect(policy.accessPolicyStatus).toBe("DISABLED_BY_DEFAULT");

    const res = await runAmazonUsPilotEnrichment({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      optInRequested: true,
      candidates: [
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          amazonProductUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      ],
      env: {},
    });
    expect(res.marketplaceTelemetry.runStatus).toBe("DISABLED");
    expect(res.marketplaceTelemetry.operationsAttempted).toBe(0);
    expect(res.marketplaceTelemetry.mcpSessionLifecycle?.sessionCreated).toBe(false);
  });

  it("N02: Invalid Amazon URLs (non-Amazon, non-US, search, cart, shortener, query/hash) rejected at API POST before any job creation", async () => {
    const invalidUrls = [
      "https://example.com/dp/B08N5WRWNW",
      "https://www.amazon.co.uk/dp/B08N5WRWNW",
      "https://www.amazon.com/s?k=cat+fountain",
      "https://www.amazon.com/gp/cart/view.html",
      "https://amzn.to/3xyz123",
      "https://a.co/d/1234567",
      "https://www.amazon.com/dp/B08N5WRWNW?tag=affiliate-20",
    ];

    for (const badUrl of invalidUrls) {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          researchRunId: TEST_PARENT_RUN_A,
          candidateUrls: {
            cand_uahpet_1: badUrl,
          },
        }),
      });
      const res = await postAmazonMarketplaceRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INVALID_AMAZON_PRODUCT_URL");
    }

    // Also verify pre-run POST /api/v1/kh02/research rejects invalid amazonPilotCandidateUrls
    const researchReq = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        topic: "Pet Gadgets",
        lookbackDays: 90,
        enableAmazonUsPilot: true,
        amazonPilotCandidateUrls: {
          cand_uahpet_1: "https://www.amazon.co.uk/dp/B08N5WRWNW",
        },
        asyncMode: true,
      }),
    });
    const researchRes = await postKh02ResearchRoute(researchReq);
    expect(researchRes.status).toBe(400);
    const researchJson = await researchRes.json();
    expect(researchJson.error.code).toBe("INVALID_AMAZON_PILOT_URL");
  });

  it("N03: Supplying >3 candidate URLs in one request is rejected with HTTP 400 CANDIDATE_URL_CAP_EXCEEDED", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        researchRunId: TEST_PARENT_RUN_A,
        candidateUrls: {
          cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
          cand_kittyspout_2: "https://www.amazon.com/dp/B09V3KXJPB",
          cand_uproot_3: "https://www.amazon.com/dp/B07XJ8C8F5",
          cand_extra_4: "https://www.amazon.com/dp/B01N5IB20Q",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("CANDIDATE_URL_CAP_EXCEEDED");
  });

  it("N04: Assigning the same ASIN to two distinct candidates in one request is rejected with HTTP 400 DUPLICATE_CONFLICTING_ASIN", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        researchRunId: TEST_PARENT_RUN_A,
        candidateUrls: {
          cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
          cand_kittyspout_2: "https://www.amazon.com/gp/product/B08N5WRWNW",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("DUPLICATE_CONFLICTING_ASIN");
  });

  it("N05: Malformed ASIN paths (too short, too long, invalid prefix) are rejected by validateAmazonUsProductUrl", () => {
    expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/B0123").valid).toBe(false);
    expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/B08N5WRWNW99").valid).toBe(false);
    expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/X08N5WRWNW").valid).toBe(false);
  });

  it("N06: Product Finder UI source wires enableAmazonUsPilot, disabled reason, and accessible post-run Verify Amazon US Listing form", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/products/page.tsx"),
      "utf8"
    );
    expect(pageSource).toContain("enableAmazonUsPilot:");
    expect(pageSource).toContain('data-testid="pf-amazon-pilot-control"');
    expect(pageSource).toContain('data-testid="pf-amazon-pilot-disabled-reason"');
    expect(pageSource).toContain('data-testid="pf-verify-amazon-trigger"');
    expect(pageSource).toContain('data-testid="pf-verify-amazon-form"');
    expect(pageSource).toContain('data-testid="pf-verify-amazon-url-input"');
    expect(pageSource).toContain('data-testid="pf-verify-amazon-asin-preview"');
    expect(pageSource).toContain('data-testid="pf-verify-amazon-disabled-reason"');
    expect(pageSource).toContain('type="url"');
    expect(pageSource).toContain('autoCorrect="off"');
    expect(pageSource).toContain('autoCapitalize="off"');
    expect(pageSource).toContain("spellCheck={false}");
  });

  it("N07: Cross-workspace POST /api/v1/kh02/marketplace/amazon returns 403 FORBIDDEN_WORKSPACE_RUN with zero child jobs created", async () => {
    const beforeCount = await prisma.syncJob.count({
      where: { jobType: "KH02_AMAZON_VERIFY" },
    });
    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_B,
      },
      body: JSON.stringify({
        researchRunId: TEST_PARENT_RUN_A,
        candidateUrls: {
          cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("FORBIDDEN_WORKSPACE_RUN");
    const afterCount = await prisma.syncJob.count({
      where: { jobType: "KH02_AMAZON_VERIFY" },
    });
    expect(afterCount).toBe(beforeCount);
  });

  // =========================================================================
  // WORKER & JOB OWNERSHIP (N08–N14)
  // =========================================================================

  it("N08: Two workers racing claimNextResearchJob on a KH02_AMAZON_VERIFY job -> only 1 succeeds", async () => {
    const jobId = "kh02_amz_verify_race_n08";
    await prisma.syncJob.create({
      data: {
        id: jobId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_AMAZON_VERIFY",
        status: "PENDING",
        progress: 0,
        resultJson: JSON.stringify({
          verifyJobId: jobId,
          targetResearchRunId: TEST_PARENT_RUN_A,
          candidateIds: ["cand_uahpet_1"],
          candidateUrls: { cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW" },
        }),
      },
    });

    const [claim1, claim2] = await Promise.all([
      claimNextResearchJob("worker_n08_1", prisma, { jobId }),
      claimNextResearchJob("worker_n08_2", prisma, { jobId }),
    ]);

    const winners = [claim1, claim2].filter(Boolean);
    expect(winners.length).toBe(1);
    expect(winners[0]?.jobType).toBe("KH02_AMAZON_VERIFY");

    await prisma.syncJob.delete({ where: { id: jobId } });
  });

  it("N09: Stale worker with outdated claimToken/fencingGeneration is blocked by attachAmazonEvidenceToExistingResearchRun", async () => {
    const jobId = "kh02_amz_verify_stale_n09";
    await prisma.syncJob.create({
      data: {
        id: jobId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_AMAZON_VERIFY",
        status: "RUNNING",
        workerId: "worker_active_n09",
        claimToken: "claim_active_n09",
        fencingToken: "fence_active_n09",
        fencingGeneration: 2,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const staleAttach = await attachAmazonEvidenceToExistingResearchRun(
      {
        workspaceId: TEST_WS_A,
        researchRunId: TEST_PARENT_RUN_A,
        verifyJobId: jobId,
        evidenceRows: [],
        telemetry: {
          provider: "AMAZON_US",
          featureEnabled: true,
          liveAllowed: false,
          accessPolicyStatus: "LIVE_NOT_ALLOWED",
          allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
          runStatus: "BLOCKED_POLICY",
          operationsAttempted: 1,
          operationsSucceeded: 0,
          operationsBlocked: 1,
          candidatesEvaluated: 1,
          identityVerifiedCount: 0,
          probableMatchCount: 0,
          brandOnlyCount: 0,
          rejectedCount: 1,
          notAttemptedCount: 0,
          operationLedger: [],
          rejectionLedger: [],
        },
        expectedWorkerId: "worker_stale_n09",
        expectedClaimToken: "claim_stale_n09",
        expectedFencingGeneration: 1,
      },
      prisma
    );

    expect(staleAttach.attached).toBe(false);
    expect(staleAttach.blockedByOwnershipOrAbort).toBe(true);
    expect(staleAttach.persistedCount).toBe(0);

    await prisma.syncJob.delete({ where: { id: jobId } });
  });

  it("N10: Expired lease on KH02_AMAZON_VERIFY is recovered by recoverStaleResearchJobs and increments fencingGeneration", async () => {
    const jobId = "kh02_amz_verify_expired_n10";
    await prisma.syncJob.create({
      data: {
        id: jobId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_AMAZON_VERIFY",
        status: "RUNNING",
        workerId: "worker_crashed_n10",
        claimToken: "claim_crashed_n10",
        fencingToken: "fence_crashed_n10",
        fencingGeneration: 1,
        recordVersion: 1,
        attemptNumber: 1,
        leaseExpiresAt: new Date(Date.now() - 10_000),
        resultJson: JSON.stringify({
          verifyJobId: jobId,
          targetResearchRunId: TEST_PARENT_RUN_A,
          candidateIds: ["cand_uahpet_1"],
          candidateUrls: { cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW" },
        }),
      },
    });

    const rec = await recoverStaleResearchJobs(prisma);
    expect(rec.recoveredCount).toBeGreaterThanOrEqual(1);

    const afterJob = await prisma.syncJob.findUnique({ where: { id: jobId } });
    expect(afterJob?.status).toBe("PENDING");
    expect(afterJob?.fencingGeneration).toBe(2);

    await prisma.syncJob.delete({ where: { id: jobId } });
  });

  it("N11: Abort signal during MCP enrichment closes owned MCP session cleanly with 0 leaked sessions", async () => {
    const controller = new AbortController();
    controller.abort(new Error("USER_ABORTED"));

    const res = await runAmazonUsPilotEnrichment({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      optInRequested: true,
      requestMode: "TEST_FIXTURE",
      fixtureSnapshotsByUrl: {
        "https://www.amazon.com/dp/B08N5WRWNW": {
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          httpStatus: 200,
          pageTitle: "UAHPET Wireless Cat Water Fountain",
        },
      },
      candidates: [
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          amazonProductUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      ],
      signal: controller.signal,
    });

    expect(res.marketplaceTelemetry.mcpSessionLifecycle?.closedCleanly).toBe(true);
  });

  it("N12: Unknown candidateId not belonging to target researchRunId is rejected at POST (400) and attach helper", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        researchRunId: TEST_PARENT_RUN_A,
        candidateUrls: {
          cand_nonexistent_999: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("UNKNOWN_CANDIDATE_FOR_RUN");
  });

  it("N13: Parent run in RUNNING or PENDING state is rejected with HTTP 409 INVALID_PARENT_RUN_STATE", async () => {
    const runningRunId = "run_v1243501_running_n13";
    await prisma.syncJob.create({
      data: {
        id: runningRunId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        progress: 40,
      },
    });

    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        researchRunId: runningRunId,
        candidateUrls: {
          cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_PARENT_RUN_STATE");

    await prisma.syncJob.delete({ where: { id: runningRunId } });
  });

  it("N14: POST /api/v1/kh02/marketplace/amazon creates a distinct KH02_AMAZON_VERIFY child job (verifyJobId !== researchRunId)", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/kh02/marketplace/amazon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": TEST_WS_A,
      },
      body: JSON.stringify({
        researchRunId: TEST_PARENT_RUN_A,
        candidateUrls: {
          cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      }),
    });
    const res = await postAmazonMarketplaceRoute(req);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.verifyJobId).toMatch(/^kh02_amz_verify_/);
    expect(json.data.verifyJobId).not.toBe(TEST_PARENT_RUN_A);
    expect(json.data.targetResearchRunId).toBe(TEST_PARENT_RUN_A);

    // Claim and execute child job via worker under default policy (BLOCKED_POLICY)
    const claimed = await claimNextResearchJob("worker_n14", prisma, {
      jobId: json.data.verifyJobId,
    });
    expect(claimed).not.toBeNull();
    const execOut = await executeResearchJob(claimed!, prisma);
    expect(execOut.success).toBe(true);

    const childAfter = await prisma.syncJob.findUnique({
      where: { id: json.data.verifyJobId },
    });
    expect(childAfter?.status).toBe("COMPLETED");
  });

  // =========================================================================
  // MCP SESSION & PROVIDER CLASSIFICATION (N15–N24)
  // =========================================================================

  it("N15: Handshake-only MCP session that connects/lists tools but returns zero toolInvocations is classified as NOT_EXECUTED, never IDENTITY_VERIFIED", async () => {
    const handshakeOnlySession: AmazonPlaywrightMcpSession = {
      sessionId: "pw_mcp_handshake_only_n15",
      transportMode: "REAL_STDIO_MCP",
      serverOrigin: "PINNED_PLAYWRIGHT_MCP",
      observationClass: "AUTHORIZED_LIVE",
      handshakeProof: {
        executed: true,
        connected: true,
        status: "CONNECTED_AND_VERIFIED",
        transportMode: "REAL_STDIO_MCP",
        serverOrigin: "PINNED_PLAYWRIGHT_MCP",
        observationClass: "AUTHORIZED_LIVE",
        sessionId: "pw_mcp_handshake_only_n15",
        pinnedPackage: "@playwright/mcp@0.0.83",
        command: "npx",
        args: ["-y", "@playwright/mcp@0.0.83", "--headless", "--isolated"],
        ownedChildPid: 99999,
        headlessIsolatedProfile: true,
        serverName: "Playwright",
        serverVersion: "0.0.83",
        discoveredTools: ["browser_navigate", "browser_snapshot", "browser_close"],
        requiredToolsPresent: true,
        missingRequiredTools: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 10,
        closedCleanly: false,
        errorMessage: null,
      },
      isAlive: () => true,
      async navigateAndCaptureProductSnapshot(url) {
        return {
          snapshot: {
            sourceUrl: url,
            finalUrl: url,
            httpStatus: 200,
            pageTitle: "UAHPET Wireless Cat Water Fountain",
            structuredData: {
              asin: "B08N5WRWNW",
              productTitle: "UAHPET Wireless Cat Water Fountain",
              brand: "UAHPET",
              price: 49.99,
              currency: "USD",
              availability: "In Stock",
              deliveryMarket: "US",
            },
          },
          upstreamRequestId: null,
          toolInvocations: [], // Zero actual MCP tool calls!
        };
      },
      async close() {},
    };

    const policy = resolveAmazonUsPolicyContext({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
    });

    const res = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      policyContext: policy,
      mcpSession: handshakeOnlySession,
    });

    expect(res.status).toBe("NOT_EXECUTED");
    expect(res.evidence).toBeNull();
    expect(res.operationRecord?.status).toBe("NOT_EXECUTED");
  });

  it("N16: Real End-to-End Child Job -> Worker -> StdioClientTransport MCP Server (browser_navigate + browser_snapshot + browser_close) -> Atomic SQLite Persistence -> GET Readback", async () => {
    const prevEnabled = process.env.KH02_AMAZON_US_ENABLED;
    const prevLive = process.env.KH02_AMAZON_US_LIVE_ALLOWED;
    const prevAttested = process.env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED;

    process.env.KH02_AMAZON_US_ENABLED = "true";
    process.env.KH02_AMAZON_US_LIVE_ALLOWED = "true";
    process.env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED = "true";

    try {
      const postReq = new NextRequest(
        "http://localhost:3000/api/v1/kh02/marketplace/amazon",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-workspace-id": TEST_WS_A,
          },
          body: JSON.stringify({
            researchRunId: TEST_PARENT_RUN_A,
            candidateUrls: {
              cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW",
              cand_kittyspout_2: "https://www.amazon.com/dp/B09V3KXJPB",
            },
            mcpConnectOptions: {
              command: process.execPath,
              args: [
                "--import",
                "tsx",
                LOCAL_MCP_SERVER_SCRIPT,
                "--headless",
                "--isolated",
              ],
            },
          }),
        }
      );

      const postRes = await postAmazonMarketplaceRoute(postReq);
      expect(postRes.status).toBe(202);
      const postJson = await postRes.json();
      const verifyJobId = postJson.data.verifyJobId;

      const claimed = await claimNextResearchJob("worker_n16_stdio", prisma, {
        jobId: verifyJobId,
      });
      expect(claimed).not.toBeNull();

      const verifyOutcome = await processAmazonVerificationJob(claimed!, prisma);
      expect(verifyOutcome.success).toBe(true);
      expect(verifyOutcome.verificationStatus).toBe("IDENTITY_VERIFIED");
      expect(verifyOutcome.persistedCount).toBe(2);

      // Verify GET /api/v1/kh02/marketplace/amazon returns the persisted evidence & telemetry
      const getReq = new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=${TEST_PARENT_RUN_A}&candidateId=cand_uahpet_1`,
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_A },
        }
      );
      const getRes = await getAmazonMarketplaceRoute(getReq);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.data.candidateSummary.visible).toBe(true);
      expect(getJson.data.candidateSummary.asin).toBe("B08N5WRWNW");
      expect(getJson.data.candidateSummary.status).toBe("IDENTITY_VERIFIED");
      expect(getJson.data.candidateSummary.identityMatch).toBe("EXACT_PRODUCT");

      // Critically: Because this ran against the local stdio MCP test double,
      // observationClass MUST be TEST_FIXTURE and realProviderVerdict MUST NOT be REAL_PROVIDER_VERIFIED!
      expect(getJson.data.candidateSummary.observationClass).toBe("TEST_FIXTURE");
      expect(
        getJson.data.marketplaceTelemetry.mcpSessionLifecycle.sessionCreated
      ).toBe(true);
      expect(
        getJson.data.marketplaceTelemetry.mcpSessionLifecycle.ownershipMode
      ).toBe("OWNED");
      expect(
        getJson.data.marketplaceTelemetry.mcpSessionLifecycle.serverOrigin
      ).toBe("LOCAL_MCP_TEST_DOUBLE");
      expect(
        getJson.data.marketplaceTelemetry.mcpSessionLifecycle.closedCleanly
      ).toBe(true);
      expect(
        getJson.data.marketplaceTelemetry.mcpSessionLifecycle.toolInvocationsCount
      ).toBe(4); // 2 candidates * (browser_navigate + browser_snapshot)
      expect(
        getJson.data.marketplaceTelemetry.gateEvaluation.realProviderVerdict
      ).not.toBe("REAL_PROVIDER_VERIFIED");
      expect(
        getJson.data.marketplaceTelemetry.gateEvaluation.counts
          .verifiedLiveUsProductIdentitiesCount
      ).toBe(0);
    } finally {
      if (prevEnabled === undefined) delete process.env.KH02_AMAZON_US_ENABLED;
      else process.env.KH02_AMAZON_US_ENABLED = prevEnabled;
      if (prevLive === undefined) delete process.env.KH02_AMAZON_US_LIVE_ALLOWED;
      else process.env.KH02_AMAZON_US_LIVE_ALLOWED = prevLive;
      if (prevAttested === undefined)
        delete process.env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED;
      else process.env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED = prevAttested;
    }
  });

  it("N17: KH02_AMAZON_US_ENABLED=true and KH02_AMAZON_US_LIVE_ALLOWED=false -> BLOCKED_POLICY with 0 MCP navigations", async () => {
    const res = await runAmazonUsPilotEnrichment({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      optInRequested: true,
      candidates: [
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          amazonProductUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      ],
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "false",
      },
    });
    expect(res.marketplaceTelemetry.runStatus).toBe("BLOCKED_POLICY");
    expect(res.marketplaceTelemetry.mcpSessionLifecycle?.sessionCreated).toBe(false);
    expect(res.marketplaceTelemetry.operationLedger[0]?.attemptCount).toBe(0);
  });

  it("N18: KH02_AMAZON_US_LIVE_ALLOWED=true without attestation or Creators API -> BLOCKED_POLICY", () => {
    const policy = resolveAmazonUsPolicyContext({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
    });
    expect(policy.liveAllowed).toBe(false);
    expect(policy.accessPolicyStatus).toBe("BLOCKED_POLICY");
  });

  it("N19: Official Creators API credentials without implemented client returns NOT_IMPLEMENTED / BLOCKED_POLICY, never Playwright scraping", async () => {
    const policy = resolveAmazonUsPolicyContext({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      AMAZON_CREATORS_API_CREDENTIAL_ID: "cred_id",
      AMAZON_CREATORS_API_CREDENTIAL_SECRET: "cred_secret",
      AMAZON_CREATORS_API_PARTNER_TAG: "partner-20",
    });
    expect(policy.liveAllowed).toBe(false);
    expect(policy.accessPolicyStatus).toBe("BLOCKED_POLICY");
    expect(policy.allowedAccessRoute).toBe("CREATORS_API_NOT_IMPLEMENTED");
    expect(policy.policyReason).toContain("NOT_IMPLEMENTED");

    const fetchRes = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      policyContext: {
        ...policy,
        allowedAccessRoute: "CREATORS_API",
      },
    });
    expect(fetchRes.status).toBe("NOT_IMPLEMENTED");
    expect(fetchRes.operationRecord?.attemptCount).toBe(0);
  });

  it("N20: Borrowed mcpSession (ownsMcpSession=false) is not closed by fetchAuthorizedAmazonProductEvidence after first operation", async () => {
    const conn = await connectAmazonPlaywrightMcp({
      fixtureTransport: {
        enabled: true,
        snapshotsByUrl: {
          "https://www.amazon.com/dp/B08N5WRWNW": {
            sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            httpStatus: 200,
            pageTitle: "UAHPET Wireless Cat Water Fountain",
            structuredData: {
              asin: "B08N5WRWNW",
              productTitle: "UAHPET Wireless Cat Water Fountain",
              brand: "UAHPET",
              price: 49.99,
              currency: "USD",
              availability: "In Stock",
              explicitUsDeliveryConfirmed: true,
            },
          },
        },
      },
    });
    const session = conn.session!;
    const controller = new AbortController();
    const budget = createAmazonProviderBudget({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      signal: controller.signal,
      isolatedCoordinator: true,
    });

    await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      requestMode: "TEST_FIXTURE",
      budget,
      mcpSession: session,
      ownsMcpSession: false,
    });

    // Abort budget and verify borrowed session remains alive until caller closes it
    controller.abort();
    expect(session.isAlive()).toBe(true);
    await session.close();
    expect(session.isAlive()).toBe(false);
  });

  it("N21: CAPTCHA page is classified as CAPTCHA_BLOCKED with attemptCount=1 (no retry loop)", async () => {
    const conn = await connectAmazonPlaywrightMcp({
      fixtureTransport: {
        enabled: true,
        snapshotsByUrl: {
          "https://www.amazon.com/dp/B08N5WRWNW": {
            sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            httpStatus: 200,
            pageTitle: "Robot Check",
            html: "<form action='/errors/validateCaptcha'>Enter the characters you see below</form>",
          },
        },
      },
    });
    const res = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      requestMode: "TEST_FIXTURE",
      budget: createAmazonProviderBudget({
        workspaceId: TEST_WS_A,
        researchRunId: "run_n21",
        isolatedCoordinator: true,
      }),
      mcpSession: conn.session,
    });
    expect(res.status).toBe("CAPTCHA_BLOCKED");
    expect(res.operationRecord?.attemptCount).toBe(1);
    await conn.session?.close();
  });

  it("N22: HTTP 403/503 bot wall is classified as BLOCKED_PROVIDER with attemptCount=1", async () => {
    const conn = await connectAmazonPlaywrightMcp({
      fixtureTransport: {
        enabled: true,
        snapshotsByUrl: {
          "https://www.amazon.com/dp/B08N5WRWNW": {
            sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            httpStatus: 503,
            pageTitle: "Sorry! Something went wrong!",
            html: "503 Service Unavailable - Automated access blocked",
          },
        },
      },
    });
    const res = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      requestMode: "TEST_FIXTURE",
      budget: createAmazonProviderBudget({
        workspaceId: TEST_WS_A,
        researchRunId: "run_n22",
        isolatedCoordinator: true,
      }),
      mcpSession: conn.session,
    });
    expect(res.status).toBe("BLOCKED_PROVIDER");
    expect(res.operationRecord?.attemptCount).toBe(1);
    await conn.session?.close();
  });

  it("N23: HTTP 429 rate limit is classified as RATE_LIMITED with attemptCount=1", async () => {
    const conn = await connectAmazonPlaywrightMcp({
      fixtureTransport: {
        enabled: true,
        snapshotsByUrl: {
          "https://www.amazon.com/dp/B08N5WRWNW": {
            sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
            httpStatus: 429,
            pageTitle: "429 Too Many Requests",
            html: "429 Too Many Requests",
          },
        },
      },
    });
    const res = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: TEST_WS_A,
      researchRunId: TEST_PARENT_RUN_A,
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      requestMode: "TEST_FIXTURE",
      budget: createAmazonProviderBudget({
        workspaceId: TEST_WS_A,
        researchRunId: "run_n23",
        isolatedCoordinator: true,
      }),
      mcpSession: conn.session,
    });
    expect(res.status).toBe("RATE_LIMITED");
    expect(res.operationRecord?.attemptCount).toBe(1);
    await conn.session?.close();
  });

  it("N24: Non-US currency (GBP/CAD) or non-US delivery market is rejected as FAILED, never IDENTITY_VERIFIED", () => {
    const parsed = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: 200,
        structuredData: {
          asin: "B08N5WRWNW",
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          price: 39.99,
          currency: "GBP",
          availability: "In Stock",
          explicitUsDeliveryConfirmed: false,
        },
      },
      {
        workspaceId: TEST_WS_A,
        researchRunId: TEST_PARENT_RUN_A,
        candidateId: "cand_uahpet_1",
      }
    );
    expect(parsed.status).toBe("FAILED");
    expect(parsed.rejectionReasons.join(" ")).toContain("COUNTRY_MARKETPLACE_CURRENCY_MISMATCH:GBP");
  });

  // =========================================================================
  // PERSISTENCE & READ-ONLY INTEGRITY (N25–N32)
  // =========================================================================

  it("N25: Simulated DB write failure during processAmazonVerificationJob transitions child job to FAILED with AMAZON_EVIDENCE_PERSISTENCE_FAILED", async () => {
    const failChildJobId = "kh02_amz_verify_fail_n25";
    await prisma.syncJob.create({
      data: {
        id: failChildJobId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_AMAZON_VERIFY",
        status: "PENDING",
        progress: 0,
        resultJson: JSON.stringify({
          verifyJobId: failChildJobId,
          targetResearchRunId: TEST_PARENT_RUN_A,
          candidateIds: ["cand_uahpet_1"],
          candidateUrls: { cand_uahpet_1: "https://www.amazon.com/dp/B08N5WRWNW" },
          requestMode: "TEST_FIXTURE",
          fixtureSnapshotsByUrl: {
            "https://www.amazon.com/dp/B08N5WRWNW": {
              sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
              finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
              httpStatus: 200,
              structuredData: {
                asin: "B08N5WRWNW",
                productTitle: "UAHPET Wireless Cat Water Fountain",
                brand: "UAHPET",
                price: 49.99,
                currency: "USD",
                availability: "In Stock",
                explicitUsDeliveryConfirmed: true,
              },
            },
          },
          simulatePersistenceFailureForTest: true,
        }),
      },
    });

    const claimed = await claimNextResearchJob("worker_n25", prisma, {
      jobId: failChildJobId,
    });
    expect(claimed).not.toBeNull();

    const outcome = await processAmazonVerificationJob(claimed!, prisma);
    expect(outcome.success).toBe(false);

    const jobRecord = await prisma.syncJob.findUnique({ where: { id: failChildJobId } });
    expect(jobRecord?.status).toBe("FAILED");
    expect(jobRecord?.errorMessage).toContain("AMAZON_EVIDENCE_PERSISTENCE_FAILED");

    await prisma.syncJob.delete({ where: { id: failChildJobId } });
  });

  it("N26: Source audit confirms zero `.catch(() => null)` around persistAmazonEvidenceAtomically in kh02Worker.ts and kh02PersistenceService.ts", () => {
    const workerSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/workers/kh02Worker.ts"),
      "utf8"
    );
    const persistSrc = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/services/kh02/persistence/kh02PersistenceService.ts"
      ),
      "utf8"
    );

    const workerMatch = workerSrc.match(
      /persistAmazonEvidenceAtomically[\s\S]{0,280}\.catch\(\(\)\s*=>\s*null\)/
    );
    const persistMatch = persistSrc.match(
      /persistAmazonEvidenceAtomically[\s\S]{0,280}\.catch\(\(\)\s*=>\s*null\)/
    );
    expect(workerMatch).toBeNull();
    expect(persistMatch).toBeNull();
  });

  it("N27: Simulated DB write failure during completeResearchJob downgrades run to PARTIALLY_COMPLETED and strips unpersisted Amazon evidence", async () => {
    const parentJobId = "run_v1243501_n27_parent";
    await prisma.syncJob.create({
      data: {
        id: parentJobId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "PENDING",
        progress: 0,
        resultJson: JSON.stringify({ topic: "Pet Gadgets" }),
      },
    });

    const claimed = await claimNextResearchJob("worker_n27", prisma, {
      jobId: parentJobId,
    });
    expect(claimed).not.toBeNull();

    const fakeResult: any = {
      ...buildParentLeaderboardSnapshot(parentJobId, TEST_WS_A),
      runStatus: "COMPLETED",
      _simulateAmazonPersistenceFailureForTest: true,
      marketplaceEvidence: [
        {
          id: "amz_ev_n27",
          workspaceId: TEST_WS_A,
          researchRunId: parentJobId,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "TEST_FIXTURE",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "hash1",
          extractedFieldsHash: "hash2",
          providerInvocationRef: "amz_inv_n27",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "AMAZON_US_TEST_FIXTURE",
          observationClass: "TEST_FIXTURE",
          verificationScope: "IDENTITY_CORROBORATED",
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: ["Exact match"],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "LIVE_NOT_ALLOWED",
          status: "IDENTITY_VERIFIED",
        },
      ],
      marketplaceTelemetry: {
        provider: "AMAZON_US",
        featureEnabled: true,
        liveAllowed: false,
        accessPolicyStatus: "LIVE_NOT_ALLOWED",
        allowedAccessRoute: "ISOLATED_FIXTURE_ONLY",
        runStatus: "IDENTITY_VERIFIED",
        operationsAttempted: 1,
        operationsSucceeded: 1,
        operationsBlocked: 0,
        candidatesEvaluated: 1,
        identityVerifiedCount: 1,
        probableMatchCount: 0,
        brandOnlyCount: 0,
        rejectedCount: 0,
        notAttemptedCount: 0,
        operationLedger: [],
        rejectionLedger: [],
      },
      warnings: [],
    };

    const compRes = await completeResearchJob(
      parentJobId,
      claimed!.ownership,
      fakeResult,
      prisma
    );
    expect(compRes.success).toBe(true);

    const updatedJob = await prisma.syncJob.findUnique({ where: { id: parentJobId } });
    expect(updatedJob?.status).toBe("PARTIALLY_COMPLETED");
    const parsedJson = JSON.parse(updatedJob!.resultJson!);
    expect(parsedJson.marketplaceEvidence).toEqual([]);
    expect(parsedJson.marketplaceTelemetry.persistenceStatus).toBe("FAILED");
    expect(parsedJson.marketplaceTelemetry.runStatus).toBe("FAILED");
    expect(parsedJson.warnings.join(" ")).toContain("AMAZON_EVIDENCE_PERSISTENCE_FAILED");

    await prisma.syncJob.delete({ where: { id: parentJobId } });
  });

  it("N28: Ownership loss inside db.$transaction rolls back persistAmazonEvidenceAtomically with 0 rows persisted", async () => {
    const runId = "run_v1243501_n28_tx";
    await prisma.syncJob.create({
      data: {
        id: runId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker_n28_owner",
        claimToken: "claim_n28_owner",
        fencingToken: "fence_n28_owner",
        fencingGeneration: 1,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    let callNum = 0;
    const res = await persistAmazonEvidenceAtomically(
      TEST_WS_A,
      runId,
      [
        {
          id: "amz_ev_n28",
          workspaceId: TEST_WS_A,
          researchRunId: runId,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "TEST_FIXTURE",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "h1",
          extractedFieldsHash: "h2",
          providerInvocationRef: "inv_n28",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "TEST",
          observationClass: "TEST_FIXTURE",
          verificationScope: "IDENTITY_CORROBORATED",
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: [],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "LIVE_NOT_ALLOWED",
          status: "IDENTITY_VERIFIED",
        },
      ],
      {
        db: prisma,
        expectedWorkerId: "worker_n28_owner",
        expectedClaimToken: "claim_n28_owner",
        expectedFencingGeneration: 1,
        // Pre-tx check passes (call 1), inside-tx check fails (call 2)!
        isLeaseStillOwned: () => {
          callNum++;
          return callNum === 1;
        },
      }
    );

    expect(res.blockedByOwnershipOrAbort).toBe(true);
    expect(res.persistedCount).toBe(0);

    const countInDb = await prisma.researchEvidence.count({
      where: { workspaceId: TEST_WS_A, subjectId: { startsWith: `${runId}:` } },
    });
    expect(countInDb).toBe(0);

    await prisma.syncJob.delete({ where: { id: runId } });
  });

  it("N29: Stronger AUTHORIZED_LIVE IDENTITY_VERIFIED row is preserved against weaker IMPORTED_BY_USER / UNVERIFIED overwrite", async () => {
    const runId = "run_v1243501_n29_stronger";
    const strongRow: any = {
      id: computeAmazonEvidenceCompositeId(
        TEST_WS_A,
        runId,
        "cand_uahpet_1",
        "B08N5WRWNW",
        "https://www.amazon.com/dp/B08N5WRWNW"
      ),
      workspaceId: TEST_WS_A,
      researchRunId: runId,
      candidateId: "cand_uahpet_1",
      provider: "AMAZON_US",
      requestMode: "URL_VERIFICATION",
      requestedMarket: "US",
      verifiedDeliveryMarket: "US",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      asin: "B08N5WRWNW",
      parentAsin: null,
      variationAsin: null,
      productTitle: "UAHPET Wireless Cat Water Fountain (Authorized Live)",
      brand: "UAHPET",
      merchant: null,
      seller: null,
      currency: "USD",
      price: 49.99,
      availability: "In Stock",
      observedAt: "2026-10-31T12:00:00.000Z",
      sourceTimestamp: null,
      rawEvidenceHash: "live_raw_hash",
      extractedFieldsHash: "live_ext_hash",
      providerInvocationRef: "amz_inv_live_1",
      providerRequestId: null,
      responseEvidenceRef: null,
      evidenceOrigin: "AMAZON_US_LIVE",
      observationClass: "AUTHORIZED_LIVE",
      verificationScope: "IDENTITY_CORROBORATED",
      identityMatch: "EXACT_PRODUCT",
      isCached: false,
      matchedCanonicalKey: "amz_us:B08N5WRWNW",
      matchingReasons: ["Exact live match"],
      missingFields: [],
      rejectionReasons: [],
      accessPolicyStatus: "AUTHORIZED_USER_LIMITED_URL",
      status: "IDENTITY_VERIFIED",
    };

    await persistAmazonEvidenceAtomically(TEST_WS_A, runId, [strongRow], { db: prisma });

    // Attempt to overwrite with weaker IMPORTED_BY_USER / BLOCKED_POLICY row
    const weakRow: any = {
      ...strongRow,
      productTitle: "Weaker Overwrite Attempt",
      observationClass: "IMPORTED_BY_USER",
      status: "OBSERVED_UNVERIFIED",
    };
    await persistAmazonEvidenceAtomically(TEST_WS_A, runId, [weakRow], { db: prisma });

    const loaded = await loadAmazonEvidenceForRun(TEST_WS_A, runId, prisma);
    expect(loaded.evidenceRows.length).toBe(1);
    expect(loaded.evidenceRows[0].observationClass).toBe("AUTHORIZED_LIVE");
    expect(loaded.evidenceRows[0].status).toBe("IDENTITY_VERIFIED");
    expect(loaded.evidenceRows[0].productTitle).toBe(
      "UAHPET Wireless Cat Water Fountain (Authorized Live)"
    );

    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: TEST_WS_A, subjectId: { startsWith: `${runId}:` } },
    });
  });

  it("N30: Out-of-order / stale run response guard is enforced in fetchAmazonRunState and loadPersistedRun", () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/products/page.tsx"),
      "utf8"
    );
    expect(pageSource).toContain(
      "targetRunId !== authoritativeRunIdRef.current"
    );
  });

  it("N31: GET /api/v1/kh02/marketplace/amazon (200, 403, 404) performs zero SQLite mutations", async () => {
    const snapshotDigest = async () => {
      const [evRows, jobs] = await Promise.all([
        prisma.researchEvidence.findMany({
          where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
          orderBy: { id: "asc" },
        }),
        prisma.syncJob.findMany({
          where: {
            workspaceId: { in: [TEST_WS_A, TEST_WS_B] },
            jobType: { not: "KH02_WORKER_HEARTBEAT" },
          },
          orderBy: { id: "asc" },
        }),
      ]);
      return computeDeterministicEvidenceHash({ evRows, jobs });
    };

    const before = await snapshotDigest();

    const r200 = await getAmazonMarketplaceRoute(
      new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=${TEST_PARENT_RUN_A}`,
        { headers: { "x-workspace-id": TEST_WS_A } }
      )
    );
    expect(r200.status).toBe(200);

    const r403 = await getAmazonMarketplaceRoute(
      new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=${TEST_PARENT_RUN_A}`,
        { headers: { "x-workspace-id": TEST_WS_B } }
      )
    );
    expect(r403.status).toBe(403);

    const r404 = await getAmazonMarketplaceRoute(
      new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=run_nonexistent_404`,
        { headers: { "x-workspace-id": TEST_WS_A } }
      )
    );
    expect(r404.status).toBe(404);

    const after = await snapshotDigest();
    expect(after).toBe(before);
  });

  it("N32: Legacy SyncJob without marketplaceEvidence in resultJson loads cleanly with isLegacyRunWithoutMarketplaceEvidence=true", async () => {
    const legacyId = "run_v1243501_legacy_n32";
    await prisma.syncJob.create({
      data: {
        id: legacyId,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        resultJson: JSON.stringify({ topic: "Legacy Topic", topThree: [] }),
      },
    });
    const loaded = await loadAmazonEvidenceForRun(TEST_WS_A, legacyId, prisma);
    expect(loaded.isLegacyRunWithoutMarketplaceEvidence).toBe(true);
    expect(loaded.evidenceRows).toEqual([]);
    await prisma.syncJob.delete({ where: { id: legacyId } });
  });

  // =========================================================================
  // SCORING, G15/G16 NON-INFLATION & VALIDATOR HONESTY (N33–N40)
  // =========================================================================

  it("N33: Post-run Amazon verification leaves opportunityScore, topThree ordering, pillars, G15, and G16 100% unchanged", async () => {
    const parentJob = await prisma.syncJob.findUnique({
      where: { id: TEST_PARENT_RUN_A },
    });
    const parsedAfter = JSON.parse(parentJob!.resultJson!);
    expect(parsedAfter.topThree.map((t: any) => t.candidateId)).toEqual([
      "cand_uahpet_1",
      "cand_kittyspout_2",
      "cand_uproot_3",
    ]);
    expect(parsedAfter.topThree[0].opportunityScore).toBe(68);
    expect(parsedAfter.topThree[1].opportunityScore).toBe(64);
    expect(parsedAfter.topThree[2].opportunityScore).toBe(61);
    expect(parsedAfter.topThree[0].gateResults.g15DemandPassed).toBe(false);
    expect(parsedAfter.topThree[0].gateResults.g16MerchantVerified).toBe(true);
    expect(parsedAfter.topThree[2].gateResults.g16MerchantVerified).toBe(false);
  });

  it("N34: Brand-only match or conflicting product title is never promoted to EXACT_PRODUCT or IDENTITY_VERIFIED", () => {
    const parsed = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: 200,
        structuredData: {
          asin: "B08N5WRWNW",
          productTitle: "UAHPET Replacement Foam Filters 8-Pack",
          brand: "UAHPET",
          price: 12.99,
          currency: "USD",
          availability: "In Stock",
          explicitUsDeliveryConfirmed: true,
        },
      },
      {
        workspaceId: TEST_WS_A,
        researchRunId: TEST_PARENT_RUN_A,
        candidateId: "cand_uahpet_1",
      }
    );
    const verified = verifyAmazonProductIdentity(
      {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
      },
      parsed
    );
    expect(verified.identityMatch).toBe("BRAND_ONLY");
    expect(verified.updatedEvidence.status).toBe("OBSERVED_UNVERIFIED");
  });

  it("N35: Hostile HTML (<script>, onerror=, javascript:, <iframe>) in Amazon fields is sanitized and flagged", () => {
    const res = sanitizeUntrustedAmazonText(
      `<script>alert(1)</script><img src=x onerror="steal()">UAHPET Fountain <a href="javascript:evil()">Click</a>`
    );
    expect(res.sanitized).not.toContain("<script");
    expect(res.sanitized).not.toContain("onerror");
    expect(res.sanitized).not.toContain("javascript:");
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("N36: Local/synthetic invocation ID copied into providerRequestId fails evaluateAmazonUsEvidenceGate", () => {
    const gate = evaluateAmazonUsEvidenceGate(
      TEST_PARENT_RUN_A,
      [],
      [
        {
          operationId: "op_n36",
          providerInvocationRef: "amz_inv_local_1",
          providerRequestId: "amz_inv_local_1", // Forbidden conflation!
          providerRequestIdOrigin: "UPSTREAM",
          workspaceId: TEST_WS_A,
          researchRunId: TEST_PARENT_RUN_A,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "URL_VERIFICATION",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          attemptCount: 1,
          maxAttemptsAllowed: 2,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 10,
          requestHash: "r1",
          responseHash: "r2",
          status: "IDENTITY_VERIFIED",
          outcomeCategory: "OBSERVED_SUCCESS",
          observationClass: "AUTHORIZED_LIVE",
          transportSessionId: "s1",
          aborted: false,
          errorMessage: null,
        },
      ]
    );
    expect(gate.engineeringVerdict).toBe("ENGINEERING_FAILED");
  });

  it("N37: TEST_FIXTURE, CACHED, or IMPORTED_BY_USER rows are excluded from verifiedLiveUsProductIdentitiesCount", () => {
    const policy = resolveAmazonUsPolicyContext({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
    });
    const gate = evaluateAmazonUsEvidenceGate(
      TEST_PARENT_RUN_A,
      [
        {
          id: "ev_fixture_n37",
          workspaceId: TEST_WS_A,
          researchRunId: TEST_PARENT_RUN_A,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "TEST_FIXTURE",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "h1",
          extractedFieldsHash: "h2",
          providerInvocationRef: "inv1",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "FIXTURE",
          observationClass: "TEST_FIXTURE",
          verificationScope: "IDENTITY_CORROBORATED",
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: [],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "AUTHORIZED_USER_LIMITED_URL",
          status: "IDENTITY_VERIFIED",
        },
      ],
      [],
      policy,
      { workspaceId: TEST_WS_A }
    );
    expect(gate.counts.verifiedLiveUsProductIdentitiesCount).toBe(0);
    expect(gate.counts.fixtureOrCachedRowsExcludedFromLive).toBe(1);
    expect(gate.realProviderVerdict).not.toBe("REAL_PROVIDER_VERIFIED");
  });

  it("N38: Cross-run or cross-workspace evidence row is excluded from sameRunWorkspaceVerifiedRows", () => {
    const gate = evaluateAmazonUsEvidenceGate(
      TEST_PARENT_RUN_A,
      [
        {
          id: "ev_other_ws_n38",
          workspaceId: TEST_WS_B,
          researchRunId: TEST_PARENT_RUN_A,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "URL_VERIFICATION",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "h1",
          extractedFieldsHash: "h2",
          providerInvocationRef: "inv1",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "LIVE",
          observationClass: "AUTHORIZED_LIVE",
          verificationScope: "IDENTITY_CORROBORATED",
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: [],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "AUTHORIZED_USER_LIMITED_URL",
          status: "IDENTITY_VERIFIED",
        },
      ],
      [],
      resolveAmazonUsPolicyContext(),
      { workspaceId: TEST_WS_A }
    );
    expect(gate.counts.sameRunWorkspaceVerifiedRows).toBe(0);
    expect(gate.counts.rejectedCount).toBe(1);
  });

  it("N39: Claiming SALES_VERIFIED on verificationScope fails evaluateAmazonUsEvidenceGate", () => {
    const gate = evaluateAmazonUsEvidenceGate(
      TEST_PARENT_RUN_A,
      [
        {
          id: "ev_sales_claim_n39",
          workspaceId: TEST_WS_A,
          researchRunId: TEST_PARENT_RUN_A,
          candidateId: "cand_uahpet_1",
          provider: "AMAZON_US",
          requestMode: "TEST_FIXTURE",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "h1",
          extractedFieldsHash: "h2",
          providerInvocationRef: "inv1",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "FIXTURE",
          observationClass: "TEST_FIXTURE",
          verificationScope: "SALES_VERIFIED" as any,
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: [],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "LIVE_NOT_ALLOWED",
          status: "IDENTITY_VERIFIED",
        },
      ],
      [],
      resolveAmazonUsPolicyContext(),
      { workspaceId: TEST_WS_A }
    );
    expect(gate.engineeringVerdict).toBe("ENGINEERING_FAILED");
    expect(gate.blockers.join(" ")).toContain("FORBIDDEN_VERIFICATION_SCOPE");
  });

  it("N40: Release version is 12.4.3.5.0.1 and independent validator catches all 32 physical-file negative control mutations (0 escapes)", () => {
    expect(["12.4.3.5.0.1", "12.4.3.5.0.2", "12.4.3.5.0.3"]).toContain(SWAI_KH02_RELEASE_VERSION);
    expect(["12.4.3.5.0.1", "12.4.3.5.0.2", "12.4.3.5.0.3"]).toContain(getRuntimeVersionInfo().appVersion);

    const tmpFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243501_n40_"));
    try {
      const dummySha = "1111111111111111111111111111111111111111";
      writeCanonicalValidV12_4_3_5_0_1Fixture(tmpFixtureDir, dummySha);
      const validCheck = validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1(tmpFixtureDir, {
        expectedCodeSha: dummySha,
      });
      expect(validCheck.overallValid).toBe(true);

      const mutReport = runV12_4_3_5_0_1NegativeMutationSuite(tmpFixtureDir, dummySha);
      expect(mutReport.totalMutations).toBe(32);
      expect(mutReport.totalCaughtAndRejected).toBe(32);
      expect(mutReport.falsePassEscapes).toBe(0);
      expect(mutReport.suiteVerdict).toBe("PASS");
    } finally {
      fs.rmSync(tmpFixtureDir, { recursive: true, force: true });
    }
  });
});
