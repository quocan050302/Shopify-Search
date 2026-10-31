# KH-01 V11.4.2 — Checkpoint 7: Real End-to-End Acceptance Report

**Target Version**: V11.4.2  
**Implementation Date**: 2026-10-24  
**Target Market**: United States  
**Operating Mode**: RESEARCH_ONLY  
**Artifact Manifest**: `artifacts/kh01-v11.4.2/e2e-manifest.json`  

---

## 1. Executive Summary

Checkpoint 7 establishes an auditable, deterministic, and live end-to-end acceptance suite for KH-01. Rather than relying on isolated mocked helper tests, the test suite verifies the complete lifecycle across the entire system:

$$\text{Source Ad} \longrightarrow \text{Product Identity} \longrightarrow \text{Queued Job} \longrightarrow \text{Worker Lease Claim} \longrightarrow \text{Safe Fetch} \longrightarrow \text{Atomic Persistence} \longrightarrow \text{API Readback} \longrightarrow \text{Opportunity Engine}$$

The acceptance suite strictly segregates:
1. **`INTEGRATION_E2E`**: Fully deterministic execution against an isolated SQLite test database with controlled public page fixtures. Tests all 20 lifecycle steps.
2. **`LIVE_SOURCE_E2E`**: Opt-in live network execution against authentic competitor landing pages with destination IP pinning, DNS rebinding mitigation, and truthful source classification (`BLOCKED_BY_SOURCE` when rate-limited or restricted).

---

## 2. Test Execution Architecture

### 2.1 The 20-Step Acceptance Lifecycle

The acceptance runner (`scripts/kh01RealE2E.ts`) executes and verifies:
1. **Step 1: Source Ad Provenance Verification**: Queries genuine source ad, verifying internal ID, external Meta Ad Library ID, advertiser name, and original landing URL.
2. **Step 2 & 3: Product Identity Resolution**: Resolves or creates a `ResearchProduct` via `productIdentityService` with explicit identity confidence (`EXACT` / `PROBABLE`).
3. **Step 4: Queue Research Job**: Calls `createLandingPageResearchJob` to create a `PENDING` job with immutable research input.
4. **Step 5: Atomic Worker Claim & Lease Fencing**: Claims the pending job using `claimPendingKh01Job("kh01-e2e-worker")`, obtaining a unique claim token and 60-second lease.
5. **Step 6 & 7: Safe Worker Execution**: Executes via `executeKh01Job` with active lease fencing, streaming byte caps, and timeout guards.
6. **Step 8 & 9: Transactional Persistence Verification**: Queries the database directly to confirm `LandingPageSnapshot`, `CompetitorOfferSnapshot`, and `ResearchEvidence` were atomically persisted.
7. **Step 10: Multi-Tenant Workspace Scoping**: Asserts snapshots belong strictly to the authenticated test workspace without leaking across tenants.
8. **Step 11: Service & Readback Verification**: Confirms product relationships (`landingPageSnapshots`, `offerSnapshots`, `evidence`) are intact and queryable.
9. **Step 12 & 13: Opportunity Scoring & Financial Gating**: Calculates the 6-pillar assessment; verifies that missing supplier costs strictly enforce non-test-readiness (`RESEARCH_MORE`).
10. **Step 14: Human Research Decision Persistence**: Records a human research decision with audit trail in `ResearchDecision`.
11. **Step 15 & 16: State Preservation**: Validates persistence across re-queries.
12. **Step 17: Idempotent Replay Verification**: Re-executes the claimed job and asserts snapshot counts do not increase (no duplicate snapshots).
13. **Step 18: Genuine New Observation History**: Queues and executes a subsequent inspection, confirming genuine temporal history is preserved.
14. **Step 19: Safe Teardown**: Cleans up ephemeral resources without affecting the application's active `dev.db`.
15. **Step 20: Machine-Readable Manifest**: Emits `artifacts/kh01-v11.4.2/e2e-manifest.json`.

---

## 3. Test Results & Manifest

### 3.1 Deterministic Integration Suite (`npm run kh01:test:e2e`)

```
> shopify-winning-ads-intelligence@0.1.0 kh01:test:e2e
> vitest run tests/integration/kh01RealE2E.test.ts

 ✓ tests/integration/kh01RealE2E.test.ts (1 test) 196ms
   ✓ KH-01 Checkpoint 7 — Real End-to-End Acceptance (Queue -> Claim -> Fetch -> Persist -> Readback)
```

**Manifest Data (`artifacts/kh01-v11.4.2/e2e-manifest.json`)**:
- **Test Classification**: `INTEGRATION_E2E`
- **Overall Status**: `ACCEPTED`
- **Source Ad ID**: `cmvf78dnw00044og9ljucezcu`
- **Meta Library ID**: `meta_bleame_crystal_hair_eraser_01`
- **Advertiser**: `Bleame`
- **Job ID**: `cmvma7urg00039wg928qc5bqz`
- **Worker Claim**: `kh01-e2e-worker` (Token: `bbb7ec86-b6a4-4c2b-a1d8-34bee3c0a6b0`)
- **Landing Snapshot ID**: `cmvma7urv00059wg91gkcd1le`
- **Offer Snapshot ID**: `cmvma7uru00049wg9iksmkk2b`
- **Observed Selling Price**: `$29.99 USD`
- **Evidence Count**: 3 records
- **Opportunity Score**: `null` (Partial assessment)
- **Evidence Readiness**: `31 / 100`
- **Recommendation**: `RESEARCH_MORE` (Gating passed)
- **Persisted Result Verified**: `true`
- **API Readback Verified**: `true`

### 3.2 Opt-In Live Source Suite (`npm run kh01:test:live`)

```
> shopify-winning-ads-intelligence@0.1.0 kh01:test:live
> tsx scripts/kh01RealE2E.ts --live

[KH-01 E2E] Running LIVE_SOURCE_E2E acceptance...

=================================================
KH-01 V11.4.2 E2E Decision: BLOCKED_BY_SOURCE
Steps Passed: 11/11
Snapshot ID: null
Offer Snapshot ID: null
Evidence Count: 0
Recommendation: RESEARCH_MORE
=================================================
```

**Honest Source Reporting**:
When inspecting live external storefronts (e.g., `bleame.com`), bot-protection systems returned HTTP 429 (Rate Limited). The runner truthful reported `BLOCKED_BY_SOURCE` without faking a successful HTML extraction or inventing offer prices.

---

## 4. Verification of Checkpoint 7 Acceptance Criteria

| Requirement | Implementation & Verification | Status |
| :--- | :--- | :---: |
| **Fail-Closed DB Isolation** | Dedicated temporary SQLite DB created via `createIsolatedTestDatabase`; never touches `dev.db`. | **PASS** |
| **Claim-Guarded Execution** | Worker claim validated before HTTP request and before DB mutation. | **PASS** |
| **Transactional DB Persistence** | Snapshots, offer, evidence, and terminal job state committed in atomic `$transaction`. | **PASS** |
| **Idempotent Replay** | Replay of completed job returns existing IDs; snapshot count unchanged. | **PASS** |
| **Truthful Source Status** | Blocked / rate-limited sources marked `BLOCKED_BY_SOURCE`, never falsified. | **PASS** |
| **Supplier Cost Gate** | Missing COGS and fulfillment cost strictly enforces `RESEARCH_MORE`. | **PASS** |
| **Machine-Readable Manifest** | `e2e-manifest.json` written with authentic runtime IDs and timestamps. | **PASS** |
