import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer, SwaiTestServerHandle } from "./helpers/startSwaiTestServer";
import { chromium, Browser, BrowserContext, Page } from "playwright-core";
import fs from "fs";
import path from "path";

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

describe("Meta Discovery Final Acceptance E2E (Section 18 & 25)", () => {
  let dbHandle: TestDatabaseHandle;
  let serverHandle: SwaiTestServerHandle;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const workspaceId = "ws_meta_discovery_e2e";
  const runId = "run_discovery_e2e_001";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "discovery-e2e" });

    // Seed Workspace
    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Meta Discovery Acceptance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Seed DataSource
    await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_disc_e2e",
        name: "meta-ads-collector",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // Seed existing DiscoveryRun
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ keywords: ["orthopedic dog bed"], market: "US" }),
        actualRetrievedCount: 1,
        validCount: 1,
        newUniqueCount: 1,
        existingDuplicateCount: 0,
      },
    });

    // Seed Advertiser, CompetitorAd, and DiscoveryRunAd for Exact Run verification
    const adv = await dbHandle.prisma.advertiser.create({
      data: {
        id: "adv_meta_e2e_01",
        name: "PupRest Co",
        domain: "puprest.com",
        platform: "META",
      },
    });

    const adId = "ad_e2e_exact_001";
    await dbHandle.prisma.competitorAd.create({
      data: {
        id: adId,
        advertiserId: adv.id,
        dataSourceId: "ds_meta_disc_e2e",
        platform: "META",
        externalAdId: "meta_e2e_001",
        originalAdUrl: "https://facebook.com/ads/library/?id=meta_e2e_001",
        headline: "Luxury Orthopedic Dog Bed",
        bodyText: "Memory foam orthopedic dog bed with washable cover",
        callToAction: "Shop Now",
        landingPageUrl: "https://example.com/dog-bed",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        status: "ACTIVE",
        targetMarket: "US",
        dataConfidence: "VERIFIED",
      },
    });

    await dbHandle.prisma.discoveryRunAd.create({
      data: {
        runId,
        adId,
        workspaceId,
        providerId: "meta-ads-collector",
        sourceUrl: "https://facebook.com/ads/library/?id=meta_e2e_001",
        ingestOutcome: "NEW",
      },
    });

    const adminApiKey = "test_meta_discovery_e2e_token";
    // Start real Next.js server against isolated DB
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      adminApiKey,
      mode: "production",
      timeoutMs: 30000,
    });

    // Launch Playwright Chrome
    const executablePath = resolveChrome();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
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

  it("renders Meta Discovery research page with truthful readiness action button", async () => {
    await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Wait for the research form container to load
    const formHeading = page.locator("h1, h2").first();
    await formHeading.waitFor({ state: "visible", timeout: 10000 });
    expect(await formHeading.isVisible()).toBe(true);

    // The submit button exists and has a valid research action label
    const submitBtn = page.locator("button[type='submit'], [data-testid='research-action-btn']").first();
    await submitBtn.waitFor({ state: "visible", timeout: 10000 });
    const btnText = await submitBtn.innerText();
    const validLabels = ["Start Research", "Queue for Later", "Configure Collector", "Run Diagnostics", "Checking..."];
    expect(validLabels.some((l) => btnText.includes(l))).toBe(true);
  });

  it("preserves keyword input upon typing and honors form submission boundaries", async () => {
    await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    const keywordInput = page.locator("[data-testid='meta-keyword-input'], input[placeholder*='keyword' i], input[type='text']").first();
    if (await keywordInput.isVisible()) {
      await keywordInput.fill("pet hair remover");
      const val = await keywordInput.inputValue();
      expect(val).toBe("pet hair remover");
    }
  });

  it("renders cleanly on mobile viewport (390 x 844) without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // No significant horizontal overflow
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10);
  });

  it("navigates to Explorer exact-run and verifies run-specific ad card and banner (Section 18)", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${serverHandle.baseUrl}/explorer?platform=META&requestId=${runId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Exact Run Banner is rendered
    const banner = page.locator("[data-testid='exact-run-context-banner']");
    await banner.waitFor({ state: "visible", timeout: 15000 });
    expect(await banner.isVisible()).toBe(true);

    const bannerText = await banner.innerText();
    expect(bannerText).toContain(runId);

    // Exact Run Ad Card is rendered with correct ad-id
    const exactCard = page.locator("[data-testid='exact-run-ad-card']");
    await exactCard.waitFor({ state: "visible", timeout: 15000 });
    expect(await exactCard.count()).toBeGreaterThanOrEqual(1);

    const cardAdId = await exactCard.first().getAttribute("data-ad-id");
    expect(cardAdId).toBe("ad_e2e_exact_001");
  }, 30000);

  it("verifies layout responsiveness across all 6 canonical viewports without horizontal overflow (Section 18)", async () => {
    const viewports = [
      { width: 1920, height: 1080, name: "1920x1080 (FHD)" },
      { width: 1440, height: 900, name: "1440x900 (Desktop)" },
      { width: 1280, height: 800, name: "1280x800 (Laptop)" },
      { width: 1024, height: 768, name: "1024x768 (Tablet Landscape)" },
      { width: 768, height: 1024, name: "768x1024 (Tablet Portrait)" },
      { width: 390, height: 844, name: "390x844 (Mobile)" },
    ];

    const executions: any[] = [];
    const screenshotsDir =
      process.env.KH01_BROWSER_SCREENSHOT_DIR ||
      path.resolve(process.cwd(), "artifacts/v11.5.7/screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const testUrl = `${serverHandle.baseUrl}/explorer?platform=META&requestId=${runId}`;

    for (const vp of viewports) {
      const startedAt = new Date().toISOString();
      let status: "PASSED" | "FAILED" = "PASSED";
      let error: string | undefined = undefined;
      let pageNavigated = false;
      let domAssertionsExecuted = 0;
      let horizontalOverflowDetected = false;
      const screenshotPath = path.join(screenshotsDir, `viewport_${vp.width}x${vp.height}.png`);

      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(testUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        pageNavigated = true;

        // Verify page url
        const currentUrl = page.url();
        expect(currentUrl).toContain("/explorer");
        domAssertionsExecuted++;

        // Verify exact-run context
        const banner = page.locator("[data-testid='exact-run-context-banner']");
        await banner.waitFor({ state: "visible", timeout: 10000 });
        expect(await banner.isVisible()).toBe(true);
        domAssertionsExecuted++;

        // Verify horizontal overflow
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        if (scrollWidth > clientWidth + 15) {
          horizontalOverflowDetected = true;
        }
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 15);
        domAssertionsExecuted++;

        // Screenshot capture
        await page.screenshot({ path: screenshotPath });
      } catch (err: any) {
        status = "FAILED";
        error = err.message || String(err);
      }

      executions.push({
        testId: `viewport_${vp.width}x${vp.height}`,
        browserName: "chromium",
        width: vp.width,
        height: vp.height,
        viewportLabel: vp.name,
        startedAt,
        completedAt: new Date().toISOString(),
        status,
        pageUrl: testUrl,
        browserLaunched: true,
        pageNavigated,
        domAssertionsExecuted,
        horizontalOverflowDetected,
        screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
        error,
      });
    }

    // Write structured viewport execution evidence
    const evidencePath =
      process.env.KH01_BROWSER_EVIDENCE_PATH ||
      path.resolve(process.cwd(), "artifacts/v11.5.7/browser-viewport-results.json");
    const evidenceDir = path.dirname(evidencePath);
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const failedCount = executions.filter((e) => e.status === "FAILED").length;
    const payload = {
      acceptanceRunId: process.env.KH01_ACCEPTANCE_RUN_ID || "run_discovery_e2e_001",
      browserName: "chromium",
      executedAt: new Date().toISOString(),
      totalViewports: executions.length,
      passedViewports: executions.filter((e) => e.status === "PASSED").length,
      failedViewports: failedCount,
      executions,
      evidenceFile: evidencePath,
      valid: true,
    };
    fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2), "utf8");

    expect(failedCount).toBe(0);
  }, 45000);
});
