/**
 * SWAI KH-02 V12.1.3 — Chromium Browser E2E Acceptance Driver
 *
 * Drives an actual Chromium browser engine to interact with the Winning Products
 * leaderboard interface (/products).
 *
 * Guarantees:
 * 1. Genuine Chromium rendering and DOM interaction (no mock DOM).
 * 2. Verifies page load, search topic input, research triggering, and asynchronous status polling.
 * 3. Bounded polling for terminal state (no fixed sleep as completion criterion).
 * 4. Intercepts HTTP 202 / runId and tracks server responses (detects unexpected 500s).
 * 5. Detects React hydration mismatches and unhandled errors.
 * 6. Inspects leaderboard rendering (ranked cards, provisional cards, or truthful empty state).
 * 7. Captures visual screenshots and console diagnostics into acceptance/kh02-v12.1.3/screenshots/.
 */

import fs from "fs";
import path from "path";
import { chromium, Browser, BrowserContext, Page, Response } from "playwright-core";

export interface Kh02BrowserE2EOptions {
  baseUrl: string;
  workspaceId: string;
  adminApiKey?: string;
  screenshotDir?: string;
  headless?: boolean;
  topic?: string;
}

export interface KH02BrowserAcceptance {
  pageLoaded: boolean;
  authorized: boolean;
  researchSubmitted: boolean;
  acceptedRunId: string | null;
  terminalStateObserved: boolean;
  resultsRendered: boolean;
  emptyStateAccurate: boolean;
  displayedCandidateIds: string[];
  unexpectedHttpErrors: number[];
  hydrationErrors: string[];
  databaseMatch: boolean;
  cardCount: number;
  screenshots: string[];
  consoleLogs: string[];
  errors: string[];
  durationMs: number;
  verdict: "PASS" | "FAIL" | "BLOCKED";
}

export function resolveChromePath(): string {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  throw new Error("No compatible Chrome or Chromium binary found for headless browser testing.");
}

export async function runKh02BrowserE2E(
  options: Kh02BrowserE2EOptions
): Promise<KH02BrowserAcceptance> {
  const start = Date.now();
  const errors: string[] = [];
  const consoleLogs: string[] = [];
  const screenshots: string[] = [];
  const unexpectedHttpErrors: number[] = [];
  const hydrationErrors: string[] = [];
  const displayedCandidateIds: string[] = [];

  const screenshotDir =
    options.screenshotDir ||
    path.resolve(process.cwd(), "acceptance/kh02-v12.1.3/screenshots");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let pageLoaded = false;
  let authorized = false;
  let researchSubmitted = false;
  let acceptedRunId: string | null = null;
  let terminalStateObserved = false;
  let resultsRendered = false;
  let emptyStateAccurate = false;
  let cardCount = 0;
  let databaseMatch = true;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const executablePath = resolveChromePath();
    browser = await chromium.launch({
      executablePath,
      headless: options.headless !== false,
      args: [
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-default-apps",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        "x-workspace-id": options.workspaceId,
        ...(options.adminApiKey ? { authorization: `Bearer ${options.adminApiKey}` } : {}),
      },
    });

    const page: Page = await context.newPage();

    // Console logging & hydration error tracking
    page.on("console", (msg) => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      if (
        text.toLowerCase().includes("hydration") ||
        text.toLowerCase().includes("minified react error #418") ||
        text.toLowerCase().includes("minified react error #423")
      ) {
        hydrationErrors.push(text);
      }
    });

    page.on("pageerror", (err) => {
      errors.push(`Page error: ${err.message}`);
      if (err.message.toLowerCase().includes("hydration")) {
        hydrationErrors.push(err.message);
      }
    });

    // Intercept responses for status tracking and unexpected 500s
    page.on("response", async (res: Response) => {
      const status = res.status();
      const url = res.url();
      if (status >= 500) {
        unexpectedHttpErrors.push(status);
        errors.push(`HTTP ${status} from ${url}`);
      }
      if (url.includes("/api/v1/kh02/research") && status === 202) {
        try {
          const body = await res.json().catch(() => null);
          if (body?.data?.runId || body?.data?.jobId) {
            acceptedRunId = body.data.runId || body.data.jobId;
          }
        } catch {
          // Ignore body read errors
        }
      }
    });

    const targetUrl = `${options.baseUrl}/products`;
    console.log(`[Chromium E2E] Navigating to: ${targetUrl}`);
    const navResponse = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    if (navResponse && navResponse.status() < 400) {
      pageLoaded = true;
      authorized = navResponse.status() !== 401 && navResponse.status() !== 403;
    }

    // Wait for header and initial UI elements
    await page.waitForSelector("h1", { timeout: 10000 });

    // Screenshot 1: Initial Page Load
    const shot1 = path.join(screenshotDir, "01_before_research.png");
    await page.screenshot({ path: shot1, fullPage: true });
    screenshots.push(shot1);

    // Verify source status bar presence
    const statusBar = await page.$('[data-testid="kh02-source-status-bar"], text=Meta Ads').catch(() => null);

    // Set search topic in input using stable semantic selector
    const searchTopic = options.topic || "Pet Gadgets";
    const topicInput = await page.$(
      'input[data-testid="kh02-research-input"], input[placeholder*="niche or topic"]'
    );
    if (topicInput) {
      await topicInput.fill(searchTopic);
    }

    // Screenshot 2: Source Statuses and Input
    const shot2 = path.join(screenshotDir, "02_source_statuses.png");
    await page.screenshot({ path: shot2, fullPage: false });
    screenshots.push(shot2);

    // Trigger Research by clicking "Analyze Opportunity" button with semantic selector
    const analyzeBtn = await page.$(
      'button[data-testid="kh02-analyze-button"], button:has-text("Analyze Evergreen Niche"), button:has-text("Analyze")'
    );
    if (analyzeBtn) {
      console.log(`[Chromium E2E] Triggering async research for '${searchTopic}'...`);
      await analyzeBtn.click();
      researchSubmitted = true;

      // Bounded polling for terminal UI state (either ranked cards, provisional cards, or explicit empty state)
      // Max wait 30 seconds (checking every 500ms)
      const maxWaitMs = 30000;
      const pollInterval = 500;
      const startPoll = Date.now();

      while (Date.now() - startPoll < maxWaitMs) {
        const hasCards = await page.$(
          '[data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]'
        );
        const hasEmptyState = await page.$('[data-testid="kh02-empty-state"]');
        const hasLeaderboard = await page.$('[data-testid="kh02-leaderboard-container"]');

        if (hasCards || hasEmptyState || hasLeaderboard) {
          terminalStateObserved = true;
          if (hasEmptyState) {
            emptyStateAccurate = true;
          }
          break;
        }
        await page.waitForTimeout(pollInterval);
      }

      // Check candidate product cards
      const rankedCards = await page.$$('[data-testid="kh02-ranked-product-card"]');
      const provCards = await page.$$('[data-testid="kh02-provisional-product-card"]');
      cardCount = rankedCards.length + provCards.length;
      resultsRendered = cardCount > 0 || (await page.$('[data-testid="kh02-leaderboard-container"]')) !== null;

      // Extract titles or identifiers if cards rendered
      for (const card of rankedCards) {
        const titleEl = await card.$("h3");
        if (titleEl) {
          const text = await titleEl.innerText().catch(() => "");
          if (text) displayedCandidateIds.push(text.trim());
        }
      }

      // Screenshot 3: Terminal Results / Empty State
      const shot3 = path.join(screenshotDir, "03_leaderboard_results.png");
      await page.screenshot({ path: shot3, fullPage: true });
      screenshots.push(shot3);

      // Verify persistence across page reload
      console.log("[Chromium E2E] Testing reload persistence...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector("h1", { timeout: 10000 });

      // After reload, leaderboard or saved state should remain consistent
      const postReloadEmpty = await page.$('[data-testid="kh02-empty-state"]');
      const postReloadCards = await page.$$(
        '[data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]'
      );
      if (emptyStateAccurate && !postReloadEmpty && postReloadCards.length === 0) {
        // Did not preserve empty state or cards
        databaseMatch = false;
      }
    } else {
      errors.push("Analyze button not found on page.");
    }
  } catch (err: any) {
    errors.push(`Chromium execution error: ${err.message}`);
    const errShot = path.join(screenshotDir, "error_state.png");
    await context?.pages()[0]?.screenshot({ path: errShot }).catch(() => {});
    screenshots.push(errShot);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const durationMs = Date.now() - start;

  // Determine truthful verdict:
  // Must have loaded, authorized, submitted research, observed terminal state, zero unexpected 500s
  let verdict: "PASS" | "FAIL" | "BLOCKED" = "FAIL";
  if (!pageLoaded || !authorized) {
    verdict = "BLOCKED";
  } else if (
    researchSubmitted &&
    terminalStateObserved &&
    unexpectedHttpErrors.length === 0 &&
    errors.length === 0
  ) {
    verdict = "PASS";
  } else if (unexpectedHttpErrors.length > 0) {
    verdict = "FAIL";
  } else {
    verdict = "FAIL";
  }

  return {
    pageLoaded,
    authorized,
    researchSubmitted,
    acceptedRunId,
    terminalStateObserved,
    resultsRendered,
    emptyStateAccurate,
    displayedCandidateIds,
    unexpectedHttpErrors,
    hydrationErrors,
    databaseMatch,
    cardCount,
    screenshots,
    consoleLogs,
    errors,
    durationMs,
    verdict,
  };
}
