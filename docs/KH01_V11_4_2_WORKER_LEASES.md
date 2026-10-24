# KH-01 V11.4.2 — Worker Leases, Claim Fencing & Job States

## 1. Overview
In KH-01 V11.4.1, job lease duration was inconsistently documented (documented as 60s, implemented as 5 minutes), recovery falsely selected jobs based on `startedAt < threshold` rather than actual lease expiration, recovery prematurely incremented `attemptNumber` leading to double-increment bugs upon subsequent claims, and stale workers whose claims expired were able to write failure states over active subsequent worker claims.

In KH-01 V11.4.2 (Checkpoint 3), the worker lifecycle, claim fencing, heartbeat separation, and recovery mechanics have been formally hardened and proven with unit tests.

## 2. Functions Audited & Modified

| File | Function / Symbol | Changes |
| :--- | :--- | :--- |
| `src/workers/kh01Worker.ts` | `KH01_LEASE_DURATION_MS` | Normalized to canonical 60,000 ms (60 seconds). |
| `src/workers/kh01Worker.ts` | `assertValidJobPayload` | Validates `targetUrl` and runtime types before attempting claim. |
| `src/workers/kh01Worker.ts` | `claimPendingKh01Job` | Atomic transition with unpredictable UUID token, tracks `lastHeartbeatAt` and `leaseExpiresAt`, single attempt increment. |
| `src/workers/kh01Worker.ts` | `assertActiveJobLease` | Checks jobType, status `RUNNING`, matching `workerId` and `claimToken`, unexpired lease, and `!cancellationRequested`. |
| `src/workers/kh01Worker.ts` | `renewKh01Lease` | Updates `leaseExpiresAt` and `lastHeartbeatAt` conditioned on status `RUNNING` and matching claim token. |
| `src/workers/kh01Worker.ts` | `executeKh01Job` | Guarded catch block: verifies claim ownership before writing failure; stale workers cannot overwrite state. |
| `src/workers/kh01Worker.ts` | `recoverInterruptedKh01Jobs` | Evaluates actual `leaseExpiresAt < Date.now()`, preserves `attemptNumber` without pre-incrementing (Task 082), resets to `PENDING` if attempt < 3, else `FAILED`. |
| `src/services/research/landingPageInspectionService.ts` | `executeLandingPageResearchJob` | Enforces claim-only execution (`ClaimedKh01Job`), verifies lease and claim token before running. |
| `src/app/api/v1/research/jobs/[jobId]/route.ts` | `GET` handler | Separates `lastHeartbeatAt` from `leaseExpiresAt` (previously returned lease as heartbeat), updates version to `11.4.2`. |

## 3. Strict Rules Enforced
1. **Single Attempt Increment Rule (Task 082)**:
   - When a job's lease expires, `recoverInterruptedKh01Jobs` resets the job to `PENDING` while keeping `attemptNumber: attempt`.
   - The attempt count increments *strictly and only once* when an eligible worker actually claims the pending job in `claimPendingKh01Job`.
2. **Lease Expiration-Based Recovery (Task 081)**:
   - Jobs are recovered when `new Date(meta.leaseExpiresAt).getTime() < Date.now()`.
   - An actively running job that repeatedly renews its lease will never be erroneously marked stale just because its `startedAt` was in the past.
3. **Claim Fencing & Stale Worker Protection (Task 080)**:
   - If Worker A's lease expires and Worker B claims the job, Worker A's subsequent write (e.g., in a delayed catch block) fails assertion and does not overwrite Worker B's active execution or state.
4. **Heartbeat & Lease Separation (Task 085 & 086)**:
   - `lastHeartbeatAt` reflects worker process activity.
   - `leaseExpiresAt` reflects the exact expiration deadline of worker ownership.

## 4. Test Verification
Test suite: `tests/unit/kh01JobExecution.test.ts`
- `claims a pending job with an unpredictable claim token and lease expiration` (PASSED)
- `ensures two workers contending for the same job results in only one winner` (PASSED)
- `assertActiveJobLease verifies active claim and rejects mismatched claim tokens` (PASSED)
- `assertActiveJobLease detects and rejects expired leases` (PASSED)
- `renewKh01Lease extends active lease expiration timestamp` (PASSED)
- `recoverInterruptedKh01Jobs resets stale job to PENDING while strictly preserving research payload` (PASSED)
- `recoverInterruptedKh01Jobs transitions to FAILED when maximum attempts are exhausted` (PASSED)
- `executeLandingPageResearchJob rejects direct execution without a valid claim` (PASSED)
- `assertActiveJobLease rejects job if cancellation has been requested` (PASSED)
- `executeKh01Job prevents stale worker from overwriting state if claim ownership was lost` (PASSED)

Total: 10/10 tests passed.
