# SWAI V11.5.4 — Live Meta Pipeline & Cross-Boundary Reconciliation

**Target Release:** V11.5.4 FINAL  
**Protocol Specification:** KH-01  
**Target Market:** United States (`RESEARCH_ONLY`)

---

## 1. Executive Summary

A core defect in prior acceptance runs was that `verifyLiveMetaSource` bypassed normal worker queue processing, performed direct MCP client queries without testing queued job execution, and marked reconciliation as `LIVE_RECONCILED` without verifying HTTP API endpoints or rendered browser DOM elements.

In V11.5.4, the live verification architecture has been restructured into an authentic 7-stage cross-boundary pipeline. Furthermore, CLI execution is strictly opt-in (`--live-meta`). In offline mode, the system truthfully reports `NOT_RUN` / `LIVE_NOT_VERIFIED` for the live scope while validating offline database and UI capabilities.

---

## 2. The 7-Stage Live Pipeline Architecture

```text
 Stage 1: Explicit CLI Opt-in (--live-meta)
                    ↓
 Stage 2: Isolated Test Database & Workspace Context Allocation
                    ↓
 Stage 3: Worker-Claimed Job Execution (createDiscoveryJob -> processDueSchedulesOnce)
                    ↓
 Stage 4: Database Relational Persistence (DiscoveryRun -> DiscoveryRunAd -> CompetitorAd)
                    ↓
 Stage 5: HTTP Exact-Run Readback (GET /api/v1/discovery/meta/requests/{runId}/ads)
                    ↓
 Stage 6: Browser Explorer Readback (/explorer?platform=META&requestId={runId})
                    ↓
 Stage 7: Mathematical Cross-Boundary ID-Set Reconciliation
```

### Stage 1: CLI Opt-in
Execution is guarded by `parseAcceptanceCliArgs`. The `--live-meta` flag is required. Without it, `runLiveSource` defaults to `false`, preventing silent or unintended external network calls.

### Stage 2: Database & Workspace Context Isolation
`createLiveAcceptanceContext` allocates an ephemeral SQLite database (`test-live-acceptance-<timestamp>.db`), sets `SWAI_DB_ROLE = "INTEGRATION_TEST"`, and establishes a dedicated workspace. The active database (`prisma/dev.db`) is strictly untouched.

### Stage 3: Worker Execution
Rather than invoking `client.searchAds()` directly, `executeLiveResearchThroughWorker` creates a real `DiscoveryRun` in `PENDING` state via `createDiscoveryJob` and triggers `processDueSchedulesOnce()`. The worker claims the job, queries the Meta MCP collector, parses the results, and writes to SQLite.

### Stage 4: Database Persistence Verification
`verifyLivePersistence` queries SQLite to verify:
- `DiscoveryRun` status reached `COMPLETED`.
- `retrievedCount` and `validCount` reflect provider responses.
- `DiscoveryRunAd` links exist for every valid advertisement.
- Returns `linkedAdIds: string[]`.

### Stage 5: HTTP Readback Verification
`verifyExactRunHttpReadback` performs an authorized GET request against `/api/v1/discovery/meta/requests/{runId}/ads` on the running Next.js instance, paging through all results to collect `httpAdIds`. It checks for duplicate records and verifies that `httpAdIds` match `linkedAdIds`.

### Stage 6: Browser UI Readback
`verifyExactRunBrowserReadback` launches Playwright Chromium, navigates to `/explorer?platform=META&requestId={runId}`, waits for the exact-run banner, and extracts `data-ad-id` attributes from rendered cards (`exact-run-ad-card`).

### Stage 7: Cross-Boundary ID-Set Comparison
`compareEvidenceAcrossBoundaries` computes:
```typescript
missingInHttp = difference(databaseIds, httpIds);
unexpectedInHttp = difference(httpIds, databaseIds);
missingInBrowser = difference(databaseIds, browserIds);
unexpectedInBrowser = difference(browserIds, databaseIds);

consistent = (
  missingInHttp.length === 0 &&
  unexpectedInHttp.length === 0 &&
  missingInBrowser.length === 0 &&
  unexpectedInBrowser.length === 0
);
```
Only when `consistent === true` and all boundary ID sets are non-empty is `LIVE_RECONCILED` awarded.

---

## 3. Truthful Reporting Invariants

1. **No Simulated Live Success:** A mock fixture or offline test can never produce `LIVE_RECONCILED` or `LIVE_META_SOURCE_RECONCILIATION: PASSED`.
2. **Offline Acceptance Verdict:** When `--live-meta` is not specified or when upstream Meta credentials are unavailable, the offline release verdict is `CONDITIONALLY_ACCEPTED` and the live scope status is `NOT_RUN` / `LIVE_NOT_VERIFIED`.
3. **Boundary Mismatch Rejection:** If database persistence contains 5 ads but HTTP returns 4 or browser renders 4, reconciliation strictly returns `FAILED` and blocks live release acceptance.

---

## 4. Test Verification Evidence

The cross-boundary reconciliation logic and boundary failure conditions are verified by `tests/integration/kh01CrossBoundaryReconciliation.test.ts`:

- `detects missing ad in HTTP readback`: **PASSED**
- `detects extra ad in HTTP readback`: **PASSED**
- `detects missing ad in Browser readback`: **PASSED**
- `detects extra ad in Browser readback`: **PASSED**
- `passes when DB, HTTP, and Browser ad IDs match identically`: **PASSED**
- `rejects empty ad IDs as evidence of successful live collection`: **PASSED**
- `detects duplicate ad IDs in readback`: **PASSED**

All 7/7 tests passed.
