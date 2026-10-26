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

describe("Exact Run Explorer Acceptance E2E (Section 07 & 25)", () => {
  let dbHandle: TestDatabaseHandle;
  let serverHandle: SwaiTestServerHandle;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const workspaceId = "ws_e2e_exact_acceptance";
  const runId = "run_e2e_exact_001";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "exact-run-e2e" });

    // Seed Workspace
    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "E2E Exact Run Acceptance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Seed DataSource
    await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_exact_e2e",
        name: "META_COLLECTOR",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // Seed Advertiser
    const adv = await dbHandle.prisma.advertiser.create({
      data: {
        name: "EcoPet Supply Co",
        platform: "META",
        verifiedStatus: "VERIFIED",
      },
    });

    // Seed DiscoveryRun
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 4,
        validCount: 4,
        newUniqueCount: 4,
        existingDuplicateCount: 0,
        createdAt: new Date(),
      },
    });

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    // Create 4 Ads
    const ad1 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_exact_e2e_1",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_exact_e2e",
        platform: "META",
        headline: "Acceptance Yesterday Launched Roller",
        bodyText: "Ad 1 launched yesterday.",
        originalAdUrl: "https://facebook.com/ads/301",
        landingPageUrl: "https://ecopet.com/item1",
        sourceReportedStartAt: now,
        daysRunning: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    const ad2 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_exact_e2e_2",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_exact_e2e",
        platform: "META",
        headline: "Acceptance 90-Day Proven Roller",
        bodyText: "Ad 2 launched 90 days ago.",
        originalAdUrl: "https://facebook.com/ads/302",
        landingPageUrl: "https://ecopet.com/item2",
        sourceReportedStartAt: ninetyDaysAgo,
        daysRunning: 90,
        firstSeenAt: ninetyDaysAgo,
        lastSeenAt: now,
      },
    });

    const ad3 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_exact_e2e_3",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_exact_e2e",
        platform: "META",
        headline: "Acceptance 180-Day Evergreen Roller",
        bodyText: "Ad 3 launched 180 days ago.",
        originalAdUrl: "https://facebook.com/ads/303",
        landingPageUrl: "https://ecopet.com/item3",
        sourceReportedStartAt: oneEightyDaysAgo,
        daysRunning: 180,
        firstSeenAt: oneEightyDaysAgo,
        lastSeenAt: now,
      },
    });

    const ad4 = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_exact_e2e_4",
        advertiserId: adv.id,
        dataSourceId: "ds_meta_exact_e2e",
        platform: "META",
        headline: "Acceptance Unknown Launch Date Roller",
        bodyText: "Ad 4 with unknown launch date.",
        originalAdUrl: "https://facebook.com/ads/304",
        landingPageUrl: "https://ecopet.com/item4",
        sourceReportedStartAt: null,
        daysRunning: 0,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    // Link Ads to Run
    await dbHandle.prisma.discoveryRunAd.createMany({
      data: [
        { runId, adId: ad1.id, workspaceId, libraryId: "lib_acc_1", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
        { runId, adId: ad2.id, workspaceId, libraryId: "lib_acc_2", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
        { runId, adId: ad3.id, workspaceId, libraryId: "lib_acc_3", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
        { runId, adId: ad4.id, workspaceId, libraryId: "lib_acc_4", providerId: "meta-ads-collector", ingestOutcome: "NEW" },
      ],
    });

    const adminApiKey = "test_e2e_exact_secret_token";

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

  it("navigates to Explorer with exact run scope and displays all ads without 30-day cutoff", async () => {
    await page.goto(`${serverHandle.baseUrl}/explorer?platform=META&requestId=${runId}`, {
      waitUntil: "networkidle",
    });

    // Verify consolidated exact run banner is visible
    const banner = page.locator("[data-testid='exact-run-context-banner']");
    await banner.waitFor({ state: "visible", timeout: 15000 });
    expect(await banner.isVisible()).toBe(true);

    // Verify runId displayed
    expect(await page.locator(`text=${runId}`).first().isVisible()).toBe(true);

    // Verify all 4 ads visible in exact run results
    await page.locator("text=Acceptance Yesterday Launched Roller").waitFor({ state: "visible", timeout: 15000 });
    expect(await page.locator("text=Acceptance Yesterday Launched Roller").isVisible()).toBe(true);

    await page.locator("text=Acceptance 90-Day Proven Roller").waitFor({ state: "visible", timeout: 15000 });
    expect(await page.locator("text=Acceptance 90-Day Proven Roller").isVisible()).toBe(true);

    await page.locator("text=Acceptance 180-Day Evergreen Roller").waitFor({ state: "visible", timeout: 15000 });
    expect(await page.locator("text=Acceptance 180-Day Evergreen Roller").isVisible()).toBe(true);

    await page.locator("text=Acceptance Unknown Launch Date Roller").waitFor({ state: "visible", timeout: 15000 });
    expect(await page.locator("text=Acceptance Unknown Launch Date Roller").isVisible()).toBe(true);
  }, 30000);

  it("exits run view cleanly using Exit Run View button", async () => {
    const exitBtn = page.locator("[data-testid='exit-run-view-btn']");
    await exitBtn.waitFor({ state: "visible", timeout: 5000 });
    await exitBtn.click();

    await page.waitForTimeout(500);

    const banner = page.locator("[data-testid='exact-run-context-banner']");
    expect(await banner.isVisible()).toBe(false);
    expect(page.url()).not.toContain("requestId=");
  }, 20000);
});
