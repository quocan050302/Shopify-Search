# KH-01 V11.4.1 — Research Worker & Job Execution Acceptance Report

## Executive Summary
This document records the acceptance verification of the background research job worker (`src/workers/kh01Worker.ts`), job status API contracts, lease lifecycle management, payload preservation during recovery, and single-flight execution controls.

---

## 1. Job Lifecycle & Atomic Lease Model

### Execution Contract
- **Read-Only Status**: `GET /api/v1/research/jobs/:jobId` returns `ResearchJobStatusDTO` without side effects. The legacy `?execute=true` parameter was completely removed.
- **Enqueue Contract**: `POST /api/v1/research/products/:id/landing-page-jobs` enqueues jobs into `SyncJob` with status `PENDING`.
- **Atomic Worker Claim (`claimPendingKh01Job`)**:
  - Uses conditional compare-and-set semantics on `status = "PENDING"`.
  - Transitions to `RUNNING` atomically.
  - Assigns `workerId`.
  - Generates unpredictable `claimToken = crypto.randomUUID()`.
  - Sets `leaseExpiresAt = now + 60,000ms`.
  - Increments `attemptNumber`.
- **Lease Verification & Renewal**:
  - `assertActiveJobLease(jobId, workerId, claimToken)` verifies active lease ownership before any mutating operation.
  - `renewKh01Lease(claim)` renews active lease period.

---

## 2. Payload Preservation & Crash Recovery

### Payload Contract
- Original research target options (`productId`, `adId`, `targetUrl`, `forceRefresh`) are parsed and preserved in an immutable envelope.
- `recoverInterruptedKh01Jobs()`:
  - Detects `RUNNING` jobs whose `leaseExpiresAt < now`.
  - Increments retry count up to maximum 3 attempts.
  - **Preserves original payload**: The target URL, product ID, and ad ID are never overwritten with recovery metadata.
  - Transitions to terminal `FAILED` if retry budget is exhausted.

---

## 3. Test Verification Matrix

| Test ID | Scenario | Verified Contract | Result |
| :--- | :--- | :--- | :--- |
| JOB-01 | Single Worker Claim | Transitions PENDING -> RUNNING with UUID token and 60s lease | **PASSED** |
| JOB-02 | Two-Worker Contention | Exactly one worker succeeds; second worker receives null | **PASSED** |
| JOB-03 | Lease Renewal | Claimant extends lease before expiration | **PASSED** |
| JOB-04 | Lease Verification | Rejects execution if claim token does not match active claimant | **PASSED** |
| JOB-05 | Expired Lease Detection | Detects crashed worker lease expiration | **PASSED** |
| JOB-06 | Payload-Preserving Recovery | Re-enqueues PENDING while preserving `targetUrl`, `productId`, `adId` | **PASSED** |
| JOB-07 | Retry Budget Exhaustion | Marks job terminal FAILED after 3 failed attempts | **PASSED** |
| JOB-08 | Direct Execution Guard | Rejects execution of unclaimed PENDING jobs directly from API route | **PASSED** |

---

## 4. Operational Commands
- Worker loop: `npm run kh01:worker`
- One-shot execution: `npm run kh01:once` (claims and executes exactly 1 eligible job and exits)
- Health check: `npm run kh01:doctor` (reports worker concurrency = 1, timeout = 8000ms, max redirects = 3, payload limit = 2MB)
