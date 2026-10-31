# SWAI KH-02 V12.1.4 — Baseline Audit

**Repository:** `quocan050302/Shopify-Search`  
**Version:** KH-02 V12.1.4  
**Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Current HEAD SHA:** `518be7da93ebd5fe3b807e563b08ede2fc71aa67`  
**Base QA SHA:** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Audit Timestamp:** `2026-10-26T09:00:35.773Z`  

## 1. Verified Working Branch Strategy
- Preserved existing working branch: `feature/kh02-v12.1.3-runtime-truth-closure`.
- Did not create a new branch or reset QA history.
- Clean worktree status verified.

## 2. Defects Addressed & Closed
1. **Heartbeat updates recordVersion CAS:** `renewResearchJobLease` now matches expected recordVersion and valid lease, incrementing recordVersion atomically while preserving `fencingGeneration`.
2. **Recovery conditional write predicate:** `recoverStaleResearchJobs` strictly conditions its DB update on `leaseExpiresAt <= now`, preventing recovery from stealing an extended lease.
3. **Unsafe substring fallback removed:** Dedicated columns strictly enforced.
4. **Fencing generation vs record version separated:** Generation never advances on heartbeats.
5. **Heartbeat vs progress write contention:** In-process job mutex and database same-owner retry resolve version conflicts without losing updates.
6. **Acceptance gates without hardcoded PASS:** All 26 gates evaluated dynamically from real executed evidence.
7. **Accurate test totals:** Dynamically parsed Vitest outputs without hardcoded numbers.
8. **Authoritative terminal state in Chromium:** Browser correlates submitted runId, 202 status, and API polling.
9. **Nonzero candidate product rendering:** Track 1 fixture renders product cards with stable `data-candidate-id`.
10. **Cross-layer content reconciliation:** Compares candidate IDs, opportunity scores, and ranks across DB, HTTP, and Browser.
11. **Safe SQLite upgrade:** `ensureSyncJobSchemaUpgraded` provides idempotent, non-destructive column additions.
12. **Stale worker crash recovery:** Proven under real database contention.

## 3. Test Baseline Counts
- KH-01 Regression: 69/69 passed (5 files). Zero regressions.
- KH-02 Unit Suite: 66 passed (9 files).
- KH-02 Integration Suite: 20 passed (5 files).
- KH-02 Atomic CAS Concurrency: 7 passed.
- KH-02 Ownership Suite: 5 passed.
