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
  tracePath?: string;
  headless?: boolean;
  topic?: string;
  lookbackDays?: number;
  sourceMode?: "LIVE_WITH_CACHE_FALLBACK" | "CACHE_ONLY" | "LIVE_ONLY";
  expectedMinCards?: number;
  screenshotPrefix?: string;
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
  shortlistSectionRendered?: boolean;
  shortlistCardsCount?: number;
  shortlistCandidateIds?: string[];
  shortlistTitles?: string[];
  rejectedTitles?: string[];
  erVetBillInShortlist?: boolean;
  erVetBillInTopThree?: boolean;
  erVetBillInProvisional?: boolean;
  nonPhysicalNoiseInShortlist?: boolean;
  discoveryIntelligencePanelRendered?: boolean;
  coherentFunnelRendered?: boolean;
  queryCoverageTableRendered?: boolean;
  runtimeVersionBadgeText?: string | null;
  runtimeParityStatus?: string | null;
  frontendBuildSha?: string | null;
  backendBuildSha?: string | null;
  workerBuildSha?: string | null;
  authoritativeRunIdInDom?: string | null;
  postReloadShortlistCandidateIds?: string[];
  postReloadRunIdInDom?: string | null;
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
  let shortlistSectionRendered = false;
  let shortlistCardsCount = 0;
  const shortlistCandidateIds: string[] = [];
  const shortlistTitles: string[] = [];
  const rejectedTitles: string[] = [];
  let erVetBillInShortlist = false;
  let erVetBillInTopThree = false;
  let erVetBillInProvisional = false;
  let nonPhysicalNoiseInShortlist = false;
  let discoveryIntelligencePanelRendered = false;
  let coherentFunnelRendered = false;
  let queryCoverageTableRendered = false;
  let runtimeVersionBadgeText: string | null = null;
  const prefix = options.screenshotPrefix ? `${options.screenshotPrefix}_` : "";
  let runtimeParityStatus: string | null = null;
  let frontendBuildSha: string | null = null;
  let backendBuildSha: string | null = null;
  let workerBuildSha: string | null = null;
  let authoritativeRunIdInDom: string | null = null;
  const postReloadShortlistCandidateIds: string[] = [];
  let postReloadRunIdInDom: string | null = null;
  let cardCount = 0;
  let databaseMatch = true;
  const displayedRankOrder: string[] = [];
  const displayedScores: Record<string, number> = {};
  const displayedConfidence: Record<string, string> = {};
  const renderedCards: BrowserCardDetail[] = [];
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

    if (options.tracePath) {
      const traceDir = path.dirname(options.tracePath);
      if (!fs.existsSync(traceDir)) {
        fs.mkdirSync(traceDir, { recursive: true });
      }
      await context.tracing.start({ screenshots: false, snapshots: false }).catch(() => {});
    }

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

    // Allow initial load to stabilize
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(1000);

    // Wait for header and initial UI elements using Locator
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });

    const versionBadgeLoc = page.locator('[data-testid="kh02-runtime-version-badge"]').first();
    if (await versionBadgeLoc.count() > 0) {
      runtimeVersionBadgeText = (await versionBadgeLoc.textContent().catch(() => null))?.trim() || null;
      frontendBuildSha = await versionBadgeLoc.getAttribute("data-frontend-sha").catch(() => null);
      backendBuildSha = await versionBadgeLoc.getAttribute("data-backend-sha").catch(() => null);
      workerBuildSha = await versionBadgeLoc.getAttribute("data-worker-sha").catch(() => null);
    }
    const parityBadgeLoc = page.locator('[data-testid="kh02-runtime-parity-badge"]').first();
    if (await parityBadgeLoc.count() > 0) {
      runtimeParityStatus = await parityBadgeLoc.getAttribute("data-runtime-status").catch(() => null);
    }

    // Screenshot 1: Initial Page Load
    const shot1 = path.join(screenshotDir, `${prefix}01_before_research.png`);
    await page.screenshot({ path: shot1, fullPage: true }).catch(() => {});
    screenshots.push(shot1);

    // Set search topic in input using stable semantic locator
    const searchTopic = options.topic || "Pet Gadgets";
    const topicLocator = page.locator('input[data-testid="kh02-research-input"]').first();
    await topicLocator.waitFor({ state: "visible", timeout: 10000 }).catch(() => null);
    if (await topicLocator.isVisible().catch(() => false)) {
      if (await topicLocator.isEnabled().catch(() => false)) {
        await topicLocator.fill(searchTopic);
        await page.waitForTimeout(300);
      } else {
        errors.push("Topic input [data-testid='kh02-research-input'] is disabled on initial load.");
      }
    }

    // Select lookback window if requested (e.g., 90D)
    const targetLookback = options.lookbackDays || 90;
    const lookbackLocator = page.locator(`button[data-testid="kh02-lookback-${targetLookback}"]`).first();
    if (await lookbackLocator.isVisible().catch(() => false)) {
      await lookbackLocator.click().catch(() => {});
      await page.waitForTimeout(200);
    }

    // Select sourceMode if requested
    if (options.sourceMode) {
      const modeTestId =
        options.sourceMode === "CACHE_ONLY"
          ? "pf-source-mode-cache-only"
          : options.sourceMode === "LIVE_ONLY"
          ? "pf-source-mode-live-only"
          : "pf-source-mode-live-with-cache-fallback";
      const modeLocator = page.locator(`button[data-testid="${modeTestId}"]`).first();
      if (await modeLocator.isVisible().catch(() => false)) {
        await modeLocator.click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    // Screenshot 2: Source Statuses and Input
    const shot2 = path.join(screenshotDir, `${prefix}02_source_statuses.png`);
    await page.screenshot({ path: shot2, fullPage: false }).catch(() => {});
    screenshots.push(shot2);

    // Trigger Research by clicking "Analyze Opportunity" button with semantic locator
    const analyzeLocator = page.locator('button[data-testid="kh02-analyze-button"]').first();
    const isBtnVisible = await analyzeLocator.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    if (isBtnVisible) {
      console.log(`[Chromium E2E] Triggering async research for '${searchTopic}'...`);

      // Set up response listener for async research submission (HTTP 202)
      const submitResponsePromise = page.waitForResponse(
        (res) => res.url().includes("/api/v1/kh02/research") && res.request().method() === "POST",
        { timeout: 15000 }
      ).catch(() => null);

      await analyzeLocator.dispatchEvent("click");
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
        const maxPollMs = 120000;
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
        const domRunId = await page.locator('[data-testid="kh02-authoritative-run-meta"]').first().getAttribute("data-research-run-id").catch(() => null);
        if (acceptedRunId && domRunId !== acceptedRunId) {
          await page.waitForTimeout(pollInterval);
          continue;
        }
        const hasCards = (await page.locator('[data-testid="pf-canonical-product-card"], [data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]').count()) > 0;
        const hasEmptyState = (await page.locator('[data-testid="kh02-empty-state"]').count()) > 0;

        if (hasCards) {
          terminalStateObserved = true;
          if (hasEmptyState) {
            emptyStateAccurate = true;
          }
          break;
        }
        if (hasEmptyState) {
          terminalStateObserved = true;
          emptyStateAccurate = true;
          break;
        }
        await page.waitForTimeout(pollInterval);
      }

      // Check candidate product cards (supports V12.4.3.2 single canonical card per product)
      const rankedCardsLoc = page.locator('[data-testid="kh02-ranked-product-card"], [data-testid="pf-canonical-product-card"][data-qualification-tier="EVERGREEN_WINNER"]');
      const provCardsLoc = page.locator('[data-testid="kh02-provisional-product-card"], [data-testid="pf-canonical-product-card"]:not([data-qualification-tier="EVERGREEN_WINNER"])');
      const rankedCount = await rankedCardsLoc.count();
      const provCount = await provCardsLoc.count();
      const shortlistSectionLoc = page.locator('[data-testid="kh02-research-shortlist-section"]');
      const shortlistCardsLoc = page.locator('[data-testid="kh02-research-shortlist-card"], [data-testid="pf-canonical-product-card"][data-qualification-tier="RESEARCH_SHORTLIST"]');
      shortlistSectionRendered = (await shortlistSectionLoc.count()) > 0;
      shortlistCardsCount = await shortlistCardsLoc.count();

      for (let i = 0; i < shortlistCardsCount; i++) {
        const sc = shortlistCardsLoc.nth(i);
        const scId = await sc.getAttribute("data-candidate-id");
        if (scId) shortlistCandidateIds.push(scId);
        const scTitle = (await sc.locator("h3, h4").first().textContent().catch(() => ""))?.trim() || "";
        if (scTitle) shortlistTitles.push(scTitle);
        if (scTitle.toLowerCase().includes("er vet")) {
          erVetBillInShortlist = true;
        }
        if (
          /\b(er vet|pos thermal printer|80mm pos|get latest price|icontrol|widgets themes|pet insurance|casino)\b/i.test(
            scTitle
          )
        ) {
          nonPhysicalNoiseInShortlist = true;
        }
      }

      // Extract candidate IDs directly from data-candidate-id attributes BEFORE switching tabs
      const authRunMetaLoc = page.locator('[data-testid="kh02-authoritative-run-meta"]').first();
      if (await authRunMetaLoc.count() > 0) {
        authoritativeRunIdInDom = await authRunMetaLoc.getAttribute("data-research-run-id").catch(() => null);
      }

      cardCount = rankedCount + provCount;
      resultsRendered = cardCount > 0 || (await page.locator('[data-testid="kh02-leaderboard-container"]').count()) > 0 || shortlistSectionRendered;
      displayedRankOrder.length = 0;

      for (let i = 0; i < rankedCount; i++) {
        const card = rankedCardsLoc.nth(i);
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          displayedCandidateIds.push(cid);
          displayedRankOrder.push(cid);

          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) {
            displayedScores[cid] = scoreVal;
          }
          const confAttr = await card.getAttribute("data-confidence");
          const confStatusAttr = await card.getAttribute("data-confidence-status");
          const confText = await card.locator(".text-emerald-400, .text-purple-300").first().textContent().catch(() => null);
          const finalConfidence = confAttr ? parseFloat(confAttr) : (confText?.trim() || confStatusAttr || null);
          if (finalConfidence !== null) {
            displayedConfidence[cid] = String(finalConfidence);
          }
          const rankAttr = await card.getAttribute("data-rank");
          const rankVal = rankAttr && rankAttr.trim() !== "" && !isNaN(parseInt(rankAttr, 10)) ? parseInt(rankAttr, 10) : null;
          renderedCards.push({
            candidateId: cid,
            rank: rankVal as any,
            score: scoreVal,
            confidence: finalConfidence !== null ? String(finalConfidence) : null,
          });
        } else {
          errors.push("Rendered ranked product card is missing required data-candidate-id attribute.");
        }
      }

      for (let i = 0; i < provCount; i++) {
        const card = provCardsLoc.nth(i);
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          if (!displayedCandidateIds.includes(cid)) {
            displayedCandidateIds.push(cid);
          }
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) {
            displayedScores[cid] = scoreVal;
          }
          const confAttr = await card.getAttribute("data-confidence");
          const confStatusAttr = await card.getAttribute("data-confidence-status");
          const finalConfidence = confAttr ? String(parseFloat(confAttr)) : (confStatusAttr || "PROVISIONAL");
          displayedConfidence[cid] = finalConfidence;
          const rankAttr = await card.getAttribute("data-rank");
          const rankVal = rankAttr && rankAttr.trim() !== "" && !isNaN(parseInt(rankAttr, 10)) ? parseInt(rankAttr, 10) : null;
          renderedCards.push({
            candidateId: cid,
            rank: rankVal as any,
            score: scoreVal,
            confidence: finalConfidence,
          });
        } else {
          errors.push("Rendered provisional product card is missing required data-candidate-id attribute.");
        }
      }

      // Check diagnostics tab if segmented tabs exist (V12.4.3.2 progressive disclosure)
      const diagTabBtn = page.locator('[data-testid="pf-tab-evidence-diagnostics"]').first();
      const recTabBtn = page.locator('[data-testid="pf-tab-recommended"]').first();
      if ((await diagTabBtn.count()) > 0) {
        await diagTabBtn.click().catch(() => {});
        await page.waitForTimeout(200);
      }

      const discPanelLoc = page.locator('[data-testid="kh02-discovery-intelligence-panel"]').first();
      discoveryIntelligencePanelRendered = (await discPanelLoc.count()) > 0;
      const funnelGridLoc = page.locator('[data-testid="kh02-coherent-funnel-grid"]').first();
      coherentFunnelRendered = (await funnelGridLoc.count()) > 0;
      const queryCovToggleLoc = page.locator('[data-testid="kh02-query-coverage-toggle"]').first();
      if ((await queryCovToggleLoc.count()) > 0) {
        await queryCovToggleLoc.click().catch(() => {});
        await page.waitForTimeout(200);
      }
      queryCoverageTableRendered =
        (await page.locator('[data-testid="kh02-query-coverage-table"]').count()) > 0;

      const rejectedCardsLoc = page.locator('[data-testid="kh02-rejected-product-card"]');
      const rejectedCount = await rejectedCardsLoc.count();
      for (let i = 0; i < rejectedCount; i++) {
        const rcText = (await rejectedCardsLoc.nth(i).textContent().catch(() => ""))?.trim() || "";
        if (rcText) rejectedTitles.push(rcText);
      }

      if ((await recTabBtn.count()) > 0) {
        await recTabBtn.click().catch(() => {});
        await page.waitForTimeout(200);
      }

      // Screenshot 3: Terminal Results / Empty State
      const shot3 = path.join(screenshotDir, `${prefix}03_leaderboard_results.png`);
      await page.screenshot({ path: shot3, fullPage: true }).catch(() => {});
      screenshots.push(shot3);

      // Verify persistence across page reload (Directive 82)
      console.log("[Chromium E2E] Testing reload persistence...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle").catch(() => null);
      await page.waitForTimeout(1000);
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });

      // Allow client-side useEffect (fetchLatestLeaderboard) to populate state
      if (cardCount > 0) {
        await page.locator('[data-testid="pf-canonical-product-card"], [data-testid="kh02-ranked-product-card"], [data-testid="kh02-provisional-product-card"]').first().waitFor({ timeout: 8000 }).catch(() => {});
      } else if (emptyStateAccurate) {
        await page.locator('[data-testid="kh02-empty-state"]').first().waitFor({ timeout: 8000 }).catch(() => {});
      }

      // After reload, leaderboard or saved state should remain consistent
      const postReloadEmpty = (await page.locator('[data-testid="kh02-empty-state"]').count()) > 0;
      const postRankedLoc = page.locator('[data-testid="kh02-ranked-product-card"], [data-testid="pf-canonical-product-card"][data-qualification-tier="EVERGREEN_WINNER"]');
      const postProvLoc = page.locator('[data-testid="kh02-provisional-product-card"], [data-testid="pf-canonical-product-card"]:not([data-qualification-tier="EVERGREEN_WINNER"])');
      const postRankedCount = await postRankedLoc.count();
      const postProvCount = await postProvLoc.count();

      for (let i = 0; i < postRankedCount; i++) {
        const card = postRankedLoc.nth(i);
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          postReloadCandidateIds.push(cid);
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) postReloadScores[cid] = scoreVal;
          const rankAttr = await card.getAttribute("data-rank");
          const rankVal = rankAttr && rankAttr.trim() !== "" && !isNaN(parseInt(rankAttr, 10)) ? parseInt(rankAttr, 10) : null;
          const confAttr = await card.getAttribute("data-confidence");
          const confStatusAttr = await card.getAttribute("data-confidence-status");
          const confText = await card.locator(".text-emerald-400, .text-purple-300").first().textContent().catch(() => null);
          const finalConfidence = confAttr ? parseFloat(confAttr) : (confText?.trim() || confStatusAttr || null);
          if (finalConfidence !== null) postReloadConfidence[cid] = String(finalConfidence);
          postReloadCards.push({
            candidateId: cid,
            rank: rankVal as any,
            score: scoreVal,
            confidence: finalConfidence !== null ? String(finalConfidence) : null,
          });
        }
      }

      for (let i = 0; i < postProvCount; i++) {
        const card = postProvLoc.nth(i);
        const cid = await card.getAttribute("data-candidate-id");
        if (cid) {
          if (!postReloadCandidateIds.includes(cid)) postReloadCandidateIds.push(cid);
          const scoreAttr = await card.getAttribute("data-opportunity-score");
          const scoreVal = scoreAttr ? parseFloat(scoreAttr) : null;
          if (scoreVal !== null) postReloadScores[cid] = scoreVal;
          const rankAttr = await card.getAttribute("data-rank");
          const rankVal = rankAttr && rankAttr.trim() !== "" && !isNaN(parseInt(rankAttr, 10)) ? parseInt(rankAttr, 10) : null;
          const confAttr = await card.getAttribute("data-confidence");
          const confStatusAttr = await card.getAttribute("data-confidence-status");
          const finalConfidence = confAttr ? parseFloat(confAttr) : (confStatusAttr || "PROVISIONAL");
          postReloadConfidence[cid] = String(finalConfidence);
          postReloadCards.push({
            candidateId: cid,
            rank: rankVal as any,
            score: scoreVal,
            confidence: String(finalConfidence),
          });
        }
      }

      const postShortlistLoc = page.locator('[data-testid="kh02-research-shortlist-card"], [data-testid="pf-canonical-product-card"][data-qualification-tier="RESEARCH_SHORTLIST"]');
      const postShortlistCount = await postShortlistLoc.count();
      for (let i = 0; i < postShortlistCount; i++) {
        const scId = await postShortlistLoc.nth(i).getAttribute("data-candidate-id");
        if (scId) postReloadShortlistCandidateIds.push(scId);
      }
      const postAuthRunMetaLoc = page.locator('[data-testid="kh02-authoritative-run-meta"]').first();
      if (await postAuthRunMetaLoc.count() > 0) {
        postReloadRunIdInDom = await postAuthRunMetaLoc.getAttribute("data-research-run-id").catch(() => null);
      }
      const shot4 = path.join(screenshotDir, `${prefix}04_after_reload.png`);
      await page.screenshot({ path: shot4, fullPage: true }).catch(() => {});
      screenshots.push(shot4);

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
    if (context && options.tracePath) {
      await context.tracing.stop({ path: options.tracePath }).catch(() => {});
    }
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const durationMs = Date.now() - start;

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
    shortlistSectionRendered,
    shortlistCardsCount,
    shortlistCandidateIds,
    shortlistTitles,
    rejectedTitles,
    erVetBillInShortlist,
    erVetBillInTopThree,
    erVetBillInProvisional,
    nonPhysicalNoiseInShortlist,
    discoveryIntelligencePanelRendered,
    coherentFunnelRendered,
    queryCoverageTableRendered,
    runtimeVersionBadgeText,
    runtimeParityStatus,
    frontendBuildSha,
    backendBuildSha,
    workerBuildSha,
    authoritativeRunIdInDom,
    postReloadShortlistCandidateIds,
    postReloadRunIdInDom,
    cardCount,
    screenshots,
    consoleLogs,
    errors,
    durationMs,
    verdict,
  };
}
