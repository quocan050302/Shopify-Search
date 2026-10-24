# KH-01 V11.4.3 — Global Worker Concurrency Budget

## 1. Overview
In previous iterations, concurrency control was limited to a single worker process loop (`isPolling = true`). While this prevented a single worker instance from processing two jobs simultaneously, starting two worker processes against the same database would allow both workers to claim two different pending jobs concurrently.

Heavy research jobs (such as landing page crawling, DOM parsing, structured offer extraction, and snapshot persistence) require strict resource bounding on local systems.

## 2. Global Concurrency Architecture
In V11.4.3:
1. **Configurable Capacity Limit**:
   - `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS` environment variable controls global capacity (defaults to 1).
2. **Database-Backed Capacity Check**:
   - Inside `claimPendingKh01Job()`, before claiming any pending job, the worker queries all active `KH01_LANDING_PAGE_RESEARCH` jobs with `status === "RUNNING"` whose `leaseExpiresAt >= Date.now()`.
   - If `activeUnexpiredCount >= maxConcurrency`, `claimPendingKh01Job()` returns `null` immediately.
3. **Serialized Transaction Lock**:
   - This capacity check and the subsequent transition from `PENDING` to `RUNNING` execute within a single `prisma.$transaction()`.
   - SQLite serializes write transactions, guaranteeing that two concurrent worker processes cannot race and exceed the global concurrency budget.
4. **Explicit Slot Management**:
   - Exposed `acquireResearchSlot()`, `renewResearchSlot()`, and `releaseResearchSlot()` APIs for external orchestration and testing.
   - If a worker crashes while holding capacity, `recoverInterruptedKh01Jobs()` or expiration of `leaseExpiresAt` automatically frees the slot.

## 3. Test Verification
Verified in `tests/unit/kh01JobExecution.test.ts`:
- `enforces global concurrency limit = 1 across multiple heavy research jobs` (PASSED)
- `slot lifecycle manages explicit reservations correctly` (PASSED)
