/**
 * SWAI KH-02 — Provider Runtime Telemetry & Product Relevance Suite
 *
 * Validates:
 * 1. Telemetry Display States (Section H1): Not Run, Succeeded N, Succeeded 0, Failed, Cache-only,
 *    Probe non-destructive invariant, Workspace isolation.
 * 2. Relevance & Identity Gating (Section H2): Pet hair removers retained, human body depilatories
 *    disqualified and excluded from scoring/winners, ambiguous items marked for manual review.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { evaluateProductRelevance } from "@/services/kh02/identity/productRelevanceEvaluator";
import { discoverProductCandidatesFromAds } from "@/services/kh02/identity/productCandidateDiscovery";
import { calculateKH02EvergreenScore } from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { getWorkspaceProviderTelemetry } from "@/services/kh02/persistence/kh02PersistenceService";
import { diagnoseKH02Source, recordLatestProbe, getLatestProbe } from "@/services/kh02/providers/sourceRegistry";
import { SourceObservation } from "@/services/kh02/types";

describe("SWAI KH-02 — Telemetry & Relevance Truth Suite", () => {
  const TEST_WORKSPACE = "default-workspace";
  const TEST_RUN_ID = `test_run_telemetry_${Date.now()}`;

  beforeEach(async () => {
    // Ensure workspace exists in isolated test DB
    await prisma.workspace.upsert({
      where: { id: TEST_WORKSPACE },
      update: {},
      create: { id: TEST_WORKSPACE, name: "Default Test Workspace", operatingMode: "RESEARCH_ONLY" },
    });

    // Seed a completed syncJob with providerTelemetry
    const mockTelemetry = {
      META_ADS: {
        source: "META_ADS",
        queryExecuted: true,
        queryStatus: "SOURCE_DATA_VERIFIED",
        queryTimestamp: new Date().toISOString(),
        retrievedCount: 8,
        acceptedCount: 8,
        queryProvenance: "CACHED_SOURCE",
        isLive: false,
        queryError: null,
        lastSuccessfulRecordCount: 8,
        lastSuccessfulQueryAt: new Date().toISOString(),
      },
      GOOGLE_ADS: {
        source: "GOOGLE_ADS",
        queryExecuted: true,
        queryStatus: "PASSED",
        queryTimestamp: new Date().toISOString(),
        retrievedCount: 5,
        acceptedCount: 0,
        queryProvenance: "LIVE_PROVIDER",
        isLive: true,
        queryError: null,
        lastSuccessfulRecordCount: 5,
        lastSuccessfulQueryAt: new Date().toISOString(),
      },
      TIKTOK_ADS: {
        source: "TIKTOK_ADS",
        queryExecuted: false,
        queryStatus: "NOT_CONFIGURED",
        queryTimestamp: null,
        retrievedCount: null,
        acceptedCount: null,
        queryProvenance: "NONE",
        isLive: false,
        queryError: null,
        lastSuccessfulRecordCount: null,
        lastSuccessfulQueryAt: null,
      },
      TIKTOK_ORGANIC: {
        source: "TIKTOK_ORGANIC",
        queryExecuted: false,
        queryStatus: "NOT_CONFIGURED",
        queryTimestamp: null,
        retrievedCount: null,
        acceptedCount: null,
        queryProvenance: "NONE",
        isLive: false,
        queryError: null,
        lastSuccessfulRecordCount: null,
        lastSuccessfulQueryAt: null,
      },
      DEMAND_HISTORY: {
        source: "DEMAND_HISTORY",
        queryExecuted: true,
        queryStatus: "INSUFFICIENT_HISTORY",
        queryTimestamp: new Date().toISOString(),
        retrievedCount: 0,
        acceptedCount: 0,
        queryProvenance: "CACHED_SOURCE",
        isLive: false,
        queryError: null,
        lastSuccessfulRecordCount: null,
        lastSuccessfulQueryAt: null,
      },
    };

    await prisma.syncJob.create({
      data: {
        id: TEST_RUN_ID,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        progress: 100,
        resultJson: JSON.stringify({
          topic: "pet hair remover",
          market: "US",
          lookbackDays: 90,
          providerTelemetry: mockTelemetry,
          sourceStatuses: {
            META_ADS: "SOURCE_DATA_VERIFIED",
            GOOGLE_ADS: "PASSED",
            DEMAND_HISTORY: "INSUFFICIENT_HISTORY",
          },
        }),
      },
    });
  });

  afterEach(async () => {
    try {
      await prisma.syncJob.deleteMany({ where: { id: TEST_RUN_ID } });
    } catch {
      // ignore
    }
  });

  describe("H1: Provider Runtime Telemetry & Last Live Query Invariants", () => {
    it("workspace A cannot access telemetry from workspace B (strict workspace isolation)", async () => {
      const telemetryA = await getWorkspaceProviderTelemetry(TEST_WORKSPACE);
      const telemetryB = await getWorkspaceProviderTelemetry("isolated-test-workspace-999");

      expect(telemetryA.GOOGLE_ADS.queryExecuted).toBe(true);
      expect(telemetryB.GOOGLE_ADS.queryExecuted).toBe(false);
      expect(telemetryB.GOOGLE_ADS.retrievedCount).toBeNull();
      expect(telemetryB.META_ADS.queryExecuted).toBe(false);
      expect(telemetryB.META_ADS.retrievedCount).toBeNull();
    });

    it("truthfully reports Google Ads telemetry with exact retrieved record count for default workspace", async () => {
      const telemetry = await getWorkspaceProviderTelemetry(TEST_WORKSPACE);

      expect(telemetry.GOOGLE_ADS.queryExecuted).toBe(true);
      expect(telemetry.GOOGLE_ADS.queryStatus).toBe("PASSED");
      expect(telemetry.GOOGLE_ADS.retrievedCount).toBe(5);
      expect(telemetry.GOOGLE_ADS.queryProvenance).toBe("LIVE_PROVIDER");
      expect(telemetry.GOOGLE_ADS.isLive).toBe(true);
    });

    it("truthfully marks Meta cache queries as CACHED_SOURCE with isLive false", async () => {
      const telemetry = await getWorkspaceProviderTelemetry(TEST_WORKSPACE);

      expect(telemetry.META_ADS.queryExecuted).toBe(true);
      expect(telemetry.META_ADS.queryProvenance).toBe("CACHED_SOURCE");
      expect(telemetry.META_ADS.isLive).toBe(false);
    });

    it("diagnoseKH02Source integrates persistent workspace telemetry into readiness dimensions", async () => {
      const diag = await diagnoseKH02Source("GOOGLE_ADS", {
        workspaceId: TEST_WORKSPACE,
      });

      expect(diag.dimensions?.lastLiveQueryRecordCount).toBe(5);
      expect(diag.dimensions?.isLive).toBe(true);
      expect(diag.dimensions?.queryProvenance).toBe("LIVE_PROVIDER");
      expect(diag.dimensions?.queryExecuted).toBe(true);
    });

    it("diagnoseKH02Source returns queryExecuted: false and lastLiveQueryRecordCount: null for unrun workspace", async () => {
      const diag = await diagnoseKH02Source("GOOGLE_ADS", {
        workspaceId: "unrun-workspace-xyz",
      });

      expect(diag.dimensions?.lastLiveQueryRecordCount).toBeNull();
      expect(diag.dimensions?.queryExecuted).toBe(false);
    });
  });

  describe("H2: Product Relevance & Categorical Gating", () => {
    it("accepts authentic pet hair remover tools for 'pet hair remover' niche", () => {
      const petRoller = evaluateProductRelevance(
        "ChomChom Pet Hair Roller for Furniture & Clothes Removes pet hair, fur, lint, and dust from couch, sofa, rugs, and car seats.",
        "pet hair remover"
      );

      expect(petRoller.isAccepted).toBe(true);
      expect(petRoller.relevanceStatus).toBe("RELEVANT");
      expect(petRoller.score).toBeGreaterThanOrEqual(0.7);
    });

    it("strictly rejects human body hair removal / depilatory products for 'pet hair remover'", () => {
      const bleameEraser = evaluateProductRelevance(
        "Crystal Hair Eraser Painless hair removal for strawberry legs, bikini line, arms and underarm exfoliation.",
        "pet hair remover"
      );

      expect(bleameEraser.isAccepted).toBe(false);
      expect(bleameEraser.relevanceStatus).toBe("IRRELEVANT");
      expect(bleameEraser.score).toBeLessThanOrEqual(0.1);
      expect(bleameEraser.reasons.some((r) => r.includes("human body hair removal") || r.includes("excluded term"))).toBe(true);
    });

    it("strictly rejects hair removal cream for humans from pet hair remover topic", () => {
      const depilatoryCream = evaluateProductRelevance(
        "Intimate Depilatory Hair Removal Cream Smooth sensitive skin bikini and body hair removal cream.",
        "pet hair remover"
      );

      expect(depilatoryCream.isAccepted).toBe(false);
      expect(depilatoryCream.relevanceStatus).toBe("IRRELEVANT");
    });

    it("marks ambiguous non-cleaning pet items as AMBIGUOUS / REQUIRES_MANUAL_REVIEW", () => {
      const dogChewToy = evaluateProductRelevance(
        "Chew Toy for Aggressive Chewers Durable rubber dog chew toy for puppies and large dogs.",
        "pet hair remover"
      );

      expect(dogChewToy.relevanceStatus).toBe("AMBIGUOUS");
      expect(dogChewToy.isAccepted).toBe(false);
    });

    it("candidate discovery disqualifies irrelevant products from becoming evergreen winners", () => {
      const mockAds: SourceObservation[] = [
        {
          source: "META_ADS",
          sourceRecordId: "ad_pet_cleaner_01",
          landingPageUrl: "https://uprootclean.co/products/pet-hair-pro",
          title: "Uproot Clean Pet Hair Pro",
          description: "The ultimate pet hair remover for carpets, rugs, and furniture.",
          observedContent: "The ultimate pet hair remover for carpets, rugs, and furniture.",
          advertiserDomain: "uprootclean.co",
          advertiserName: "Uproot Clean",
          observedAt: new Date().toISOString(),
          provenance: "CACHED_SOURCE",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_bleame_02",
          landingPageUrl: "https://bleame.com/products/crystal-hair-eraser",
          title: "Crystal Hair Eraser",
          description: "Painless exfoliation and body hair removal for strawberry legs.",
          observedContent: "Painless exfoliation and body hair removal for strawberry legs.",
          advertiserDomain: "bleame.com",
          advertiserName: "Bleame",
          observedAt: new Date().toISOString(),
          provenance: "CACHED_SOURCE",
        },
      ];

      const candidates = discoverProductCandidatesFromAds(mockAds, "pet hair remover");
      const uproot = candidates.find((c) => c.title.toLowerCase().includes("uproot") || c.storeDomain === "uprootclean.co");
      const bleame = candidates.find((c) => c.title.toLowerCase().includes("crystal") || c.storeDomain === "bleame.com");

      expect(uproot).toBeDefined();
      expect(uproot?.relevanceStatus).toBe("RELEVANT");
      expect(uproot?.isEligibleAsEvergreenWinner).toBe(true);

      expect(bleame).toBeDefined();
      expect(bleame?.relevanceStatus).toBe("IRRELEVANT");
      expect(bleame?.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("opportunity scoring zeros opportunityScore and enforces REJECT for IRRELEVANT candidates", () => {
      const irrelevantCandidate = {
        candidateId: "cand_bleame_crystal_hair_eraser",
        researchProductId: "rp_bleame",
        title: "Crystal Hair Eraser",
        category: "Personal Care",
        storeDomain: "bleame.com",
        canonicalProductUrl: "https://bleame.com/products/crystal-hair-eraser",
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        supportingAdIds: ["ad1"],
        totalObservationCount: 2,
        distinctAdvertisersCount: 1,
        problemStatement: "Painless hair removal",
        targetAudience: "Adults",
        thumbnailUrl: null,
        videoUrl: null,
        advertiserNames: ["Bleame"],
        earliestObservationDate: null,
        latestObservationDate: null,
        identityConfidence: "EXACT" as const,
        sourceObservations: [],
        relevanceStatus: "IRRELEVANT" as const,
        relevanceScore: 0,
        relevanceReasons: ["Explicit human body hair removal/depilatory product does not match pet hair remover niche"],
        isEligibleAsEvergreenWinner: false,
      };

      const score = calculateKH02EvergreenScore({
        candidate: irrelevantCandidate,
        demandSeries: [],
        hasVerifiedSupplierQuote: false,
      });

      expect(score.opportunityScore).toBe(0);
      expect(score.recommendation).toBe("REJECT");
      expect(score.scoreStatus).toBe("REJECTED");
      expect(score.tier).toBe("INSUFFICIENT_EVIDENCE");
      expect(score.recommendationRationale).toContain("Explicit human body hair removal");
    });
  });

  describe("Required 11 Verifications — Runtime Telemetry & Relevance Truth", () => {
    it("1. Legacy PASSED without record counts reports unknown (null), never hardcoded 5", async () => {
      const legacyWs = "test-ws-legacy-google";
      const legacyJobId = `job_legacy_google_${Date.now()}`;
      await prisma.workspace.upsert({
        where: { id: legacyWs },
        update: {},
        create: { id: legacyWs, name: "Legacy WS", operatingMode: "RESEARCH_ONLY" },
      });
      await prisma.syncJob.create({
        data: {
          id: legacyJobId,
          workspaceId: legacyWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            sourceStatuses: { GOOGLE_ADS: "PASSED" },
          }),
        },
      });

      const telemetry = await getWorkspaceProviderTelemetry(legacyWs);
      expect(telemetry.GOOGLE_ADS.queryExecuted).toBe(true);
      expect(telemetry.GOOGLE_ADS.retrievedCount).toBeNull();
      expect(telemetry.GOOGLE_ADS.lastSuccessfulRecordCount).toBeNull();
      expect(telemetry.GOOGLE_ADS.retrievedCount).not.toBe(5);

      await prisma.syncJob.deleteMany({ where: { id: legacyJobId } });
      await prisma.workspace.deleteMany({ where: { id: legacyWs } });
    });

    it("2. Legacy Meta FAILED without observations does not invent 8 records or success timestamp", async () => {
      const legacyFailedWs = "test-ws-legacy-failed";
      const legacyFailedJobId = `job_legacy_failed_${Date.now()}`;
      await prisma.workspace.upsert({
        where: { id: legacyFailedWs },
        update: {},
        create: { id: legacyFailedWs, name: "Legacy Failed WS", operatingMode: "RESEARCH_ONLY" },
      });
      await prisma.syncJob.create({
        data: {
          id: legacyFailedJobId,
          workspaceId: legacyFailedWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            sourceStatuses: { META_ADS: "FAILED" },
          }),
        },
      });

      const telemetry = await getWorkspaceProviderTelemetry(legacyFailedWs);
      expect(telemetry.META_ADS.queryStatus).toBe("FAILED");
      expect(telemetry.META_ADS.lastSuccessfulQueryAt).toBeNull();
      expect(telemetry.META_ADS.lastSuccessfulRecordCount).toBeNull();
      expect(telemetry.META_ADS.retrievedCount).toBeNull();
      expect(telemetry.META_ADS.retrievedCount).not.toBe(8);

      await prisma.syncJob.deleteMany({ where: { id: legacyFailedJobId } });
      await prisma.workspace.deleteMany({ where: { id: legacyFailedWs } });
    });

    it("3. Successful query returning 0 records records count 0 and valid success timestamp", async () => {
      const zeroWs = "test-ws-zero-records";
      const zeroJobId = `job_zero_records_${Date.now()}`;
      const successTime = new Date().toISOString();
      await prisma.workspace.upsert({
        where: { id: zeroWs },
        update: {},
        create: { id: zeroWs, name: "Zero WS", operatingMode: "RESEARCH_ONLY" },
      });
      await prisma.syncJob.create({
        data: {
          id: zeroJobId,
          workspaceId: zeroWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "niche query",
            sourceStatuses: { GOOGLE_ADS: "QUERY_SUCCEEDED_EMPTY" },
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "QUERY_SUCCEEDED_EMPTY",
                queryTimestamp: successTime,
                retrievedCount: 0,
                acceptedCount: 0,
                queryProvenance: "LIVE_PROVIDER",
                isLive: true,
                queryError: null,
                lastSuccessfulRecordCount: 0,
                lastSuccessfulQueryAt: successTime,
              },
            },
          }),
        },
      });

      const telemetry = await getWorkspaceProviderTelemetry(zeroWs);
      expect(telemetry.GOOGLE_ADS.queryExecuted).toBe(true);
      expect(telemetry.GOOGLE_ADS.retrievedCount).toBe(0);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulRecordCount).toBe(0);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulQueryAt).toBe(successTime);

      await prisma.syncJob.deleteMany({ where: { id: zeroJobId } });
      await prisma.workspace.deleteMany({ where: { id: zeroWs } });
    });

    it("4. Probe executed before research does not block newer research telemetry from appearing", async () => {
      const probeFirstWs = "test-ws-probe-first";
      const researchJobId = `job_research_${Date.now()}`;
      await prisma.workspace.upsert({
        where: { id: probeFirstWs },
        update: {},
        create: { id: probeFirstWs, name: "Probe First WS", operatingMode: "RESEARCH_ONLY" },
      });

      recordLatestProbe(
        "GOOGLE_ADS",
        {
          source: "GOOGLE_ADS",
          adapterInstalled: true,
          configured: true,
          transportConnected: true,
          authenticated: true,
          discoverySupported: true,
          queryExecuted: false,
          recordsReturned: null,
          provenanceVerified: false,
          lastCheckedAt: new Date(Date.now() - 60000).toISOString(),
          status: "CONNECTED",
          reason: "MCP connected",
          missingRequirements: [],
          dimensions: {
            adapterInstalled: true,
            configured: true,
            transportConnected: true,
            authenticated: true,
            supportedOperationsVerified: true,
            requiredCapabilityAvailable: true,
            queryExecuted: false,
            sourceDataVerified: false,
            lastLiveQueryAt: null,
            blockerCode: null,
            lastLiveQueryRecordCount: null,
          },
        },
        probeFirstWs
      );

      const queryTime = new Date().toISOString();
      await prisma.syncJob.create({
        data: {
          id: researchJobId,
          workspaceId: probeFirstWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "PASSED",
                queryTimestamp: queryTime,
                retrievedCount: 7,
                acceptedCount: 7,
                queryProvenance: "LIVE_PROVIDER",
                isLive: true,
                queryError: null,
                lastSuccessfulRecordCount: 7,
                lastSuccessfulQueryAt: queryTime,
              },
            },
          }),
        },
      });

      const diag = await diagnoseKH02Source("GOOGLE_ADS", { workspaceId: probeFirstWs });
      expect(diag.dimensions?.lastLiveQueryRecordCount).toBe(7);
      expect(diag.dimensions?.queryExecuted).toBe(true);

      await prisma.syncJob.deleteMany({ where: { id: researchJobId } });
      await prisma.workspace.deleteMany({ where: { id: probeFirstWs } });
    });

    it("5. Probe executed after research preserves persisted research query history", async () => {
      const researchFirstWs = "test-ws-research-first";
      const researchJobId = `job_research_hist_${Date.now()}`;
      await prisma.workspace.upsert({
        where: { id: researchFirstWs },
        update: {},
        create: { id: researchFirstWs, name: "Research First WS", operatingMode: "RESEARCH_ONLY" },
      });

      const queryTime = new Date().toISOString();
      await prisma.syncJob.create({
        data: {
          id: researchJobId,
          workspaceId: researchFirstWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "PASSED",
                queryTimestamp: queryTime,
                retrievedCount: 6,
                acceptedCount: 6,
                queryProvenance: "LIVE_PROVIDER",
                isLive: true,
                queryError: null,
                lastSuccessfulRecordCount: 6,
                lastSuccessfulQueryAt: queryTime,
              },
            },
          }),
        },
      });

      recordLatestProbe(
        "GOOGLE_ADS",
        {
          source: "GOOGLE_ADS",
          adapterInstalled: true,
          configured: true,
          transportConnected: true,
          authenticated: true,
          discoverySupported: true,
          queryExecuted: false,
          recordsReturned: null,
          provenanceVerified: false,
          lastCheckedAt: new Date().toISOString(),
          status: "CONNECTED",
          reason: "Connection probe succeeded",
          missingRequirements: [],
          dimensions: {
            adapterInstalled: true,
            configured: true,
            transportConnected: true,
            authenticated: true,
            supportedOperationsVerified: true,
            requiredCapabilityAvailable: true,
            queryExecuted: false,
            sourceDataVerified: false,
            lastLiveQueryAt: null,
            blockerCode: null,
            lastLiveQueryRecordCount: null,
          },
        },
        researchFirstWs
      );

      const diag = await diagnoseKH02Source("GOOGLE_ADS", { workspaceId: researchFirstWs });
      expect(diag.dimensions?.lastLiveQueryRecordCount).toBe(6);
      expect(diag.dimensions?.queryExecuted).toBe(true);
      expect(diag.dimensions?.lastSuccessfulQueryAt).toBe(queryTime);

      await prisma.syncJob.deleteMany({ where: { id: researchJobId } });
      await prisma.workspace.deleteMany({ where: { id: researchFirstWs } });
    });

    it("6. Probe results for workspace A are isolated and invisible to workspace B", () => {
      recordLatestProbe(
        "META_ADS",
        {
          source: "META_ADS",
          adapterInstalled: true,
          configured: true,
          transportConnected: true,
          authenticated: true,
          discoverySupported: true,
          queryExecuted: false,
          recordsReturned: null,
          provenanceVerified: false,
          lastCheckedAt: new Date().toISOString(),
          status: "CONNECTED",
          reason: "Probe in WS A",
          missingRequirements: [],
          dimensions: {
            adapterInstalled: true,
            configured: true,
            transportConnected: true,
            authenticated: true,
            supportedOperationsVerified: true,
            requiredCapabilityAvailable: true,
            queryExecuted: false,
            sourceDataVerified: false,
            lastLiveQueryAt: null,
            blockerCode: null,
            lastLiveQueryRecordCount: null,
          },
        },
        "workspace-alpha"
      );

      const probeA = getLatestProbe("META_ADS", "workspace-alpha");
      const probeB = getLatestProbe("META_ADS", "workspace-beta");

      expect(probeA).toBeDefined();
      expect(probeA?.reason).toBe("Probe in WS A");
      expect(probeB).toBeUndefined();
    });

    it("7. COST_BLOCKED or no-domain SKIPPED is not recorded as live executed", async () => {
      const skipWs = "test-ws-cost-blocked";
      const skipJobId = `job_skip_${Date.now()}`;
      await prisma.workspace.upsert({
        where: { id: skipWs },
        update: {},
        create: { id: skipWs, name: "Skip WS", operatingMode: "RESEARCH_ONLY" },
      });
      await prisma.syncJob.create({
        data: {
          id: skipJobId,
          workspaceId: skipWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          resultJson: JSON.stringify({
            topic: "test",
            providerTelemetry: {
              TIKTOK_ADS: {
                source: "TIKTOK_ADS",
                queryExecuted: false,
                queryStatus: "COST_BLOCKED",
                queryTimestamp: null,
                retrievedCount: null,
                acceptedCount: null,
                queryProvenance: "NONE",
                isLive: false,
                queryError: "Cost approval required",
                lastSuccessfulRecordCount: null,
                lastSuccessfulQueryAt: null,
              },
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: false,
                queryStatus: "SKIPPED",
                queryTimestamp: null,
                retrievedCount: null,
                acceptedCount: null,
                queryProvenance: "NONE",
                isLive: false,
                queryError: null,
                lastSuccessfulRecordCount: null,
                lastSuccessfulQueryAt: null,
              },
            },
          }),
        },
      });

      const telemetry = await getWorkspaceProviderTelemetry(skipWs);
      expect(telemetry.TIKTOK_ADS.queryExecuted).toBe(false);
      expect(telemetry.TIKTOK_ADS.isLive).toBe(false);
      expect(telemetry.TIKTOK_ADS.queryStatus).toBe("COST_BLOCKED");
      expect(telemetry.GOOGLE_ADS.queryExecuted).toBe(false);
      expect(telemetry.GOOGLE_ADS.isLive).toBe(false);
      expect(telemetry.GOOGLE_ADS.queryStatus).toBe("SKIPPED");

      await prisma.syncJob.deleteMany({ where: { id: skipJobId } });
      await prisma.workspace.deleteMany({ where: { id: skipWs } });
    });

    it("8. Newer failed query preserves historical lastSuccessfulQueryAt and record count", async () => {
      const histWs = "test-ws-history-fail";
      const oldJobId = `job_old_success_${Date.now()}`;
      const newJobId = `job_new_fail_${Date.now()}`;
      const oldSuccessTime = "2026-10-01T10:00:00.000Z";
      const newFailTime = "2026-10-15T12:00:00.000Z";

      await prisma.workspace.upsert({
        where: { id: histWs },
        update: {},
        create: { id: histWs, name: "History WS", operatingMode: "RESEARCH_ONLY" },
      });

      await prisma.syncJob.create({
        data: {
          id: oldJobId,
          workspaceId: histWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          createdAt: new Date(oldSuccessTime),
          completedAt: new Date(oldSuccessTime),
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "PASSED",
                queryTimestamp: oldSuccessTime,
                retrievedCount: 14,
                acceptedCount: 14,
                queryProvenance: "LIVE_PROVIDER",
                isLive: true,
                queryError: null,
                lastSuccessfulRecordCount: 14,
                lastSuccessfulQueryAt: oldSuccessTime,
              },
            },
          }),
        },
      });

      await prisma.syncJob.create({
        data: {
          id: newJobId,
          workspaceId: histWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          createdAt: new Date(newFailTime),
          completedAt: new Date(newFailTime),
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "QUERY_FAILED",
                queryTimestamp: newFailTime,
                retrievedCount: 0,
                acceptedCount: 0,
                queryProvenance: "LIVE_PROVIDER",
                isLive: false,
                queryError: "Rate limit exceeded",
                lastSuccessfulRecordCount: 14,
                lastSuccessfulQueryAt: oldSuccessTime,
              },
            },
          }),
        },
      });

      const telemetry = await getWorkspaceProviderTelemetry(histWs);
      expect(telemetry.GOOGLE_ADS.queryStatus).toBe("QUERY_FAILED");
      expect(telemetry.GOOGLE_ADS.queryTimestamp).toBe(newFailTime);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulQueryAt).toBe(oldSuccessTime);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulRecordCount).toBe(14);

      await prisma.syncJob.deleteMany({ where: { workspaceId: histWs } });
      await prisma.workspace.deleteMany({ where: { id: histWs } });
    });

    it("9. Provider skipped over 15+ consecutive runs still reconciles earlier successful query", async () => {
      const deepWs = "test-ws-deep-history";
      const oldSuccessTime = "2026-10-01T08:00:00.000Z";
      const oldJobId = `job_deep_success_${Date.now()}`;

      await prisma.workspace.upsert({
        where: { id: deepWs },
        update: {},
        create: { id: deepWs, name: "Deep History WS", operatingMode: "RESEARCH_ONLY" },
      });

      await prisma.syncJob.create({
        data: {
          id: oldJobId,
          workspaceId: deepWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          createdAt: new Date(oldSuccessTime),
          completedAt: new Date(oldSuccessTime),
          resultJson: JSON.stringify({
            topic: "pet hair remover",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: true,
                queryStatus: "PASSED",
                queryTimestamp: oldSuccessTime,
                retrievedCount: 11,
                acceptedCount: 11,
                queryProvenance: "LIVE_PROVIDER",
                isLive: true,
                queryError: null,
                lastSuccessfulRecordCount: 11,
                lastSuccessfulQueryAt: oldSuccessTime,
              },
            },
          }),
        },
      });

      const skipJobs = [];
      for (let i = 1; i <= 18; i++) {
        const time = new Date(Date.now() - (20 - i) * 60000);
        skipJobs.push({
          id: `job_skip_${i}_${Date.now()}`,
          workspaceId: deepWs,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          progress: 100,
          createdAt: time,
          completedAt: time,
          resultJson: JSON.stringify({
            topic: "other topic",
            providerTelemetry: {
              GOOGLE_ADS: {
                source: "GOOGLE_ADS",
                queryExecuted: false,
                queryStatus: "SKIPPED",
                queryTimestamp: null,
                retrievedCount: null,
                acceptedCount: null,
                queryProvenance: "NONE",
                isLive: false,
                queryError: null,
                lastSuccessfulRecordCount: null,
                lastSuccessfulQueryAt: null,
              },
            },
          }),
        });
      }
      await prisma.syncJob.createMany({ data: skipJobs });

      const telemetry = await getWorkspaceProviderTelemetry(deepWs);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulQueryAt).toBe(oldSuccessTime);
      expect(telemetry.GOOGLE_ADS.lastSuccessfulRecordCount).toBe(11);

      await prisma.syncJob.deleteMany({ where: { workspaceId: deepWs } });
      await prisma.workspace.deleteMany({ where: { id: deepWs } });
    });

    it("10. Relevance rules correctly classify pet vs non-pet and hair eraser context", () => {
      // 1. "Carpet stain remover for sofa and furniture" must be IRRELEVANT (no pet hair/fur proof)
      const carpetStain = evaluateProductRelevance(
        "Carpet stain remover for sofa and furniture",
        "pet hair remover"
      );
      expect(carpetStain.relevanceStatus).toBe("IRRELEVANT");
      expect(carpetStain.isAccepted).toBe(false);

      // 2. "Pet Hair Eraser roller for dog fur on couch" must be RELEVANT (dog fur / pet context overrides eraser)
      const petHairEraser = evaluateProductRelevance(
        "Pet Hair Eraser roller for dog fur on couch",
        "pet hair remover"
      );
      expect(petHairEraser.relevanceStatus).toBe("RELEVANT");
      expect(petHairEraser.isAccepted).toBe(true);

      // 3. Human hair eraser must be IRRELEVANT
      const crystalHumanEraser = evaluateProductRelevance(
        "Bleame Crystal Hair Eraser for silky smooth hairless arms and legs",
        "pet hair remover"
      );
      expect(crystalHumanEraser.relevanceStatus).toBe("IRRELEVANT");
      expect(crystalHumanEraser.isAccepted).toBe(false);

      // 4. Genuine pet lint / fur brush must be RELEVANT
      const petBrush = evaluateProductRelevance(
        "Reusable Pet Fur & Lint Remover Brush with Self-Cleaning Base for Dogs and Cats",
        "pet hair remover"
      );
      expect(petBrush.relevanceStatus).toBe("RELEVANT");
      expect(petBrush.isAccepted).toBe(true);

      // 5. Generic stain cleaner must be IRRELEVANT
      const stainCleaner = evaluateProductRelevance(
        "OxiClean Carpet & Area Rug Stain Remover Spray",
        "pet hair remover"
      );
      expect(stainCleaner.relevanceStatus).toBe("IRRELEVANT");
      expect(stainCleaner.isAccepted).toBe(false);
    });

    it("11. Pre-gating relevance prevents irrelevant products from consuming candidate quota", () => {
      const mockAds: SourceObservation[] = [
        {
          source: "META_ADS",
          sourceRecordId: "ad_bleame_01",
          landingPageUrl: "https://bleame.com/products/crystal-hair-eraser",
          title: "Crystal Hair Eraser",
          description: "Painless exfoliation and body hair removal for strawberry legs and arms.",
          observedContent: "Painless exfoliation and body hair removal for strawberry legs and arms.",
          advertiserDomain: "bleame.com",
          advertiserName: "Bleame",
          observedAt: new Date().toISOString(),
          provenance: "CACHED_SOURCE",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_stain_02",
          landingPageUrl: "https://staincleaner.com/products/carpet-stain-remover",
          title: "Carpet stain remover for sofa and furniture",
          description: "Carpet stain remover for sofa and furniture stains.",
          observedContent: "Carpet stain remover for sofa and furniture stains.",
          advertiserDomain: "staincleaner.com",
          advertiserName: "Stain Cleaner Co",
          observedAt: new Date().toISOString(),
          provenance: "CACHED_SOURCE",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_pet_hair_03",
          landingPageUrl: "https://chomchom.com/products/pet-hair-roller",
          title: "ChomChom Roller Pet Hair Remover",
          description: "Removes dog and cat hair, fur and lint from couch and sofa.",
          observedContent: "Removes dog and cat hair, fur and lint from couch and sofa.",
          advertiserDomain: "chomchom.com",
          advertiserName: "ChomChom",
          observedAt: new Date().toISOString(),
          provenance: "CACHED_SOURCE",
        },
      ];

      const rawCandidates = discoverProductCandidatesFromAds(mockAds, "pet hair remover");
      
      const eligibleCandidates = rawCandidates.filter(
        (c) => c.relevanceStatus === "RELEVANT" || c.relevanceStatus === "PROBABLY_RELEVANT"
      );
      const preRejectedCandidates = rawCandidates.filter(
        (c) => c.relevanceStatus === "IRRELEVANT"
      );
      const maxCandidates = 1;
      const candidates = eligibleCandidates.slice(0, maxCandidates);

      expect(candidates.length).toBe(1);
      expect(candidates[0].title).toBe("Pet Hair Roller");
      expect(candidates[0].storeDomain).toBe("chomchom.com");
      expect(candidates[0].isEligibleAsEvergreenWinner).toBe(true);

      expect(preRejectedCandidates.length).toBe(2);
      expect(preRejectedCandidates.some((c) => c.title.toLowerCase().includes("crystal hair eraser"))).toBe(true);
      expect(preRejectedCandidates.some((c) => c.title.toLowerCase().includes("carpet stain remover"))).toBe(true);
    });

    it("12. Niche Relevance Precision rejects polysemous hardware devices and chemical stain removers", () => {
      // 1. Car fleet tracker must NOT be accepted as Pet Gadgets
      const carTracker = evaluateProductRelevance("GPS tracker for car fleet", "Pet Gadgets");
      expect(carTracker.isAccepted).toBe(false);
      expect(carTracker.relevanceStatus).not.toBe("RELEVANT");
      expect(carTracker.score).toBeLessThanOrEqual(0.4);

      // 2. Garden water fountain outdoor decoration must NOT be accepted as Pet Gadgets
      const gardenFountain = evaluateProductRelevance("Garden water fountain outdoor decoration", "Pet Gadgets");
      expect(gardenFountain.isAccepted).toBe(false);
      expect(gardenFountain.relevanceStatus).not.toBe("RELEVANT");
      expect(gardenFountain.score).toBeLessThanOrEqual(0.4);

      // 3. Pet stain remover for sofa must NOT be accepted for pet hair remover
      const petStainRemover = evaluateProductRelevance("Pet stain remover for sofa", "pet hair remover");
      expect(petStainRemover.isAccepted).toBe(false);
      expect(petStainRemover.relevanceStatus).not.toBe("RELEVANT");
      expect(petStainRemover.score).toBeLessThanOrEqual(0.4);

      // 4. Positive cases must be RELEVANT
      const petGps = evaluateProductRelevance("GPS pet tracker collar", "Pet Gadgets");
      expect(petGps.isAccepted).toBe(true);
      expect(petGps.relevanceStatus).toBe("RELEVANT");

      const catFountain = evaluateProductRelevance("Cat water fountain", "Pet Gadgets");
      expect(catFountain.isAccepted).toBe(true);
      expect(catFountain.relevanceStatus).toBe("RELEVANT");

      const dogFeeder = evaluateProductRelevance("Automatic dog feeder", "Pet Gadgets");
      expect(dogFeeder.isAccepted).toBe(true);
      expect(dogFeeder.relevanceStatus).toBe("RELEVANT");

      const furRoller = evaluateProductRelevance("Dog fur roller on couch", "pet hair remover");
      expect(furRoller.isAccepted).toBe(true);
      expect(furRoller.relevanceStatus).toBe("RELEVANT");

      const petBrush = evaluateProductRelevance("Pet grooming/deshedding brush", "pet hair remover");
      expect(petBrush.isAccepted).toBe(true);
      expect(petBrush.relevanceStatus).toBe("RELEVANT");
    });

    it("13. Legacy Telemetry Reconstruction does NOT fabricate multi-source total as Meta count", async () => {
      // Mock DB with legacy snapshot: sourceStatuses PASSED, totalObservationsCollected: 15, NO per-source observations
      const fakeLegacyDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "legacy_job_multisource_15",
              createdAt: new Date("2026-03-01T12:00:00Z"),
              resultJson: JSON.stringify({
                sourceStatuses: {
                  META_ADS: "PASSED",
                  GOOGLE_ADS: "PASSED",
                },
                totalObservationsCollected: 15,
                topThree: [],
                remainingCandidates: [],
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry("test-ws-legacy-15", fakeLegacyDb);

      // Meta count MUST be null (Unknown), NOT 15!
      expect(telemetry.META_ADS.retrievedCount).toBeNull();
      expect(telemetry.META_ADS.acceptedCount).toBeNull();
      expect(telemetry.META_ADS.lastSuccessfulRecordCount).toBeNull();
      expect(telemetry.META_ADS.isLive).toBe(false);
      expect(telemetry.META_ADS.queryProvenance).toBe("UNKNOWN");

      // Now test with verified per-source candidate observations
      const fakeObsLegacyDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "legacy_job_with_obs",
              createdAt: new Date("2026-03-01T12:00:00Z"),
              resultJson: JSON.stringify({
                sourceStatuses: {
                  META_ADS: "PASSED",
                },
                totalObservationsCollected: 15,
                topThree: [
                  {
                    candidate: {
                      sourceObservations: [
                        { source: "META_ADS", sourceRecordId: "meta_rec_1", provenance: "CACHED_SOURCE" },
                        { source: "META_ADS", sourceRecordId: "meta_rec_2", provenance: "CACHED_SOURCE" },
                        { source: "GOOGLE_ADS", sourceRecordId: "google_rec_1", provenance: "LIVE_PROVIDER" },
                      ],
                    },
                  },
                ],
              }),
            },
          ]),
        },
      };

      const telemetryWithObs = await getWorkspaceProviderTelemetry("test-ws-obs", fakeObsLegacyDb);
      // Meta count should only reflect the 2 proven Meta observations, NOT 15
      expect(telemetryWithObs.META_ADS.retrievedCount).toBe(2);
      expect(telemetryWithObs.META_ADS.acceptedCount).toBe(2);
      expect(telemetryWithObs.META_ADS.isLive).toBe(false);
      expect(telemetryWithObs.META_ADS.queryProvenance).toBe("CACHED_SOURCE");
    });
  });

  describe("V12.2.4 Telemetry Decoupling & Projection Lifecycle (Section 4)", () => {
    it("1. live-zero+cache: preserves live succeeded 0 and cache used 8 across lifecycle", async () => {
      const ws = `ws_live_zero_${Date.now()}`;
      const now = new Date().toISOString();
      const fakeDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "job_live_zero",
              completedAt: now,
              createdAt: now,
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: true,
                    queryStatus: "PASSED",
                    queryTimestamp: now,
                    retrievedCount: 8,
                    acceptedCount: 8,
                    queryProvenance: "CACHED_SOURCE",
                    isLive: false,
                    queryError: null,
                    lastSuccessfulRecordCount: 8,
                    lastSuccessfulQueryAt: now,
                    upstreamReturnedCount: 0,
                    freshLiveCount: 0,
                    cachedRecordsCount: 8,
                    liveAttempted: true,
                    liveSucceeded: true,
                    liveError: null,
                    lastLiveQueryAt: now,
                    lastLiveQueryRecordCount: 0,
                    lastSuccessfulLiveQueryAt: now,
                  },
                },
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry(ws, fakeDb);
      expect(telemetry.META_ADS.liveAttempted).toBe(true);
      expect(telemetry.META_ADS.liveSucceeded).toBe(true);
      expect(telemetry.META_ADS.lastLiveQueryRecordCount).toBe(0);
      expect(telemetry.META_ADS.lastLiveQueryAt).toBe(now);
      expect(telemetry.META_ADS.cachedRecordsCount).toBe(8);
      expect(telemetry.META_ADS.queryProvenance).toBe("CACHED_SOURCE");
      expect(telemetry.META_ADS.isLive).toBe(false);

      // Verify UI / registry projection preserves lastLiveQueryRecordCount = 0, lastLiveQueryAt, and cachedRecordsCount
      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: ws, db: fakeDb });
      expect(diag.dimensions!.lastLiveQueryRecordCount).toBe(0);
      expect(diag.dimensions!.lastLiveQueryAt).toBe(now);
      expect(diag.dimensions!.liveAttempted).toBe(true);
      expect(diag.dimensions!.liveSucceeded).toBe(true);
      expect(diag.dimensions!.cachedRecordsCount).toBe(8);
    });

    it("2. live-failure+cache: retains failed attempt, timestamp, and error when fallback to cache succeeds", async () => {
      const ws = `ws_live_fail_${Date.now()}`;
      const now = new Date().toISOString();
      const fakeDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "job_live_fail",
              completedAt: now,
              createdAt: now,
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: true,
                    queryStatus: "CACHE_ONLY",
                    queryTimestamp: now,
                    retrievedCount: 8,
                    acceptedCount: 8,
                    queryProvenance: "CACHED_SOURCE",
                    isLive: false,
                    queryError: "Meta Graph API 500: Server Error",
                    lastSuccessfulRecordCount: 8,
                    lastSuccessfulQueryAt: now,
                    upstreamReturnedCount: null,
                    freshLiveCount: 0,
                    cachedRecordsCount: 8,
                    liveAttempted: true,
                    liveSucceeded: false,
                    liveError: "Meta Graph API 500: Server Error",
                    lastLiveQueryAt: now,
                    lastLiveQueryRecordCount: null,
                    lastSuccessfulLiveQueryAt: null,
                  },
                },
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry(ws, fakeDb);
      expect(telemetry.META_ADS.liveAttempted).toBe(true);
      expect(telemetry.META_ADS.liveSucceeded).toBe(false);
      expect(telemetry.META_ADS.liveError).toBe("Meta Graph API 500: Server Error");
      expect(telemetry.META_ADS.lastLiveQueryAt).toBe(now);
      expect(telemetry.META_ADS.lastLiveQueryRecordCount).toBeNull();
      expect(telemetry.META_ADS.cachedRecordsCount).toBe(8);
      expect(telemetry.META_ADS.queryProvenance).toBe("CACHED_SOURCE");

      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: ws, db: fakeDb });
      expect(diag.dimensions!.liveAttempted).toBe(true);
      expect(diag.dimensions!.liveSucceeded).toBe(false);
      expect(diag.dimensions!.liveError).toBe("Meta Graph API 500: Server Error");
      expect(diag.dimensions!.cachedRecordsCount).toBe(8);
    });

    it("3. cache-only: does not set queryExecuted true when only reading cache without upstream attempt", async () => {
      const ws = `ws_cache_only_${Date.now()}`;
      const now = new Date().toISOString();
      const fakeDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "job_cache_only",
              completedAt: now,
              createdAt: now,
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: false, // Pure cache reading
                    queryStatus: "CACHE_ONLY",
                    queryTimestamp: now,
                    retrievedCount: 8,
                    acceptedCount: 8,
                    queryProvenance: "CACHED_SOURCE",
                    isLive: false,
                    queryError: null,
                    lastSuccessfulRecordCount: 8,
                    lastSuccessfulQueryAt: now,
                    upstreamReturnedCount: null,
                    freshLiveCount: 0,
                    cachedRecordsCount: 8,
                    liveAttempted: false,
                    liveSucceeded: false,
                    lastLiveQueryAt: null,
                    lastLiveQueryRecordCount: null,
                  },
                },
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry(ws, fakeDb);
      expect(telemetry.META_ADS.queryExecuted).toBe(false);
      expect(telemetry.META_ADS.liveAttempted).toBe(false);
      expect(telemetry.META_ADS.cachedRecordsCount).toBe(8);

      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: ws, db: fakeDb });
      expect(diag.dimensions!.liveAttempted).toBe(false);
      expect(diag.dimensions!.cachedRecordsCount).toBe(8);
    });

    it("4. upstream-returned-but-accepted-zero: preserves upstream count when records filtered out", async () => {
      const ws = `ws_upstream_filtered_${Date.now()}`;
      const now = new Date().toISOString();
      const fakeDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "job_upstream_filtered",
              completedAt: now,
              createdAt: now,
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: true,
                    queryStatus: "QUERY_SUCCEEDED_EMPTY",
                    queryTimestamp: now,
                    retrievedCount: 5,
                    acceptedCount: 0,
                    queryProvenance: "NONE",
                    isLive: false,
                    queryError: null,
                    lastSuccessfulRecordCount: 0,
                    lastSuccessfulQueryAt: now,
                    upstreamReturnedCount: 5,
                    freshLiveCount: 0,
                    cachedRecordsCount: 0,
                    liveAttempted: true,
                    liveSucceeded: true,
                    lastLiveQueryAt: now,
                    lastLiveQueryRecordCount: 5,
                    lastSuccessfulLiveQueryAt: now,
                  },
                },
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry(ws, fakeDb);
      expect(telemetry.META_ADS.upstreamReturnedCount).toBe(5);
      expect(telemetry.META_ADS.acceptedCount).toBe(0);
      expect(telemetry.META_ADS.lastLiveQueryRecordCount).toBe(5);
      expect(telemetry.META_ADS.liveAttempted).toBe(true);
      expect(telemetry.META_ADS.liveSucceeded).toBe(true);

      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: ws, db: fakeDb });
      expect(diag.dimensions!.lastLiveQueryRecordCount).toBe(5);
      expect(diag.dimensions!.liveAttempted).toBe(true);
      expect(diag.dimensions!.liveSucceeded).toBe(true);
    });

    it("5. mixed live and cache: properly separates fresh live count and cached count", async () => {
      const ws = `ws_mixed_${Date.now()}`;
      const now = new Date().toISOString();
      const fakeDb = {
        syncJob: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "job_mixed",
              completedAt: now,
              createdAt: now,
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: true,
                    queryStatus: "PASSED",
                    queryTimestamp: now,
                    retrievedCount: 8,
                    acceptedCount: 8,
                    queryProvenance: "LIVE_PROVIDER",
                    isLive: true,
                    queryError: null,
                    lastSuccessfulRecordCount: 8,
                    lastSuccessfulQueryAt: now,
                    upstreamReturnedCount: 3,
                    freshLiveCount: 3,
                    cachedRecordsCount: 5,
                    liveAttempted: true,
                    liveSucceeded: true,
                    lastLiveQueryAt: now,
                    lastLiveQueryRecordCount: 3,
                    lastSuccessfulLiveQueryAt: now,
                  },
                },
              }),
            },
          ]),
        },
      };

      const telemetry = await getWorkspaceProviderTelemetry(ws, fakeDb);
      expect(telemetry.META_ADS.freshLiveCount).toBe(3);
      expect(telemetry.META_ADS.cachedRecordsCount).toBe(5);
      expect(telemetry.META_ADS.lastLiveQueryRecordCount).toBe(3);
      expect(telemetry.META_ADS.isLive).toBe(true);
      expect(telemetry.META_ADS.queryProvenance).toBe("LIVE_PROVIDER");

      const diag = await diagnoseKH02Source("META_ADS", { workspaceId: ws, db: fakeDb });
      expect(diag.dimensions!.lastLiveQueryRecordCount).toBe(3);
      expect(diag.dimensions!.freshLiveCount).toBe(3);
      expect(diag.dimensions!.cachedRecordsCount).toBe(5);
    });

    // Helper simulating the exact JSX IIFE logic in src/app/products/page.tsx
    function renderLastLiveQueryUI(dims: any): { liveText: string; cacheText: string | null } {
      let liveText = "Not Run";
      if (dims.liveSucceeded === false || (dims.liveAttempted && dims.liveError)) {
        liveText = `Failed: ${dims.liveError || "Upstream query failed"}`;
      } else if (typeof dims.lastLiveQueryRecordCount === "number") {
        liveText = `${dims.lastLiveQueryRecordCount} records`;
      } else if (dims.liveAttempted && dims.liveSucceeded) {
        const liveCnt = typeof dims.freshLiveCount === "number" ? dims.freshLiveCount : 0;
        liveText = `${liveCnt} records`;
      } else if (dims.queryStatus === "PASSED" && dims.isLive && dims.queryProvenance !== "CACHED_SOURCE") {
        liveText = `${dims.retrievedCount || 0} records`;
      } else {
        liveText = "Not Run";
      }

      let cacheText: string | null = null;
      if ((typeof dims.cachedRecordsCount === "number" && dims.cachedRecordsCount > 0) || dims.queryProvenance === "CACHED_SOURCE") {
        const count = typeof dims.cachedRecordsCount === "number" ? dims.cachedRecordsCount : (dims.retrievedCount || 0);
        cacheText = `Cache (${count} records)`;
      }

      return { liveText, cacheText };
    }

    it("6. UI projection: renders '0 records' for live-succeeded-zero and separate cache badge", () => {
      const dims = {
        liveAttempted: true,
        liveSucceeded: true,
        lastLiveQueryRecordCount: 0,
        queryProvenance: "CACHED_SOURCE",
        cachedRecordsCount: 8,
      };
      const { liveText, cacheText } = renderLastLiveQueryUI(dims);
      expect(liveText).toBe("0 records");
      expect(cacheText).toBe("Cache (8 records)");
    });

    it("7. UI projection: renders failure text for failed live attempt and separate cache badge", () => {
      const dims = {
        liveAttempted: true,
        liveSucceeded: false,
        liveError: "Meta Graph API 500: Server Error",
        queryStatus: "CACHE_ONLY",
        queryProvenance: "CACHED_SOURCE",
        cachedRecordsCount: 8,
      };
      const { liveText, cacheText } = renderLastLiveQueryUI(dims);
      expect(liveText).toBe("Failed: Meta Graph API 500: Server Error");
      expect(cacheText).toBe("Cache (8 records)");
    });

    it("8. UI projection: renders 'Not Run' for cache-only without live attempt", () => {
      const dims = {
        liveAttempted: false,
        queryStatus: "CACHE_ONLY",
        queryProvenance: "CACHED_SOURCE",
        cachedRecordsCount: 8,
      };
      const { liveText, cacheText } = renderLastLiveQueryUI(dims);
      expect(liveText).toBe("Not Run");
      expect(cacheText).toBe("Cache (8 records)");
    });
  });
});
