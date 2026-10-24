import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock public research page fetch to provide controlled, deterministic HTML fixture
vi.mock("@/services/links/linkValidationService", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchPublicResearchPage: vi.fn().mockResolvedValue({
      originalUrl: "https://cc.uprootclean.com/main/phr",
      finalUrl: "https://cc.uprootclean.com/main/phr",
      httpStatus: 200,
      statusClassification: "SUCCESS",
      content: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Unified Journey Clean - Ultimate Pet Hair Cleaner Pro</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Ultimate Pet Hair Cleaner Pro",
                "offers": {
                  "@type": "Offer",
                  "price": "29.99",
                  "priceCurrency": "USD"
                }
              }
            </script>
          </head>
          <body>
            <h1>Ultimate Pet Hair Cleaner Pro</h1>
            <div class="product-price">$29.99</div>
            <button class="add-to-cart">Get Yours Now</button>
            <p>Free 2-day delivery across the United States</p>
          </body>
        </html>
      `,
      contentLengthBytes: 750,
      headers: { "content-type": "text/html; charset=utf-8" },
      isTruncated: false,
      contentType: "text/html",
      durationMs: 15,
    }),
  };
});

import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "../e2e/helpers/startSwaiTestServer";
import { verifyHttpServerReadback } from "../../scripts/kh01/verifyHttpServerReadback";
import { runBrowserE2E } from "../../scripts/kh01/runBrowserE2E";
import { createLandingPageResearchJob } from "@/services/research/landingPageInspectionService";
import {
  claimPendingKh01Job,
  executeKh01Job,
  ClaimedKh01Job,
} from "@/workers/kh01Worker";
import {
  buildProductOpportunityInput,
  calculateOpportunityAssessment,
  saveProductOpportunityAssessment,
} from "@/services/research/opportunityAssessmentService";
import { ResearchAccessContext } from "@/services/research/researchAuthService";

describe("KH-01 Checkpoint 6: Unified Continuous Research Journey (Queue -> Worker -> DB -> HTTP -> Browser)", () => {
  let dbHandle: TestDatabaseHandle;
  let serverHandle: SwaiTestServerHandle;
  let previousTestDbUrl: string | undefined;

  const adminSecret = "kh01_unified_secret_998811";
  const workspaceId = "ws_kh01_unified_journey";
  const productId = "prod_unified_journey_1";
  const adId = "ad_unified_journey_1";
  const targetUrl = "https://cc.uprootclean.com/main/phr";

  const authContext: ResearchAccessContext = {
    actorId: "unified_tester",
    workspaceId,
    accessMode: "AUTHENTICATED",
  };

  let queuedJobId: string;
  let claimedJob: ClaimedKh01Job;
  let createdLandingSnapshotId: string;
  let createdOfferSnapshotId: string;
  let createdEvidenceIds: string[] = [];

  beforeAll(async () => {
    // 1. Create completely isolated test database
    dbHandle = await createIsolatedTestDatabase({ prefix: "unified-journey" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    const prisma = dbHandle.prisma;

    // 2. Seed baseline product identity and advertisement records (NO PRESEEDED SNAPSHOTS!)
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Unified Journey Workspace",
      },
    });

    const watchlist = await prisma.watchlist.create({
      data: {
        id: `wl_${workspaceId}`,
        workspaceId,
        name: "Unified Journey Watchlist",
      },
    });

    const ds = await prisma.dataSource.create({
      data: {
        name: "META_UNIFIED_JOURNEY",
        displayName: "Meta Unified Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "Unified Journey Brand",
        domain: "uprootclean.com",
      },
    });

    const store = await prisma.competitorStore.create({
      data: {
        domain: "uprootclean.com",
        storeName: "Uproot Clean Store",
        advertiserId: adv.id,
      },
    });

    await prisma.competitorAd.create({
      data: {
        id: adId,
        externalAdId: "ext_unified_ad_12345",
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=ext_unified_ad_12345",
        landingPageUrl: targetUrl,
        headline: "Ultimate Pet Hair Cleaner Pro",
        advertiserId: adv.id,
        dataSourceId: ds.id,
        firstSeenAt: new Date("2026-10-01T00:00:00Z"),
        lastSeenAt: new Date("2026-10-24T00:00:00Z"),
      },
    });

    const product = await prisma.researchProduct.create({
      data: {
        id: productId,
        title: "Ultimate Pet Hair Cleaner Pro",
        currentPrice: 29.99,
        currency: "USD",
        storeId: store.id,
      },
    });

    await prisma.watchlistItem.create({
      data: { watchlistId: watchlist.id, productId: product.id, itemType: "PRODUCT" },
    });
    await prisma.watchlistItem.create({
      data: { watchlistId: watchlist.id, adId, itemType: "AD" },
    });

    await prisma.adProductLink.create({
      data: {
        productId: product.id,
        adId,
        confidence: "CONFIRMED",
      },
    });
  }, 45000);

  afterAll(async () => {
    if (serverHandle) {
      await serverHandle.stop();
    }
    if (previousTestDbUrl) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    }
    if (dbHandle) {
      await dbHandle.teardown();
    }
  });

  it("Step 1: Queues a real research job through the production service", async () => {
    const jobReceipt = await createLandingPageResearchJob(
      {
        productId,
        adId,
        targetUrl,
        forceRefresh: true,
      },
      authContext
    );

    expect(jobReceipt).toBeDefined();
    expect(jobReceipt.jobId).toBeDefined();
    expect(jobReceipt.status).toBe("QUEUED");

    queuedJobId = jobReceipt.jobId;

    const jobInDb = await dbHandle.prisma.syncJob.findUnique({
      where: { id: queuedJobId },
    });
    expect(jobInDb).not.toBeNull();
    expect(jobInDb?.status).toBe("PENDING");
  });

  it("Step 2: Claims the queued job using the production worker with valid fencing and token", async () => {
    const claim = await claimPendingKh01Job("unified-journey-worker-1");

    expect(claim).not.toBeNull();
    expect(claim?.id).toBe(queuedJobId);
    expect(claim?.workerId).toBe("unified-journey-worker-1");
    expect(claim?.claimToken).toBeDefined();
    expect(claim?.attemptNumber).toBe(1);

    claimedJob = claim!;

    const jobInDb = await dbHandle.prisma.syncJob.findUnique({
      where: { id: queuedJobId },
    });
    expect(jobInDb?.status).toBe("RUNNING");
  });

  it("Step 3: Executes the research job via production worker and persists real snapshots", async () => {
    const result = await executeKh01Job(claimedJob);

    expect(result.status).toBe("COMPLETED");
    expect(result.snapshotId).toBeDefined();

    createdLandingSnapshotId = result.snapshotId!;

    // Assert that a real LandingPageSnapshot was persisted by the worker
    const landingInDb = await dbHandle.prisma.landingPageSnapshot.findUnique({
      where: { id: createdLandingSnapshotId },
    });
    expect(landingInDb).not.toBeNull();
    expect(landingInDb?.productId).toBe(productId);
    expect(landingInDb?.httpStatus).toBe(200);
    expect(landingInDb?.accessStatus).toBe("SUCCESS");

    // Assert that a CompetitorOfferSnapshot was persisted by the worker with extracted values
    const offerInDb = await dbHandle.prisma.competitorOfferSnapshot.findFirst({
      where: { productId },
      orderBy: { observedAt: "desc" },
    });
    expect(offerInDb).not.toBeNull();
    expect(offerInDb?.sellingPrice).toBe(29.99);
    expect(offerInDb?.currency).toBe("USD");
    createdOfferSnapshotId = offerInDb!.id;

    // Assert that ResearchEvidence records were persisted
    const evidenceInDb = await dbHandle.prisma.researchEvidence.findMany({
      where: { productId },
    });
    expect(evidenceInDb.length).toBeGreaterThan(0);
    createdEvidenceIds = evidenceInDb.map((e) => e.id);

    // Verify terminal SyncJob status
    const finalizedJob = await dbHandle.prisma.syncJob.findUnique({
      where: { id: queuedJobId },
    });
    expect(finalizedJob?.status).toBe("COMPLETED");
    expect(finalizedJob?.progress).toBe(100);
  });

  it("Step 4: Starts the real Next.js server on loopback against the same database", async () => {
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      adminApiKey: adminSecret,
      mode: "production",
      timeoutMs: 30000,
    });

    expect(serverHandle.baseUrl).toBeDefined();

    const healthRes = await fetch(`${serverHandle.baseUrl}/api/v1/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.success).toBe(true);
  });

  it("Step 5: Verifies exact snapshot IDs through real HTTP API readback over TCP", async () => {
    const httpReadback = await verifyHttpServerReadback({
      baseUrl: serverHandle.baseUrl,
      productId,
      jobId: queuedJobId,
      workspaceId,
      expectedLandingSnapshotId: createdLandingSnapshotId,
      expectedOfferSnapshotId: createdOfferSnapshotId,
      expectedEvidenceIds: createdEvidenceIds,
      auth: { token: adminSecret, workspaceId },
    });

    expect(httpReadback.verified).toBe(true);
    expect(httpReadback.productIdVerified).toBe(true);
    expect(httpReadback.jobIdVerified).toBe(true);
    expect(httpReadback.snapshotIdsVerified).toBe(true);
    expect(httpReadback.authorizationVerified).toBe(true);
    expect(httpReadback.errors.length).toBe(0);
  });

  it("Step 6: Navigates Chromium browser to Product Intelligence and validates UI displays worker data", async () => {
    // Generate an initial assessment so the 6 pillars are visible in the UI
    const sixPillarInput = await buildProductOpportunityInput(productId, authContext);
    const oppAssessment = calculateOpportunityAssessment(sixPillarInput);
    await saveProductOpportunityAssessment(productId, oppAssessment, authContext);

    const browserRes = await runBrowserE2E({
      baseUrl: serverHandle.baseUrl,
      productId,
      workspaceId,
      adminApiKey: adminSecret,
      headless: true,
    });

    expect(browserRes.verified).toBe(true);
    expect(browserRes.productHeaderVerified).toBe(true);
    expect(browserRes.pillarsVerified).toBe(true);
    expect(browserRes.offerPanelVerified).toBe(true);
    expect(browserRes.landingPagePanelVerified).toBe(true);
    expect(browserRes.decisionPersistedVerified).toBe(true);
    expect(browserRes.errors.length).toBe(0);
  }, 25000);

  it("Step 7: Enforces economic gating and persists human research decision", async () => {
    const input = await buildProductOpportunityInput(productId, authContext);
    const assessment = calculateOpportunityAssessment(input);

    // Missing supplier cost must block TEST_CANDIDATE
    expect(assessment.recommendation).toBe("RESEARCH_MORE");
    expect(assessment.missingCriticalEvidence.length).toBeGreaterThan(0);

    // Persist human research decision
    const decision = await dbHandle.prisma.researchDecision.create({
      data: {
        productId,
        adId,
        decision: "RESEARCH_MORE",
        notes: "Gated due to missing supplier cost and fulfillment reliability in unified journey test",
      },
    });

    expect(decision.id).toBeDefined();

    // Verify persistence across independent database readback
    const persisted = await dbHandle.prisma.researchDecision.findUnique({
      where: { id: decision.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.decision).toBe("RESEARCH_MORE");
  });

  it("Step 8: Verifies replay safety (no duplicate snapshots on re-executing completed job)", async () => {
    const initialLandingCount = await dbHandle.prisma.landingPageSnapshot.count({
      where: { productId },
    });
    const initialOfferCount = await dbHandle.prisma.competitorOfferSnapshot.count({
      where: { productId },
    });

    // Replay execution of already completed job
    await executeKh01Job(claimedJob);

    const postLandingCount = await dbHandle.prisma.landingPageSnapshot.count({
      where: { productId },
    });
    const postOfferCount = await dbHandle.prisma.competitorOfferSnapshot.count({
      where: { productId },
    });

    expect(postLandingCount).toBe(initialLandingCount);
    expect(postOfferCount).toBe(initialOfferCount);
  });
});
