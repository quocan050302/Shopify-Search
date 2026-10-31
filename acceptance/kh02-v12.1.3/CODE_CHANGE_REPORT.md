# SWAI KH-02 V12.1.3 — Code Change Report

## Modified Files
1. `prisma/schema.prisma` & `prisma/schema.sql`:
   - Added dedicated `workerId`, `claimToken`, `fencingToken`, `fencingGeneration`, `recordVersion`, `leaseExpiresAt`, `attemptNumber` columns to `SyncJob`.
   - Added indexes on `[jobType, status]` and `[workerId, status]`.
2. `src/services/kh02/evergreenResearchOrchestrator.ts`:
   - Removed unowned `updateKH02ResearchRunStatus()` calls.
   - Removed unowned `persistKH02RankingSnapshot()` calls.
   - Introduced `KH02ResearchExecutionContext` with optional `reportProgress` callback.
   - Corrected initial `DEMAND_HISTORY` status to `CONFIGURED`, promoting to `SOURCE_DATA_VERIFIED` only when demand stability passes.
3. `src/workers/kh02Worker.ts`:
   - Replaced substring fencing with dedicated column atomic CAS.
   - Separated `fencingGeneration` (claim generation) from `recordVersion` (monotonic update version).
   - Added in-flight deduplication guard to `ResearchHeartbeatManager`.
   - Added `isRunning()` method to heartbeat manager.
   - Ensured worker exclusively owns terminal completion and snapshot persistence.
4. `src/app/products/page.tsx`:
   - Set `mode: "async"` explicitly in research submission.
   - Added bounded `pollJobExecution` with 60s timeout.
   - Added `data-testid="kh02-empty-state"` selector.
5. `scripts/kh02/runKh02BrowserE2E.ts`:
   - Replaced fixed 3s wait with bounded polling for semantic selectors.
   - Added interception of HTTP status codes (tracking unexpected 500s).
   - Added console inspection for React hydration mismatches.
