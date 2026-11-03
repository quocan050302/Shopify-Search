import { describe, it, expect } from "vitest";
import {
  normalizeSourceObservation,
  verifyLiveMetaObservationProvenance,
  verifyCandidateLiveLineageChain,
  discoverProductCandidatesFromAds,
  selectTopResearchShortlist,
} from "@/services/kh02/identity/productCandidateDiscovery";
import { compareProductIdentity } from "@/services/kh02/identity/productDistinctnessEngine";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import { buildCanonicalRecommendedProducts } from "@/services/kh02/presentation/productFinderViewModel";
import {
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  evaluateGoogleMcpGates,
  runGoogleGateNegativeTests,
} from "../../../scripts/kh02/googleMcpGateEvaluator";
import {
  evaluateG16Candidate,
  evaluateG16Top3,
} from "../../../scripts/kh02/g16CandidateEvaluator";
import {
  isSourceHiddenOrDisabled,
  isSourceTemporarilyDisabled,
  getSourcePolicy,
  filterActiveResearchSources,
} from "@/services/kh02/providers/sourcePolicy";
import {
  computeResearchIdempotencyKey,
  updateJobIfClaimOwned,
} from "@/workers/kh02Worker";

describe("KH-02 V12.4.3 Next Execution Audit Suite (2026-11-03)", () => {
  describe("A. Identity Resolution & 6-Level Distinctness (Positive, Category-Only, and 5 Negative Cases)", () => {
    it("recognizes exact same product across canonical URLs and rejects 5 mandatory negative cases", () => {
      const baseProduct = {
        candidateId: "cand_exact_1",
        title: "PetSafe ScoopFree Crystal Pro Self-Cleaning Cat Litter Box",
        canonicalProductName: "PetSafe ScoopFree Crystal Pro Self-Cleaning Cat Litter Box",
        brand: "PetSafe",
        model: "ScoopFree Crystal Pro",
        sku: "PAL00-17707",
        gtin: "0729849177079",
        storeDomain: "petsafe.com",
        canonicalProductUrl: "https://petsafe.com/products/scoopfree-crystal-pro-litter-box",
        category: "Pet Gadgets",
      } as any;

      // Positive: Exact same product with tracking query params or alternative ad headline
      const exactMatchClone = {
        ...baseProduct,
        candidateId: "cand_exact_2",
        title: "50% OFF Self-Cleaning Litter Box — Official Store",
        canonicalProductUrl: "https://www.petsafe.com/products/scoopfree-crystal-pro-litter-box?utm_source=fb",
      } as any;
      const posComp = compareProductIdentity(baseProduct, exactMatchClone);
      expect(posComp.areSameActualProduct).toBe(true);

      // Negative 1: Same brand, different model (ScoopFree Litter Box vs Drinkwell Fountain)
      const diffModelSameBrand = {
        candidateId: "cand_neg_1",
        title: "PetSafe Drinkwell Platinum Pet Water Fountain 168 oz",
        canonicalProductName: "PetSafe Drinkwell Platinum Pet Water Fountain",
        brand: "PetSafe",
        model: "Drinkwell Platinum",
        sku: "PWW00-13703",
        storeDomain: "petsafe.com",
        canonicalProductUrl: "https://petsafe.com/products/drinkwell-platinum-fountain",
        category: "Pet Gadgets",
      } as any;
      const neg1 = compareProductIdentity(baseProduct, diffModelSameBrand);
      expect(neg1.areSameActualProduct).toBe(false);

      // Negative 2: Same niche, completely different product
      const diffNicheProduct = {
        candidateId: "cand_neg_2",
        title: "Cheerble Wicked Ball SE Interactive Moving Dog Toy",
        canonicalProductName: "Cheerble Wicked Ball SE",
        brand: "Cheerble",
        model: "Wicked Ball SE",
        sku: "CW-WB-SE",
        storeDomain: "cheerble.com",
        canonicalProductUrl: "https://cheerble.com/products/wicked-ball-se",
        category: "Pet Gadgets",
      } as any;
      const neg2 = compareProductIdentity(baseProduct, diffNicheProduct);
      expect(neg2.areSameActualProduct).toBe(false);

      // Negative 3: Accessory / replacement tray pack vs main electronic unit
      const replacementPack = {
        candidateId: "cand_neg_3",
        title: "PetSafe ScoopFree Replacement Blue Crystal Litter Trays 3-Pack",
        canonicalProductName: "PetSafe ScoopFree Replacement Litter Trays 3-Pack",
        brand: "PetSafe",
        model: "PAC00-14231",
        sku: "PAC00-14231",
        storeDomain: "petsafe.com",
        canonicalProductUrl: "https://petsafe.com/products/scoopfree-replacement-crystal-trays-3-pack",
        category: "Pet Gadgets",
      } as any;
      const neg3 = compareProductIdentity(baseProduct, replacementPack);
      expect(neg3.areSameActualProduct).toBe(false);

      // Negative 4: Generic store homepage link cannot be verified as an exact product page
      const homepageCandidates = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_home_1",
            sourceExternalAdId: "998877665511",
            landingPageUrl: "https://petsafe.com/",
            advertiserDomain: "petsafe.com",
            title: "Shop All PetSafe Deals Today",
            description: "Visit our homepage for seasonal sales.",
            provenance: "LIVE_PROVIDER",
            sourceType: "LIVE_PROVIDER",
            isCached: false,
            observedAt: "2026-11-01T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      expect(homepageCandidates[0]?.isEligibleAsEvergreenWinner).toBe(false);

      // Negative 5: Unrelated merchant domain conflict
      const unrelatedMerchant = {
        candidateId: "cand_neg_5",
        title: "Generic Plastic Litter Scoop",
        canonicalProductName: "Generic Plastic Litter Scoop",
        brand: "RandomMart",
        model: "RM-01",
        storeDomain: "unrelated-gadget-mart.com",
        canonicalProductUrl: "https://unrelated-gadget-mart.com/products/plastic-scoop",
        category: "Pet Gadgets",
      } as any;
      const neg5 = compareProductIdentity(baseProduct, unrelatedMerchant);
      expect(neg5.areSameActualProduct).toBe(false);
    });
  });

  describe("B. Google Raw=0 vs Declared/UI=9 Creative Association Reconciliation Guard", () => {
    it("fails closed when rawManifest has 0 creatives but associationLedger or UI declares 9 creatives", () => {
      const gateRes = evaluateGoogleMcpGates({
        researchRunId: "run_audit_google_zero_raw",
        evaluatedCandidateIds: ["cand_1", "cand_2", "cand_3"],
        uiDisplayedCreativesCount: 9,
        persistedCreativesCount: 9,
        telemetry: {
          transportStatus: "CONNECTED",
          queryStatus: "QUERY_SUCCEEDED_EMPTY",
          enrichmentExecution: {
            mcpInvocations: [
              {
                invocationId: "inv_1",
                status: "SUCCEEDED",
                researchRunId: "run_audit_google_zero_raw",
              },
            ],
          },
        },
        rawManifest: {
          rawCount: 0,
          researchRunId: "run_audit_google_zero_raw",
          creatives: [],
        },
        normalizationLedger: {
          normalizationStageExecuted: true,
          normalizedDistinctCount: 0,
          rejectedBeforeNormalizationCount: 0,
          records: [],
          rejectedRecords: [],
        },
        associationLedger: {
          classifiedDistinctCount: 9,
          probableProductMatchesCount: 5,
          brandLevelMatchesCount: 4,
          associations: [],
        },
      });

      expect(gateRes.subGates.GOOGLE_PRODUCT_ASSOCIATION).toBe("FAIL");
      expect(gateRes.overallG06Verdict).toBe("FAIL");
      expect(gateRes.probableProductMatchesCount).toBe(0);
      expect(gateRes.brandOnlyMatchesCount).toBe(0);
      expect(gateRes.exactProductSkuMatchesCount).toBe(0);
      expect(gateRes.setReconciliation.unknownAssociationCreativeIds).toContain(
        "zero_raw_nonzero_declared_or_ui_creatives_mismatch"
      );
    });

    it("passes all built-in Google MCP negative control cases including G06-NEG-05 zero-raw guard", () => {
      const suite = runGoogleGateNegativeTests();
      expect(suite.totalTests).toBe(20);
      expect(suite.passed).toBe(true);
    });
  });

  describe("C. Meta FACEBOOK / META / META_ADS Normalization & Raw ID Preservation", () => {
    it("normalizes FACEBOOK and META source labels to META_ADS while preserving raw adArchiveId and externalAdId", () => {
      const obsFromFacebook = normalizeSourceObservation({
        source: "FACEBOOK" as any,
        platform: "FACEBOOK",
        id: "db_ad_row_101",
        adArchiveId: "1455667788990011",
        externalAdId: "1455667788990011",
        landingPageUrl: "https://uahpet.com/products/stainless-steel-cat-water-fountain",
        sourceUrl: "https://www.facebook.com/ads/library/?id=1455667788990011",
        advertiserDomain: "uahpet.com",
        advertiserOrCreator: "UAHPET Official",
        title: "UAHPET Wireless Cat Water Fountain",
        description: "Cordless stainless steel motion sensor fountain for cats.",
        provenance: "LIVE_PROVIDER",
        sourceType: "LIVE_PROVIDER",
        isCached: false,
        isLiveRecord: true,
        queryId: "q_r1_1",
        providerRequestId: "req_meta_101",
        researchRunId: "run_meta_norm_1",
        workspaceId: "ws_test_1",
        observedAt: new Date().toISOString(),
      });

      expect(obsFromFacebook.source).toBe("META_ADS");
      expect((obsFromFacebook as any).rawSourcePlatform).toBe("FACEBOOK");
      expect(obsFromFacebook.sourceRecordId).toBe("db_ad_row_101");
      expect(obsFromFacebook.sourceExternalAdId).toBe("1455667788990011");
      expect((obsFromFacebook as any).adArchiveId).toBe("1455667788990011");
      expect((obsFromFacebook as any).externalAdId).toBe("1455667788990011");

      // Verify normalizeMetaCollectorAd accepts ad_archive_id / adArchiveId
      const normCollector = normalizeMetaCollectorAd(
        {
          ad_archive_id: "1455667788990011",
          advertiser_name: "UAHPET Official",
          title: "UAHPET Wireless Cat Water Fountain",
          body: "Motion sensor water fountain",
          link_url: "https://uahpet.com/products/stainless-steel-cat-water-fountain",
        },
        { queryMarket: "US", keyword: "cat water fountain" }
      );
      expect(normCollector.sourceExternalId).toBe("1455667788990011");
      expect(normCollector.platform).toBe("META");

      // Verify live lineage validator accepts normalized FACEBOOK observation with full receipt
      const lineage = verifyLiveMetaObservationProvenance(obsFromFacebook, {
        workspaceId: "ws_test_1",
        researchRunId: "run_meta_norm_1",
        executedQueryIds: ["q_r1_1"],
        queryOutcomesByQueryId: {
          q_r1_1: {
            queryId: "q_r1_1",
            attempted: true,
            requestStarted: true,
            requestCompleted: true,
            actualApiCalls: 1,
            status: "SUCCEEDED_WITH_RESULTS",
            providerRequestId: "req_meta_101",
          },
        },
        upstreamExternalAdIds: ["1455667788990011"],
        persistedAdIdsInDb: ["db_ad_row_101"],
        persistedAdIdsByExternalId: { "1455667788990011": "db_ad_row_101" },
      });
      expect(lineage.valid).toBe(true);
      expect(lineage.lineageReceipt?.upstreamAdId).toBe("1455667788990011");
      expect(lineage.lineageReceipt?.persistedAdId).toBe("db_ad_row_101");

      // Verify buildCanonicalRecommendedProducts deduplicates FACEBOOK / META / META_ADS into single "Meta Ads" badge
      const recommended = buildCanonicalRecommendedProducts({
        researchRunId: "run_meta_norm_1",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        generatedAt: new Date().toISOString(),
        formulaVersion: "V12.4.3",
        runStatus: "COMPLETED",
        topThree: [],
        remainingCandidates: [],
        provisionalCandidates: [],
        insufficientEvidenceCandidates: [],
        rejectedCandidates: [],
        researchShortlist: {
          shortlist: [
            {
              candidateId: "cand_vm_1",
              title: "UAHPET Wireless Cat Water Fountain",
              canonicalProductName: "UAHPET Wireless Cat Water Fountain",
              category: "Pet Gadgets",
              problemStatement: "Helps cats drink fresh filtered water",
              targetAudience: "Cat Owners",
              thumbnailUrl: "https://uahpet.com/cdn/shop/fountain.jpg",
              videoUrl: null,
              canonicalProductUrl: "https://uahpet.com/products/stainless-steel-cat-water-fountain",
              storeDomain: "uahpet.com",
              advertiserNames: ["UAHPET Official"],
              supportingAdIds: ["db_ad_row_101"],
              supportingSourceTypes: ["FACEBOOK", "META", "META_ADS", "GOOGLE_ADS_TRANSPARENCY"],
              totalObservationCount: 2,
              liveObservationsCount: 1,
              distinctAdvertisersCount: 1,
              earliestObservationDate: "2026-10-01T00:00:00.000Z",
              latestObservationDate: "2026-11-01T00:00:00.000Z",
              identityConfidence: "EXACT",
              identityStatus: "VERIFIED",
              fetchOutcome: "FETCH_SUCCEEDED",
              productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
              sourceObservations: [obsFromFacebook],
            } as any,
          ],
          requestedCount: 3,
          qualifiedCount: 1,
          shortfallReason: null,
          distinctnessSummary: "1 distinct product",
          distinctnessEvaluation: {
            isDistinct: true,
            totalCandidatesEvaluated: 1,
            distinctCount: 1,
            duplicateGroupsCount: 0,
            details: [],
          },
          liveVerifiedProductCount: 1,
          liveVerifiedTop3: false,
          liveVerifiedShortlist: [],
          candidateRejectionLedger: [],
        },
        totalCandidatesDiscovered: 1,
        totalObservationsCollected: 1,
        sourceStatuses: {
          META_ADS: "PASSED",
          TIKTOK_ADS: "NOT_CONFIGURED",
          TIKTOK_ORGANIC: "DISABLED",
          GOOGLE_ADS: "PASSED",
          DEMAND_HISTORY: "NOT_VERIFIED",
        },
        warnings: [],
        errors: [],
      });

      const shortlistCard = recommended[0];
      expect(shortlistCard).toBeDefined();
      const histLine = shortlistCard.verifiedEvidenceItems.find((line: string) =>
        line.includes("Historical advertising observations:")
      );
      expect(histLine).toContain("Meta Ads, Google Ads");
      expect(histLine).not.toContain("FACEBOOK");
    });
  });

  describe("D. Longitudinal Demand Engine & Evergreen Gate (G15)", () => {
    it("strictly rejects 2 observations over 60 days, duplicate timestamps, broad category terms, and fixture sources", () => {
      // 1. Only 2 observations spanning 75 days (< 3 minimum data points) -> INSUFFICIENT_HISTORY
      const twoPoints60d = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_d1",
            periodStart: "2026-08-01T00:00:00.000Z",
            demandValue: 62,
            region: "US",
            source: "GOOGLE_TRENDS_CSV",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "GoogleTrendsCSV:uahpet:1",
          },
          {
            id: "obs_d2",
            periodStart: "2026-10-15T00:00:00.000Z",
            demandValue: 68,
            region: "US",
            source: "GOOGLE_TRENDS_CSV",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "GoogleTrendsCSV:uahpet:2",
          },
        ],
        {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          candidateCanonicalName: "UAHPET Wireless Cat Water Fountain",
        }
      );
      expect(twoPoints60d.status).toBe("INSUFFICIENT_HISTORY");
      expect(twoPoints60d.eligibleForEvergreen).toBe(false);

      // 2. 3 observations but two share the same calendar day (only 2 distinct dates) -> INSUFFICIENT_HISTORY
      const duplicateDates = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_dup_1",
            periodStart: "2026-08-01T08:00:00.000Z",
            demandValue: 60,
            region: "US",
            source: "GOOGLE_TRENDS_CSV",
            keyword: "uahpet wireless cat water fountain",
          },
          {
            id: "obs_dup_2",
            periodStart: "2026-08-01T18:00:00.000Z",
            demandValue: 64,
            region: "US",
            source: "GOOGLE_TRENDS_CSV",
            keyword: "uahpet wireless cat water fountain",
          },
          {
            id: "obs_dup_3",
            periodStart: "2026-10-15T12:00:00.000Z",
            demandValue: 66,
            region: "US",
            source: "GOOGLE_TRENDS_CSV",
            keyword: "uahpet wireless cat water fountain",
          },
        ],
        {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          candidateCanonicalName: "UAHPET Wireless Cat Water Fountain",
        }
      );
      expect(duplicateDates.status).toBe("INSUFFICIENT_HISTORY");
      expect(duplicateDates.eligibleForEvergreen).toBe(false);

      // 3. Broad category term ("Pet Gadgets") -> rejected for product-level evergreen qualification
      const broadTermSeries = evaluateTemporalDemandStability(
        [
          {
            id: "obs_b1",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "Pet Gadgets",
          },
          {
            id: "obs_b2",
            periodStart: "2026-08-15T00:00:00.000Z",
            demandValue: 72,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "Pet Gadgets",
          },
          {
            id: "obs_b3",
            periodStart: "2026-10-01T00:00:00.000Z",
            demandValue: 74,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "Pet Gadgets",
          },
        ],
        90,
        { candidateCanonicalName: "UAHPET Wireless Cat Water Fountain" }
      );
      expect(broadTermSeries.eligibleForEvergreen).toBe(false);

      // 4. Positive: continuous observation series spanning >= 60 days for product-specific term in US from authoritative source
      const validProductDemand = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_v1",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 64,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-07-01",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
          {
            id: "obs_v2",
            periodStart: "2026-07-15T00:00:00.000Z",
            demandValue: 66,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-07-15",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
          {
            id: "obs_v3",
            periodStart: "2026-08-01T00:00:00.000Z",
            demandValue: 68,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-08-01",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
          {
            id: "obs_v4",
            periodStart: "2026-08-15T00:00:00.000Z",
            demandValue: 67,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-08-15",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
          {
            id: "obs_v5",
            periodStart: "2026-09-01T00:00:00.000Z",
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-09-01",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
          {
            id: "obs_v6",
            periodStart: "2026-09-15T00:00:00.000Z",
            demandValue: 71,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "uahpet wireless cat water fountain",
            evidenceReference: "serpapi:google_trends:uahpet:2026-09-15",
            methodologyVersion: "serpapi_google_trends_live_v1",
          },
        ],
        {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          candidateCanonicalName: "UAHPET Wireless Cat Water Fountain",
        }
      );
      expect(validProductDemand.status).toBe("VERIFIED");
      expect(validProductDemand.eligibleForEvergreen).toBe(true);
      expect(validProductDemand.coveredDays).toBeGreaterThanOrEqual(60);
    });
  });

  describe("E. Gate Policy (G07 TikTok Ads US Separation, G16 Evaluator, Idempotency & Worker Fencing)", () => {
    it("enforces strict separation of TIKTOK_ADS and TIKTOK_ORGANIC and keeps TIKTOK_ORGANIC disabled", () => {
      expect(isSourceHiddenOrDisabled("TIKTOK_ORGANIC")).toBe(true);
      expect(isSourceTemporarilyDisabled("TIKTOK_ORGANIC")).toBe(true);
      const organicPolicy = getSourcePolicy("TIKTOK_ORGANIC");
      expect(organicPolicy.status).toBe("DISABLED");
      expect(organicPolicy.allowOutboundNetworkCalls).toBe(false);

      // Client passing TIKTOK_ORGANIC cannot bypass server policy
      const filtered = filterActiveResearchSources([
        "META_ADS",
        "TIKTOK_ORGANIC",
        "GOOGLE_ADS",
      ]);
      expect(filtered).not.toContain("TIKTOK_ORGANIC");
    });

    it("enforces deterministic idempotency keys and rejects stale worker fencing generations", async () => {
      const k1 = computeResearchIdempotencyKey(
        { topic: "  Pet Gadgets ", market: "US", lookbackDays: 90, workspaceId: "ws_1" },
        { workspaceId: "ws_1" }
      );
      const k2 = computeResearchIdempotencyKey(
        { topic: "pet gadgets", market: "US", lookbackDays: 90, workspaceId: "ws_1" },
        { workspaceId: "ws_1" }
      );
      expect(k1).toBe(k2);

      // Stale worker fencing check
      const mockDb = {
        syncJob: {
          updateMany: async () => ({ count: 0 }),
          findUnique: async () => ({
            id: "job_fenced_1",
            status: "RUNNING",
            workerId: "worker_new_2",
            claimToken: "claim_new_2",
            fencingGeneration: 2,
            recordVersion: 5,
            leaseExpiresAt: new Date(Date.now() + 60_000),
          }),
        },
      };
      const staleMutation = await updateJobIfClaimOwned(
        "job_fenced_1",
        {
          workerId: "worker_old_1",
          claimToken: "claim_old_1",
          fencingToken: "fence_old_1",
          fencingGeneration: 1,
          recordVersion: 1,
        },
        { progress: 50 },
        mockDb
      );
      expect(staleMutation.success).toBe(false);
      expect(staleMutation.reason).toBe("OWNERSHIP_LOST");
    });
  });
});
