# SWAI V11.5.5 — Baseline and Root Cause Audit
## Zero Fake Pass, Real Worker, Real HTTP, Real Browser

**Specification:** KH-01 Master Acceptance Contract  
**Release Version:** V11.5.5 Final Acceptance Lock  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Starting SHA:** `726c77e7770455c261ce1abc0cb9dc70c84f6eb8`  
**Implementation Baseline:** `f29062ec5afda249fd6e743b642c79c9287f084e`  
**Operating Mode:** `RESEARCH_ONLY`  
**Target Market:** United States (US)

---

## 1. Repository & Baseline State

- **Active Branch:** `feature/v11-meta-collector-remove-muse`
- **Working Tree:** Clean, synchronized with origin.
- **Active Application Database:** `prisma/dev.db` (enforced as strictly read-only / untouched for test suites).
- **Test Database Configuration:** Ephemeral SQLite databases under `file:./prisma/test-...db` with schema pushed via `prisma db push` and connection isolation asserted via `assertSafeTestDatabase()`.
- **Server Binding Policy:** Local loopback defaults to `127.0.0.1` (`dev:local`, `start:local`). Remote deployment requires explicit authenticated credentials.

---

## 2. Confirmed Defect Matrix & Root Cause Analysis

| Defect ID | Priority | Description & Current State in V11.5.4 | Root Cause | Planned Fix in V11.5.5 |
|---|---|---|---|---|
| **FIX-01** | P1 | `executeLiveResearchThroughWorker()` calls MCP directly instead of invoking the Discovery Worker. | Direct call to `createMetaCollectorClient().searchAds()` without creating a `DiscoveryRun` or exercising `processDueSchedulesOnce()`. | Integrate `discoveryOrchestrator.createDiscoveryJob()` -> claim pending job -> execute through worker. |
| **FIX-02** | P1 | `verifyLivePersistence()` manually creates a run and calls `ingestDiscoveredAds()`, performing the worker's work. | Verification function acts as a second ingestor instead of being strictly read-only. | Make `verifyLivePersistence()` strictly read-only, inspecting the database state created by the worker. |
| **FIX-03** | P1 | `verifyExactRunHttpReadback()` invokes imported route handler directly in-memory instead of sending a TCP request. | Called `getRunAds(req, ...)` locally, skipping network stack and server binding verification. | Launch real Next.js server with `startSwaiTestServer()` and make authentic `fetch()` requests over TCP. |
| **FIX-04** | P1 | HTTP readback expects `body.ads`, but route handler actually returns `body.data`. | Property name mismatch caused empty array fallback (`body.ads \|\| []`). | Read `body.data` and validate pagination structure. |
| **FIX-05** | P1 | `verifyExactRunBrowserReadback()` fabricates browser evidence by returning `adIds: expectedAdIds`. | Checked Chromium binary existence on disk and returned input IDs without launching Chromium or navigating to the DOM. | Launch real Chromium via `playwright-core`, open `/explorer?platform=META&requestId=...`, wait for banner, and extract `[data-ad-id]`. |
| **FIX-06** | P1 | `verifyLiveMetaSource()` uses incorrect `&&` logic in cross-boundary check: `if (!crossBoundary.consistent && (httpFailed \|\| browserFailed))`. | If `crossBoundary.consistent` is true but HTTP or browser failed, or vice versa, the check could be bypassed. | Rewrite condition to `if (httpFailed \|\| browserFailed \|\| reconciliationFailed)`. |
| **FIX-07** | P1 | `levelsVerified.push("RUN_RECONCILED")` is added after database check, before HTTP/browser readback. | Reused `RUN_RECONCILED` for database arithmetic instead of true cross-boundary reconciliation. | Add `DATABASE_RECONCILED` as intermediate level; award `RUN_RECONCILED` strictly after all boundaries match. |
| **FIX-08** | P1 | Acceptance artifact publication does not fully parse and validate disk contents before final verdict. | Relied on file existence checks without schema validation or atomic publishing. | Implement `validateAcceptanceArtifact()` and validate on-disk JSON before finalizing report. |
| **FIX-09** | P1 | Localhost trust can be inferred when `HOST` is undefined under ambiguous configurations. | Permitted loopback fallback in development when binding was not explicitly attested. | Require verified loopback binding; reject `0.0.0.0` or unknown listeners in local-bypass mode. |
| **FIX-10** | P2 | `parseVitestJsonAssertions()` retains basename and title-only aliases, risking test identity collision. | Stored multiple alias keys (`file::title`, `title`) in the assertion lookup map. | Use single canonical identity `relative-path::full-test-name` without ambiguous aliases. |
| **FIX-11** | P2 | `buildBrowserArtifact()` infers viewport from stage success instead of reading executed viewport evidence. | Hardcoded or inferred viewport from unified journey without structured reporter evidence. | Extract executed viewports strictly from actual test reporter output or browser execution logs. |
| **FIX-12** | P1 | Mandatory acceptance stages do not execute `metaDiscoveryFinalAcceptance.test.ts` as a dedicated browser stage. | Browser E2E coverage was split, leaving the 6-viewport suite outside the canonical acceptance run. | Add dedicated `STAGE_08_META_DISCOVERY_BROWSER_E2E` executing the 6-viewport suite. |
| **FIX-13** | P2 | `reconcileResearchRunCounts()` falls back to `linkedCount` as `displayedCount` when unobserved. | Conflated database link counts with UI presentation counts. | Separate database counts from `httpObservedCount` and `browserObservedCount`. |
| **FIX-14** | P2 | Some artifacts summarize results without preserving the underlying observation references. | High-level summary lacked explicit test assertions or execution identifiers. | Embed source execution IDs, timestamps, and verifiable trace references in all artifacts. |
| **FIX-15** | P1 | Acceptance reports could conflate offline conditional acceptance with full live acceptance. | Did not clearly separate offline scope status from live Meta scope status. | Explicitly report `KH-01 OFFLINE SCOPE` and `KH-01 LIVE META SCOPE` as distinct verdicts. |

---

## 3. Scope of the Repairs & Execution Plan

1. **Worker & Ingestion Pipeline:** Refactor `executeLiveResearchThroughWorker` to use `discoveryOrchestrator.createDiscoveryJob()` and execute via `processDueSchedulesOnce()`. Make `verifyLivePersistence` strictly read-only.
2. **Real HTTP TCP Transport:** Refactor `verifyExactRunHttpReadback` to use `startSwaiTestServer()`, send real `fetch()` calls, parse `body.data`, and page through all results.
3. **Real Chromium Browser DOM:** Refactor `verifyExactRunBrowserReadback` to launch `playwright-core` Chromium, authenticate via cookies/headers, navigate to Explorer, and read actual `data-ad-id` attributes.
4. **Boolean & Level Logic:** Fix `if (httpFailed || browserFailed || reconciliationFailed)` and ensure `RUN_RECONCILED` is only awarded when all 3 boundaries match.
5. **Canonical Assertion Identity:** Enforce `filePath::fullName` in `parseVitestJsonAssertions` and remove ambiguous title-only aliases.
6. **Dedicated Browser E2E Stage:** Add `STAGE_08_META_DISCOVERY_BROWSER_E2E` running `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`.
7. **Artifact Validation & Atomic Publication:** Parse and validate all written artifacts from disk before finalizing the verdict.
8. **Automated Adversarial Regression Tests:** Create comprehensive tests verifying each boundary and failure injection scenario.
