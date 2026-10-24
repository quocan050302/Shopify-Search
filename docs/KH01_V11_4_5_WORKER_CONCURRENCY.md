# KH-01 V11.4.5 — Worker Concurrency Proof & Capacity Invariants

## Executive Summary
In KH-01 V11.4.4, worker concurrency verification was largely observational (`verifyWorkerConcurrency`), counting active running jobs at rest rather than proving active mutual exclusion and capacity enforcement under concurrent multi-process claim pressure (Finding D).

In KH-01 V11.4.5, active multi-worker contention tests and synchronization barriers were implemented and verified in `tests/integration/kh01WorkerConcurrency.test.ts`.

---

## Verified Invariants

### 1. Single Job Mutual Exclusion under Concurrent Claims
When two independent workers simultaneously contend to claim the exact same pending job (`job_single_contention`) using `Promise.all([claimPendingKh01Job("worker-A"), claimPendingKh01Job("worker-B")])`:
- Exactly one worker wins the claim (`status: "RUNNING"`, matching worker ID in database).
- The other worker receives `null`.
- Database transaction isolation guarantees no race condition or double assignment.

### 2. Global Concurrency Budget = 1
With `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS=1`:
- Two pending jobs (`job_conc_1` and `job_conc_2`) are queued.
- Worker A claims Job 1 successfully.
- Worker B attempts to claim Job 2 concurrently and is blocked (`null`).
- Only after Worker A releases its research slot (`releaseResearchSlot`) does capacity become available for Worker B.

### 3. Global Concurrency Budget = 2
With `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS=2`:
- Three pending jobs are queued.
- Workers 1, 2, and 3 claim simultaneously via `Promise.all`.
- Exactly 2 claims succeed; the third claim returns `null`.
- Peak active overlapping leases in the database strictly equal 2.

### 4. Peak Active Overlap Measurement
Under high contention (4 simultaneous workers contending for 4 jobs under budget 2):
- Instrumented active execution intervals verify that at no point do active unexpired leases in the database exceed the configured budget.
- Maximum observed concurrent running jobs: **2** (Configured limit: 2).
- Releasing a slot immediately unblocks the queued claimant.

---

## Test Evidence Summary
- Test Suite: `tests/integration/kh01WorkerConcurrency.test.ts`
- Tests Executed:
  1. `strictly enforces global concurrency budget = 1 across multiple workers` (**PASSED**)
  2. `strictly enforces global concurrency budget = 2 across 3 concurrent jobs` (**PASSED**)
  3. `preserves in-memory fencingVersion if transaction fails or is rejected` (**PASSED**)
  4. `enforces mutual exclusion when multiple workers contend for the exact same job simultaneously` (**PASSED**)
  5. `measures and enforces active overlap bounds under simultaneous multi-worker claims` (**PASSED**)
- Exit Code: `0`
- Concurrency State: **VERIFIED & SECURE**
