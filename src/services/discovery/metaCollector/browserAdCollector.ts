/**
 * SWAI V11.6.1 — Chromium Browser Exact-Run Ad Collector (Sections 05 & 06)
 *
 * Traverses all pages of the exact-run Ads Explorer (/explorer?platform=META&requestId=<DiscoveryRunId>)
 * using observable DOM state, collecting stable data-ad-id attributes, detecting traversal defects,
 * and saving page-level evidence and screenshots.
 */

import path from "path";
import { findDuplicateIds } from "./metaExactReconciliation";

export interface BrowserPageEvidence {
  pageNumber: number;
  reportedTotalPages: number | null;
  reportedTotalCount: number | null;
  adIds: string[];
  screenshotPath?: string;
  requestUrl?: string;
  errors: string[];
}

export interface BrowserAdCollectionResult {
  status: "PASSED" | "FAILED" | "NOT_VERIFIED";
  discoveryRunId: string;
  visitedPages: number[];
  expectedPages: number;
  renderedIds: string[];
  uniqueRenderedIds: string[];
  duplicateIds: string[];
  pageEvidence: BrowserPageEvidence[];
  paginationCompleted: boolean;
  errors: string[];
}

export interface CollectBrowserAdIdsOptions {
  expectedRunId: string;
  expectedTotal: number;
  maximumPages?: number;
  timeoutMs?: number;
  outDir?: string;
}

export async function collectExactRunBrowserAdIds(
  page: any,
  options: CollectBrowserAdIdsOptions
): Promise<BrowserAdCollectionResult> {
  const maxPages = options.maximumPages || 10;
  const timeoutMs = options.timeoutMs || 25000;
  const errors: string[] = [];
  const visitedPages: number[] = [];
  const renderedIds: string[] = [];
  const pageEvidence: BrowserPageEvidence[] = [];

  let currentPage = 1;
  let reportedTotalPages = 1;
  let paginationCompleted = false;

  while (currentPage <= maxPages) {
    visitedPages.push(currentPage);

    // 1. Wait for observable readiness: loading text finishes
    try {
      await page.waitForFunction(
        () => {
          const loadingText =
            document.body.innerText.includes("Loading research library...") ||
            document.body.innerText.includes("Loading Ads Explorer...");
          return !loadingText;
        },
        { timeout: timeoutMs }
      );

      // Wait for exact-run cards or empty/error message
      await page.waitForFunction(
        () => {
          const cards = document.querySelectorAll("[data-testid='exact-run-ad-card']");
          const empty =
            document.body.innerText.includes("No verified ads in your research library") ||
            document.body.innerText.includes("No advertisements found") ||
            document.body.innerText.includes("contains no advertisements");
          const error = document.querySelector(".text-red-400, .text-rose-400, [role='alert']");
          return cards.length > 0 || empty || error !== null;
        },
        { timeout: timeoutMs }
      );
    } catch (waitErr) {
      const msg = `Timeout waiting for page ${currentPage} readiness: ${(waitErr as Error).message}`;
      errors.push(msg);
      if (options.outDir) {
        await page.screenshot({ path: path.join(options.outDir, `explorer-timeout-page-${currentPage}.png`), fullPage: false }).catch(() => {});
      }
      break;
    }

    // 2. Read pagination info from DOM
    const paginationInfo = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span"));
      for (const s of spans) {
        const text = s.innerText || s.textContent || "";
        const m = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        if (m) {
          return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
        }
      }
      return null;
    });

    if (paginationInfo) {
      reportedTotalPages = paginationInfo.total;
      if (paginationInfo.current !== currentPage) {
        errors.push(`Page counter mismatch on page ${currentPage}: DOM reports current page is ${paginationInfo.current}`);
      }
    } else {
      // If no "Page X of Y" is visible, total pages <= 1
      reportedTotalPages = 1;
    }

    // 3. Extract ad IDs on this page
    const pageAdIds: string[] = await page
      .locator("[data-testid='exact-run-ad-card']")
      .evaluateAll((elements: any[]) =>
        elements
          .map((el) => el.getAttribute("data-ad-id"))
          .filter((id) => Boolean(id && typeof id === "string"))
          .map((id) => id.trim())
      );

    renderedIds.push(...pageAdIds);

    // 4. Capture screenshot for this page
    let screenshotPath: string | undefined;
    if (options.outDir) {
      screenshotPath = path.join(options.outDir, `explorer-page-${currentPage}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    }

    pageEvidence.push({
      pageNumber: currentPage,
      reportedTotalPages,
      reportedTotalCount: options.expectedTotal,
      adIds: pageAdIds,
      screenshotPath,
      requestUrl: page.url(),
      errors: pageAdIds.length === 0 && options.expectedTotal > 0 ? [`Page ${currentPage} returned 0 cards`] : [],
    });

    // 5. Check if we reached the last page
    if (currentPage >= reportedTotalPages) {
      paginationCompleted = true;
      if (options.outDir) {
        // Also save explorer-last-page.png and screenshot.png for backward compatibility
        const lastPageScreenshot = path.join(options.outDir, "explorer-last-page.png");
        const defaultScreenshot = path.join(options.outDir, "screenshot.png");
        await page.screenshot({ path: lastPageScreenshot, fullPage: false }).catch(() => {});
        await page.screenshot({ path: defaultScreenshot, fullPage: false }).catch(() => {});
      }
      break;
    }

    // 6. Advance to next page via Next button
    const nextBtn = page.locator("button:has-text('Next')").first();
    const isVisible = await nextBtn.isVisible().catch(() => false);
    const isEnabled = isVisible && (await nextBtn.isEnabled().catch(() => false));

    if (!isEnabled) {
      if (currentPage < reportedTotalPages) {
        errors.push(`Next button is disabled on page ${currentPage} before reaching total pages (${reportedTotalPages}).`);
      }
      break;
    }

    const previousPage = currentPage;
    const targetPage = previousPage + 1;

    // Wait for exact-run ads API response for targetPage before collecting IDs (Section 06, Step 5)
    try {
      const responsePromise = page.waitForResponse(
        (resp: any) =>
          resp.url().includes("/api/v1/discovery/meta/requests/") &&
          resp.url().includes(`page=${targetPage}`) &&
          resp.status() === 200,
        { timeout: timeoutMs }
      );

      await nextBtn.click();
      await responsePromise;

      // Wait until pagination text advances to targetPage
      await page.waitForFunction(
        (tPage: number) => {
          const spans = Array.from(document.querySelectorAll("span"));
          return spans.some((s) => {
            const txt = s.innerText || s.textContent || "";
            return txt.includes(`Page ${tPage} of`);
          });
        },
        targetPage,
        { timeout: timeoutMs }
      );

      // Wait for loading text to finish
      await page.waitForFunction(
        () => {
          const loadingText =
            document.body.innerText.includes("Loading research library...") ||
            document.body.innerText.includes("Loading Ads Explorer...");
          return !loadingText;
        },
        { timeout: timeoutMs }
      );

      currentPage = targetPage;
    } catch (navErr) {
      errors.push(`Page did not advance from page ${previousPage} to ${targetPage}: ${(navErr as Error).message}`);
      if (options.outDir) {
        await page.screenshot({ path: path.join(options.outDir, `explorer-nav-fail-page-${targetPage}.png`), fullPage: false }).catch(() => {});
      }
      break;
    }
  }

  // Detect duplicates across all observed pages
  const duplicateIds = findDuplicateIds(renderedIds);
  if (duplicateIds.length > 0) {
    errors.push(`Duplicate ad IDs detected across browser pages: ${duplicateIds.join(", ")}`);
  }

  const uniqueRenderedIds = Array.from(new Set(renderedIds));

  if (!paginationCompleted) {
    errors.push(`Pagination traversal stopped at page ${currentPage} without completing all ${reportedTotalPages} pages.`);
  }

  if (options.expectedTotal > 0 && uniqueRenderedIds.length !== options.expectedTotal) {
    errors.push(`Browser card count mismatch: observed ${uniqueRenderedIds.length} unique cards, expected ${options.expectedTotal}.`);
  }

  const status: "PASSED" | "FAILED" | "NOT_VERIFIED" =
    errors.length === 0 && paginationCompleted && (options.expectedTotal === 0 || uniqueRenderedIds.length === options.expectedTotal)
      ? "PASSED"
      : "FAILED";

  return {
    status,
    discoveryRunId: options.expectedRunId,
    visitedPages,
    expectedPages: reportedTotalPages,
    renderedIds,
    uniqueRenderedIds,
    duplicateIds,
    pageEvidence,
    paginationCompleted,
    errors,
  };
}
