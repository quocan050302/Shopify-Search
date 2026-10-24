import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "./helpers/startSwaiTestServer";
import { chromium, Browser, BrowserContext, Page } from "playwright-core";
import fs from "fs";

function resolveChrome(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("No Chrome found");
}

describe("Meta Run Explorer E2E Browser Journey (Section 36 & 57)", () => {
  let dbHandle: TestDatabaseHandle;
  let serverHandle: SwaiTestServerHandle;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const workspaceId = "ws_e2e_run_test";
  const runAId = "run_e2e_001";
  const runBId = "run_e2e_002";
  const runEmptyId = "run_e2e_empty";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "meta-e2e-run" });

    // Seed Workspace
    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "E2E Run Test Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Seed DataSource
    await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_collector",
        name: "META_COLLECTOR",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // Seed Advertiser
    const adv = await dbHandle.prisma.advertiser.create({
      data: {
        name: "E2E Clean Pet Co",
        platform: "META",
        verifiedStatus: "VERIFIED",
      },
    });

    // Seed DiscoveryRuns
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runAId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 2,
        validCount: 2,
        newUniqueCount: 2,
        existingDuplicateCount: 0,
        createdAt: new Date("2026-10-24T10:00:00Z"),
      },
    });

    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runBId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 1,
        validCount: 1,
        newUniqueCount: 1,
        existingDuplicateCount: 0,
        createdAt: new Date("2026-10-24T11:00:00Z"),
      },
    });

    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runEmptyId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["cat brush"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
        createdAt: new Date("2026-10-24T12:00:00Z"),
      },
    });

    // Create Ads
    const adA1 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_e2e_a1",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_collector",
        platform: "META",
        headline: "Run A Exclusive Pet Hair Remover",
        bodyText: "Best pet roller for furniture from Run A.",
        originalAdUrl: "https://facebook.com/ads/101",
        landingPageUrl: "https://uproot.com/product/a1",
        sourceReportedStartAt: new Date(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const adA2 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_e2e_a2",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_collector",
        platform: "META",
        headline: "Run A Secondary Lint Sweeper",
        bodyText: "Works on carpets and car seats from Run A.",
        originalAdUrl: "https://facebook.com/ads/102",
        landingPageUrl: "https://uproot.com/product/a2",
        sourceReportedStartAt: new Date(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const adB1 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_e2e_b1",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_collector",
        platform: "META",
        headline: "Run B Different Special Brush",
        bodyText: "Unique brush collected in Run B only.",
        originalAdUrl: "https://facebook.com/ads/201",
        landingPageUrl: "https://uproot.com/product/b1",
        sourceReportedStartAt: new Date(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    // Link Ads to Runs
    await dbHandle.prisma.discoveryRunAd.createMany({
      data: [
        { runId: runAId, adId: adA1.id, workspaceId, libraryId: "lib_e2e_a1", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
        { runId: runAId, adId: adA2.id, workspaceId, libraryId: "lib_e2e_a2", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
        { runId: runBId, adId: adB1.id, workspaceId, libraryId: "lib_e2e_b1", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
      ],
    });

    const adminApiKey = "test_e2e_secret_token";

    // Start server
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      adminApiKey,
    });

    // Launch browser
    browser = await chromium.launch({
      executablePath: resolveChrome(),
      headless: true,
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        authorization: `Bearer ${serverHandle.adminApiKey}`,
        "x-workspace-id": workspaceId,
      },
    });
    page = await context.newPage();
  }, 45000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (serverHandle) await serverHandle.stop();
    if (dbHandle) await dbHandle.teardown();
  });

  it("loads Explorer with requestId and shows active run scope banner", async () => {
    page.on("response", async (res) => {
      if (res.url().includes("/api/v1/evergreen/ads")) {
        try {
          const body = await res.text();
          console.log("EVERGREEN RES STATUS:", res.status(), body);
        } catch {}
      }
    });

    await page.goto(`${serverHandle.baseUrl}/explorer?platform=META&requestId=${runAId}`, {
      waitUntil: "networkidle",
    });

    // Active run banner should appear
    const banner = page.locator("text=Viewing advertisements from Research Run");
    await banner.waitFor({ state: "visible", timeout: 15000 });
    expect(await banner.isVisible()).toBe(true);

    const runIdText = page.locator(`text=${runAId}`).first();
    expect(await runIdText.isVisible()).toBe(true);

    // Verify Run A ads appear and Run B ad does NOT appear
    const adA1 = page.locator("text=Run A Exclusive Pet Hair Remover");
    await adA1.waitFor({ state: "visible", timeout: 15000 });
    expect(await adA1.isVisible()).toBe(true);

    const adB1 = page.locator("text=Run B Different Special Brush");
    expect(await adB1.isVisible()).toBe(false);
  }, 30000);

  it("clears run-specific view when clicking Exit Run View", async () => {
    const exitBtn = page.locator("button:has-text('Exit Run View')");
    await exitBtn.waitFor({ state: "visible", timeout: 5000 });
    expect(await exitBtn.isVisible()).toBe(true);
    await exitBtn.click();

    await page.waitForTimeout(500);

    // Banner should disappear and URL should not contain requestId
    const banner = page.locator("text=Viewing advertisements from Research Run");
    expect(await banner.isVisible()).toBe(false);
    expect(page.url()).not.toContain("requestId=");
  }, 20000);

  it("handles empty research run truthfully without fallback to unrelated ads", async () => {
    await page.goto(`${serverHandle.baseUrl}/explorer?platform=META&requestId=${runEmptyId}`, {
      waitUntil: "networkidle",
    });

    // Active run banner is visible
    const banner = page.locator("text=Viewing advertisements from Research Run");
    await banner.waitFor({ state: "visible", timeout: 15000 });
    expect(await banner.isVisible()).toBe(true);

    // Verify no ads are returned and no fallback exposes Run A or Run B ads
    const adA1 = page.locator("text=Run A Exclusive Pet Hair Remover");
    expect(await adA1.isVisible()).toBe(false);

    const adB1 = page.locator("text=Run B Different Special Brush");
    expect(await adB1.isVisible()).toBe(false);
  }, 30000);
});
