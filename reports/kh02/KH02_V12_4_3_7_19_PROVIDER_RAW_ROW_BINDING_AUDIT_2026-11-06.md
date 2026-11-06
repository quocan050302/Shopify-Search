# KH-02 V12.4.3.7.19 — PROVIDER OBSERVATION-TO-RAW EVIDENCE BINDING & STAGING SHADOW RUNTIME AUDIT

- **Date:** 2026-11-06 (Asia/Ho_Chi_Minh)
- **Repository:** `quocan050302/Shopify-Search`
- **Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Observed Baseline Remote HEAD:** `812018d4eaf3d51bcaa35b9ccb16f3f7ca92a916`
- **Tested Code Commit SHA:** `0cd5bdec55db2c34ddc62c7413f50adbf8ed51ef`
- **Target Version:** `V12.4.3.7.19`
- **Overall Engineering Verdict:** `ENGINEERING_PASS`
- **Staging Shadow Readiness:** `CONTRACT_READY`
- **Business Evidence Readiness:** `INSUFFICIENT_AND_BLOCKED`
- **CI Truth Readiness:** `CI_NOT_CONFIGURED_OR_NOT_RUN`

---

## 1. Executive Summary

This engineering patch (V12.4.3.7.19) enforces an exact, cryptographic, row-level binding between persisted/read demand observations and raw provider payload artifacts on disk, and establishes a safe, isolated staging shadow runtime contract.

### Key Solved Vulnerabilities:
1. **Defect P1-A (Observation-to-Raw Disconnection):**
   Prior versions permitted an authentic receipt descriptor to authenticate a demand observation without verifying that the underlying raw provider JSON (`interest_over_time.timeline_data`) actually contained the requested date and demand value. V19 implements `verifyProviderObservationAgainstRawArtifact` to perform exact point-in-time, date, value, and JSON-pointer resolution.
2. **Defect P1-B (Loose Category/Family Overlap):**
   Broad category/keyword similarity functions (`areCompatibleProductKeywords`) were previously allowed to bridge mismatched query strings (e.g. "cat water fountain X" vs "cat water fountain Y"). V19 introduces `areExactOrCanonicalEquivalentQueries`, strictly requiring canonical query equivalence and rejecting loose token or family overlaps.
3. **Defect P1-C (Hardcoded Release Gate Logic):**
   Release gate RG06 previously asserted static boolean literals (`const engineeringPass = true`). V19 implements a pure deterministic evaluator `evaluateReleaseEvidence` in `src/services/kh02/release/releaseGateEvaluatorV19.ts`, deriving fourfold independent verdicts (`ENGINEERING`, `STAGING`, `BUSINESS`, `CI`) with automated log sanitization.
4. **Staging Shadow Runtime Validation (Workstream D):**
   Constructed an isolated staging shadow runner and schema validator (`stagingShadowReleaseGate.ts`, `runStagingShadowValidationV12_4_3_7_19.ts`, `validateStagingShadowReportV12_4_3_7_19.ts`) executing in `OFFLINE_CONTRACT_CHECK` mode (`CONTRACT_READY`), protecting production databases and external API quotas.

---

## 2. Production Code Changes

### `src/services/kh02/demand/providerObservationRawBinding.ts`
- **Raw Timeseries Parser:** `parseProviderTimeseriesPayload` parses raw provider bytes into `ParsedProviderSeries`, validating schema structure, detecting cadence (`DAILY`, `WEEKLY`, `MONTHLY`, `HOURLY`), and mapping JSON-pointers (`/interest_over_time/timeline_data/{idx}/values/{vidx}`).
- **Canonical Query Matching:** `areExactOrCanonicalEquivalentQueries` normalizes whitespace, case, and surrounding punctuation, but rejects partial, prefix, or family token overlaps.
- **Raw Row Verification:** `verifyProviderObservationAgainstRawArtifact` validates raw SHA-256 integrity, receipt consistency, query equivalence, geographic region, point-in-time constraints, and exact date/value row binding.

### `src/services/kh02/demand/demandObservationBatchImport.ts`
- Updated `assertVerifiedProviderOriginForImport` to require:
  - `desc.exactObservationVerified === true`
  - Exact `periodEnd` date matching and validation.
- Configured Prisma interactive transactions with `{ timeout: 15000, maxWait: 10000 }` and progressive exponential backoff to handle concurrent OS child process execution cleanly.

### `src/services/kh02/demand/historicalDemandIngestion.ts`
- Wired `observationDate: r.periodStart`, `periodEnd: r.periodEnd`, and `observationValue: r.demandValue` into `resolveVerifiedDemandEvidence` calls.

### `src/services/kh02/demand/temporalDemandEngine.ts`
- Integrated `verifyProviderObservationAgainstRawArtifact` into `resolveVerifiedDemandEvidence`.
- Expanded `DemandEvidenceRejectionCode` to include typed raw row errors (`RAW_ROW_NOT_FOUND`, `RAW_VALUE_MISMATCH`, `RAW_SERIES_MISSING`, `RAW_SERIES_IDENTITY_MISMATCH`, `RAW_ROW_AMBIGUOUS`, `UNSUPPORTED_RAW_SCHEMA`, `NO_TIMESERIES_SUPPORT`, `MISSING_ARTIFACT`).
- Added strict live origin ingress gating.

### `src/services/kh02/release/releaseGateEvaluatorV19.ts`
- Pure function `evaluateReleaseEvidence(input)` computing independent readiness verdicts.
- Sanitizes sensitive tokens, keys, and credentials from gate output logs.

### `src/services/kh02/staging/stagingShadowReleaseGate.ts`
- Staging shadow service supporting `OFFLINE_CONTRACT_CHECK` (`CONTRACT_READY`) and `LIVE_SHADOW_RUN`. Enforces production safety denylists.

---

## 3. Full Test Command Matrix (S0 – S10)

| Gate | Scope | Command | Tests Run | Result | Duration |
|------|-------|---------|-----------|--------|----------|
| **S0** | Source Hygiene | `git status --short --branch`, `npx tsc --noEmit`, `git diff --check` | - | **PASS** | 4.2s |
| **S1** | V19 Targeted Suites | `v12_4_3_7_19_ExactProviderRawRowBinding.test.ts`, `v12_4_3_7_19_BatchWriteAndReadAuthority.test.ts`, `v12_4_3_7_19_ReleaseGateFromRealResults.test.ts` | 66 / 66 | **PASS** | 1.86s |
| **S2** | V18 & V18.2 Regression | `tests/integration/kh02/v12_4_3_7_18*`, `tests/unit/kh02/v12_4_3_7_18*` | 160 / 160 | **PASS** | 31.88s |
| **S3** | Core Provenance Regression | `v12_4_3_7_11`, `v12_4_3_7_14`, `v12_4_3_7_15`, `v12_4_3_7_17` | 149 / 149 | **PASS** | 21.29s |
| **S5** | KH-01 Cross-System | `npm run kh01:verify` | 69 / 69 | **PASS** | 3.89s |
| **S6** | Historical Backtest | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` | Replay | **PASS** | 2.3s |
| **S7** | Staging Shadow Gate | `runStagingShadowValidationV12_4_3_7_19.ts`, `validateStagingShadowReportV12_4_3_7_19.ts` | Contract Check | **PASS** | 1.45s |
| **S10** | Sentinel Receipt Integrity | `Get-FileHash data/provider_receipts/*` | 3 / 3 | **PASS** | 0.5s |

---

## 4. Separation of Truth: Engineering vs Business Readiness

- **Engineering Readiness: `ENGINEERING_PASS`**
  All unit tests, negative test matrices (A01–A30), positive test matrices (B01–B08), batch write/read authority tests (C01–C12), release gate derivations (D01–D16), and OS multi-process concurrency suites passed 100%.
- **Staging Shadow Readiness: `CONTRACT_READY`**
  Staging shadow runtime validator ran in safe `OFFLINE_CONTRACT_CHECK` mode. Production database isolation, zero-spend protection, and live network fetcher gating verified.
- **Business Evidence Readiness: `INSUFFICIENT_AND_BLOCKED`**
  - G06 (Google Ads Transparency): `TRANSPORT_READY_NOT_VERIFIED`
  - G07 (TikTok Ads): `BLOCKED` (deferred out of scope)
  - G15 (Longitudinal Demand >=60d): `INSUFFICIENT_EVIDENCE`
  - G16 (Top 3 Winning Products): `INSUFFICIENT_EVIDENCE`
  Ground-truth external provider demand data remains absent for historical candidates; the system faithfully refuses to promote products without real evidence.
