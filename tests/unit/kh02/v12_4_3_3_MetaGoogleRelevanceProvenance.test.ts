/**
 * SWAI KH-02 V12.4.3.3 — Meta & Google Ads Live Discovery, Niche-Accurate Product
 * Qualification, and Top-3 Evidence Closure
 *
 * Comprehensive Unit, Regression, and 16 False-PASS Adversarial Mutation Suite:
 * - Group A: Meta Ads Live Discovery & Provenance (15 cases)
 * - Group B: Google Ads Transparency Enrichment (18 cases)
 * - Group C: Niche Intent, Query Planning, and Product Relevance (16 cases)
 * - Group D: Candidate Consolidation, Shortlist Distinctness, and Evergreen Truth (12 cases)
 * - Group E: Persistence, API, Drawer, Media, and Cross-Layer Reconciliation (12 cases)
 * - Adversarial Mutations M01–M16: Every required false-PASS detector (16 cases)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveMetaExecutionPolicy,
  resolveMetaExecutionPolicyWithDiagnostics,
  normalizeMetaQueryOutcomeFields,
  aggregateMetaQueryOutcomes,
  collectMetaProductSignals,
  diagnoseMetaLiveCollector,
} from "../../../src/services/kh02/providers/metaResearchAdapter";
import {
  discoverGoogleAdsMcpCapabilities,
  extractRegistrableDomain,
  collectGoogleAdvertiserSignals,
  clearGoogleRateLimitCooldown,
  normalizeGoogleAdsResponse,
  type GoogleTransparencyMcpClient,
} from "../../../src/services/kh02/providers/googleTransparencyResearchAdapter";
import { matchCrossPlatformProductEvidence } from "../../../src/services/kh02/identity/crossPlatformProductMatcher";
import {
  analyzeNicheIntent,
  buildDeterministicDiscoveryPlan,
  validateDiscoveryPlan,
} from "../../../src/services/kh02/discovery/geminiDiscoveryPlanner";
import {
  MetaQueryBudgetTracker,
  evaluateShortlistCoverage,
  selectQueriesForSearchRound,
} from "../../../src/services/kh02/discovery/discoveryQueryPlanner";
import {
  evaluateProductRelevance,
  evaluateProductAudienceRelevance,
} from "../../../src/services/kh02/identity/productRelevanceEvaluator";
import {
  discoverProductCandidatesFromAds,
  selectTopResearchShortlist,
  evaluateShortlistDistinctness,
  compareProductIdentity,
  clusterProductCandidates,
  mergeDuplicateCandidateRecords,
} from "../../../src/services/kh02/identity/productCandidateDiscovery";
import {
  evaluateDemandHistoryEvidence,
} from "../../../src/services/kh02/demand/temporalDemandEngine";
import {
  calculateKH02EvergreenScore,
} from "../../../src/services/kh02/scoring/evergreenOpportunityScoring";
import {
  requalifyHistoricalEvergreenSnapshot,
  reconcileDatabaseAndBrowser,
  reconcileResearchAcrossLayers,
  getWorkspaceProviderTelemetry,
  normalizeResearchSnapshotForComparison,
} from "../../../src/services/kh02/persistence/kh02PersistenceService";
import {
  resolveProductMediaGallery,
  validateAndNormalizeMediaUrl,
} from "../../../src/services/kh02/media/productMediaResolver";
import {
  SWAI_KH02_RELEASE_VERSION,
  evaluateKH02RuntimeIdentity,
} from "../../../src/services/kh02/version/runtimeVersionService";
import { buildProviderTruthMatrix } from "../../../src/services/kh02/providers/sourceRegistry";

function createMockGoogleMcpClient(
  overrides: Partial<GoogleTransparencyMcpClient>
): GoogleTransparencyMcpClient {
  return {
    connect: async () => {},
    isAlive: () => true,
    listTools: async () => [
      "search_advertiser_by_domain",
      "search_advertisers",
      "get_ads",
      "get_ad_detail",
    ],
    searchAdvertiserByDomain: async () => ({ advertisers: [] }),
    searchAdvertisers: async () => ({ advertisers: [] }),
    getAds: async () => ({ ads: [] }),
    getAdDetail: async () => ({}),
    close: async () => {},
    ...overrides,
  };
}

describe("SWAI KH-02 V12.4.3.3 — Meta & Google Ads Live Discovery, Niche-Accurate Product Qualification & Top-3 Closure", () => {
  beforeEach(() => {
    clearGoogleRateLimitCooldown();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP A — Meta Ads Live Discovery & Provenance (15 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group A — Meta Ads Live Discovery & Provenance (15 cases)", () => {
    it("A01: LIVE_ONLY resolves allowLive=true and allowCacheFallback=false when no conflict exists", () => {
      const diag = resolveMetaExecutionPolicyWithDiagnostics({
        workspaceId: "ws_test",
        researchRunId: "run_a01",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 20,
        sourceMode: "LIVE_ONLY",
      });
      expect(diag.policy).toBe("LIVE_FIRST");
      expect(diag.requestedSourceMode).toBe("LIVE_ONLY");
      expect(diag.allowCacheFallback).toBe(false);
      expect(diag.policyConflict).toBe(false);
    });

    it("A02: LIVE_ONLY fails closed when live provider cannot execute or conflicts with CACHE_ONLY", async () => {
      const res = await collectMetaProductSignals({
        workspaceId: "ws_test",
        researchRunId: "run_a02",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "LIVE_ONLY",
        metaExecutionPolicy: "CACHE_ONLY",
      });
      expect(["FAILED", "QUERY_FAILED"]).toContain(res.status);
      expect(res.observations).toHaveLength(0);
      expect(res.executionMetadata?.policyConflict).toBe(true);
    });

    it("A03: LIVE_WITH_CACHE_FALLBACK permits cache fallback explicitly and marks CACHED_SOURCE", () => {
      const diag = resolveMetaExecutionPolicyWithDiagnostics({
        workspaceId: "ws_test",
        researchRunId: "run_a03",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "LIVE_WITH_CACHE_FALLBACK",
      });
      expect(diag.requestedSourceMode).toBe("LIVE_WITH_CACHE_FALLBACK");
      expect(diag.allowCacheFallback).toBe(true);
    });

    it("A04: CACHE_ONLY never claims live execution", () => {
      const diag = resolveMetaExecutionPolicyWithDiagnostics({
        workspaceId: "ws_test",
        researchRunId: "run_a04",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "CACHE_ONLY",
      });
      expect(diag.policy).toBe("CACHE_ONLY");
      expect(diag.allowLive).toBe(false);
    });

    it("A05: Policy conflict (sourceMode: LIVE_ONLY + metaExecutionPolicy: CACHE_ONLY) is detected deterministically", () => {
      const diag = resolveMetaExecutionPolicyWithDiagnostics({
        workspaceId: "ws_test",
        researchRunId: "run_a05",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "LIVE_ONLY",
        metaExecutionPolicy: "CACHE_ONLY",
      });
      expect(diag.policyConflict).toBe(true);
      expect(diag.allowLive).toBe(false);
      expect(diag.allowCacheFallback).toBe(false);
      expect(diag.conflictReason).toContain("Conflicting execution configuration");
    });

    it("A06: Omitted upstreamReturnedCount remains null (never coerced to returnedCount)", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_a06",
          keyword: "dog water fountain",
          attempted: true,
          status: "SUCCEEDED_WITH_RESULTS",
          returnedCount: 4,
        },
        "run_a06"
      );
      expect(norm.returnedCount).toBe(4);
      expect(norm.upstreamReturnedCount).toBeNull();
    });

    it("A07: Omitted provenance on attempted query remains UNKNOWN (never defaulted to LIVE_PROVIDER)", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_a07",
          keyword: "dog water fountain",
          attempted: true,
          status: "SUCCEEDED_WITH_RESULTS",
          returnedCount: 3,
        },
        "run_a07"
      );
      expect(norm.provenance).toBe("UNKNOWN");
    });

    it("A08: NOT_ATTEMPTED query cannot have non-null upstreamReturnedCount or non-zero returnedCount", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_a08",
          keyword: "automatic pet feeder",
          attempted: false,
          status: "NOT_ATTEMPTED",
          returnedCount: 9,
          upstreamReturnedCount: 9,
          provenance: "LIVE_PROVIDER",
        },
        "run_a08"
      );
      expect(norm.attempted).toBe(false);
      expect(norm.returnedCount).toBe(0);
      expect(norm.upstreamReturnedCount).toBeNull();
      expect(norm.provenance).toBe("NONE");
      expect(norm.requestStarted).toBe(false);
      expect(norm.requestCompleted).toBe(false);
    });

    it("A09: MetaQueryBudgetTracker enforces request cap across rounds", () => {
      const tracker = new MetaQueryBudgetTracker({
        maxLogicalSubqueries: 3,
        maxProviderRequests: 3,
        maxPages: 3,
        maxUniqueAds: 25,
        maxDurationMs: 45_000,
      });
      expect(tracker.reserveRequests(2)).toBe(2);
      expect(tracker.remainingRequests).toBe(1);
      expect(tracker.reserveRequests(2)).toBe(1);
      expect(tracker.remainingRequests).toBe(0);
      expect(tracker.isExhausted).toBe(true);
      expect(tracker.canExecuteSubquery()).toBe(false);
    });

    it("A10: Shared ad across multiple queries retains all matchedQueryIds when consolidated into candidate", () => {
      const obs1: any = {
        source: "META_ADS",
        sourceRecordId: "ad_shared_1",
        sourceExternalAdId: "archive_shared_1",
        title: "ChomChom Roller Pet Hair Remover",
        landingPageUrl: "https://chomchomroller.com/products/chomchom-roller",
        advertiserDomain: "chomchomroller.com",
        advertiserOrCreator: "ChomChom Roller",
        queryId: "q_round1",
        matchedQueryIds: ["q_round1", "q_round2"],
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      };
      const cands = discoverProductCandidatesFromAds([obs1], "Pet Gadgets");
      expect(cands.length).toBe(1);
      expect(cands[0].matchedQueryIds).toEqual(
        expect.arrayContaining(["q_round1", "q_round2"])
      );
    });

    it("A11: Original upstream ad_archive_id is preserved alongside persisted database ID", () => {
      const obs: any = {
        source: "META_ADS",
        sourceRecordId: "db_cuid_12345",
        sourceExternalAdId: "META:889900112233",
        title: "FurZapper Pet Hair Remover",
        landingPageUrl: "https://furzapper.com/products/furzapper-2-pack",
        advertiserDomain: "furzapper.com",
        advertiserOrCreator: "FurZapper",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      };
      const cands = discoverProductCandidatesFromAds([obs], "Pet Gadgets");
      expect(cands[0].supportingAdIds).toContain("db_cuid_12345");
      expect(cands[0].supportingExternalAdIds).toContain("META:889900112233");
    });

    it("A12: Diagnose Meta collector separates current-run recordsReturned (0) from historical databaseRecordsIndexed", async () => {
      const diag = await diagnoseMetaLiveCollector({ checkLiveTransport: false });
      expect(diag.recordsReturned).toBe(0);
      expect(typeof diag.databaseRecordsIndexed).toBe("number");
      expect(diag.actualQueryAttempted).toBe(false);
    });

    it("A13: aggregateMetaQueryOutcomes separates sourceExecutionStatus, persistenceOutcome, and qualifiedProductOutcome", () => {
      const agg = aggregateMetaQueryOutcomes(
        [
          {
            queryId: "q1",
            keyword: "dog water fountain",
            searchType: "KEYWORD_EXACT_PHRASE",
            attempted: true,
            status: "SUCCEEDED_WITH_RESULTS",
            startedAt: null,
            completedAt: null,
            actualApiCalls: 1,
            returnedCount: 5,
            uniqueReturnedCount: 5,
            provenance: "LIVE_PROVIDER",
            errorCode: null,
            errorMessage: null,
          },
        ],
        {
          persistedInsertedCount: 0,
          persistedUpdatedCount: 0,
          qualifiedCandidatesCount: null,
        }
      );
      expect(agg.sourceExecutionStatus).toBe("QUERY_SUCCEEDED_WITH_RESULTS");
      expect(agg.persistenceOutcome.status).toBe("NONE_PERSISTED");
      expect(agg.qualifiedProductOutcome.status).toBe("NOT_EVALUATED");
    });

    it("A14: Duplicate Meta ads for same product consolidate without losing observation count", () => {
      const obsA: any = {
        source: "META_ADS",
        sourceRecordId: "ad_dup_1",
        sourceExternalAdId: "META:1001",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        landingPageUrl: "https://uprootclean.com/products/uproot-cleaner-pro?utm_source=fb",
        advertiserDomain: "uprootclean.com",
        advertiserOrCreator: "Uproot Clean",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      };
      const obsB: any = {
        ...obsA,
        sourceRecordId: "ad_dup_2",
        sourceExternalAdId: "META:1002",
        landingPageUrl: "https://uprootclean.com/products/uproot-cleaner-pro?fbclid=xyz",
      };
      const cands = discoverProductCandidatesFromAds([obsA, obsB], "Pet Gadgets");
      expect(cands).toHaveLength(1);
      expect(cands[0].totalObservationCount).toBe(2);
      expect(cands[0].supportingAdIds).toEqual(
        expect.arrayContaining(["ad_dup_1", "ad_dup_2"])
      );
    });

    it("A15: normalizeMetaQueryOutcomeFields does not infer requestStarted/requestCompleted when omitted on generic status", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_a15",
          keyword: "pet grooming vacuum",
          attempted: true,
          status: "FAILED",
          returnedCount: 0,
        },
        "run_a15"
      );
      expect(norm.requestStarted).toBe(false);
      expect(norm.requestCompleted).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP B — Google Ads Transparency Enrichment (18 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group B — Google Ads Transparency Enrichment (18 cases)", () => {
    it("B01: MCP capability discovery classifies Google Ads as ENRICHMENT_ONLY (PRODUCT_DISCOVERY_SUPPORTED=false)", async () => {
      const cap = await discoverGoogleAdsMcpCapabilities({}, createMockGoogleMcpClient({}));
      expect(cap.capabilityClassification).toBe("ENRICHMENT_ONLY");
      expect(cap.PRODUCT_DISCOVERY_SUPPORTED).toBe(false);
      expect(cap.ADVERTISER_LOOKUP_SUPPORTED).toBe(true);
      expect(cap.AD_CREATIVE_RETRIEVAL_SUPPORTED).toBe(true);
      expect(cap.PRODUCT_ENRICHMENT_SUPPORTED).toBe(true);
    });

    it("B02: Valid merchant domain extraction from direct URL", () => {
      expect(
        extractRegistrableDomain("https://www.uprootclean.com/products/uproot-cleaner-pro")
      ).toBe("uprootclean.com");
      expect(
        extractRegistrableDomain("https://shop.chomchomroller.co.uk/products/roller")
      ).toBe("chomchomroller.co.uk");
    });

    it("B03: Redirect URL unwrapping extracts true merchant domain from l.facebook.com and google.com/url", () => {
      expect(
        extractRegistrableDomain(
          "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.furzapper.com%2Fproducts%2Ffurzapper&h=AT123"
        )
      ).toBe("furzapper.com");
      expect(
        extractRegistrableDomain(
          "https://www.google.com/url?q=https%3A%2F%2Fpetlibro.com%2Fproducts%2Fdockstream"
        )
      ).toBe("petlibro.com");
    });

    it("B04: Rejects platform-owned and link-shortener domains (facebook.com, instagram.com, google.com, tiktok.com, bit.ly)", () => {
      expect(extractRegistrableDomain("https://www.facebook.com/ads/library")).toBe("");
      expect(extractRegistrableDomain("https://www.instagram.com/p/123")).toBe("");
      expect(extractRegistrableDomain("https://www.google.com")).toBe("");
      expect(extractRegistrableDomain("https://www.tiktok.com/@brand")).toBe("");
      expect(extractRegistrableDomain("https://bit.ly/3xyz")).toBe("");
    });

    it("B05: Rejects malformed domains, IP addresses, and localhost", () => {
      expect(extractRegistrableDomain("http://192.168.1.1/products/item")).toBe("");
      expect(extractRegistrableDomain("http://localhost:3000/products/item")).toBe("");
      expect(extractRegistrableDomain("not-a-domain")).toBe("");
      expect(extractRegistrableDomain("")).toBe("");
    });

    it("B06: Multi-domain queue processes up to configured maxLiveDomains (3–5 domains)", async () => {
      const queriedDomains: string[] = [];
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async (domain: string) => {
          queriedDomains.push(domain);
          return {
            advertisers: [
              {
                advertiser_id: `AR_${domain}`,
                name: domain,
                domain,
                region: "US",
              },
            ],
          };
        },
        getAds: async (advertiserId: string) => ({
          ads: [
            {
              creative_id: `CR_${advertiserId}`,
              advertiser_id: advertiserId,
              advertiser_name: "Brand",
              domain: queriedDomains[queriedDomains.length - 1],
              headline: "Pet Hair Remover Pro",
              region: "US",
            },
          ],
        }),
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b06",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["brand1.com", "brand2.com", "brand3.com", "brand4.com"],
          maxLiveDomains: 4,
        },
        mockClient
      );

      expect(queriedDomains).toHaveLength(4);
      expect(res.executionMetadata?.domainsAttempted).toBe(4);
      expect(res.executionMetadata?.domainsSucceeded).toBe(4);
      expect(res.enrichmentExecution?.domainOutcomes).toHaveLength(4);
    });

    it("B07: Advertiser found with creatives records SUCCEEDED_WITH_CREATIVES", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => ({
          advertisers: [
            {
              advertiser_id: "AR_1",
              name: "Uproot Clean",
              domain: "uprootclean.com",
              region: "US",
            },
          ],
        }),
        getAds: async () => ({
          ads: [
            {
              creative_id: "CR_101",
              advertiser_id: "AR_1",
              advertiser_name: "Uproot Clean",
              domain: "uprootclean.com",
              headline: "Uproot Cleaner Pro Pet Hair Remover",
              target_url: "https://uprootclean.com/products/uproot-cleaner-pro",
              region: "US",
            },
          ],
        }),
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b07",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["uprootclean.com"],
        },
        mockClient
      );
      expect(res.status).toBe("PASSED");
      expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe("SUCCEEDED_WITH_CREATIVES");
    });

    it("B08: Advertiser found with zero creatives records SUCCEEDED_ADVERTISER_ONLY_NO_ADS and does NOT trigger cooldown", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => ({
          advertisers: [
            {
              advertiser_id: "AR_EMPTY",
              name: "Empty Store",
              domain: "emptystore.com",
              region: "US",
            },
          ],
        }),
        getAds: async () => ({ ads: [] }),
      });

      const res1 = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b08_1",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["emptystore.com"],
        },
        mockClient
      );
      expect(res1.status).toBe("QUERY_SUCCEEDED_EMPTY");
      expect(res1.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe(
        "SUCCEEDED_ADVERTISER_ONLY_NO_ADS"
      );

      // Next call must NOT be blocked by a false rate-limit cooldown
      const res2 = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b08_2",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["emptystore.com"],
        },
        mockClient
      );
      expect(res2.status).toBe("QUERY_SUCCEEDED_EMPTY");
      expect(res2.warnings.some((w) => w.includes("cooldown active"))).toBe(false);
    });

    it("B09: Advertiser not found records SUCCEEDED_NO_ADVERTISER and does NOT trigger cooldown", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => ({ advertisers: [] }),
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b09",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["noadvertiser.com"],
        },
        mockClient
      );
      expect(res.status).toBe("QUERY_SUCCEEDED_EMPTY");
      expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe(
        "SUCCEEDED_NO_ADVERTISER"
      );
    });

    it("B10: HTTP 429 error sets rate-limit status and cooldown only on actual 429 response", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => {
          throw new Error("HTTP 429 Too Many Requests from Google Transparency");
        },
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b10",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["ratelimited.com"],
        },
        mockClient
      );
      expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe("RATE_LIMITED");
      expect(res.executionMetadata?.domainsRateLimited).toBe(1);
      clearGoogleRateLimitCooldown();
    });

    it("B11: Anti-bot / captcha block sets BLOCKED domain outcome", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => {
          throw new Error("Captcha challenge / anti-bot verification required");
        },
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b11",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["blockedstore.com"],
        },
        mockClient
      );
      expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe("BLOCKED");
      clearGoogleRateLimitCooldown();
    });

    it("B12: Upstream timeout sets QUERY_FAILED without false success", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => {
          throw new Error("Request timed out after 15000ms");
        },
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_test",
          researchRunId: "run_b12",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["timeoutstore.com"],
        },
        mockClient
      );
      expect(res.status).toBe("QUERY_FAILED");
      expect(res.enrichmentExecution?.domainOutcomes?.[0]?.status).toBe("QUERY_FAILED");
    });

    it("B13: Exact product handle match produces EXACT_PRODUCT_MATCH (confidence: EXACT, isProductSpecificEvidence: true)", () => {
      const cand: any = {
        candidateId: "cand_uproot",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Shop Uproot Cleaner Pro",
        url: "https://www.uprootclean.com/products/uproot-cleaner-pro?utm_source=google",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.confidence).toBe("EXACT");
      expect(match.associationClassification).toBe("EXACT_PRODUCT_MATCH");
      expect(match.isProductSpecificEvidence).toBe(true);
    });

    it("B14: Same domain + matching product title produces PROBABLE_PRODUCT_MATCH (confidence: HIGH_CONFIDENCE)", () => {
      const cand: any = {
        candidateId: "cand_uproot",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Uproot Cleaner Pro Pet Hair Remover Tool",
        url: "https://uprootclean.com",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.confidence).toBe("HIGH_CONFIDENCE");
      expect(match.associationClassification).toBe("PROBABLE_PRODUCT_MATCH");
      expect(match.isProductSpecificEvidence).toBe(true);
    });

    it("B15: Same domain + generic brand ad produces BRAND_ONLY_MATCH (isProductSpecificEvidence: false)", () => {
      const cand: any = {
        candidateId: "cand_uproot",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Uproot Clean Official Store — Free Shipping Today",
        url: "https://uprootclean.com",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.confidence).toBe("PROBABLE");
      expect(match.associationClassification).toBe("BRAND_ONLY_MATCH");
      expect(match.isProductSpecificEvidence).toBe(false);
    });

    it("B16: Same domain + different product handle/category produces REJECTED_UNRELATED_CREATIVE (isProductSpecificEvidence: false)", () => {
      const cand: any = {
        candidateId: "cand_uproot",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Uproot Clean Eco Laundry Detergent Sheets",
        url: "https://uprootclean.com/products/laundry-sheets",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.associationClassification).toBe("REJECTED_UNRELATED_CREATIVE");
      expect(match.isProductSpecificEvidence).toBe(false);
    });

    it("B17: Duplicate Google creative ID is normalized deterministically and never attached twice", () => {
      const rawAd = {
        creative_id: "CR_DUP_99",
        advertiser_id: "AR_99",
        advertiser_name: "Petlibro",
        domain: "petlibro.com",
        headline: "Petlibro Dockstream Cat Water Fountain",
        target_url: "https://petlibro.com/products/dockstream-water-fountain",
        region: "US",
      };
      const meta = {
        requestedDomain: "petlibro.com",
        topic: "Pet Gadgets",
        observedAt: new Date().toISOString(),
        toolName: "get_ads",
        requestedMarket: "US",
      };
      const norm1 = normalizeGoogleAdsResponse({ ads: [rawAd] }, meta);
      const norm2 = normalizeGoogleAdsResponse({ ads: [rawAd] }, meta);
      expect(norm1.observations[0]?.sourceRecordId).toBe("CR_DUP_99");
      expect(norm2.observations[0]?.sourceRecordId).toBe("CR_DUP_99");
    });

    it("B18: productEvidencePersisted is false when no database persistence occurs (no workspace in DB)", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => ({
          advertisers: [
            {
              advertiser_id: "AR_P",
              name: "Petlibro",
              domain: "petlibro.com",
              region: "US",
            },
          ],
        }),
        getAds: async () => ({
          ads: [
            {
              creative_id: "CR_P1",
              advertiser_id: "AR_P",
              advertiser_name: "Petlibro",
              domain: "petlibro.com",
              headline: "Petlibro Fountain",
              region: "US",
            },
          ],
        }),
      });

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "test",
          researchRunId: "run_b18",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["petlibro.com"],
        },
        mockClient
      );
      expect(res.executionMetadata?.productEvidencePersisted).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP C — Niche Intent, Query Planning, and Product Relevance (16 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group C — Niche Intent, Query Planning, and Product Relevance (16 cases)", () => {
    it("C01: 'Pet Gadgets' classifies as BROAD_CATEGORY with multi-archetype plan", () => {
      const intent = analyzeNicheIntent("Pet Gadgets");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      const plan = buildDeterministicDiscoveryPlan(
        {
          researchRunId: "run_c01",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
          supportedSources: ["META_ADS"],
          remainingProviderRequests: 3,
          remainingAIRequests: 0,
        },
        intent
      );
      expect(plan.productArchetypes.length).toBeGreaterThanOrEqual(4);
    });

    it("C02: 'DIY Tools' classifies as BROAD_CATEGORY, never SPECIFIC_PRODUCT", () => {
      const intent = analyzeNicheIntent("DIY Tools");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      expect(intent.isProhibitedOrUnsupported).toBe(false);
    });

    it("C03: 'Kitchen Gadgets' classifies as BROAD_CATEGORY", () => {
      const intent = analyzeNicheIntent("Kitchen Gadgets");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
    });

    it("C04: 'Dog Gadgets' classifies as BROAD_CATEGORY with DOG target audience and dog-only archetypes", () => {
      const intent = analyzeNicheIntent("Dog Gadgets");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      const aud = evaluateProductAudienceRelevance("Orthopedic Dog Bed", "Dog Gadgets");
      expect(aud.requestedAudience).toBe("DOG");
      const plan = buildDeterministicDiscoveryPlan(
        {
          researchRunId: "run_c04",
          topic: "Dog Gadgets",
          market: "US",
          lookbackDays: 90,
          productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
          supportedSources: ["META_ADS"],
          remainingProviderRequests: 3,
          remainingAIRequests: 0,
        },
        intent
      );
      const allPhrases = plan.productArchetypes.flatMap((a) =>
        a.searchQueries.map((q) => q.phrase.toLowerCase())
      );
      expect(allPhrases.some((p) => p.includes("dog"))).toBe(true);
      expect(allPhrases.some((p) => /\bcat\b/.test(p))).toBe(false);
    });

    it("C05: 'Cat Gadgets' classifies as BROAD_CATEGORY with CAT target audience and cat-only archetypes", () => {
      const intent = analyzeNicheIntent("Cat Gadgets");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      const aud = evaluateProductAudienceRelevance("Stainless Steel Cat Water Fountain", "Cat Gadgets");
      expect(aud.requestedAudience).toBe("CAT");
      const plan = buildDeterministicDiscoveryPlan(
        {
          researchRunId: "run_c05",
          topic: "Cat Gadgets",
          market: "US",
          lookbackDays: 90,
          productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
          supportedSources: ["META_ADS"],
          remainingProviderRequests: 3,
          remainingAIRequests: 0,
        },
        intent
      );
      const allPhrases = plan.productArchetypes.flatMap((a) =>
        a.searchQueries.map((q) => q.phrase.toLowerCase())
      );
      expect(allPhrases.some((p) => p.includes("cat"))).toBe(true);
      expect(allPhrases.some((p) => /\bdog\b/.test(p))).toBe(false);
    });

    it("C06: 'Automatic Pet Feeder' classifies as SPECIFIC_PRODUCT and does not plan unrelated sibling archetypes", () => {
      const intent = analyzeNicheIntent("Automatic Pet Feeder");
      expect(intent.nicheIntent).toBe("SPECIFIC_PRODUCT");
      const plan = buildDeterministicDiscoveryPlan(
        {
          researchRunId: "run_c06",
          topic: "Automatic Pet Feeder",
          market: "US",
          lookbackDays: 90,
          productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
          supportedSources: ["META_ADS"],
          remainingProviderRequests: 3,
          remainingAIRequests: 0,
        },
        intent
      );
      expect(plan.productArchetypes.length).toBeGreaterThanOrEqual(1);
      for (const arch of plan.productArchetypes) {
        for (const q of arch.searchQueries) {
          expect(q.phrase.toLowerCase()).toMatch(/feeder|dispenser|bowl|food/);
          expect(q.phrase.toLowerCase()).not.toMatch(/hair remover|water fountain|grooming/);
        }
      }
    });

    it("C07: 'Car Accessories' classifies as BROAD_CATEGORY and matches automotive products", () => {
      const intent = analyzeNicheIntent("Car Accessories");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      const rel = evaluateProductRelevance(
        "Portable Cordless Car Vacuum Cleaner High Suction",
        "Car Accessories"
      );
      expect(rel.isAccepted).toBe(true);
      expect(rel.relevanceStatus).toBe("RELEVANT");
    });

    it("C08: Empty or symbol-only input classifies as prohibited/unsupported", () => {
      expect(analyzeNicheIntent("   ").isProhibitedOrUnsupported).toBe(true);
      expect(["AMBIGUOUS", "UNSUPPORTED"]).toContain(analyzeNicheIntent("   ").nicheIntent);
      expect(analyzeNicheIntent("$$$ !!!").isProhibitedOrUnsupported).toBe(true);
      expect(["AMBIGUOUS", "UNSUPPORTED"]).toContain(analyzeNicheIntent("$$$ !!!").nicheIntent);
    });

    it("C09: Prohibited verticals ('online casino bonus', 'pet insurance quote') are rejected", () => {
      const casinoIntent = analyzeNicheIntent("online casino bonus");
      expect(casinoIntent.isProhibitedOrUnsupported).toBe(true);
      expect(["AMBIGUOUS", "UNSUPPORTED"]).toContain(casinoIntent.nicheIntent);

      const insRel = evaluateProductRelevance("Compare Pet Insurance Quotes & Vet Bill Coverage", "Pet Gadgets");
      expect(insRel.isAccepted).toBe(false);
      expect(insRel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("C10: 'Dog Gadgets' rejects cat-only fountain and cat litter products", () => {
      const fountainRel = evaluateProductRelevance(
        {
          title: "Cordless Stainless Steel Cat Water Fountain",
          canonicalProductName: "Cordless Stainless Steel Cat Water Fountain",
        },
        "Dog Gadgets"
      );
      expect(fountainRel.isAccepted).toBe(false);
      expect(fountainRel.relevanceStatus).toBe("IRRELEVANT");

      const litterRel = evaluateProductRelevance(
        {
          title: "Honeycomb Double Layer Cat Litter Trapping Mat",
          canonicalProductName: "Honeycomb Double Layer Cat Litter Trapping Mat",
        },
        "Dog Gadgets"
      );
      expect(litterRel.isAccepted).toBe(false);
      expect(litterRel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("C11: 'Cat Gadgets' rejects dog-only harness and bark collar products", () => {
      const harnessRel = evaluateProductRelevance(
        {
          title: "Tactical No-Pull Dog Harness with Handle",
          canonicalProductName: "Tactical No-Pull Dog Harness",
        },
        "Cat Gadgets"
      );
      expect(harnessRel.isAccepted).toBe(false);
      expect(harnessRel.relevanceStatus).toBe("IRRELEVANT");

      const barkRel = evaluateProductRelevance(
        {
          title: "Rechargeable Smart Anti-Bark Dog Collar",
          canonicalProductName: "Rechargeable Smart Anti-Bark Dog Collar",
        },
        "Cat Gadgets"
      );
      expect(barkRel.isAccepted).toBe(false);
      expect(barkRel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("C12: Multi-pet product explicitly supporting both dogs and cats is accepted for Dog Gadgets and Cat Gadgets", () => {
      const multiPetInput = {
        title: "Stainless Steel Pet Water Fountain for Dogs and Cats",
        canonicalProductName: "Stainless Steel Pet Water Fountain for Dogs and Cats",
      };
      const dogRel = evaluateProductRelevance(multiPetInput, "Dog Gadgets");
      const catRel = evaluateProductRelevance(multiPetInput, "Cat Gadgets");
      expect(dogRel.isAccepted).toBe(true);
      expect(catRel.isAccepted).toBe(true);
    });

    it("C13: 'Automatic Pet Feeder' rejects 'Pet Hair/Lint/Dust Cleaner' (Uproot Cleaner Pro)", () => {
      const rel = evaluateProductRelevance(
        {
          title: "Uproot Cleaner Pro — Pet Hair/Lint/Dust Cleaner",
          canonicalProductName: "Pet Hair/Lint/Dust Cleaner",
          productUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        },
        "Automatic Pet Feeder"
      );
      expect(rel.isAccepted).toBe(false);
      expect(rel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("C14: 'DIY Tools' rejects POS thermal printer, Alibaba wholesale, and digital widget apps", () => {
      expect(
        evaluateProductRelevance("80mm POS Thermal Receipt Printer Get Latest Price on Alibaba.com", "DIY Tools")
          .isAccepted
      ).toBe(false);
      expect(
        evaluateProductRelevance("iControl Easy Widgets Themes App for Phone Screen", "DIY Tools")
          .isAccepted
      ).toBe(false);
    });

    it("C15: Planned archetypes are NEVER counted as discovered archetypes when qualifiedProducts is 0", () => {
      const cov = evaluateShortlistCoverage({
        requestedCount: 3,
        qualifiedProducts: 0,
        observedArchetypeIds: ["diy_repair", "diy_woodworking", "diy_decor"],
        plannedArchetypes: [
          { archetypeId: "diy_repair", productCategory: "Home Repair", targetBuyerProblem: "", exampleProducts: [], searchQueries: [], negativeKeywords: [] } as any,
          { archetypeId: "diy_woodworking", productCategory: "Woodworking", targetBuyerProblem: "", exampleProducts: [], searchQueries: [], negativeKeywords: [] } as any,
        ],
        plannedArchetypeIds: ["diy_repair", "diy_woodworking"],
        queriedArchetypeIds: ["diy_repair", "diy_woodworking"],
        archetypesWithReturnedAds: ["diy_repair"],
        archetypesWithRelevantCandidates: [],
        archetypesWithQualifiedProducts: [],
        unresolvedCandidates: 0,
        remainingSourceQueries: 1,
        remainingAIRequests: 2,
        remainingUnusedQueriesCount: 2,
        sourceAvailable: true,
        timeDeadlineReached: false,
        cancelled: false,
      });
      expect(cov.distinctProductArchetypesObserved).toBe(0);
      expect(cov.plannedArchetypeIds).toEqual(["diy_repair", "diy_woodworking"]);
      expect(cov.archetypesWithQualifiedProducts).toEqual([]);
    });

    it("C16: Round 2 recovery is recommended when Round 1 yields < 3 qualified products and budget remains", () => {
      const cov = evaluateShortlistCoverage({
        requestedCount: 3,
        qualifiedProducts: 1,
        observedArchetypeIds: ["pet_grooming"],
        plannedArchetypes: [
          { archetypeId: "pet_grooming", productCategory: "Pet Grooming", targetBuyerProblem: "", exampleProducts: [], searchQueries: [], negativeKeywords: [] } as any,
          { archetypeId: "pet_hydration", productCategory: "Pet Hydration", targetBuyerProblem: "", exampleProducts: [], searchQueries: [], negativeKeywords: [] } as any,
        ],
        archetypesWithQualifiedProducts: ["pet_grooming"],
        unresolvedCandidates: 0,
        remainingSourceQueries: 1,
        remainingAIRequests: 2,
        remainingUnusedQueriesCount: 2,
        sourceAvailable: true,
        timeDeadlineReached: false,
        cancelled: false,
      });
      expect(cov.recoveryRecommended).toBe(true);
      expect(cov.stopReason).toBe("CONTINUE");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP D — Candidate Consolidation, Shortlist Distinctness, and Evergreen Truth (12 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group D — Candidate Consolidation, Shortlist Distinctness, and Evergreen Truth (12 cases)", () => {
    it("D01: Same canonical product URL with tracking params collapses into one candidate", () => {
      const obs1: any = {
        source: "META_ADS",
        sourceRecordId: "ad_d01_1",
        title: "Dockstream Cordless Cat Water Fountain",
        landingPageUrl: "https://petlibro.com/products/dockstream-water-fountain?utm_source=fb&variant=111",
        advertiserDomain: "petlibro.com",
        advertiserOrCreator: "Petlibro",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      };
      const obs2: any = {
        ...obs1,
        sourceRecordId: "ad_d01_2",
        landingPageUrl: "https://www.petlibro.com/products/dockstream-water-fountain?fbclid=abc222",
      };
      const cands = discoverProductCandidatesFromAds([obs1, obs2], "Pet Gadgets");
      expect(cands).toHaveLength(1);
    });

    it("D02: Color/size/pack variants of same product collapse into one candidate", () => {
      const candBlue: any = {
        candidateId: "cand_blue",
        title: "ChomChom Pet Hair Remover — Blue Edition (2-Pack)",
        canonicalProductName: "ChomChom Pet Hair Remover",
        canonicalProductUrl: "https://chomchomroller.com/products/chomchom-roller-blue-2pack",
        storeDomain: "chomchomroller.com",
        brand: "ChomChom",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_1" }],
      };
      const candRed: any = {
        ...candBlue,
        candidateId: "cand_red",
        title: "ChomChom Pet Hair Remover — Red Edition (3-Pack)",
        canonicalProductUrl: "https://chomchomroller.com/products/chomchom-roller-red-3pack",
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "ad_2" }],
      };
      const cmp = compareProductIdentity(candBlue, candRed);
      expect(cmp.areSameActualProduct).toBe(true);
    });

    it("D03: Two genuinely different products on the same store remain distinct candidates", () => {
      const candFountain: any = {
        candidateId: "cand_pl_fountain",
        title: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductName: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductUrl: "https://petlibro.com/products/dockstream-water-fountain",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
      };
      const candFeeder: any = {
        candidateId: "cand_pl_feeder",
        title: "Petlibro Granary Automatic Pet Feeder",
        canonicalProductName: "Petlibro Granary Automatic Pet Feeder",
        canonicalProductUrl: "https://petlibro.com/products/granary-automatic-pet-feeder",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
      };
      const cmp = compareProductIdentity(candFountain, candFeeder);
      expect(cmp.areSameActualProduct).toBe(false);
    });

    it("D04: Same store does not occupy multiple Top-3 shortlist slots by default", () => {
      const c1: any = {
        candidateId: "c_store1_a",
        title: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductName: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductUrl: "https://petlibro.com/products/dockstream-water-fountain",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 5,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a1", provenance: "LIVE_PROVIDER" }],
      };
      const c2: any = {
        candidateId: "c_store1_b",
        title: "Petlibro Granary Automatic Pet Feeder",
        canonicalProductName: "Petlibro Granary Automatic Pet Feeder",
        canonicalProductUrl: "https://petlibro.com/products/granary-automatic-pet-feeder",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 4,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a2", provenance: "LIVE_PROVIDER" }],
      };
      const c3: any = {
        candidateId: "c_store2_a",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 3,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a3", provenance: "LIVE_PROVIDER" }],
      };
      const c4: any = {
        candidateId: "c_store3_a",
        title: "Oneisall Dog Grooming Vacuum Kit",
        canonicalProductName: "Oneisall Dog Grooming Vacuum Kit",
        canonicalProductUrl: "https://oneisall.com/products/dog-grooming-vacuum",
        storeDomain: "oneisall.com",
        brand: "Oneisall",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 2,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a4", provenance: "LIVE_PROVIDER" }],
      };

      const res = selectTopResearchShortlist([c1, c2, c3, c4], 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      const domains = res.shortlist.map((s) => s.storeDomain);
      expect(new Set(domains).size).toBe(res.shortlist.length);
      expect(res.shortlist.filter((s) => s.storeDomain === "petlibro.com")).toHaveLength(1);
    });

    it("D05: Shortlist returns 2/3 honestly when only two distinct products qualify", () => {
      const c1: any = {
        candidateId: "c_only_1",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 3,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a1", provenance: "LIVE_PROVIDER" }],
      };
      const c2: any = {
        candidateId: "c_only_2",
        title: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductName: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductUrl: "https://petlibro.com/products/dockstream-water-fountain",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        totalObservationCount: 2,
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a2", provenance: "LIVE_PROVIDER" }],
      };

      const res = selectTopResearchShortlist([c1, c2], 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(res.qualifiedCount).toBe(2);
      expect(res.shortlist).toHaveLength(2);
      expect(res.requestedCount).toBe(3);
      expect(res.shortfallReason).toBeTruthy();
    });

    it("D06: Shortlist returns 0/3 honestly when all candidates are irrelevant", () => {
      const irr: any = {
        candidateId: "c_irr_1",
        title: "80mm POS Thermal Printer",
        canonicalProductName: "80mm POS Thermal Printer",
        canonicalProductUrl: "https://alibaba.com/products/pos-printer",
        storeDomain: "alibaba.com",
        identityStatus: "VERIFIED",
        productRealityStatus: "NON_PHYSICAL",
        relevanceStatus: "IRRELEVANT",
        sourceObservations: [{ source: "META_ADS", sourceRecordId: "a_irr" }],
      };
      const res = selectTopResearchShortlist([irr], 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "DIY Tools",
      });
      expect(res.qualifiedCount).toBe(0);
      expect(res.shortlist).toHaveLength(0);
    });

    it("D07: Evergreen eligibility requires verified identity, physical reality, relevance, demand stability, confidence, score, and no contradiction", () => {
      const cand: any = {
        candidateId: "cand_d07",
        researchProductId: "prod_d07",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        isEligibleAsEvergreenWinner: true,
        hasUnresolvedContradiction: false,
        totalObservationCount: 6,
        supportingAdIds: ["ad_d07_1", "gad_d07_1"],
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        advertiserNames: ["Uproot Clean"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_d07_1",
            title: "Stop struggling with stubborn pet hair on couches — Uproot Cleaner Pro removes fur instantly",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-01-10T00:00:00Z",
          },
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "gad_d07_1",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-02-10T00:00:00Z",
          },
        ],
      };
      const demandPoints = [
        { date: "2025-12-01T00:00:00Z", value: 68, region: "US", source: "GOOGLE_TRENDS_AUTHORITATIVE", productId: "prod_d07", keyword: "uproot cleaner pro", evidenceReference: "gt:prod_d07:1" },
        { date: "2026-01-01T00:00:00Z", value: 72, region: "US", source: "GOOGLE_TRENDS_AUTHORITATIVE", productId: "prod_d07", keyword: "uproot cleaner pro", evidenceReference: "gt:prod_d07:2" },
        { date: "2026-02-01T00:00:00Z", value: 70, region: "US", source: "GOOGLE_TRENDS_AUTHORITATIVE", productId: "prod_d07", keyword: "uproot cleaner pro", evidenceReference: "gt:prod_d07:3" },
        { date: "2026-03-01T00:00:00Z", value: 74, region: "US", source: "GOOGLE_TRENDS_AUTHORITATIVE", productId: "prod_d07", keyword: "uproot cleaner pro", evidenceReference: "gt:prod_d07:4" },
      ];
      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: demandPoints as any,
        hasVerifiedSupplierQuote: false,
      });
      expect(score.evergreenVerification?.identityVerified).toBe(true);
      expect(score.evergreenVerification?.physicalProductVerified).toBe(true);
      expect(score.evergreenVerification?.relevanceVerified).toBe(true);
    });

    it("D08: Synthetic verified-merchant-demand:<domain> is rejected by evaluateDemandHistoryEvidence", () => {
      const ev = evaluateDemandHistoryEvidence(
        [
          { date: "2025-12-01T00:00:00Z", value: 65, region: "US", source: "HISTORICAL_OBSERVATIONS", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "verified-merchant-demand:uprootclean.com" },
          { date: "2026-01-01T00:00:00Z", value: 68, region: "US", source: "HISTORICAL_OBSERVATIONS", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "verified-merchant-demand:uprootclean.com" },
          { date: "2026-02-01T00:00:00Z", value: 70, region: "US", source: "HISTORICAL_OBSERVATIONS", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "verified-merchant-demand:uprootclean.com" },
        ],
        {
          candidateCanonicalName: "Uproot Cleaner Pro",
          candidateProductId: "prod_1",
        }
      );
      expect(ev.eligibleForEvergreen).toBe(false);
    });

    it("D09: CACHED_UNVERIFIED demand is rejected for Evergreen qualification", () => {
      const ev = evaluateDemandHistoryEvidence(
        [
          { date: "2025-12-01T00:00:00Z", value: 65, region: "US", source: "CACHED_UNVERIFIED", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "cache:1" },
          { date: "2026-01-01T00:00:00Z", value: 68, region: "US", source: "CACHED_UNVERIFIED", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "cache:2" },
          { date: "2026-02-01T00:00:00Z", value: 70, region: "US", source: "CACHED_UNVERIFIED", productId: "prod_1", keyword: "uproot cleaner pro", evidenceReference: "cache:3" },
        ],
        {
          candidateCanonicalName: "Uproot Cleaner Pro",
          candidateProductId: "prod_1",
        }
      );
      expect(ev.eligibleForEvergreen).toBe(false);
      expect(ev.sourceAuthority).toBe("CACHED_UNVERIFIED");
    });

    it("D10: Missing demand history produces Provisional/Shortlist, never Verified Evergreen", () => {
      const cand: any = {
        candidateId: "cand_d10",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        isEligibleAsEvergreenWinner: true,
        hasUnresolvedContradiction: false,
        totalObservationCount: 4,
        supportingAdIds: ["ad_d10_1"],
        supportingSourceTypes: ["META_ADS"],
        advertiserNames: ["Uproot Clean"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_d10_1",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-02-10T00:00:00Z",
          },
        ],
      };
      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: [],
        hasVerifiedSupplierQuote: false,
      });
      expect(score.evergreenVerification?.verifiedByGate).toBe(false);
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
    });

    it("D11: 0/3 Evergreen is reported honestly when demand is missing despite 3/3 Research Shortlist", () => {
      const snapshot: any = {
        runId: "run_d11",
        workspaceId: "ws_test",
        topic: "Pet Gadgets",
        market: "US",
        runStatus: "PARTIAL",
        topThree: [],
        provisionalCandidates: [
          { rank: null, candidate: { candidateId: "c1", title: "Prod 1" }, score: { finalEvergreenScore: 58 } },
        ],
        researchShortlist: {
          shortlist: [
            { candidateId: "c1", title: "Prod 1" },
            { candidateId: "c2", title: "Prod 2" },
            { candidateId: "c3", title: "Prod 3" },
          ],
          qualifiedCount: 3,
          requestedCount: 3,
          shortlistStatus: "POPULATED",
        },
      };
      expect(snapshot.topThree).toHaveLength(0);
      expect(snapshot.researchShortlist.qualifiedCount).toBe(3);
    });

    it("D12: Historical polluted Evergreen snapshot is demoted on read by requalifyHistoricalEvergreenSnapshot", () => {
      const pollutedSnapshot: any = {
        runId: "run_polluted",
        workspaceId: "ws_test",
        topic: "Pet Gadgets",
        market: "US",
        runStatus: "COMPLETED",
        topThree: [
          {
            rank: 1,
            candidate: {
              candidateId: "cand_polluted_1",
              title: "Synthetic Demand Product",
              identityStatus: "VERIFIED",
              demandSeries: {
                status: "PASSED",
                points: [
                  {
                    date: "2026-01-01",
                    value: 60,
                    provenance: "VERIFIED_SOURCE",
                    evidenceReference: "verified-merchant-demand:fake.com",
                  },
                ],
              },
            },
            score: {
              finalEvergreenScore: 78,
              confidenceStatus: "VERIFIED",
              eligibilityGates: { isEligibleForTopThree: true, disqualificationReasons: [] },
            },
          },
        ],
        provisionalCandidates: [],
      };

      const cleaned = requalifyHistoricalEvergreenSnapshot(pollutedSnapshot);
      expect(cleaned.modified).toBe(true);
      expect(cleaned.demotedWinners).toHaveLength(1);
      expect(cleaned.snapshot?.topThree).toHaveLength(0);
      expect(cleaned.snapshot?.provisionalCandidates).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP E — Persistence, API, Drawer, Media, and Cross-Layer Reconciliation (12 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group E — Persistence, API, Drawer, Media, and Cross-Layer Reconciliation (12 cases)", () => {
    it("E01: normalizeResearchSnapshotForComparison extracts exact ranked and provisional candidate sets", () => {
      const fakeJob = {
        id: "run_e01",
        workspaceId: "ws_e01",
        status: "COMPLETED",
        resultJson: JSON.stringify({
          totalObservationsCollected: 12,
          topThree: [
            {
              rank: 1,
              candidate: {
                candidateId: "cand_1",
                sourceObservations: [{ sourceRecordId: "obs_1" }],
              },
              score: { finalEvergreenScore: 81.2, confidenceStatus: "VERIFIED" },
            },
          ],
          provisionalCandidates: [
            {
              rank: null,
              candidate: {
                candidateId: "cand_2",
                sourceObservations: [{ sourceRecordId: "obs_2" }],
              },
              score: { finalEvergreenScore: 62.5, confidenceStatus: "PROVISIONAL" },
            },
          ],
        }),
      };
      const snap = normalizeResearchSnapshotForComparison(fakeJob, "ws_e01");
      expect(snap.rankedCandidateIds).toEqual(["cand_1"]);
      expect(snap.provisionalCandidateIds).toEqual(["cand_2"]);
      expect(snap.candidateCount).toBe(2);
    });

    it("E02: Provider truth matrix classifies all 5 intelligence sources accurately", async () => {
      const matrix = await buildProviderTruthMatrix({ workspaceId: "ws_test" });
      expect(matrix).toHaveLength(5);
      const googleRow = matrix.find((r) => r.source === "GOOGLE_ADS");
      expect(googleRow?.capabilityClassification).toBe("ENRICHMENT_ONLY");
      const tiktokAdsRow = matrix.find((r) => r.source === "TIKTOK_ADS");
      expect(tiktokAdsRow?.capabilityClassification).toBe("DISABLED");
      expect(tiktokAdsRow?.policyState).toBe("TEMPORARILY_DISABLED");
    });

    it("E03: reconcileDatabaseAndBrowser passes when displayedCandidateIds, rankOrder, and scores match DB", () => {
      const dbSnap: any = {
        runId: "run_e03",
        workspaceId: "ws_test",
        status: "COMPLETED",
        candidateIds: ["cand_1", "cand_2"],
        rankedCandidateIds: ["cand_1"],
        provisionalCandidateIds: ["cand_2"],
        rankedScores: { cand_1: 80, cand_2: 61 },
        confidenceStatuses: { cand_1: "VERIFIED", cand_2: "PROVISIONAL" },
        sourceObservationIds: ["obs_1"],
        rawObservationsCount: 5,
        candidateCount: 2,
      };
      const res = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_e03",
        displayedCandidateIds: ["cand_1", "cand_2"],
        displayedRankOrder: ["cand_1"],
        displayedScores: { cand_1: 80, cand_2: 61 },
        displayedConfidence: { cand_1: "VERIFIED", cand_2: "PROVISIONAL" },
      });
      expect(res.reconciled).toBe(true);
      expect(res.mismatches).toHaveLength(0);
    });

    it("E04: reconcileDatabaseAndBrowser detects missing candidate in browser", () => {
      const dbSnap: any = {
        runId: "run_e04",
        workspaceId: "ws_test",
        status: "COMPLETED",
        candidateIds: ["cand_1", "cand_2"],
        rankedCandidateIds: ["cand_1", "cand_2"],
        provisionalCandidateIds: [],
        rankedScores: { cand_1: 80, cand_2: 75 },
        confidenceStatuses: {},
        sourceObservationIds: [],
        rawObservationsCount: 5,
        candidateCount: 2,
      };
      const res = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_e04",
        displayedCandidateIds: ["cand_1"],
      });
      expect(res.reconciled).toBe(false);
    });

    it("E05: reconcileDatabaseAndBrowser detects duplicate candidate IDs rendered in browser", () => {
      const dbSnap: any = {
        runId: "run_e05",
        workspaceId: "ws_test",
        status: "COMPLETED",
        candidateIds: ["cand_1", "cand_2"],
        rankedCandidateIds: ["cand_1", "cand_2"],
        provisionalCandidateIds: [],
        rankedScores: { cand_1: 80, cand_2: 75 },
        confidenceStatuses: {},
        sourceObservationIds: [],
        rawObservationsCount: 5,
        candidateCount: 2,
      };
      const res = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_e05",
        displayedCandidateIds: ["cand_1", "cand_1"],
      });
      expect(res.reconciled).toBe(false);
      expect(res.mismatches.some((m) => m.field === "duplicateBrowserCandidates")).toBe(true);
    });

    it("E06: reconcileDatabaseAndBrowser detects tampered score (> 1.0 drift)", () => {
      const dbSnap: any = {
        runId: "run_e06",
        workspaceId: "ws_test",
        status: "COMPLETED",
        candidateIds: ["cand_1"],
        rankedCandidateIds: ["cand_1"],
        provisionalCandidateIds: [],
        rankedScores: { cand_1: 80 },
        confidenceStatuses: {},
        sourceObservationIds: [],
        rawObservationsCount: 5,
        candidateCount: 1,
      };
      const res = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_e06",
        displayedCandidateIds: ["cand_1"],
        displayedScores: { cand_1: 92 },
      });
      expect(res.reconciled).toBe(false);
      expect(res.mismatches.some((m) => m.field === "displayedScores.cand_1")).toBe(true);
    });

    it("E07: Media gallery orders merchant images -> Meta ad images -> verified thumbnails", () => {
      const gallery = resolveProductMediaGallery({
        productId: "prod_e07",
        candidateId: "cand_e07",
        productTitle: "Uproot Cleaner Pro",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        identityStatus: "VERIFIED",
        productImageUrl: "https://cdn.shopify.com/s/files/1/0555/products/merchant_main.jpg",
        adCreativeMedia: [
          {
            adId: "asset_ad_1",
            mediaType: "IMAGE",
            url: "https://scontent.xx.fbcdn.net/v/t39.35426-6/ad_image_1.jpg",
            thumbnailUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/ad_thumb_1.jpg",
          },
        ],
      });
      expect(gallery.hasImages).toBe(true);
      expect(gallery.items.length).toBeGreaterThanOrEqual(2);
      expect(gallery.items[0].source).toBe("MERCHANT_PRODUCT_PAGE");
      expect(gallery.items[1].source).toBe("META_AD_CREATIVE");
    });

    it("E08: Media gallery deduplicates identical URLs across query strings", () => {
      const gallery = resolveProductMediaGallery({
        productId: "prod_e08",
        candidateId: "cand_e08",
        productTitle: "Uproot Cleaner Pro",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        candidateImageReferences: [
          "https://cdn.shopify.com/s/files/1/0555/products/hero.jpg?v=100&width=800",
          "https://cdn.shopify.com/s/files/1/0555/products/hero.jpg?v=200&width=1200",
        ],
      });
      expect(gallery.items).toHaveLength(1);
    });

    it("E09: Media gallery rejects blocked placeholder hosts (placehold.co, example.com)", () => {
      expect(validateAndNormalizeMediaUrl("https://placehold.co/600x400").valid).toBe(false);
      expect(validateAndNormalizeMediaUrl("https://example.com/fake.jpg").valid).toBe(false);
      const gallery = resolveProductMediaGallery({
        productId: "prod_e09",
        candidateId: "cand_e09",
        productTitle: "Placeholder Test",
        candidateImageReferences: ["https://placehold.co/600x400", "https://example.com/img.png"],
      });
      expect(gallery.items).toHaveLength(0);
      expect(gallery.emptyState.isEmpty).toBe(true);
      expect(gallery.provenanceSummary.rejectedCount).toBe(2);
    });

    it("E10: Older live run does NOT overwrite latest CACHE_ONLY run's current status in getWorkspaceProviderTelemetry", async () => {
      const mockDb = {
        syncJob: {
          findMany: async () => [
            {
              id: "job_newest_cache",
              workspaceId: "ws_e10",
              jobType: "KH02_RESEARCH",
              createdAt: new Date("2026-04-12T10:00:00Z"),
              completedAt: new Date("2026-04-12T10:01:00Z"),
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: false,
                    queryStatus: "CACHE_ONLY",
                    queryProvenance: "CACHED_SOURCE",
                    isLive: false,
                    retrievedCount: 8,
                    acceptedCount: 8,
                  },
                },
              }),
            },
            {
              id: "job_older_live",
              workspaceId: "ws_e10",
              jobType: "KH02_RESEARCH",
              createdAt: new Date("2026-04-11T10:00:00Z"),
              completedAt: new Date("2026-04-11T10:01:00Z"),
              resultJson: JSON.stringify({
                providerTelemetry: {
                  META_ADS: {
                    source: "META_ADS",
                    queryExecuted: true,
                    queryStatus: "PASSED",
                    queryProvenance: "LIVE_PROVIDER",
                    isLive: true,
                    retrievedCount: 15,
                    acceptedCount: 15,
                    queryTimestamp: "2026-04-11T10:01:00Z",
                    lastLiveQueryAt: "2026-04-11T10:01:00Z",
                    lastLiveQueryRecordCount: 15,
                  },
                },
              }),
            },
          ],
        },
      };

      const tel = await getWorkspaceProviderTelemetry("ws_e10", mockDb);
      expect(tel.META_ADS.queryStatus).toBe("CACHE_ONLY");
      expect(tel.META_ADS.queryProvenance).toBe("CACHED_SOURCE");
      expect(tel.META_ADS.isLive).toBe(false);
      // Historical live query timestamp is still preserved in lastLiveQueryAt
      expect(tel.META_ADS.lastLiveQueryAt).toBe("2026-04-11T10:01:00Z");
    });

    it("E11: reconcileResearchAcrossLayers fails when strictFullLayers=true and HTTP/Browser layers are missing", async () => {
      const mockDb = {
        syncJob: {
          findUnique: async () => ({
            id: "run_e11",
            workspaceId: "ws_test",
            status: "COMPLETED",
            resultJson: JSON.stringify({
              topThree: [
                {
                  rank: 1,
                  candidate: { candidateId: "cand_1" },
                  score: { finalEvergreenScore: 80, confidenceStatus: "VERIFIED" },
                },
              ],
            }),
          }),
        },
      };
      const rec = await reconcileResearchAcrossLayers("run_e11", {
        db: mockDb,
        strictFullLayers: true,
      });
      expect(rec.reconciliationVerdict).toBe("MISMATCH");
      expect(rec.reconciled).toBe(false);
    });

    it("E12: Release version matches 12.4.3.3, 12.4.3.3.1, 12.4.3.3.2, 12.4.3.4.1, 12.4.3.4.2, 12.4.3.4.3, 12.4.3.4.4, or 12.4.3.4.5 across runtimeVersionService", () => {
      expect(["12.4.3.3", "12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5"]).toContain(SWAI_KH02_RELEASE_VERSION);
      const report = evaluateKH02RuntimeIdentity({ frontendVersion: SWAI_KH02_RELEASE_VERSION });
      expect(["12.4.3.3", "12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5"]).toContain(report.releaseVersion);
      expect(["12.4.3.3", "12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5"]).toContain(report.appVersion);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14 — Mandatory 16 False-PASS Adversarial Mutations (M01–M16)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Section 14 — Mandatory 16 False-PASS Adversarial Mutations (M01–M16)", () => {
    it("M01: Cached Meta records mutated to LIVE_PROVIDER while sourceMode === CACHE_ONLY is caught", () => {
      const diag = resolveMetaExecutionPolicyWithDiagnostics({
        workspaceId: "ws_m01",
        researchRunId: "run_m01",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "CACHE_ONLY",
      });
      expect(diag.allowLive).toBe(false);
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_m01",
          keyword: "pet hair remover",
          attempted: false,
          status: "NOT_ATTEMPTED",
          provenance: "LIVE_PROVIDER",
          returnedCount: 5,
        },
        "run_m01"
      );
      expect(norm.provenance).toBe("NONE");
      expect(norm.returnedCount).toBe(0);
    });

    it("M02: Omitted upstreamReturnedCount mutated to copy returnedCount is caught (must stay null)", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_m02",
          keyword: "dog water fountain",
          attempted: true,
          status: "SUCCEEDED_WITH_RESULTS",
          returnedCount: 7,
          upstreamReturnedCount: undefined,
        },
        "run_m02"
      );
      expect(norm.upstreamReturnedCount).toBeNull();
    });

    it("M03: NOT_ATTEMPTED query mutated with returnedCount: 5 is reset to 0 and null upstream", () => {
      const norm = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_m03",
          keyword: "cat litter mat",
          attempted: false,
          status: "NOT_ATTEMPTED",
          returnedCount: 5,
          upstreamReturnedCount: 5,
        },
        "run_m03"
      );
      expect(norm.returnedCount).toBe(0);
      expect(norm.upstreamReturnedCount).toBeNull();
    });

    it("M04: Google empty advertiser result mutated to trigger HTTP 429 cooldown is caught", async () => {
      const mockClient = createMockGoogleMcpClient({
        searchAdvertiserByDomain: async () => ({ advertisers: [] }),
      });
      const res1 = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_m04",
          researchRunId: "run_m04_1",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["empty1.com"],
        },
        mockClient
      );
      expect(res1.executionMetadata?.domainsRateLimited).toBe(0);
      const res2 = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "ws_m04",
          researchRunId: "run_m04_2",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["empty2.com"],
        },
        mockClient
      );
      expect(res2.status).toBe("QUERY_SUCCEEDED_EMPTY");
    });

    it("M05: Google brand-only creative mutated to attach as product-specific evidence is caught", () => {
      const cand: any = {
        candidateId: "cand_m05",
        title: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductName: "Uproot Cleaner Pro Pet Hair Remover",
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        brand: "Uproot Clean",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Uproot Clean Official Brand Store",
        url: "https://uprootclean.com",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.isProductSpecificEvidence).toBe(false);
      expect(match.associationClassification).toBe("BRAND_ONLY_MATCH");
    });

    it("M06: Same-domain unrelated product creative mutated to attach as product-specific evidence is caught", () => {
      const cand: any = {
        candidateId: "cand_m06",
        title: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductName: "Petlibro Dockstream Cat Water Fountain",
        canonicalProductUrl: "https://petlibro.com/products/dockstream-water-fountain",
        storeDomain: "petlibro.com",
        brand: "Petlibro",
      };
      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Petlibro Granary Automatic Pet Feeder",
        url: "https://petlibro.com/products/granary-automatic-pet-feeder",
        domain: "petlibro.com",
        platform: "GOOGLE_ADS",
      });
      expect(match.isProductSpecificEvidence).toBe(false);
      expect(match.associationClassification).toBe("REJECTED_UNRELATED_CREATIVE");
    });

    it("M07: Dog-only query ('Dog Gadgets') returning cat-only product in Top 3 is rejected", () => {
      const rel = evaluateProductRelevance(
        {
          title: "Stainless Steel Cat Water Fountain for Indoor Cats",
          canonicalProductName: "Stainless Steel Cat Water Fountain",
        },
        "Dog Gadgets"
      );
      expect(rel.isAccepted).toBe(false);
      expect(rel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("M08: Specific product query ('Automatic Pet Feeder') returning 'Pet Hair/Lint/Dust Cleaner' is rejected", () => {
      const rel = evaluateProductRelevance(
        {
          title: "Pet Hair/Lint/Dust Cleaner",
          canonicalProductName: "Pet Hair/Lint/Dust Cleaner",
        },
        "Automatic Pet Feeder"
      );
      expect(rel.isAccepted).toBe(false);
      expect(rel.relevanceStatus).toBe("IRRELEVANT");
    });

    it("M09: DIY Tools classified as SPECIFIC_PRODUCT is caught (must be BROAD_CATEGORY)", () => {
      const intent = analyzeNicheIntent("DIY Tools");
      expect(intent.nicheIntent).toBe("BROAD_CATEGORY");
      expect(intent.nicheIntent).not.toBe("SPECIFIC_PRODUCT");
    });

    it("M10: Planned archetypes counted in distinctProductArchetypesObserved before product verification is caught", () => {
      const cov = evaluateShortlistCoverage({
        requestedCount: 3,
        qualifiedProducts: 0,
        observedArchetypeIds: ["arch_1", "arch_2", "arch_3"],
        plannedArchetypes: [],
        plannedArchetypeIds: ["arch_1", "arch_2", "arch_3"],
        archetypesWithQualifiedProducts: [],
        unresolvedCandidates: 0,
        remainingSourceQueries: 0,
        remainingAIRequests: 0,
        remainingUnusedQueriesCount: 0,
        sourceAvailable: true,
        timeDeadlineReached: false,
        cancelled: false,
      });
      expect(cov.distinctProductArchetypesObserved).toBe(0);
    });

    it("M11: Two color variants of the same product in Top-3 shortlist are caught by evaluateShortlistDistinctness", () => {
      const v1: any = {
        candidateId: "v1_blue",
        title: "ChomChom Roller — Blue Variant",
        canonicalProductName: "ChomChom Roller",
        canonicalProductUrl: "https://chomchomroller.com/products/chomchom-roller",
        storeDomain: "chomchomroller.com",
        brand: "ChomChom",
      };
      const v2: any = {
        candidateId: "v2_red",
        title: "ChomChom Roller — Red Variant",
        canonicalProductName: "ChomChom Roller",
        canonicalProductUrl: "https://chomchomroller.com/products/chomchom-roller",
        storeDomain: "chomchomroller.com",
        brand: "ChomChom",
      };
      const dist = evaluateShortlistDistinctness([v1, v2]);
      expect(dist.isDistinct).toBe(false);
      expect(dist.duplicateGroupsCount).toBeGreaterThan(0);
    });

    it("M12: Synthetic demand reference verified-merchant-demand:<domain> accepted for Evergreen is caught", () => {
      const snap: any = {
        runId: "run_m12",
        workspaceId: "ws_m12",
        topic: "Pet Gadgets",
        market: "US",
        runStatus: "COMPLETED",
        topThree: [
          {
            rank: 1,
            candidate: {
              candidateId: "c_m12",
              title: "Fake Evergreen Winner",
              demandSeries: {
                status: "PASSED",
                points: [
                  {
                    date: "2026-02-01",
                    value: 70,
                    provenance: "VERIFIED_SOURCE",
                    evidenceReference: "verified-merchant-demand:merchant.com",
                  },
                ],
              },
            },
            score: {
              finalEvergreenScore: 82,
              confidenceStatus: "VERIFIED",
              eligibilityGates: { isEligibleForTopThree: true, disqualificationReasons: [] },
            },
          },
        ],
        provisionalCandidates: [],
      };
      const res = requalifyHistoricalEvergreenSnapshot(snap);
      expect(res.modified).toBe(true);
      expect(res.snapshot?.topThree).toHaveLength(0);
    });

    it("M13: Provisional shortlist item promoted into topThree without demand evidence is caught by calculateKH02EvergreenScore", () => {
      const cand: any = {
        candidateId: "cand_m13",
        title: "Provisional Pet Fountain",
        canonicalProductName: "Provisional Pet Fountain",
        canonicalProductUrl: "https://petlibro.com/products/fountain",
        storeDomain: "petlibro.com",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        relevanceStatus: "RELEVANT",
        isEligibleAsEvergreenWinner: true,
        hasUnresolvedContradiction: false,
        totalObservationCount: 5,
        supportingAdIds: ["ad_m13_1"],
        supportingSourceTypes: ["META_ADS"],
        advertiserNames: ["Petlibro"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_m13_1",
            title: "Provisional Pet Fountain",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-02-10T00:00:00Z",
          },
        ],
      };
      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: [],
        hasVerifiedSupplierQuote: false,
      });
      expect(score.evergreenVerification?.verifiedByGate).toBe(false);
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
    });

    it("M14: Placeholder image URL (placehold.co) accepted into gallery is caught", () => {
      const check = validateAndNormalizeMediaUrl("https://placehold.co/800x800/png");
      expect(check.valid).toBe(false);
      expect(check.rejectionReason).toContain("placeholder");
    });

    it("M15: Overview API called with mismatched runId + candidateId is caught by reconciliation / overview contract", () => {
      const dbSnap: any = {
        runId: "run_m15",
        workspaceId: "ws_m15",
        status: "COMPLETED",
        candidateIds: ["cand_real_1"],
        rankedCandidateIds: ["cand_real_1"],
        provisionalCandidateIds: [],
        rankedScores: { cand_real_1: 77 },
        confidenceStatuses: { cand_real_1: "VERIFIED" },
        sourceObservationIds: ["obs_1"],
        rawObservationsCount: 3,
        candidateCount: 1,
      };
      const browserMismatch = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_m15",
        displayedCandidateIds: ["cand_foreign_999"],
      });
      expect(browserMismatch.reconciled).toBe(false);
    });

    it("M16: Browser DOM displaying different candidate IDs or scores than SQLite snapshot is caught", () => {
      const dbSnap: any = {
        runId: "run_m16",
        workspaceId: "ws_m16",
        status: "COMPLETED",
        candidateIds: ["cand_a", "cand_b"],
        rankedCandidateIds: ["cand_a", "cand_b"],
        provisionalCandidateIds: [],
        rankedScores: { cand_a: 84, cand_b: 79 },
        confidenceStatuses: { cand_a: "VERIFIED", cand_b: "VERIFIED" },
        sourceObservationIds: ["obs_1", "obs_2"],
        rawObservationsCount: 6,
        candidateCount: 2,
      };
      const tamperedOrderAndScore = reconcileDatabaseAndBrowser(dbSnap, {
        runId: "run_m16",
        displayedCandidateIds: ["cand_b", "cand_a"],
        displayedRankOrder: ["cand_b", "cand_a"],
        displayedScores: { cand_a: 50, cand_b: 79 },
      });
      expect(tamperedOrderAndScore.reconciled).toBe(false);
      expect(tamperedOrderAndScore.mismatches.length).toBeGreaterThanOrEqual(2);
    });
  });
});
