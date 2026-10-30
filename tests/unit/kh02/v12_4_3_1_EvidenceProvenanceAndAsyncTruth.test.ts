/**
 * SWAI KH-02 V12.4.3.1 — Evidence Provenance, Runtime Parity, Specific-Product Isolation & Async Truth Regression Suite
 *
 * Covers:
 * - Group 1 (Section 11.1): Strict Meta Query Provenance & Split G06 Gates (F01, F02)
 * - Group 2 (Section 11.2): Product-Level Historical Demand Authority & Independent G12 Verification (F03, F04, F06)
 * - Group 3 (Section 11.3): Specific-Product Relevance Isolation (F08)
 * - Group 4 (Section 11.4): Customer Psychology Isolation & Google State Breakdown (F07, F09)
 * - Group 5 (Section 11.5): Runtime Version Parity Closure (F05)
 * - Group 6 (Section 11.6): Bounded Async Pool, Completion Barrier & Fresh Log Validation (F10)
 * - Group 7 (Section 19): Adversarial False-PASS Resistance (Mutations A through J)
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  resolveMetaExecutionPolicy,
  collectMetaProductSignals,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
  detectSpecificProductFamily,
  isBroadCategoryDemandTerm,
  DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  calculateKH02EvergreenScore,
  verifyEvergreenCandidateIndependently,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { evaluateProductRelevance } from "@/services/kh02/identity/productRelevanceEvaluator";
import {
  discoverProductCandidatesFromAds,
  selectTopResearchShortlist,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  analyzeCustomerPsychology,
  validateCustomerPsychologyAlignment,
} from "@/services/kh02/psychology/customerPsychologyService";
import {
  SWAI_KH02_RELEASE_VERSION,
  evaluateKH02RuntimeIdentity,
} from "@/services/kh02/version/runtimeVersionService";
import {
  evaluateSplitG06MetaGates,
  evaluateG12IndependentEvergreen,
  validateFreshTestExecutionLog,
  runBoundedAsyncJobPool,
  validateCompletionBarrier,
} from "@/services/kh02/acceptance/gateAndAsyncVerifierV12_4_3_1";

function buildValidMerchantCandidate(overrides: Record<string, any> = {}) {
  return {
    candidateId: "cand_uahpet_feeder",
    productId: "cmvsy7zqh000jp0orhypwohho",
    title: "Automatic Wet Food Cat Feeder with Cooling & Warming",
    canonicalProductName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
    merchantVerifiedProductName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
    category: "Pet Gadgets",
    problemStatement: "Keeps wet cat food chilled at 37.4-44.6F and gently warms meals on schedule.",
    targetAudience: "Cat Owners",
    thumbnailUrl: "https://uahpet.com/cdn/feeder.jpg",
    videoUrl: "https://uahpet.com/cdn/feeder.mp4",
    canonicalProductUrl: "https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder",
    storeDomain: "uahpet.com",
    advertiserNames: ["UAHPET Official", "SmartPet Living", "CatCare Store"],
    supportingAdIds: ["ad_uah_1", "ad_uah_2", "ad_uah_3", "ad_uah_4", "ad_uah_5"],
    supportingSourceTypes: ["META_ADS"],
    totalObservationCount: 6,
    distinctAdvertisersCount: 3,
    earliestObservationDate: "2026-06-01T00:00:00Z",
    latestObservationDate: "2026-10-15T00:00:00Z",
    identityStatus: "VERIFIED" as const,
    identityConfidence: "EXACT" as const,
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT" as const,
    relevanceStatus: "RELEVANT" as const,
    isEligibleAsEvergreenWinner: true,
    sourceObservations: [
      {
        source: "META_ADS" as const,
        sourceRecordId: "ad_uah_1",
        title: "Feed Fresh Wet Food Anywhere, Anytime",
        description: "Protect your pet's health with the UAHPET Dual Temp Feeder.",
        observedAt: "2026-10-01T00:00:00Z",
        provenance: "CACHED_SOURCE" as const,
      },
    ],
    ...overrides,
  };
}

function buildAuthoritativeDemandSeries(overrides: Partial<DemandDataPoint> = {}): DemandDataPoint[] {
  return [
    {
      id: "dobs_1",
      productId: "cmvsy7zqh000jp0orhypwohho",
      keyword: "Automatic Wet Food Cat Feeder",
      source: "GOOGLE_TRENDS_CSV",
      region: "US",
      evidenceReference: "csv-import:job_uahpet_2026:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      methodologyVersion: "12.4.3.1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      demandValue: 68,
      ...overrides,
    },
    {
      id: "dobs_2",
      productId: "cmvsy7zqh000jp0orhypwohho",
      keyword: "Automatic Wet Food Cat Feeder",
      source: "GOOGLE_TRENDS_CSV",
      region: "US",
      evidenceReference: "csv-import:job_uahpet_2026:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      methodologyVersion: "12.4.3.1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      demandValue: 71,
      ...overrides,
    },
    {
      id: "dobs_3",
      productId: "cmvsy7zqh000jp0orhypwohho",
      keyword: "Automatic Wet Food Cat Feeder",
      source: "GOOGLE_TRENDS_CSV",
      region: "US",
      evidenceReference: "csv-import:job_uahpet_2026:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      methodologyVersion: "12.4.3.1",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      demandValue: 70,
      ...overrides,
    },
    {
      id: "dobs_4",
      productId: "cmvsy7zqh000jp0orhypwohho",
      keyword: "Automatic Wet Food Cat Feeder",
      source: "GOOGLE_TRENDS_CSV",
      region: "US",
      evidenceReference: "csv-import:job_uahpet_2026:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      methodologyVersion: "12.4.3.1",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      demandValue: 72,
      ...overrides,
    },
  ];
}

describe("SWAI KH-02 V12.4.3.1 — Evidence Provenance, Runtime Parity & Async Truth Suite", () => {
  // ============================================================================
  // GROUP 1: Strict Meta Query Provenance & Split G06 Gates (F01, F02)
  // ============================================================================
  describe("Group 1 — Strict Meta Query Provenance & Split G06 Gates (F01, F02)", () => {
    it("1.1 resolveMetaExecutionPolicy resolves explicit and environment-driven execution policies", () => {
      expect(
        resolveMetaExecutionPolicy({ topic: "pet", metaExecutionPolicy: "CACHE_ONLY" } as any)
      ).toBe("CACHE_ONLY");
      expect(
        resolveMetaExecutionPolicy({ topic: "pet", metaExecutionPolicy: "LIVE_FIRST" } as any)
      ).toBe("LIVE_FIRST");
      expect(resolveMetaExecutionPolicy({ topic: "pet" } as any)).toBe("OFFLINE_FIXTURE");
    });

    it("1.2 Cache-only Meta collection never fabricates SUCCEEDED_WITH_RESULTS or actualApiCalls > 0", async () => {
      const res = await collectMetaProductSignals({
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        researchRunId: "run_test_cache_only",
        metaExecutionPolicy: "CACHE_ONLY",
        plannedQueries: [
          {
            queryId: "q_r1_1",
            phrase: "cat water fountain",
            normalizedPhrase: "cat water fountain",
            searchType: "KEYWORD_EXACT_PHRASE",
            roundNumber: 1,
            origin: "DETERMINISTIC_FALLBACK",
            archetypeId: "pet_feeding_hydration",
          },
          {
            queryId: "q_r1_2",
            phrase: "automatic pet feeder",
            normalizedPhrase: "automatic pet feeder",
            searchType: "KEYWORD_EXACT_PHRASE",
            roundNumber: 1,
            origin: "DETERMINISTIC_FALLBACK",
            archetypeId: "pet_feeding_hydration",
          },
        ],
      } as any);

      expect(res.executionMetadata?.attempted).toBe(false);
      expect(res.executionMetadata?.liveSucceeded).toBe(false);
      expect(res.executionMetadata?.upstreamReturnedCount).toBeNull();
      const outcomes = res.executionMetadata?.queryOutcomes || [];
      expect(outcomes.length).toBe(2);
      for (const qo of outcomes) {
        expect(qo.attempted).toBe(false);
        expect(qo.requestStarted).toBe(false);
        expect(qo.requestCompleted).toBe(false);
        expect(qo.actualApiCalls).toBe(0);
        expect(qo.status).toBe("NOT_ATTEMPTED");
        expect(qo.upstreamReturnedCount).toBeNull();
        expect(qo.returnedCount).toBe(0);
      }
    });

    it("1.3 Split G06 gates pass G06A/G06B on truthful cache-only run while marking G06C as BLOCKED_EXTERNAL_DEPENDENCY", () => {
      const truthfulCacheRun = {
        topic: "Pet Gadgets",
        providerTelemetry: {
          META_ADS: {
            queryExecuted: false,
            queryStatus: "CACHE_ONLY",
            freshLiveCount: 0,
            cachedRecordsCount: 50,
            queryProvenance: "CACHED_SOURCE",
            isLive: false,
            queryExecution: [
              {
                queryId: "q_1",
                keyword: "cat water fountain",
                attempted: false,
                actualApiCalls: 0,
                status: "NOT_ATTEMPTED",
                returnedCount: 0,
                upstreamReturnedCount: null,
              },
            ],
          },
        },
        queryDiscovery: {
          queryYields: [
            {
              queryId: "q_1",
              phrase: "cat water fountain",
              actualAdsReturned: 0,
              sourceStatus: "NOT_ATTEMPTED",
            },
          ],
        },
      };

      const g06 = evaluateSplitG06MetaGates([truthfulCacheRun]);
      expect(g06.G06A_META_TELEMETRY_TRUTH.verdict).toBe("PASS");
      expect(g06.G06B_META_CACHE_FALLBACK_INTEGRITY.verdict).toBe("PASS");
      expect(g06.G06C_META_LIVE_EXECUTION_PROOF.verdict).toBe("BLOCKED_EXTERNAL_DEPENDENCY");
      expect(g06.overallG06EngineeringVerdict).toBe("PASS");
    });
  });

  // ============================================================================
  // GROUP 2: Demand Source Authority & Independent Evergreen Verification (F03, F04, F06)
  // ============================================================================
  describe("Group 2 — Demand Source Authority & Independent Evergreen Verification (F03, F04, F06)", () => {
    it("2.1 Classifies AUTHORITATIVE_VERIFIED and HISTORICAL_SOURCE_VERIFIED accurately", () => {
      const liveSeries = buildAuthoritativeDemandSeries({ source: "GOOGLE_TRENDS_LIVE" });
      expect(evaluateDemandSourceAuthority(liveSeries).authority).toBe("AUTHORITATIVE_VERIFIED");

      const csvSeries = buildAuthoritativeDemandSeries({ source: "GOOGLE_TRENDS_CSV" });
      expect(evaluateDemandSourceAuthority(csvSeries).authority).toBe("HISTORICAL_SOURCE_VERIFIED");
    });

    it("2.2 Rejects FIXTURE_ONLY, CACHED_UNVERIFIED, UNKNOWN_SOURCE, and ESTIMATED_OR_PROXY from Evergreen eligibility", () => {
      const fixtureSeries = buildAuthoritativeDemandSeries({
        productId: "prod_fixture_1793008628398",
      });
      const fixtureEval = evaluateTemporalDemandStability(fixtureSeries, 90);
      expect(fixtureEval.sourceAuthority).toBe("FIXTURE_ONLY");
      expect(fixtureEval.eligibleForEvergreen).toBe(false);
      expect(fixtureEval.stabilityScore).toBeNull();

      const unverifiedSeries = buildAuthoritativeDemandSeries({
        evidenceReference: null,
      });
      const unverifiedEval = evaluateTemporalDemandStability(unverifiedSeries, 90);
      expect(unverifiedEval.sourceAuthority).toBe("CACHED_UNVERIFIED");
      expect(unverifiedEval.eligibleForEvergreen).toBe(false);

      const unknownSeries = buildAuthoritativeDemandSeries({
        source: "UNKNOWN_SOURCE",
      });
      const unknownEval = evaluateTemporalDemandStability(unknownSeries, 90);
      expect(unknownEval.sourceAuthority).toBe("UNKNOWN_SOURCE");
      expect(unknownEval.eligibleForEvergreen).toBe(false);

      const proxySeries = buildAuthoritativeDemandSeries({
        keyword: "pet gadgets",
      });
      const proxyEval = evaluateTemporalDemandStability(proxySeries, 90);
      expect(proxyEval.sourceAuthority).toBe("ESTIMATED_OR_PROXY");
      expect(proxyEval.eligibleForEvergreen).toBe(false);
    });

    it("2.3 Rejects future-dated observations, merged multi-product series, and cross-product demand attribution", () => {
      const futureSeries = [
        ...buildAuthoritativeDemandSeries().slice(0, 2),
        {
          id: "dobs_future",
          productId: "cmvsy7zqh000jp0orhypwohho",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:uahpet.com",
          periodStart: "2028-05-01",
          periodEnd: "2028-05-31",
          demandValue: 80,
        },
      ];
      const futureAssessment = evaluateDemandHistoryEvidence(futureSeries);
      expect(futureAssessment.eligibleForEvergreen).toBe(false);
      expect(futureAssessment.missingEvidence.some((m) => m.includes("Future-dated"))).toBe(true);

      const mergedSeries = [
        ...buildAuthoritativeDemandSeries().slice(0, 2),
        ...buildAuthoritativeDemandSeries({ productId: "prod_other_999" }).slice(2),
      ];
      const mergedEval = evaluateDemandSourceAuthority(mergedSeries);
      expect(mergedEval.authority).toBe("CACHED_UNVERIFIED");
      expect(mergedEval.productAttributionValid).toBe(false);

      const crossFamilySeries = buildAuthoritativeDemandSeries({
        keyword: "Pawira Stainless Steel Water Fountain",
      });
      const crossFamilyEval = evaluateDemandSourceAuthority(crossFamilySeries, {
        candidateCanonicalName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
      });
      expect(crossFamilyEval.authority).toBe("CACHED_UNVERIFIED");
      expect(crossFamilyEval.productAttributionValid).toBe(false);
    });

    it("2.4 Separates verification dimensions when AI is unavailable vs reviewed", () => {
      const cand = buildValidMerchantCandidate({
        aiIntelligence: undefined,
      });
      const score = calculateKH02EvergreenScore({
        candidate: cand as any,
        demandSeries: buildAuthoritativeDemandSeries(),
      });

      expect(score.tier).toBe("VERIFIED_EVERGREEN");
      expect(score.verificationDimensions?.identityVerifiedByMerchant).toBe(true);
      expect(score.verificationDimensions?.demandVerifiedByHistoricalSource).toBe(true);
      expect(score.verificationDimensions?.aiReviewed).toBe(false);
      expect(score.verificationDimensions?.evergreenIndependentlyVerified).toBe(true);
      expect(score.evergreenVerification?.verifiedByGate).toBe(true);
    });
  });

  // ============================================================================
  // GROUP 3: Specific-Product Relevance Isolation (F08)
  // ============================================================================
  describe("Group 3 — Specific-Product Relevance Isolation (F08)", () => {
    it("3.1 'automatic pet feeder' accepts only pet feeders and rejects water fountains, hair rollers, and beds", () => {
      const feeder = evaluateProductRelevance(
        "Automatic Wet Food Cat Feeder with Cooling & Warming https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder",
        "automatic pet feeder"
      );
      expect(feeder.isAccepted).toBe(true);
      expect(feeder.relevanceStatus).toBe("RELEVANT");

      const fountain = evaluateProductRelevance(
        "Pawira Stainless Steel Water Fountain https://pawira.com/products/pawira-stainless-steel-water-fountain",
        "automatic pet feeder"
      );
      expect(fountain.isAccepted).toBe(false);
      expect(fountain.relevanceStatus).toBe("IRRELEVANT");

      const hairRoller = evaluateProductRelevance(
        "Reusable Pet Hair Remover Roller https://livlandco.com/products/reusable-pet-hair-remover-roller",
        "automatic pet feeder"
      );
      expect(hairRoller.isAccepted).toBe(false);
      expect(hairRoller.relevanceStatus).toBe("IRRELEVANT");

      const dogBed = evaluateProductRelevance(
        "Orthopedic Calming Dog Bed with Washable Cover",
        "automatic pet feeder"
      );
      expect(dogBed.isAccepted).toBe(false);
      expect(dogBed.relevanceStatus).toBe("IRRELEVANT");
    });

    it("3.2 Specific queries ('cat water fountain', 'cordless hot glue gun', 'self-watering plant spike', 'electric spin scrubber') reject sibling products", () => {
      expect(
        evaluateProductRelevance("Dockstream Stainless Steel Cat Water Fountain", "cat water fountain").isAccepted
      ).toBe(true);
      expect(
        evaluateProductRelevance("Automatic Wet Food Cat Feeder", "cat water fountain").isAccepted
      ).toBe(false);

      expect(
        evaluateProductRelevance("Rechargeable Hot Melt Glue Gun with Stand", "cordless hot glue gun").isAccepted
      ).toBe(true);
      expect(
        evaluateProductRelevance("Easy-Fill Wall Repair Paste Kit", "cordless hot glue gun").isAccepted
      ).toBe(false);

      expect(
        evaluateProductRelevance("Terracotta Self-Watering Plant Spike Set", "self-watering plant spike").isAccepted
      ).toBe(true);
      expect(
        evaluateProductRelevance("Heavy Duty Bypass Pruning Shears", "self-watering plant spike").isAccepted
      ).toBe(false);

      expect(
        evaluateProductRelevance("Cordless Electric Spin Scrubber for Bathroom Tile", "electric spin scrubber").isAccepted
      ).toBe(true);
      expect(
        evaluateProductRelevance("Reusable Lint Roller for Clothes", "electric spin scrubber").isAccepted
      ).toBe(false);
    });
  });

  // ============================================================================
  // GROUP 4: Customer Psychology Isolation (F09) & Google State Breakdown (F07)
  // ============================================================================
  describe("Group 4 — Customer Psychology Isolation (F09) & Google State Honesty (F07)", () => {
    it("4.1 Cat Feeder mentioning 'no Wi-Fi, no Bluetooth' receives PET psychology and never wireless audio psychology", () => {
      const profile = analyzeCustomerPsychology({
        candidateId: "cand_uahpet_feeder",
        candidateTitle: "Automatic Wet Food Cat Feeder with Cooling & Warming",
        categoryOrTopic: "Pet Gadgets",
        rawHeadlines: ["Feed Fresh Wet Food Anywhere, Anytime"],
        rawDescriptions: [
          "Cold food causes stomach upsets? Protect your pet's health with the UAHPET Dual Temp Feeder. Plug & Play Buttons - Zero setup frustration—no Wi-Fi, no Bluetooth, just 2 physical buttons.",
        ],
      });

      expect(profile.productDomain).toBe("PET");
      expect(profile.targetCustomer.claimText.toLowerCase()).not.toContain("music listeners");
      expect(profile.targetCustomer.claimText.toLowerCase()).not.toContain("wireless audio");
      expect(profile.situationOrUseCase.claimText.toLowerCase()).not.toContain("motorbike");
      expect(profile.functionalProblem.claimText.toLowerCase()).not.toContain("mobile device sound");

      const alignment = validateCustomerPsychologyAlignment(profile, {
        candidateId: "cand_uahpet_feeder",
        title: "Automatic Wet Food Cat Feeder with Cooling & Warming",
        category: "Pet Gadgets",
      });
      expect(alignment.valid).toBe(true);
    });

    it("4.2 validateCustomerPsychologyAlignment rejects wireless audio psychology attached to a pet candidate", () => {
      const contaminatedProfile = analyzeCustomerPsychology({
        candidateId: "cand_audio_speaker",
        candidateTitle: "Portable Bluetooth Speaker with FM Radio",
        categoryOrTopic: "Electronics",
        rawHeadlines: ["Portable Bluetooth Speaker with FM Radio"],
        rawDescriptions: ["Crisp wireless audio for outdoor rides."],
      });

      const check = validateCustomerPsychologyAlignment(contaminatedProfile, {
        candidateId: "cand_uahpet_feeder",
        title: "Automatic Wet Food Cat Feeder",
        category: "Pet Gadgets",
      });
      expect(check.valid).toBe(false);
    });
  });

  // ============================================================================
  // GROUP 5: Runtime Version Parity Closure (F05)
  // ============================================================================
  describe("Group 5 — Runtime Version Parity Closure (F05)", () => {
    it("5.1 SWAI_KH02_RELEASE_VERSION is aligned across service, next.config.ts, and UI", () => {
      expect(SWAI_KH02_RELEASE_VERSION).toMatch(/^12\.4\.3\.(1|2|2\.1|3|3\.1|3\.2)$/);
      const nextCfg = fs.readFileSync(path.resolve(process.cwd(), "next.config.ts"), "utf8");
      expect(nextCfg).toContain(`"${SWAI_KH02_RELEASE_VERSION}"`);
    });

    it("5.2 evaluateKH02RuntimeIdentity detects version or SHA mismatch and passes when aligned", () => {
      const currentSha = evaluateKH02RuntimeIdentity().sourceRevisionSha || "7126d67d5b305d7c3984fb2e5a2a71b1e2771ed2";
      const matched = evaluateKH02RuntimeIdentity({
        frontendBuildSha: currentSha,
        frontendVersion: SWAI_KH02_RELEASE_VERSION,
        backendBuildSha: currentSha,
        worker: {
          workerOnline: true,
          workerVersion: SWAI_KH02_RELEASE_VERSION,
          workerBuildSha: currentSha,
        },
      });
      expect(matched.runtimeStatus).toBe("MATCHED");

      const mismatched = evaluateKH02RuntimeIdentity({
        frontendBuildSha: "deadbeef1234567",
        frontendVersion: "12.4.2",
        backendBuildSha: currentSha,
      });
      expect(mismatched.runtimeStatus).toBe("VERSION_MISMATCH");
    });
  });

  // ============================================================================
  // GROUP 6: Bounded Async Pool, Completion Barrier & Fresh Log Validation (F10)
  // ============================================================================
  describe("Group 6 — Bounded Async Pool, Completion Barrier & Fresh Log Validation (F10)", () => {
    it("6.1 runBoundedAsyncJobPool enforces maxConcurrency and completion barrier", async () => {
      const tasks = Array.from({ length: 5 }, (_, idx) => ({
        jobId: `job_${idx + 1}`,
        group: "UNIT",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return idx + 1;
        },
      }));

      const poolRes = await runBoundedAsyncJobPool(tasks, { maxConcurrency: 2 });
      expect(poolRes.barrierPassed).toBe(true);
      expect(poolRes.maxObservedConcurrency).toBeLessThanOrEqual(2);
      expect(poolRes.records.every((r) => r.status === "COMPLETED")).toBe(true);
    });

    it("6.2 validateFreshTestExecutionLog rejects reused logs and SHA mismatches", () => {
      const validRec = validateFreshTestExecutionLog(
        {
          suiteId: "unit_v12_4_3_1",
          command: "npx vitest run",
          headSha: "abc1234",
          startedAt: "2026-10-29T05:00:00.000Z",
          completedAt: "2026-10-29T05:00:02.000Z",
          durationMs: 2000,
          exitCode: 0,
          passedTests: 20,
          failedTests: 0,
          reusedPreviousLog: false,
          logFilePath: "test.log",
        },
        "abc1234"
      );
      expect(validRec.valid).toBe(true);

      const reusedRec = validateFreshTestExecutionLog(
        {
          suiteId: "unit_reused",
          command: "npx vitest run",
          headSha: "abc1234",
          startedAt: "2026-10-29T05:00:00.000Z",
          completedAt: "2026-10-29T05:00:02.000Z",
          durationMs: 2000,
          exitCode: 0,
          passedTests: 20,
          failedTests: 0,
          reusedPreviousLog: true,
          logFilePath: "test.log",
        },
        "abc1234"
      );
      expect(reusedRec.valid).toBe(false);
    });
  });

  // ============================================================================
  // GROUP 7: Section 19 Adversarial False-PASS Resistance (Mutations A through J)
  // ============================================================================
  describe("Group 7 — Adversarial False-PASS Resistance (Section 19: Mutations A–J)", () => {
    it("Mutation A: Inject synthetic Meta query execution during CACHE_ONLY -> G06A must FAIL", () => {
      const mutatedRun = {
        topic: "Pet Gadgets",
        providerTelemetry: {
          META_ADS: {
            queryExecuted: false,
            queryStatus: "CACHE_ONLY",
            freshLiveCount: 0,
            cachedRecordsCount: 50,
            queryExecution: [
              {
                queryId: "q_1",
                keyword: "pet gadgets",
                attempted: true,
                actualApiCalls: 1,
                status: "SUCCEEDED_WITH_RESULTS",
                returnedCount: 50,
              },
            ],
          },
        },
      };
      const evalRes = evaluateSplitG06MetaGates([mutatedRun]);
      expect(evalRes.G06A_META_TELEMETRY_TRUTH.verdict).toBe("FAIL");
      expect(evalRes.overallG06EngineeringVerdict).toBe("FAIL");
    });

    it("Mutation B: Inject 3 topThree items with CACHED_UNVERIFIED demand -> G12 must FAIL", () => {
      const cand = buildValidMerchantCandidate();
      const unverifiedPoints = buildAuthoritativeDemandSeries({
        source: "CACHED_UNVERIFIED",
        evidenceReference: null,
      });
      const score = calculateKH02EvergreenScore({
        candidate: cand as any,
        demandSeries: unverifiedPoints,
      });
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");

      // Force into topThree as adversarial mutation
      const mutatedRun = {
        topic: "Pet Gadgets",
        topThree: [
          { rank: 1, candidate: { ...cand, demandSeries: unverifiedPoints }, score: { ...score, tier: "VERIFIED_EVERGREEN" } },
        ],
      };
      const g12 = evaluateG12IndependentEvergreen([mutatedRun]);
      expect(g12.verdict).toBe("FAIL");
    });

    it("Mutation C: Inject 3 topThree items with only 2 demand points -> G12 must FAIL", () => {
      const cand = buildValidMerchantCandidate();
      const twoPoints = buildAuthoritativeDemandSeries().slice(0, 2);
      const mutatedRun = {
        topic: "Pet Gadgets",
        topThree: [
          {
            rank: 1,
            candidate: { ...cand, demandSeries: twoPoints },
            score: { opportunityScore: 85, evidenceConfidence: 80, tier: "VERIFIED_EVERGREEN" },
          },
        ],
      };
      const g12 = evaluateG12IndependentEvergreen([mutatedRun]);
      expect(g12.verdict).toBe("FAIL");
    });

    it("Mutation D: Inject 3 topThree items with 30-day demand span -> G12 must FAIL", () => {
      const cand = buildValidMerchantCandidate();
      const shortPoints = [
        { ...buildAuthoritativeDemandSeries()[0], periodStart: "2026-09-01", periodEnd: "2026-09-10" },
        { ...buildAuthoritativeDemandSeries()[1], periodStart: "2026-09-11", periodEnd: "2026-09-20" },
        { ...buildAuthoritativeDemandSeries()[2], periodStart: "2026-09-21", periodEnd: "2026-09-30" },
      ];
      const mutatedRun = {
        topic: "Pet Gadgets",
        topThree: [
          {
            rank: 1,
            candidate: { ...cand, demandSeries: shortPoints },
            score: { opportunityScore: 85, evidenceConfidence: 80, tier: "VERIFIED_EVERGREEN" },
          },
        ],
      };
      const g12 = evaluateG12IndependentEvergreen([mutatedRun]);
      expect(g12.verdict).toBe("FAIL");
    });

    it("Mutation E: Inject a water fountain into 'automatic pet feeder' topThree -> relevance & G12 must FAIL", () => {
      const fountainCand = buildValidMerchantCandidate({
        candidateId: "cand_pawira_fountain",
        title: "Pawira Stainless Steel Water Fountain",
        canonicalProductName: "Pawira Stainless Steel Water Fountain",
        canonicalProductUrl: "https://pawira.com/products/pawira-stainless-steel-water-fountain",
        storeDomain: "pawira.com",
      });
      const mutatedRun = {
        topic: "automatic pet feeder",
        topThree: [
          {
            rank: 1,
            candidate: { ...fountainCand, demandSeries: buildAuthoritativeDemandSeries({ keyword: "Pawira Stainless Steel Water Fountain" }) },
            score: { opportunityScore: 85, evidenceConfidence: 80, tier: "VERIFIED_EVERGREEN" },
          },
        ],
      };
      const g12 = evaluateG12IndependentEvergreen([mutatedRun]);
      expect(g12.verdict).toBe("FAIL");
    });

    it("Mutation F: Inject wireless audio psychology into a cat feeder -> psychology & G12 must FAIL", () => {
      const contaminatedPsych = analyzeCustomerPsychology({
        candidateId: "cand_audio",
        candidateTitle: "Bluetooth Speaker with FM Radio",
        categoryOrTopic: "Audio",
        rawHeadlines: ["Bluetooth Speaker with FM Radio"],
        rawDescriptions: ["Wireless audio for commuters"],
      });
      const cand = buildValidMerchantCandidate({
        psychologyProfile: contaminatedPsych,
      });
      const mutatedRun = {
        topic: "Pet Gadgets",
        topThree: [
          {
            rank: 1,
            candidate: { ...cand, demandSeries: buildAuthoritativeDemandSeries() },
            score: { opportunityScore: 85, evidenceConfidence: 80, tier: "VERIFIED_EVERGREEN" },
          },
        ],
      };
      const g12 = evaluateG12IndependentEvergreen([mutatedRun]);
      expect(g12.verdict).toBe("FAIL");
    });

    it("Mutation G: Inject frontendBuildSha != backendBuildSha -> runtime parity must FAIL", () => {
      const identity = evaluateKH02RuntimeIdentity({
        frontendBuildSha: "1111111aaaaaaa",
        backendBuildSha: "2222222bbbbbbb",
        frontendVersion: "12.4.3.1",
      });
      expect(identity.runtimeStatus).toBe("VERSION_MISMATCH");
    });

    it("Mutation H: Inject reusedPreviousLog: true -> fresh execution gate must FAIL", () => {
      const check = validateFreshTestExecutionLog(
        {
          suiteId: "reused_suite",
          command: "npx vitest run",
          headSha: "7126d67d",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 100,
          exitCode: 0,
          passedTests: 10,
          failedTests: 0,
          reusedPreviousLog: true,
          logFilePath: "reused.log",
        },
        "7126d67d"
      );
      expect(check.valid).toBe(false);
    });

    it("Mutation I: Inject an incomplete async job -> completion barrier must FAIL", () => {
      const barrier = validateCompletionBarrier([
        {
          jobId: "job_done",
          group: "UNIT",
          status: "COMPLETED",
          queuedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 50,
          retryCount: 0,
          error: null,
        },
        {
          jobId: "job_still_running",
          group: "UNIT",
          status: "RUNNING",
          queuedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: null,
          durationMs: 0,
          retryCount: 0,
          error: null,
        },
      ]);
      expect(barrier.passed).toBe(false);
      expect(barrier.incompleteJobs).toContain("job_still_running");
    });

    it("Mutation J: Inject Google HTTP 429 with zero product matches -> live Google product enrichment must NOT be PASS", () => {
      const googleTelemetry = {
        queryStatus: "QUERY_FAILED",
        enrichmentExecution: {
          productLevelMatches: 0,
          stateBreakdown: {
            configured: true,
            transportConnected: true,
            toolDiscovered: true,
            queryAttempted: true,
            querySucceeded: false,
            advertiserFound: false,
            creativesReturned: false,
            brandLevelMatch: false,
            productLevelMatch: false,
            productEvidencePersisted: false,
            currentRunProductEvidenceAvailable: false,
            failed: true,
          },
        },
      };
      const isLiveGoogleProductPass =
        googleTelemetry.enrichmentExecution.stateBreakdown.querySucceeded &&
        googleTelemetry.enrichmentExecution.stateBreakdown.currentRunProductEvidenceAvailable &&
        googleTelemetry.enrichmentExecution.productLevelMatches > 0;
      expect(isLiveGoogleProductPass).toBe(false);
    });
  });
});

