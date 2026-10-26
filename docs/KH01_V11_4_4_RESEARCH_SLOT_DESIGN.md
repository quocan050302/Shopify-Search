# KH-01 V11.4.4 — Research Slot Design & Global Capacity Specification

**Document Version**: V11.4.4  
**Plan**: KH-01  
**Target**: Research Worker Capacity Management & Durable Slot Reservation  
**Status**: VERIFIED & IMPLEMENTED  

---

## 1. Executive Summary & Design Decision

In previous iterations (V11.4.3), `acquireResearchSlot()`, `renewResearchSlot()`, and `releaseResearchSlot()` operated as lightweight stub functions. Specifically, `acquireResearchSlot()` checked capacity but did not create an independent durable reservation, and `releaseResearchSlot()` simply returned `true` without persisting any state changes.

In **KH-01 V11.4.4**, we audited the worker capacity model under Part 09 (Tasks 091–102). In alignment with Task 092 ("Use the database-backed KH-01 job claim itself as the authoritative capacity reservation, provided atomic cross-process capacity enforcement is demonstrably correct"), we solidified the durable slot lifecycle:
1. **Durable Reservation**: A research slot reservation is durably bound to the authoritative `SyncJob` record in SQLite/libSQL.
2. **Atomic Capacity Checking**: Before any worker can claim a job or acquire a slot, the system queries all active unexpired `RUNNING` jobs of type `KH01_LANDING_PAGE_RESEARCH`. If the count meets or exceeds `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS` (default: 2), reservation requests are atomically rejected (`null`).
3. **Explicit Persistent Release**: `releaseResearchSlot(workerId, jobId, claimToken)` now performs a database query and update. It validates that the claimant owns the job and token, zeroes out `leaseExpiresAt`, updates `releasedAt`, advances the `fencingVersion`, and persists the capacity release. Any stale or mismatched release request is rejected (`false`).
4. **Lease Renewal & Crash Recovery**: `renewResearchSlot()` verifies ownership and extends the lease. Expired slots from crashed workers are identified and recovered via `recoverInterruptedKh01Jobs()` / `recoverExpiredResearchSlots()`, which clears stale leases and resets jobs to `PENDING` with an incremented attempt count.

---

## 2. API Contract & Implementation

Located in [`src/workers/kh01Worker.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/workers/kh01Worker.ts):

### 2.1 `acquireResearchSlot(workerId, jobId, claimToken?)`
- **Behavior**: Verifies that active running jobs do not exceed the configured capacity budget (`KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS`).
- **If `jobId` is provided**: Verifies that the specific job exists and is either unleased or owned by `workerId`. Sets `slotIndex`, advances `fencingVersion`, and commits the slot reservation.
- **Return**: `ResearchSlotLease` object containing `slotId`, `slotIndex`, `workerId`, `jobId`, `claimToken`, `fencingVersion`, `leaseExpiresAt`, and `acquiredAt`. Returns `null` if capacity is exhausted.

### 2.2 `renewResearchSlot(slotLease, extendSeconds = 60)`
- **Behavior**: Verifies slot ownership in the database against `workerId` and `claimToken`. Extends the `leaseExpiresAt` by `extendSeconds` and advances `fencingVersion`.
- **Return**: `boolean` (`true` if successfully extended, `false` if ownership lost or lease expired).

### 2.3 `releaseResearchSlot(workerId, jobId, claimToken)`
- **Behavior**: Authenticates that `workerId` and `claimToken` match the active database record. Nullifies `leaseExpiresAt`, commits `releasedAt: new Date().toISOString()`, advances `fencingVersion`, and releases capacity.
- **Return**: `boolean` (`true` if released, `false` if mismatched or stale).

### 2.4 `recoverExpiredResearchSlots()`
- **Behavior**: Scans for active jobs with expired leases and safely resets them, releasing abandoned capacity for remaining workers.

---

## 3. Concurrency & Multi-Worker Verification

Verification is automated in [`tests/integration/kh01WorkerConcurrency.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/integration/kh01WorkerConcurrency.test.ts):

| Scenario | Tested Invariant | Outcome |
| :--- | :--- | :--- |
| **Budget = 1** | Worker A claims Job 1; Worker B tries to claim Job 2 -> Blocked (`null`). Worker A releases slot -> Worker B successfully claims Job 2. | **PASS** |
| **Budget = 2** | 3 jobs created; Worker 1 claims Job 1, Worker 2 claims Job 2, Worker 3 is blocked (`null`). | **PASS** |
| **Stale Release** | Worker C tries to release a slot with invalid claimToken or mismatched worker ID -> Returns `false`, capacity not released. | **PASS** |
| **Crash Recovery** | Worker crashes with active lease. Lease expires after timeout. Recovery resets job to `PENDING` and capacity is restored. | **PASS** |

---

## 4. Traceability & Integrity
- **No Mocking**: Tested against isolated SQLite instances with actual libSQL queries.
- **Zero In-Memory Drift**: State is derived from persistent storage.
