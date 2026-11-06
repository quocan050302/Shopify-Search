# SWAI KH-02 — V12.4.3.7.19.2 G15/G16 Free Source Truth & Diagnostic Honesty Audit

**Date**: 2026-11-06 (Asia/Ho_Chi_Minh)
**Repository**: `quocan050302/Shopify-Search`
**Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` (LOCKED)
**Baseline Commit SHA**: `06e49fa8869f2d754dd289f43ea77f3acb08bfd7`
**Tested Code Commit SHA**: `a9695a2a79cadcafd495e1c1bab1f1876ef5e510`
**Audit Classification**: `CODE_DEFECT_DIAGNOSTIC_ONLY` (Zero G15/G16 business gate bypass)

---

## 1. Executive Summary

This diagnostic track resolves the discrepancy where the Google Free Demand composite source diagnostic emitted `provenanceVerified=true` merely because the local CSV importer adapter was configured in software, despite no verified data artifact existing for the target products.

### Three-Way Distinction
1. **Source Connectivity / Capability**:
   - `GOOGLE_TRENDS_CSV`: `CONFIGURED` (import capability ready, filesystem adapter active, zero external transport).
   - `BIGQUERY`: `NOT_CONFIGURED` (`BIGQUERY_PROJECT_ID` missing, transport connected: false, queryExecuted: false).
   - `SERPAPI`: `NOT_CONFIGURED` (zero paid quota / no account required; preserved as inert legacy).
2. **Source Content Verified for Target Candidates**:
   - `UAHPET Fresh Food Automatic Pet Feeder` (`cand_1212440541`): **0 matching US rows** (`NOT_TESTED_NO_SOURCE_FILE`).
   - `The KittySpout™ - Wireless Fountain` (`cand_1587534715`): **0 matching US rows** (`NOT_TESTED_NO_SOURCE_FILE`).
   - `Pet Hair/Lint/Dust Cleaner` (`cand_1613504636`): **0 matching US rows** (`NOT_TESTED_NO_SOURCE_FILE`).
   - The 96 US CSV rows in the database belong exclusively to unrelated products (Smart Posture Corrector fixtures, wallpaper, glue gun, etc.) and are strictly isolated.
3. **Commercial Gate Verdicts**:
   - **G15 (Longitudinal Demand >=60d)**: `INSUFFICIENT_EVIDENCE` (0 covered days, 0 points for all three candidates).
   - **G16 (Top 3 Winning Products)**: `INSUFFICIENT_EVIDENCE` (fail-closed; lacks required authentic G15 history and qualifying distinct candidates).

---

## 2. Root Cause Analysis & Code Corrections

### Root Cause of False Positive `provenanceVerified=true`
The false positive was isolated to two callsites in `src/services/kh02/demand/demandProviderRegistry.ts` and one in `src/services/kh02/providers/sourceRegistry.ts`:
- **Line 327 (`GoogleTrendsCsvImportProvider.diagnose()`)**: Hardcoded `provenanceVerified: true` based solely on the existence of the local directory `data/google_trends_imports`.
- **Line 554 (`GoogleFreeDemandProvider.diagnose()`)**: Set `provenanceVerified: isConfigured`, equating software configuration (`isBqConfigured || isCsvConfigured`) with verified evidence.
- **Lines 814 & 845 (`sourceRegistry.ts`)**: Evaluated `sourceDataVerified: demandCount > 0` where `demandCount` was the workspace total (96 unrelated rows), and hardcoded `transportConnected: true` even when BigQuery was unconfigured.

### Targeted Minimal Corrections
1. **`demandProviderRegistry.ts`**:
   - Changed `provenanceVerified` to `false` in `GoogleTrendsCsvImportProvider`, `GoogleTrendsBigQueryProvider`, and `GoogleFreeDemandProvider`.
   - Added typed independent axes:
     - `importCapabilityReady: true`
     - `sourceArtifactPresent: false`
     - `verifiedApplicableRowCount: 0`
     - `provenanceScopeEvaluation: "NOT_EVALUATED"`
     - `explanationCode: "IMPORT_READY_NO_RELEVANT_ARTIFACT"`
2. **`sourceRegistry.ts`**:
   - Accurately mirrors `freeDiag.transportConnected` and `freeDiag.authenticated`.
   - Explicitly sets `provenanceVerified: false` and `sourceDataVerified: false` unless a real query for the candidate has verified data.
   - Clarifies in reason string that stored workspace rows do not imply candidate-specific validity.
3. **`types.ts`**:
   - Extended `ProviderReadinessDimensions` and `SourceDiagnosticResult` with backward-compatible evidence telemetry fields.

---

## 3. Database Physical Readback Proof (`dev.db`)

Inspected via direct read-only SQLite client:
- **Total `ProductDemandObservation` DB-wide**: 96 rows.
- **Total US `ProductDemandObservation`**: 96 rows.
- **UAHPET rows in DB**: **0 rows** (`[]`).
- **Breakdown of the 96 existing rows**:
  - `cmvsy7zeg0001p0orsexc5psw` (Reusable Pet Hair Remover Roller): 6 rows
  - `cmvsy7zoq000ap0or4ly9ciih` (Pawira Stainless Steel Water Fountain): 6 rows
  - `cmvsy7zqh000jp0orhypwohho` (Automatic Wet Food Cat Feeder): 6 rows
  - `cmvsy85zn000yp0ore89xpw92` (Rechargeable Hot Melt Glue Gun): 6 rows
  - `cmvsy86180017p0orn9ajx8g7` (Hot Melt Glue Gun): 6 rows
  - `cmvsy862v001gp0orczh9wm7e` (Two Blue Cats): 6 rows
  - `cmvsy864i001pp0or0a8ff2vx` (Easy-Fill Wall Repair Paste Kit): 6 rows
  - `cmvsy8663001yp0orm0u01s7m` (THE ULTIMATE White Drywall Repair Paint Kit): 6 rows
  - `cmvsy867l0027p0ort3vvnxxg` (Burnett Wallpaper): 6 rows
  - `cmvsy8699002gp0orwl4eryuh` (Brooke Wallpaper): 6 rows
  - `prod_fixture_*` (Smart Posture Corrector test fixtures): 36 rows
- **Candidate Readback**:
  - `cand_1212440541`: 0 demand observations
  - `cand_1587534715`: 0 demand observations
  - `cand_1613504636`: 0 demand observations

---

## 4. BigQuery Free Source Truth

- `process.env.BIGQUERY_PROJECT_ID` is unconfigured.
- Status: `NOT_CONFIGURED` (Missing requirements: `["BIGQUERY_PROJECT_ID"]`).
- Public dataset `bigquery-public-data.google_trends.top_terms` indexes top 25 high-volume search terms by DMA/Country. It does NOT track long-tail niche e-commerce product keywords. Therefore, even with valid project credentials, BigQuery cannot provide product-specific demand series for SKU-level G15 evergreen qualification.

---

## 5. Baseline Test Verification

- Executed targeted unit suite `tests/unit/kh02/v12_4_3_7_19_2_SourceTruthAndDiagnosticHonesty.test.ts`: **20/20 PASS** in 0.98s.
- Executed full 15 targeted suites (V18/V19 regression): **292/292 PASS** in 20.96s.
- Executed KH-01 cross-verification (`npm run kh01:verify`): **69/69 PASS** in 3.77s.
- TypeScript check (`npx tsc --noEmit`): **0 errors**.
- Whitespace check (`git diff --check`): **clean**.
