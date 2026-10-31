# KH-01 V11.4.3 — Claim-Only Execution & Transactional Persistence

## 1. Overview
Previously, `executeLandingPageResearchJob` allowed a loose union `string | ClaimedKh01Job`, which presented an unsafe API surface allowing direct execution with only a job ID without an active claim. Furthermore, while persistence was transactional, lease ownership inside the transaction boundary did not verify `workerId` or `fencingVersion`.

## 2. Implementation Details
In V11.4.3:
1. **Strict Claim-Only Public Contract**:
   - Signature is strictly:
     `executeLandingPageResearchJob(claim: ClaimedKh01Job, signal?: AbortSignal): Promise<LandingPageResearchResult>`
   - Direct execution with a string ID or missing claim token is rejected with an explicit error.
2. **Claim-Fenced Interim Updates**:
   - Progress updates (e.g. 20% on fetch start) are executed through `updateJobIfClaimOwned(claim, { progress: 20 })`.
   - Rate limit (HTTP 429) and empty response failures are recorded conditionally through `updateJobIfClaimOwned()`.
3. **Transaction Boundary Fencing**:
   - Inside `persistCompletedResearchResult()`, both `ACCESS_RESTRICTED` and `SUCCESS` branches re-query the job inside `prisma.$transaction()`:
     - Asserts `status === "RUNNING"`
     - Asserts `workerId === claim.workerId`
     - Asserts `claimToken === claim.claimToken`
     - Asserts `fencingVersion === claim.fencingVersion`
     - Asserts `leaseExpiresAt >= Date.now()`
     - Asserts `!cancellationRequested`
   - Atomically updates `SyncJob` with monotonic increment to `fencingVersion`.
   - Prevents stale workers whose lease expired from committing snapshots or altering job state.

## 3. Test Verification
Verified in:
- `tests/unit/kh01JobExecution.test.ts`:
  - `executeLandingPageResearchJob rejects direct execution without a valid claim` (PASSED)
- `tests/unit/researchPersistence.test.ts`:
  - `persistCompletedResearchResult persists snapshots and terminal job state in a single transaction` (PASSED)
  - `persistCompletedResearchResult handles ACCESS_RESTRICTED sources truthfully without fake offer data` (PASSED)
  - `persistCompletedResearchResult provides idempotent replay for already-completed jobs` (PASSED)
  - `persistCompletedResearchResult rolls back all records if an error occurs during transaction` (PASSED)
