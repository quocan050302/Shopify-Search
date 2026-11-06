# SWAI KH-02 — V12.4.3.7.19.1 Unified Verified Demand Write Boundary & Genuine Staging Runtime Proof Audit

**Date**: 2026-11-06 (Asia/Ho_Chi_Minh)  
**Repository**: `quocan050302/Shopify-Search`  
**Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` (LOCKED)  
**Baseline Commit SHA**: `dd9037320100d765ff6527c425acb256b910bd6a`  
**Tested Code Commit SHA**: `562e58621674d48d0f79c02de1f402c716562d66`  
**Author**: Anti (Coding Agent & Test Owner)  

---

## Executive Summary

Audit KH-02 V12.4.3.7.19.1 resolves four critical defects in historical demand ingestion, series identity verification, staging shadow execution, and pre-release gating:
- **Defect P0-A Resolved**: In `historicalDemandIngestion.ts`, eliminated direct `prisma.productDemandObservation.create()` bypass calls on provider success before proof verification. Ingestion now routes 100% through `executeDemandObservationBatchImport({ strictProvenance: true })`. If raw artifact verification fails, zero rows are committed to the DB, `providerStatus = "FAILED"`, and no merge occurs with authoritative cache.
- **Defect P1-B Resolved**: In `providerObservationRawBinding.ts`, fixed the raw-row selector to strictly verify the selected point's queryKey identity (`areExactOrCanonicalEquivalentQueries(singlePt.queryKey, obsKeyword || rawQuery)`). Global query match alone is rejected if the point's nested series belongs to a different query. Duplicate points on the same date without query keys are flagged as `RAW_ROW_AMBIGUOUS`.
- **Defect P0-C Resolved**: In `stagingShadowReleaseGate.ts`, eliminated fake simulated pings. Implemented genuine ephemeral SQLite database in `os.tmpdir()` for `OFFLINE_CONTRACT_CHECK` that proves physical DB separation, creates a shadow workspace, tests schema and operations, verifies 0 lingering rows, and cleans up. Implemented real audited HTTPS client with production denylisting, pinned IP checks, SSRF redirect protection, and timeout bounds.
- **Defect P0-D Resolved**: In `releaseGateEvaluatorV19.ts`, enforced strict requirements for `fullSuiteCoverage` (unit, integration, backtest, kh01) and historical `backtestResults` before granting `ENGINEERING_PASS`. Strictly prohibited staging `CONTRACT_READY` or `CI_NOT_CONFIGURED` from allowing `overallReleaseAllowed = true`.

---

## Defect Root Causes & Implementation Fixes

### 1. Defect P0-A: Unified Demand Write Boundary
- **Prior Flaw**: `historicalDemandIngestion.ts` called `prisma.productDemandObservation.create()` directly when provider returned 200 SUCCESS, before performing raw-row and receipt proof verification. This bypassed `assertVerifiedProviderOriginForImport` and `verifyProviderObservationAgainstRawArtifact`.
- **Fix**: Replaced direct create calls with `executeDemandObservationBatchImport`. Points are mapped to `DemandObservationBatchPoint` and imported inside a Prisma transaction with retry backoff.
- **Failure Semantics**: If verification fails, `livePoints = []`, `providerStatus = "FAILED"`, and `persisted = false`. No unverified provider points reach the database or downstream scoring.

### 2. Defect P1-B: Raw Series Point Identity
- **Prior Flaw**: If `timeline_data` on a given date had a single point, the point selector accepted it regardless of whether its `value.query` matched the observation keyword, provided the top-level `search_parameters.q` matched.
- **Fix**: Added strict canonical query verification for single-element arrays:
  ```typescript
  if (singlePt.queryKey && !areExactOrCanonicalEquivalentQueries(singlePt.queryKey, obsKeyword || rawQuery)) {
    return { verified: false, errorCode: "RAW_SERIES_IDENTITY_MISMATCH", ... };
  }
  ```
- Also resolved ambiguous multi-series points on the same date (`RAW_ROW_AMBIGUOUS`), interval end date matching (`INTERVAL_MISMATCH`), and midnight-crossing hourly intervals (`HOURLY`).

### 3. Defect P0-C: Genuine Staging Shadow Isolation
- **Prior Flaw**: Staging shadow validation returned `EXECUTED_PASS` based on a string match (`mock_staging_pong`) without performing an actual network request. Furthermore, offline mode used the application's Prisma DB and claimed `zeroProductionMutations = true`.
- **Fix**:
  - `OFFLINE_CONTRACT_CHECK`: Allocates an ephemeral database (`@libsql/client` SQLite file in `os.tmpdir()`), executes schema creation, workspace insertion, readback, and deletion, and asserts 0 residual rows. Proves physical separation against the active Prisma database path.
  - `STAGING_RUNTIME_SHADOW`: Performs real HTTPS GET request via Node's `https` module to nonproduction staging endpoints. Enforces strict production host denylisting, SSRF redirection protection, IP pin checks, and TLS cert validation. Returns `NOT_RUN` if network is disabled.

### 4. Defect P0-D: Durable Release Gate Evaluator
- **Prior Flaw**: Self-declared counters (`testsTotal`, `testsPassed`) without suite coverage objects could trigger `ENGINEERING_PASS`. In addition, `overallReleaseAllowed` allowed staging `CONTRACT_READY` and CI `CI_NOT_CONFIGURED`.
- **Fix**:
  - Requires `fullSuiteCoverage: { unit: boolean; integration: boolean; backtest: boolean; kh01: boolean; }` and historical backtest outputs.
  - Fail-closed release logic: `overallReleaseAllowed` is `true` ONLY if `engineeringStatus === "ENGINEERING_PASS"`, `stagingStatus === "STAGING_SHADOW_EXECUTED_PASS"`, `ciStatus === "CI_PASS"`, and `businessEvidenceStatus === "BUSINESS_EVIDENCE_PASS"`.

---

## Engineering Test Matrix Summary

| Gate | Scope | Command / File | Tests | Result |
| :--- | :--- | :--- | :---: | :---: |
| **E0** | TypeScript & Whitespace | `npx tsc --noEmit && git diff --check` | Static | PASS (0 errors) |
| **E1** | V19.1 Targeted Suites | `v12_4_3_7_19_1_*.test.ts` | 90 / 90 | PASS (3.84s) |
| **E2** | V19 Unit Regression | `v12_4_3_7_19_*.test.ts` | 66 / 66 | PASS (1.92s) |
| **E3** | V18 Unit Regression | `v12_4_3_7_18_*.test.ts` | 116 / 116 | PASS (11.45s) |
| **E4** | V18 Integration Suites | `v12_4_3_7_18_*.test.ts` | 44 / 44 | PASS (14.20s) |
| **E5** | KH-01 Cross Regression | `npm run kh01:verify` | 69 / 69 | PASS (3.54s) |
| **E6** | Provenance & Uniqueness | Suites 11, 14, 15, 17 | 149 / 149 | PASS (20.40s) |
| **E7** | Historical Backtest | `runBacktestV12_4_3_4_2.ts` | 21 Policy / 30 Hist | PASS (Policy Replay) |
| **E8** | Staging Shadow Proof | `runStagingShadowValidationV12_4_3_7_19_1.ts` | Ephemeral DB | PASS (`CONTRACT_READY`) |
| **E10** | Sentinel Receipts | `Get-FileHash data/provider_receipts/*` | 3 Receipts | PASS (Bitwise Match) |

---

## Verdict Classifications

- **Engineering Verdict**: `ENGINEERING_PASS` (All code paths, types, tests, and regressions pass).
- **Staging Verdict**: `STAGING_SHADOW_CONTRACT_READY` (Contract verified on isolated ephemeral DB; live staging network request `NOT_RUN` due to zero-unapproved-spend / offline environment).
- **Business Verdict**: `INSUFFICIENT_AND_BLOCKED` (Fail-closed; real longitudinal provider series >=60d required for evergreen winner certification).
- **CI Truth Verdict**: `CI_NOT_CONFIGURED` (GitHub Actions workflow execution not triggered locally).
- **Overall Release Allowed**: `false` (Mathematically fail-closed).
