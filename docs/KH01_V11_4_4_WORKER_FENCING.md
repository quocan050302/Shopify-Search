# KH-01 V11.4.4 — Worker Claim Fencing & Terminal Persistence Specification

**Document Version**: V11.4.4  
**Plan**: KH-01  
**Target**: Atomic Claim Fencing, In-Memory State Safety & Terminal Persistence  
**Status**: VERIFIED & IMPLEMENTED  

---

## 1. Executive Summary & Defect Remediation

In earlier versions, `updateJobIfClaimOwned()` in `src/workers/kh01Worker.ts` possessed a subtle bug:
```ts
// Flawed implementation in V11.4.3:
claim.fencingVersion += 1;
// ... execute database update ...
if (failed) return false; // in-memory claim has already incremented fencingVersion!
```
If the database update failed due to optimistic concurrency conflicts, rollback, or connection loss, the in-memory `claim.fencingVersion` was already incremented. Any subsequent attempts to recover or reconcile using that in-memory claim object would send an invalid fencing token, causing persistent synchronization corruption.

In **KH-01 V11.4.4** (Part 10, Tasks 103–112):
1. **Defect Rectification**: In-memory version advancement is strictly deferred until AFTER database commit:
   ```ts
   const nextFencingVersion = (claim.fencingVersion || 1) + 1;
   // ... verify conditions and commit database update with nextFencingVersion ...
   // Only upon verified commit:
   claim.fencingVersion = nextFencingVersion;
   if (newLeaseExpiresAt) claim.leaseExpiresAt = newLeaseExpiresAt;
   ```
2. **Conditional Ownership Verification**:
   Updates require matching:
   - `job.id === claim.id`
   - `job.status === "RUNNING"`
   - `parsed.workerId === claim.workerId`
   - `parsed.claimToken === claim.claimToken`
   - `parsed.fencingVersion === claim.fencingVersion`
   - `parsed.leaseExpiresAt > now`
   - `job.cancelRequested !== true`
3. **Atomic Terminal Persistence**:
   `persistCompletedResearchResult()` verifies the active claim ownership atomically within the persistence transaction before committing snapshots and setting the job status to `COMPLETED`. Stale workers whose lease expired or whose claim was stolen cannot commit terminal data.

---

## 2. Tested Invariants & Test Results

Tested in [`tests/unit/kh01JobExecution.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/unit/kh01JobExecution.test.ts) and [`tests/integration/kh01WorkerConcurrency.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/integration/kh01WorkerConcurrency.test.ts):

| Invariant | Test | Result |
| :--- | :--- | :--- |
| **In-Memory Version Invariance on Failure** | Stale claim with `fencingVersion: 3` attempts update against DB record with `fencingVersion: 5`. Update returns `false`, and `claim.fencingVersion` remains strictly `3`. | **PASS** |
| **Two Workers Contending for Same Job** | Workers A and B simultaneously attempt to claim Job 1. Only one worker succeeds; the second receives `null`. | **PASS** |
| **Stale Worker Mutation Rejection** | Stale worker whose lease was expired/reassigned cannot update progress, renew lease, or commit terminal status. | **PASS** |
| **Cancellation Protection** | When a job is cancelled, subsequent worker lease renewals and terminal completions are rejected. | **PASS** |
| **Crash Recovery & Payload Preservation** | Expired lease jobs are reset to `PENDING` with payload intact and attempt count incremented. | **PASS** |

All 16 unit tests and 4 integration concurrency tests pass without error.
