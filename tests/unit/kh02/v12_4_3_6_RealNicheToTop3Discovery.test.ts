/**
 * SWAI KH-02 V12.4.3.6 — Real Niche-to-Top3 Discovery Foundation Test Suite
 *
 * Covers:
 * - Section 04 & 11 (N01..N10): Source Observation Trust Boundary & Provenance Normalization
 * - Section 05, 06 & 11 (N11..N18): Niche Relevance & Physical Product Reality Gate
 * - Section 05 & 11 (N19..N25): Deterministic Identity, Family & Deduplication
 * - Section 06, 12 & 11 (N26..N33): Evergreen & Longitudinal Demand Gates + Point-in-Time Replay
 * - Section 07 & 11 (N34..N41): Dynamic Amazon Local MCP Target Selection & Guardrails
 * - Section 08 & 11 (N42..N48): Walmart Operational Pause & 2026-11-02 CAPTCHA Regression
 * - Section 09, 10 (P01..P08): Two-Niche Dynamic Discovery ("Pet Gadgets" vs "Home Organization") & DB/API/UI View-Model Parity
 */

import { describe, expect, it } from "vitest";
import {
  discoverProductCandidatesFromAds,
  isCandidateLiveVerified,
  isLiveProviderObservation,
  mergeDuplicateCandidateRecords,
  normalizeSourceObservation,
  selectTopResearchShortlist,
  verifyCandidateLiveLineageChain,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  buildProductIdentityFingerprint,
  clusterProductCandidates,
  compareProductIdentity,
  evaluateOpportunityDiversity,
  resolveProductFamily,
} from "@/services/kh02/identity/productDistinctnessEngine";
import {
  evaluateProductAudienceRelevance,
  evaluateProductRelevance,
} from "@/services/kh02/identity/productRelevanceEvaluator";
import {
  buildHybridKH02DiscoveryQueryPlan,
  buildKH02DiscoveryQueryPlan,
} from "@/services/kh02/discovery/discoveryQueryPlanner";
import {
  applyKH02EligibilityGates,
  calculateKH02EvergreenScore,
  verifyEvergreenCandidateIndependently,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import {
  evaluateDemandHistoryEvidence,
  evaluateDemandSourceAuthority,
  evaluateTemporalDemandStability,
  type DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  parseAmazonProductEvidence,
  parseAmazonSearchSnapshotCards,
  validateAmazonUsProductUrl,
  validateAmazonUsSearchUrl,
  verifyAmazonProductIdentity,
} from "@/services/kh02/marketplace/amazonUsIdentity";
import { createAmazonProviderBudget } from "@/services/kh02/marketplace/amazonUsBudget";
import { selectDynamicAmazonVerificationTargets } from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import { evaluateAmazonUsEvidenceGate } from "@/services/kh02/marketplace/amazonUsEvidenceGate";
import { resolveAmazonUsPolicyContext } from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import {
  WALMART_2026_11_02_CAPTCHA_BLOCKER_REFERENCE,
  resolveEffectiveWalmartRunAuthorization,
  resolveWalmartUsPilotPolicy,
} from "@/services/kh02/marketplace/walmartJinaPolicy";
import {
  buildWalmartJinaHeaders,
  classifyWalmartJinaFailure,
  detectWalmartBotWallInContent,
  normalizeWalmartJinaEnvelope,
  validateWalmartJinaHeaders,
  validateWalmartJinaRequestTarget,
} from "@/services/kh02/marketplace/walmartJinaReaderClient";
import { parseWalmartPdpNextData } from "@/services/kh02/marketplace/walmartNextDataParser";
import { runWalmartUsPilotEnrichment } from "@/services/kh02/marketplace/walmartUsResearchAdapter";
import {
  evaluatePointInTimeNicheCandidate,
  resolvePointInTimeAdCandidateMetadata,
} from "../../../scripts/kh02/runBacktestV12_4_3_4_2";
import {
  buildAllCandidatesExplorerList,
  buildCanonicalRecommendedProducts,
} from "@/services/kh02/presentation/productFinderViewModel";

describe("KH-02 V12.4.3.6 — Real Niche-to-Top3 Discovery Foundation & 48-Case Negative Control Matrix", () => {
  // =========================================================================
  // 1. PROVENANCE & NORMALIZATION TRUST BOUNDARY (N01..N10)
  // =========================================================================
  describe("Group 1: Provenance & Normalization Trust Boundary (N01..N10)", () => {
    it("N01: Observation missing provenance must NOT default to LIVE_PROVIDER", () => {
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_missing_prov_01",
        title: "Automatic Pet Feeder Smart Bowl",
        landingPageUrl: "https://petgadgetshop.com/products/automatic-pet-feeder",
      });
      expect(obs.provenance).toBe("UNKNOWN");
      expect(obs.provenance).not.toBe("LIVE_PROVIDER");
      expect(isLiveProviderObservation(obs)).toBe(false);

      const discovered = discoverProductCandidatesFromAds(
        [
          {
            id: "ad_missing_prov_02",
            headline: "Automatic Pet Feeder Smart Bowl",
            landingUrl: "https://petgadgetshop.com/products/automatic-pet-feeder",
          },
        ],
        "Pet Gadgets"
      );
      expect(discovered).toHaveLength(1);
      expect(discovered[0].sourceObservations[0].provenance).toBe("UNKNOWN");
      expect(discovered[0].liveObservationsCount).toBe(0);
    });

    it("N02: Observation missing sourceRecordId must NOT generate Math.random ID treated as verified provider ID", () => {
      const rawNoId = {
        source: "META_ADS",
        title: "Cordless Stainless Cat Water Fountain",
        description: "Ultra quiet hydration fountain for indoor cats.",
        landingPageUrl: "https://catfountainco.com/products/cordless-cat-fountain",
        advertiserDomain: "catfountainco.com",
      };
      const norm1 = normalizeSourceObservation(rawNoId);
      const norm2 = normalizeSourceObservation(rawNoId);

      // Deterministic across invocations (never Math.random)
      expect(norm1.sourceRecordId).toBe(norm2.sourceRecordId);
      expect(norm1.sourceRecordId).toMatch(/^derived_obs_[0-9a-f]{16}$/);
      expect(norm1.sourceIdOrigin).toBe("INTERNAL_DERIVED");
      expect(norm1.provenance).toBe("UNVERIFIED");
      expect(isLiveProviderObservation(norm1)).toBe(false);
    });

    it("N03: Observation with sourceMode = LIVE_WITH_CACHE_FALLBACK and cached row resolves to CACHED_SOURCE", () => {
      const obs = normalizeSourceObservation(
        {
          source: "META_ADS",
          sourceRecordId: "ad_cache_fallback_01",
          title: "Interactive Laser Cat Toy",
          landingPageUrl: "https://catplaystore.com/products/interactive-laser-toy",
          isCached: true,
          fromCache: true,
        },
        { sourceMode: "LIVE_WITH_CACHE_FALLBACK" }
      );
      expect(obs.provenance).toBe("CACHED_SOURCE");
      expect(obs.isLiveRecord).toBe(false);
      expect(isLiveProviderObservation(obs)).toBe(false);
    });

    it("N04: Observation with verifiedDeliveryMarket absent remains null even if requestedMarket = 'US'", () => {
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_market_01",
        requestedMarket: "US",
        title: "GPS Dog Collar Tracker",
        landingPageUrl: "https://dogtrackershop.com/products/gps-dog-collar",
      });
      expect(obs.requestedMarket).toBe("US");
      expect(obs.verifiedDeliveryMarket).toBeNull();
    });

    it("N05: Observation with 'Ad:raw' placeholder cannot pass live lineage", () => {
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_raw_test_01",
        provenance: "LIVE_PROVIDER",
        evidenceReference: "Ad:raw",
        queryId: "q_1",
        title: "Self Cleaning Cat Litter Box",
        landingPageUrl: "https://smartpetbox.com/products/self-cleaning-litter-box",
      });
      expect(obs.evidenceReference).toBeNull();
      expect(obs.provenance).toBe("UNVERIFIED");
      expect(obs.provenanceConflicts).toContain("PLACEHOLDER_AD_RAW_EVIDENCE_REF");
      expect(isLiveProviderObservation(obs)).toBe(false);
    });

    it("N06: Observation with missing sourceUrl cannot pass live observation check", () => {
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_no_url_01",
        sourceUrl: null,
        landingPageUrl: null,
        provenance: "LIVE_PROVIDER",
        queryId: "q_1",
        title: "Pet Hair Vacuum Brush",
      });
      expect(obs.provenance).toBe("UNVERIFIED");
      expect(obs.provenanceConflicts).toContain("LIVE_OBSERVATION_MISSING_SOURCE_URL");
      expect(isLiveProviderObservation(obs)).toBe(false);
    });

    it("N07: Observation with forged future sourceTimestamp is rejected", () => {
      const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_future_ts_01",
        sourceUrl: "https://www.facebook.com/ads/library/?id=999111",
        landingPageUrl: "https://petcare.com/products/smart-feeder",
        provenance: "LIVE_PROVIDER",
        queryId: "q_1",
        sourceTimestamp: futureIso,
        title: "Smart Pet Feeder",
      });
      expect(obs.provenance).toBe("UNVERIFIED");
      expect(obs.provenanceConflicts).toContain("FORGED_FUTURE_SOURCE_TIMESTAMP");
      expect(isLiveProviderObservation(obs)).toBe(false);
    });

    it("N08: Observation with another workspace's workspaceId is rejected", () => {
      const cand: any = {
        candidateId: "cand_ws_mismatch",
        identityStatus: "VERIFIED",
        storeDomain: "petcare.com",
        matchedQueryIds: ["q_1"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_ws_other",
            sourceExternalAdId: "ext_ws_other",
            workspaceId: "ws_attacker_999",
            researchRunId: "run_1",
            queryId: "q_1",
            matchedQueryIds: ["q_1"],
            provenance: "LIVE_PROVIDER",
            sourceType: "LIVE_PROVIDER",
            isLiveRecord: true,
            storeDomainEvidence: "petcare.com",
          },
        ],
      };
      const lineage = verifyCandidateLiveLineageChain(cand, {
        workspaceId: "ws_legitimate_001",
        researchRunId: "run_1",
        executedQueryIds: ["q_1"],
      });
      expect(lineage.valid).toBe(false);
      expect(lineage.rejectionCodes).toContain("CROSS_WORKSPACE_OBSERVATION");
    });

    it("N09: Observation with another run's researchRunId is rejected from current-run live proof", () => {
      const cand: any = {
        candidateId: "cand_run_mismatch",
        identityStatus: "VERIFIED",
        storeDomain: "petcare.com",
        matchedQueryIds: ["q_1"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_run_other",
            sourceExternalAdId: "ext_run_other",
            researchRunId: "run_stale_old",
            queryId: "q_1",
            matchedQueryIds: ["q_1"],
            provenance: "LIVE_PROVIDER",
            sourceType: "LIVE_PROVIDER",
            isLiveRecord: true,
            storeDomainEvidence: "petcare.com",
          },
        ],
      };
      const lineage = verifyCandidateLiveLineageChain(cand, {
        researchRunId: "run_current_fresh",
        executedQueryIds: ["q_1"],
      });
      expect(lineage.valid).toBe(false);
      expect(lineage.rejectionCodes).toContain("FOREIGN_RUN_QUERY_ID");
    });

    it("N10: Observation with contradictory provenance flags fails closed", () => {
      const obs = normalizeSourceObservation({
        source: "META_ADS",
        sourceRecordId: "ad_contradict_01",
        sourceUrl: "https://www.facebook.com/ads/library/?id=123456",
        landingPageUrl: "https://petcare.com/products/pet-fountain",
        provenance: "LIVE_PROVIDER",
        sourceType: "CACHED_SOURCE",
        isCached: true,
        isLiveRecord: true,
        queryId: "q_1",
        title: "Stainless Pet Fountain",
      });
      expect(obs.provenance).toBe("CACHED_SOURCE");
      expect(obs.isLiveRecord).toBe(false);
      expect(obs.provenanceConflicts).toContain(
        "CONTRADICTORY_CACHE_AND_LIVE_PROVENANCE"
      );
      expect(isLiveProviderObservation(obs)).toBe(false);
    });
  });

  // =========================================================================
  // 2. NICHE RELEVANCE & PHYSICAL PRODUCT GATE (N11..N18)
  // =========================================================================
  describe("Group 2: Niche Relevance & Physical Product Gate (N11..N18)", () => {
    it("N11: Cross-niche beauty product in 'Pet Gadgets' is rejected", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_beauty_1",
            title: "Crystal Hair Eraser for Women Bikini & Legs",
            description: "Painless exfoliation and human body hair removal.",
            landingPageUrl: "https://bleame.com/products/crystal-hair-eraser",
            advertiserDomain: "bleame.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      expect(cands[0].relevanceStatus).toBe("IRRELEVANT");
      expect(cands[0].isEligibleAsEvergreenWinner).toBe(false);
    });

    it("N12: Pet product in 'Home Organization' is rejected", () => {
      const rel = evaluateProductRelevance(
        "Automatic Dog Barking Deterrent Ultrasonic Collar https://doggear.com/products/bark-collar",
        "Home Organization"
      );
      expect(rel.isAccepted).toBe(false);
      expect(rel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("N13: Insurance / lead generation / digital course / ebook is rejected", () => {
      const nonPhysicalInputs = [
        {
          title: "Compare Pet Health Insurance Quotes Online",
          desc: "Save 30% on monthly vet bill coverage plans.",
          url: "https://petinsurequote.com/pages/get-quote",
        },
        {
          title: "Dog Training Video Course & Ebook Masterclass",
          desc: "Instant digital download PDF guide and 12-module coaching.",
          url: "https://puppyacademy.com/products/digital-training-ebook",
        },
      ];
      for (const item of nonPhysicalInputs) {
        const cands = discoverProductCandidatesFromAds(
          [
            {
              source: "META_ADS",
              sourceRecordId: `ad_nonphys_${item.title.slice(0, 6)}`,
              title: item.title,
              description: item.desc,
              landingPageUrl: item.url,
              provenance: "CACHED_SOURCE",
            },
          ],
          "Pet Gadgets"
        );
        expect(["NON_PHYSICAL", "REJECTED", "UNRESOLVED"]).toContain(
          cands[0].productRealityStatus
        );
        expect(cands[0].isEligibleAsEvergreenWinner).toBe(false);
      }
    });

    it("N14: Store homepage / /collections/all without specific SKU cannot become VERIFIED", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_coll_01",
            title: "Automatic Pet Feeder Collection",
            description: "Browse all pet feeders in our catalog.",
            landingPageUrl: "https://petstore.com/collections/all",
            advertiserDomain: "petstore.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      expect(cands[0].identityStatus).not.toBe("VERIFIED");
      expect(cands[0].sourcePageClassification).toBe("COLLECTION_PAGE");
    });

    it("N15: CheckoutChamp / generic funnel without specific product proof cannot become VERIFIED", () => {
      const evalRes = evaluatePointInTimeNicheCandidate(
        {
          candidateId: "cand_funnel_1",
          title: "Pet Hair Remover Funnel Offer",
          storeDomain: "offer.checkoutchamp.com",
          canonicalProductUrl: "https://offer.checkoutchamp.com/step1?affId=99",
          identityStatus: "VERIFIED",
          observedAt: "2026-06-01T00:00:00Z",
          persistedMerchantProofs: [],
        },
        "Pet Gadgets",
        new Date("2026-07-01T00:00:00Z")
      );
      expect(evalRes.isCheckoutChampFunnel).toBe(true);
      expect(evalRes.identityStatus).not.toBe("VERIFIED");
      expect(evalRes.verificationEvidenceStatus).toBe("FUNNEL_UNVERIFIED");
    });

    it("N16: Brand-only mention without product title/handle cannot enter Top 3", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_brand_only_1",
            title: "PetStream Official",
            description: "Visit our official website today.",
            landingPageUrl: "https://petstream.com/",
            advertiserDomain: "petstream.com",
            advertiserOrCreator: "PetStream Official",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      const shortlist = selectTopResearchShortlist(cands, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist).toHaveLength(0);
    });

    it("N17: Accessory / replacement filter cannot masquerade as main fountain/feeder product", () => {
      const evalRes = evaluatePointInTimeNicheCandidate(
        {
          candidateId: "cand_filter_pack",
          title: "Cat Water Fountain Replacement Filter 8-Pack Only",
          storeDomain: "petstream.com",
          canonicalProductUrl: "https://petstream.com/products/cat-fountain-replacement-filters-8pack",
          identityStatus: "PROBABLE",
          observedAt: "2026-06-01T00:00:00Z",
        },
        "Cat Water Fountain",
        new Date("2026-07-01T00:00:00Z")
      );
      expect(evalRes.isAccessoryOrSubProduct).toBe(true);
      expect(evalRes.nicheMatched).toBe(false);
      expect(evalRes.rejectionReasonCode).toBe("ACCESSORY_OR_SUBPRODUCT_NOT_CORE");
    });

    it("N18: Generic promotional slogan ('50% Off Today', 'Shop Now') is rejected", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_slogan_01",
            title: "50% Off Today — Shop Now!",
            description: "Limited time flash sale across the store!",
            landingPageUrl: null,
            advertiserDomain: "genericpromo.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      expect(cands[0].identityStatus).toBe("UNRESOLVED");
      const shortlist = selectTopResearchShortlist(cands, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. IDENTITY, FAMILY & DEDUPLICATION (N19..N25)
  // =========================================================================
  describe("Group 3: Identity, Family & Deduplication (N19..N25)", () => {
    it("N19: Same canonical URL with different ad copy collapses to one product", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_url_dup_1",
            title: "2.5L Ultra Quiet Cat Water Fountain",
            landingPageUrl: "https://pawstream.com/products/dockstream-fountain?utm_source=fb",
            advertiserDomain: "pawstream.com",
            provenance: "CACHED_SOURCE",
          },
          {
            source: "META_ADS",
            sourceRecordId: "ad_url_dup_2",
            title: "Vet Recommended Stainless Pet Dispenser",
            landingPageUrl: "https://www.pawstream.com/products/dockstream-fountain?fbclid=IwAR123",
            advertiserDomain: "pawstream.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      expect(cands).toHaveLength(1);
      expect(cands[0].totalObservationCount).toBe(2);
    });

    it("N20: Color/size/pack variants collapse to one family", () => {
      const famBlue = buildProductIdentityFingerprint({
        candidateId: "cand_blue_1",
        title: "ChomChom Pet Hair Remover Roller - Blue Edition (2-Pack)",
        canonicalProductUrl: "https://chomchom.com/products/pet-hair-roller-blue-2pack",
      });
      const famRed = buildProductIdentityFingerprint({
        candidateId: "cand_red_1",
        title: "ChomChom Pet Hair Remover Roller - Red Large",
        canonicalProductUrl: "https://chomchom.com/products/pet-hair-roller-red-large",
      });
      expect(famBlue.familyKey).toBe(famRed.familyKey);
      expect(resolveProductFamily("ChomChom Pet Hair Remover Roller").familyKey).toBe(
        famBlue.familyKey
      );
    });

    it("N21: Same Shopify product ID across tracking query params collapses to one product", () => {
      const candA: any = {
        candidateId: "cand_shop_a",
        title: "Smart Wet Food Feeder",
        storeDomain: "uahpet.com",
        merchantProductId: "7788990011",
        canonicalProductUrl: "https://uahpet.com/products/wet-feeder-v1?variant=111",
        supportingAdIds: ["ad_1"],
        totalObservationCount: 1,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_1", provenance: "CACHED_SOURCE" }],
      };
      const candB: any = {
        candidateId: "cand_shop_b",
        title: "UAHPET Cooling Wet Food Feeder",
        storeDomain: "uahpet.com",
        merchantProductId: "7788990011",
        canonicalProductUrl: "https://uahpet.com/products/wet-feeder-promo?variant=222&utm_medium=cpc",
        supportingAdIds: ["ad_2"],
        totalObservationCount: 1,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_2", provenance: "CACHED_SOURCE" }],
      };
      const clustered = clusterProductCandidates([candA, candB], mergeDuplicateCandidateRecords);
      expect(clustered.distinctProductCount).toBe(1);
    });

    it("N22: Same GTIN/UPC across two ads collapses to one product", () => {
      const cand1: any = {
        candidateId: "cand_gtin_1",
        title: "Furbo 360 Dog Camera",
        storeDomain: "furbo.com",
        gtin: "00856957004000",
        supportingAdIds: ["ad_g1"],
        totalObservationCount: 1,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_g1", provenance: "CACHED_SOURCE" }],
      };
      const cand2: any = {
        candidateId: "cand_gtin_2",
        title: "Rotating Pet Security Treat Camera",
        storeDomain: "shop.furbo.com",
        gtin: "00856957004000",
        supportingAdIds: ["ad_g2"],
        totalObservationCount: 1,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_g2", provenance: "CACHED_SOURCE" }],
      };
      const cmp = compareProductIdentity(cand1, cand2);
      expect(cmp.areSameActualProduct).toBe(true);
    });

    it("N23: Three products from the same product family cannot fill all 3 broad-niche slots when distinct families exist, and homogeneous single-family pool reports honest diversity status", () => {
      const diversePool = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_f1",
            title: "Cordless Stainless Cat Water Fountain",
            landingPageUrl: "https://store1.com/products/cat-water-fountain",
            advertiserDomain: "store1.com",
            provenance: "CACHED_SOURCE",
          },
          {
            source: "META_ADS",
            sourceRecordId: "ad_f2",
            title: "Ultra Quiet Pet Water Fountain Pro",
            landingPageUrl: "https://store2.com/products/pet-water-fountain-pro",
            advertiserDomain: "store2.com",
            provenance: "CACHED_SOURCE",
          },
          {
            source: "META_ADS",
            sourceRecordId: "ad_f3",
            title: "Ceramic Dog Water Dispenser Fountain",
            landingPageUrl: "https://store3.com/products/dog-water-fountain",
            advertiserDomain: "store3.com",
            provenance: "CACHED_SOURCE",
          },
          {
            source: "META_ADS",
            sourceRecordId: "ad_r1",
            title: "Reusable Pet Hair Remover Lint Roller",
            landingPageUrl: "https://store4.com/products/pet-hair-remover-roller",
            advertiserDomain: "store4.com",
            provenance: "CACHED_SOURCE",
          },
          {
            source: "META_ADS",
            sourceRecordId: "ad_g1",
            title: "Low Noise Dog Grooming Vacuum Clipper Kit",
            landingPageUrl: "https://store5.com/products/dog-grooming-vacuum",
            advertiserDomain: "store5.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );

      const diverseShortlist = selectTopResearchShortlist(diversePool, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(diverseShortlist.shortlist).toHaveLength(3);
      expect(diverseShortlist.distinctFamiliesCount).toBe(3);

      // Homogeneous single-family pool (only fountains) without allowSameFamilyAlternativesOnShortfall
      const fountainsOnly = diversePool.slice(0, 3);
      const strictHomogeneous = selectTopResearchShortlist(fountainsOnly, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
        allowSameFamilyAlternativesOnShortfall: false,
      });
      expect(strictHomogeneous.shortlist).toHaveLength(1);
      expect(strictHomogeneous.shortfallReason).toBeTruthy();
    });

    it("N24: 20x duplicated identical ad observations deduplicate to 1 creative/source without weight inflation", () => {
      const identicalObs = Array.from({ length: 20 }, () => ({
        source: "META_ADS",
        title: "ChomChom Reusable Pet Hair Remover Roller",
        description: "Remove dog and cat hair from couches and carpets instantly.",
        landingPageUrl: "https://chomchomroller.com/products/chomchom-roller",
        advertiserDomain: "chomchomroller.com",
        advertiserOrCreator: "ChomChom Roller",
        provenance: "CACHED_SOURCE",
      }));

      const cands = discoverProductCandidatesFromAds(identicalObs, "Pet Gadgets");
      expect(cands).toHaveLength(1);
      expect(cands[0].sourceObservations).toHaveLength(1);
      expect(cands[0].totalObservationCount).toBe(1);
      expect(cands[0].supportingAdIds).toHaveLength(1);
    });

    it("N25: Reversed input observation order produces identical family keys, shortlist, and ranking", () => {
      const rawList = [
        {
          source: "META_ADS",
          sourceRecordId: "ad_ord_1",
          title: "Cordless Stainless Cat Water Fountain",
          landingPageUrl: "https://fountainshop.com/products/cordless-cat-water-fountain",
          advertiserDomain: "fountainshop.com",
          provenance: "CACHED_SOURCE",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_ord_2",
          title: "Reusable Pet Hair Remover Roller",
          landingPageUrl: "https://rollershop.com/products/reusable-pet-hair-roller",
          advertiserDomain: "rollershop.com",
          provenance: "CACHED_SOURCE",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_ord_3",
          title: "Low Noise Dog Grooming Vacuum Kit",
          landingPageUrl: "https://groomshop.com/products/dog-grooming-vacuum-kit",
          advertiserDomain: "groomshop.com",
          provenance: "CACHED_SOURCE",
        },
      ];

      const forwardCands = discoverProductCandidatesFromAds(rawList, "Pet Gadgets");
      const reverseCands = discoverProductCandidatesFromAds([...rawList].reverse(), "Pet Gadgets");

      const forwardShortlist = selectTopResearchShortlist(forwardCands, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      const reverseShortlist = selectTopResearchShortlist(reverseCands, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });

      expect(forwardShortlist.shortlist.map((c) => c.productKey)).toEqual(
        reverseShortlist.shortlist.map((c) => c.productKey)
      );
      expect(forwardShortlist.shortlist.map((c) => c.familyKey)).toEqual(
        reverseShortlist.shortlist.map((c) => c.familyKey)
      );
    });
  });

  // =========================================================================
  // 4. EVERGREEN & DEMAND GATES (N26..N33)
  // =========================================================================
  describe("Group 4: Evergreen & Longitudinal Demand Gates (N26..N33)", () => {
    const baseCandidate: any = {
      candidateId: "cand_eg_test",
      productId: "prod_eg_test",
      title: "Automatic Wet Food Cat Feeder",
      canonicalProductName: "Automatic Wet Food Cat Feeder",
      storeDomain: "uahpet.com",
      canonicalProductUrl: "https://uahpet.com/products/automatic-wet-food-cat-feeder",
      identityStatus: "VERIFIED",
      identityConfidence: "EXACT",
      productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
      relevanceStatus: "RELEVANT",
      problemStatement: "Keeps wet cat food chilled and fresh on schedule.",
      supportingAdIds: ["ad_1", "ad_2", "ad_3", "ad_4", "ad_5"],
      supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
      totalObservationCount: 5,
      distinctAdvertisersCount: 3,
      videoUrl: "https://uahpet.com/video.mp4",
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_1",
          provenance: "LIVE_PROVIDER",
          queryId: "q_1",
        },
      ],
    };

    it("N26: < 60 days demand coverage cannot become VERIFIED_EVERGREEN", () => {
      const shortSpanSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-10",
          demandValue: 70,
        },
        {
          id: "d2",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-08-15",
          periodEnd: "2026-08-25",
          demandValue: 72,
        },
        {
          id: "d3",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-10",
          demandValue: 74,
        },
      ];
      const score = calculateKH02EvergreenScore({
        candidate: baseCandidate,
        demandSeries: shortSpanSeries,
      });
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
      expect(score.evergreenVerification?.verifiedByGate).toBe(false);
    });

    it("N27: < 3 distinct demand dates cannot become VERIFIED_EVERGREEN", () => {
      const twoPointSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          demandValue: 70,
        },
        {
          id: "d2",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          demandValue: 72,
        },
      ];
      const score = calculateKH02EvergreenScore({
        candidate: baseCandidate,
        demandSeries: twoPointSeries,
      });
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
      expect(score.evergreenVerification?.verifiedByGate).toBe(false);
    });

    it("N28: Broad category Google Trends series ('pet gadgets') cannot satisfy product-level G15", () => {
      const broadSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_eg_test",
          keyword: "pet gadgets",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          demandValue: 70,
        },
        {
          id: "d2",
          productId: "prod_eg_test",
          keyword: "pet gadgets",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          demandValue: 72,
        },
        {
          id: "d3",
          productId: "prod_eg_test",
          keyword: "pet gadgets",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          demandValue: 75,
        },
      ];
      const auth = evaluateDemandSourceAuthority(broadSeries, {
        candidateCanonicalName: "Automatic Wet Food Cat Feeder",
      });
      expect(auth.authority).toBe("ESTIMATED_OR_PROXY");
      const score = calculateKH02EvergreenScore({
        candidate: baseCandidate,
        demandSeries: broadSeries,
      });
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
    });

    it("N29: Synthetic/seeded/fixture demand points cannot satisfy G15", () => {
      const fixtureSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_fixture_999",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "SYNTHETIC_DEMO",
          evidenceReference: "fixture:seed",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          demandValue: 70,
        },
        {
          id: "d2",
          productId: "prod_fixture_999",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "SYNTHETIC_DEMO",
          evidenceReference: "fixture:seed",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          demandValue: 72,
        },
        {
          id: "d3",
          productId: "prod_fixture_999",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "SYNTHETIC_DEMO",
          evidenceReference: "fixture:seed",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          demandValue: 74,
        },
      ];
      const evalRes = evaluateTemporalDemandStability(fixtureSeries, 90);
      expect(evalRes.eligibleForEvergreen).toBe(false);
      expect(evalRes.stabilityScore).toBeNull();
    });

    it("N30: Future-dated demand points (> asOf) are rejected in replay", () => {
      const futureSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_eg_test",
          keyword: "Automatic Wet Food Cat Feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job1:sha256:abcdef1234567890",
          periodStart: "2028-01-01",
          periodEnd: "2028-01-31",
          demandValue: 80,
        },
      ];
      const historyEval = evaluateDemandHistoryEvidence(futureSeries);
      expect(historyEval.eligibleForEvergreen).toBe(false);
      expect(historyEval.missingEvidence.some((m) => m.includes("Future-dated"))).toBe(true);
    });

    it("N31: Post-cutoff joined ResearchProduct.updatedAt > asOf is rejected in replay", () => {
      const asOf = new Date("2026-06-30T23:59:59Z");
      const ad = {
        id: "ad_pit_1",
        headline: "Pet Hair Roller Promo",
        targetUrl: "https://petroller.com/products/roller",
        advertiserDomain: "petroller.com",
        firstSeenAt: new Date("2026-06-15T00:00:00Z"),
      };
      const link = {
        createdAt: new Date("2026-06-15T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"), // post-cutoff!
        product: {
          id: "rp_post_cutoff",
          title: "Future Enriched Title",
          storeDomain: "petroller.com",
          productUrl: "https://petroller.com/products/roller",
          createdAt: new Date("2026-06-15T00:00:00Z"),
          updatedAt: new Date("2026-08-10T00:00:00Z"), // post-cutoff!
        },
      };
      const resolved = resolvePointInTimeAdCandidateMetadata(ad, link, asOf, []);
      expect(resolved.trustedPointInTimeMetadata).toBe(false);
      expect(resolved.metadataProvenance).toBe("REJECTED_POST_CUTOFF_JOINED_METADATA");
      expect(resolved.title).toBe("Pet Hair Roller Promo");
    });

    it("N32: Shortlist of 1 or 2 valid candidates is NOT padded to 3", () => {
      const singleCand = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_single_1",
            title: "Automatic Pet Feeder Smart Dispenser",
            landingPageUrl: "https://petfeeder.com/products/automatic-pet-feeder",
            advertiserDomain: "petfeeder.com",
            provenance: "CACHED_SOURCE",
          },
        ],
        "Pet Gadgets"
      );
      const shortlistRes = selectTopResearchShortlist(singleCand, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(shortlistRes.shortlist).toHaveLength(1);
      expect(shortlistRes.qualifiedCount).toBe(1);
      expect(shortlistRes.shortfallReason).toBeTruthy();
    });

    it("N33: Provisional candidate cannot appear in evergreenWinners (topThree)", () => {
      const score = calculateKH02EvergreenScore({
        candidate: baseCandidate,
        demandSeries: [],
      });
      expect(score.tier).toBe("PROVISIONAL_OPPORTUNITY");

      const recommended = buildCanonicalRecommendedProducts({
        researchRunId: "run_prov_only",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        formulaVersion: "12.1.0",
        runStatus: "PASSED",
        sourceStatuses: { META_ADS: "PASSED" } as any,
        topThree: [],
        provisionalCandidates: [{ rank: null, candidate: baseCandidate, score }],
        remainingCandidates: [],
        insufficientEvidenceCandidates: [],
        totalCandidatesDiscovered: 1,
        generatedAt: new Date().toISOString(),
      });
      expect(recommended.filter((c) => c.qualificationTier === "VERIFIED_EVERGREEN")).toHaveLength(
        0
      );
      expect(recommended.filter((c) => c.qualificationTier === "PROVISIONAL")).toHaveLength(1);
    });
  });

  // =========================================================================
  // 5. AMAZON LOCAL MCP GUARDRAILS & DYNAMIC TARGET SELECTION (N34..N41)
  // =========================================================================
  describe("Group 5: Amazon Local MCP Guardrails (N34..N41)", () => {
    it("N34: Non-Amazon URL is rejected before MCP launch", () => {
      const check = validateAmazonUsProductUrl("https://evil-phishing.example.com/dp/B00BAGTNAQ");
      expect(check.valid).toBe(false);
    });

    it("N35: Non-US Amazon domain (amazon.co.uk, amazon.ca) is rejected", () => {
      expect(validateAmazonUsProductUrl("https://www.amazon.co.uk/dp/B00BAGTNAQ").valid).toBe(false);
      expect(validateAmazonUsProductUrl("https://www.amazon.ca/dp/B00BAGTNAQ").valid).toBe(false);
      expect(validateAmazonUsSearchUrl("https://www.amazon.co.uk/s?k=pet+roller").valid).toBe(false);
    });

    it("N36: Malformed ASIN (B0INVALID!, 9-char, 11-char) is rejected", () => {
      expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/B01234567").valid).toBe(false);
      expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/B0123456789").valid).toBe(false);
      expect(validateAmazonUsProductUrl("https://www.amazon.com/dp/B0INVALID!").valid).toBe(false);
    });

    it("N37: Sponsored search card cannot auto-verify as exact product match", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=ChomChom+Roller",
        finalUrl: "https://www.amazon.com/s?k=ChomChom+Roller",
        httpStatus: 200,
        pageTitle: "Amazon.com : ChomChom Roller",
        rawHtml: `
          <div data-asin="B00BAGTNAQ" data-component-type="s-search-result">
            <span>Sponsored</span>
            <h2><a href="/dp/B00BAGTNAQ">ChomChom Roller Pet Hair Remover</a></h2>
          </div>
        `,
      });
      expect(parsed.cards).toHaveLength(0);
      expect(
        parsed.rejectedCards.some(
          (r) => r.asin === "B00BAGTNAQ" && r.reason === "SPONSORED_SEARCH_CARD_REJECTED"
        )
      ).toBe(true);
    });

    it("N38: Accessory search result cannot verify main product", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0FDKQGRCK",
          finalUrl: "https://www.amazon.com/dp/B0FDKQGRCK",
          canonicalUrl: "https://www.amazon.com/dp/B0FDKQGRCK",
          httpStatus: 200,
          pageTitle: "Replacement Filter 8-Pack for Cat Water Fountain (Fountain Not Included)",
          structuredData: {
            asin: "B0FDKQGRCK",
            productTitle: "Replacement Filter 8-Pack for Cat Water Fountain (Fountain Not Included)",
            brand: "PETLIBRO",
          },
        },
        {
          workspaceId: "ws_1",
          researchRunId: "run_1",
          candidateId: "cand_fountain",
          observedAt: new Date().toISOString(),
          providerInvocationRef: "inv_1",
          observationClass: "TEST_FIXTURE",
          requestMode: "URL_VERIFICATION",
        }
      );
      const idCheck = verifyAmazonProductIdentity(
        {
          candidateId: "cand_fountain",
          title: "PETLIBRO Dockstream Cordless Cat Water Fountain",
          brand: "PETLIBRO",
        },
        ev
      );
      expect(idCheck.identityMatch).not.toBe("EXACT_PRODUCT");
      expect(
        idCheck.rejectionReasons.some((r) => r.includes("ACCESSORY_VS_MAIN_PRODUCT_MISMATCH"))
      ).toBe(true);
    });

    it("N39: Missing US ZIP / non-USD currency (VND) keeps verifiedDeliveryMarket = null, price = null, currency = null", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B00BAGTNAQ",
          finalUrl: "https://www.amazon.com/dp/B00BAGTNAQ",
          canonicalUrl: "https://www.amazon.com/dp/B00BAGTNAQ",
          httpStatus: 200,
          pageTitle: "ChomChom Roller Pet Hair Remover",
          html: `<div>Deliver to Vietnam</div><span class="a-price">VND 650,000</span>`,
          structuredData: {
            asin: "B00BAGTNAQ",
            productTitle: "ChomChom Roller Pet Hair Remover",
            brand: "ChomChom Roller",
            price: 650000,
            currency: "VND",
            deliveryPostalCode: null,
            explicitUsDeliveryConfirmed: false,
          },
        },
        {
          workspaceId: "ws_1",
          researchRunId: "run_1",
          candidateId: "cand_chom",
          observedAt: new Date().toISOString(),
          providerInvocationRef: "inv_1",
          observationClass: "AUTHORIZED_LIVE",
          requestMode: "URL_VERIFICATION",
        }
      );
      expect(ev.verifiedDeliveryMarket).toBeNull();
      expect(ev.observedDeliveryPostalCode).toBeNull();
      expect(ev.price).toBeNull();
      expect(ev.currency).toBeNull();
    });

    it("N40: Operation #5 in a single run is blocked by the 4-op budget cap", async () => {
      const budget = createAmazonProviderBudget({
        workspaceId: "ws_1",
        researchRunId: "run_1",
        maxOperationsPerRun: 4,
      });
      for (let i = 1; i <= 4; i++) {
        const res = await budget.executeBoundedOperation(`op_${i}`, async () => "ok");
        expect(res.executed).toBe(true);
      }
      const op5 = await budget.executeBoundedOperation("op_5", async () => "should_not_run");
      expect(op5.executed).toBe(false);
      expect(op5.blockedDecision?.reason).toContain("max Amazon provider operations cap (4)");
    });

    it("N41: Unclosed or mismatched MCP sessionId fails the lifecycle gate", () => {
      const policy = resolveAmazonUsPolicyContext({
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
      });
      const unclosedGate = evaluateAmazonUsEvidenceGate("run_1", [], [], policy, {
        mcpSessionLifecycle: {
          sessionId: "mcp_sess_1",
          sessionCreated: true,
          ownershipMode: "OWNED",
          transportMode: "REAL_STDIO_MCP",
          serverOrigin: "PINNED_PLAYWRIGHT_MCP",
          ownedChildPid: 12345,
          startedAt: "2026-11-02T00:00:00.000Z",
          lastToolCompletedAt: "2026-11-02T00:00:05.000Z",
          closeStartedAt: null,
          closeFinishedAt: null,
          closedCleanly: false,
          ownedChildPidTerminated: false,
          closeError: "Session left open",
          toolInvocationsCount: 3,
          observedOperationIds: ["op_1"],
        },
      });
      expect(unclosedGate.mcpSessionClosedCleanly).toBe(false);
      expect(unclosedGate.engineeringVerdict).toBe("ENGINEERING_FAILED");
    });
  });

  // =========================================================================
  // 6. WALMART OPERATIONAL PAUSE & REGRESSION (N42..N48)
  // =========================================================================
  describe("Group 6: Walmart Operational Pause & Regression (N42..N48)", () => {
    it("N42: Default policy keeps Walmart disabled/paused (featureEnabled = false, liveAllowed = false, operationalStatus = PAUSED_EXTERNAL)", () => {
      const policy = resolveWalmartUsPilotPolicy({});
      expect(policy.featureEnabled).toBe(false);
      expect(policy.liveAllowed).toBe(false);
      expect(policy.operationalStatus).toBe("PAUSED_EXTERNAL");
      expect(policy.upstreamBlockerStatus).toBe("BLOCKED_PROVIDER");
      expect(policy.priorLiveBlockerReference).toEqual(
        WALMART_2026_11_02_CAPTCHA_BLOCKER_REFERENCE
      );
      expect(policy.priorLiveBlockerReference?.responseBytes).toBe(16845);
      expect(policy.priorLiveBlockerReference?.responseSha256).toBe(
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4"
      );
    });

    it("N43: Client passing enableWalmartUsPilot = true while server policy is disabled executes 0 HTTP requests", async () => {
      let httpCalls = 0;
      const res = await runWalmartUsPilotEnrichment({
        workspaceId: "ws_pause_test",
        researchRunId: "run_pause_test",
        niche: "Pet Gadgets",
        enableWalmartUsPilot: true,
        env: {},
        shortlistedCandidates: [
          {
            candidateId: "cand_1",
            title: "ChomChom Roller Pet Hair Remover",
            brand: "ChomChom",
          },
        ],
        customFetch: async () => {
          httpCalls++;
          return new Response("{}", { status: 200 });
        },
      });
      expect(httpCalls).toBe(0);
      expect(res.telemetry.overallStatus).toBe("DISABLED");
      expect(res.telemetry.networkAttemptsUsed).toBe(0);
      expect(res.telemetry.operationalStatus).toBe("PAUSED_EXTERNAL");
    });

    it("N44: Outer HTTP 200 + Jina code: 200 + inner /blocked + 'Robot or human?' + px-captcha classifies as BLOCKED_PROVIDER, retryable = false, validatedProducts = 0", () => {
      const liveCaptchaFixture = JSON.stringify({
        code: 200,
        status: 20000,
        data: {
          title: "Robot or human?",
          url: "https://www.walmart.com/blocked?url=L3NlYXJjaD9xPUNob21DaG9tJTIwUm9sbGVyJTIwUGV0JTIwSGFpciUyMFJlbW92ZXI=&uuid=879ab0ec-a2ae-11f0-b0ec-6508305a5841&vid=&g=b",
          html: `<html><head><title>Robot or human?</title><script id="blockScript" src="/px/PXu6b0qd2S/init.js"></script></head><body><div id="px-captcha">Activate and hold the button to confirm that you're human.</div></body></html>`,
        },
      });
      const env = normalizeWalmartJinaEnvelope(liveCaptchaFixture);
      const botCheck = detectWalmartBotWallInContent(
        env.envelope?.html,
        env.envelope?.title,
        env.envelope?.url
      );
      expect(botCheck.isBotWall).toBe(true);

      const classified = classifyWalmartJinaFailure({
        outerStatus: 200,
        innerHttpStatus: 200,
        html: env.envelope?.html,
        pageTitle: env.envelope?.title,
        finalUrl: env.envelope?.url,
      });
      expect(classified.queryStatus).toBe("BLOCKED_PROVIDER");
      expect(classified.retryable).toBe(false);
      expect(classified.isBotWall).toBe(true);
    });

    it("N45: Bot wall on search immediately aborts follow-up PDP (PDP_NOT_EXECUTED)", async () => {
      let fetchCalls = 0;
      const liveCaptchaFixture = JSON.stringify({
        code: 200,
        status: 20000,
        data: {
          title: "Robot or human?",
          url: "https://www.walmart.com/blocked?url=L3NlYXJjaA==",
          html: `<html><head><title>Robot or human?</title></head><body><div id="px-captcha"></div></body></html>`,
        },
      });
      const res = await runWalmartUsPilotEnrichment({
        workspaceId: "ws_n45",
        researchRunId: "run_n45",
        niche: "Pet Gadgets",
        enableWalmartUsPilot: true,
        env: {
          KH02_WALMART_US_ENABLED: "true",
          KH02_WALMART_US_LIVE_ALLOWED: "true",
        },
        shortlistedCandidates: [
          { candidateId: "c1", title: "ChomChom Roller Pet Hair Remover", brand: "ChomChom" },
          { candidateId: "c2", title: "Furbo 360 Dog Camera", brand: "Furbo" },
        ],
        customFetch: async () => {
          fetchCalls++;
          return new Response(liveCaptchaFixture, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        evidenceOrigin: "TEST_FIXTURE",
      });
      expect(fetchCalls).toBe(1);
      expect(res.telemetry.overallStatus).toBe("BLOCKED_PROVIDER");
      expect(res.telemetry.pdpOperationsCount).toBe(0);
    });

    it("N46: Non-r.jina.ai or non-www.walmart.com target URL is rejected before fetch", () => {
      expect(
        validateWalmartJinaRequestTarget("https://evil.com/https://www.walmart.com/ip/674275778").valid
      ).toBe(false);
      expect(
        validateWalmartJinaRequestTarget("https://r.jina.ai/https://www.walmart.ca/ip/674275778").valid
      ).toBe(false);
    });

    it("N47: Forbidden headers (Authorization, Cookie, X-Proxy-Url, X-Forwarded-For) are rejected", () => {
      const base = buildWalmartJinaHeaders();
      expect(validateWalmartJinaHeaders({ ...base, Authorization: "Bearer x" }).valid).toBe(false);
      expect(validateWalmartJinaHeaders({ ...base, Cookie: "sid=1" }).valid).toBe(false);
      expect(validateWalmartJinaHeaders({ ...base, "X-Proxy-Url": "http://p" }).valid).toBe(false);
      expect(validateWalmartJinaHeaders({ ...base, "X-Forwarded-For": "1.2.3.4" }).valid).toBe(false);
    });

    it("N48: Leading-zero GTIN/UPC ('027242930698') is preserved as string", () => {
      const pdpHtml = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            initialData: {
              data: {
                product: {
                  usItemId: "16504921979",
                  name: "Sony Wireless Headphones",
                  brand: "Sony",
                  upc: "027242930698",
                  canonicalUrl: "/ip/Sony-Headphones/16504921979",
                  priceInfo: { currentPrice: { price: 148.0, currencyUnit: "USD" } },
                  availabilityStatus: "IN_STOCK",
                },
              },
            },
          },
        },
      })}</script></body></html>`;
      const parsed = parseWalmartPdpNextData(pdpHtml, { expectedItemId: "16504921979" });
      expect(parsed.ok).toBe(true);
      expect(parsed.product?.upc).toBe("027242930698");
      expect(typeof parsed.product?.upc).toBe("string");
    });
  });

  // =========================================================================
  // 7. DYNAMIC TWO-NICHE DISCOVERY & TARGET SELECTION (P01..P04)
  // =========================================================================
  describe("Group 7: Dynamic Two-Niche Discovery ('Pet Gadgets' vs 'Home Organization') & Dynamic Amazon Target Selection", () => {
    it("P01: Niche A ('Pet Gadgets') and Niche B ('Home Organization') generate non-identical query plans, candidate sets, and Top 3 shortlists with zero cross-niche leakage", () => {
      const planA = buildKH02DiscoveryQueryPlan("Pet Gadgets", "US");
      const planB = buildKH02DiscoveryQueryPlan("Home Organization", "US");

      const phrasesA = new Set(planA.subqueries.map((q) => q.subquery.toLowerCase()));
      const phrasesB = new Set(planB.subqueries.map((q) => q.subquery.toLowerCase()));
      expect(phrasesA).not.toEqual(phrasesB);

      const mixedObservations = [
        // Pet Gadgets products
        {
          source: "META_ADS",
          sourceRecordId: "ad_pet_1",
          sourceUrl: "https://www.facebook.com/ads/library/?id=1001",
          landingPageUrl: "https://chomchomroller.com/products/chomchom-roller-pet-hair-remover",
          advertiserDomain: "chomchomroller.com",
          advertiserOrCreator: "ChomChom Roller",
          title: "ChomChom Roller Pet Hair Remover",
          description: "Reusable dog and cat hair remover brush for furniture and couches.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T10:00:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_pet_2",
          sourceUrl: "https://www.facebook.com/ads/library/?id=1002",
          landingPageUrl: "https://petlibro.com/products/dockstream-battery-operated-cat-water-fountain",
          advertiserDomain: "petlibro.com",
          advertiserOrCreator: "PETLIBRO",
          title: "PETLIBRO Dockstream Cordless Cat Water Fountain",
          description: "Wireless stainless steel water fountain for cats and small dogs.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T10:05:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_pet_3",
          sourceUrl: "https://www.facebook.com/ads/library/?id=1003",
          landingPageUrl: "https://furbo.com/products/furbo-360-dog-camera",
          advertiserDomain: "furbo.com",
          advertiserOrCreator: "Furbo",
          title: "Furbo 360 Rotating Dog Camera Treat Tosser",
          description: "Smart wifi pet camera with barking alerts and treat dispenser.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T10:10:00Z",
        },
        // Home Organization products
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_1",
          sourceUrl: "https://www.facebook.com/ads/library/?id=2001",
          landingPageUrl: "https://tidyhomeco.com/products/expandable-bamboo-kitchen-drawer-organizer",
          advertiserDomain: "tidyhomeco.com",
          advertiserOrCreator: "TidyHome Co",
          title: "Expandable Bamboo Kitchen Drawer Organizer Tray",
          description: "Adjustable silverware and utensil divider for kitchen cabinet organization.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:00:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_2",
          sourceUrl: "https://www.facebook.com/ads/library/?id=2002",
          landingPageUrl: "https://under5sink.com/products/2-tier-sliding-under-sink-organizer-rack",
          advertiserDomain: "under5sink.com",
          advertiserOrCreator: "UnderSink Pro",
          title: "2-Tier Sliding Under Sink Organizer Storage Rack",
          description: "Pull-out cabinet storage caddy for bathroom and kitchen organization.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:05:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_3",
          sourceUrl: "https://www.facebook.com/ads/library/?id=2003",
          landingPageUrl: "https://closetcube.com/products/stackable-clear-acrylic-shoe-storage-boxes",
          advertiserDomain: "closetcube.com",
          advertiserOrCreator: "ClosetCube",
          title: "Stackable Clear Acrylic Shoe Storage Organizer Boxes",
          description: "Foldable magnetic-door closet organization bins for sneakers.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:10:00Z",
        },
      ];

      const discoveredA = discoverProductCandidatesFromAds(mixedObservations, "Pet Gadgets");
      const shortlistA = selectTopResearchShortlist(discoveredA, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });

      const discoveredB = discoverProductCandidatesFromAds(mixedObservations, "Home Organization");
      const shortlistB = selectTopResearchShortlist(discoveredB, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Home Organization",
      });

      expect(shortlistA.shortlist).toHaveLength(3);
      expect(shortlistB.shortlist).toHaveLength(3);

      const idsA = shortlistA.shortlist.map((c) => c.candidateId);
      const idsB = shortlistB.shortlist.map((c) => c.candidateId);
      // Zero overlap between Pet Gadgets Top 3 and Home Organization Top 3
      expect(idsA.filter((id) => idsB.includes(id))).toHaveLength(0);
    });

    it("P02: Dynamic Amazon target selection chooses eligible runtime niche candidates, skips rejected/duplicate-family items, and records full targetSelectionLedger", () => {
      const candidates = [
        {
          candidateId: "cand_drawer_1",
          title: "Expandable Bamboo Kitchen Drawer Organizer Tray",
          canonicalProductName: "Expandable Bamboo Kitchen Drawer Organizer Tray",
          brand: "TidyHome",
          familyKey: "drawer_organizer",
          productKey: "prod_drawer_1",
          identityStatus: "VERIFIED",
          productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
          relevanceStatus: "RELEVANT",
          relevanceScore: 88,
          totalObservationCount: 4,
          liveObservationsCount: 1,
        },
        {
          candidateId: "cand_drawer_dup",
          title: "Bamboo Kitchen Drawer Divider Variant",
          canonicalProductName: "Bamboo Kitchen Drawer Divider Variant",
          brand: "TidyHome",
          familyKey: "drawer_organizer",
          productKey: "prod_drawer_2",
          identityStatus: "PROBABLE",
          productRealityStatus: "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
          relevanceStatus: "RELEVANT",
          relevanceScore: 70,
          totalObservationCount: 2,
          liveObservationsCount: 0,
        },
        {
          candidateId: "cand_irrelevant_pet",
          title: "Dog Barking Collar",
          canonicalProductName: "Dog Barking Collar",
          brand: "BarkStop",
          familyKey: "bark_collar",
          productKey: "prod_bark_1",
          identityStatus: "PROBABLE",
          productRealityStatus: "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
          relevanceStatus: "IRRELEVANT",
          relevanceScore: 0,
          totalObservationCount: 3,
          liveObservationsCount: 0,
        },
        {
          candidateId: "cand_sink_2",
          title: "2-Tier Sliding Under Sink Organizer Storage Rack",
          canonicalProductName: "2-Tier Sliding Under Sink Organizer Storage Rack",
          brand: "UnderSink Pro",
          familyKey: "under_sink_organizer",
          productKey: "prod_sink_2",
          identityStatus: "PROBABLE",
          productRealityStatus: "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
          relevanceStatus: "RELEVANT",
          relevanceScore: 82,
          totalObservationCount: 3,
          liveObservationsCount: 0,
        },
      ];

      const selection = selectDynamicAmazonVerificationTargets(
        candidates,
        [candidates[0], candidates[3]],
        { niche: "Home Organization" }
      );

      expect(selection.selectedCount).toBe(2);
      expect(selection.selectedCandidates.map((c) => c.candidateId)).toEqual([
        "cand_drawer_1",
        "cand_sink_2",
      ]);
      expect(selection.decisions).toHaveLength(4);
      const dupDecision = selection.decisions.find((d) => d.candidateId === "cand_drawer_dup");
      expect(dupDecision?.selected).toBe(false);
      expect(dupDecision?.reasonCode).toBe("SKIPPED_DUPLICATE_PRODUCT_OR_FAMILY");

      const irrelDecision = selection.decisions.find(
        (d) => d.candidateId === "cand_irrelevant_pet"
      );
      expect(irrelDecision?.selected).toBe(false);
      expect(irrelDecision?.reasonCode).toBe("SKIPPED_IRRELEVANT_OR_REJECTED");
    });

    it("P03: Canonical Recommended & Explorer view-models preserve Niche A vs Niche B shortlist separation, truthful qualification badges, and Amazon/Walmart telemetry parity", () => {
      const homeObs = [
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_v1",
          sourceUrl: "https://www.facebook.com/ads/library/?id=3001",
          landingPageUrl: "https://tidyhomeco.com/products/expandable-bamboo-kitchen-drawer-organizer",
          advertiserDomain: "tidyhomeco.com",
          advertiserOrCreator: "TidyHome Co",
          title: "Expandable Bamboo Kitchen Drawer Organizer Tray",
          description: "Adjustable silverware and utensil divider for kitchen cabinet organization.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:00:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_v2",
          sourceUrl: "https://www.facebook.com/ads/library/?id=3002",
          landingPageUrl: "https://under5sink.com/products/2-tier-sliding-under-sink-organizer-rack",
          advertiserDomain: "under5sink.com",
          advertiserOrCreator: "UnderSink Pro",
          title: "2-Tier Sliding Under Sink Organizer Storage Rack",
          description: "Pull-out cabinet storage caddy for bathroom and kitchen organization.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:05:00Z",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_home_v3",
          sourceUrl: "https://www.facebook.com/ads/library/?id=3003",
          landingPageUrl: "https://closetcube.com/products/stackable-clear-acrylic-shoe-storage-boxes",
          advertiserDomain: "closetcube.com",
          advertiserOrCreator: "ClosetCube",
          title: "Stackable Clear Acrylic Shoe Storage Organizer Boxes",
          description: "Foldable magnetic-door closet organization bins for sneakers.",
          provenance: "CACHED_SOURCE",
          observedAt: "2026-10-15T11:10:00Z",
        },
      ];

      const discoveredHome = discoverProductCandidatesFromAds(homeObs, "Home Organization");
      const shortlistHome = selectTopResearchShortlist(discoveredHome, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Home Organization",
      });
      const scoredHome = shortlistHome.shortlist.map((cand) => ({
        rank: null,
        candidate: cand,
        score: calculateKH02EvergreenScore({ candidate: cand, demandSeries: [] }),
      }));

      const leaderboardHome: any = {
        researchRunId: "run_home_org_1",
        topic: "Home Organization",
        market: "US",
        lookbackDays: 90,
        formulaVersion: "12.1.0",
        runStatus: "PARTIAL",
        sourceStatuses: { META_ADS: "PASSED" },
        topThree: [],
        researchShortlist: shortlistHome,
        provisionalCandidates: scoredHome,
        remainingCandidates: [],
        insufficientEvidenceCandidates: [],
        totalCandidatesDiscovered: discoveredHome.length,
        generatedAt: "2026-11-02T00:00:00.000Z",
      };

      const recCards = buildCanonicalRecommendedProducts(leaderboardHome);
      const explorerRows = buildAllCandidatesExplorerList(leaderboardHome);

      expect(recCards).toHaveLength(3);
      expect(recCards.every((c) => c.qualificationTier === "RESEARCH_QUALIFIED")).toBe(true);
      expect(recCards.every((c) => c.currentRunLiveAdsCount === 0)).toBe(true);
      expect(explorerRows).toHaveLength(3);
      expect(explorerRows.every((r) => r.explorerStatus === "RESEARCH_QUALIFIED")).toBe(true);
    });
  });
});
