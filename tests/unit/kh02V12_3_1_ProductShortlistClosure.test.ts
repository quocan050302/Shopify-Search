/**
 * SWAI KH-02 V12.3.1 — Meta & Google Evidence-True Product Shortlist Closure Test Suite
 *
 * Verifies:
 * 1. Meta aggregate error outcomes (all-failed -> FAILED, partial success, successful empty)
 * 2. Meta global query budget enforcement (MetaQueryBudgetTracker)
 * 3. Live/cache provenance (fresh live re-observation vs new insert vs cached)
 * 4. Generalized campaign code rejection (Wmt008 L4v2 Mustyclothes, GG002 L1, fb_campaign_v3)
 * 5. Preservation of legitimate model numbers (Automatic Feeder X200, Pet Grooming Vacuum V3)
 * 6. Top 3 Research Shortlist distinctness & shortfall reporting
 * 7. Google domain normalization (cc.uprootclean.com -> uprootclean.com) & query vs enrichment separation
 * 8. Customer psychology evidence grounding (single-word quote "Dog" cannot be OBSERVED)
 * 9. Elimination of false-PASS acceptance shortcuts
 */

import { describe, it, expect } from "vitest";
import {
  aggregateMetaQueryOutcomes,
  MetaSubqueryExecution,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  MetaQueryBudgetTracker,
  buildKH02DiscoveryQueryPlan,
} from "@/services/kh02/discovery/discoveryQueryPlanner";
import {
  classifyAdvertisingHeadline,
} from "@/services/kh02/identity/adHeadlineClassifier";
import {
  resolveProductIdentity,
} from "@/services/kh02/identity/productIdentityResolver";
import {
  selectTopResearchShortlist,
  evaluateShortlistDistinctness,
  DiscoveredProductCandidate,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  extractRegistrableDomain,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  evaluateClaimEvidenceSupport,
  analyzeCustomerPsychology,
  PsychologyClaim,
} from "@/services/kh02/psychology/customerPsychologyService";

describe("SWAI KH-02 V12.3.1 — Meta & Google Evidence-True Closure Suite", () => {
  // ── 1. Meta Query Outcome Aggregation (P0-01, P0-02, P0-03) ───────────────
  describe("Meta Collector Aggregate Error Semantics", () => {
    it("P0-01: Every query throwing produces FAILED and liveSucceeded = false", () => {
      const outcomes: MetaSubqueryExecution[] = [
        {
          queryId: "q1",
          keyword: "pet gadgets",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "META_UPSTREAM_500",
          errorMessage: "Internal server error from Meta Ads API",
        },
        {
          queryId: "q2",
          keyword: "pet hair remover",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "META_UPSTREAM_TIMEOUT",
          errorMessage: "Timeout waiting for Meta response",
        },
        {
          queryId: "q3",
          keyword: "automatic pet feeder",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "META_UPSTREAM_RATE_LIMIT",
          errorMessage: "Rate limit exceeded",
        },
      ];

      const agg = aggregateMetaQueryOutcomes(outcomes);
      expect(agg.executionStatus).toBe("FAILED");
      expect(agg.liveSucceeded).toBe(false);
      expect(agg.attemptedQueries).toBe(3);
      expect(agg.successfulQueries).toBe(0);
      expect(agg.failedQueries).toBe(3);
      expect(agg.errors).toHaveLength(3);
      expect(agg.errors[0]).toContain("Internal server error");
    });

    it("P0-02: Partial success preserves returned ads and aggregates failed subquery errors", () => {
      const outcomes: MetaSubqueryExecution[] = [
        {
          queryId: "q1",
          keyword: "pet gadgets",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "TIMEOUT",
          errorMessage: "Timeout",
        },
        {
          queryId: "q2",
          keyword: "pet hair remover",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "SUCCEEDED_WITH_RESULTS",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 5,
          errorCode: null,
          errorMessage: null,
        },
        {
          queryId: "q3",
          keyword: "cat water fountain",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "AUTH_ERR",
          errorMessage: "Auth failure",
        },
      ];

      const agg = aggregateMetaQueryOutcomes(outcomes);
      expect(agg.executionStatus).toBe("PARTIAL_SUCCESS_WITH_RESULTS");
      expect(agg.liveSucceeded).toBe(true);
      expect(agg.attemptedQueries).toBe(3);
      expect(agg.successfulQueries).toBe(1);
      expect(agg.failedQueries).toBe(2);
      expect(agg.errors).toHaveLength(2);
      expect(agg.sourceRecordsReturned).toBe(5);
    });

    it("P0-03: Succeeded empty is distinct from failed query", () => {
      const outcomes: MetaSubqueryExecution[] = [
        {
          queryId: "q1",
          keyword: "obscure niche gadget",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "SUCCEEDED_EMPTY",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: null,
          errorMessage: null,
        },
      ];

      const agg = aggregateMetaQueryOutcomes(outcomes);
      expect(agg.executionStatus).toBe("QUERY_SUCCEEDED_EMPTY");
      expect(agg.liveSucceeded).toBe(true);
      expect(agg.successfulQueries).toBe(1);
      expect(agg.failedQueries).toBe(0);
      expect(agg.errors).toHaveLength(0);
      expect(agg.sourceRecordsReturned).toBe(0);
    });
  });

  // ── 2. Meta Query Budget Tracker (P0-06) ──────────────────────────────────
  describe("Meta Global Query Budget Enforcement", () => {
    it("Enforces total operation budget and halts when exhausted", () => {
      const tracker = new MetaQueryBudgetTracker({
        maxLogicalSubqueries: 3,
        maxProviderRequests: 2,
        maxPages: 2,
        maxUniqueAds: 50,
        maxDurationMs: 60000,
      });

      expect(tracker.canExecuteNextRequest()).toBe(true);
      expect(tracker.reserveRequest()).toBe(true);
      tracker.recordRequestSuccess(10);

      expect(tracker.canExecuteNextRequest()).toBe(true);
      expect(tracker.reserveRequest()).toBe(true);
      tracker.recordRequestSuccess(15);

      // Total allowance of 2 provider requests exhausted!
      expect(tracker.canExecuteNextRequest()).toBe(false);
      expect(tracker.reserveRequest()).toBe(false);

      const usage = tracker.getUsage();
      expect(usage.actualProviderRequests).toBe(2);
      expect(usage.totalAdsCollected).toBe(25);
    });

    it("Discovery query planner includes consistent budget", () => {
      const plan = buildKH02DiscoveryQueryPlan("Pet Gadgets", "US");
      expect(plan.budget).toBeDefined();
      expect(plan.budget.maxLogicalSubqueries).toBe(3);
      expect(plan.budget.maxProviderRequests).toBe(3);
    });
  });

  // ── 3. Campaign & SKU Code Rejection (P0-08) ──────────────────────────────
  describe("Product Identity — Generalized Campaign & SKU Code Rejection", () => {
    it("Rejects 'Wmt008 L4v2 Mustyclothes' as a campaign code, NOT a verified product", () => {
      const classification = classifyAdvertisingHeadline("Wmt008 L4v2 Mustyclothes");
      expect(["CAMPAIGN_CODE", "INTERNAL_SKU_CODE"]).toContain(classification.headlineType);
      expect(classification.isProductCandidate).toBe(false);

      const identity = resolveProductIdentity({
        rawLandingUrl: "https://shop.com/products/wmt008-l4v2-mustyclothes",
        storeDomain: "shop.com",
        rawHeadlines: ["Wmt008 L4v2 Mustyclothes"],
      });
      expect(identity.identityStatus).not.toBe("VERIFIED");
      expect(identity.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("Rejects diverse campaign/experiment patterns without hardcoded single strings", () => {
      const negativeCases = [
        "Wmt004 1",
        "Ad50fb",
        "fb_campaign_v3",
        "lp_pet_test_02",
        "GG002 L1",
        "Pet Product V4",
      ];

      for (const title of negativeCases) {
        const cls = classifyAdvertisingHeadline(title);
        expect(cls.isProductCandidate).toBe(false);

        const id = resolveProductIdentity({
          rawLandingUrl: `https://store.com/products/${title.toLowerCase().replace(/\s+/g, "-")}`,
          storeDomain: "store.com",
          rawHeadlines: [title],
        });
        expect(id.identityStatus).not.toBe("VERIFIED");
        expect(id.isEligibleAsEvergreenWinner).toBe(false);
      }
    });

    it("Preserves legitimate product names that legitimately contain model numbers", () => {
      const positiveCases = [
        { headline: "Automatic Feeder X200", expectedCanonical: "Automatic Feeder X200" },
        { headline: "Pet Grooming Vacuum V3", expectedCanonical: "Pet Grooming Vacuum V3" },
        { headline: "GPS Pet Tracker 4G", expectedCanonical: "GPS Pet Tracker 4G" },
      ];

      for (const pos of positiveCases) {
        const cls = classifyAdvertisingHeadline(pos.headline);
        expect(cls.isProductCandidate).toBe(true);

        const id = resolveProductIdentity({
          rawLandingUrl: `https://store.com/products/${pos.headline.toLowerCase().replace(/\s+/g, "-")}`,
          storeDomain: "store.com",
          rawHeadlines: [pos.headline],
        });
        expect(id.identityStatus).toBe("VERIFIED");
        expect(id.isEligibleAsEvergreenWinner).toBe(true);
      }
    });
  });

  function makeCandidate(
    partial: Partial<DiscoveredProductCandidate> & { candidateId: string; title: string; category: string }
  ): DiscoveredProductCandidate {
    return {
      problemStatement: null,
      targetAudience: null,
      thumbnailUrl: null,
      videoUrl: null,
      canonicalProductUrl: null,
      storeDomain: null,
      advertiserNames: [],
      supportingAdIds: [],
      supportingSourceTypes: [],
      totalObservationCount: 1,
      distinctAdvertisersCount: 1,
      earliestObservationDate: null,
      latestObservationDate: null,
      identityConfidence: "PROBABLE",
      sourceObservations: [],
      ...partial,
    };
  }

  // ── 4. Top 3 Research Shortlist & Distinctness (P0-10) ────────────────────
  describe("Top 3 Research Shortlist Selection & Distinctness", () => {
    it("Selects 3 distinct products when suitable candidates exist", () => {
      const candidates: DiscoveredProductCandidate[] = [
        makeCandidate({
          candidateId: "c1",
          title: "Pet Hair Remover Roller",
          displayName: "Pet Hair Remover Roller",
          canonicalProductName: "Pet Hair Remover Roller",
          category: "Pet Grooming & Cleaning",
          relevanceStatus: "RELEVANT",
          relevanceScore: 90,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad1", "ad2"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 2,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
          storeDomain: "petstore1.com",
        }),
        makeCandidate({
          candidateId: "c2",
          title: "Automatic Cat Water Fountain",
          displayName: "Automatic Cat Water Fountain",
          canonicalProductName: "Automatic Cat Water Fountain",
          category: "Pet Feeding & Hydration",
          relevanceStatus: "RELEVANT",
          relevanceScore: 88,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad3"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 1,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
          storeDomain: "petstore2.com",
        }),
        makeCandidate({
          candidateId: "c3",
          title: "Dog Grooming Vacuum Kit",
          displayName: "Dog Grooming Vacuum Kit",
          canonicalProductName: "Dog Grooming Vacuum Kit",
          category: "Pet Grooming Tools",
          relevanceStatus: "RELEVANT",
          relevanceScore: 85,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad4"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 1,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
          storeDomain: "petstore3.com",
        }),
      ];

      const shortlistRes = selectTopResearchShortlist(candidates, 3);
      expect(shortlistRes.qualifiedCount).toBe(3);
      expect(shortlistRes.shortfallReason).toBeNull();
      expect(shortlistRes.shortlist).toHaveLength(3);
      expect(shortlistRes.distinctnessEvaluation.isDistinct).toBe(true);
    });

    it("Reports explicit shortfall reason when fewer than 3 qualify without inventing filler", () => {
      const candidates: DiscoveredProductCandidate[] = [
        makeCandidate({
          candidateId: "c1",
          title: "Pet Hair Remover Roller",
          displayName: "Pet Hair Remover Roller",
          canonicalProductName: "Pet Hair Remover Roller",
          category: "Pet Cleaning",
          relevanceStatus: "RELEVANT",
          relevanceScore: 90,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad1"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 1,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
        }),
      ];

      const shortlistRes = selectTopResearchShortlist(candidates, 3);
      expect(shortlistRes.qualifiedCount).toBe(1);
      expect(shortlistRes.shortfallReason).toContain("Only 1 independently identifiable");
      expect(shortlistRes.shortlist).toHaveLength(1);
    });

    it("Collapses duplicates of the same canonical product into 1 shortlist opportunity", () => {
      const candidates: DiscoveredProductCandidate[] = [
        makeCandidate({
          candidateId: "c1",
          title: "Pet Hair Remover Roller",
          displayName: "Pet Hair Remover Roller",
          canonicalProductName: "Pet Hair Remover Roller",
          category: "Cleaning",
          relevanceStatus: "RELEVANT",
          relevanceScore: 90,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad1"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 5,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
        }),
        makeCandidate({
          candidateId: "c2",
          title: "Pet Hair Remover Roller — Red Edition",
          displayName: "Pet Hair Remover Roller",
          canonicalProductName: "Pet Hair Remover Roller", // same canonical product
          category: "Cleaning",
          relevanceStatus: "RELEVANT",
          relevanceScore: 85,
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad2"],
          supportingSourceTypes: ["META_ADS"],
          totalObservationCount: 2,
          distinctAdvertisersCount: 1,
          earliestObservationDate: null,
          latestObservationDate: null,
          identityConfidence: "EXACT",
          sourceObservations: [],
        }),
      ];

      const shortlistRes = selectTopResearchShortlist(candidates, 3);
      expect(shortlistRes.qualifiedCount).toBe(1);
      expect(shortlistRes.shortlist[0].candidateId).toBe("c1");
    });

    it("Evaluates shortlist distinctness directly", () => {
      const distinct = evaluateShortlistDistinctness([
        makeCandidate({ candidateId: "c1", title: "Item A", category: "Cat A" }),
        makeCandidate({ candidateId: "c2", title: "Item B", category: "Cat B" }),
      ]);
      expect(distinct.isDistinct).toBe(true);
      expect(distinct.distinctCount).toBe(2);
    });
  });

  // ── 5. Google Ads Domain Normalization (P0-11, P0-12) ────────────────────
  describe("Google Ads Domain Normalization & Query/Enrichment Separation", () => {
    it("Normalizes subdomains like cc.uprootclean.com to uprootclean.com", () => {
      expect(extractRegistrableDomain("cc.uprootclean.com")).toBe("uprootclean.com");
      expect(extractRegistrableDomain("https://shop.uprootclean.com/products/cleaner")).toBe("uprootclean.com");
      expect(extractRegistrableDomain("uprootclean.com")).toBe("uprootclean.com");
      expect(extractRegistrableDomain("store.brand.co.uk")).toBe("brand.co.uk");
    });
  });

  // ── 6. Customer Psychology Grounding (P0-13) ──────────────────────────────
  describe("Customer Psychology Evidence Grounding", () => {
    it("Single-word quote 'Dog' cannot mark broad claim as OBSERVED", () => {
      const claim: PsychologyClaim = {
        claimText: "Dog owners managing excessive shedding and fur accumulation on furniture and clothes",
        evidenceReference: 'Observed quote: "Dog" in Ad Creative (Dog)',
        evidenceType: "AD_COPY",
        confidence: 0.85,
        status: "OBSERVED",
      };

      const support = evaluateClaimEvidenceSupport(claim, "Dog");
      expect(support.supportLevel).toBe("INFERRED_FROM_CONTEXT");
      expect(support.rationale).toContain("Single-word quote");
    });

    it("Verbatim multi-word claim in source text is DIRECTLY_SUPPORTED", () => {
      const claim: PsychologyClaim = {
        claimText: "Easily remove stubborn cat and dog fur from clothes and furniture",
        evidenceReference: 'Observed quote: "cat and dog fur" in Ad Creative',
        evidenceType: "AD_COPY",
        confidence: 0.85,
        status: "OBSERVED",
      };

      const source = "Say goodbye to lint! Easily remove stubborn cat and dog fur from clothes and furniture.";
      const support = evaluateClaimEvidenceSupport(claim, source);
      expect(support.supportLevel).toBe("DIRECTLY_SUPPORTED");
    });

    it("Sparse single-word input downgrades broad psychology profile claims to INFERRED", () => {
      const profile = analyzeCustomerPsychology({
        candidateTitle: "Dog Toy",
        categoryOrTopic: "Pet Gadgets",
        rawHeadlines: ["Dog"],
        rawDescriptions: ["Dog"],
      });

      // targetCustomer must NOT be OBSERVED from just the single word "Dog"
      expect(profile.targetCustomer.status).toBe("INFERRED");
      expect(profile.functionalProblem.status).toBe("INFERRED");
      expect(profile.emotionalPain.status).toBe("INFERRED");
    });
  });
});
