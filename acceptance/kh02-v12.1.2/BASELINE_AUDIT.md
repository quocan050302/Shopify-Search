# SWAI KH-02 V12.1.2 — BASELINE AUDIT

**Date:** 2026-10-26  
**Repository:** `quocan050302/Shopify-Search`  
**Current HEAD SHA:** `715b9b010e28424ad8967133c778fa47c495d337`  
**Protected QA Baseline SHA:** `6c80ab406566f46f0a969fa54be18bfadbd24a61`  
**Previous Working Branch:** `feature/kh02-v12.1.1-runtime-acceptance`  
**Active Working Branch:** `feature/kh02-v12.1.2-acceptance-truthfulness`  
**Execution Objective:** Resolve confirmed P0/P1 runtime ownership, execution fencing, test cleanup safety, and acceptance truthfulness defects without breaking KH-01.

---

## 1. Branch Ancestry & Baseline Results

1. **Repository Heritage:**
   - `origin/QA` (`6c80ab4`) is the protected baseline.
   - `feature/kh02-v12.1-evergreen-hardening` (`c4c943d`) merged core evergreen intelligence models.
   - `feature/kh02-v12.1.1-runtime-acceptance` (`715b9b0`) hardened real-source adapters, HasData credits, worker leasing, and Chromium E2E harness.
   - Current active branch: `feature/kh02-v12.1.2-acceptance-truthfulness`.

2. **Baseline Verification Results:**
   - `npm run kh01:verify`: **PASS** (5 suites, 69 tests passed, 0 regressions, 10.48s duration).
   - `npx vitest run tests/unit/kh02`: **PASS** (6 suites, 45 tests passed, 10.68s duration).
   - `npx vitest run tests/integration/kh02`: **PASS** (4 suites, 15 tests passed, 15.36s duration).
   - `npx tsc --noEmit`: **PASS** (0 errors).

---

## 2. Confirmed Defect Inventory

| Defect ID | Severity | Affected Component | Previous Flawed Behavior | Required Correction |
|---|---|---|---|---|
| **D-01** | **P0** | `src/app/api/v1/kh02/research/route.ts` | `POST /api/v1/kh02/research` launched an unowned asynchronous IIFE calling `runEvergreenProductResearch` right after calling `enqueueResearchJob`. Simultaneously, the background worker claimed and ran the same job. | Remove unowned IIFE execution in async mode. Worker owns job execution. In sync mode, require exclusive lease ownership and prevent queue push. |
| **D-02** | **P0** | `src/workers/kh02Worker.ts` | `failResearchJob` updated `SyncJob` to `FAILED` by `where: { id: jobId }` without verifying active ownership or fencing version. A stale crashed worker could fail a newer worker's active job. | Atomic ownership-aware failure transition: `where: { id: jobId, status: "RUNNING" }` validating workerId and fencingToken. |
| **D-03** | **P0** | `src/workers/kh02Worker.ts` | Read-then-write pattern in `renewResearchJobLease`, `updateResearchProgress`, `completeResearchJob`, and `recoverStaleResearchJobs` created TOCTOU races between concurrent workers. | Implement atomic compare-and-swap update guard (`updateJobIfClaimOwned`) matching status, worker ID, and monotonic fencing version. |
| **D-04** | **P0** | `scripts/kh02/runAcceptanceV12_1_1.ts` | Harness wrote static `"PASS (200 OK)"`, `testsPassed: 69`, and hardcoded `CONDITIONAL GO` without executing real HTTP requests or parsing child process results. | Build `runAcceptanceV12_1_2.ts` with `executeAcceptanceCommand` capturing real child exit codes, output parsing, real HTTP requests, and dynamic verdict calculation. |
| **D-05** | **P0** | `src/services/kh02/persistence/kh02PersistenceService.ts` | `reconcileResearchAcrossLayers` asserted `persistedSnapshotMatchesHttp: true` from internal snapshot check alone without making an actual HTTP request. | Split into `reconcilePersistedResearch` and real `reconcileResearchAcrossLayers` that performs actual HTTP fetch and browser comparison. |
| **D-06** | **P0** | `tests/integration/kh02HttpServerE2E.test.ts` | Teardown invoked `prisma.competitorAd.deleteMany({})`, `advertiser.deleteMany({})`, and `watchlistItem.deleteMany({})` wiping unrelated records. | Create `TestFixtureRegistry` tracking created IDs and scoped cleanup `cleanupKH02TestFixtures` with sentinel isolation verification. |
| **D-07** | **P1** | `src/workers/kh02Worker.ts` | No active interval heartbeat during long-running source execution; lease could expire if provider queries take > 60s. | Add `startResearchHeartbeat()` / `stopResearchHeartbeat()` with active periodic renewal and cancellation on lost lease. |
| **D-08** | **P1** | `scripts/kh02/runKh02BrowserE2E.ts` | DOM card count used generic selector `[class*="border"], [class*="card"], [class*="rounded"]`. | Add explicit semantic `data-testid` attributes on `/products` and update E2E driver to use stable selectors. |
| **D-09** | **P1** | `src/services/kh02/providers/metaResearchAdapter.ts` | `resolveMetaMarketProvenance` treated `dataSource.supportedRegions.includes("US")` as proof of verified US delivery for an individual ad. | Do not verify ad delivery market from source supported regions alone; require ad-level region or classify as `INFERRED`. |
| **D-10** | **P1** | `src/services/kh02/providers/sourceRegistry.ts` | Hardcoded `SOURCE_DATA_VERIFIED` for Meta Ads and Demand History regardless of whether observations exist. | Separate transport connection, provider configuration, and verified observation availability. |

---

## 3. Shared Component & KH-01 Compatibility Map

- **Prisma Model `SyncJob`**: Shared with KH-01. Any schema or query modifications must be strictly additive and backwards-compatible with `jobType: "KH02_RESEARCH"`.
- **Database Tables**: No global table wipes (`deleteMany({})`). All tests must clean up only their own fixture IDs.
- **HTTP Routing**: `POST /api/v1/kh02/research` maintains both synchronous (HTTP 200) and asynchronous (HTTP 202) contracts.
- **Source Adapters**: Meta, Google MCP, HasData, and TikTok adapters are modularized under `src/services/kh02/` and do not alter KH-01 collector services.

---

## 4. Implementation Plan (Phases)

1. **Phase 1: Research Execution Ownership & Worker Fencing**
   - Repair `src/app/api/v1/kh02/research/route.ts`: Remove unowned IIFE in async mode; ensure synchronous mode acquires exclusive lease without pushing to queue.
   - Implement `updateJobIfClaimOwned` in `src/workers/kh02Worker.ts` for atomic compare-and-swap transitions.
   - Implement active heartbeat scheduling (`startResearchHeartbeat`, `stopResearchHeartbeat`).
   - Fix `failResearchJob` and `recoverStaleResearchJobs` with ownership validation.

2. **Phase 2: Source Provenance & Readiness Truthfulness**
   - Refine `resolveMetaMarketProvenance` in `metaResearchAdapter.ts`: Remove false delivery market verification from `supportedRegions`.
   - Refine `checkKH02ProviderReadiness` in `sourceRegistry.ts`: Separate data availability from provider connection.

3. **Phase 3: Safe Scoped Test Cleanup & Isolated DB Protection**
   - Implement `cleanupKH02TestFixtures` and `TestFixtureRegistry`.
   - Update `tests/integration/kh02HttpServerE2E.test.ts` to use scoped deletion and sentinel verification.

4. **Phase 4: Frontend Stability & Semantic Test Selectors**
   - Add `data-testid` attributes to `src/app/products/page.tsx`.
   - Update `scripts/kh02/runKh02BrowserE2E.ts` to assert on exact product card selectors.

5. **Phase 5: Real Acceptance Harness & Independent Verification**
   - Implement `scripts/kh02/runAcceptanceV12_1_2.ts` with `executeAcceptanceCommand`, real HTTP requests, and dynamic verdict computation.
   - Implement real `reconcileResearchAcrossLayers` comparing DB, HTTP, and browser data.
   - Run complete test suite and KH-01 regression suite.
   - Generate all acceptance artifacts in `acceptance/kh02-v12.1.2/`.
