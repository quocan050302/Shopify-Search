# KH-02 V12.4.3.7.19.3.1 — Unified Candidate Attribution Across Cache & Fresh Provider Audit
Date: 2026-11-06 (Asia/Ho_Chi_Minh)
Repository: `quocan050302/Shopify-Search`
Locked Branch: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
Release Version: `V12.4.3.7.19.3.1`
Tested Code Commit SHA: `b32a13247d54fa47e3d0d0c7960873a5270248eb`
Parent Baseline Commit SHA: `d2e0dcf477fc54bae8a23fef203f763eeff91b78`

---

## 1. Executive Summary & Production Truth Boundary

Under KH-02 V12.4.3.7.19.3.1, candidate attribution has been unified into a single authoritative and deterministic boundary across both database cached observations and fresh provider fetching:

1. **Unified Attribution Boundary Across Cache and Fresh Fetch**:
   - `candidateDemandAttribution.ts` now enforces strict candidate identity across all pathways:
     - SQLite cached `ProductDemandObservation` readback
     - Fresh provider fetch points before database admission in `historicalDemandIngestion.ts`
     - `GoogleTrendsCsvImportProvider.fetchSeries()` in `demandProviderRegistry.ts`
     - Cache-fresh merge deduplication using compound key `(region, normalizedQuery, date)`
     - Evaluator authority in `temporalDemandEngine.ts`
   - Provider SUCCESS response no longer admits un-attributable points; points failing candidate attribution are rejected prior to transactional write.
   - When `targetProductId` is null, `batchImportSucceeded` is never marked `true`.

2. **Elimination of Overbroad Heuristics & Protection of Legitimate Product Queries**:
   - Replaced permissive brand token + functional word heuristics with strict canonical equivalence (`areExactOrCanonicalEquivalentQueries`) and exact candidate token subset matching.
   - Accessory/part tokens (`filter`, `replacement`, `cartridge`, `cord`, etc.) are demoted and rejected when candidate is the main product.
   - Cross-product family mismatches (e.g. `feeder` vs `fountain`) are rejected despite shared brand tokens.
   - Untrusted caller-supplied alias descriptors without verified immutable provenance references or valid signatures are classified as `unauthenticated` and rejected.
   - Benign whitespace, quote, and trailing punctuation variations retain legitimate canonical equivalence without altering product semantics.

3. **Demographics for Historic UAHPET Candidate (`cand_1212440541`)**:
   - Raw database records: **6** (keyword: `Automatic Wet Food Cat Feeder with Cooling & Warming`)
   - Candidate-attributable records: **0** (brand `UAHPET` missing from generic observation; no verified alias)
   - Excluded records: **6** (`EXCLUDED_UNVERIFIED_ALIAS`)
   - G15 Demand Gate: `INSUFFICIENT_HISTORY` / `INSUFFICIENT_EVIDENCE`
   - G16 Top 3 Winners: `INSUFFICIENT_EVIDENCE` (0 evergreen winners)

4. **Zero-Spend & Safe Provider State**:
   - Zero spend ($0.00). No SerpApi requests, no paid BigQuery calls, no TikTok Ads US.

---

## 2. Decision Matrix

| Dimension | Status / Verdict | Explanation |
| :--- | :--- | :--- |
| **ENGINEERING** | **PASS** | 94/94 unit suites (2,139 tests), 16/16 integration suites (77 tests), KH-01 (69 tests), and TypeScript/git diff checks all 100% green. |
| **CACHE & FRESH ATTRIBUTION** | **VERIFIED_CLOSED** | Unified candidate-scoped attribution filter guards both DB cache readback and fresh provider fetch before write. |
| **PROVENANCE** | **VERIFIED_BOUNDARY** | Immutable evidence references (`trends-csv:official:*`, SHA-256 receipts) strictly required for authoritative status. |
| **STAGING** | **CONTRACT_READY** | Local execution contracts verified; staging environment NOT_RUN without remote infrastructure mutation. |
| **CI** | **SELF_REPORTED_LOCAL_EXECUTION** | Verified locally on branch `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`. |
| **G15 DEMAND** | **INSUFFICIENT_EVIDENCE** | 0 candidate-specific >=60-day authoritative observations for UAHPET, KittySpout, or Cleaner. |
| **G16 WINNERS** | **INSUFFICIENT_EVIDENCE** | 0 verified evergreen winners qualify under strict G15 demand policy. |
| **PRODUCTION RELEASE** | **NO-GO** | Blocked until authentic candidate-specific >=60d demand CSVs are supplied by merchant. |

---

## 3. SQLite Readback Demographics

| Candidate ID | Candidate Title | Canonical Product ID | Raw Rows | Attributable Rows | Longitudinally Eligible | G15 / G16 Verdict |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| `cand_1212440541` | UAHPET Fresh Food Automatic Pet Feeder | `cmvsy7zqh000jp0orhypwohho` | 6 | 0 | False (0 days) | G15: `INSUFFICIENT_HISTORY`<br>G16: `INSUFFICIENT_EVIDENCE` |
| `cand_1587534715` | The KittySpout™ - Wireless Fountain | *(None)* | 0 | 0 | False (0 days) | G15: `INSUFFICIENT_HISTORY`<br>G16: `INSUFFICIENT_EVIDENCE` |
| `cand_1613504636` | Pet Hair/Lint/Dust Cleaner | *(None)* | 0 | 0 | False (0 days) | G15: `INSUFFICIENT_HISTORY`<br>G16: `INSUFFICIENT_EVIDENCE` |

---

## 4. Test Verification Summary

- **Gate E1 (tsc --noEmit)**: Exit code 0, 0 TypeScript errors.
- **Gate E2 (git diff --check)**: Exit code 0, 0 whitespace errors.
- **Gate E3 (npm run kh02:test:unit)**: 94 files passed, 2,139 tests passed, 0 failed (duration: ~214.62s).
- **Gate E4 (npm run kh02:test:integration)**: 16 files passed, 77 tests passed, 0 failed (duration: ~71.87s).
- **Gate E5 (npm run kh01:verify)**: 5 files passed, 69 tests passed, 0 failed (duration: ~3.61s).
- **Gate E6 (runBacktestV12_4_3_4_2.ts)**: Policy=PASS, Dev=INSUFFICIENT_HISTORICAL_EVIDENCE, Holdout=INSUFFICIENT_HISTORICAL_EVIDENCE.
- **Gate E7 (v12_4_3_7_19_3_1_UnifiedCandidateAttribution.test.ts)**: 30/30 passed.
