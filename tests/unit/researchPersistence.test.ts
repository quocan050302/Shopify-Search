/**
 * KH-01 Checkpoint 4 — Transactional & Idempotent Research Persistence Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  persistCompletedResearchResult,
  ParsedResearchPayload,
} from "@/services/research/researchResultPersistenceService";
import { saveLandingPageSnapshot } from "@/services/research/landingPageSnapshotService";
import { ClaimedKh01Job } from "@/workers/kh01Worker";

describe("KH-01 Checkpoint 4 — Research Result Persistence & Atomicity", () => {
  const TEST_WORKSPACE = "ws_test_persistence";
  const TEST_PRODUCT_ID = "prod_persist_01";
  const TEST_JOB_ID_1 = "job_persist_01";
  const TEST_JOB_ID_2 = "job_persist_02";

  beforeEach(async () => {
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.watchlistItem.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.watchlist.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.researchProduct.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });

    await prisma.workspace.create({
      data: { id: TEST_WORKSPACE, name: "Persistence Test Workspace" },
    });

    await prisma.researchProduct.create({
      data: {
        id: TEST_PRODUCT_ID,
        title: "Test Persistence Product",
      },
    });

    const watchlist = await prisma.watchlist.create({
      data: {
        id: "wl_test_persistence",
        workspaceId: TEST_WORKSPACE,
        name: "Test Watchlist",
      },
    });

    await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        productId: TEST_PRODUCT_ID,
        itemType: "PRODUCT",
      },
    });
  });

  afterEach(async () => {
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.watchlistItem.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.watchlist.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.researchProduct.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });
  });

  it("persists research result atomically, linking snapshots, evidence, and completed job", async () => {
    // 1. Create running job with active lease
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_persist_1",
          claimToken: "token_persist_123",
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          targetUrl: "https://example.com/product/xyz",
        }),
      },
    });

    const claim: ClaimedKh01Job = {
      id: TEST_JOB_ID_1,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_persist_1",
      claimToken: "token_persist_123",
      attemptNumber: 1,
    };

    const payload: ParsedResearchPayload = {
      workspaceId: TEST_WORKSPACE,
      productId: TEST_PRODUCT_ID,
      adId: null,
      originalUrl: "https://example.com/product/xyz",
      finalUrl: "https://example.com/product/xyz",
      httpStatus: 200,
      accessStatus: "SUCCESS",
      pageTitle: "Example Product Store",
      metaDescription: "The best product store",
      htmlContent: "<html><body>...</body></html>",
      normalizedOffer: {
        productId: TEST_PRODUCT_ID,
        storeId: null,
        adId: null,
        sourceUrl: "https://example.com/product/xyz",
        finalUrl: "https://example.com/product/xyz",
        sellingPrice: 29.99,
        compareAtPrice: 49.99,
        currency: "USD",
        bundleQuantity: 1,
        effectivePricePerUnit: 29.99,
        hasFreeShipping: true,
        freeShippingThreshold: 50,
        availability: "IN_STOCK",
        promotions: [],
        structuredVariants: [],
        conflicts: [],
        warnings: [],
      },
      funnelAssessment: {
        structure: {
          hasHeroSection: true,
          heroHeadline: "Experience Quality",
          primaryCtaText: "Buy Now",
          hasCustomerReviews: true,
          hasVisiblePriceNearCta: true,
          hasShippingPolicySummary: true,
          hasReturnPolicySummary: true,
          hasFaqSection: false,
          hasGuarantees: true,
          hasStickyCta: false,
          trustBadges: [],
          shippingHighlights: [],
          guaranteeHighlights: [],
        },
        messageMatch: null,
        croReadiness: {
          score: 85,
          tier: "OPTIMIZED",
          strengths: ["Clear CTA", "Visible Price"],
          weaknesses: [],
          criticalGaps: [],
        },
        warnings: [],
      },
      warnings: [],
    };

    const result = await persistCompletedResearchResult(claim, payload);

    expect(result.status).toBe("COMPLETED");
    expect(result.snapshotId).toBeDefined();
    expect(result.offerSnapshotId).toBeDefined();
    expect(result.sellingPrice).toBe(29.99);
    expect(result.currency).toBe("USD");
    expect(result.evidenceIds.length).toBeGreaterThan(0);

    // Verify DB records
    const landingInDb = await prisma.landingPageSnapshot.findUnique({
      where: { id: result.snapshotId! },
    });
    expect(landingInDb).not.toBeNull();
    expect(landingInDb?.workspaceId).toBe(TEST_WORKSPACE);
    expect(landingInDb?.productId).toBe(TEST_PRODUCT_ID);
    expect(landingInDb?.httpStatus).toBe(200);

    const offerInDb = await prisma.competitorOfferSnapshot.findUnique({
      where: { id: result.offerSnapshotId! },
    });
    expect(offerInDb).not.toBeNull();
    expect(offerInDb?.sellingPrice).toBe(29.99);

    const jobInDb = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_1 } });
    expect(jobInDb?.status).toBe("COMPLETED");
    expect(jobInDb?.progress).toBe(100);

    // Replay / Idempotency test: Persisting same job returns existing result without duplicating records
    const replay = await persistCompletedResearchResult(claim, payload);
    expect(replay.isIdempotentReplay).toBe(true);
    expect(replay.snapshotId).toBe(result.snapshotId);
    expect(replay.offerSnapshotId).toBe(result.offerSnapshotId);

    // Count records to confirm no duplicates created
    const landingCount = await prisma.landingPageSnapshot.count({
      where: { workspaceId: TEST_WORKSPACE },
    });
    expect(landingCount).toBe(1);
  });

  it("handles ACCESS_RESTRICTED source truthfully with ACCESS_RESTRICTED job status", async () => {
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_2,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_persist_2",
          claimToken: "token_persist_456",
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          targetUrl: "https://blocked.example.com",
        }),
      },
    });

    const claim: ClaimedKh01Job = {
      id: TEST_JOB_ID_2,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_persist_2",
      claimToken: "token_persist_456",
      attemptNumber: 1,
    };

    const payload: ParsedResearchPayload = {
      workspaceId: TEST_WORKSPACE,
      productId: TEST_PRODUCT_ID,
      adId: null,
      originalUrl: "https://blocked.example.com",
      finalUrl: "https://blocked.example.com",
      httpStatus: 403,
      accessStatus: "ACCESS_RESTRICTED",
      pageTitle: null,
      metaDescription: null,
      htmlContent: null,
      normalizedOffer: null,
      funnelAssessment: null,
      warnings: ["Cloudflare 403 Forbidden"],
      errorMessage: "Access restricted by destination Cloudflare challenge.",
    };

    const result = await persistCompletedResearchResult(claim, payload);

    expect(result.status).toBe("ACCESS_RESTRICTED");
    expect(result.snapshotId).not.toBeNull();
    expect(result.offerSnapshotId).toBeNull();

    // Verify DB: job status must be ACCESS_RESTRICTED, NEVER falsely COMPLETED
    const jobInDb = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_2 } });
    expect(jobInDb?.status).toBe("ACCESS_RESTRICTED");
    expect(jobInDb?.errorMessage).toContain("Cloudflare");
  });

  it("saveLandingPageSnapshot rejects missing workspaceId fail-closed", async () => {
    await expect(
      saveLandingPageSnapshot({
        workspaceId: "" as any,
        originalUrl: "https://example.com",
        httpStatus: 200,
        accessStatus: "SUCCESS",
        structure: {} as any,
        croSignals: {} as any,
      })
    ).rejects.toThrow(/explicit, authorized workspaceId/i);
  });

  it("contentHash incorporates observed price changes", async () => {
    const snap1 = await saveLandingPageSnapshot({
      workspaceId: TEST_WORKSPACE,
      originalUrl: "https://example.com/item",
      httpStatus: 200,
      accessStatus: "SUCCESS",
      pageTitle: "Product Title",
      observedPrice: 19.99,
      currency: "USD",
      structure: {
        hasHeroSection: true,
        heroHeadline: "Headline",
        primaryCtaText: "Buy",
        hasCustomerReviews: false,
        hasVisiblePriceNearCta: true,
        hasShippingPolicySummary: false,
        hasReturnPolicySummary: false,
        hasFaqSection: false,
        hasGuarantees: false,
        hasStickyCta: false,
        trustBadges: [],
        shippingHighlights: [],
        guaranteeHighlights: [],
      },
      croSignals: {} as any,
    });

    const snap2 = await saveLandingPageSnapshot({
      workspaceId: TEST_WORKSPACE,
      originalUrl: "https://example.com/item",
      httpStatus: 200,
      accessStatus: "SUCCESS",
      pageTitle: "Product Title",
      observedPrice: 24.99, // Changed price
      currency: "USD",
      structure: {
        hasHeroSection: true,
        heroHeadline: "Headline",
        primaryCtaText: "Buy",
        hasCustomerReviews: false,
        hasVisiblePriceNearCta: true,
        hasShippingPolicySummary: false,
        hasReturnPolicySummary: false,
        hasFaqSection: false,
        hasGuarantees: false,
        hasStickyCta: false,
        trustBadges: [],
        shippingHighlights: [],
        guaranteeHighlights: [],
      },
      croSignals: {} as any,
    });

    // Hash must differ because price changed from 19.99 to 24.99
    expect(snap1.contentHash).not.toBe(snap2.contentHash);
  });
});
