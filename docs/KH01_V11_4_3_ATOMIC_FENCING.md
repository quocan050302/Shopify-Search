# KH-01 V11.4.3 — Atomic Database-Backed Worker Claim Fencing

## 1. Overview
In prior versions (V11.4.2 and earlier), worker lease renewals and progress updates relied on a two-step read-then-write pattern:
1. `assertActiveJobLease(jobId, workerId, claimToken)` performed a `findUnique` query and verified JSON metadata in memory.
2. The subsequent update was filtered primarily by `{ id: jobId, status: "RUNNING" }`.

This created a race window where another worker could recover or re-claim a job after step 1, yet the stale worker would still overwrite `resultJson` or set terminal statuses (`FAILED`/`COMPLETED`) in step 2.

## 2. Architectural Repair
In V11.4.3:
1. **Monotonic Fencing Version**:
   - Each claimed job carries a `fencingVersion` counter.
   - When claimed by `claimPendingKh01Job()`, `fencingVersion` initializes to `(existing.fencingVersion || 0) + 1`.
   - Every state mutation via `updateJobIfClaimOwned()` increments `fencingVersion`.
2. **Database-Enforced Conditional Updates**:
   - `updateJobIfClaimOwned(claim: ClaimedKh01Job, patch: Kh01OwnedJobPatch)` executes inside a serialized SQLite transaction lock (`prisma.$transaction`).
   - The transaction verifies:
     - `job.status === "RUNNING"`
     - `meta.workerId === claim.workerId`
     - `meta.claimToken === claim.claimToken`
     - `meta.fencingVersion === claim.fencingVersion`
     - `meta.leaseExpiresAt >= Date.now()`
     - `!meta.cancellationRequested`
   - If any check fails, the transaction makes zero mutations and returns `false`.
3. **Safe Lease Renewal**:
   - `renewKh01Lease(claim: ClaimedKh01Job)` delegates strictly to `updateJobIfClaimOwned()`, advancing the lease deadline atomically without risk of overwriting newer claims.
4. **Stale Recovery Protection**:
   - `recoverInterruptedKh01Jobs()` performs a conditional database check inside a transaction, verifying that the lease has not been renewed concurrently before reverting a job to `PENDING`.

## 3. Test Verification
Verified in `tests/unit/kh01JobExecution.test.ts`:
- `updateJobIfClaimOwned rejects mutation when claim token or fencing version does not match` (PASSED)
- `renewKh01Lease fails safely when claim ownership has been lost` (PASSED)
- `executeKh01Job prevents stale worker from overwriting state if claim ownership was lost` (PASSED)
- `cancelKh01Job authoritatively marks job cancelled and prevents subsequent claim updates` (PASSED)
