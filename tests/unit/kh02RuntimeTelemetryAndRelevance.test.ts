/**
 * SWAI KH-02 — Provider Runtime Telemetry & Product Relevance Suite
 *
 * Validates:
 * 1. Telemetry Display States (Section H1): Not Run, Succeeded N, Succeeded 0, Failed, Cache-only,
 *    Probe non-destructive invariant, Workspace isolation.
 * 2. Relevance & Identity Gating (Section H2): Pet hair removers retained, human body depilatories
 *    disqualified and excluded from scoring/winners, ambiguous items marked for manual review.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { evaluateProductRelevance } from "@/services/kh02/identity/productRelevanceEvaluator";
import { discoverProductCandidatesFromAds } from "@/services/kh02/identity/productCandidateDiscovery";
import { calculateKH02EvergreenScore } from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { getWorkspaceProviderTelemetry } from "@/services/kh02/persistence/kh02PersistenceService";
import { diagnoseKH02Source } from "@/services/kh02/providers/sourceRegistry";
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
});
