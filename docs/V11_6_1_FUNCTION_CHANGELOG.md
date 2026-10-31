# SWAI V11.6.1 — Function Changelog & Architectural Integrity Log

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Version:** V11.6.1  
**Tested Implementation SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`  
**Starting Audited HEAD:** `f4750db52b214c1e9362c1d066e50865ae8ca286`  
**Branch:** `feature/v11-meta-collector-remove-muse`  
**Auditor:** ANTI (Google Deepmind)  
**Date:** 2026-10-25  

---

## 1. `runMetaLiveJourney()`

- **FILE:** `scripts/meta-live-journey.ts`
- **FUNCTION:** `runMetaLiveJourney(options: JourneyOptions): Promise<MetaLiveJourneyResult>`
- **OLD BEHAVIOR:** Evaluated success purely on `finalRun.status === "COMPLETED" && finalRun.validCount > 0`. Allowed premature `process.exit(1)` before evidence generation or resource teardown. Traversed only 2 pages in Ads Explorer, collected 24/25 cards, and reported success via an asymmetric subset match. Selected provider evidence via `workerProviderEvidences[0]` fallback.
- **CONFIRMED DEFECT:** Reported `VERIFIED` and exited with code 0 despite missing the 25th browser card. Skipped resource teardown when exceptions occurred.
- **ROOT CAUSE:** Lacked multi-boundary gate tracking, had incomplete pagination traversal, lacked `try/finally` lifecycle management, and used weak success predicates.
- **NEW BEHAVIOR:** Coordinates a fail-closed 7-gate verification pipeline (`source`, `worker`, `persistence`, `http`, `browser`, `reconciliation`, `artifactIntegrity`). Strictly matches provider evidence by `discoveryRunId`. Traverses all pages until pagination is complete. Executes teardown and artifact publication inside `try/finally`. Assigns `process.exitCode = result.success ? 0 : 1`.
- **INPUT CONTRACT:** `JourneyOptions { keyword: string; market: string; limit: number; isolatedDb: boolean; realSource: boolean; outDir?: string; }`
- **OUTPUT CONTRACT:** `Promise<MetaLiveJourneyResult>` containing `success: boolean; verdict: "VERIFIED" | "FAILED" | "BLOCKED"; gates: LiveJourneyGateResults; reasons: string[]; outDir: string;`
- **EXACT EXECUTION STEPS:**
  1. Validate options and forbid mock boundary flags in live mode.
  2. Perform MCP handshake and capabilities inspection.
  3. Execute read-only upstream source probe with explicit request count verification.
  4. Provision isolated ephemeral SQLite database and assert active `dev.db` safety.
  5. Start loopback Next.js test server with isolated credentials.
  6. Spawn real Discovery Worker subprocess targeting isolated DB.
  7. Submit research request via POST `/api/v1/discovery/meta/requests`.
  8. Await worker execution; match worker provider provenance by exact `discoveryRunId`.
  9. Inspect SQLite persistence and run-ad associations via Prisma.
  10. Perform exact-run HTTP readback with pagination across all available pages.
  11. Launch Chromium and traverse all Ads Explorer pages using `collectExactRunBrowserAdIds`.
  12. Reconcile ad IDs bidirectionally across DB, HTTP, and Browser DOM.
  13. Emit evidence bundle and evaluate multi-boundary verdict.
  14. In `finally`, execute `cleanupLiveJourneyResources()` and record cleanup results.
- **DEPENDENCIES:** `playwright-core`, `child_process`, `metaCollectorMcpClient`, `startSwaiTestServer`, `createIsolatedTestDatabase`.
- **ERROR HANDLING:** Traps all errors into `reasons` array; marks gates `FAILED` or `BLOCKED`; guarantees `finally` block execution.
- **RESOURCE OWNERSHIP:** Manages and guarantees teardown of MCP client, Worker child process, Next.js server, Chromium browser/context/pages, and ephemeral SQLite database.
- **SECURITY IMPLICATIONS:** Strictly protects `dev.db` from mutation; enforces workspace authorization header isolation; uses ephemeral ports and random DB names.
- **DATABASE EFFECTS:** Operates strictly within ephemeral `/var/folders/.../isolated.db`; zero migrations to `schema.prisma`.
- **UNIT TESTS:** `tests/unit/metaLiveExactReconciliation.test.ts`
- **INTEGRATION TESTS:** `tests/integration/metaLiveJourneyCleanup.test.ts`
- **BROWSER TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **ACTUAL TEST RESULT:** `VERIFIED` (Success: `true`, 25/25 ads verified across DB, HTTP, Browser).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 2. `collectExactRunBrowserAdIds()`

- **FILE:** `src/services/discovery/metaCollector/browserAdCollector.ts`
- **FUNCTION:** `collectExactRunBrowserAdIds(page: Page, options: CollectBrowserAdIdsOptions): Promise<BrowserAdCollectionResult>`
- **OLD BEHAVIOR:** Inline script in `scripts/meta-live-journey.ts` only clicked Next once, visiting Page 1 and Page 2 before terminating. Missing Page 3 (1 card).
- **CONFIRMED DEFECT:** Stopped pagination traversal prematurely, collecting 24 of 25 cards.
- **ROOT CAUSE:** Hardcoded single Next-click traversal instead of iterative loop bounded by reported total pages. Did not await HTTP API response before reading DOM cards.
- **NEW BEHAVIOR:** Iteratively traverses pages 1, 2, 3... until `currentPage >= totalPages`. On each transition, clicks Next, awaits the exact-run ads API response (`/ads?page=${targetPage}`), waits for loading text to disappear, extracts `data-ad-id` attributes, captures page screenshots (`explorer-page-N.png`), detects duplicates, and records page evidence.
- **INPUT CONTRACT:** `page: Page, options: { expectedRunId: string; expectedTotal: number; maximumPages?: number; timeoutMs?: number; outDir?: string; }`
- **OUTPUT CONTRACT:** `Promise<BrowserAdCollectionResult>` containing `status: "PASSED" | "FAILED"; visitedPages: number[]; expectedPages: number; renderedIds: string[]; uniqueRenderedIds: string[]; duplicateIds: string[]; pageEvidence: BrowserPageEvidence[]; paginationCompleted: boolean; errors: string[];`
- **EXACT EXECUTION STEPS:**
  1. Wait for loading indicators (`Loading research library...`) to disappear and card container or empty message to appear.
  2. Parse `Page N of M` from DOM to determine `reportedTotalPages`.
  3. Extract all `[data-testid='exact-run-ad-card']` `data-ad-id` values.
  4. Save screenshot for current page.
  5. If `currentPage >= reportedTotalPages`, mark `paginationCompleted = true` and exit.
  6. Set up `page.waitForResponse` listener for target page ads endpoint.
  7. Click Next button; await response and wait for page counter text to update.
  8. Repeat until last page reached.
  9. Check for cross-page duplicates and verify count against `expectedTotal`.
- **DEPENDENCIES:** `playwright-core`, `findDuplicateIds`.
- **ERROR HANDLING:** Records errors on navigation timeouts, disabled buttons prior to total pages, page count mismatches, or missing cards.
- **RESOURCE OWNERSHIP:** Borrows Playwright `page` instance without closing it; caller manages lifecycle.
- **SECURITY IMPLICATIONS:** Read-only DOM evaluation of test session.
- **DATABASE EFFECTS:** None (Browser rendering verification only).
- **UNIT TESTS:** `tests/unit/metaLiveExactReconciliation.test.ts`
- **INTEGRATION TESTS:** `tests/integration/kh01BrowserE2E.test.ts`
- **BROWSER TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **ACTUAL TEST RESULT:** `PASSED` (3 pages visited: Page 1 = 12 cards, Page 2 = 12 cards, Page 3 = 1 card; total = 25 unique cards).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/browser-pages.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 3. `findDuplicateIds()`

- **FILE:** `src/services/discovery/metaCollector/metaExactReconciliation.ts`
- **FUNCTION:** `findDuplicateIds(ids: string[]): string[]`
- **OLD BEHAVIOR:** In V11.6.0, ad IDs were inserted into a `Set<string>` immediately without duplicate tracking, discarding duplicate information.
- **CONFIRMED DEFECT:** Could not detect if a card was rendered twice across pagination boundaries.
- **ROOT CAUSE:** Deduplication occurred prior to validation.
- **NEW BEHAVIOR:** Pure function that scans the raw array in order. Returns a deterministic, sorted array of distinct duplicate IDs found.
- **INPUT CONTRACT:** `ids: string[]`
- **OUTPUT CONTRACT:** `string[]` (list of duplicate IDs, or `[]` if none).
- **EXACT EXECUTION STEPS:**
  1. Iterate over input IDs, trimming whitespace and ignoring empty entries.
  2. If ID exists in `seen`, add to `duplicates` set.
  3. Otherwise add to `seen`.
  4. Return `Array.from(duplicates).sort()`.
- **DEPENDENCIES:** None (pure TypeScript).
- **ERROR HANDLING:** Safely ignores non-string or falsy items.
- **RESOURCE OWNERSHIP:** Pure function (zero external resources).
- **SECURITY IMPLICATIONS:** None.
- **DATABASE EFFECTS:** None.
- **UNIT TESTS:** `tests/unit/metaLiveExactReconciliation.test.ts` (`findDuplicateIds` tests).
- **INTEGRATION TESTS:** N/A
- **BROWSER TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **ACTUAL TEST RESULT:** `PASSED` (4/4 duplicate detection unit tests passed).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/reconciliation-summary.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 4. `reconcileExactAdIdSets()`

- **FILE:** `src/services/discovery/metaCollector/metaExactReconciliation.ts`
- **FUNCTION:** `reconcileExactAdIdSets(input: ExactAdIdReconciliationInput): ExactAdIdReconciliationResult`
- **OLD BEHAVIOR:** Performed asymmetric subset check: `unexpectedDomIds.length === 0 && domAdIds.length > 0`. Allowed 24 browser cards to match 25 database ads.
- **CONFIRMED DEFECT:** False positive reconciliation in V11.6.0.
- **ROOT CAUSE:** Lacked bidirectional comparison (`missingFromBrowser.length === 0`) and exact length equality checks.
- **NEW BEHAVIOR:** Performs strict, bidirectional exact set comparison across Database, HTTP API, and Browser DOM. Checks `missingFromHttp`, `unexpectedInHttp`, `missingFromBrowser`, `unexpectedInBrowser`, `duplicateDatabaseIds`, `duplicateHttpIds`, `duplicateBrowserIds`, and requires exact count equality.
- **INPUT CONTRACT:** `ExactAdIdReconciliationInput { discoveryRunId, databaseIds, httpIds, browserIds, databaseStatus, httpStatus, browserStatus, browserPaginationCompleted }`
- **OUTPUT CONTRACT:** `ExactAdIdReconciliationResult { status: "PASSED" | "FAILED"; exactMatch: boolean; missingFromHttp: string[]; unexpectedInHttp: string[]; missingFromBrowser: string[]; unexpectedInBrowser: string[]; duplicateDatabaseIds: string[]; duplicateHttpIds: string[]; duplicateBrowserIds: string[]; errors: string[]; }`
- **EXACT EXECUTION STEPS:**
  1. Run `findDuplicateIds` on `databaseIds`, `httpIds`, and `browserIds`.
  2. Compute differences: `missingFromHttp = db \ http`, `unexpectedInHttp = http \ db`.
  3. Compute differences: `missingFromBrowser = db \ browser`, `unexpectedInBrowser = browser \ db`.
  4. Verify boundary status codes (`databaseStatus`, `httpStatus`, `browserStatus`).
  5. Verify `browserPaginationCompleted === true`.
  6. Require `databaseCount === httpCount === browserCount`.
  7. Return `status: "PASSED"` only if all criteria are strictly met.
- **DEPENDENCIES:** `findDuplicateIds`.
- **ERROR HANDLING:** Collects all failures into `errors` list and sets `status = "FAILED"`.
- **RESOURCE OWNERSHIP:** Pure function.
- **SECURITY IMPLICATIONS:** Guarantees data integrity across system boundaries.
- **DATABASE EFFECTS:** None.
- **UNIT TESTS:** `tests/unit/metaLiveExactReconciliation.test.ts` (REC-01 to REC-12 and Section 23 Historical Regression).
- **INTEGRATION TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **BROWSER TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **ACTUAL TEST RESULT:** `PASSED` (Historical 24/25 case confirmed to fail; 25/25 case confirmed to pass).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/reconciliation-summary.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 5. `finalizeLiveJourneyVerdict()`

- **FILE:** `src/services/discovery/metaCollector/metaExactReconciliation.ts`
- **FUNCTION:** `finalizeLiveJourneyVerdict(gates: LiveJourneyGateResults): LiveJourneyVerdict`
- **OLD BEHAVIOR:** Live journey return value evaluated only `finalRun.status === "COMPLETED" && finalRun.validCount > 0`.
- **CONFIRMED DEFECT:** Could report success even when HTTP or Browser verification failed or was skipped.
- **ROOT CAUSE:** No unified multi-gate decision function.
- **NEW BEHAVIOR:** Evaluates all 7 mandatory gates: `source`, `worker`, `persistence`, `http`, `browser`, `reconciliation`, `artifactIntegrity`. If any gate is not `PASSED`, returns `success: false` and `verdict: "FAILED"` (or `"BLOCKED"` if upstream source was blocked).
- **INPUT CONTRACT:** `LiveJourneyGateResults` mapping each boundary to `"PASSED" | "FAILED" | "BLOCKED" | "NOT_VERIFIED" | "SKIPPED"`
- **OUTPUT CONTRACT:** `{ success: boolean; verdict: "VERIFIED" | "FAILED" | "BLOCKED"; blockingReasons: string[]; }`
- **EXACT EXECUTION STEPS:**
  1. Inspect each boundary gate.
  2. If any gate is non-passed, append descriptive reason to `blockingReasons`.
  3. If source or worker was blocked by upstream provider, set `isBlocked = true`.
  4. Return `success: true, verdict: "VERIFIED"` iff all 7 gates are `"PASSED"`.
- **DEPENDENCIES:** None (pure decision logic).
- **ERROR HANDLING:** Deterministic fail-closed classification.
- **RESOURCE OWNERSHIP:** Pure function.
- **SECURITY IMPLICATIONS:** Prevents false positive acceptance claims in CI and audit logs.
- **DATABASE EFFECTS:** None.
- **UNIT TESTS:** `tests/unit/metaLiveExactReconciliation.test.ts` (REC-10, REC-11, REC-12).
- **INTEGRATION TESTS:** `tests/integration/metaLiveJourneyCleanup.test.ts`
- **BROWSER TESTS:** N/A
- **ACTUAL TEST RESULT:** `PASSED`
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/validation-verdict.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 6. `cleanupLiveJourneyResources()`

- **FILE:** `src/services/discovery/metaCollector/liveJourneyCleanup.ts`
- **FUNCTION:** `cleanupLiveJourneyResources(resources: LiveJourneyResources): Promise<CleanupResult>`
- **OLD BEHAVIOR:** Resource cleanup was performed inline at the end of the journey without `try/finally`. If an assertion or timeout occurred, teardown was bypassed.
- **CONFIRMED DEFECT:** Orphaned worker subprocesses, dangling Next.js servers, or un-deleted test database files on failure.
- **ROOT CAUSE:** Lack of a centralized, idempotent teardown coordinator in a guaranteed `finally` block.
- **NEW BEHAVIOR:** Guaranteed, bounded, idempotent cleanup in deterministic order: (1) Page/Context, (2) Chromium Browser, (3) Worker child process (SIGTERM then SIGKILL), (4) Next.js test server, (5) Python MCP client, (6) Prisma disconnect, (7) Isolated DB file teardown. Returns structured report.
- **INPUT CONTRACT:** `LiveJourneyResources { page?, browserContext?, browser?, workerChild?, server?, mcpClient?, dbHandle? }`
- **OUTPUT CONTRACT:** `Promise<CleanupResult>` detailing status of each subsystem and any cleanup errors.
- **EXACT EXECUTION STEPS:**
  1. Close open browser page and context if not closed.
  2. Close Chromium instance if connected.
  3. Send SIGTERM to worker child process, await exit with 2.5s timeout, escalate to SIGKILL if necessary.
  4. Stop Next.js server via `server.stop()`.
  5. Close Python MCP client connection.
  6. Disconnect Prisma client.
  7. Delete ephemeral SQLite database directory via `dbHandle.teardown()`.
  8. Return `CleanupResult`.
- **DEPENDENCIES:** `child_process`.
- **ERROR HANDLING:** Catches and isolates errors per subsystem; never throws; collects errors into `CleanupResult.errors`.
- **RESOURCE OWNERSHIP:** Safely disposes all active resources.
- **SECURITY IMPLICATIONS:** Eliminates process leaks and resource exhaustion; asserts `dev.db` is never touched.
- **DATABASE EFFECTS:** Deletes temporary `/var/folders/.../isolated.db`. Active `dev.db` is completely untouched.
- **UNIT TESTS:** `tests/integration/metaLiveJourneyCleanup.test.ts`
- **INTEGRATION TESTS:** `tests/integration/metaLiveJourneyCleanup.test.ts`
- **BROWSER TESTS:** N/A
- **ACTUAL TEST RESULT:** `PASSED` (All subsystems cleanly closed, 0 errors).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/cleanup-results.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 7. `inspectLiveMetaSourceResult()`

- **FILE:** `src/services/discovery/metaCollector/inspectLiveMetaSource.ts`
- **FUNCTION:** `inspectLiveMetaSourceResult(input: InspectLiveMetaSourceInput): LiveSourceInspection`
- **OLD BEHAVIOR:** Used fallback: `const requestsMade = typeof stats?.requests_made === "number" ? stats.requests_made : (resultSetId && !isFixture ? 1 : 0);`
- **CONFIRMED DEFECT:** Inferred an upstream network request merely because a `resultSetId` existed, even if no upstream request was executed or verified.
- **ROOT CAUSE:** Permissive fallback in provenance classification.
- **NEW BEHAVIOR:** Requires explicit observed numeric stats `typeof stats?.requests_made === "number" && Number.isFinite(stats.requests_made) && stats.requests_made > 0`. If absent, `upstreamRequestObserved = false`, `sourceClassification = "UNKNOWN"`, and status fails closed.
- **INPUT CONTRACT:** `InspectLiveMetaSourceInput { transport?, requestedKeyword, requestedMarket?, requestedLimit?, resultSetId?, mcpResponse?, rawAds?, error? }`
- **OUTPUT CONTRACT:** `LiveSourceInspection { upstreamRequestObserved: boolean; upstreamResponseObserved: boolean; sourceClassification: "REAL_UPSTREAM" | "TEST_FIXTURE" | "UNKNOWN"; status: "PASSED" | "FAILED" | "BLOCKED" | "NO_RESULTS"; ... }`
- **EXACT EXECUTION STEPS:**
  1. Inspect `input.mcpResponse?.job?.stats?.requests_made`.
  2. If finite number >= 0, assign `observedRequestsMade`. Otherwise `null`.
  3. Set `upstreamRequestObserved = !isFixture && observedRequestsMade !== null && observedRequestsMade > 0`.
  4. Classify source provenance as `REAL_UPSTREAM` only when upstream request and response are confirmed, transport is `stdio`/`mcp_stdio`, and valid numeric IDs exist.
- **DEPENDENCIES:** None.
- **ERROR HANDLING:** Classifies errors as `BLOCKED` (for rate limits / captchas) or `FAILED`.
- **RESOURCE OWNERSHIP:** Pure function.
- **SECURITY IMPLICATIONS:** Enforces strict provenance boundary; prevents mock/fixture or cached data from masquerading as verified live upstream.
- **DATABASE EFFECTS:** None.
- **UNIT TESTS:** `tests/unit/inspectLiveMetaSource.test.ts` (12 tests including PROV-01 to PROV-07).
- **INTEGRATION TESTS:** N/A
- **BROWSER TESTS:** N/A
- **ACTUAL TEST RESULT:** `PASSED` (12/12 unit tests passed).
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/live-source-provenance.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`

---

## 8. `discoverPage()`

- **FILE:** `src/services/discovery/providers/metaAdsCollectorProvider.ts`
- **FUNCTION:** `discoverPage(query: DiscoveryProviderQuery, cursor?: string): Promise<DiscoveryProviderPageResult>`
- **OLD BEHAVIOR:** Included fallback `else if (mcpResponse || continueRes) { upstreamReq = Boolean(mcpResponse?.result_set_id || continueRes?.result_set_id); }`
- **CONFIRMED DEFECT:** Claimed upstream execution from presence of result set ID without authoritative stats.
- **ROOT CAUSE:** Permissive fallback in provider provenance assignment.
- **NEW BEHAVIOR:** Only claims `upstreamRequestExecuted = true` when `stats.requests_made > 0` is authoritatively reported by the MCP job. If stats are absent, preserves collected ad records while setting `upstreamReq = false`.
- **INPUT CONTRACT:** `query: DiscoveryProviderQuery, cursor?: string`
- **OUTPUT CONTRACT:** `Promise<DiscoveryProviderPageResult>`
- **EXACT EXECUTION STEPS:**
  1. Execute search or pagination through Python MCP client.
  2. Normalize raw ad records into `items`.
  3. Inspect job stats: if `typeof stats?.requests_made === "number" && Number.isFinite(stats.requests_made)`, set `upstreamReq = stats.requests_made > 0`.
  4. Otherwise set `upstreamReq = false` without inferring from `result_set_id`.
  5. Return normalized result.
- **DEPENDENCIES:** `createMetaCollectorClient`, `normalizeMetaCollectorAd`.
- **ERROR HANDLING:** Translates upstream blocks and captchas into `DiscoveryError`.
- **RESOURCE OWNERSHIP:** Automatically closes MCP client in `finally`.
- **SECURITY IMPLICATIONS:** Truthful tracking of network activity and request ledgers.
- **DATABASE EFFECTS:** None in provider; caller handles persistence.
- **UNIT TESTS:** `tests/unit/discoveryProviders.test.ts`
- **INTEGRATION TESTS:** `tests/integration/kh01WorkerProviderProvenance.test.ts`
- **BROWSER TESTS:** `tests/e2e/metaLiveExplorerPagination.test.ts`
- **ACTUAL TEST RESULT:** `PASSED`
- **EVIDENCE PATH:** `artifacts/v11.6.1/live_journey_1792944162460_43d147db/worker-execution.json`
- **TESTED IMPLEMENTATION SHA:** `89a69b4a74620402e7afa6d3816cd6f0a4ef5b09`
