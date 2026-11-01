/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Product Discovery + PDP Evidence (Jina Reader REST, No API Key)
 * End-to-End Integration, Persistence, Worker, API Route & Non-Inflation Test Suite
 */

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  resetWalmartSharedHostGroupForTests,
  createWalmartProviderBudget,
  reserveWalmartOperation,
  reserveWalmartNetworkAttempt,
  awaitWalmartRateSlot,
} from "@/services/kh02/marketplace/walmartJinaBudget";
import {
  computeWalmartEvidenceCompositeId,
  persistWalmartEvidenceAtomically,
  loadWalmartEvidenceForRun,
  attachWalmartEvidenceToResearchRun,
  summarizeWalmartEvidenceForCandidate,
  filterWalmartEvidencePointInTime,
  WALMART_EVIDENCE_SUBJECT_TYPE,
} from "@/services/kh02/marketplace/walmartEvidencePersistence";
import { runWalmartUsPilotEnrichment } from "@/services/kh02/marketplace/walmartUsResearchAdapter";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";
import {
  claimNextResearchJob,
  executeResearchJob,
  processWalmartVerificationJob,
} from "@/workers/kh02Worker";
import {
  GET as getWalmartMarketplaceRoute,
  POST as postWalmartMarketplaceRoute,
} from "@/app/api/v1/kh02/marketplace/walmart/route";
import { GET as getProductOverviewRoute } from "@/app/api/v1/research/products/[id]/overview/route";
import {
  buildChomChomSearchJinaBody,
  buildChomChomPdpJinaBody,
  buildBlackDeckerPdpJinaBody,
  buildSonyLeadingZeroUpcPdpJinaBody,
} from "../fixtures/kh02/walmart-jina/walmartJinaFixtures";

const WS_A = "ws_walmart_v124351_alpha";
const WS_B = "ws_walmart_v124351_beta";
const RUN_A = "run_walmart_v124351_parent_a";

function buildParentSnapshot(runId: string, workspaceId: string) {
  return {
    researchRunId: runId,
    workspaceId,
    topic: "Pet Gadgets",
    market: "US",
    lookbackDays: 90,
    sourceMode: "LIVE_WITH_CACHE_FALLBACK",
    runStatus: "COMPLETED",
    generatedAt: "2026-11-01T04:00:00.000Z",
    totalCandidatesDiscovered: 3,
    candidates: [
      {
        candidateId: "cand_chomchom_1",
        title: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller",
        canonicalProductName: "ChomChom Roller Pet Hair Remover",
        brand: "ChomChom Roller",
        model: "CC-ROLLER-01",
        upc: "856957004000",
        storeDomain: "chomchomroller.com",
        opportunityScore: 72,
      },
      {
        candidateId: "cand_blackdecker_2",
        title: "BLACK+DECKER dustbuster AdvancedClean Cordless Handheld Vacuum",
        canonicalProductName: "BLACK+DECKER dustbuster Cordless Handheld Vacuum",
        brand: "BLACK+DECKER",
        model: "CHV1410L",
        upc: "885911830997",
        storeDomain: "blackanddecker.com",
        opportunityScore: 68,
      },
      {
        candidateId: "cand_sony_3",
        title: "Sony WH-1000XM4 Wireless Noise Canceling Overhead Headphones",
        canonicalProductName: "Sony WH-1000XM4 Wireless Headphones",
        brand: "Sony",
        model: "WH1000XM4/B",
        upc: "027242930698",
        storeDomain: "electronics.sony.com",
        opportunityScore: 65,
      },
    ],
    topThree: [],
    researchShortlist: {
      shortlist: [
        {
          candidateId: "cand_chomchom_1",
          title: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller",
          canonicalProductName: "ChomChom Roller Pet Hair Remover",
          brand: "ChomChom Roller",
          model: "CC-ROLLER-01",
          upc: "856957004000",
          storeDomain: "chomchomroller.com",
          opportunityScore: 72,
        },
        {
          candidateId: "cand_blackdecker_2",
          title: "BLACK+DECKER dustbuster AdvancedClean Cordless Handheld Vacuum",
          canonicalProductName: "BLACK+DECKER dustbuster Cordless Handheld Vacuum",
          brand: "BLACK+DECKER",
          model: "CHV1410L",
          upc: "885911830997",
          storeDomain: "blackanddecker.com",
          opportunityScore: 68,
        },
        {
          candidateId: "cand_sony_3",
          title: "Sony WH-1000XM4 Wireless Noise Canceling Overhead Headphones",
          canonicalProductName: "Sony WH-1000XM4 Wireless Headphones",
          brand: "Sony",
          model: "WH1000XM4/B",
          upc: "027242930698",
          storeDomain: "electronics.sony.com",
          opportunityScore: 65,
        },
      ],
      qualifiedCount: 3,
      requestedCount: 3,
    },
    provisionalCandidates: [
      {
        rank: 1,
        candidate: {
          candidateId: "cand_chomchom_1",
          title: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller",
          canonicalProductName: "ChomChom Roller Pet Hair Remover",
          brand: "ChomChom Roller",
          model: "CC-ROLLER-01",
          upc: "856957004000",
          storeDomain: "chomchomroller.com",
        },
        score: {
          opportunityScore: 72,
          scoreStatus: "PROVISIONAL",
          tier: "PROVISIONAL",
          evidenceConfidence: 78,
        },
      },
    ],
    remainingCandidates: [],
    insufficientEvidenceCandidates: [],
  };
}

describe("KH-02 V12.4.3.5.1 — Walmart US Integration, Persistence, Fencing, Worker & API Suite", () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: WS_A },
      create: { id: WS_A, name: "Walmart Pilot Test Workspace Alpha" },
      update: { name: "Walmart Pilot Test Workspace Alpha" },
    });
    await prisma.workspace.upsert({
      where: { id: WS_B },
      create: { id: WS_B, name: "Walmart Pilot Test Workspace Beta" },
      update: { name: "Walmart Pilot Test Workspace Beta" },
    });
  });

  beforeEach(async () => {
    resetWalmartSharedHostGroupForTests();
    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [WS_A, WS_B] } },
    });
    await prisma.providerRequestLedger.deleteMany({
      where: { jobId: { startsWith: "run_walmart_v124351" } },
    });
    await prisma.syncJob.deleteMany({
      where: { workspaceId: { in: [WS_A, WS_B] } },
    });

    await prisma.syncJob.create({
      data: {
        id: RUN_A,
        workspaceId: WS_A,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        progress: 100,
        workerId: "worker_wmt_primary",
        claimToken: "claim_wmt_1",
        fencingToken: "fence_wmt_1",
        fencingGeneration: 1,
        recordVersion: 2,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        resultJson: JSON.stringify(buildParentSnapshot(RUN_A, WS_A)),
      },
    });
  });

  afterAll(async () => {
    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [WS_A, WS_B] } },
    });
    await prisma.providerRequestLedger.deleteMany({
      where: { jobId: { startsWith: "run_walmart_v124351" } },
    });
    await prisma.syncJob.deleteMany({
      where: { workspaceId: { in: [WS_A, WS_B] } },
    });
  });

  it("W33, W34, W35, W36, W37: Atomic persistence enforces workspace isolation, worker fencing tokens, surfaces write failures, and loads authoritative rows", async () => {
    const customFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/search?q=")) {
        return new Response(buildChomChomSearchJinaBody("ChomChom Roller Pet Hair Remover"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/ip/674275778")) {
        return new Response(buildChomChomPdpJinaBody(), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(buildBlackDeckerPdpJinaBody(), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const enrichment = await runWalmartUsPilotEnrichment({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      niche: "Pet Gadgets",
      enableWalmartUsPilot: true,
      shortlistedCandidates: [
        {
          candidateId: "cand_chomchom_1",
          title: "ChomChom Roller Pet Hair Remover",
          brand: "ChomChom Roller",
          model: "CC-ROLLER-01",
          upc: "856957004000",
        },
      ],
      env: {
        KH02_WALMART_US_ENABLED: "true",
        KH02_WALMART_US_LIVE_ALLOWED: "false",
      },
      customFetch,
      evidenceOrigin: "TEST_FIXTURE",
      db: prisma,
    });

    expect(enrichment.evidenceRows).toHaveLength(1);
    expect(enrichment.evidenceRows[0].itemId).toBe("674275778");
    expect(enrichment.evidenceRows[0].upc).toBe("856957004000");
    expect(enrichment.evidenceRows[0].evidenceOrigin).toBe("TEST_FIXTURE");

    // 1. Cross-workspace write attempt must be rejected
    const crossWsRes = await persistWalmartEvidenceAtomically({
      workspaceId: WS_B,
      researchRunId: RUN_A,
      evidenceRows: enrichment.evidenceRows,
      telemetry: enrichment.telemetry,
      db: prisma,
    });
    expect(crossWsRes.persisted).toBe(false);
    expect(crossWsRes.workspaceRejected).toBe(true);

    // 2. Stale fencing token / generation must be rejected
    const staleFenceRes = await persistWalmartEvidenceAtomically({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      evidenceRows: enrichment.evidenceRows,
      telemetry: enrichment.telemetry,
      expectedWorkerId: "worker_wmt_primary",
      expectedClaimToken: "claim_wmt_1",
      expectedFencingToken: "WRONG_FENCE_TOKEN",
      expectedFencingGeneration: 1,
      db: prisma,
    });
    expect(staleFenceRes.persisted).toBe(false);
    expect(staleFenceRes.fencingRejected).toBe(true);
    expect(staleFenceRes.errorCode).toBe("STALE_FENCING_TOKEN");

    // 3. Simulated transaction failure surfaces error without partial commit
    const failTxRes = await persistWalmartEvidenceAtomically({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      evidenceRows: enrichment.evidenceRows,
      telemetry: enrichment.telemetry,
      injectTransactionFailureForTest: true,
      db: prisma,
    });
    expect(failTxRes.persisted).toBe(false);
    expect(failTxRes.errorCode).toBe("WALMART_EVIDENCE_PERSISTENCE_FAILED");

    // 4. Valid persistence commits both ResearchEvidence and SyncJob.resultJson
    const validPersist = await persistWalmartEvidenceAtomically({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      evidenceRows: enrichment.evidenceRows,
      telemetry: enrichment.telemetry,
      expectedWorkerId: "worker_wmt_primary",
      expectedClaimToken: "claim_wmt_1",
      expectedFencingToken: "fence_wmt_1",
      expectedFencingGeneration: 1,
      db: prisma,
    });
    expect(validPersist.persisted).toBe(true);
    expect(validPersist.persistedCount).toBe(1);

    const loaded = await loadWalmartEvidenceForRun(WS_A, RUN_A, prisma);
    expect(loaded.source).toBe("RESEARCH_EVIDENCE_TABLE");
    expect(loaded.evidenceRows).toHaveLength(1);
    expect(loaded.evidenceRows[0].upc).toBe("856957004000");
    expect(loaded.telemetry?.persistenceStatus).toBe("PERSISTED");
  });

  it("W49: Stale cache preservation retains prior verified live observation when a subsequent check fails with TIMED_OUT or RATE_LIMITED", async () => {
    const priorVerifiedRow: any = {
      id: computeWalmartEvidenceCompositeId(
        WS_A,
        RUN_A,
        "cand_sony_3",
        "16504921979",
        "v1"
      ),
      workspaceId: WS_A,
      researchRunId: RUN_A,
      candidateId: "cand_sony_3",
      provider: "WALMART_US",
      itemId: "16504921979",
      canonicalProductUrl: "https://www.walmart.com/ip/16504921979",
      sourceUrl: "https://www.walmart.com/ip/16504921979",
      finalUrl: "https://www.walmart.com/ip/16504921979",
      title: "Sony WH-1000XM4 Wireless Headphones",
      brand: "Sony",
      model: "WH1000XM4/B",
      upc: "027242930698",
      price: 348.0,
      currency: "USD",
      seller: "Walmart.com",
      locationPostalCode: "95829",
      locationStoreIds: ["3081"],
      availability: "IN_STOCK",
      queryStatus: "SUCCEEDED",
      presence: "FOUND",
      matchLevel: "EXACT",
      verifiedIdentity: true,
      matchReasons: ["UPC_EXACT_MATCH:027242930698"],
      rejectionReasons: [],
      missingFields: [],
      appearanceProvenance: ["PDP_VERIFIED"],
      schemaCompatibility: "EXACT_BASELINE",
      schemaFieldPaths: ["props.pageProps.initialData.data.product"],
      evidenceOrigin: "REAL_JINA_READER",
      isCached: false,
      isStale: false,
      requestedNoCache: true,
      observedCacheMetadata: null,
      requestHash: "h1",
      responseHash: "h2",
      rawEvidenceHash: "a".repeat(64),
      extractedFieldsHash: "b".repeat(64),
      localRequestRef: "ref_1",
      upstreamRequestId: null,
      lastAttemptAt: "2026-10-30T10:00:00.000Z",
      observedAt: "2026-10-30T10:00:00.000Z",
      lastSuccessfulLiveQueryAt: "2026-10-30T10:00:00.000Z",
      queryScope: {
        query: "Sony WH-1000XM4",
        normalizedQuery: "sony wh 1000xm4",
        market: "US",
        checkedSearchCount: 1,
        checkedPdpCount: 1,
        rawSearchResultCount: 1,
        dedupedSearchResultCount: 1,
        completeSearchScope: true,
      },
      nonInflationNotice: "Notice",
    };

    // Persist initial verified row
    await persistWalmartEvidenceAtomically({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      evidenceRows: [priorVerifiedRow],
      telemetry: { overallStatus: "SUCCEEDED" } as any,
      db: prisma,
    });

    // Now persist a failed/timed-out attempt for the same candidate
    const failedCurrentRow: any = {
      ...priorVerifiedRow,
      itemId: null,
      upc: null,
      price: null,
      queryStatus: "TIMED_OUT",
      presence: "UNKNOWN",
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      lastAttemptAt: "2026-11-01T06:00:00.000Z",
      observedAt: null,
      rejectionReasons: ["JINA_HTTP_TIMEOUT"],
    };

    await persistWalmartEvidenceAtomically({
      workspaceId: WS_A,
      researchRunId: RUN_A,
      evidenceRows: [failedCurrentRow],
      telemetry: { overallStatus: "TIMED_OUT" } as any,
      db: prisma,
    });

    const loaded = await loadWalmartEvidenceForRun(WS_A, RUN_A, prisma);
    const mergedSony = loaded.evidenceRows.find((r) => r.candidateId === "cand_sony_3");
    expect(mergedSony).toBeDefined();
    expect(mergedSony?.queryStatus).toBe("TIMED_OUT");
    expect(mergedSony?.presence).toBe("UNKNOWN");
    expect(mergedSony?.isCached).toBe(true);
    expect(mergedSony?.isStale).toBe(true);
    // Preserves prior verified UPC (with leading zero!) and old observedAt
    expect(mergedSony?.upc).toBe("027242930698");
    expect(mergedSony?.observedAt).toBe("2026-10-30T10:00:00.000Z");
    expect(mergedSony?.lastSuccessfulLiveQueryAt).toBe("2026-10-30T10:00:00.000Z");
    expect(mergedSony?.lastAttemptAt).toBe("2026-11-01T06:00:00.000Z");
  });

  it("W42, W43, W44, W45: GET /api/v1/kh02/marketplace/walmart is strictly read-only; POST enqueues KH02_WALMART_VERIFY child job and worker processes it", async () => {
    const ledgerBefore = await prisma.providerRequestLedger.count();
    const syncJobsBefore = await prisma.syncJob.count({ where: { workspaceId: WS_A } });

    // 1. Read-only GET on RUN_A
    const getReq = new NextRequest(
      `http://localhost:3000/api/v1/kh02/marketplace/walmart?runId=${RUN_A}&workspaceId=${WS_A}`
    );
    const getRes = await getWalmartMarketplaceRoute(getReq);
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.success).toBe(true);
    expect(getJson.data.provider).toBe("WALMART_US");
    expect(getJson.data.workspaceId).toBe(WS_A);

    const ledgerAfter = await prisma.providerRequestLedger.count();
    const syncJobsAfter = await prisma.syncJob.count({ where: { workspaceId: WS_A } });
    expect(ledgerAfter).toBe(ledgerBefore);
    expect(syncJobsAfter).toBe(syncJobsBefore);

    // 2. Cross-workspace GET must return 403
    const crossGetReq = new NextRequest(
      `http://localhost:3000/api/v1/kh02/marketplace/walmart?runId=${RUN_A}&workspaceId=${WS_B}`
    );
    const crossGetRes = await getWalmartMarketplaceRoute(crossGetReq);
    expect(crossGetRes.status).toBe(403);

    // 3. POST when KH02_WALMART_US_ENABLED=false must return 403 WALMART_PILOT_DISABLED
    const prevEnabled = process.env.KH02_WALMART_US_ENABLED;
    process.env.KH02_WALMART_US_ENABLED = "false";
    try {
      const postDisabledReq = new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/walmart?workspaceId=${WS_A}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: RUN_A,
            candidateIds: ["cand_chomchom_1"],
          }),
        }
      );
      const postDisabledRes = await postWalmartMarketplaceRoute(postDisabledReq);
      expect(postDisabledRes.status).toBe(403);
    } finally {
      process.env.KH02_WALMART_US_ENABLED = prevEnabled;
    }

    // 4. Enable KH02_WALMART_US_ENABLED=true (liveAllowed=false) and enqueue child job via POST
    process.env.KH02_WALMART_US_ENABLED = "true";
    process.env.KH02_WALMART_US_LIVE_ALLOWED = "false";
    try {
      const postEnabledReq = new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/walmart?workspaceId=${WS_A}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: RUN_A,
            candidateIds: ["cand_chomchom_1"],
            candidateItemIds: { cand_chomchom_1: "674275778" },
          }),
        }
      );
      const postEnabledRes = await postWalmartMarketplaceRoute(postEnabledReq);
      expect(postEnabledRes.status).toBe(202);
      const postJson = await postEnabledRes.json();
      expect(postJson.success).toBe(true);
      expect(postJson.data.jobType).toBe("KH02_WALMART_VERIFY");

      // Claim and execute child job via worker
      const claimed = await claimNextResearchJob("worker_wmt_child", prisma, {
        jobId: postJson.data.verifyJobId,
        jobTypes: ["KH02_WALMART_VERIFY"],
      });
      expect(claimed).not.toBeNull();
      const execRes = await executeResearchJob(claimed!, prisma);
      expect(execRes.success).toBe(true);
    } finally {
      process.env.KH02_WALMART_US_ENABLED = prevEnabled;
    }
  });

  it("W56 & W57: Multi-worker shared rate budget enforces <=6 requests/60s via SQLite ProviderRequestLedger and partial run resilience preserves succeeded PDPs when another PDP times out", async () => {
    const runRateId = "run_walmart_v124351_ratecap";
    const nowBase = Date.now();

    // Seed 6 requests within the last 10 seconds in ProviderRequestLedger
    for (let i = 1; i <= 6; i++) {
      await prisma.providerRequestLedger.create({
        data: {
          providerId: "WALMART_JINA_READER_US",
          jobId: `${runRateId}_${i}`,
          requestedAt: new Date(nowBase - 5_000 + i * 100),
          outcome: "RESERVED_RATE_SLOT",
          httpStatus: null,
          requestDurationMs: 0,
          errorCategory: null,
          creditUnit: "FREE_JINA_READER",
        },
      });
    }

    // A 7th request from a new worker instance sharing the DB with a short deadline must be DEFERRED
    const worker2Budget = createWalmartProviderBudget({
      workspaceId: WS_A,
      researchRunId: runRateId,
      providerGroupKey: "worker_2_separate_group",
      db: prisma,
      limits: {
        maxConcurrentOperationsPerProviderGroup: 1,
        maxLogicalOperationsPerRun: 4,
        maxAttemptsPerOperation: 2,
        maxNetworkAttemptsPerRun: 8,
        maxRequestsPerMinuteAcrossWorkers: 6,
        rollingWindowMs: 60_000,
        httpTimeoutMs: 5_000,
        minRetryBackoffMs: 100,
        maxOperationDeadlineMs: 1_000, // 1s deadline < 55s remaining in 60s window
        maxResponseBytes: 8 * 1024 * 1024,
        maxNextDataBytes: 4 * 1024 * 1024,
      },
    });

    const op = reserveWalmartOperation(worker2Budget, {
      operationKind: "SEARCH",
      candidateId: "cand_1",
      targetKey: "Pet Gadgets",
      operationDeadlineMs: 1_000,
    });
    reserveWalmartNetworkAttempt(worker2Budget, op.logicalOperationId!);

    const slot7 = await awaitWalmartRateSlot(worker2Budget, {
      logicalOperationId: op.logicalOperationId!,
      attemptNumber: 1,
    });
    expect(slot7.permitted).toBe(false);
    expect(slot7.status).toBe("DEFERRED");

    // W57: Partial run resilience — Candidate 1 succeeds (Search + PDP), Candidate 2 times out
    resetWalmartSharedHostGroupForTests();
    const partialFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("ChomChom")) {
        return new Response(buildChomChomSearchJinaBody("ChomChom Roller Pet Hair Remover"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/ip/674275778")) {
        return new Response(buildChomChomPdpJinaBody(), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Candidate 2 search returns 504 on both attempts
      return new Response("Upstream Timeout", { status: 504 });
    };

    const partialRun = await runWalmartUsPilotEnrichment({
      workspaceId: WS_A,
      researchRunId: "run_walmart_v124351_partial",
      niche: "Pet Gadgets",
      enableWalmartUsPilot: true,
      shortlistedCandidates: [
        {
          candidateId: "cand_chomchom_1",
          title: "ChomChom Roller Pet Hair Remover",
          brand: "ChomChom Roller",
          model: "CC-ROLLER-01",
          upc: "856957004000",
        },
        {
          candidateId: "cand_blackdecker_2",
          title: "BLACK+DECKER dustbuster Handheld Vacuum",
          brand: "BLACK+DECKER",
          model: "CHV1410L",
          upc: "885911830997",
        },
      ],
      env: {
        KH02_WALMART_US_ENABLED: "true",
        KH02_WALMART_US_LIVE_ALLOWED: "false",
      },
      limitsOverride: {
        minRetryBackoffMs: 10,
      },
      customFetch: partialFetch,
      evidenceOrigin: "TEST_FIXTURE",
    });

    expect(partialRun.telemetry.overallStatus).toBe("PARTIAL");
    const chomRow = partialRun.evidenceRows.find((r) => r.candidateId === "cand_chomchom_1");
    const bdRow = partialRun.evidenceRows.find((r) => r.candidateId === "cand_blackdecker_2");
    expect(chomRow?.queryStatus).toBe("SUCCEEDED");
    expect(chomRow?.presence).toBe("FOUND");
    expect(chomRow?.verifiedIdentity).toBe(true);
    expect(bdRow?.queryStatus).toBe("UNAVAILABLE");
    expect(bdRow?.presence).toBe("UNKNOWN");
  });

  it("W38, W39, W40, W41, W51: Orchestrator non-vacuous score non-inflation (>=3 candidates), source independence, and point-in-time backtest anti-leakage", async () => {
    const { proveWalmartNonInflationWithCandidates } = await import(
      "@/services/kh02/marketplace/walmartNonInflationProof"
    );

    const proof = await proveWalmartNonInflationWithCandidates({
      workspacePrefix: "ws_wmt_test_noninf",
    });

    expect(proof.comparedCandidatesCount).toBeGreaterThanOrEqual(3);
    expect(proof.candidateSetMatch).toBe(true);
    expect(proof.providerPathExercised).toBe(true);
    expect(proof.walmartEvidenceRowsExercised).toBeGreaterThanOrEqual(2);
    expect(proof.scoreDeltaAbsMax).toBe(0);
    expect(proof.confidenceDeltaAbsMax).toBe(0);
    expect(proof.rankingChanged).toBe(false);
    expect(proof.gateChanges).toBe(0);
    expect(proof.g15PromotedCount).toBe(0);
    expect(proof.g16PromotedCount).toBe(0);
    expect(proof.nonInflationVerified).toBe(true);

    // Verify per-candidate diffs are matched by stable candidateId and have 0 score/confidence/rank delta
    for (const d of proof.perCandidateDiffs) {
      expect(d.scoreDelta).toBe(0);
      expect(d.confidenceDelta).toBe(0);
      expect(d.rankDelta).toBe(0);
      expect(d.orderIndexDelta).toBe(0);
      expect(d.tierOff).toBe(d.tierOn);
      expect(d.recommendationOff).toBe(d.recommendationOn);
      expect(d.demandStabilityStatusOff).toBe(d.demandStabilityStatusOn);
      expect(d.evergreenEligibleOff).toBe(d.evergreenEligibleOn);
      expect(d.g15StatusOff).toBe(d.g15StatusOn);
      expect(d.g16StatusOff).toBe(d.g16StatusOn);
    }

    // W51: Point-in-time backtest anti-leakage filter rejects post-T0, missing-timestamp, and fixture Walmart observations
    const t0 = "2026-10-30T12:00:00.000Z";
    const baseRow = {
      id: "wmt_pit_1",
      workspaceId: WS_A,
      researchRunId: "run_wmt_pit",
      candidateId: "cand_1",
      provider: "WALMART_US" as const,
      itemId: "674275778",
      canonicalProductUrl: "https://www.walmart.com/ip/674275778",
      sourceUrl: "https://r.jina.ai/https://www.walmart.com/ip/674275778",
      finalUrl: "https://www.walmart.com/ip/674275778",
      title: "ChomChom Roller",
      brand: "ChomChom Roller",
      model: "CC-ROLLER-01",
      upc: "856957004000",
      price: 24.99,
      currency: "USD",
      seller: "Walmart.com",
      locationPostalCode: "95829",
      locationStoreIds: ["3081"],
      availability: "IN_STOCK" as const,
      queryStatus: "SUCCEEDED" as const,
      presence: "FOUND" as const,
      matchLevel: "EXACT" as const,
      verifiedIdentity: true,
      matchReasons: ["EXACT_GTIN_UPC_MATCH"],
      rejectionReasons: [],
      missingFields: [],
      appearanceProvenance: ["ORGANIC" as const],
      schemaCompatibility: "OBSERVED_BASELINE_SCHEMA" as const,
      schemaFieldPaths: ["props.pageProps.initialData.data.product"],
      evidenceOrigin: "TEST_FIXTURE" as const,
      isCached: false,
      isStale: false,
      requestedNoCache: true,
      observedCacheMetadata: null,
      requestHash: "req_1",
      responseHash: "res_1",
      rawEvidenceHash: "raw_1",
      extractedFieldsHash: "ext_1",
      localRequestRef: "ref_1",
      upstreamRequestId: null,
      lastAttemptAt: "2026-10-30T11:00:00.000Z",
      observedAt: "2026-10-30T11:00:00.000Z",
      lastSuccessfulLiveQueryAt: null,
      queryScope: {
        query: "ChomChom Roller",
        normalizedQuery: "ChomChom Roller",
        market: "US" as const,
        checkedSearchCount: 1,
        checkedPdpCount: 1,
        rawSearchResultCount: 1,
        dedupedSearchResultCount: 1,
        completeSearchScope: true,
      },
      nonInflationNotice: "Notice",
    };

    const pitAudit = filterWalmartEvidencePointInTime(
      [
        {
          ...baseRow,
          id: "pre_t0",
          evidenceOrigin: "REAL_JINA_READER",
          observedAt: "2026-10-30T11:00:00.000Z",
          lastAttemptAt: "2026-10-30T11:00:00.000Z",
        },
        {
          ...baseRow,
          id: "post_t0_leak",
          evidenceOrigin: "REAL_JINA_READER",
          observedAt: "2026-10-31T00:00:00.000Z",
          lastAttemptAt: "2026-10-31T00:00:00.000Z",
        },
        {
          ...baseRow,
          id: "missing_ts_leak",
          evidenceOrigin: "REAL_JINA_READER",
          observedAt: null,
          lastAttemptAt: null,
        },
        {
          ...baseRow,
          id: "fixture_leak",
          evidenceOrigin: "TEST_FIXTURE",
          observedAt: "2026-10-30T10:00:00.000Z",
          lastAttemptAt: "2026-10-30T10:00:00.000Z",
        },
      ],
      t0
    );
    expect(pitAudit.retainedRows).toHaveLength(1);
    expect(pitAudit.retainedRows[0].id).toBe("pre_t0");
    expect(pitAudit.futureLeaksRejectedCount).toBe(1);
    expect(pitAudit.missingTimestampRejectedCount).toBe(1);
    expect(pitAudit.fixtureRecordsRejectedCount).toBe(1);
    expect(pitAudit.zeroLeakCount).toBe(true);
  });
});
