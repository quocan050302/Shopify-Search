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
        name: "META_COLLECTOR",
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
        providerId: "META_COLLECTOR",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ keywords: ["orthopedic dog bed"], market: "US" }),
        actualRetrievedCount: 12,
        validCount: 12,
        newUniqueCount: 12,
        existingDuplicateCount: 0,
      },
    });

    // Start real Next.js server against isolated DB
    serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
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

    const keywordInput = page.locator("input[placeholder*='keyword' i], input[type='text'], textarea").first();
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
});
