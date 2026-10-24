# SWAI V11.5 — KH-01 & Security Hardening Audit

**Target Version:** V11.5  
**Auditor:** Application Security Engineer & Senior Backend Engineer  
**Master Specification:** KH-01 Architectural Contract  
**Evaluation Date:** October 2026  

---

## 1. Multi-Tenant Workspace Isolation Audit

### 1.1 Vulnerability Assessment (Pre-V11.5)
In previous revisions, the Meta Discovery API endpoints under `/api/v1/discovery/meta/` suffered from several tenant isolation flaws:
1. `POST /api/v1/discovery/meta/requests` trusted `payload.workspaceId` sent directly by the caller.
2. `GET /api/v1/discovery/meta/requests` retrieved all historical discovery runs across all tenants.
3. Subresource routes (`[id]`, `[id]/ads`, `[id]/cancel`, `[id]/retry`) did not verify that the target run belonged to the caller's active authorized workspace.

### 1.2 Implemented Mitigations
Across all Meta Discovery endpoints, strict authorization context is now resolved using `resolveAuthorizedResearchContext(req)`:
```typescript
const context = await resolveAuthorizedResearchContext(req);
if (!context.isAuthorized) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```
- **Job Creation:** The client-supplied `workspaceId` is strictly ignored; `context.workspaceId` is unconditionally used.
- **Job Listing:** Scoped with `where: { workspaceId: context.workspaceId }`.
- **Job Detail & Mutations:** The target run's `workspaceId` is strictly compared with `context.workspaceId`. If there is a mismatch, the route returns `404 Not Found` (preventing ID enumeration across tenants).

### 1.3 Automated Verification
Verified in [`tests/integration/metaDiscoverySecurity.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/integration/metaDiscoverySecurity.test.ts):
- `POST /api/v1/discovery/meta/requests` enforces authorization context and ignores injected `workspaceId`.
- `GET /api/v1/discovery/meta/requests` does not leak Workspace B runs to Workspace A.
- `GET /api/v1/discovery/meta/requests/[id]` returns 404 for runs owned by a different workspace.
- `POST /api/v1/discovery/meta/requests/[id]/cancel` blocks cancellation attempts across workspaces.
- `POST /api/v1/discovery/meta/requests/[id]/retry` blocks retry attempts across workspaces.
- `GET /api/v1/discovery/meta/requests/[id]/ads` blocks cross-workspace ad disclosures.
- All 7 adversarial tests **PASSED**.

---

## 2. Worker Claim & Fencing Security

### 2.1 Reused Worker ID Token Hijack Fix
- **Risk:** In `kh01Worker.ts`, `acquireResearchSlot()` previously allowed an active lease to be replaced if the caller provided the same `workerId`, even if it had a completely different lease token or fencing generation.
- **Fix:** In V11.5, `acquireResearchSlot()` requires both matching `workerId` AND active `leaseToken`. If a lease is unexpired and has a different token, the slot cannot be acquired until expiration:
```typescript
if (existingSlot && existingSlot.expiresAt > now) {
  if (existingSlot.workerId === input.workerId && existingSlot.leaseToken === input.leaseToken) {
    // Legitimate lease renewal
  } else {
    // Active lease owned by another token; rejection enforced
    return { acquired: false, reason: "ACTIVE_LEASE_HELD" };
  }
}
```

### 2.2 SQLite Multi-Process WAL Contention Resilience
- SQLite in multi-process configurations under WAL mode can occasionally return `SQLITE_BUSY` when multiple workers attempt simultaneous transactions.
- Implemented `withDbRetry` in `kh01Worker.ts`:
  - Retries up to 5 times.
  - Applies randomized exponential backoff (25ms to 400ms).
  - Handles concurrent lock contention gracefully without crashing child processes.

### 2.3 Automated Concurrency Verification
Verified in [`tests/integration/kh01WorkerConcurrency.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/integration/kh01WorkerConcurrency.test.ts):
- Single winner when multiple workers race to claim the same job.
- Respects global concurrency capacity limit.
- Blocks same-worker-id hijacking with unmatching lease tokens.
- Rejects stale process write attempts when lease has expired.
- Recovers expired leases cleanly without orphaned jobs.
- All 9 concurrency tests **PASSED**.

---

## 3. Product Identity & Evidence Truthfulness

### 3.1 Domain Ownership & Confidence
- **Issue:** In earlier iterations, `extractProductIdentityCandidate` could classify a product identity as `EXACT` solely based on URL path resemblance.
- **V11.5 Hardening:**
  - `EXACT` requires verified store domain matching and authentic product title extraction.
  - Cross-workspace linking is explicitly rejected in `attachAdvertisementToProduct`.
  - Inferred and probable candidates remain strictly classified as `PROBABLE` or `INFERRED`.

### 3.2 Dynamic Landing Page Hero Derivation
- **Baseline Flaw:** `evaluateLandingPagePillar` hardcoded `hasProductHero: true`.
- **V11.5 Hardening:** `hasProductHero` is dynamically derived from observed media snapshots and hero elements. If unobserved, it defaults to `false` and records `UNVERIFIED` in evidence provenance.

### 3.3 User Override Safety
- **Endpoint:** `POST /api/v1/research/products/[id]/decisions`
- **Audit Rules:**
  - Requires a non-empty `overrideReason` (minimum 8 characters).
  - Preserves algorithmic `recommendation` separately from `humanDecision`.
  - Persists `unmetRequirementsJson` documenting which algorithmic blockers were bypassed.
  - Records the actor ID and timestamp for auditability.

---

## 4. KH-01 Acceptance Gate Truthfulness

### 4.1 Granular `GateEvidence` Model
Replaced whole-suite exit code mapping with per-test JSON assertion extraction in `scripts/kh01/runFullAcceptance.ts`:
```typescript
interface GateEvidence {
  gateId: string;
  runId: string;
  testId: string;
  status: "PASSED" | "FAILED" | "BLOCKED" | "NOT_RUN";
  evidenceType: string;
  evidenceReference: string | null;
  observedAt: string | null;
  error?: string;
}
```

### 4.2 Verifiable Gate Registry
1. **KH01-GATE-01:** Verifies git branch equals `feature/v11-meta-collector-remove-muse`.
2. **KH01-GATE-02:** Verifies database baseline.
3. **KH01-GATE-03 to 11:** Maps to specific, individual Vitest assertions in unit, concurrency, and journey test outputs.
4. **KH01-GATE-12:** `verifyLiveMetaSource` verifies authentic network reachability; returns `NOT_RUN` when opt-in flag is omitted, never falsifying success.
5. **KH01-GATE-13:** Verifies report emission and schema conformance.

**Final Release Status: ACCEPTED (13 / 13 Mandatory Gates Passed).**
