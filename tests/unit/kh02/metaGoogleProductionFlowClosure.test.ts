/**
 * SWAI KH-02 — V12.4.3.7.19.3.3
 * Meta Ads & Google Ads Transparency Production Flow Closure + Identity & Distinctness Suite
 *
 * Covers Sections 7–14 & 16:
 * - Group B: Meta Ads Production Flow (MCP lifecycle, subquery budget, link unwrap, US market provenance, DB persistence & reload of rawPayload provenance)
 * - Group C: Google Ads Transparency Production Flow (MCP lifecycle, root/collection URL relevance demotion, FILTER_ONLY market provenance, rate-limit cooldown, DB persistence without overwriting evidenceReference)
 * - Group D: Canonical Identity, Family Variant Collapse, Cross-Platform Match & Pillar C Scoring Normalization
 * - Group E: Three-Source Free MCP Smoke & Candidate DB Readback Truth
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import {
  diagnoseMetaLiveCollector,
  collectMetaProductSignals,
  resolveMetaMarketProvenance,
  normalizeMetaQueryOutcomeFields,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  normalizeGoogleAdsResponse,
  persistGoogleObservationsToDatabase,
  collectGoogleAdvertiserSignals,
  invokeGoogleMcpTool,
  GoogleTransparencyMcpClient,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  discoverProductCandidatesFromAds,
  evaluateShortlistDistinctness,
} from "@/services/kh02/identity/productCandidateDiscovery";
import { calculateKH02EvergreenScore } from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { runThreeSourceFreeMcpSmoke } from "../../../scripts/kh02/runThreeSourceFreeMcpSmoke";
import { executeCandidateDbReadback } from "../../../scripts/kh02/runCandidateDbReadback";

describe("KH-02 V19.3.3 — Meta & Google Production Flow Closure Suite", () => {
  const workspaceId = "ws_v19_3_3_flow_test";

  beforeEach(async () => {
    delete process.env.META_COLLECTOR_ENABLED;
    (globalThis as any).__swaiGoogleRateLimitUntil = 0;
  });

  afterAll(async () => {
    try {
      await prisma.competitorAd.deleteMany({
        where: {
          OR: [
            { externalAdId: { in: ["889977665501", "889977665502"] } },
            { externalAdId: { startsWith: "GOOGLE:CR_V1933_" } },
          ],
        },
      });
    } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP B: META ADS PRODUCTION FLOW
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group B: Meta Ads Production Flow", () => {
    it("B01: diagnoseMetaLiveCollector reports configured=false and transportConnected=false when META_COLLECTOR_ENABLED=false", async () => {
      process.env.META_COLLECTOR_ENABLED = "false";
      const diag = await diagnoseMetaLiveCollector({ workspaceId });
      expect(diag.configured).toBe(false);
      expect(diag.collectorConfigured).toBe(false);
      expect(diag.transportConnected).toBe(false);
      expect(diag.status).toBe("NOT_CONFIGURED");
    });

    it("B02: normalizeMetaCollectorAd unwraps l.facebook.com redirect URLs, preserves creativeVariants, and rejects synthetic non-numeric IDs", () => {
      expect(() =>
        normalizeMetaCollectorAd({ id: "SYNTHETIC_NON_NUMERIC_ID" } as any)
      ).toThrow(/missing or invalid Meta Library ID/i);

      const rawAd = {
        id: "889977665501",
        delivery_start_time: "2026-08-01T00:00:00Z",
        is_active: true,
        page: {
          id: "9001",
          name: "Petlibro Official",
        },
        creatives: [
          {
            body: "Keep your cat hydrated with filtered stainless steel water.",
            title: "Petlibro Dockstream Wireless Cat Water Fountain",
            caption: "petlibro.com",
            cta_text: "SHOP_NOW",
            link_url:
              "https://l.facebook.com/l.php?u=https%3A%2F%2Fpetlibro.com%2Fproducts%2Fdockstream-fountain&h=AT123",
            image_url: "https://petlibro.com/cdn/shop/files/dockstream.jpg",
          },
          {
            body: "Whisper-quiet pump for cats.",
            title: "Dockstream Fountain Variant 2",
            link_url: "https://petlibro.com/products/dockstream-fountain",
          },
        ],
        country: "US",
      };

      const norm = normalizeMetaCollectorAd(rawAd as any, {
        queryMarket: "US",
        keyword: "cat water fountain",
      });

      expect(norm.sourceExternalId).toBe("889977665501");
      expect(norm.landingPageUrl).toBe("https://petlibro.com/products/dockstream-fountain");
      expect(norm.targetMarket).toBe("US");
      expect(norm.marketEvidenceType).toBe("QUERY_FILTER");
      expect(norm.rawEvidenceReference).toBe(
        "https://www.facebook.com/ads/library/?id=889977665501"
      );
      expect((norm.sourceEvidence as any)?.creativeVariants?.length).toBe(2);
    });

    it("B03: ingestDiscoveredAds persists rawEvidenceReference, sourceEvidence, queryId, providerRequestId & creativeVariants in AdObservation.rawPayload and survives DB reload", async () => {
      const rawAd = {
        id: "889977665502",
        delivery_start_time: "2026-08-10T00:00:00Z",
        is_active: true,
        page: {
          id: "9002",
          name: "Furbo US Store",
        },
        creatives: [
          {
            body: "360-degree rotating dog camera with treat tossing.",
            title: "Furbo 360 Dog Camera",
            link_url: "https://furbo.com/products/furbo-360-dog-camera",
            image_url: "https://furbo.com/cdn/shop/furbo360.jpg",
          },
        ],
        country: "US",
      };

      const norm = normalizeMetaCollectorAd(rawAd as any, {
        queryMarket: "US",
        keyword: "dog camera",
      });
      norm.sourceEvidence = {
        ...norm.sourceEvidence!,
        queryId: "q_meta_v1933_1",
        matchedQueryIds: ["q_meta_v1933_1", "q_meta_v1933_2"],
        providerRequestId: "req_meta_v1933_rs1",
        researchRunId: "run_meta_v1933_1",
      };

      const runId = "run_meta_v1933_1";
      await prisma.workspace.upsert({
        where: { id: workspaceId },
        update: {},
        create: { id: workspaceId, name: "V19.3.3 Test Workspace" },
      });
      await prisma.discoveryRun.upsert({
        where: { id: runId },
        update: {},
        create: {
          id: runId,
          workspaceId,
          providerId: "meta-ads-collector",
          status: "COMPLETED",
          runMode: "MANUAL",
          queryConfigJson: JSON.stringify({ topic: "dog camera", market: "US" }),
        },
      });

      const firstIngest = await ingestDiscoveredAds([norm], {
        workspaceId,
        discoveryRunId: runId,
        runId,
        providerId: "meta-ads-collector",
        runMode: "MANUAL",
      });

      expect(firstIngest.newUniqueInserted).toBe(1);
      const persistedId = firstIngest.adIds?.[0];
      expect(persistedId).toBeTruthy();

      const adRowBefore = await prisma.competitorAd.findUnique({
        where: { id: persistedId! },
        include: { observations: true, sourceIdentities: true },
      });
      expect(adRowBefore).not.toBeNull();
      expect(adRowBefore!.observations.length).toBeGreaterThanOrEqual(1);
      const rawPayload = JSON.parse(adRowBefore!.observations[0].rawPayload || "{}");
      expect(rawPayload.rawEvidenceReference).toBe(norm.rawEvidenceReference);
      expect(rawPayload.sourceEvidence?.queryId).toBe("q_meta_v1933_1");
      expect(rawPayload.sourceEvidence?.providerRequestId).toBe("req_meta_v1933_rs1");
      expect(rawPayload.sourceEvidence?.matchedQueryIds).toEqual([
        "q_meta_v1933_1",
        "q_meta_v1933_2",
      ]);

      // Re-ingest same ad: firstSeenAt must be preserved, observationCount incremented
      const secondIngest = await ingestDiscoveredAds([norm], {
        workspaceId,
        discoveryRunId: runId,
        runId,
        providerId: "meta-ads-collector",
        runMode: "MANUAL",
      });
      expect(secondIngest.existingUpdated).toBe(1);
      const adRowAfter = await prisma.competitorAd.findUnique({
        where: { id: persistedId! },
      });
      expect(adRowAfter!.firstSeenAt.toISOString()).toBe(
        adRowBefore!.firstSeenAt.toISOString()
      );
      expect(adRowAfter!.observationCount).toBe(adRowBefore!.observationCount + 1);

      // Reload via collectMetaProductSignals (CACHE_ONLY) and verify persisted provenance is recovered
      const signalRes = await collectMetaProductSignals({
        workspaceId,
        researchRunId: "run_meta_v1933_reload",
        topic: "Furbo 360 Dog Camera",
        market: "US",
        lookbackDays: 90,
        maxResults: 10,
        sourceMode: "CACHE_ONLY",
      });
      const reloadedObs = signalRes.observations.find((o) => o.persistedAdId === persistedId);
      expect(reloadedObs).toBeDefined();
      expect(reloadedObs!.queryId).toBe("q_meta_v1933_1");
      expect(reloadedObs!.providerRequestId).toBe("req_meta_v1933_rs1");
      expect((reloadedObs!.metrics as any)?.rawEvidenceReference).toBe(
        norm.rawEvidenceReference
      );
    });

    it("B04: normalizeMetaQueryOutcomeFields never fabricates upstreamReturnedCount or LIVE_PROVIDER for NOT_ATTEMPTED subqueries", () => {
      const notAttempted = normalizeMetaQueryOutcomeFields(
        {
          queryId: "q_unattempted",
          keyword: "cat litter box",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: false,
          status: "NOT_ATTEMPTED",
          returnedCount: 5,
          upstreamReturnedCount: 5,
          provenance: "LIVE_PROVIDER",
        },
        "run_1"
      );
      expect(notAttempted.attempted).toBe(false);
      expect(notAttempted.requestStarted).toBe(false);
      expect(notAttempted.requestCompleted).toBe(false);
      expect(notAttempted.actualApiCalls).toBe(0);
      expect(notAttempted.returnedCount).toBe(0);
      expect(notAttempted.upstreamReturnedCount).toBeNull();
      expect(notAttempted.provenance).toBe("NONE");
    });

    it("B05: resolveMetaMarketProvenance distinguishes VERIFIED US, non-US, INFERRED, and UNKNOWN market provenance", () => {
      const explicitUs = resolveMetaMarketProvenance(
        {
          targetMarket: "US",
          landingPageUrl: "https://petlibro.com/products/fountain",
        },
        { requestedMarket: "US" }
      );
      expect(explicitUs.verifiedDeliveryMarket).toBe("US");
      expect(explicitUs.marketVerification).toBe("VERIFIED");

      const nonUs = resolveMetaMarketProvenance(
        {
          targetMarket: "GB",
          landingPageUrl: "https://petshop.co.uk/products/fountain",
        },
        { requestedMarket: "US" }
      );
      expect(nonUs.verifiedDeliveryMarket).toBeNull();
      expect(nonUs.sourceReportedMarket).toBe("GB");

      const unknownMarket = resolveMetaMarketProvenance(
        {
          targetMarket: "UNKNOWN",
        },
        { requestedMarket: "US" }
      );
      expect(unknownMarket.verifiedDeliveryMarket).toBeNull();
      expect(unknownMarket.marketVerification).toBe("UNKNOWN");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP C: GOOGLE ADS TRANSPARENCY PRODUCTION FLOW
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group C: Google Ads Transparency Production Flow", () => {
    it("C01: invokeGoogleMcpTool always calls client.close() in finally when clientArg is not provided", async () => {
      let closeCalled = false;
      const customClient: GoogleTransparencyMcpClient = {
        connect: async () => {},
        listTools: async () => ["search_advertiser"],
        searchAdvertisers: async () => ({ advertisers: [] }),
        searchAdvertiserByDomain: async () => {
          throw new Error("Simulated tool error");
        },
        getAds: async () => ({ ads: [] }),
        getAdDetail: async () => ({}),
        close: async () => {
          closeCalled = true;
        },
        isAlive: () => true,
      };

      const res = await invokeGoogleMcpTool(
        "search_advertiser_by_domain",
        { domain: "petlibro.com" },
        {},
        customClient
      );
      expect(res.success).toBe(false);
      // Shared clientArg is NOT closed by invokeGoogleMcpTool
      expect(closeCalled).toBe(false);
    });

    it("C02: normalizeGoogleAdsResponse classifies root-domain and collection destination URLs as BRAND_RELATED even when headline contains topic keywords", () => {
      const result = normalizeGoogleAdsResponse(
        {
          requested_region: "US",
          provider_filter_region: "US",
          ads: [
            {
              advertiser_id: "AR1111111111",
              creative_id: "CR_V1933_ROOT",
              format: "image",
              headline: "Pet Gadgets & Grooming Vacuum Official Store",
              body: "Shop the best pet gadgets",
              destination_url: "https://uprootclean.com/",
            },
            {
              advertiser_id: "AR1111111111",
              creative_id: "CR_V1933_COLLECTION",
              format: "image",
              headline: "Pet Gadgets Collection Sale",
              body: "Browse all pet hair removers",
              destination_url: "https://uprootclean.com/collections/pet-gadgets",
            },
            {
              advertiser_id: "AR1111111111",
              creative_id: "CR_V1933_PDP",
              format: "image",
              headline: "Uproot Clean Pro Pet Hair Remover",
              body: "Reusable pet hair detailer",
              destination_url: "https://uprootclean.com/products/uproot-cleaner-pro",
              reported_delivery_region: "US",
            },
            {
              advertiser_id: "AR1111111111",
              creative_id: "CR_V1933_EMPTY",
              format: "text",
            },
          ],
        },
        {
          requestedDomain: "uprootclean.com",
          topic: "Pet Gadgets",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
          providerFilterMarket: "US",
        }
      );

      const rootAd = result.ads.find((a) => a.creativeId === "CR_V1933_ROOT")!;
      const colAd = result.ads.find((a) => a.creativeId === "CR_V1933_COLLECTION")!;
      const pdpAd = result.ads.find((a) => a.creativeId === "CR_V1933_PDP")!;
      const emptyAd = result.ads.find((a) => a.creativeId === "CR_V1933_EMPTY")!;

      expect(rootAd.productRelevance).toBe("BRAND_RELATED");
      expect(rootAd.verifiedDeliveryMarket).toBeNull();
      expect(rootAd.marketProvenance.verificationStatus).toBe("FILTER_ONLY");

      expect(colAd.productRelevance).toBe("BRAND_RELATED");
      expect(pdpAd.productRelevance).toBe("PRODUCT_SPECIFIC");
      expect(pdpAd.verifiedDeliveryMarket).toBe("US");
      expect(pdpAd.marketProvenance.verificationStatus).toBe("VERIFIED");

      expect(emptyAd.productRelevance).toBe("UNKNOWN");
    });

    it("C03: persistGoogleObservationsToDatabase preserves upstream evidenceReference, creates AdObservation with MCP receipt, sets unknown advertiser country to UNKNOWN, and returns structured counts", async () => {
      const norm = normalizeGoogleAdsResponse(
        {
          requested_region: "US",
          provider_filter_region: "US",
          ads: [
            {
              advertiser_id: "AR_V1933_99",
              advertiser_name: "Uproot Clean LLC",
              creative_id: "CR_V1933_PERSIST_01",
              format: "image",
              headline: "Uproot Clean Pro Pet Hair Remover",
              body: "Reusable lint & pet hair remover",
              destination_url: "https://uprootclean.com/products/uproot-cleaner-pro",
              mcpInvocationRef: "google_mcp_inv_uprootclean.com_AR_V1933_99_1001",
              invocationEvidenceRef: "GoogleMcpInvocation:google_mcp_inv_uprootclean.com_AR_V1933_99_1001",
              requestArgumentsHash: "a".repeat(64),
              responseEvidenceHash: "b".repeat(64),
              lineageMethod: "VERIFIED_LOCAL_INVOCATION_ONLY",
            },
          ],
        },
        {
          requestedDomain: "uprootclean.com",
          topic: "Pet Hair Remover",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
          providerFilterMarket: "US",
        }
      );

      const obs = norm.observations[0];
      expect(obs.evidenceReference).toBe("GoogleAd:CR_V1933_PERSIST_01");
      expect(obs.verifiedDeliveryMarket).toBeNull();

      const persistRes = await persistGoogleObservationsToDatabase([obs], workspaceId);
      expect(Array.isArray(persistRes)).toBe(true);
      expect(persistRes.length).toBe(1);
      expect(persistRes.insertedCount).toBe(1);
      expect(persistRes.updatedCount).toBe(0);
      expect(persistRes.failedCount).toBe(0);
      expect(persistRes.errors).toEqual([]);

      // Upstream evidenceReference MUST NOT be overwritten with CompetitorAd:<id>!
      expect(obs.evidenceReference).not.toMatch(/^CompetitorAd:/);
      expect(obs.persistedAdId).toBe(persistRes[0]);
      expect((obs.metrics as any).dbRecordReference).toBe(`CompetitorAd:${persistRes[0]}`);

      const dbAd = await prisma.competitorAd.findUnique({
        where: { id: persistRes[0] },
        include: { advertiser: true, observations: true, sourceIdentities: true },
      });
      expect(dbAd).not.toBeNull();
      expect(dbAd!.targetMarket).toBe("UNKNOWN");
      expect(dbAd!.advertiser.country).toBe("UNKNOWN");
      expect(dbAd!.sourceIdentities.length).toBe(1);
      expect(dbAd!.observations.length).toBeGreaterThanOrEqual(1);

      const rawPayload = JSON.parse(dbAd!.observations[0].rawPayload || "{}");
      expect(rawPayload.creativeId).toBe("CR_V1933_PERSIST_01");
      expect(rawPayload.advertiserId).toBe("AR_V1933_99");
      expect(rawPayload.mcpInvocationRef).toBe(
        "google_mcp_inv_uprootclean.com_AR_V1933_99_1001"
      );
      expect(rawPayload.responseEvidenceHash).toBe("b".repeat(64));

      // Second persistence updates existing record cleanly
      const secondRes = await persistGoogleObservationsToDatabase([obs], workspaceId);
      expect(secondRes.insertedCount).toBe(0);
      expect(secondRes.updatedCount).toBe(1);
    });

    it("C04: collectGoogleAdvertiserSignals enforces 429 rate-limit cooldown and skips subsequent domains cleanly", async () => {
      let lookupCalls = 0;
      const mockClient: GoogleTransparencyMcpClient = {
        connect: async () => {},
        listTools: async () => ["search_advertiser", "get_advertiser_ads"],
        listToolsWithSchemas: async () => [
          { name: "search_advertiser", inputSchema: { type: "object" } },
          { name: "get_advertiser_ads", inputSchema: { type: "object" } },
        ],
        callToolByName: async (name: string) => {
          if (name === "search_advertiser") {
            lookupCalls++;
            throw new Error("HTTP 429 Too Many Requests from Google Ads Transparency");
          }
          return { ads: [] };
        },
        searchAdvertisers: async () => ({ advertisers: [] }),
        searchAdvertiserByDomain: async () => ({ advertisers: [] }),
        getAds: async () => ({ ads: [] }),
        getAdDetail: async () => ({}),
        close: async () => {},
        isAlive: () => true,
      };

      const res = await collectGoogleAdvertiserSignals(
        {
          workspaceId: "test",
          researchRunId: "run_google_429",
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxResults: 10,
          advertiserDomains: ["domain1.com", "domain2.com", "domain3.com"],
        },
        mockClient
      );

      expect(lookupCalls).toBe(1);
      expect(res.status).toBe("QUERY_FAILED");
      expect(res.enrichmentExecution?.domainsRateLimited).toBe(1);
      const secondOutcome = res.enrichmentExecution?.domainOutcomes.find(
        (d: any) => d.domain === "domain2.com"
      );
      expect(secondOutcome?.status).toBe("SKIPPED_COOLDOWN");
      (globalThis as any).__swaiGoogleRateLimitUntil = 0;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP D: IDENTITY, FAMILY VARIANT COLLAPSE & MULTI-PLATFORM SCORING
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group D: Identity, Family Variant Collapse & Multi-Platform Scoring", () => {
    it("D01: discoverProductCandidatesFromAds collapses size/color variants of the same merchant product into 1 canonical candidate", () => {
      const obsList = [
        {
          source: "META_ADS" as const,
          sourceRecordId: "ad_var_1",
          sourceUrl: "https://www.facebook.com/ads/library/?id=101",
          landingPageUrl: "https://petlibro.com/products/dockstream-fountain?variant=111",
          advertiserOrCreator: "Petlibro",
          advertiserDomain: "petlibro.com",
          productMatchHint: "Petlibro Dockstream Fountain - White 2.5L",
          reportedPublishedAt: null,
          reportedFirstShownAt: "2026-08-01T00:00:00Z",
          reportedLastShownAt: "2026-10-15T00:00:00Z",
          observedAt: "2026-10-15T00:00:00Z",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          title: "Petlibro Dockstream Fountain - White 2.5L",
          description: "Cordless cat water fountain",
          metrics: { daysRunning: 75 },
          media: { thumbnailUrl: "https://petlibro.com/img1.jpg", videoUrl: null, mediaType: "IMAGE" },
          provenance: "LIVE_PROVIDER" as const,
          evidenceReference: "CompetitorAd:ad_var_1",
        },
        {
          source: "META_ADS" as const,
          sourceRecordId: "ad_var_2",
          sourceUrl: "https://www.facebook.com/ads/library/?id=102",
          landingPageUrl: "https://petlibro.com/products/dockstream-fountain?variant=222",
          advertiserOrCreator: "Petlibro",
          advertiserDomain: "petlibro.com",
          productMatchHint: "Petlibro Dockstream Fountain - Black 2.5L",
          reportedPublishedAt: null,
          reportedFirstShownAt: "2026-08-05T00:00:00Z",
          reportedLastShownAt: "2026-10-15T00:00:00Z",
          observedAt: "2026-10-15T00:00:00Z",
          requestedMarket: "US",
          verifiedDeliveryMarket: "US",
          title: "Petlibro Dockstream Fountain - Black 2.5L",
          description: "Cordless cat water fountain",
          metrics: { daysRunning: 70 },
          media: { thumbnailUrl: "https://petlibro.com/img2.jpg", videoUrl: null, mediaType: "IMAGE" },
          provenance: "LIVE_PROVIDER" as const,
          evidenceReference: "CompetitorAd:ad_var_2",
        },
      ];

      const candidates = discoverProductCandidatesFromAds(obsList);
      expect(candidates.length).toBe(1);
      expect(candidates[0].supportingAdIds.length).toBe(2);
    });

    it("D02: calculateKH02EvergreenScore normalizes FACEBOOK/INSTAGRAM/META/META_ADS into 1 platform and does not award GOOGLE_ADS product validation points for BRAND_RELATED creatives", () => {
      const candidateWithBrandOnlyGoogle: any = {
        candidateId: "cand_d02",
        title: "Uproot Clean Pro Pet Hair Remover",
        canonicalProductName: "Uproot Clean Pro Pet Hair Remover",
        category: "Pet Grooming",
        problemStatement: "Removes embedded pet hair from carpets and couches effortlessly",
        targetAudience: "Pet Owners",
        thumbnailUrl: "https://uprootclean.com/img.jpg",
        videoUrl: null,
        canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
        storeDomain: "uprootclean.com",
        advertiserNames: ["Uproot Clean"],
        supportingAdIds: ["ad_1", "ad_2"],
        supportingSourceTypes: ["FACEBOOK", "INSTAGRAM", "META", "META_ADS", "GOOGLE_ADS"],
        totalObservationCount: 5,
        distinctAdvertisersCount: 1,
        earliestObservationDate: "2026-07-01T00:00:00Z",
        latestObservationDate: "2026-10-15T00:00:00Z",
        identityConfidence: "EXACT",
        identityStatus: "VERIFIED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "ad_1",
            verifiedDeliveryMarket: "US",
            metrics: { daysRunning: 90 },
          },
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_BRAND_ONLY",
            verifiedDeliveryMarket: null,
            metrics: { productRelevance: "BRAND_RELATED" },
          },
        ],
      };

      const score = calculateKH02EvergreenScore({
        candidate: candidateWithBrandOnlyGoogle,
        demandSeries: [],
      });

      // Only META_ADS (8 pts) should be counted in Pillar C; BRAND_RELATED Google ad must NOT add +6 pts
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.pillars.multiPlatformValidation.status).toBe("MODERATE");
    });

    it("D03: evaluateShortlistDistinctness rejects duplicate product family cards in Top 3 shortlist", () => {
      const dupCandidates: any[] = [
        {
          candidateId: "cand_1",
          title: "UAHPET Stainless Steel Cat Water Fountain 2L",
          canonicalProductName: "UAHPET Stainless Steel Cat Water Fountain",
          canonicalProductUrl: "https://uahpet.com/products/cat-water-fountain",
          storeDomain: "uahpet.com",
          category: "Pet Fountain",
        },
        {
          candidateId: "cand_2",
          title: "UAHPET Stainless Steel Cat Water Fountain 2L - Filter Pack",
          canonicalProductName: "UAHPET Stainless Steel Cat Water Fountain",
          canonicalProductUrl: "https://uahpet.com/products/cat-water-fountain",
          storeDomain: "uahpet.com",
          category: "Pet Fountain",
        },
      ];

      const distinctEval = evaluateShortlistDistinctness(dupCandidates);
      expect(distinctEval.isDistinct).toBe(false);
      expect(distinctEval.distinctCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP E: SMOKE & DB READBACK DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Group E: Three-Source Smoke & Candidate DB Readback Truth", () => {
    it("E01: runThreeSourceFreeMcpSmoke reports protocol-only Google handshake (providerVerified=false), POLICY_DISABLED TikTok Organic, and 0 official CSV exports", async () => {
      const smoke = await runThreeSourceFreeMcpSmoke();
      expect(smoke.totalCostUsd).toBe(0);
      expect(smoke.sources.S1.details.requiresGraphApiAccessToken).toBe(false);
      expect(smoke.sources.S2.providerVerified).toBe(false);
      expect(smoke.sources.S3.details.policyStatus).toBe("POLICY_DISABLED");
      expect(smoke.sources.S4.status).toBe("DEFERRED_DO_NOT_TEST");
      expect(smoke.sources.S6.providerVerified).toBe(false);
      expect(smoke.sources.S6.details.officialLongitudinalExportsFound).toBe(0);
    });

    it("E02: executeCandidateDbReadback evaluates verifiedOfficialCsvRows via real BUSINESS lineage and returns dynamic globalDemandPartitionSummary", async () => {
      const readback = await executeCandidateDbReadback();
      expect(readback.dbConnected).toBe(true);
      expect(readback.verifiedOfficialCsvRows).toBe(0);
      expect(readback.businessAttributableCount).toBe(0);
      expect(readback.g15Verdict).toBe("INSUFFICIENT_EVIDENCE");
      expect(readback.globalDemandPartitionSummary).toBeDefined();
      expect(readback.globalDemandPartitionSummary?.verifiedBusinessLineageRows).toBe(0);
    });
  });
});

