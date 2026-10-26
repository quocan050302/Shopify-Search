import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { chromium, Browser, BrowserContext } from "playwright-core";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "./helpers/startSwaiTestServer";
import { resolveChromeExecutablePath } from "../../scripts/kh01/runFullAcceptance";
import { collectExactRunBrowserAdIds } from "@/services/discovery/metaCollector/browserAdCollector";
import { reconcileExactAdIdSets } from "@/services/discovery/metaCollector/metaExactReconciliation";

describe("Ads Explorer Full Pagination E2E Verification (Section 25)", () => {
  let dbHandle: TestDatabaseHandle;
  let serverHandle: SwaiTestServerHandle;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  const testWorkspaceId = "ws_pagination_test";
  const run25Id = "run_pagination_25_ads";
  const adminApiKey = "pagination_test_admin_token";
  const outDir = path.resolve(process.cwd(), "artifacts/v11.6.1/pagination_test_evidence");

  const createdAdIds25: string[] = [];

  beforeAll(async () => {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Provision isolated SQLite database
    dbHandle = await createIsolatedTestDatabase({ prefix: "explorer-pagination" });
    const prisma = dbHandle.prisma;

    // 2. Seed workspace
    await prisma.workspace.create({
      data: {
        id: testWorkspaceId,
        name: "Pagination Test Workspace",
      },
    });

    // 3. Seed DataSource and Advertiser
    const ds = await prisma.dataSource.create({
      data: {
        name: "META_PAGINATION_TEST",
        displayName: "Meta Pagination Test Source",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    const adv = await prisma.advertiser.create({
      data: {
        platform: "META",
        name: "Pagination Test Advertiser",
        domain: "gadget-brand.example.com",
      },
    });

    // 4. Create DiscoveryRun with 25 ads
    await prisma.discoveryRun.create({
      data: {
        id: run25Id,
        workspaceId: testWorkspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ keywords: ["gadget"], market: "US", requestedLimit: 25 }),
        actualRetrievedCount: 25,
        validCount: 25,
        newUniqueCount: 25,
        startedAt: new Date(Date.now() - 60000),
        finishedAt: new Date(),
      },
    });

    // 5. Seed 25 linked CompetitorAds and DiscoveryRunAd associations
    for (let i = 1; i <= 25; i++) {
      const adId = `ad_pag_${String(i).padStart(3, "0")}`;
      const extId = `908825735077${String(i).padStart(3, "0")}`;
      createdAdIds25.push(adId);

      await prisma.competitorAd.create({
        data: {
          id: adId,
          externalAdId: extId,
          platform: "META",
          headline: `Gadget Offer #${i} - Provenance Verified`,
          bodyText: `High performing test gadget #${i} for pagination verification`,
          landingPageUrl: `https://gadget-brand.example.com/item-${i}`,
          originalAdUrl: `https://www.facebook.com/ads/library/?id=${extId}`,
          advertiserId: adv.id,
          dataSourceId: ds.id,
          status: "ACTIVE",
          daysRunning: 14 + i,
          sourceReportedStartAt: new Date(Date.now() - (14 + i) * 86400000),
          mediaAssets: {
            create: {
              mediaType: i % 2 === 0 ? "VIDEO" : "IMAGE",
              aspectRatio: "9:16",
              thumbnailUrl: `https://images.example.com/thumb-${i}.jpg`,
              availability: "AVAILABLE",
            },
          },
          evergreenScores: {
            create: {
              totalScore: 75 + (i % 20),
              tier: "HIGH_RESEARCH_PRIORITY",
              longevityCategory: "PROVEN_EVERGREEN",
              calendarAgeDays: 14 + i,
              evidenceConfidence: 0.9,
              coverageStatus: "FULL_COVERAGE",
            },
          },
        },
      });

      // Link to DiscoveryRun with distinct observedAt timestamp for deterministic ordering
      await prisma.discoveryRunAd.create({
        data: {
          runId: run25Id,
          adId,
          workspaceId: testWorkspaceId,
          providerId: "meta-ads-collector",
          ingestOutcome: "NEW",
          observedAt: new Date(Date.now() - (26 - i) * 1000),
        },
      });
    }

    // 6. Start dedicated Next.js server on loopback targeting isolated DB
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "production",
      allowLocalBypass: true,
      adminApiKey,
      timeoutMs: 35000,
    });
    // 7. Launch Chromium
    const chromePath = resolveChromeExecutablePath();
    if (chromePath) {
      browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: {
          authorization: `Bearer ${adminApiKey}`,
          "x-workspace-id": testWorkspaceId,
        },
      });
    }
  }, 60000);

  afterAll(async () => {
    try {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch {}

    try {
      if (serverHandle) await serverHandle.stop();
    } catch {}

    try {
      if (dbHandle) await dbHandle.teardown();
    } catch {}
  });

  it("traverses all 3 pages for 25 records and reconciles all 25 ad IDs exactly", async () => {
    expect(context).toBeTruthy();
    const page = await context!.newPage();

    try {
      const explorerUrl = `${serverHandle.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(run25Id)}`;
      await page.goto(explorerUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

      const collectionResult = await collectExactRunBrowserAdIds(page, {
        expectedRunId: run25Id,
        expectedTotal: 25,
        maximumPages: 5,
        timeoutMs: 15000,
        outDir,
      });

      if (collectionResult.status !== "PASSED") {
        console.error("CollectionResult errors:", collectionResult.errors);
      }

    // 1. Verify Browser Pagination traversal
    expect(collectionResult.status).toBe("PASSED");
    expect(collectionResult.paginationCompleted).toBe(true);
    expect(collectionResult.expectedPages).toBe(3);
    expect(collectionResult.visitedPages).toEqual([1, 2, 3]);

    // 2. Verify Page-by-page breakdown (Page 1 = 12, Page 2 = 12, Page 3 = 1)
    expect(collectionResult.pageEvidence).toHaveLength(3);
    expect(collectionResult.pageEvidence[0].adIds).toHaveLength(12);
    expect(collectionResult.pageEvidence[1].adIds).toHaveLength(12);
    expect(collectionResult.pageEvidence[2].adIds).toHaveLength(1);

    // 3. Verify IDs collection
    expect(collectionResult.renderedIds).toHaveLength(25);
    expect(collectionResult.uniqueRenderedIds).toHaveLength(25);
    expect(collectionResult.duplicateIds).toHaveLength(0);
    expect(collectionResult.errors).toHaveLength(0);

    // 4. Verify cross-boundary reconciliation against SQLite database IDs
    const reconciliation = reconcileExactAdIdSets({
      discoveryRunId: run25Id,
      databaseIds: createdAdIds25,
      httpIds: createdAdIds25, // All 25
      browserIds: collectionResult.uniqueRenderedIds,
      databaseStatus: "COMPLETED",
      httpStatus: "PASSED",
      browserStatus: collectionResult.status,
      browserPaginationCompleted: collectionResult.paginationCompleted,
    });

    expect(reconciliation.status).toBe("PASSED");
    expect(reconciliation.exactMatch).toBe(true);
    expect(reconciliation.missingFromBrowser).toHaveLength(0);
    expect(reconciliation.unexpectedInBrowser).toHaveLength(0);
    expect(reconciliation.databaseCount).toBe(25);
    expect(reconciliation.browserCount).toBe(25);
    } finally {
      await page.close();
    }
  }, 45000);

  it("handles 0 records empty state gracefully", async () => {
    const run0Id = "run_pagination_0_ads";
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: run0Id,
        workspaceId: testWorkspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ keywords: ["nonexistent"], market: "US", requestedLimit: 25 }),
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
      },
    });

    const page = await context!.newPage();
    const explorerUrl = `${serverHandle.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(run0Id)}`;
    await page.goto(explorerUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

    const collectionResult = await collectExactRunBrowserAdIds(page, {
      expectedRunId: run0Id,
      expectedTotal: 0,
      maximumPages: 2,
      timeoutMs: 10000,
      outDir,
    });

    expect(collectionResult.status).toBe("PASSED");
    expect(collectionResult.paginationCompleted).toBe(true);
    expect(collectionResult.expectedPages).toBe(1);
    expect(collectionResult.renderedIds).toHaveLength(0);
    await page.close();
  }, 30000);

  it("handles 1 record single page correctly without advancing", async () => {
    const run1Id = "run_pagination_1_ad";
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: run1Id,
        workspaceId: testWorkspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ keywords: ["single"], market: "US", requestedLimit: 25 }),
        actualRetrievedCount: 1,
        validCount: 1,
        newUniqueCount: 1,
      },
    });

    await dbHandle.prisma.discoveryRunAd.create({
      data: {
        runId: run1Id,
        adId: createdAdIds25[0],
        workspaceId: testWorkspaceId,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
        observedAt: new Date(),
      },
    });

    const page = await context!.newPage();
    const explorerUrl = `${serverHandle.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(run1Id)}`;
    await page.goto(explorerUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

    const collectionResult = await collectExactRunBrowserAdIds(page, {
      expectedRunId: run1Id,
      expectedTotal: 1,
      maximumPages: 2,
      timeoutMs: 10000,
      outDir,
    });

    expect(collectionResult.status).toBe("PASSED");
    expect(collectionResult.paginationCompleted).toBe(true);
    expect(collectionResult.expectedPages).toBe(1);
    expect(collectionResult.uniqueRenderedIds).toEqual([createdAdIds25[0]]);
    await page.close();
  }, 30000);
});
