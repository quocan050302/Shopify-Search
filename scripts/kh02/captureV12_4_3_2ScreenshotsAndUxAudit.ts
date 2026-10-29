/**
 * SWAI KH-02 V12.4.3.2 — Chromium Visual, UX, Responsive, Accessibility & Performance Auditor
 *
 * Captures all 12 required Chromium screenshots and produces verifiable measurements for:
 * - Information Architecture (R13)
 * - Single Canonical Product Card Rule (R14)
 * - Progressive Disclosure of Diagnostics (R15)
 * - Responsive Desktop / Tablet / Mobile Layout (R16)
 * - Accessibility & Keyboard Navigation (R17)
 * - UI Performance & Bundle Discipline (R18)
 * - Reload & History Switching Persistence (R20)
 * - KH-02 to KH-01 Product Intelligence Reconciliation & Back Navigation (R10)
 */

import fs from "fs";
import path from "path";
import { chromium, Browser, BrowserContext } from "playwright-core";
import { verifyZeroDuplicateRenderedCandidates } from "@/services/kh02/acceptance/gateAndAsyncVerifierV12_4_3_2";

export interface V12_4_3_2UxVisualAuditResult {
  executed: boolean;
  screenshotsCaptured: Record<
    string,
    {
      filename: string;
      fullPath: string;
      exists: boolean;
      sizeBytes: number;
      viewport: string;
      description: string;
    }
  >;
  informationArchitecture: {
    headerPresent: boolean;
    commandBarPresent: boolean;
    statusSummaryPresent: boolean;
    tabsPresent: boolean;
    recommendedTabPresent: boolean;
    allCandidatesTabPresent: boolean;
    evidenceDiagnosticsTabPresent: boolean;
    statusSummaryMetricCount: number;
    pass: boolean;
  };
  canonicalCardAudit: {
    recommendedCardsCount: number;
    renderedCandidateIds: string[];
    renderedProductKeys: string[];
    duplicateIds: string[];
    legacyDuplicateShortlistCardsInRecommended: number;
    legacyDuplicateProvisionalCardsInRecommended: number;
    pass: boolean;
  };
  progressiveDisclosure: {
    diagnosticsHiddenOnRecommendedTab: boolean;
    diagnosticsVisibleOnDiagnosticsTab: boolean;
    candidateExplorerVisibleOnAllCandidatesTab: boolean;
    slideOverDrawerOpensAndCloses: boolean;
    historyDrawerOpensAndCloses: boolean;
    pass: boolean;
  };
  responsiveAudit: {
    desktop1440: { width: number; scrollWidth: number; noHorizontalOverflow: boolean };
    tablet768: { width: number; scrollWidth: number; noHorizontalOverflow: boolean };
    mobile375: { width: number; scrollWidth: number; noHorizontalOverflow: boolean; mobileCardsVisible: boolean };
    mobile320: { width: number; scrollWidth: number; noHorizontalOverflow: boolean };
    pass: boolean;
  };
  accessibilityAudit: {
    searchInputLabelled: boolean;
    sourceModeSelectLabelled: boolean;
    marketSelectLabelled: boolean;
    escapeClosesHistoryDrawer: boolean;
    escapeClosesCandidateDrawer: boolean;
    landmarksPresent: { header: boolean; main: boolean; h1: boolean };
    pass: boolean;
  };
  performanceAudit: {
    initialLoadMs: number;
    tabSwitchToAllCandidatesMs: number;
    tabSwitchToDiagnosticsMs: number;
    tabSwitchToRecommendedMs: number;
    filterApplyMs: number;
    drawerOpenMs: number;
    pass: boolean;
  };
  reloadAndHistoryPersistence: {
    preReloadRunId: string | null;
    postReloadRunId: string | null;
    preReloadCandidateIds: string[];
    postReloadCandidateIds: string[];
    historyRunSwitchSucceeded: boolean;
    pass: boolean;
  };
  productIntelligenceReconciliation: {
    testedProductId: string | null;
    testedRunId: string | null;
    reconciliationSectionVisible: boolean;
    kh02QualificationCardVisible: boolean;
    kh01ReadinessCardVisible: boolean;
    backButtonVisible: boolean;
    backNavigationPreservedContext: boolean;
    kh02CardText: string;
    kh01CardText: string;
    pass: boolean;
  };
  consoleErrors: string[];
  pageErrors: string[];
}

export async function runV12_4_3_2ChromiumUxAndScreenshotAudit(params: {
  baseUrl: string;
  screenshotDir: string;
  defaultRunId: string | null;
  liveOnlyRunId: string | null;
  cacheOnlyRunId: string | null;
  productIntelligenceId: string | null;
}): Promise<V12_4_3_2UxVisualAuditResult> {
  if (!fs.existsSync(params.screenshotDir)) {
    fs.mkdirSync(params.screenshotDir, { recursive: true });
  }

  const screenshotsCaptured: V12_4_3_2UxVisualAuditResult["screenshotsCaptured"] = {};
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const recordShot = async (
    page: any,
    filename: string,
    viewport: string,
    description: string,
    fullPage: boolean = false
  ) => {
    const fullPath = path.join(params.screenshotDir, filename);
    await page.screenshot({ path: fullPath, fullPage }).catch(() => {});
    const exists = fs.existsSync(fullPath);
    const sizeBytes = exists ? fs.statSync(fullPath).size : 0;
    screenshotsCaptured[filename] = {
      filename,
      fullPath: `acceptance/kh02-v12.4.3.2/screenshots/${filename}`,
      exists,
      sizeBytes,
      viewport,
      description,
    };
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("favicon")) consoleErrors.push(text);
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // 1. Initial Load & Performance Timing (1440x900)
    const loadStart = Date.now();
    const initialUrl = params.defaultRunId
      ? `${params.baseUrl}/products?runId=${encodeURIComponent(params.defaultRunId)}&topic=dog`
      : `${params.baseUrl}/products`;
    await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="pf-header"]', { timeout: 15000 });
    await page
      .waitForSelector('[data-testid="pf-canonical-product-card"], [data-testid="kh02-empty-state"]', {
        timeout: 15000,
      })
      .catch(() => null);
    await page.waitForTimeout(500);
    const initialLoadMs = Date.now() - loadStart;

    await recordShot(
      page,
      "01_product_finder_initial_desktop.png",
      "1440x900",
      "Initial desktop load of redesigned Product Finder (/products) with 4-section architecture",
      false
    );

    // Check Information Architecture
    const headerPresent = (await page.locator('[data-testid="pf-header"]').count()) > 0;
    const commandBarPresent = (await page.locator('[data-testid="pf-command-bar"]').count()) > 0;
    const statusSummaryPresent = (await page.locator('[data-testid="pf-status-summary"]').count()) > 0;
    const tabsPresent = (await page.locator('[data-testid="pf-tabs"]').count()) > 0;
    const recommendedTabPresent = (await page.locator('[data-testid="pf-tab-recommended"]').count()) > 0;
    const allCandidatesTabPresent = (await page.locator('[data-testid="pf-tab-all-candidates"]').count()) > 0;
    const evidenceDiagnosticsTabPresent =
      (await page.locator('[data-testid="pf-tab-evidence-diagnostics"]').count()) > 0;
    const statusSummaryMetricCount = await page
      .locator('[data-testid="pf-status-summary"] > div')
      .count();

    // 2. Populate Search Command Bar & Capture 02_product_finder_search_desktop.png
    const inputLoc = page.locator('[data-testid="kh02-research-input"]').first();
    await inputLoc.fill("dog");
    await page.waitForTimeout(200);
    await recordShot(
      page,
      "02_product_finder_search_desktop.png",
      "1440x900",
      "Unified Research Command Bar with topic 'dog', lookback selector, and source mode selector",
      false
    );

    // 3. Recommended Results & Single Canonical Card Audit (03_product_finder_recommended_results.png)
    await recordShot(
      page,
      "03_product_finder_recommended_results.png",
      "1440x900",
      "Recommended tab displaying single canonical product cards with zero cross-section duplication",
      true
    );

    const canonicalCards = page.locator('[data-testid="pf-canonical-product-card"]');
    const recommendedCardsCount = await canonicalCards.count();
    const renderedCandidateIds: string[] = [];
    const renderedProductKeys: string[] = [];
    for (let i = 0; i < recommendedCardsCount; i++) {
      const card = canonicalCards.nth(i);
      const cid = await card.getAttribute("data-candidate-id");
      const pkey = await card.getAttribute("data-product-key");
      if (cid) renderedCandidateIds.push(cid);
      if (pkey) renderedProductKeys.push(pkey);
    }
    const dupCheck = verifyZeroDuplicateRenderedCandidates(renderedCandidateIds);
    const legacyDuplicateShortlistCardsInRecommended = await page
      .locator('[data-testid="kh02-research-shortlist-card"]')
      .count();
    const legacyDuplicateProvisionalCardsInRecommended = await page
      .locator('[data-testid="kh02-provisional-product-card"]')
      .count();

    // Check Progressive Disclosure on Recommended Tab (diagnostics panels not mounted)
    const diagnosticsHiddenOnRecommendedTab =
      (await page.locator('[data-testid="kh02-discovery-intelligence-panel"]').count()) === 0;

    // 4. Open Slide-Over Product Research Detail Drawer & Capture 08_product_finder_research_progress.png
    let slideOverDrawerOpensAndCloses = false;
    let escapeClosesCandidateDrawer = false;
    const drawerOpenStart = Date.now();
    const viewResearchBtn = page.locator('[data-testid="pf-view-research-btn"]').first();
    if ((await viewResearchBtn.count()) > 0) {
      await viewResearchBtn.click();
      await page.waitForSelector('[data-testid="pf-candidate-drawer"]', { timeout: 5000 }).catch(() => null);
    }
    const drawerOpenMs = Date.now() - drawerOpenStart;
    const drawerOpenVisible = (await page.locator('[data-testid="pf-candidate-drawer"]').count()) > 0;

    await recordShot(
      page,
      "08_product_finder_research_progress.png",
      "1440x900",
      "Slide-Over Product Research Detail Drawer showing verified product identity, demand provenance, customer psychology, and ad creative links",
      false
    );

    if (drawerOpenVisible) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const afterEscCount = await page.locator('[data-testid="pf-candidate-drawer"]').count();
      escapeClosesCandidateDrawer = afterEscCount === 0;
      slideOverDrawerOpensAndCloses = escapeClosesCandidateDrawer;
    }

    // 5. Switch to All Candidates Tab & Capture 04_product_finder_all_candidates.png
    const tabAllStart = Date.now();
    await page.locator('[data-testid="pf-tab-all-candidates"]').click();
    await page.waitForSelector('[data-testid="pf-all-candidates-section"]', { timeout: 5000 });
    const tabSwitchToAllCandidatesMs = Date.now() - tabAllStart;

    const filterStart = Date.now();
    const qualifiedFilterBtn = page.locator('[data-testid="pf-filter-status-RESEARCH_QUALIFIED"]').first();
    if ((await qualifiedFilterBtn.count()) > 0) {
      await qualifiedFilterBtn.click();
      await page.waitForTimeout(100);
      await page.locator('[data-testid="pf-filter-status-ALL"]').first().click();
    }
    const filterApplyMs = Date.now() - filterStart;

    const candidateExplorerVisibleOnAllCandidatesTab =
      (await page.locator('[data-testid="pf-all-candidates-section"]').count()) > 0;

    await recordShot(
      page,
      "04_product_finder_all_candidates.png",
      "1440x900",
      "All Candidates explorer tab with status filter pills, family/merchant/audience filters, and structured rejection reasons",
      true
    );

    // 6. Switch to Evidence & Diagnostics Tab & Capture 05_product_finder_evidence_diagnostics.png
    const tabDiagStart = Date.now();
    await page.locator('[data-testid="pf-tab-evidence-diagnostics"]').click();
    await page.waitForSelector('[data-testid="kh02-discovery-intelligence-panel"]', { timeout: 5000 });
    const tabSwitchToDiagnosticsMs = Date.now() - tabDiagStart;

    const diagnosticsVisibleOnDiagnosticsTab =
      (await page.locator('[data-testid="kh02-discovery-intelligence-panel"]').count()) > 0 &&
      (await page.locator('[data-testid="kh02-coherent-funnel-grid"]').count()) > 0 &&
      (await page.locator('[data-testid="kh02-query-coverage-table"]').count()) > 0;

    await recordShot(
      page,
      "05_product_finder_evidence_diagnostics.png",
      "1440x900",
      "Evidence & Diagnostics tab with provider cards, query execution table, 13-stage candidate funnel, and runtime parity",
      true
    );

    // Switch back to Recommended Tab & measure latency
    const tabRecStart = Date.now();
    await page.locator('[data-testid="pf-tab-recommended"]').click();
    await page.waitForSelector('[data-testid="kh02-leaderboard-container"]', { timeout: 5000 });
    const tabSwitchToRecommendedMs = Date.now() - tabRecStart;

    // 7. Capture 06_product_finder_source_failure.png (LIVE_ONLY run)
    if (params.liveOnlyRunId) {
      await page.goto(
        `${params.baseUrl}/products?runId=${encodeURIComponent(
          params.liveOnlyRunId
        )}&sourceMode=LIVE_ONLY&tab=EVIDENCE_DIAGNOSTICS`,
        { waitUntil: "domcontentloaded", timeout: 25000 }
      );
      await page
        .waitForSelector('[data-testid="kh02-discovery-intelligence-panel"]', { timeout: 10000 })
        .catch(() => null);
      await page.waitForTimeout(400);
    }
    await recordShot(
      page,
      "06_product_finder_source_failure.png",
      "1440x900",
      "LIVE_ONLY mode showing truthful upstream Meta live query status without silent cache fallback",
      false
    );

    // 8. Capture 07_product_finder_cache_only.png (CACHE_ONLY run)
    if (params.cacheOnlyRunId) {
      await page.goto(
        `${params.baseUrl}/products?runId=${encodeURIComponent(
          params.cacheOnlyRunId
        )}&sourceMode=CACHE_ONLY&tab=EVIDENCE_DIAGNOSTICS`,
        { waitUntil: "domcontentloaded", timeout: 25000 }
      );
      await page
        .waitForSelector('[data-testid="kh02-discovery-intelligence-panel"]', { timeout: 10000 })
        .catch(() => null);
      await page.waitForTimeout(400);
    }
    await recordShot(
      page,
      "07_product_finder_cache_only.png",
      "1440x900",
      "CACHE_ONLY mode showing explicit Cache Only badge and NOT_ATTEMPTED upstream queries",
      false
    );

    // Restore default run on Recommended tab for responsive + reload + history checks
    if (params.defaultRunId) {
      await page.goto(
        `${params.baseUrl}/products?runId=${encodeURIComponent(params.defaultRunId)}&topic=dog&tab=RECOMMENDED`,
        { waitUntil: "domcontentloaded", timeout: 25000 }
      );
      await page
        .waitForSelector('[data-testid="pf-canonical-product-card"]', { timeout: 10000 })
        .catch(() => null);
      await page.waitForTimeout(400);
    }

    // 9. Accessibility & History Drawer Keyboard Audit
    const searchInputLabelled = Boolean(
      (await page.locator('[data-testid="kh02-research-input"]').getAttribute("placeholder")) ||
        (await page.locator('[data-testid="kh02-research-input"]').getAttribute("aria-label"))
    );
    const sourceModeSelectLabelled = Boolean(
      await page.locator('[data-testid="kh02-source-mode-select"]').getAttribute("aria-label")
    );
    const marketSelectLabelled = Boolean(
      await page.locator('select[aria-label="Target Market"]').count()
    );
    const landmarksPresent = {
      header: (await page.locator("header").count()) > 0,
      main: (await page.locator("main").count()) > 0,
      h1: (await page.locator("h1").count()) > 0,
    };

    let historyDrawerOpensAndCloses = false;
    let escapeClosesHistoryDrawer = false;
    let historyRunSwitchSucceeded = false;
    const histTrigger = page.locator('[data-testid="pf-history-trigger"]').first();
    if ((await histTrigger.count()) > 0) {
      await histTrigger.click();
      await page.waitForSelector('[data-testid="pf-history-drawer"]', { timeout: 5000 }).catch(() => null);
      const histOpen = (await page.locator('[data-testid="pf-history-drawer"]').count()) > 0;
      if (histOpen) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
        escapeClosesHistoryDrawer =
          (await page.locator('[data-testid="pf-history-drawer"]').count()) === 0;
        historyDrawerOpensAndCloses = escapeClosesHistoryDrawer;

        // Re-open and click a history run item to verify history switching
        await histTrigger.click();
        await page.waitForSelector('[data-testid="pf-history-drawer"]', { timeout: 5000 }).catch(() => null);
        const firstHistItem = page.locator('[data-testid="pf-history-run-item"]').first();
        if ((await firstHistItem.count()) > 0) {
          await firstHistItem.click();
          await page.waitForTimeout(400);
          historyRunSwitchSucceeded =
            (await page.locator('[data-testid="pf-history-drawer"]').count()) === 0;
        }
      }
    }

    // Ensure we are on defaultRunId before reload persistence test
    if (params.defaultRunId) {
      await page.goto(
        `${params.baseUrl}/products?runId=${encodeURIComponent(params.defaultRunId)}&topic=dog&tab=RECOMMENDED`,
        { waitUntil: "domcontentloaded", timeout: 25000 }
      );
      await page
        .waitForSelector('[data-testid="pf-canonical-product-card"]', { timeout: 10000 })
        .catch(() => null);
      await page.waitForTimeout(400);
    }

    const preReloadRunId = await page
      .locator('[data-testid="kh02-authoritative-run-meta"]')
      .first()
      .getAttribute("data-research-run-id")
      .catch(() => null);
    const preReloadCandidateIds: string[] = [];
    const preCards = page.locator('[data-testid="pf-canonical-product-card"]');
    const preCount = await preCards.count();
    for (let i = 0; i < preCount; i++) {
      const cid = await preCards.nth(i).getAttribute("data-candidate-id");
      if (cid) preReloadCandidateIds.push(cid);
    }

    await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 });
    await page
      .waitForSelector('[data-testid="pf-canonical-product-card"]', { timeout: 10000 })
      .catch(() => null);
    await page.waitForTimeout(400);

    const postReloadRunId = await page
      .locator('[data-testid="kh02-authoritative-run-meta"]')
      .first()
      .getAttribute("data-research-run-id")
      .catch(() => null);
    const postReloadCandidateIds: string[] = [];
    const postCards = page.locator('[data-testid="pf-canonical-product-card"]');
    const postCount = await postCards.count();
    for (let i = 0; i < postCount; i++) {
      const cid = await postCards.nth(i).getAttribute("data-candidate-id");
      if (cid) postReloadCandidateIds.push(cid);
    }

    // 10. Responsive Audit & Screenshots (Desktop 1440, Tablet 768, Mobile 375, Compact Mobile 320)
    const measureOverflow = async (w: number, h: number) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      const dims = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      return {
        width: dims.width,
        scrollWidth: dims.scrollWidth,
        noHorizontalOverflow: dims.scrollWidth <= dims.width + 2,
      };
    };

    const desktop1440 = await measureOverflow(1440, 900);
    const tablet768 = await measureOverflow(768, 1024);
    await recordShot(
      page,
      "09_product_finder_tablet.png",
      "768x1024",
      "Tablet responsive layout (768x1024) of Product Finder with stacked command controls and clean cards",
      false
    );

    const mobile375 = await measureOverflow(375, 812);
    await recordShot(
      page,
      "10_product_finder_mobile.png",
      "375x812",
      "Mobile responsive layout (375x812) of Product Finder with zero horizontal overflow",
      false
    );

    // Check mobile candidate cards on All Candidates tab at 375px
    await page.locator('[data-testid="pf-tab-all-candidates"]').click();
    await page.waitForTimeout(200);
    const mobileCardsVisible =
      (await page.locator('[data-testid="pf-all-candidates-mobile"]').count()) > 0;
    await page.locator('[data-testid="pf-tab-recommended"]').click();
    await page.waitForTimeout(200);

    const mobile320 = await measureOverflow(320, 812);

    // Restore 1440x900 for Product Intelligence verification
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);

    // 11. Product Intelligence Research Context & Commercial Readiness (Screenshots 11 & 12)
    let reconciliationSectionVisible = false;
    let kh02QualificationCardVisible = false;
    let kh01ReadinessCardVisible = false;
    let backButtonVisible = false;
    let backNavigationPreservedContext = false;
    let kh02CardText = "";
    let kh01CardText = "";

    const targetProductId = params.productIntelligenceId;
    const targetRunId = params.defaultRunId;
    if (targetProductId) {
      const piUrl = `${params.baseUrl}/products/${encodeURIComponent(
        targetProductId
      )}/intelligence?runId=${encodeURIComponent(
        targetRunId || ""
      )}&topic=dog&lookback=90&sourceMode=LIVE_WITH_CACHE_FALLBACK&tab=RECOMMENDED`;

      await page.goto(piUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page
        .waitForSelector('[data-testid="pi-kh02-vs-kh01-reconciliation"]', { timeout: 15000 })
        .catch(() => null);
      await page.waitForTimeout(500);

      reconciliationSectionVisible =
        (await page.locator('[data-testid="pi-kh02-vs-kh01-reconciliation"]').count()) > 0;
      kh02QualificationCardVisible =
        (await page.locator('[data-testid="pi-kh02-qualification-card"]').count()) > 0;
      kh01ReadinessCardVisible =
        (await page.locator('[data-testid="pi-kh01-readiness-card"]').count()) > 0;
      backButtonVisible =
        (await page.locator('[data-testid="pi-back-to-product-finder"]').count()) > 0;

      if (kh02QualificationCardVisible) {
        kh02CardText =
          (
            await page
              .locator('[data-testid="pi-kh02-qualification-card"]')
              .first()
              .textContent()
              .catch(() => "")
          )?.trim() || "";
      }
      if (kh01ReadinessCardVisible) {
        kh01CardText =
          (
            await page
              .locator('[data-testid="pi-kh01-readiness-card"]')
              .first()
              .textContent()
              .catch(() => "")
          )?.trim() || "";
      }

      await recordShot(
        page,
        "11_product_intelligence_research_context.png",
        "1440x900",
        "Product Intelligence page showing side-by-side Research Qualification (KH-02) vs Commercial Readiness (KH-01) reconciliation and Back to Product Finder link",
        false
      );

      await page.evaluate(() => window.scrollBy(0, 520));
      await page.waitForTimeout(300);

      await recordShot(
        page,
        "12_product_intelligence_commercial_readiness.png",
        "1440x900",
        "Product Intelligence page scrolled to Commercial Readiness metrics and Customer Psychology evidence sections",
        false
      );

      // Test context-preserving back navigation
      if (backButtonVisible) {
        await page.locator('[data-testid="pi-back-to-product-finder"]').first().click();
        await page.waitForSelector('[data-testid="pf-header"]', { timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(300);
        const returnedUrl = page.url();
        backNavigationPreservedContext =
          returnedUrl.includes("/products") &&
          (!targetRunId || returnedUrl.includes(`runId=${targetRunId}`));
      }
    }

    const iaPass =
      headerPresent &&
      commandBarPresent &&
      statusSummaryPresent &&
      tabsPresent &&
      recommendedTabPresent &&
      allCandidatesTabPresent &&
      evidenceDiagnosticsTabPresent &&
      statusSummaryMetricCount === 4;

    const canonicalPass =
      recommendedCardsCount > 0 &&
      dupCheck.pass &&
      legacyDuplicateShortlistCardsInRecommended === 0 &&
      legacyDuplicateProvisionalCardsInRecommended === 0;

    const progDisclosurePass =
      diagnosticsHiddenOnRecommendedTab &&
      diagnosticsVisibleOnDiagnosticsTab &&
      candidateExplorerVisibleOnAllCandidatesTab &&
      slideOverDrawerOpensAndCloses &&
      historyDrawerOpensAndCloses;

    const responsivePass =
      desktop1440.noHorizontalOverflow &&
      tablet768.noHorizontalOverflow &&
      mobile375.noHorizontalOverflow &&
      mobile320.noHorizontalOverflow &&
      mobileCardsVisible;

    const a11yPass =
      searchInputLabelled &&
      sourceModeSelectLabelled &&
      marketSelectLabelled &&
      escapeClosesHistoryDrawer &&
      escapeClosesCandidateDrawer &&
      landmarksPresent.header &&
      landmarksPresent.main &&
      landmarksPresent.h1;

    const perfPass =
      initialLoadMs < 15000 &&
      tabSwitchToAllCandidatesMs < 3000 &&
      tabSwitchToDiagnosticsMs < 3000 &&
      filterApplyMs < 2000;

    const reloadPass =
      Boolean(preReloadRunId) &&
      preReloadRunId === postReloadRunId &&
      preReloadCandidateIds.length === postReloadCandidateIds.length &&
      historyRunSwitchSucceeded;

    const piPass =
      reconciliationSectionVisible &&
      kh02QualificationCardVisible &&
      kh01ReadinessCardVisible &&
      backButtonVisible &&
      backNavigationPreservedContext;

    return {
      executed: true,
      screenshotsCaptured,
      informationArchitecture: {
        headerPresent,
        commandBarPresent,
        statusSummaryPresent,
        tabsPresent,
        recommendedTabPresent,
        allCandidatesTabPresent,
        evidenceDiagnosticsTabPresent,
        statusSummaryMetricCount,
        pass: iaPass,
      },
      canonicalCardAudit: {
        recommendedCardsCount,
        renderedCandidateIds,
        renderedProductKeys,
        duplicateIds: dupCheck.duplicateIds,
        legacyDuplicateShortlistCardsInRecommended,
        legacyDuplicateProvisionalCardsInRecommended,
        pass: canonicalPass,
      },
      progressiveDisclosure: {
        diagnosticsHiddenOnRecommendedTab,
        diagnosticsVisibleOnDiagnosticsTab,
        candidateExplorerVisibleOnAllCandidatesTab,
        slideOverDrawerOpensAndCloses,
        historyDrawerOpensAndCloses,
        pass: progDisclosurePass,
      },
      responsiveAudit: {
        desktop1440,
        tablet768,
        mobile375: { ...mobile375, mobileCardsVisible },
        mobile320,
        pass: responsivePass,
      },
      accessibilityAudit: {
        searchInputLabelled,
        sourceModeSelectLabelled,
        marketSelectLabelled,
        escapeClosesHistoryDrawer,
        escapeClosesCandidateDrawer,
        landmarksPresent,
        pass: a11yPass,
      },
      performanceAudit: {
        initialLoadMs,
        tabSwitchToAllCandidatesMs,
        tabSwitchToDiagnosticsMs,
        tabSwitchToRecommendedMs,
        filterApplyMs,
        drawerOpenMs,
        pass: perfPass,
      },
      reloadAndHistoryPersistence: {
        preReloadRunId,
        postReloadRunId,
        preReloadCandidateIds,
        postReloadCandidateIds,
        historyRunSwitchSucceeded,
        pass: reloadPass,
      },
      productIntelligenceReconciliation: {
        testedProductId: targetProductId,
        testedRunId: targetRunId,
        reconciliationSectionVisible,
        kh02QualificationCardVisible,
        kh01ReadinessCardVisible,
        backButtonVisible,
        backNavigationPreservedContext,
        kh02CardText,
        kh01CardText,
        pass: piPass,
      },
      consoleErrors,
      pageErrors,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

