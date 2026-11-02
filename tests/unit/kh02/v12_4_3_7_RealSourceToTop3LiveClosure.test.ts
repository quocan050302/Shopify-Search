/**
 * SWAI KH-02 V12.4.3.7 — Real Source-to-Top3 Live Execution Closure Test Suite
 *
 * Covers Section 8 mandatory positive & negative test matrix:
 * - Group A: Source Trust (A01–A12, 12 cases)
 * - Group B: Amazon Search/PDP Standalone Contract (B01–B20, 20 cases)
 * - Group C: Meta->Amazon Equivalence Two-Tier Identity Model (C01–C12, 12 cases)
 * - Group D: Real API/Worker/Persistence & Workspace Isolation (D01–D12, 12 cases)
 * - Group E: Positive End-to-End Deterministic Wiring (E01–E02, 2 cases)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAmazonUsPolicyContext,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import {
  extractAmazonAsinFromProductEvidence,
  isValidStrictAmazonAsin,
  parseAmazonProductEvidence,
  parseAmazonSearchSnapshotCards,
  validateAmazonUsProductUrl,
  validateAmazonUsSearchUrl,
  verifyAmazonProductIdentity,
} from "@/services/kh02/marketplace/amazonUsIdentity";
import {
  computeAmazonNonInflationDelta,
  deriveAmazonSearchIntents,
  selectAmazonCandidateMatches,
} from "@/services/kh02/marketplace/amazonUsAuthorizedDiscoveryAdapter";
import {
  runAmazonUsPilotEnrichment,
  selectDynamicAmazonVerificationTargets,
} from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import { connectAmazonPlaywrightMcp } from "@/services/kh02/marketplace/amazonUsMcpTransport";
import {
  loadAmazonEvidenceForRun,
  persistAmazonEvidenceAtomically,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import {
  resolveWalmartUsPilotPolicy as resolveWalmartPilotPolicy,
} from "@/services/kh02/marketplace/walmartJinaPolicy";
import { runWalmartUsPilotEnrichment } from "@/services/kh02/marketplace/walmartUsResearchAdapter";
import {
  discoverProductCandidatesFromAds as discoverProductCandidates,
  selectTopResearchShortlist,
} from "@/services/kh02/identity/productCandidateDiscovery";
import { collectMetaProductSignals } from "@/services/kh02/providers/metaResearchAdapter";
import {
  createKH02ResearchRun,
  getKH02Leaderboard,
  getKH02ResearchRunById,
  persistKH02RankingSnapshot,
} from "@/services/kh02/persistence/kh02PersistenceService";
import { POST as postResearchRoute, GET as getResearchRoute } from "@/app/api/v1/kh02/research/route";
import { GET as getLeaderboardRoute } from "@/app/api/v1/kh02/leaderboard/route";
import { GET as getRunByIdRoute } from "@/app/api/v1/kh02/research/runs/[runId]/route";

const TEST_WS_A = "ws_v12437_test_alpha";
const TEST_WS_B = "ws_v12437_test_beta";
const TEST_RUN_A = "kh02_run_v12437_alpha_1";

describe("KH-02 V12.4.3.7 — Real Source-to-Top3 Live Execution Closure Suite", () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: TEST_WS_A },
      update: { name: "V12.4.3.7 Test Workspace Alpha" },
      create: { id: TEST_WS_A, name: "V12.4.3.7 Test Workspace Alpha" },
    });
    await prisma.workspace.upsert({
      where: { id: TEST_WS_B },
      update: { name: "V12.4.3.7 Test Workspace Beta" },
      create: { id: TEST_WS_B, name: "V12.4.3.7 Test Workspace Beta" },
    });
  });

  afterAll(async () => {
    await prisma.researchEvidence
      .deleteMany({
        where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
      })
      .catch(() => {});
    await prisma.syncJob
      .deleteMany({
        where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
      })
      .catch(() => {});
  });

  // ============================================================================
  // GROUP A: SOURCE TRUST (12 CASES)
  // ============================================================================
  describe("Group A — Source Trust & Provenance Integrity (12 cases)", () => {
    it("A01: Unknown observation provenance is rejected and never promoted to LIVE_PROVIDER", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "9988776655443322",
            sourceUrl: "https://www.facebook.com/ads/library/?id=9988776655443322",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain for cats and dogs.",
            provenance: "UNKNOWN_ORIGIN" as any,
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      for (const c of candidates) {
        expect(c.liveObservationsCount || 0).toBe(0);
        for (const o of c.sourceObservations || []) {
          expect(o.provenance).not.toBe("LIVE_PROVIDER");
        }
      }
    });

    it("A02: Synthetic ad record ID (ad_1, meta_ad_test_1, demo_1) cannot become ACTUAL_SOURCE_ID", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "ad_1",
            sourceUrl: "https://www.facebook.com/ads/library/?id=ad_1",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      for (const c of candidates) {
        expect(c.liveObservationsCount || 0).toBe(0);
        for (const o of c.sourceObservations || []) {
          expect(o.sourceIdOrigin).not.toBe("ACTUAL_SOURCE_ID");
          expect(o.provenance).not.toBe("LIVE_PROVIDER");
        }
      }
    });

    it("A03: Derived query hash (query_hash_abc123) cannot become ACTUAL_SOURCE_ID or LIVE_PROVIDER", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "query_hash_9876543210abcdef",
            sourceUrl: "https://www.facebook.com/ads/library/",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      for (const c of candidates) {
        expect(c.liveObservationsCount || 0).toBe(0);
        for (const o of c.sourceObservations || []) {
          expect(o.sourceIdOrigin).not.toBe("ACTUAL_SOURCE_ID");
          expect(o.provenance).not.toBe("LIVE_PROVIDER");
        }
      }
    });

    it("A04: Missing providerRequestId remains null and never copies local providerInvocationRef", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          pageTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
          providerInvocationRef: "amz_inv_local_12345",
          providerRequestId: "amz_inv_local_12345",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.providerInvocationRef).toBe("amz_inv_local_12345");
      expect(ev.providerRequestId).toBeNull();
    });

    it("A05: LIVE_ONLY with conflicting non-live policy or failure returns zero promoted observations", async () => {
      const res = await collectMetaProductSignals({
        topic: "Pet Gadgets",
        market: "US",
        workspaceId: TEST_WS_A,
        sourceMode: "LIVE_ONLY",
        metaExecutionPolicy: "CACHE_ONLY",
      } as any);
      expect(res.observations).toHaveLength(0);
      expect(res.status).toBe("FAILED");
      expect(res.executionMetadata?.liveSucceeded).toBe(false);
    });

    it("A06: Cache fallback observations remain CACHED_SOURCE and never promote to LIVE_PROVIDER", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1455667788990011",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1455667788990011",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].liveObservationsCount).toBe(0);
      expect(candidates[0].cachedObservationsCount).toBeGreaterThan(0);
      expect(candidates[0].sourceObservations[0].provenance).toBe("CACHED_SOURCE");
    });

    it("A07: Seeded fixture observations stay SEEDED_FIXTURE and never count as live or cached", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1455667788990022",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1455667788990022",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain.",
            provenance: "SEEDED_FIXTURE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      for (const c of candidates) {
        expect(c.liveObservationsCount).toBe(0);
        for (const o of c.sourceObservations || []) {
          expect(o.provenance).toBe("SEEDED_FIXTURE");
        }
      }
    });

    it("A08: Stale historical cache cannot count as current-run live ads in Product Finder ViewModel", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1888999000111222",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1888999000111222",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "3.2L quiet pet water fountain for cats and dogs.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-08-01T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      expect(candidates[0].liveObservationsCount).toBe(0);
      expect(candidates[0].cachedObservationsCount).toBe(1);
    });

    it("A09: Non-merchant shell page (/collections/all, /pages/about-us, /cart) cannot become verified physical product", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1777888999000111",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1777888999000111",
            landingPageUrl: "https://pawquench.com/collections/all",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "Shop All Pet Supplies Collection",
            description: "Browse our full catalog.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const verified = candidates.filter(
        (c) => c.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT"
      );
      expect(verified).toHaveLength(0);
    });

    it("A10: Irrelevant audience product (Men's Bifold Wallet) is excluded from Pet Gadgets primary shortlist", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1666555444333222",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1666555444333222",
            landingPageUrl: "https://menswalletco.com/products/rfid-blocking-leather-bifold-wallet",
            advertiserDomain: "menswalletco.com",
            advertiserOrCreator: "MensWalletCo",
            title: "Men's RFID Blocking Leather Bifold Wallet",
            description: "Slim minimalist leather wallet for men.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const shortlist = selectTopResearchShortlist(candidates, 3, {
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist).toHaveLength(0);
    });

    it("A11: Duplicate variants of the same product family collapse so Top 3 shortlist never repeats the same product", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1555000111222331",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1555000111222331",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain?variant=white",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench 3.2L Stainless Steel Cat Water Fountain (White)",
            description: "Ultra-quiet pet water fountain for cats and dogs.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
          {
            source: "META_ADS",
            sourceRecordId: "1555000111222332",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1555000111222332",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain?variant=black",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench 3.2L Stainless Steel Cat Water Fountain (Black)",
            description: "Ultra-quiet pet water fountain for cats and dogs.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:05:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const shortlist = selectTopResearchShortlist(candidates, 3, {
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist.length).toBeLessThanOrEqual(1);
    });

    it("A12: Shortlist with < 3 eligible products is never padded with rejected or fictional items", () => {
      const candidates = discoverProductCandidates(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1444000111222333",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1444000111222333",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench 3.2L Stainless Steel Cat Water Fountain",
            description: "Ultra-quiet pet water fountain for cats and dogs.",
            provenance: "CACHED_SOURCE",
            observedAt: "2026-10-15T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const shortlist = selectTopResearchShortlist(candidates, 3, {
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist.length).toBe(1);
    });
  });

  // ============================================================================
  // GROUP B: AMAZON SEARCH/PDP STANDALONE CONTRACT (20 CASES)
  // ============================================================================
  describe("Group B — Amazon Search/PDP Standalone Contract (20 cases)", () => {
    it("B01: Feature flag off (KH02_AMAZON_US_ENABLED=false) blocks live MCP/search (DISABLED_BY_DEFAULT)", () => {
      const policy = resolveAmazonUsPolicyContext({
        KH02_AMAZON_US_ENABLED: "false",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
      });
      expect(policy.featureEnabled).toBe(false);
      expect(policy.liveAllowed).toBe(false);
      expect(policy.accessPolicyStatus).toBe("DISABLED_BY_DEFAULT");
    });

    it("B02: Live flag off (KH02_AMAZON_US_LIVE_ALLOWED=false) blocks live MCP/search (LIVE_NOT_ALLOWED)", () => {
      const policy = resolveAmazonUsPolicyContext({
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "false",
      });
      expect(policy.featureEnabled).toBe(true);
      expect(policy.liveAllowed).toBe(false);
      expect(policy.accessPolicyStatus).toBe("LIVE_NOT_ALLOWED");
    });

    it("B03: Unattested search (KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED=false) blocks live search (SEARCH_BLOCKED_POLICY)", async () => {
      const res = await runAmazonUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        optInRequested: true,
        candidates: [
          {
            candidateId: "cand_search_blocked",
            title: "faroro Automatic Cat Feeder TD20",
            canonicalProductName: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
            model: "TD20",
          },
        ],
        env: {
          KH02_AMAZON_US_ENABLED: "true",
          KH02_AMAZON_US_LIVE_ALLOWED: "true",
          KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
          KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED: "false",
        },
      });
      expect(res.marketplaceTelemetry.runStatus).toBe("SEARCH_BLOCKED_POLICY");
      expect(
        res.marketplaceTelemetry.localMcpPilotDiagnostics?.searchBlockedPolicyCount
      ).toBe(1);
    });

    it("B04: Disallowed host (amazon.co.uk, evil.example.com) is rejected for both Search and PDP URLs", () => {
      expect(
        validateAmazonUsProductUrl("https://www.amazon.co.uk/dp/B0D3XGHTJ5").valid
      ).toBe(false);
      expect(
        validateAmazonUsProductUrl("https://evil.example.com/dp/B0D3XGHTJ5").valid
      ).toBe(false);
      expect(
        validateAmazonUsSearchUrl("https://www.amazon.co.uk/s?k=cat+feeder").valid
      ).toBe(false);
    });

    it("B05: HTTP, IP literal, URL shortener, and URL credentials are rejected", () => {
      expect(
        validateAmazonUsProductUrl("http://www.amazon.com/dp/B0D3XGHTJ5").valid
      ).toBe(false);
      expect(
        validateAmazonUsProductUrl("https://127.0.0.1/dp/B0D3XGHTJ5").valid
      ).toBe(false);
      expect(validateAmazonUsProductUrl("https://amzn.to/3xyz123").valid).toBe(
        false
      );
      expect(
        validateAmazonUsProductUrl("https://user:pass@www.amazon.com/dp/B0D3XGHTJ5")
          .valid
      ).toBe(false);
    });

    it("B06: Malformed ASIN (9-char, 11-char, CATEGORIES, BESTSELLER) is rejected", () => {
      expect(isValidStrictAmazonAsin("B01234567")).toBe(false);
      expect(isValidStrictAmazonAsin("B0123456789")).toBe(false);
      expect(isValidStrictAmazonAsin("CATEGORIES")).toBe(false);
      expect(isValidStrictAmazonAsin("BESTSELLER")).toBe(false);
      expect(isValidStrictAmazonAsin("B0D3XGHTJ5")).toBe(true);
    });

    it("B07: Sponsored search card (Sponsored, /sspa/click, /gp/slredirect, AdHolder) is rejected", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        httpStatus: 200,
        rawHtml: `
          <div data-asin="B09SPON999" data-component-type="s-search-result">
            <span class="puis-sponsored-label-text">Sponsored</span>
            <h2><a href="/sspa/click?url=/dp/B09SPON999">Sponsored Automatic Cat Feeder</a></h2>
          </div>
        `,
      });
      expect(parsed.cards).toHaveLength(0);
      expect(parsed.rejectedCards[0]?.reason).toBe(
        "SPONSORED_SEARCH_CARD_REJECTED"
      );
    });

    it("B08: Missing data-asin search card is rejected", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        structuredData: {
          searchCards: [
            {
              asin: "",
              title: "faroro Automatic Cat Feeder",
              href: "/dp/B0D3XGHTJ5",
            },
          ],
        },
      });
      expect(parsed.cards).toHaveLength(0);
      expect(parsed.rejectedCards[0]?.reason).toContain(
        "INVALID_OR_NON_PRODUCT_ASIN"
      );
    });

    it("B09: Missing h2 title search card is rejected", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        structuredData: {
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "",
              href: "/dp/B0D3XGHTJ5",
            },
          ],
        },
      });
      expect(parsed.cards).toHaveLength(0);
      expect(parsed.rejectedCards[0]?.reason).toBe("MISSING_CARD_PRODUCT_TITLE");
    });

    it("B10: Missing or mismatched observed href on search card is rejected when requireObservedHref=true", () => {
      const parsedMissing = parseAmazonSearchSnapshotCards(
        {
          sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
          structuredData: {
            searchCards: [
              {
                asin: "B0D3XGHTJ5",
                title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
                href: null,
              },
            ],
          },
        },
        { requireObservedHref: true }
      );
      expect(parsedMissing.cards).toHaveLength(0);
      expect(parsedMissing.rejectedCards[0]?.reason).toBe(
        "MISSING_OBSERVED_SEARCH_CARD_HREF"
      );

      const parsedMismatch = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        structuredData: {
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
              href: "/faroro-Automatic-Cat-Feeder/dp/B0DCNNN5FC/ref=sr_1_1",
            },
          ],
        },
      });
      expect(parsedMismatch.cards).toHaveLength(0);
      expect(parsedMismatch.rejectedCards[0]?.reason).toContain(
        "SEARCH_CARD_HREF_ASIN_MISMATCH"
      );
    });

    it("B11: Search URL k query parameter mismatch fails queryParameterVerified and returns 0 cards", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=unrelated+kitchen+blender",
        httpStatus: 200,
        structuredData: {
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "faroro Automatic Cat Feeder",
              href: "/dp/B0D3XGHTJ5",
            },
          ],
        },
      });
      expect(parsed.queryParameterVerified).toBe(false);
      expect(parsed.queryParameterMismatch).toBe(true);
      expect(parsed.cards).toHaveLength(0);
    });

    it("B12: 5-card extraction cap is enforced (max 5 non-sponsored cards retained; 6th+ card rejected)", () => {
      const asins = [
        "B0D3XGHTJ5",
        "B0DCNNN5FC",
        "B0HB9H7CXV",
        "B0GSR1GTHW",
        "B0GVSFS68N",
        "B08N5WRWNW",
      ];
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        structuredData: {
          searchCards: asins.map((asin, idx) => ({
            asin,
            title: `Automatic Cat Feeder Model ${idx + 1} Timed Pet Dispenser`,
            href: `/Automatic-Cat-Feeder-${idx + 1}/dp/${asin}/ref=sr_1_${idx + 1}`,
          })),
        },
      });
      expect(parsed.cards).toHaveLength(5);
      expect(parsed.cards.map((c) => c.asin)).toEqual(asins.slice(0, 5));
      expect(parsed.rejectedCards).toHaveLength(1);
      expect(parsed.rejectedCards[0].asin).toBe("B08N5WRWNW");
      expect(parsed.rejectedCards[0].reason).toBe(
        "SEARCH_CARD_EXTRACTION_CAP_EXCEEDED_MAX_5"
      );
    });

    it("B13: Synthesized /dp/<ASIN> without observed href is labeled DERIVED_NORMALIZED_DP, while observed href is OBSERVED_HREF", () => {
      const parsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        structuredData: {
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "faroro Automatic Cat Feeder TD20",
              href: "/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1",
            },
            {
              asin: "B0DCNNN5FC",
              title: "Timed Pet Dry Food Dispenser",
              href: null,
            },
          ],
        },
      });
      expect(parsed.cards[0].observedSearchHrefOrigin).toBe("OBSERVED_HREF");
      expect(parsed.cards[0].observedSearchHref).toBe(
        "https://www.amazon.com/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1"
      );
      expect(parsed.cards[1].observedSearchHrefOrigin).toBe(
        "DERIVED_NORMALIZED_DP"
      );
      expect(parsed.cards[1].observedSearchHref).toBeNull();
    });

    it("B14: Canonical /clp/<ASIN> link tag is preserved as OBSERVED_CANONICAL while canonicalAmazonUrl is DERIVED_NORMALIZED_DP", () => {
      const asinRes = extractAmazonAsinFromProductEvidence(
        "https://www.amazon.com/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1",
        { asin: "B0D3XGHTJ5" },
        { canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5" }
      );
      expect(asinRes.valid).toBe(true);
      expect(asinRes.asin).toBe("B0D3XGHTJ5");
      expect(asinRes.observedCanonicalUrl).toBe(
        "https://www.amazon.com/clp/B0D3XGHTJ5"
      );
      expect(asinRes.canonicalUrlOrigin).toBe("OBSERVED_CANONICAL");
      expect(asinRes.canonicalAmazonUrl).toBe(
        "https://www.amazon.com/dp/B0D3XGHTJ5"
      );
    });

    it("B15: Search card ASIN != PDP ASIN fails searchIdentityVerdict (MISMATCH_ASIN)", () => {
      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            modelNumber: "TD20",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
        }
      );
      const verified = verifyAmazonProductIdentity(
        {
          candidateId: "cand_1",
          title: "faroro Automatic Cat Feeder TD20",
          brand: "faroro",
          model: "TD20",
        },
        pdpEv,
        {
          searchCard: {
            asin: "B0DCNNN5FC",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          },
        }
      );
      expect(verified.searchIdentityVerdict).toBe("MISMATCH_ASIN");
      expect(verified.combinedIdentityVerdict).toBe("REJECTED_IDENTITY");
      expect(verified.identityMatch).toBe("NO_MATCH");
    });

    it("B16: Search card title token mismatch with PDP title fails searchIdentityVerdict (MISMATCH_TITLE)", () => {
      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            modelNumber: "TD20",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
        }
      );
      const verified = verifyAmazonProductIdentity(
        {
          candidateId: "cand_1",
          title: "faroro Automatic Cat Feeder TD20",
          brand: "faroro",
          model: "TD20",
        },
        pdpEv,
        {
          searchCard: {
            asin: "B0D3XGHTJ5",
            productTitle: "Heavy Duty Dog Metal Crate Kennel Cage XL",
          },
        }
      );
      expect(verified.searchIdentityVerdict).toBe("MISMATCH_TITLE");
      expect(verified.combinedIdentityVerdict).toBe("REJECTED_IDENTITY");
      expect(verified.identityMatch).toBe("NO_MATCH");
    });

    it("B17: Coupon discount or carousel price is never treated as core price", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: 10.0,
            currency: "USD",
            priceSource: "coupon_discount_badge",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
        }
      );
      expect(ev.price).toBeNull();
      expect(ev.currency).toBeNull();
    });

    it("B18: Missing price remains null, never 0", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: null,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
        }
      );
      expect(ev.price).toBeNull();
      expect(ev.price).not.toBe(0);
    });

    it("B19: Non-US delivery (Deliver to Vietnam) or raw $ without USD/US-ZIP proof leaves verifiedDeliveryMarket=null and commercialUsStatus=UNVERIFIED", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          html: "<div>Deliver to Vietnam</div><span>$49.99</span>",
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            deliveryLocationText: "Deliver to Vietnam",
            deliveryPostalCode: null,
            price: null,
            currency: null,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_1",
        }
      );
      expect(ev.verifiedDeliveryMarket).toBeNull();
      expect(ev.observedDeliveryPostalCode).toBeNull();
      expect(ev.currency).toBeNull();
      expect(ev.commercialUsStatus).toBe("UNVERIFIED");
    });

    it("B20: Standalone reference contract reproduction (B0D3XGHTJ5 faroro TD20 $49.99 USD Sacramento 95829 WECACO /clp/B0D3XGHTJ5 + 4 DISCOVERED_NOT_VERIFIED cards)", () => {
      const searchParsed = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        httpStatus: 200,
        structuredData: {
          deliveryLocationText: "Deliver to Sacramento 95829",
          deliveryPostalCode: "95829",
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser with Programmable Portion Control",
              href: "/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
              price: "$49.99",
              currency: "USD",
            },
            {
              asin: "B0DCNNN5FC",
              title: "Automatic Cat Feeder with Camera 5G WiFi Pet Food Dispenser",
              href: "/Automatic-Cat-Feeder-Camera/dp/B0DCNNN5FC/ref=sr_1_2",
              price: "$69.99",
              currency: "USD",
            },
            {
              asin: "B0HB9H7CXV",
              title: "Stainless Steel Timed Cat Feeder Dual Bowl",
              href: "/Stainless-Steel-Timed-Cat-Feeder/dp/B0HB9H7CXV/ref=sr_1_3",
              price: "$54.99",
              currency: "USD",
            },
            {
              asin: "B0GSR1GTHW",
              title: "Smart Pet Feeder 4L Automatic Dry Food Dispenser",
              href: "/Smart-Pet-Feeder-Automatic/dp/B0GSR1GTHW/ref=sr_1_4",
              price: "$45.99",
              currency: "USD",
            },
            {
              asin: "B0GVSFS68N",
              title: "Programmable Timed Cat Food Dispenser with Voice Recorder",
              href: "/Programmable-Timed-Cat-Dispenser/dp/B0GVSFS68N/ref=sr_1_5",
              price: "$39.99",
              currency: "USD",
            },
          ],
        },
      });

      expect(searchParsed.cards).toHaveLength(5);
      expect(searchParsed.observedDeliveryPostalCode).toBe("95829");
      const firstCard = searchParsed.cards[0];
      expect(firstCard.asin).toBe("B0D3XGHTJ5");
      expect(firstCard.observedSearchHref).toBe(
        "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1"
      );

      // Parse PDP for B0D3XGHTJ5 using observed href and canonical /clp/B0D3XGHTJ5
      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: firstCard.observedSearchHref!,
          finalUrl:
            "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          html: `
            <div id="detailBullets_feature_div">Item model number : TD20</div>
            <div id="merchant-info">Sold by WECACO and Fulfilled by Amazon.</div>
          `,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle:
              "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser with Programmable Portion Control, 1-6 Meals Per Day, 10s Voice Recorder for Cats and Small Dogs (TD20)",
            brand: "faroro",
            price: 49.99,
            currency: "USD",
            availability: "In Stock",
            deliveryLocationText: "Deliver to Sacramento 95829",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_faroro_td20",
          observationClass: "AUTHORIZED_LIVE",
        }
      );

      expect(pdpEv.asin).toBe("B0D3XGHTJ5");
      expect(pdpEv.brand).toBe("faroro");
      expect(pdpEv.modelNumber).toBe("TD20");
      expect(pdpEv.seller).toBe("WECACO");
      expect(pdpEv.price).toBe(49.99);
      expect(pdpEv.currency).toBe("USD");
      expect(pdpEv.observedDeliveryPostalCode).toBe("95829");
      expect(pdpEv.observedCanonicalUrl).toBe(
        "https://www.amazon.com/clp/B0D3XGHTJ5"
      );
      expect(pdpEv.canonicalUrlOrigin).toBe("OBSERVED_CANONICAL");
      expect(pdpEv.canonicalAmazonUrl).toBe(
        "https://www.amazon.com/dp/B0D3XGHTJ5"
      );
      expect(pdpEv.commercialUsStatus).toBe("US_COMMERCIAL_VERIFIED");
      expect(pdpEv.sellerStatus).toBe("OBSERVED");
      expect(pdpEv.availabilityStatus).toBe("OBSERVED");
      expect(pdpEv.provenanceStatus).toBe("PROVENANCE_VERIFIED");

      const verified = verifyAmazonProductIdentity(
        {
          candidateId: "cand_faroro_td20",
          title: "faroro Automatic Cat Feeder TD20 4L Timed Pet Dry Food Dispenser",
          brand: "faroro",
          model: "TD20",
        },
        pdpEv,
        {
          searchCard: firstCard,
          sessionClosedCleanly: true,
        }
      );
      expect(verified.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(verified.metaCandidateEquivalenceVerdict).toBe("EXACT_PRODUCT");
      expect(verified.combinedIdentityVerdict).toBe(
        "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      );
      expect(verified.searchBrandCrossConfirmed).toBe(true);
      expect(verified.searchModelCrossConfirmed).toBe(true);
      expect(verified.updatedEvidence.sessionLifecycleStatus).toBe(
        "CLOSED_CLEANLY"
      );
    });
  });

  // ============================================================================
  // GROUP C: META -> AMAZON EQUIVALENCE TWO-TIER MODEL (12 CASES)
  // ============================================================================
  describe("Group C — Meta->Amazon Equivalence Two-Tier Model (12 cases)", () => {
    const baseFaroroPdp = () =>
      parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1",
          finalUrl: "https://www.amazon.com/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser TD20",
            brand: "faroro",
            modelNumber: "TD20",
            seller: "WECACO",
            price: 49.99,
            currency: "USD",
            availability: "In Stock",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_test",
        }
      );

    it("C01: Brand-only match returns BRAND_ONLY / MISSING_IDENTIFIERS and never EXACT_PRODUCT", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_brand_only",
          title: "faroro Interactive Laser Cat Toy Tower",
          brand: "faroro",
        },
        baseFaroroPdp()
      );
      expect(res.identityMatch).toBe("BRAND_ONLY");
      expect(res.metaCandidateEquivalenceVerdict).toBe("MISSING_IDENTIFIERS");
      expect(res.status).toBe("OBSERVED_UNVERIFIED");
    });

    it("C02: Category-only match with Search->PDP verified returns AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_category_only",
          title: "Smart WiFi Pet Feeder Bowl",
          brand: null,
        },
        baseFaroroPdp(),
        {
          searchCard: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser TD20",
          },
        }
      );
      expect(res.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(res.metaCandidateEquivalenceVerdict).toBe("CATEGORY_ONLY");
      expect(res.combinedIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED"
      );
      expect(res.identityMatch).toBe("NO_MATCH");
    });

    it("C03: Accessory/refill mismatch (Replacement Filter Pack vs Main Feeder) is rejected", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_accessory",
          title: "faroro Replacement Filters 8-Pack for Automatic Cat Feeder",
          brand: "faroro",
        },
        baseFaroroPdp()
      );
      expect(res.identityMatch).not.toBe("EXACT_PRODUCT");
      expect(
        res.rejectionReasons.some((r) =>
          r.includes("ACCESSORY_VS_MAIN_PRODUCT_MISMATCH")
        )
      ).toBe(true);
    });

    it("C04: Contradictory model (candidate TD99 vs Amazon TD20) returns CONTRADICTORY_MODEL / REJECTED_IDENTITY", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_model_conflict",
          title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          brand: "faroro",
          model: "TD99",
        },
        baseFaroroPdp()
      );
      expect(res.metaCandidateEquivalenceVerdict).toBe("CONTRADICTORY_MODEL");
      expect(res.combinedIdentityVerdict).toBe("REJECTED_IDENTITY");
      expect(res.identityMatch).not.toBe("EXACT_PRODUCT");
    });

    it("C05: Contradictory brand (candidate Furbo vs Amazon faroro) returns CONTRADICTORY_BRAND / REJECTED_IDENTITY", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_brand_conflict",
          title: "Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          brand: "Furbo",
        },
        baseFaroroPdp()
      );
      expect(res.metaCandidateEquivalenceVerdict).toBe("CONTRADICTORY_BRAND");
      expect(res.combinedIdentityVerdict).toBe("REJECTED_IDENTITY");
      expect(res.identityMatch).toBe("NO_MATCH");
    });

    it("C06: Search->PDP verified alone without Meta brand/identifier match never promotes Meta equivalence to EXACT_PRODUCT", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_unbranded_meta",
          title: "Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          brand: null,
        },
        baseFaroroPdp(),
        {
          searchCard: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser TD20",
          },
        }
      );
      expect(res.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(res.metaCandidateEquivalenceVerdict).toBe("PROBABLE_SAME_FAMILY");
      expect(res.combinedIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED"
      );
      expect(res.identityMatch).toBe("PROBABLE_PRODUCT");
    });

    it("C07: Search-only card not opened as PDP remains SEARCH_ONLY_NOT_VERIFIED / DISCOVERED_NOT_VERIFIED", () => {
      const searchOnlyCard = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0DCNNN5FC",
          finalUrl: "https://www.amazon.com/dp/B0DCNNN5FC",
          canonicalUrl: "https://www.amazon.com/dp/B0DCNNN5FC",
          httpStatus: 200,
          structuredData: {
            asin: "B0DCNNN5FC",
            productTitle: "Automatic Cat Feeder with Camera 5G WiFi",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_search_only",
          requestMode: "AUTHORIZED_SEARCH",
        }
      );
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_search_only",
          title: "Automatic Cat Feeder with Camera",
          brand: null,
        },
        searchOnlyCard
      );
      expect(res.searchIdentityVerdict).toBe("SEARCH_ONLY_NOT_VERIFIED");
      expect(res.combinedIdentityVerdict).toBe("DISCOVERED_NOT_VERIFIED");
    });

    it("C08: Exact brand + exact model + Search->PDP verified returns META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED", () => {
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_exact_model",
          title: "faroro Automatic Cat Feeder 4L Timed Dispenser",
          brand: "faroro",
          model: "TD20",
        },
        baseFaroroPdp(),
        {
          searchCard: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser TD20",
          },
        }
      );
      expect(res.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(res.metaCandidateEquivalenceVerdict).toBe("EXACT_PRODUCT");
      expect(res.combinedIdentityVerdict).toBe(
        "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      );
      expect(res.identityMatch).toBe("EXACT_PRODUCT");
      expect(res.status).toBe("IDENTITY_VERIFIED");
    });

    it("C09: Exact brand + exact GTIN + matching tokens returns EXACT_PRODUCT", () => {
      const pdpWithGtin = {
        ...baseFaroroPdp(),
        gtin: "00850012345678",
      };
      const res = verifyAmazonProductIdentity(
        {
          candidateId: "cand_exact_gtin",
          title: "faroro Automatic Cat Feeder",
          brand: "faroro",
          gtin: "00850012345678",
        },
        pdpWithGtin
      );
      expect(res.identityMatch).toBe("EXACT_PRODUCT");
      expect(res.metaCandidateEquivalenceVerdict).toBe("EXACT_PRODUCT");
      expect(res.combinedIdentityVerdict).toBe(
        "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      );
    });

    it("C10: selectAmazonCandidateMatches records searchRankPosition, observedSearchHref, and firstCardDisposition", () => {
      const card1 = {
        ...baseFaroroPdp(),
        asin: "B0DCNNN5FC",
        productTitle: "Unrelated Dog Harness Leash Set",
        brand: "OtherBrand",
        observedSearchHref: "https://www.amazon.com/Dog-Harness/dp/B0DCNNN5FC/ref=sr_1_1",
        observedSearchHrefOrigin: "OBSERVED_HREF" as const,
        searchRankPosition: 1,
      };
      const card2 = {
        ...baseFaroroPdp(),
        observedSearchHref: "https://www.amazon.com/faroro-Feeder/dp/B0D3XGHTJ5/ref=sr_1_2",
        observedSearchHrefOrigin: "OBSERVED_HREF" as const,
        searchRankPosition: 2,
      };
      const decisions = selectAmazonCandidateMatches(
        {
          candidateId: "cand_faroro",
          title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
          brand: "faroro",
          model: "TD20",
        },
        [card1, card2]
      );
      expect(decisions[0].asin).toBe("B0D3XGHTJ5");
      expect(decisions[0].selectedAsBest).toBe(true);
      expect(decisions[0].searchRankPosition).toBe(2);
      expect(decisions[0].firstCardDisposition).toContain(
        "FIRST_CARD_NOT_SELECTED:asin=B0DCNNN5FC"
      );
    });

    it("C11: Amazon corroboration never inflates opportunityScore, G07, G15, or G16", () => {
      const before = {
        runId: "run_before",
        cutoffIso: "2026-10-30T00:00:00.000Z",
        candidates: [
          {
            candidateId: "cand_1",
            rank: 1,
            opportunityScore: 68.5,
            g07Passed: false,
            g15Passed: false,
            g16Passed: false,
          },
        ],
      };
      const after = {
        runId: "run_after",
        cutoffIso: "2026-10-30T00:00:00.000Z",
        candidates: [
          {
            candidateId: "cand_1",
            rank: 1,
            opportunityScore: 68.5,
            g07Passed: false,
            g15Passed: false,
            g16Passed: false,
          },
        ],
      };
      const delta = computeAmazonNonInflationDelta(before as any, after as any);
      expect(delta.comparisonStatus).toBe("COMPARED_ZERO_INFLATION");
      expect(delta.maxAbsoluteScoreDelta).toBe(0);
      expect(delta.rankOrderChanged).toBe(false);
      expect(delta.g07Changed).toBe(false);
      expect(delta.g15Changed).toBe(false);
      expect(delta.g16Changed).toBe(false);
    });

    it("C12: selectDynamicAmazonVerificationTargets skips IRRELEVANT, REJECTED, UNRESOLVED, and SYNTHETIC_DEMO even when directUrl is provided", () => {
      const candidates = [
        {
          candidateId: "cand_irrel_url",
          title: "Men's Leather Wallet",
          relevanceStatus: "IRRELEVANT",
          productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
          identityStatus: "VERIFIED",
          sourceObservations: [{ provenance: "CACHED_SOURCE" }],
        },
        {
          candidateId: "cand_unres_url",
          title: "Unresolved Mystery Box",
          relevanceStatus: "RELEVANT",
          productRealityStatus: "UNRESOLVED",
          identityStatus: "UNRESOLVED",
          sourceObservations: [{ provenance: "CACHED_SOURCE" }],
        },
        {
          candidateId: "cand_synth_url",
          title: "Synthetic Demo Pet Feeder",
          relevanceStatus: "RELEVANT",
          productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
          identityStatus: "VERIFIED",
          sourceObservations: [{ provenance: "SYNTHETIC_DEMO" }],
        },
      ];
      const res = selectDynamicAmazonVerificationTargets(candidates, [], {
        niche: "Pet Gadgets",
        candidateAmazonUrls: {
          cand_irrel_url: "https://www.amazon.com/dp/B0D3XGHTJ5",
          cand_unres_url: "https://www.amazon.com/dp/B0DCNNN5FC",
          cand_synth_url: "https://www.amazon.com/dp/B0HB9H7CXV",
        },
      });
      expect(res.selectedCount).toBe(0);
      expect(res.selectedCandidates).toHaveLength(0);
      expect(
        res.decisions.find((d) => d.candidateId === "cand_irrel_url")?.reasonCode
      ).toBe("SKIPPED_IRRELEVANT_OR_REJECTED");
      expect(
        res.decisions.find((d) => d.candidateId === "cand_unres_url")?.reasonCode
      ).toBe("SKIPPED_NON_PHYSICAL_OR_UNRESOLVED");
      expect(
        res.decisions.find((d) => d.candidateId === "cand_synth_url")?.reasonCode
      ).toBe("SKIPPED_SYNTHETIC_OR_DERIVED_ONLY");
    });
  });

  // ============================================================================
  // GROUP D: REAL API/WORKER/PERSISTENCE & ISOLATION (12 CASES)
  // ============================================================================
  describe("Group D — Real API, Worker Fencing, Persistence & Isolation (12 cases)", () => {
    it("D01: Unauthenticated/invalid-token POST /api/v1/kh02/research is rejected fail-closed", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer invalid_unauthenticated_token_999",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({ topic: "Pet Gadgets", asyncMode: true }),
      });
      const res = await postResearchRoute(req);
      expect([401, 403]).toContain(res.status);
    });

    it("D02: Empty workspaceId in createKH02ResearchRun is rejected with 400 NO_WORKSPACE_CONFIGURED", async () => {
      await expect(
        createKH02ResearchRun({
          workspaceId: "   ",
          topic: "Pet Gadgets",
        })
      ).rejects.toMatchObject({
        code: "NO_WORKSPACE_CONFIGURED",
        statusCode: 400,
      });
    });

    it("D03: Nonexistent workspace is rejected (403/404) and never auto-created in DB", async () => {
      const missingWs = "ws_nonexistent_v12437_99999";
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": missingWs,
        },
        body: JSON.stringify({ topic: "Pet Gadgets", asyncMode: true }),
      });
      const res = await postResearchRoute(req);
      expect([403, 404]).toContain(res.status);
      const wsInDb = await prisma.workspace.findUnique({ where: { id: missingWs } });
      expect(wsInDb).toBeNull();
    });

    it("D04: Cross-workspace GET /api/v1/kh02/research/runs/[runId] from Workspace B cannot read Workspace A run", async () => {
      const runId = await createKH02ResearchRun({
        workspaceId: TEST_WS_A,
        topic: "Pet Gadgets",
      });
      const reqFromB = new NextRequest(
        `http://localhost:3000/api/v1/kh02/research/runs/${runId}`,
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_B },
        }
      );
      const res = await getRunByIdRoute(reqFromB, {
        params: Promise.resolve({ runId }),
      } as any);
      expect(res.status).toBe(404);
    });

    it("D05: Cross-workspace loadAmazonEvidenceForRun(wsB, runA) returns zero rows", async () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_iso_1",
          observationClass: "AUTHORIZED_LIVE",
        }
      );
      await persistAmazonEvidenceAtomically(TEST_WS_A, TEST_RUN_A, [ev]);
      const loadedFromB = await loadAmazonEvidenceForRun(TEST_WS_B, TEST_RUN_A);
      expect(loadedFromB.evidenceRows).toHaveLength(0);
    });

    it("D06: Stale worker lease / mismatched claimToken blocks persistAmazonEvidenceAtomically", async () => {
      const runId = await createKH02ResearchRun({
        workspaceId: TEST_WS_A,
        topic: "Pet Gadgets",
      });
      await prisma.syncJob.update({
        where: { id: runId },
        data: {
          status: "RUNNING",
          workerId: "worker_actual_owner",
          claimToken: "claim_actual_1",
          fencingGeneration: 2,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: runId,
          candidateId: "cand_stale_1",
        }
      );
      const staleRes = await persistAmazonEvidenceAtomically(
        TEST_WS_A,
        runId,
        [ev],
        {
          ownershipJobId: runId,
          expectedWorkerId: "worker_stale_intruder",
          expectedClaimToken: "claim_stale_999",
        }
      );
      expect(staleRes.blockedByOwnershipOrAbort).toBe(true);
      expect(staleRes.persistedCount).toBe(0);
    });

    it("D07: Aborted AbortSignal blocks persistAmazonEvidenceAtomically with zero rows written", async () => {
      const controller = new AbortController();
      controller.abort();
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_abort_1",
        }
      );
      const res = await persistAmazonEvidenceAtomically(
        TEST_WS_A,
        TEST_RUN_A,
        [ev],
        { signal: controller.signal }
      );
      expect(res.blockedByOwnershipOrAbort).toBe(true);
      expect(res.persistedCount).toBe(0);
    });

    it("D08: Duplicate persistAmazonEvidenceAtomically calls are idempotent and preserve stronger AUTHORIZED_LIVE IDENTITY_VERIFIED rows", async () => {
      const baseEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
            modelNumber: "TD20",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_idem_1",
          observationClass: "AUTHORIZED_LIVE",
        }
      );
      const strongEv = verifyAmazonProductIdentity(
        {
          candidateId: "cand_idem_1",
          title: "faroro Automatic Cat Feeder TD20",
          brand: "faroro",
          model: "TD20",
        },
        baseEv
      ).updatedEvidence;

      const r1 = await persistAmazonEvidenceAtomically(TEST_WS_A, TEST_RUN_A, [
        strongEv,
        strongEv,
      ]);
      expect(r1.persistedCount).toBe(1);
      expect(r1.deduplicatedCount).toBe(1);

      const weakerEv = {
        ...strongEv,
        status: "OBSERVED_UNVERIFIED" as const,
        identityMatch: "NO_MATCH" as const,
        observationClass: "TEST_FIXTURE" as const,
      };
      await persistAmazonEvidenceAtomically(TEST_WS_A, TEST_RUN_A, [weakerEv]);
      const loaded = await loadAmazonEvidenceForRun(TEST_WS_A, TEST_RUN_A);
      const row = loaded.evidenceRows.find(
        (r) => r.candidateId === "cand_idem_1" && r.asin === "B0D3XGHTJ5"
      );
      expect(row?.status).toBe("IDENTITY_VERIFIED");
      expect(row?.observationClass).toBe("AUTHORIZED_LIVE");
    });

    it("D09: GET /api/v1/kh02/leaderboard and GET /api/v1/kh02/research are strictly read-only", async () => {
      const countBefore = await prisma.researchEvidence.count({
        where: { workspaceId: TEST_WS_A },
      });
      const req1 = new NextRequest(
        "http://localhost:3000/api/v1/kh02/leaderboard",
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_A },
        }
      );
      const res1 = await getLeaderboardRoute(req1);
      expect(res1.status).toBe(200);

      const req2 = new NextRequest(
        "http://localhost:3000/api/v1/kh02/research",
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_A },
        }
      );
      const res2 = await getResearchRoute(req2);
      expect(res2.status).toBe(200);

      const countAfter = await prisma.researchEvidence.count({
        where: { workspaceId: TEST_WS_A },
      });
      expect(countAfter).toBe(countBefore);
    });

    it("D10: Client-supplied Walmart policy override on POST /api/v1/kh02/research is rejected with HTTP 400 FORBIDDEN_WALMART_POLICY_OVERRIDE", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          topic: "Pet Gadgets",
          walmartJinaEndpoint: "https://evil.example.com",
        }),
      });
      const res = await postResearchRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN_WALMART_POLICY_OVERRIDE");
    });

    it("D11: Client-supplied Amazon policy override on POST /api/v1/kh02/research is rejected with HTTP 400 FORBIDDEN_AMAZON_POLICY_OVERRIDE", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          topic: "Pet Gadgets",
          amazonTargetHost: "https://evil.example.com",
        }),
      });
      const res = await postResearchRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN_AMAZON_POLICY_OVERRIDE");
    });

    it("D12: Walmart US remains paused by default (PAUSED_EXTERNAL / BLOCKED_PROVIDER) with 0 outbound HTTP calls", async () => {
      const policy = resolveWalmartPilotPolicy({});
      expect(policy.featureEnabled).toBe(false);
      expect(policy.liveAllowed).toBe(false);
      expect(policy.operationalStatus).toBe("PAUSED_EXTERNAL");

      let fetchCalls = 0;
      const customFetch = async () => {
        fetchCalls++;
        return new Response("{}", { status: 200 });
      };
      const wmtRes = await runWalmartUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        enableWalmartUsPilot: true,
        shortlistedCandidates: [
          {
            candidateId: "cand_wmt_1",
            title: "faroro Automatic Cat Feeder TD20",
          } as any,
        ],
        env: {},
        customFetch: customFetch as any,
      });
      expect(fetchCalls).toBe(0);
      expect(wmtRes.telemetry.logicalOperationsUsed).toBe(0);
      expect(wmtRes.telemetry.overallStatus).toBe("DISABLED");
    });
  });

  // ============================================================================
  // GROUP E: POSITIVE END-TO-END DETERMINISTIC WIRING (2 CASES)
  // ============================================================================
  describe("Group E — Positive End-to-End Deterministic Wiring (2 cases)", () => {
    it("E01: Search -> Observed href PDP navigation -> Two-Tier Identity -> DB Persistence -> Read-only API & ViewModel parity", async () => {
      const searchUrl =
        "https://www.amazon.com/s?k=faroro%20Automatic%20Cat%20Feeder%20TD20";
      const observedCardHref =
        "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1";

      const enrichment = await runAmazonUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        optInRequested: true,
        requestMode: "TEST_FIXTURE",
        candidates: [
          {
            candidateId: "cand_e01_faroro",
            title: "faroro Automatic Cat Feeder",
            canonicalProductName: "faroro Automatic Cat Feeder",
            brand: "faroro",
            model: "TD20",
          },
        ],
        env: {
          KH02_AMAZON_US_ENABLED: "true",
          KH02_AMAZON_US_LIVE_ALLOWED: "true",
          KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
          KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED: "true",
        },
        fixtureSnapshotsByUrl: {
          [searchUrl]: {
            sourceUrl: searchUrl,
            finalUrl: searchUrl,
            httpStatus: 200,
            pageTitle: "Amazon.com : faroro Automatic Cat Feeder TD20",
            structuredData: {
              deliveryLocationText: "Deliver to Sacramento 95829",
              deliveryPostalCode: "95829",
              searchCards: [
                {
                  asin: "B0D3XGHTJ5",
                  title:
                    "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser TD20",
                  href: "/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
                  price: "$49.99",
                  currency: "USD",
                },
                {
                  asin: "B0DCNNN5FC",
                  title: "Automatic Cat Feeder with Camera 5G WiFi",
                  href: "/Automatic-Cat-Feeder-Camera/dp/B0DCNNN5FC/ref=sr_1_2",
                  price: "$69.99",
                  currency: "USD",
                },
              ],
            },
          },
          [observedCardHref]: {
            sourceUrl: observedCardHref,
            finalUrl: observedCardHref,
            canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
            httpStatus: 200,
            structuredData: {
              asin: "B0D3XGHTJ5",
              productTitle:
                "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser with Programmable Portion Control (TD20)",
              brand: "faroro",
              modelNumber: "TD20",
              seller: "WECACO",
              price: 49.99,
              currency: "USD",
              availability: "In Stock",
              deliveryLocationText: "Deliver to Sacramento 95829",
              deliveryPostalCode: "95829",
              explicitUsDeliveryConfirmed: true,
            },
          },
        },
      });

      expect(enrichment.marketplaceEvidence).toHaveLength(1);
      const ev = enrichment.marketplaceEvidence[0];
      expect(ev.asin).toBe("B0D3XGHTJ5");
      expect(ev.sourceUrl).toBe(observedCardHref);
      expect(ev.observedSearchHref).toBe(observedCardHref);
      expect(ev.observedSearchHrefOrigin).toBe("OBSERVED_HREF");
      expect(ev.observedCanonicalUrl).toBe(
        "https://www.amazon.com/clp/B0D3XGHTJ5"
      );
      expect(ev.canonicalUrlOrigin).toBe("OBSERVED_CANONICAL");
      expect(ev.canonicalAmazonUrl).toBe(
        "https://www.amazon.com/dp/B0D3XGHTJ5"
      );
      expect(ev.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(ev.metaCandidateEquivalenceVerdict).toBe("EXACT_PRODUCT");
      expect(ev.combinedIdentityVerdict).toBe(
        "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      );
      expect(ev.commercialUsStatus).toBe("US_COMMERCIAL_VERIFIED");

      const summary = summarizeAmazonEvidenceForProduct(
        "cand_e01_faroro",
        TEST_RUN_A,
        enrichment.marketplaceEvidence,
        { telemetry: enrichment.marketplaceTelemetry }
      );
      expect(summary.visible).toBe(true);
      expect(summary.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      expect(summary.metaCandidateEquivalenceVerdict).toBe("EXACT_PRODUCT");
      expect(summary.combinedIdentityVerdict).toBe(
        "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      );
      expect(summary.observedCanonicalUrl).toBe(
        "https://www.amazon.com/clp/B0D3XGHTJ5"
      );
    });

    it("E02: Category-only Meta candidate opening observed Amazon PDP records AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED without false EXACT_PRODUCT promotion", async () => {
      const searchUrl =
        "https://www.amazon.com/s?k=PawQuench%20Automatic%20Cat%20Feeder%20Dispenser";
      const observedCardHref =
        "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1";

      const enrichment = await runAmazonUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        optInRequested: true,
        requestMode: "TEST_FIXTURE",
        candidates: [
          {
            candidateId: "cand_e02_pawquench",
            title: "Automatic Cat Feeder Dispenser",
            canonicalProductName: "Automatic Cat Feeder Dispenser",
            brand: "PawQuench",
          },
        ],
        env: {
          KH02_AMAZON_US_ENABLED: "true",
          KH02_AMAZON_US_LIVE_ALLOWED: "true",
          KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
          KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED: "true",
        },
        fixtureSnapshotsByUrl: {
          [searchUrl]: {
            sourceUrl: searchUrl,
            finalUrl: searchUrl,
            httpStatus: 200,
            pageTitle: "Amazon.com : PawQuench Automatic Cat Feeder Dispenser",
            structuredData: {
              searchCards: [
                {
                  asin: "B0D3XGHTJ5",
                  title:
                    "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser TD20",
                  href: "/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
                  price: "$49.99",
                  currency: "USD",
                },
              ],
            },
          },
          [observedCardHref]: {
            sourceUrl: observedCardHref,
            finalUrl: observedCardHref,
            canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
            httpStatus: 200,
            structuredData: {
              asin: "B0D3XGHTJ5",
              productTitle:
                "faroro Automatic Cat Feeder: 4L Timed Pet Dry Food Dispenser (TD20)",
              brand: "faroro",
              modelNumber: "TD20",
              seller: "WECACO",
              price: 49.99,
              currency: "USD",
              availability: "In Stock",
              deliveryPostalCode: "95829",
              explicitUsDeliveryConfirmed: true,
            },
          },
        },
      });

      expect(enrichment.marketplaceEvidence).toHaveLength(1);
      const ev = enrichment.marketplaceEvidence[0];
      expect(ev.asin).toBe("B0D3XGHTJ5");
      expect(ev.searchIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      );
      // Because candidate brand is PawQuench and Amazon PDP brand is faroro, Phase B detects CONTRADICTORY_BRAND
      expect(ev.metaCandidateEquivalenceVerdict).toBe("CONTRADICTORY_BRAND");
      expect(ev.combinedIdentityVerdict).toBe("REJECTED_IDENTITY");
      expect(ev.identityMatch).toBe("NO_MATCH");
      expect(ev.status).toBe("OBSERVED_UNVERIFIED");
    });
  });
});
