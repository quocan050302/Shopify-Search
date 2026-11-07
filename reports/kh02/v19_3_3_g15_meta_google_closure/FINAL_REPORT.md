# KH-02 V19.3.3 — G15 CSV Origin Integrity & Meta/Google Production Flow Closure Report

## 1. Executive Summary & Separated 5-State Verdicts

- **Audited Baseline Revision**: `c5f69173aab4a0df0788962b3dd78019c14f6fb8` (Tree: `a0c6c45899704b435493169f3e92402ceede5789`)
- **Tested Code Revision**: `6e71c24a311bffac200fb888554023f0d2e7c6b2` (Tree: `2d928a6986844dc610d78cd84745ec9436cbf63b`)
- **Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Total Paid API Spend**: `$0.00`

| State Dimension | Status | Summary |
| :--- | :--- | :--- |
| **A. ENGINEERING_CORRECTNESS** | `ENGINEERING_FIX_VERIFIED` | G15 local CSV origin hole closed; durable signed CSV import authority implemented; Meta/Google provenance & persistence hardened; `tsc --noEmit` (0 errors), unit (`106/106` files, `2,492/2,492` tests), integration (`16/16` files, `77/77` tests), `kh01:verify` (`5/5` files, `69/69` tests) all green. |
| **B. LIVE_PROVIDER_CONTENT** | `LIVE_META_CONTENT_VERIFIED` / `LIVE_GOOGLE_CONTENT_VERIFIED` | Bounded live Meta collector retrieved `21` real ads; bounded live Google Transparency FastMCP retrieved `2` advertisers (`uahpet.com`, `kittyspout.com`) and `6` real creatives; TikTok Organic remains `POLICY_DISABLED`; TikTok Ads US remains `DEFERRED`. |
| **C. PRODUCTION_PIPELINE_INTEGRITY** | `VERIFIED` | Full HTTP 202 -> Worker Claim & Execution -> SQLite Persistence -> HTTP API Readback -> Headless Chromium Browser E2E & Reload Reconciliation verified (`tests/integration/kh02BrowserAcceptance.test.ts`, `tests/integration/kh02V12_1_3_Acceptance.test.ts`). |
| **D. G15_BUSINESS_EVIDENCE** | `G15_INSUFFICIENT_EVIDENCE` | `0` official authenticated `>=60`-day US longitudinal demand rows exist in the production database (`6` raw UAHPET rows use `verified-merchant-demand` pseudo-reference; `17` local CSV files are `LOCAL_INTEGRITY_ONLY`). |
| **E. G16_TOP3_ELIGIBILITY** | `G16_INSUFFICIENT_EVIDENCE` | `0/3` eligible Evergreen Top 3 winners (shortlist contains `3` distinct product families, but all `3` fail G15 historical demand verification). |
| **Overall Release Gate** | `RELEASE_HOLD` | Engineering integrity fixes are verified; business release remains held pending authentic `>=60`-day US historical demand evidence. |

---

## 2. Authoritative Final Run Artifacts

All authoritative final artifacts for this closure are located in `reports/kh02/v19_3_3_g15_meta_google_closure/`:

1. `REVISION_AND_ENVIRONMENT.json`
2. `ROOT_CAUSE_AND_FIXES.md`
3. `G15_ORIGIN_NEGATIVE_TESTS.json` (plus pre-fix failure capture at `logs/G15_PRE_FIX_REPRODUCTION_FAILURE.json`)
4. `G15_IMPORT_AUTHORITY_TESTS.json`
5. `META_LIVE_PROVENANCE.json`
6. `GOOGLE_LIVE_PROVENANCE.json`
7. `MERCHANT_IDENTITY_RESULTS.json`
8. `CANONICAL_PRODUCT_AND_FAMILY_LEDGER.json`
9. `WORKER_DB_HTTP_UI_RECONCILIATION.json`
10. `REGRESSION_RESULTS.json`
11. `DEV_HOLDOUT_BACKTEST_RESULTS.json`
12. `RESOURCE_AND_CANCELLATION_RESULTS.json`
13. `FINAL_VERDICT.json`
14. `FINAL_REPORT.md`
15. `ARTIFACT_MANIFEST.json`

---

## 3. Summary of Production Code Fixes

1. **G15 CSV Origin Integrity & Durable Official Import Authority**:
   - Created `src/services/kh02/demand/durableCsvImportAuthority.ts` implementing a durable, HMAC-SHA256 signed, monotonically revocable official CSV import authority ledger with explicit `ENGINEERING` vs `BUSINESS` scope separation.
   - Updated `hasVerifiableCsvOrProviderLineage`, `resolveVerifiedDemandEvidence`, `evaluateDemandSourceAuthority`, and `evaluateDemandHistoryEvidence` in `src/services/kh02/demand/temporalDemandEngine.ts` so local CSV files with valid SHA-256 and row matches but no durable `AUTHENTICATED_OFFICIAL_EXPORT` authority are classified strictly as `originKind: "LOCAL_INTEGRITY_ONLY"`, `lineageVerified: false`, `businessLineageEligible: false`, `providerOriginVerified: false`, and rejected with `LOCAL_CSV_NOT_LIVE_PROVIDER` (`sourceAuthority: "UNVERIFIED_SOURCE"`, `status: "UNVERIFIED_SOURCE"`, `eligibleForEvergreen: false`).
   - Fixed the candidate attribution substitution bug in `evaluateDemandSourceAuthority` where missing `obs.productId` previously inherited `policy.candidateContext.productId`.
   - Updated `validateGoogleTrendsCsvPayload` (`src/services/kh02/demand/googleTrendsCsvValidator.ts`) and `ingestHistoricalDemandCsv` (`src/services/kh02/demand/historicalDemandIngestion.ts`) so caller-supplied boolean flags (`verifiedByOfficialExport: true`, `verifiedOfficialExport: true`) cannot self-authenticate a CSV import without a verified durable authority record.
   - Updated `requalifyHistoricalEvergreenSnapshot` (`src/services/kh02/persistence/kh02PersistenceService.ts`) so legacy snapshots referencing `LOCAL_INTEGRITY_ONLY` CSV rows are demoted on reload (`evergreenEligibleCount = 0`).

2. **Meta Production Flow Closure**:
   - Updated `createMetaCollectorClient` (`src/services/discovery/metaCollector/metaCollectorMcpClient.ts`) to clean up the spawned child process if `listTools()` fails after `connect()` and to remove listeners / terminate the child process in `close()`.
   - Updated `diagnoseMetaLiveCollector` (`src/services/kh02/providers/metaResearchAdapter.ts`) to respect `config.enabled === false`.
   - Updated `ingestDiscoveredAds` (`src/services/discovery/discoveryIngestionService.ts`) to persist `sourceTimestamp`, `rawEvidenceReference`, `sourceEvidence` (`creativeVariants`, `queryId`, `matchedQueryIds`, `providerRequestId`, `researchRunId`), `landingPageUrl`, `targetMarket`, and `marketEvidenceType` in `AdObservation.rawPayload` so full provenance survives restarts.

3. **Google Transparency Production Flow Closure**:
   - Updated `scripts/googleTransparencyServer.py` to enforce explicit `(connect=5.0s, read=10.0s)` HTTP deadlines, a `2MB` payload cap, max `25` creatives per response, and `0` retries on `429`/`403`/CAPTCHA.
   - Updated `createGoogleTransparencyMcpClient` and `invokeGoogleMcpTool` (`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`) to guarantee child-process cleanup on error or `finally`.
   - Updated `normalizeGoogleAdsResponse` (`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`) so root-domain (`/`) and collection/category (`/collections/`, `/category/`, `/pages/`) URLs are classified strictly as `BRAND_RELATED` and empty creatives as `UNKNOWN`.
   - Updated `persistGoogleObservationsToDatabase` (`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`) to preserve `obs.evidenceReference`, record `obs.persistedAdId` and `obs.metrics.dbRecordReference`, set `advertiser.country = "UNKNOWN"` when `verifiedDeliveryMarket === null`, persist `AdSourceIdentity` and `AdObservation` with the full MCP invocation receipt, and return structured `{ insertedCount, updatedCount, rejectedCount, failedCount, errors }`.

4. **Identity, Distinctness, Scoring & Diagnostics**:
   - Updated `calculateKH02EvergreenScore` (`src/services/kh02/scoring/evergreenOpportunityScoring.ts`) to normalize `FACEBOOK`/`INSTAGRAM`/`META` to `META_ADS` and exclude `BRAND_RELATED`/`BRAND_ONLY_MATCH` Google Ads observations from product-specific multi-platform scoring.
   - Updated `scripts/kh02/runThreeSourceFreeMcpSmoke.ts` and `scripts/kh02/runCandidateDbReadback.ts` to report protocol-only vs provider-content status, `POLICY_DISABLED` TikTok Organic, `LOCAL_INTEGRITY_ONLY` CSV files (`0` official exports), and separated DB connection status vs business G15/G16 verdicts.
