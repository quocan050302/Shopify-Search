import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "../e2e/helpers/startSwaiTestServer";
import { runBrowserE2E } from "../../scripts/kh01/runBrowserE2E";

describe("KH-01 Checkpoint 3: Real Headless Browser Acceptance", () => {
  let dbHandle: TestDatabaseHandle;

  let serverHandle: SwaiTestServerHandle;
  const adminSecret = "kh01_browser_e2e_secret_112233";
  const workspaceId = "ws_kh01_browser_e2e";
  const productAId = "prod_browser_alpha";
  const productBId = "prod_browser_beta";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "browser-e2e" });
    const prisma = dbHandle.prisma;

    // 1. Workspace
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Browser E2E Workspace",
      },
    });

    const watchlist = await prisma.watchlist.create({
      data: {
        id: `wl_${workspaceId}`,
        workspaceId,
        name: "Browser E2E Watchlist",
      },
    });

    // 2. Data source & Advertiser
    const ds = await prisma.dataSource.create({
      data: {
        name: "META_BROWSER_E2E",
        displayName: "Meta Browser Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "Browser Alpha Brand",
        domain: "alpha.example.com",
      },
    });

    // 3. Store
    const store = await prisma.competitorStore.create({
      data: {
        domain: "alpha.example.com",
        storeName: "Alpha Store",
        advertiserId: adv.id,
        commercePlatform: "SHOPIFY_CONFIRMED",
      },
    });


    // 4. Competitor Ad
    const ad = await prisma.competitorAd.create({
      data: {
        id: "ad_browser_alpha",
        externalAdId: "ext_browser_alpha_123",
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=ext_browser_alpha_123",
        landingPageUrl: "https://alpha.example.com/product-alpha",
        headline: "Alpha Ultrasonic Cleaner Pro",
        advertiserId: adv.id,
        dataSourceId: ds.id,
      },
    });

    // 5. Product A
    const productA = await prisma.researchProduct.create({
      data: {
        id: productAId,
        title: "Alpha Ultrasonic Cleaner Pro",
        category: "Electronics",
        currentPrice: 59.99,
        currency: "USD",
        productUrl: "https://alpha.example.com/product-alpha",
        storeId: store.id,
      },
    });

    // 6. Product B (for switching test)
    const productB = await prisma.researchProduct.create({
      data: {
        id: productBId,
        title: "Beta Ergonomic Memory Pillow",
        category: "Home & Garden",
        currentPrice: 39.99,
        currency: "USD",
        productUrl: "https://beta.example.com/pillow",
      },
    });

    // Watchlist links
    await prisma.watchlistItem.create({
      data: { watchlistId: watchlist.id, productId: productA.id, itemType: "PRODUCT" },
    });
    await prisma.watchlistItem.create({
      data: { watchlistId: watchlist.id, productId: productB.id, itemType: "PRODUCT" },
    });
    await prisma.watchlistItem.create({
      data: { watchlistId: watchlist.id, adId: ad.id, itemType: "AD" },
    });

    // Ad Link
    await prisma.adProductLink.create({
      data: {
        productId: productA.id,
        adId: ad.id,
        confidence: "CONFIRMED",
      },
    });

    // Snapshots for Product A
    await prisma.landingPageSnapshot.create({
      data: {
        id: "snap_browser_landing",
        productId: productA.id,
        originalUrl: "https://alpha.example.com/product-alpha",
        finalUrl: "https://alpha.example.com/product-alpha",
        httpStatus: 200,
        accessStatus: "SUCCESS",
        contentHash: "hash_browser_alpha_landing",
        observationsJson: JSON.stringify({
          hero: { title: "Alpha Cleaner - Clean Anything In Seconds" },
          cta: { text: "Order Now - 50% Off" },
        }),
        croSignalsJson: JSON.stringify({
          trustSignals: ["30-Day Money Back Guarantee", "Over 10,000 Happy Customers"],
          socialProofPresent: true,
        }),
      },
    });

    await prisma.competitorOfferSnapshot.create({
      data: {
        id: "snap_browser_offer",
        productId: productA.id,
        sourceUrl: "https://alpha.example.com/product-alpha",
        sellingPrice: 59.99,
        compareAtPrice: 119.98,
        currency: "USD",
        offerDataJson: JSON.stringify({
          discountPercent: 50,
          bundleOptions: [{ quantity: 1, price: 59.99 }, { quantity: 2, price: 99.99 }],
        }),
        evidenceJson: JSON.stringify({ method: "STOREFRONT_HTTP" }),
        snapshotHash: "hash_browser_alpha_offer",
      },
    });

    // Initial Opportunity Assessment
    await prisma.productOpportunityAssessment.create({
      data: {
        productId: productA.id,
        opportunityScore: 78,
        evidenceReadinessScore: 82,
        recommendation: "RESEARCH_MORE",
        recommendationRationale: "Promising creative and observed offer, but supplier cost unverified.",
        testReadinessStatus: "BLOCKED_MISSING_DATA",
        pillarsJson: JSON.stringify({
          productScore: 80,
          creativeScore: 75,
          offerScore: 85,
          landingPageScore: 80,
          economicsScore: 70,
          fulfillmentScore: 65,
        }),
        strengthsJson: JSON.stringify(["High visual demonstration hook", "Confirmed Shopify checkout"]),
        risksJson: JSON.stringify(["Unverified supplier unit economics"]),
        missingCriticalEvidenceJson: JSON.stringify(["Authentic supplier quote needed"]),
      },
    });


    // Start Next.js Test Server
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

  it("executes full real browser E2E session and validates Product Intelligence UI", async () => {
    const result = await runBrowserE2E({
      baseUrl: serverHandle.baseUrl,
      productId: productAId,
      secondProductId: productBId,
      workspaceId,
      adminApiKey: adminSecret,
      headless: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.productHeaderVerified).toBe(true);
    expect(result.pillarsVerified).toBe(true);
    expect(result.offerPanelVerified).toBe(true);
    expect(result.landingPagePanelVerified).toBe(true);
    expect(result.economicsFormVerified).toBe(true);
    expect(result.decisionPersistedVerified).toBe(true);
    expect(result.productSwitchingVerified).toBe(true);
    expect(result.screenshots.length).toBeGreaterThanOrEqual(4);

    for (const shot of result.screenshots) {
      expect(fs.existsSync(shot)).toBe(true);
      expect(fs.statSync(shot).size).toBeGreaterThan(1000); // Verify non-empty screenshot
    }
  }, 45000);
});
