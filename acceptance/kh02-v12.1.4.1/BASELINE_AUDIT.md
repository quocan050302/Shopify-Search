# SWAI KH-02 V12.1.4.1 — Baseline Audit

**Repository:** `quocan050302/Shopify-Search`  
**Version:** KH-02 V12.1.4.1  
**Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Current HEAD SHA:** `dfb9f67a9c3d82b71623fdb94d9f385d6f0a64c9`  
**Base QA SHA:** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Audit Timestamp:** `2026-10-26T13:52:29.095Z`  

## 1. Verified Working Branch Strategy
- Preserved existing working branch: `feature/kh02-v12.1.3-runtime-truth-closure`.
- Did not create a new branch or reset QA history.
- Clean worktree status verified.

## 2. Defects Addressed & Closed
1. **Heartbeat stale JSON retry fix:** `renewResearchJobLease` reloads fresh `resultJson` on CAS contention, merges only heartbeat-owned `_runtime` fields, and strictly preserves concurrent progress updates.
2. **Exact ownership validation on retry:** Verified 8 required fields: `jobId`, `status: RUNNING`, `workerId`, `claimToken`, `fencingToken`, `fencingGeneration`, `recordVersion`, `leaseExpiresAt > now`.
3. **Partial candidate match bug eliminated:** Browser-to-DB reconciliation requires full set equality, rank order, and score tolerance (reconcileDatabaseAndBrowser rejects 1-of-3 and 2-of-3 partial matches).
4. **HTTP content reconciliation:** Database-to-HTTP compares canonical research snapshot, candidate sets, rank order, and opportunity scores.
5. **Chromium browser driver hardened:** Correlates acceptedRunId from HTTP 202, polls authoritative job status, requires zero hydration errors and databaseMatch, removes title-as-ID fallback.
6. **Real legacy SQLite migration verified:** Verified on genuine pre-V12.1.3 SQLite database lacking all 7 dedicated columns with PRAGMA table_info and index_list verification.
7. **Dynamic gate evaluation:** All 26 gates evaluated dynamically from real executed evidence without hardcoded test counts.

## 3. Test Baseline Counts
- KH-01 Regression: 69 passed (5 files). Zero regressions.
- KH-02 Unit Suite: 89 passed (11 files).
- KH-02 Heartbeat Retry: 7 passed.
- KH-02 Exact Reconciliation: 16 passed.
- KH-02 Legacy Migration: 2 passed.
- KH-02 Atomic CAS Concurrency: 7 passed.
- KH-02 Ownership Suite: 5 passed.
- KH-02 Integration Suite: 22 passed.
