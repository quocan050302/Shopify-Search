# SWAI KH-02 V12.1.2 — CODE CHANGE REPORT

**Version:** KH-02 V12.1.2  
**Generated At:** 2026-10-26T06:53:54.653Z  

### 1. Key Changed Files & Modules

1. **`src/app/api/v1/kh02/research/route.ts`**
   - **Pre-existing defect (P0):** `POST /api/v1/kh02/research` launched an unowned asynchronous IIFE executing research immediately after enqueuing the job, conflicting with the dedicated background worker.
   - **Resolution:** Removed the unowned background IIFE in async mode. Enqueued jobs are exclusively claimed and executed by the worker (Single Executor Invariant).

2. **`src/workers/kh02Worker.ts`**
   - **Pre-existing defect (P0):** `failResearchJob`, `renewResearchJobLease`, and `completeResearchJob` suffered TOCTOU races and lacked atomic ownership checks. Stale workers could overwrite newer owners.
   - **Resolution:** Implemented atomic compare-and-swap update guard (`updateJobIfClaimOwned`) matching `status: RUNNING` and the specific worker `fencingToken`. Added `ResearchHeartbeatManager` for continuous active lease renewal.

3. **`src/services/kh02/persistence/kh02PersistenceService.ts`**
   - **Pre-existing defect (P0):** Reconcile cross-layers function reported `persistedSnapshotMatchesHttp: true` without making a real HTTP request. Test teardown used unscoped `deleteMany({})`.
   - **Resolution:** Implemented `TestFixtureRegistry` and `cleanupKH02TestFixtures` for safe scoped teardown. Split reconciliation into `reconcilePersistedResearch` (DB) and genuine `reconcileResearchAcrossLayers` with actual HTTP request readback.

4. **`src/services/kh02/providers/metaResearchAdapter.ts`**
   - **Pre-existing defect (P1):** `resolveMetaMarketProvenance` treated data source `supportedRegions` as proof of verified US delivery for an individual ad.
   - **Resolution:** Explicit ad-level delivery region is strictly required for `marketVerification: "VERIFIED"`; data source supported regions are classified truthfully as `INFERRED`.

5. **`src/services/kh02/providers/sourceRegistry.ts`**
   - **Pre-existing defect (P1):** Meta Ads and Demand History returned hardcoded `SOURCE_DATA_VERIFIED` regardless of actual observation state.
   - **Resolution:** Meta Ads reports `SOURCE_ACCESS_VERIFIED` (local DB index); Demand History reports `CONFIGURED` policy engine.

6. **`src/app/products/page.tsx` & `scripts/kh02/runKh02BrowserE2E.ts`**
   - **Pre-existing defect (P1):** Browser E2E counted arbitrary CSS container classes like `[class*="border"]`.
   - **Resolution:** Added explicit semantic `data-testid` attributes (`kh02-research-input`, `kh02-analyze-button`, `kh02-source-status-bar`, `kh02-ranked-product-card`, `kh02-provisional-product-card`, `kh02-leaderboard-container`) and updated browser driver to assert on exact product card selectors.
