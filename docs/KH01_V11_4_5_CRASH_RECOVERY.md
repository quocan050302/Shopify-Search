# KH-01 V11.4.5 — Crash Recovery & Stale Worker Rejection Proof

## Executive Summary
In KH-01 V11.4.4, crash recovery verification was an empty scan health check (`verifyWorkerRecovery`), returning `PASSED` if the scanner ran without error, even if zero jobs were recovered (Finding E). This did not prove that a crashed worker's expired lease is recovered, that immutable payloads are preserved, that retry counters are bounded, or that a stale worker cannot overwrite new progress.

In KH-01 V11.4.5, comprehensive crash recovery scenarios were verified in `tests/integration/kh01WorkerConcurrency.test.ts`.

---

## Verified Crash Recovery Scenarios

### 1. Controlled Expired Lease Transition
An isolated job (`job_full_crash_test`) was seeded in `RUNNING` status with:
- Valid immutable research input (`productId`, `adId`, `targetUrl`, `forceRefresh`, `requestedAt`).
- Worker ID (`crashed_worker_original`).
- Claim Token (`crashed_token_original`).
- Initial fencing version (`1`).
- Expired lease timestamp (30 seconds in the past).
- Attempt number (`1`).

Upon invoking `recoverInterruptedKh01Jobs()`:
- `recoveredCount` equals `1`.
- Database status transitions cleanly from `RUNNING` to `PENDING`.
- Lease expiration and claimant identifiers are cleared to allow re-claiming.

### 2. Immutable Payload Preservation
All original research parameters remained strictly intact across the recovery cycle:
- `productId` preserved: `prod_crash_recovery_test`
- `adId` preserved: `ad_crash_recovery_test`
- `targetUrl` preserved: `https://example.com/crash-recovery-test`
- `forceRefresh` preserved: `true`
- `requestedAt` preserved: `2026-10-24T12:00:00.000Z`
- Attempt count during recovery: preserved as `1` (not incremented prematurely during recovery scan).

### 3. Re-Claim and Attempt Counter Progression
When a new healthy worker (`new_worker_healthy`) claims the job:
- Job status transitions to `RUNNING`.
- `attemptNumber` increments monotonically to `2`.
- A fresh, cryptographically unpredictable `claimToken` is issued.
- `fencingVersion` advances.

### 4. Stale Claimant Mutation Rejection
The original crashed worker attempts to mutate or release the job using its old credentials:
1. `updateJobIfClaimOwned(staleClaim, { progress: 99 })`: **REJECTED** (`false`). Stale token and version cannot write to the job.
2. `releaseResearchSlot("crashed_worker_original", "job_full_crash_test", "crashed_token_original")`: **REJECTED** (`false`). Stale worker cannot release the new worker's slot.
3. `renewKh01Lease(staleClaim)`: **REJECTED** (`false`). Stale worker cannot renew lease.

### 5. Authorized Completion
The new authorized claimant successfully updates progress to 100% and marks the job `COMPLETED`.

---

## Test Evidence Summary
- Test Suite: `tests/integration/kh01WorkerConcurrency.test.ts`
- Tests Executed:
  - `verifies full crash recovery scenario, immutable payload preservation, and stale rejection` (**PASSED**)
  - `recovers expired lease after worker crash and frees capacity` (**PASSED**)
  - `preserves in-memory fencingVersion if transaction fails or is rejected` (**PASSED**)
- Recovery State: **VERIFIED & IMMUTABLE**
