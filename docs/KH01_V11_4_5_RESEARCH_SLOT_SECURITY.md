# KH-01 V11.4.5 — Research Slot Security & Lifecycle Hardening

## Overview
In KH-01 V11.4.4, research slots were introduced to enforce a durable global capacity limit on heavy landing page research jobs across distributed worker processes. However, audit findings identified two critical integrity vulnerabilities:
1. **Finding F (`releaseResearchSlot`)**: Permitted an optional `claimToken?: string` parameter, silently skipping token validation if omitted.
2. **Finding G (`acquireResearchSlot`)**: Lacked expected-state and claimant guards, potentially allowing arbitrary worker processes to acquire/reassign an already active `RUNNING` job without verifying ownership or lease expiration.

In V11.4.5, both functions have been hardened with strict runtime assertions, atomic transaction guards, and state-transition invariants.

---

## Technical Repairs

### 1. Mandatory Claim Token in `releaseResearchSlot`
The function signature was updated to require a non-empty `claimToken: string`:
```typescript
export async function releaseResearchSlot(
  workerId: string,
  jobId: string,
  claimToken: string,
  txClient?: any
): Promise<boolean>
```

#### Runtime Assertions:
```typescript
if (!workerId || typeof workerId !== "string" || !workerId.trim()) return false;
if (!jobId || typeof jobId !== "string" || !jobId.trim()) return false;
if (!claimToken || typeof claimToken !== "string" || !claimToken.trim()) return false;
```

#### Atomic Ownership Verification:
Inside the Prisma transaction:
1. Job must exist and have `status === "RUNNING"`.
2. Metadata `meta.workerId` must strictly equal `workerId`.
3. Metadata `meta.claimToken` must strictly equal `claimToken`.
4. If `meta.leaseExpiresAt` is in the past, or the slot has already been released (`leaseExpiresAt === epoch 0`), the release request is rejected with `false`.
5. Upon successful verification, `leaseExpiresAt` is zeroed out, `releasedAt` timestamp is recorded, `fencingVersion` is monotonically incremented, and capacity is freed.

---

### 2. State Transition & Takeover Guard in `acquireResearchSlot`
The acquisition helper now strictly validates incoming arguments and prohibits taking over active jobs:

```typescript
export async function acquireResearchSlot(
  workerId: string,
  jobId: string,
  claimToken: string = crypto.randomUUID(),
  txClient?: any
): Promise<ResearchSlotLease | null>
```

#### State Transition Rule:
- Only jobs in `PENDING` or `RUNNING` status can acquire a slot reservation. Finished (`COMPLETED`, `FAILED`, `CANCELLED`) jobs are strictly rejected (`null`).
- If a job is already `RUNNING`:
  - If it is owned by another worker (`meta.workerId !== workerId`) and its lease is active (`leaseExpiresAt >= now`), the acquisition is **strictly rejected** (`null`).
  - Takeover is only permitted if the lease has expired or if the existing owner is renewing.
- Global capacity check: Active running jobs with unexpired leases across the workspace must not exceed `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS`.
- Returns a complete `ResearchSlotLease` containing `slotId`, `workerId`, `jobId`, `claimToken`, and `leaseExpiresAt`.

---

## Verification & Invariants

| Assertion | Expected Behavior | V11.4.5 Status |
| :--- | :--- | :--- |
| Missing claimToken in release | Returns `false`, does not release slot | **PASSED** |
| Empty string claimToken in release | Returns `false`, rejects immediately | **PASSED** |
| Wrong workerId in release | Returns `false`, rejects immediately | **PASSED** |
| Mismatched claimToken in release | Returns `false`, rejects immediately | **PASSED** |
| Expired lease in release | Returns `false`, rejected as stale | **PASSED** |
| Reassigning active RUNNING job | Returns `null`, protects active claimant | **PASSED** |
| Concurrency budget exhaustion | Returns `null`, respects global limit | **PASSED** |
