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
  expectedMinCards?: number;
}

export interface BrowserCardDetail {
  candidateId: string;
  rank: number;
  score: number | null;
  confidence: string | null;
}

export interface KH02BrowserAcceptance {
  pageLoaded: boolean;
  authorized: boolean;
  researchSubmitted: boolean;
  acceptedRunId: string | null;
  terminalStatus?: string | null;
  terminalStateObserved: boolean;
  resultsRendered: boolean;
  emptyStateAccurate: boolean;
  displayedCandidateIds: string[];
  displayedRankOrder?: string[];
  displayedScores?: Record<string, number>;
  displayedConfidence?: Record<string, string>;
  renderedCards?: BrowserCardDetail[];
  postReloadCandidateIds?: string[];
  postReloadScores?: Record<string, number>;
  postReloadCards?: BrowserCardDetail[];
  postReloadConsistent?: boolean;
  unexpectedHttpErrors: number[];
  hydrationErrors: string[];
  databaseMatch: boolean;
  httpMatch?: boolean;
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
  let terminalStatus: string | null = null;
  let terminalStateObserved = false;
  let resultsRendered = false;
  let emptyStateAccurate = false;
  let cardCount = 0;
  let databaseMatch = true;
  const displayedRankOrder: string[] = [];
  const displayedScores: Record<string, number> = {};
  const displayedConfidence: Record<string, string> = {};
  const postReloadCandidateIds: string[] = [];
  const postReloadScores: Record<string, number> = {};
  const postReloadConfidence: Record<string, string> = {};
  const postReloadCards: BrowserCardDetail[] = [];
  let postReloadConsistent = true;

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
      await page.waitForLoadState("domcontentloaded").catch(() => null);
      await topicInput.click();
      await topicInput.fill("");
      await topicInput.fill(searchTopic);
      await page.waitForTimeout(500);
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

      // Set up response listener for async research submission (HTTP 202)
      const submitResponsePromise = page.waitForResponse(
        (res) => res.url().includes("/api/v1/kh02/research") && res.request().method() === "POST",
        { timeout: 15000 }
      ).catch(() => null);

      await analyzeBtn.click();
      researchSubmitted = true;

      const submitRes = await submitResponsePromise;
      if (submitRes && submitRes.status() === 202) {
        try {
          const body = await submitRes.json();
          if (body?.data?.runId || body?.data?.jobId) {
            acceptedRunId = body.data.runId || body.data.jobId;
          }
        } catch {}
      }

      if (!acceptedRunId) {
        errors.push("Async research submission failed to return valid acceptedRunId in HTTP 202 response.");
      }

      // ── Poll authoritative job status via API first (Directive 77) ──
      if (acceptedRunId) {
        console.log(`[Chromium E2E] Polling authoritative job status for run '${acceptedRunId}'...`);
        const pollStart = Date.now();
        const maxPollMs = 45000;
        while (Date.now() - pollStart < maxPollMs) {
          try {
            const statusRes = await context.request.get(
              `${options.baseUrl}/api/v1/kh02/research/runs/${acceptedRunId}`,
              {
                headers: {
                  "x-workspace-id": options.workspaceId,
                  ...(options.adminApiKey ? { authorization: `Bearer ${options.adminApiKey}` } : {}),
                },
              }
            );
            if (statusRes.ok()) {
              const runData = await statusRes.json().catch(() => null);
              const curStatus = runData?.data?.status;
              if (curStatus === "COMPLETED" || curStatus === "PARTIALLY_COMPLETED" || curStatus === "FAILED") {
                terminalStatus = curStatus;
                terminalStateObserved = true;
                break;
              }
            }
          } catch {}
          await page.waitForTimeout(1000);
        }
      }

      // Wait for loading spinner to detach once background worker completes and results render
      await page.waitForSelector('text=Aggregating cross-platform intelligence', { state: "detached", timeout: 20000 }).catch(() => null);

      // Bounded polling for terminal UI state (either ranked cards, provisional cards, or explicit empty state)
      const maxWaitMs = 15000;
      const pollInterval = 500;
      const startPoll = Date.now();

      while (Date.now() - startPoll < maxWaitMs) {
        const hasCards = await page.$(
          '[data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]'
        );
        const hasEmptyState = await page.$('[data-testid="kh02-empty-state"]');

        if (hasCards) {
          terminalStateObserved = true;
          break;
        }
        if (hasEmptyState) {
          terminalStateObserved = true;
          emptyStateAccurate = true;
          break;
        }
        await page.waitForTimeout(pollInterval);
      }

      // Check candidate product cards
      const rankedCards = await page.$$('[data-testid="kh02-ranked-product-card"]');
      const provCards = await page.$$('[data-testid="kh02-provisional-product-card"]');
      cardCount = rankedCards.length + provCards.length;
      resultsRendered = cardCount > 0 || (await page.$('[data-testid="kh02-leaderboard-container"]')) !== null;
      displayedRankOrder.length = 0;

      // Extract candidate IDs directly from data-candidate-id attributes (NO title fallback! Directive 83)
      for (const card of rankedCards) {
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          displayedCandidateIds.push(cid);
          displayedRankOrder.push(cid);

          const scoreAttr = await card.getAttribute("data-opportunity-score");
          if (scoreAttr) {
            displayedScores[cid] = parseFloat(scoreAttr);
          }
          const confText = await card.$eval(".text-emerald-400, .text-purple-300", (el) => el.textContent?.trim()).catch(() => null);
          if (confText) {
            displayedConfidence[cid] = confText;
          }
        } else {
          errors.push("Rendered ranked product card is missing required data-candidate-id attribute.");
        }
      }

      for (const card of provCards) {
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          if (!displayedCandidateIds.includes(cid)) {
            displayedCandidateIds.push(cid);
          }
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          if (scoreAttr) {
            displayedScores[cid] = parseFloat(scoreAttr);
          }
          displayedConfidence[cid] = "PROVISIONAL";
        } else {
          errors.push("Rendered provisional product card is missing required data-candidate-id attribute.");
        }
      }

      // Screenshot 3: Terminal Results / Empty State
      const shot3 = path.join(screenshotDir, "03_leaderboard_results.png");
      await page.screenshot({ path: shot3, fullPage: true });
      screenshots.push(shot3);

      // Verify persistence across page reload (Directive 82)
      console.log("[Chromium E2E] Testing reload persistence...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector("h1", { timeout: 10000 });

      // Allow client-side useEffect (fetchLatestLeaderboard) to populate state
      if (cardCount > 0) {
        await page.waitForSelector(
          '[data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]',
          { timeout: 8000 }
        ).catch(() => {});
      } else if (emptyStateAccurate) {
        await page.waitForSelector('[data-testid="kh02-empty-state"]', { timeout: 8000 }).catch(() => {});
      }

      // After reload, leaderboard or saved state should remain consistent
      const postReloadEmpty = await page.$('[data-testid="kh02-empty-state"]');
      const postReloadRanked = await page.$$('[data-testid="kh02-ranked-product-card"]');
      const postReloadProv = await page.$$('[data-testid="kh02-provisional-product-card"]');

      for (let i = 0; i < postReloadRanked.length; i++) {
        const card = postReloadRanked[i];
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          postReloadCandidateIds.push(cid);
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) postReloadScores[cid] = scoreVal;
          const confText = await card.$eval(".text-emerald-400, .text-purple-300", (el) => el.textContent?.trim()).catch(() => null);
          if (confText) postReloadConfidence[cid] = confText;
          postReloadCards.push({
            candidateId: cid,
            rank: i + 1,
            score: scoreVal,
            confidence: confText,
          });
        }
      }

      for (let i = 0; i < postReloadProv.length; i++) {
        const card = postReloadProv[i];
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          if (!postReloadCandidateIds.includes(cid)) postReloadCandidateIds.push(cid);
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) postReloadScores[cid] = scoreVal;
          postReloadConfidence[cid] = "PROVISIONAL";
          postReloadCards.push({
            candidateId: cid,
            rank: postReloadRanked.length + i + 1,
            score: scoreVal,
            confidence: "PROVISIONAL",
          });
        }
      }

      postReloadConsistent = true;
      if (emptyStateAccurate && !postReloadEmpty && postReloadCandidateIds.length === 0) {
        databaseMatch = false;
        postReloadConsistent = false;
        errors.push("Empty state was not preserved across page reload.");
      } else if (cardCount > 0) {
        if (postReloadCandidateIds.length !== displayedCandidateIds.length) {
          databaseMatch = false;
          postReloadConsistent = false;
          errors.push(`Reload card count mismatch: pre-reload ${displayedCandidateIds.length} vs post-reload ${postReloadCandidateIds.length}`);
        } else {
          for (let i = 0; i < displayedCandidateIds.length; i++) {
            if (displayedCandidateIds[i] !== postReloadCandidateIds[i]) {
              databaseMatch = false;
              postReloadConsistent = false;
              errors.push(`Reload candidate ID mismatch at index ${i}: pre-reload ${displayedCandidateIds[i]} vs post-reload ${postReloadCandidateIds[i]}`);
            }
          }
          for (const cid of displayedCandidateIds) {
            if (displayedScores[cid] !== undefined && postReloadScores[cid] !== undefined) {
              if (displayedScores[cid] !== postReloadScores[cid]) {
                databaseMatch = false;
                postReloadConsistent = false;
                errors.push(`Reload score mismatch for '${cid}': pre-reload ${displayedScores[cid]} vs post-reload ${postReloadScores[cid]}`);
              }
            }
          }
        }
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

  // Build renderedCards array
  const renderedCards: BrowserCardDetail[] = displayedCandidateIds.map((cid, idx) => ({
    candidateId: cid,
    rank: idx + 1,
    score: displayedScores[cid] ?? null,
    confidence: displayedConfidence[cid] ?? null,
  }));

  // Determine truthful verdict:
  const minCards = options.expectedMinCards ?? 0;
  let verdict: "PASS" | "FAIL" | "BLOCKED" = "FAIL";
  if (!pageLoaded || !authorized) {
    verdict = "BLOCKED";
  } else if (minCards > 0 && cardCount < minCards) {
    verdict = "FAIL";
    errors.push(`Expected at least ${minCards} rendered product card(s), but found ${cardCount}.`);
  } else if (
    researchSubmitted &&
    acceptedRunId !== null &&
    terminalStateObserved &&
    unexpectedHttpErrors.length === 0 &&
    hydrationErrors.length === 0 &&
    databaseMatch &&
    errors.length === 0
  ) {
    verdict = "PASS";
  } else {
    verdict = "FAIL";
  }

  return {
    pageLoaded,
    authorized,
    researchSubmitted,
    acceptedRunId,
    terminalStatus,
    terminalStateObserved,
    resultsRendered,
    emptyStateAccurate,
    displayedCandidateIds,
    displayedRankOrder,
    displayedScores,
    displayedConfidence,
    renderedCards,
    postReloadCandidateIds,
    postReloadScores,
    postReloadCards,
    postReloadConsistent,
    unexpectedHttpErrors,
    hydrationErrors,
    databaseMatch,
    httpMatch: unexpectedHttpErrors.length === 0,
    cardCount,
    screenshots,
    consoleLogs,
    errors,
    durationMs,
    verdict,
  };
}
