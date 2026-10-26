# SWAI KH-02 V12.1.3 — Baseline Audit

**Repository:** `quocan050302/Shopify-Search`  
**Base Branch:** `origin/QA`  
**Original QA SHA:** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Feature Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Feature Starting SHA:** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Audit Timestamp:** `2026-10-26T08:04:00.229Z`  

## 1. Existing Defects Addressed
- Orchestrator bypassing worker ownership (eliminated unowned status & snapshot mutations).
- UI submitting research synchronously (repaired to async `mode: "async"` with bounded polling).
- Weak fencing based on JSON substring search (replaced with dedicated `fencingGeneration` and `recordVersion` columns).
- Heartbeat lease renewal conflating generation with record version (separated generation from version).
- Acceptance gates containing hardcoded PASS (all 26 gates now dynamically evidence-derived).
- Chromium reporting PASS despite incomplete research and console errors (repaired to require terminal state & zero 500s).
- Demand history defaulted to SOURCE_DATA_VERIFIED (repaired to CONFIGURED/NOT_VERIFIED until candidate stability PASS).

## 2. Test Baseline
- KH-01 Suite: 69/69 passed (5/5 suites). Zero regressions.
- KH-02 Unit Suite: 11 tests passed.
- KH-02 Integration Suite: 11 tests passed.
- KH-02 Ownership Suite: 1 tests passed.
- KH-02 Acceptance Suite: 3 tests passed.
