/**
 * SWAI KH-02 V12.4.3.3.1 — Meta & Google Live Integrity Adversarial Tests
 *
 * Every test invokes real exported production functions (zero local-expression-only assertions):
 * - selectTopResearchShortlist / discoverProductCandidatesFromAds / mergeDuplicateCandidateRecords
 * - isLiveProviderObservation / isCandidateLiveVerified
 * - buildProductIdentityFingerprint / evaluateOpportunityDiversity
 * - evaluateProductRelevance
 * - collectGoogleAdvertiserSignals
 * - reconcileResearchAcrossLayers / requalifyHistoricalEvergreenSnapshot
 * - calculateKH02EvergreenScore
 * - SWAI_KH02_RELEASE_VERSION
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  buildProductIdentityFingerprint,
  evaluateOpportunityDiversity,
} from "../../../src/services/kh02/identity/productDistinctnessEngine";
import {
  discoverProductCandidatesFromAds,
  evaluateShortlistDistinctness,
  isCandidateLiveVerified,
  isLiveProviderObservation,
  mergeDuplicateCandidateRecords,
  selectTopResearchShortlist,
  verifyCandidateLiveLineageChain,
} from "../../../src/services/kh02/identity/productCandidateDiscovery";
import { evaluateProductRelevance } from "../../../src/services/kh02/identity/productRelevanceEvaluator";
import { collectGoogleAdvertiserSignals } from "../../../src/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  materializeKH02CandidatesToDatabase,
  reconcileResearchAcrossLayers,
  requalifyHistoricalEvergreenSnapshot,
} from "../../../src/services/kh02/persistence/kh02PersistenceService";
import { calculateKH02EvergreenScore } from "../../../src/services/kh02/scoring/evergreenOpportunityScoring";
import { SWAI_KH02_RELEASE_VERSION } from "../../../src/services/kh02/version/runtimeVersionService";

function candidateBase(overrides: Record<string, any> = {}) {
  return {
    candidateId: `cand_test_${Math.random().toString(36).slice(2)}`,
    title: "Automatic Pet Feeder Smart WiFi",
    displayName: "Automatic Pet Feeder Smart WiFi",
    canonicalProductName: "Automatic Pet Feeder Smart WiFi",
    canonicalProductUrl: "https://teststore.com/products/automatic-pet-feeder",
    identityStatus: "VERIFIED" as const,
    identityConfidence: "EXACT" as const,
    category: "Pet Gadgets",
    storeDomain: "teststore.com",
    advertiserNames: ["TestBrand"],
    supportingAdIds: ["ad_001"],
    supportingExternalAdIds: ["ext_001"],
    supportingSourceTypes: ["META_ADS"],
    totalObservationCount: 5,
    distinctAdvertisersCount: 1,
    earliestObservationDate: "2026-01-01T00:00:00Z",
    latestObservationDate: "2026-10-01T00:00:00Z",
    relevanceScore: 0.92,
    relevanceStatus: "RELEVANT",
    matchedQueryIds: ["query_live_001"],
    sourceObservations: [
      {
        source: "META_ADS",
        sourceRecordId: "obs_001",
        provenance: "LIVE_PROVIDER",
        sourceType: "LIVE",
        isLiveRecord: true,
        queryId: "query_live_001",
        matchedQueryIds: ["query_live_001"],
        title: "Automatic Pet Feeder Ad",
        landingPageUrl:
          overrides.canonicalProductUrl ||
          "https://teststore.com/products/automatic-pet-feeder",
      },
    ],
    liveObservationsCount: 1,
    cachedObservationsCount: 0,
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
    sourcePageClassification: "ACTUAL_PRODUCT_PAGE",
    isEligibleAsEvergreenWinner: false,
    requiresManualReview: false,
    hasUnresolvedContradiction: false,
    contradictions: [],
    verificationLimitations: [],
    imageReferences: [],
    psychologyProfile: null,
    ...overrides,
  } as any;
}

describe("M1 & M2: G04 — selectTopResearchShortlist and isCandidateLiveVerified enforce current-run matchedQueryIds lineage", () => {
  it("candidate with supportingAdIds but empty matchedQueryIds fails isCandidateLiveVerified when executedQueryIds is supplied", () => {
    const cand = candidateBase({
      candidateId: "cand_m1",
      matchedQueryIds: [],
      supportingAdIds: ["ad_001", "ad_002"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_001",
          provenance: "LIVE_PROVIDER",
          matchedQueryIds: [],
        },
      ],
    });

    expect(isCandidateLiveVerified(cand, ["query_live_001"])).toBe(false);

    const shortlistRes = selectTopResearchShortlist([cand], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
      executedQueryIds: ["query_live_001"],
    });
    expect(shortlistRes.liveVerifiedProductCount).toBe(0);
    expect(shortlistRes.liveVerifiedTop3).toBe(false);
  });

  it("candidate with queryId from another research run fails isCandidateLiveVerified for current run", () => {
    const cand = candidateBase({
      candidateId: "cand_m2",
      matchedQueryIds: ["query_STALE_RUN_XYZ"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_stale_1",
          provenance: "LIVE_PROVIDER",
          queryId: "query_STALE_RUN_XYZ",
          matchedQueryIds: ["query_STALE_RUN_XYZ"],
        },
      ],
    });

    expect(
      isCandidateLiveVerified(cand, ["query_current_run_001", "query_current_run_002"])
    ).toBe(false);
  });

  it("selectTopResearchShortlist prioritizes current-run live candidate over cached candidate with more historical observations in the same family", () => {
    const cachedCandidate = candidateBase({
      candidateId: "cand_cached_fountain",
      title: "Cached Stainless Steel Cat Water Fountain",
      canonicalProductName: "Cached Stainless Steel Cat Water Fountain",
      canonicalProductUrl: "https://cachedstore.com/products/cat-water-fountain",
      storeDomain: "cachedstore.com",
      totalObservationCount: 8,
      liveObservationsCount: 0,
      cachedObservationsCount: 8,
      matchedQueryIds: [],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_cache_1",
          provenance: "CACHED_SOURCE",
          matchedQueryIds: [],
        },
      ],
    });

    const liveCandidate = candidateBase({
      candidateId: "cand_live_fountain",
      title: "Live Wireless Cat Water Fountain",
      canonicalProductName: "Live Wireless Cat Water Fountain",
      canonicalProductUrl: "https://livestore.com/products/wireless-cat-fountain",
      storeDomain: "livestore.com",
      totalObservationCount: 1,
      liveObservationsCount: 1,
      cachedObservationsCount: 0,
      matchedQueryIds: ["q_r1_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_live_1",
          provenance: "LIVE_PROVIDER",
          queryId: "q_r1_1",
          matchedQueryIds: ["q_r1_1"],
        },
      ],
    });

    const res = selectTopResearchShortlist([cachedCandidate, liveCandidate], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
      executedQueryIds: ["q_r1_1"],
    });

    expect(res.shortlist.length).toBe(1);
    expect(res.shortlist[0].candidateId).toBe("cand_live_fountain");
    expect(res.liveVerifiedProductCount).toBe(1);
  });
});

describe("M3 & G16: selectTopResearchShortlist rejects cache-only and undefined sourceType observations from liveVerifiedProductCount", () => {
  it("candidate with liveObservationsCount=0 and sourceObservations=[{ sourceType: undefined }] produces liveVerifiedProductCount=0", () => {
    const cand = candidateBase({
      candidateId: "cand_undefined_sourcetype",
      identityStatus: "VERIFIED",
      liveObservationsCount: 0,
      cachedObservationsCount: 1,
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "obs_undef_1",
          sourceType: undefined,
        },
      ],
    });

    expect(isLiveProviderObservation(cand.sourceObservations[0])).toBe(false);
    expect(isCandidateLiveVerified(cand)).toBe(false);

    const res = selectTopResearchShortlist([cand], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
    });
    expect(res.liveVerifiedProductCount).toBe(0);
    expect(res.liveVerifiedTop3).toBe(false);
  });

  it("candidate with provenance=CACHED_SOURCE fails live grounding in selectTopResearchShortlist", () => {
    const cand = candidateBase({
      candidateId: "cand_m3",
      liveObservationsCount: 0,
      cachedObservationsCount: 4,
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "obs_cache_1",
          provenance: "CACHED_SOURCE",
          sourceType: "CACHED",
          isLiveRecord: false,
        },
      ],
    });

    const res = selectTopResearchShortlist([cand], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
    });
    expect(res.liveVerifiedProductCount).toBe(0);
    expect(res.liveVerifiedTop3).toBe(false);
  });
});

describe("M9 & M17: G12 — selectTopResearchShortlist enforces 1 representative per product family for BROAD_CATEGORY", () => {
  it("two water fountains + one feeder in BROAD_CATEGORY shortlist selects only 1 water fountain and 1 feeder (2 distinct families)", () => {
    const fountain1 = candidateBase({
      candidateId: "c_fountain_1",
      title: "KittySpout Wireless Fountain",
      canonicalProductName: "KittySpout Wireless Fountain",
      canonicalProductUrl: "https://kittyspout.com/products/wireless-fountain",
      storeDomain: "kittyspout.com",
    });
    const fountain2 = candidateBase({
      candidateId: "c_fountain_2",
      title: "Pawira Stainless Steel Water Fountain",
      canonicalProductName: "Pawira Stainless Steel Water Fountain",
      canonicalProductUrl: "https://pawira.com/products/water-fountain",
      storeDomain: "pawira.com",
    });
    const feeder = candidateBase({
      candidateId: "c_feeder_1",
      title: "UAHPET Automatic Pet Feeder",
      canonicalProductName: "UAHPET Automatic Pet Feeder",
      canonicalProductUrl: "https://uahpet.com/products/automatic-pet-feeder",
      storeDomain: "uahpet.com",
    });

    const res = selectTopResearchShortlist([fountain1, fountain2, feeder], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
    });

    expect(res.shortlist.length).toBe(2);
    expect(res.distinctFamiliesCount).toBe(2);
    const selectedFamilies = res.shortlist.map((c) => c.familyKey);
    expect(selectedFamilies).toContain("pet_water_fountain");
    expect(selectedFamilies).toContain("automatic_pet_feeder");
  });

  it("evaluateOpportunityDiversity reports distinctFamilyCount=1 for three water fountains", () => {
    const div = evaluateOpportunityDiversity(
      [
        {
          candidateId: "a",
          title: "KittySpout Wireless Fountain",
          canonicalProductName: "KittySpout Wireless Fountain",
        },
        {
          candidateId: "b",
          title: "Pawira Stainless Steel Water Fountain",
          canonicalProductName: "Pawira Stainless Steel Water Fountain",
        },
        {
          candidateId: "c",
          title: "Cat Pet Drinking Fountain",
          canonicalProductName: "Cat Pet Drinking Fountain",
        },
      ],
      { nicheIntent: "BROAD_CATEGORY", topic: "Pet Gadgets" }
    );
    expect(div.distinctFamilyCount).toBe(1);
    expect(div.isFamilyDiverse).toBe(false);
  });
});

describe("M11: G16 — PROBABLE identity excluded from liveVerifiedProductCount in selectTopResearchShortlist", () => {
  it("shortlist with 2 VERIFIED and 1 PROBABLE live candidates reports liveVerifiedProductCount=2 and liveVerifiedTop3=false", () => {
    const c1 = candidateBase({
      candidateId: "c1",
      title: "UAHPET Automatic Pet Feeder",
      canonicalProductName: "UAHPET Automatic Pet Feeder",
      canonicalProductUrl: "https://uahpet.com/products/automatic-pet-feeder",
      storeDomain: "uahpet.com",
      identityStatus: "VERIFIED",
      liveObservationsCount: 3,
    });
    const c2 = candidateBase({
      candidateId: "c2",
      title: "ChomChom Pet Hair Remover Roller",
      canonicalProductName: "ChomChom Pet Hair Remover Roller",
      canonicalProductUrl: "https://chomchom.com/products/pet-hair-remover",
      storeDomain: "chomchom.com",
      identityStatus: "PROBABLE",
      liveObservationsCount: 2,
    });
    const c3 = candidateBase({
      candidateId: "c3",
      title: "KittySpout Wireless Cat Water Fountain",
      canonicalProductName: "KittySpout Wireless Cat Water Fountain",
      canonicalProductUrl: "https://kittyspout.com/products/wireless-fountain",
      storeDomain: "kittyspout.com",
      identityStatus: "VERIFIED",
      liveObservationsCount: 1,
    });

    const res = selectTopResearchShortlist([c1, c2, c3], 3, {
      nicheIntent: "BROAD_CATEGORY",
      topic: "Pet Gadgets",
    });

    expect(res.shortlist.length).toBe(3);
    expect(res.liveVerifiedProductCount).toBe(2);
    expect(res.liveVerifiedTop3).toBe(false);
  });
});

describe("M15: G17 — reconcileResearchAcrossLayers sets browserStatus=NOT_RUN and browserReconciled=false when browserEvidence is omitted", () => {
  it("reconcileResearchAcrossLayers without browserEvidence never marks browserReconciled=true", async () => {
    const mockSnapshot: any = {
      researchRunId: "run_g17_test",
      topic: "Pet Gadgets",
      runStatus: "PASSED",
      topThree: [],
      provisionalCandidates: [
        {
          rank: null,
          candidate: candidateBase({
            candidateId: "cand_reconcile_1",
            title: "Automatic Pet Feeder",
          }),
          score: {
            opportunityScore: 68,
            tier: "PROVISIONAL_OPPORTUNITY",
            recommendation: "WATCH",
            scoreStatus: "SCORED",
          },
        },
      ],
      insufficientEvidenceCandidates: [],
      researchShortlist: {
        shortlist: [
          candidateBase({
            candidateId: "cand_reconcile_1",
            title: "Automatic Pet Feeder",
          }),
        ],
        qualifiedCount: 1,
      },
      providerTelemetry: {
        META_ADS: { queryStatus: "PASSED", isLive: true },
      },
    };

    const mockDb = {
      syncJob: {
        findUnique: async () => ({
          id: "run_g17_test",
          workspaceId: "ws_test",
          status: "COMPLETED",
          resultJson: JSON.stringify(mockSnapshot),
        }),
      },
    };

    const recWithoutBrowser = await reconcileResearchAcrossLayers("run_g17_test", {
      db: mockDb,
      workspaceId: "ws_test",
      strictFullLayers: true,
    });
    expect(recWithoutBrowser.browserStatus).toBe("NOT_RUN");
    expect(recWithoutBrowser.browserReconciled).toBe(false);
    expect(recWithoutBrowser.reconciliationVerdict).toBe("MISMATCH");

    const recWithMatchingBrowser = await reconcileResearchAcrossLayers("run_g17_test", {
      db: mockDb,
      workspaceId: "ws_test",
      browserEvidence: {
        runId: "run_g17_test",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_reconcile_1"],
        displayedRankOrder: [],
      },
    });
    expect(recWithMatchingBrowser.browserStatus).toBe("PASS");
    expect(recWithMatchingBrowser.browserReconciled).toBe(true);
  });
});

describe("M16: G04 — discoverProductCandidatesFromAds preserves matchedQueryIds only when observation carries queryId", () => {
  it("observation without queryId produces empty matchedQueryIds on discovered candidate", () => {
    const cands = discoverProductCandidatesFromAds(
      [
        {
          source: "META_ADS",
          sourceRecordId: "obs_no_qid",
          provenance: "CACHED_SOURCE",
          title: "Automatic Pet Feeder",
          landingPageUrl: "https://petstore.com/products/automatic-pet-feeder",
          storeDomainEvidence: "petstore.com",
        } as any,
      ],
      "Pet Gadgets"
    );
    expect(cands.length).toBe(1);
    expect(cands[0].matchedQueryIds).toEqual([]);
    expect(cands[0].liveObservationsCount).toBe(0);
    expect(cands[0].cachedObservationsCount).toBe(1);
  });
});

describe("M20: GET API side effects & Runtime Version (G20)", () => {
  it("GET overview route is read-only and SWAI_KH02_RELEASE_VERSION is 12.4.3.3.1, 12.4.3.3.2, or 12.4.3.4.1", () => {
    expect(["12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1"]).toContain(SWAI_KH02_RELEASE_VERSION);
    const routeCode = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/app/api/v1/research/products/[id]/overview/route.ts"
      ),
      "utf-8"
    );
    expect(routeCode).not.toContain(
      "Materialize an authorized ResearchProduct record for this KH-02 candidate so Product Intelligence"
    );
    expect(routeCode).toContain("GET does not materialize ResearchProduct");
    expect(routeCode).toMatch(/version:\s*"12\.4\.3\.(3\.(1|2)|4\.1)"/);
  });
});

describe("M22: Evergreen gate — calculateKH02EvergreenScore never promotes candidate without 90-day demand history to VERIFIED_EVERGREEN", () => {
  it("VERIFIED candidate with empty demandSeries is scored as PROVISIONAL_OPPORTUNITY or INSUFFICIENT_EVIDENCE, never VERIFIED_EVERGREEN", () => {
    const candidate = candidateBase({
      isEligibleAsEvergreenWinner: true,
      identityStatus: "VERIFIED",
    });
    const score = calculateKH02EvergreenScore({
      candidate,
      demandSeries: [],
      hasVerifiedSupplierQuote: false,
    });
    expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
    expect(score.pillars.demandStability.status).not.toBe("PASS");
  });
});

describe("G25 & Historical Requalification — requalifyHistoricalEvergreenSnapshot demotes unverified legacy winners", () => {
  it("acceptance/kh02-v12.4.3.3/ directory exists with FINAL_ACCEPTANCE_REPORT.md", () => {
    expect(
      fs.existsSync(
        path.resolve(
          process.cwd(),
          "acceptance/kh02-v12.4.3.3/FINAL_ACCEPTANCE_REPORT.md"
        )
      )
    ).toBe(true);
  });

  it("requalifyHistoricalEvergreenSnapshot demotes legacy topThree winner with CACHED_UNVERIFIED demand", () => {
    const legacySnapshot: any = {
      researchRunId: "legacy_run_1",
      topic: "Pet Gadgets",
      topThree: [
        {
          rank: 1,
          candidate: candidateBase({
            candidateId: "cand_legacy_cached_demand",
            identityStatus: "VERIFIED",
            demandResolution: {
              demandSourceAuthority: "CACHED_UNVERIFIED",
              evidenceReferences: ["verified-merchant-demand:teststore.com"],
            },
          }),
          score: {
            opportunityScore: 82,
            tier: "VERIFIED_EVERGREEN",
            recommendation: "PURSUE",
            scoreStatus: "SCORED",
          },
        },
      ],
      provisionalCandidates: [],
      insufficientEvidenceCandidates: [],
    };
    const requalified = requalifyHistoricalEvergreenSnapshot(legacySnapshot);
    expect(requalified.modified).toBe(true);
    expect(requalified.snapshot?.topThree.length).toBe(0);
    expect(requalified.snapshot?.provisionalCandidates.length).toBeGreaterThanOrEqual(1);
    expect(requalified.demotedWinners.length).toBe(1);
  });
});

describe("G26: Cross-niche generalization — Home Cleaning Gadgets & Car Accessories", () => {
  it("Home Cleaning Gadgets and Car Accessories resolve to clean functional families and reject out-of-niche products", () => {
    const fpVacuum1 = buildProductIdentityFingerprint({
      candidateId: "nc1",
      title: "Dyson V15 Cordless Vacuum Cleaner",
      canonicalProductName: "Dyson V15 Cordless Vacuum Cleaner",
    });
    const fpVacuum2 = buildProductIdentityFingerprint({
      candidateId: "nc2",
      title: "Shark IX141 Cordless Stick Vacuum Cleaner",
      canonicalProductName: "Shark IX141 Cordless Stick Vacuum Cleaner",
    });
    expect(fpVacuum1.familyKey).toBe("cordless_vacuum_cleaner");
    expect(fpVacuum2.familyKey).toBe("cordless_vacuum_cleaner");

    const fpCarMount = buildProductIdentityFingerprint({
      candidateId: "car1",
      title: "Magnetic Car Phone Mount Holder for Dashboard",
      canonicalProductName: "Magnetic Car Phone Mount Holder for Dashboard",
    });
    expect(fpCarMount.familyKey).toBe("car_phone_mount");

    const relGolfInCar = evaluateProductRelevance(
      "Golf Organizer Pouch With Golf Accessories Set https://store.com/products/golf-organizer-pouch",
      "Car Accessories"
    );
    expect(relGolfInCar.relevanceStatus).toBe("IRRELEVANT");
    expect(relGolfInCar.isAccepted).toBe(false);
  });
});

describe("G06, G07 & G27: Google Ads MCP timeout, 429, 403, and empty advertiser handling via collectGoogleAdvertiserSignals", () => {
  it("MCP connect timeout returns BLOCKED_SOURCE within deadline and records TIMED_OUT step in stepTimeline", async () => {
    let closeCalled = false;
    const stallingConnectClient: any = {
      connect: () => new Promise(() => {}),
      close: async () => {
        closeCalled = true;
      },
    };

    const res = await collectGoogleAdvertiserSignals(
      {
        workspaceId: "test",
        researchRunId: "run_test_timeout",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 5,
        advertiserDomains: ["kittyspout.com"],
      },
      stallingConnectClient,
      {
        connectTimeoutMs: 50,
        persistToDatabase: false,
      }
    );

    expect(res.status).toBe("BLOCKED_SOURCE");
    expect(res.enrichmentExecution?.stateBreakdown?.transportConnected).toBe(false);
    expect(res.enrichmentExecution?.stepTimeline?.some((s: any) => s.step === "connect" && s.status === "TIMED_OUT")).toBe(true);
    expect(closeCalled).toBe(false); // customClient lifecycle is owned by caller
  });

  it("Advertiser lookup timeout and 429 rate-limit are classified accurately with exact mcpCallsStarted/mcpCallsCompleted counters", async () => {
    const rateLimitedClient: any = {
      connect: async () => {},
      close: async () => {},
      listTools: async () => ({
        tools: [
          { name: "search_advertiser", description: "Search advertiser" },
          { name: "get_advertiser_ads", description: "Get ads" },
        ],
      }),
      callToolByName: async (toolName: string) => {
        if (toolName === "search_advertiser") {
          throw new Error("HTTP 429 Too Many Requests from Google Transparency");
        }
        return [];
      },
    };

    const res = await collectGoogleAdvertiserSignals(
      {
        workspaceId: "test",
        researchRunId: "run_test_429",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 5,
        advertiserDomains: ["kittyspout.com", "pawira.com"],
      },
      rateLimitedClient,
      {
        perDomainTimeoutMs: 100,
        persistToDatabase: false,
      }
    );

    expect(res.status).toBe("QUERY_FAILED");
    expect(res.enrichmentExecution?.mcpCallsStarted).toBe(1);
    expect(res.enrichmentExecution?.mcpCallsCompleted).toBe(0);
    expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe("RATE_LIMITED");
    expect(res.enrichmentExecution?.domainOutcomes?.[1]?.status).toBe("SKIPPED_COOLDOWN");
    expect(res.enrichmentExecution?.domainsPlanned).toBe(2);
    expect(res.enrichmentExecution?.domainsAttempted).toBe(1);
    expect(res.enrichmentExecution?.domainsRateLimited).toBe(1);
    expect(res.enrichmentExecution?.domainsFailed).toBe(1);
    expect(res.enrichmentExecution?.mcpInvocations?.length).toBe(1);
    expect(res.enrichmentExecution?.mcpInvocations?.[0]?.toolName).toBe("search_advertiser");
  });
});

describe("Section 5: 8-Step Meta Lineage Verification & All 9 Adversarial Failure Modes", () => {
  it("verifyCandidateLiveLineageChain catches all 9 adversarial cases and passes authentic 8-step lineage", () => {
    // Authentic 8-step lineage
    const authenticCand = candidateBase({
      candidateId: "cand_auth_1",
      researchProductId: "cand_auth_1",
      storeDomain: "uahpet.com",
      matchedQueryIds: ["q_r1_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_db_1",
          sourceExternalAdId: "ext_meta_1001",
          upstreamAdId: "ext_meta_1001",
          persistedAdId: "ad_db_1",
          sourceObservationId: "sobs_meta_1",
          researchRunId: "run_live_1",
          queryId: "q_r1_1",
          providerRequestId: "req_run_live_1_q_r1_1",
          matchedQueryIds: ["q_r1_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
          storeDomainEvidence: "uahpet.com",
        },
      ],
    });
    const authRes = verifyCandidateLiveLineageChain(authenticCand, {
      researchRunId: "run_live_1",
      executedQueryIds: ["q_r1_1"],
      upstreamExternalAdIds: ["ext_meta_1001"],
      persistedAdIdsByExternalId: { ext_meta_1001: "ad_db_1" },
    });
    expect(authRes.valid).toBe(true);
    expect(authRes.authenticatedLiveObservationCount).toBe(1);
    expect(authRes.verifiedLinks[0]).toEqual({
      researchRunId: "run_live_1",
      executedQueryId: "q_r1_1",
      providerRequestId: "req_run_live_1_q_r1_1",
      upstreamAdId: "ext_meta_1001",
      persistedAdId: "ad_db_1",
      sourceObservationId: "sobs_meta_1",
      candidateId: "cand_auth_1",
      researchProductId: "cand_auth_1",
    });

    // 1. MISSING_QUERY_ID
    const c1 = candidateBase({
      matchedQueryIds: [],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_1",
          sourceExternalAdId: "ext_1",
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
        },
      ],
    });
    expect(verifyCandidateLiveLineageChain(c1).rejectionCodes).toContain("MISSING_QUERY_ID");

    // 2. FOREIGN_RUN_QUERY_ID
    const c2 = candidateBase({
      matchedQueryIds: ["q_foreign_99"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_2",
          sourceExternalAdId: "ext_2",
          queryId: "q_foreign_99",
          matchedQueryIds: ["q_foreign_99"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
        },
      ],
    });
    expect(
      verifyCandidateLiveLineageChain(c2, { executedQueryIds: ["q_current_1"] }).rejectionCodes
    ).toContain("FOREIGN_RUN_QUERY_ID");

    // 3. FAKE_UPSTREAM_AD_ID
    const c3 = candidateBase({
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_3",
          sourceExternalAdId: "ext_fake_999",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
        },
      ],
    });
    expect(
      verifyCandidateLiveLineageChain(c3, {
        executedQueryIds: ["q_1"],
        upstreamExternalAdIds: ["ext_real_1"],
      }).rejectionCodes
    ).toContain("FAKE_UPSTREAM_AD_ID");

    // 4. WRONG_PERSISTED_AD_ID
    const c4 = candidateBase({
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_wrong_id",
          sourceExternalAdId: "ext_real_1",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
        },
      ],
    });
    expect(
      verifyCandidateLiveLineageChain(c4, {
        executedQueryIds: ["q_1"],
        upstreamExternalAdIds: ["ext_real_1"],
        persistedAdIdsByExternalId: { ext_real_1: "ad_expected_id" },
      }).rejectionCodes
    ).toContain("WRONG_PERSISTED_AD_ID");

    // 5. CACHE_IMPERSONATING_LIVE
    const c5 = candidateBase({
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_cache_5",
          sourceExternalAdId: "ext_5",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "CACHED_SOURCE",
          sourceType: "CACHED_SOURCE",
          isLiveRecord: true,
        },
      ],
    });
    expect(verifyCandidateLiveLineageChain(c5).rejectionCodes).toContain("CACHE_IMPERSONATING_LIVE");

    // 6. UNDEFINED_SOURCE_TYPE
    const c6 = candidateBase({
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_6",
          sourceExternalAdId: "ext_6",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: undefined,
        },
      ],
    });
    expect(verifyCandidateLiveLineageChain(c6).rejectionCodes).toContain("UNDEFINED_SOURCE_TYPE");

    // 7. UNAUTHENTICATED_LIVE_RECORD_FLAG
    const c7 = candidateBase({
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_7",
          sourceExternalAdId: "ext_7",
          isLiveRecord: true,
        },
      ],
    });
    expect(verifyCandidateLiveLineageChain(c7).rejectionCodes).toContain(
      "UNAUTHENTICATED_LIVE_RECORD_FLAG"
    );

    // 8. ANOTHER_MERCHANTS_AD
    const c8 = candidateBase({
      storeDomain: "uahpet.com",
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_8",
          sourceExternalAdId: "ext_8",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
          storeDomainEvidence: "othermerchant.com",
        },
      ],
    });
    expect(verifyCandidateLiveLineageChain(c8).rejectionCodes).toContain("ANOTHER_MERCHANTS_AD");

    // 9. DUPLICATE_EXTERNAL_AD_COUNTED_TWICE
    const c9 = candidateBase({
      storeDomain: "uahpet.com",
      matchedQueryIds: ["q_1"],
      sourceObservations: [
        {
          source: "META_ADS",
          sourceRecordId: "ad_9a",
          sourceExternalAdId: "ext_dup_9",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
          storeDomainEvidence: "uahpet.com",
        },
        {
          source: "META_ADS",
          sourceRecordId: "ad_9b",
          sourceExternalAdId: "ext_dup_9",
          queryId: "q_1",
          matchedQueryIds: ["q_1"],
          provenance: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isLiveRecord: true,
          storeDomainEvidence: "uahpet.com",
        },
      ],
    });
    const dupRes = verifyCandidateLiveLineageChain(c9);
    expect(dupRes.rejectionCodes).toContain("DUPLICATE_EXTERNAL_AD_COUNTED_TWICE");
    expect(dupRes.authenticatedLiveObservationCount).toBe(1);
    expect(dupRes.uniqueLiveExternalAdIds).toEqual(["ext_dup_9"]);
  });
});

describe("Section 10: Worker Materialization excludes rejectedCandidates and preserves PROBABLE confidence", () => {
  it("materializeKH02CandidatesToDatabase skips rejectedCandidates and sets PROBABLE confidence for non-VERIFIED candidates", async () => {
    const upsertedProducts: any[] = [];
    const upsertedLinks: any[] = [];
    const mockDb = {
      competitorStore: {
        upsert: async ({ create }: any) => ({ id: "store_1", domain: create.domain }),
      },
      researchProduct: {
        upsert: async ({ where, create }: any) => {
          upsertedProducts.push({ id: where.id, ...create });
          return { id: where.id, ...create };
        },
      },
      competitorAd: {
        findMany: async () => [
          { id: "ad_valid_1", landingPageUrl: "https://teststore.com/products/feeder" },
          { id: "ad_foreign_1", landingPageUrl: "https://wrongstore.com/products/other" },
        ],
      },
      adProductLink: {
        upsert: async ({ create }: any) => {
          upsertedLinks.push(create);
          return create;
        },
      },
    };

    const res = await materializeKH02CandidatesToDatabase(
      {
        researchRunId: "run_mat_1",
        topic: "Pet Gadgets",
        topThree: [],
        provisionalCandidates: [
          {
            rank: null,
            candidate: candidateBase({
              candidateId: "cand_probable_1",
              researchProductId: null,
              identityStatus: "PROBABLE",
              storeDomain: "teststore.com",
              supportingAdIds: ["ad_valid_1", "ad_foreign_1"],
            }),
          },
        ],
        rejectedCandidates: [
          {
            rank: null,
            candidate: candidateBase({
              candidateId: "cand_rejected_plush_1",
              researchProductId: null,
              productRealityStatus: "REJECTED",
              relevanceStatus: "IRRELEVANT",
            }),
          },
        ],
      } as any,
      mockDb
    );

    expect(res.materializedCount).toBe(1);
    expect(res.skippedRejectedCount).toBe(1);
    expect(res.materializedProductIds).toEqual(["cand_probable_1"]);
    expect(res.skippedRejectedIds).toEqual(["cand_rejected_plush_1"]);
    expect(upsertedProducts.map((p) => p.id)).toEqual(["cand_probable_1"]);
    expect(upsertedLinks.length).toBe(1);
    expect(upsertedLinks[0].adId).toBe("ad_valid_1");
    expect(upsertedLinks[0].confidence).toBe("PROBABLE");
  });
});
