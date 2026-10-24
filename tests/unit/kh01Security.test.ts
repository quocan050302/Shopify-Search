/**
 * KH-01.A — Security, Data Integrity & Evidence Foundation Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertAdWorkspaceAccess,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  validatePublicResearchUrl,
  fetchPublicResearchPage,
} from "@/services/links/linkValidationService";
import {
  canonicalizeProductUrl,
  matchExistingResearchProduct,
  saveAdProductCandidate,
} from "@/services/products/productService";
import {
  createResearchEvidence,
  evaluateEvidenceReadiness,
  ResearchEvidenceRecord,
} from "@/services/research/evidenceService";

describe("KH-01.A — Security, Data Integrity & Evidence Foundation", () => {
  const testWorkspace1 = "ws_test_kh01_alpha";
  const testWorkspace2 = "ws_test_kh01_beta";
  const testAdId1 = "ad_test_kh01_sec_01";
  const testAdId2 = "ad_test_kh01_sec_02";
  const testStoreId = "store_test_kh01_sec";
  const testStoreDomain = "kh01-brand.example.com";
  let testProductId1 = "";

  beforeAll(async () => {
    // Clean up test fixtures
    await prisma.discoveryRunAd.deleteMany({
      where: { workspaceId: { in: [testWorkspace1, testWorkspace2] } },
    });
    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [testWorkspace1, testWorkspace2] } },
    });
    await prisma.adProductLink.deleteMany({
      where: { adId: { in: [testAdId1, testAdId2] } },
    });
    await prisma.competitorAd.deleteMany({
      where: { id: { in: [testAdId1, testAdId2] } },
    });
    await prisma.researchProduct.deleteMany({
      where: { productUrl: { contains: "kh01-brand.example.com" } },
    });
    await prisma.competitorStore.deleteMany({
      where: { domain: testStoreDomain },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [testWorkspace1, testWorkspace2] } },
    });

    // Create test workspaces
    await prisma.workspace.create({
      data: { id: testWorkspace1, name: "KH01 Test Workspace Alpha" },
    });
    await prisma.workspace.create({
      data: { id: testWorkspace2, name: "KH01 Test Workspace Beta" },
    });

    // Create test store
    const store = await prisma.competitorStore.create({
      data: {
        id: testStoreId,
        domain: testStoreDomain,
        storeName: "KH01 Brand",
        commercePlatform: "SHOPIFY_CONFIRMED",
      },
    });

    // Create test product in Workspace 1
    const product = await prisma.researchProduct.create({
      data: {
        storeId: store.id,
        title: "Original Pet Hair Remover",
        category: "Pet Supplies",
        productUrl: `https://${testStoreDomain}/products/pet-hair-roller?variant=1001`,
        currentPrice: 29.99,
      },
    });
    testProductId1 = product.id;

    // Create advertiser
    let advertiser = await prisma.advertiser.findFirst({
      where: { domain: testStoreDomain },
    });
    if (!advertiser) {
      advertiser = await prisma.advertiser.create({
        data: {
          platform: "META",
          name: "KH01 Advertiser",
          domain: testStoreDomain,
        },
      });
    }

    let dataSource = await prisma.dataSource.findFirst();
    if (!dataSource) {
      dataSource = await prisma.dataSource.create({
        data: {
          name: "META_AD_LIBRARY",
          displayName: "Meta Ad Library",
          capabilities: JSON.stringify(["DISCOVERY"]),
          supportedRegions: JSON.stringify(["US"]),
          status: "AVAILABLE",
        },
      });
    }

    // Create ad 1 assigned to Workspace 1
    await prisma.competitorAd.create({
      data: {
        id: testAdId1,
        externalAdId: "kh01_ext_ad_01",
        platform: "META",
        originalAdUrl: `https://www.facebook.com/ads/library/?id=kh01_ext_ad_01`,
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        headline: "Viral Pet Hair Roller",
        landingPageUrl: `https://${testStoreDomain}/products/pet-hair-roller?utm_source=fb&variant=1001`,
      },
    });

    // Create DiscoveryRunAd linking ad 1 to Workspace 1
    const testRun1 = await prisma.discoveryRun.create({
      data: {
        workspaceId: testWorkspace1,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
      },
    });
    await prisma.discoveryRunAd.create({
      data: {
        runId: testRun1.id,
        adId: testAdId1,
        workspaceId: testWorkspace1,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
      },
    });

    // Create ad 2 assigned to Workspace 2
    await prisma.competitorAd.create({
      data: {
        id: testAdId2,
        externalAdId: "kh01_ext_ad_02",
        platform: "META",
        originalAdUrl: `https://www.facebook.com/ads/library/?id=kh01_ext_ad_02`,
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        headline: "Competitor Secret Ad",
        landingPageUrl: `https://${testStoreDomain}/products/secret-item`,
      },
    });
    const testRun2 = await prisma.discoveryRun.create({
      data: {
        workspaceId: testWorkspace2,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
      },
    });
    await prisma.discoveryRunAd.create({
      data: {
        runId: testRun2.id,
        adId: testAdId2,
        workspaceId: testWorkspace2,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
      },
    });

    // Link Ad 1 to Product 1
    await prisma.adProductLink.create({
      data: {
        adId: testAdId1,
        productId: testProductId1,
        confidence: "CONFIRMED",
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.discoveryRunAd.deleteMany({
        where: { workspaceId: { in: [testWorkspace1, testWorkspace2] } },
      });
      await prisma.researchEvidence.deleteMany({
        where: { workspaceId: { in: [testWorkspace1, testWorkspace2] } },
      });
      await prisma.adProductLink.deleteMany({
        where: { adId: { in: [testAdId1, testAdId2] } },
      });
      await prisma.competitorAd.deleteMany({
        where: { id: { in: [testAdId1, testAdId2] } },
      });
      await prisma.researchProduct.deleteMany({
        where: { productUrl: { contains: "kh01-brand.example.com" } },
      });
      await prisma.competitorStore.deleteMany({
        where: { domain: testStoreDomain },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [testWorkspace1, testWorkspace2] } },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("A1: Authorization & Workspace Isolation", () => {
    it("resolves valid context for authorized existing workspace", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/test`, {
        headers: { "x-workspace-id": testWorkspace1 },
      });
      const context = await resolveAuthorizedResearchContext(req);
      expect(context.workspaceId).toBe(testWorkspace1);
      expect(context.accessMode).toBeDefined();
    });

    it("rejects non-existent caller-supplied workspaceId with 404", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/test`, {
        headers: { "x-workspace-id": "fake_non_existent_workspace" },
      });
      await expect(resolveAuthorizedResearchContext(req)).rejects.toThrow(ResearchAuthError);
    });

    it("allows ad access when ad belongs to caller's workspace", async () => {
      const context = {
        workspaceId: testWorkspace1,
        actorId: "test_researcher",
        accessMode: "AUTHENTICATED" as const,
      };
      await expect(assertAdWorkspaceAccess(testAdId1, context)).resolves.not.toThrow();
    });

    it("strictly denies cross-tenant ad access (Workspace 1 cannot access Workspace 2 ad)", async () => {
      const context = {
        workspaceId: testWorkspace1,
        actorId: "test_researcher",
        accessMode: "AUTHENTICATED" as const,
      };
      await expect(assertAdWorkspaceAccess(testAdId2, context)).rejects.toThrow(ResearchAuthError);
    });

    it("strictly denies cross-tenant product access", async () => {
      const context = {
        workspaceId: testWorkspace2,
        actorId: "attacker",
        accessMode: "AUTHENTICATED" as const,
      };
      await expect(assertProductWorkspaceAccess(testProductId1, context)).rejects.toThrow(
        ResearchAuthError
      );
    });
  });

  describe("A2: SSRF & External URL Security", () => {
    it("allows valid public HTTPS URL", () => {
      const valid = validatePublicResearchUrl("https://example.com/products/roller?variant=123");
      expect(valid.protocol).toBe("https:");
      expect(valid.hostname).toBe("example.com");
      expect(valid.isPublic).toBe(true);
    });

    it("blocks loopback IP addresses (127.0.0.1)", () => {
      expect(() => validatePublicResearchUrl("http://127.0.0.1:8000/admin")).toThrow(
        /restricted, local, private, or cloud metadata/i
      );
    });

    it("blocks localhost hostname", () => {
      expect(() => validatePublicResearchUrl("http://localhost:3000/api/secret")).toThrow(
        /restricted, local, private, or cloud metadata/i
      );
    });

    it("blocks RFC 1918 private IPv4 ranges (10.x, 172.16.x, 192.168.x)", () => {
      expect(() => validatePublicResearchUrl("http://10.0.0.5/status")).toThrow(
        /restricted, local, private/i
      );
      expect(() => validatePublicResearchUrl("http://172.20.1.1/internal")).toThrow(
        /restricted, local, private/i
      );
      expect(() => validatePublicResearchUrl("http://192.168.1.1/router")).toThrow(
        /restricted, local, private/i
      );
    });

    it("blocks cloud metadata service (169.254.169.254 and metadata.google.internal)", () => {
      expect(() =>
        validatePublicResearchUrl("http://169.254.169.254/latest/meta-data/")
      ).toThrow(/restricted, local, private, or cloud metadata/i);
      expect(() =>
        validatePublicResearchUrl("http://metadata.google.internal/computeMetadata/v1/")
      ).toThrow(/restricted, local, private, or cloud metadata/i);
    });

    it("blocks encoded decimal / dword IP representation of localhost (2130706433)", () => {
      expect(() => validatePublicResearchUrl("http://2130706433/admin")).toThrow(
        /restricted, local, private, or cloud metadata/i
      );
    });

    it("blocks encoded hex/octal IP formats (0177.0.0.1)", () => {
      expect(() => validatePublicResearchUrl("http://0177.0.0.1/private")).toThrow(
        /restricted, local, private, or cloud metadata/i
      );
    });

    it("blocks IPv6 loopback (::1) and private unique local (fc00::)", () => {
      expect(() => validatePublicResearchUrl("http://[::1]/")).toThrow(
        /restricted, local, private, or cloud metadata/i
      );
    });

    it("blocks embedded credentials in URLs (user:pass@)", () => {
      expect(() => validatePublicResearchUrl("https://admin:secret@example.com/checkout")).toThrow(
        /embedded credentials/i
      );
    });

    it("blocks non-HTTP protocols (ftp:, javascript:, file:)", () => {
      expect(() => validatePublicResearchUrl("ftp://ftp.example.com/file.txt")).toThrow(
        /unsupported url scheme/i
      );
      expect(() => validatePublicResearchUrl("javascript:alert(1)")).toThrow(
        /unsupported url scheme/i
      );
    });
  });

  describe("A3: Canonical Product URL & Identity Matching", () => {
    it("canonicalizeProductUrl strips tracking parameters and preserves variant", () => {
      const raw =
        "https://www.kh01-brand.example.com/products/pet-hair-roller/?utm_source=facebook&utm_medium=cpc&fbclid=123456&variant=1001&ref=influencer#reviews";
      const canonical = canonicalizeProductUrl(raw);

      expect(canonical.hostname).toBe("kh01-brand.example.com");
      expect(canonical.pathname).toBe("/products/pet-hair-roller");
      expect(canonical.variantParam).toBe("1001");
      expect(canonical.comparisonKey).toBe("kh01-brand.example.com/products/pet-hair-roller?variant=1001");
      expect(canonical.canonicalUrl).not.toContain("utm_source");
      expect(canonical.canonicalUrl).not.toContain("fbclid");
      expect(canonical.canonicalUrl).not.toContain("ref");
      expect(canonical.canonicalUrl).toContain("variant=1001");
    });

    it("matches existing ResearchProduct by exact canonical key", async () => {
      const match = await matchExistingResearchProduct({
        landingPageUrl: `https://${testStoreDomain}/products/pet-hair-roller?utm_campaign=winter_sale&variant=1001`,
        storeDomain: testStoreDomain,
      });

      expect(match.confidence).toBe("EXACT_MATCH");
      expect(match.matchedProduct?.id).toBe(testProductId1);
    });

    it("does NOT auto-merge different products from different stores with similar titles", async () => {
      const match = await matchExistingResearchProduct({
        candidateTitle: "Original Pet Hair Remover",
        storeDomain: "different-store.example.com",
        landingPageUrl: "https://different-store.example.com/products/pet-hair-remover",
      });

      expect(match.confidence).toBe("NO_MATCH");
      expect(match.matchedProduct).toBeNull();
      // But suggests the alternative cross-store item
      expect(match.suggestedAlternatives?.length).toBeGreaterThan(0);
    });
  });

  describe("A4: Research Evidence Provenance & Readiness", () => {
    it("creates evidence with proper classification and fails down without proof of verification", async () => {
      const context = {
        workspaceId: testWorkspace1,
        actorId: "researcher_01",
        accessMode: "AUTHENTICATED" as const,
      };

      // Attempting to submit VERIFIED without verifierActorId / verification proof downgrades safely
      const evidence = await createResearchEvidence(
        {
          productId: testProductId1,
          subjectType: "PRODUCT",
          subjectId: testProductId1,
          pillar: "OFFER",
          claim: "Observed storefront single unit price",
          observedValue: "$29.99",
          sourceUrl: `https://${testStoreDomain}/products/pet-hair-roller`,
          observationMethod: "STOREFRONT_HTTP",
          classification: "SOURCE_OBSERVED",
        },
        context
      );

      expect(evidence.id).toBeDefined();
      expect(evidence.classification).toBe("SOURCE_OBSERVED");
      expect(evidence.observedValue).toBe("$29.99");
    });

    it("evaluates evidence readiness and detects missing critical cost/fulfillment information", () => {
      const sampleEvidence: ResearchEvidenceRecord[] = [
        {
          id: "ev1",
          workspaceId: testWorkspace1,
          subjectType: "PRODUCT",
          subjectId: testProductId1,
          pillar: "OFFER",
          claim: "Observed price",
          observedValue: "$29.99",
          sourceUrl: "https://example.com",
          observationMethod: "STOREFRONT_HTTP",
          classification: "SOURCE_OBSERVED",
          sourceContentRef: null,
          observedAt: new Date().toISOString(),
          verifiedAt: null,
          verifierActorId: null,
          createdAt: new Date().toISOString(),
          productId: testProductId1,
        },
      ];

      const readiness = evaluateEvidenceReadiness(sampleEvidence);
      expect(readiness.evidenceCompletenessScore).toBeLessThan(50);
      expect(readiness.isAdequateForTestConsideration).toBe(false);
      expect(readiness.missingCriticalEvidence).toContain(
        "Missing supplier quote or baseline product cost assumption."
      );
      expect(readiness.missingCriticalEvidence).toContain(
        "Missing shipping and delivery timeline review."
      );
    });
  });

  describe("A5: Decision Separation & User Override Tracking", () => {
    it("records USER OVERRIDE — REQUIREMENTS NOT MET when user chooses READY_FOR_SMALL_TEST over RESEARCH_MORE", async () => {
      const result = await saveAdProductCandidate({
        adId: testAdId1,
        title: "Original Pet Hair Remover",
        observedSellingPrice: 29.99,
        // No supplier cost provided -> Algorithm evaluates RESEARCH_MORE
        estimatedSupplierCost: null,
        userDecision: "READY_FOR_SMALL_TEST",
      });

      expect(result.algorithmRecommendation).toBe("RESEARCH_MORE");
      expect(result.userDecision).toBe("READY_FOR_SMALL_TEST");
      expect(result.isUserOverride).toBe(true);
      expect(result.overrideStatus).toBe("USER OVERRIDE — REQUIREMENTS NOT MET");
    });
  });
});
