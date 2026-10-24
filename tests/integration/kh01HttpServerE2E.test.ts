import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "../e2e/helpers/startSwaiTestServer";
import { verifyHttpServerReadback } from "../../scripts/kh01/verifyHttpServerReadback";

describe("KH-01 Checkpoint 1: Real HTTP Server Acceptance", () => {
  let dbHandle: TestDatabaseHandle;

  let serverHandle: SwaiTestServerHandle;
  const adminSecret = "kh01_http_e2e_secret_998877";
  const workspaceId = "ws_kh01_http_e2e";
  const productId = "prod_http_e2e_test";
  const jobId = "job_http_e2e_test";
  const landingSnapshotId = "snap_http_e2e_landing";
  const offerSnapshotId = "snap_http_e2e_offer";

  beforeAll(async () => {
    // 1. Initialize isolated SQLite database
    dbHandle = await createIsolatedTestDatabase({ prefix: "http-server-e2e" });

    // 2. Seed minimal records required for research overview and job status
    const prisma = dbHandle.prisma;

    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "HTTP Acceptance Workspace",
      },
    });

    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "HTTP E2E Brand",
        domain: "httpe2e.example.com",
      },
    });

    const ds = await prisma.dataSource.create({
      data: {
        name: "META_HTTP_E2E",
        displayName: "Meta E2E Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });



    const ad = await prisma.competitorAd.create({
      data: {
        id: "ad_http_e2e_1",
        externalAdId: "ext_http_e2e_1",
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=ext_http_e2e_1",
        landingPageUrl: "https://httpe2e.example.com/product",
        headline: "Real HTTP Acceptance Ad",
        advertiserId: adv.id,
        dataSourceId: ds.id,
      },
    });

    const product = await prisma.researchProduct.create({
      data: {
        id: productId,
        title: "Real HTTP Verified Product",
        currentPrice: 49.99,
        currency: "USD",
      },
    });




    const watchlist = await prisma.watchlist.create({
      data: {
        id: `wl_${workspaceId}`,
        workspaceId,
        name: "HTTP E2E Watchlist",
      },
    });

    await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        productId: product.id,
        itemType: "PRODUCT",
      },
    });

    await prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        adId: ad.id,
        itemType: "AD",
      },
    });

    await prisma.adProductLink.create({
      data: {
        productId: product.id,
        adId: ad.id,
        confidence: "HIGH_CONFIDENCE",
      },
    });


    // Create research job
    await prisma.syncJob.create({
      data: {
        id: jobId,
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "COMPLETED",
        progress: 100,
        resultJson: JSON.stringify({
          workerId: "kh01-http-test-worker",
          claimToken: "token_http_e2e",
          snapshotId: landingSnapshotId,
          targetUrl: "https://httpe2e.example.com/product",
          attemptNumber: 1,
        }),
      },
    });

    // Create landing snapshot
    await prisma.landingPageSnapshot.create({
      data: {
        id: landingSnapshotId,
        productId: product.id,
        originalUrl: "https://httpe2e.example.com/product",
        finalUrl: "https://httpe2e.example.com/product",
        httpStatus: 200,
        accessStatus: "SUCCESS",
        contentHash: "hash_http_e2e_landing",
        observationsJson: JSON.stringify({ hero: { title: "Real HTTP Hero" } }),
        croSignalsJson: JSON.stringify({ ctaPresent: true }),
      },
    });

    // Create offer snapshot
    await prisma.competitorOfferSnapshot.create({
      data: {
        id: offerSnapshotId,
        productId: product.id,
        sourceUrl: "https://httpe2e.example.com/product",
        sellingPrice: 49.99,
        currency: "USD",
        offerDataJson: JSON.stringify({ price: 49.99 }),
        evidenceJson: JSON.stringify({ method: "STOREFRONT_HTTP" }),
        snapshotHash: "hash_http_e2e_offer",
      },
    });


    // 3. Start real Next.js server against isolated DB
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      adminApiKey: adminSecret,
      mode: "production",
      timeoutMs: 30000,
    });
  }, 45000);

  afterAll(async () => {
    if (serverHandle) {
      await serverHandle.stop();
    }
    if (dbHandle) {
      await dbHandle.teardown();
    }
  });

  it("verifies health check over actual HTTP transport", async () => {
    const res = await fetch(`${serverHandle.baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects unauthorized HTTP requests (negative authentication)", async () => {
    // 1. Missing credentials -> 401
    const missingRes = await fetch(
      `${serverHandle.baseUrl}/api/v1/research/products/${productId}/overview`,
      {
        headers: {
          "x-workspace-id": workspaceId,
        },
      }
    );
    expect(missingRes.status).toBe(401);

    // 2. Invalid credentials -> 403
    const invalidRes = await fetch(
      `${serverHandle.baseUrl}/api/v1/research/products/${productId}/overview`,
      {
        headers: {
          "x-workspace-id": workspaceId,
          Authorization: "Bearer completely_invalid_token",
        },
      }
    );
    expect(invalidRes.status).toBe(403);
  });


  it("successfully reads back product overview and reconciles snapshots via actual HTTP", async () => {
    const result = await verifyHttpServerReadback({
      baseUrl: serverHandle.baseUrl,
      productId,
      jobId,
      workspaceId,
      expectedLandingSnapshotId: landingSnapshotId,
      expectedOfferSnapshotId: offerSnapshotId,
      auth: {
        adminApiKey: adminSecret,
        workspaceId,
      },
    });

    expect(result.verified).toBe(true);
    expect(result.transport).toBe("ACTUAL_HTTP");
    expect(result.productIdVerified).toBe(true);
    expect(result.jobIdVerified).toBe(true);
    expect(result.snapshotIdsVerified).toBe(true);
    expect(result.authorizationVerified).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.requests.length).toBeGreaterThanOrEqual(3); // negative auth, overview, job status
  });
});
