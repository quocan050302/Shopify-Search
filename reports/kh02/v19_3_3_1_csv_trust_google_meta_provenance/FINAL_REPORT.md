# KH-02 V12.4.3.7.19.3.3.1 — Final Engineering & Security Audit Report

- **Date**: `2026-11-08` (`Asia/Ho_Chi_Minh`)
- **Repository**: `quocan050302/Shopify-Search`
- **Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Pre-Fix Baseline (`C0`)**: `b36c2e4b3704d8fc44a5d99a240da5caeda0dd1b` (Tree: `db3e0e15d3a6b8fb834461155504a333cdb07fe0`)
- **Tested Code Commit (`C1`)**: `79b248e79c56a0a549cc8d681fd6e67ad61762fc` (Tree: `afdf6da09961f358e9010fc0d4547ebcb6d56cbc`)
- **Paid API Spend**: `$0.00`

---

## 1. Executive Summary & 13-Dimension Release Truth Matrix

| Dimension | Verdict | Explanation |
|---|---|---|
| `ENGINEERING_CORRECTNESS` | `PASS` | All 128 test files (`2,672/2,672` tests across unit, integration, and KH-01 suites) and `tsc --noEmit` pass with zero failures against committed `C1`. |
| `CSV_AUTHORITY_TRUST_BOUNDARY` | `PASS` | Closed `registerCsvAuthoritySigningKey` business-trust escalation, enforced `KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS` unconditionally in `BUSINESS` scope, enforced `acquisitionSourceUrl` validation, blocked symlinked ledger files, removed silent `productId` substitution, and enforced `asOfTimestamp` on snapshot requalification. |
| `GOOGLE_MCP_PROTOCOL_HANDSHAKE` | `PROTOCOL_HANDSHAKE_VERIFIED` | Local FastMCP stdio server (`scripts/googleTransparencyServer.py`) completes `initialize` and `tools/list` (`search_advertiser`, `get_advertiser_ads`) at `$0.00`. |
| `GOOGLE_UPSTREAM_CREATIVE_PROVENANCE` | `UPSTREAM_NOT_OBSERVED` | Separated `LOCAL_MCP_RESULT_ATTESTED` (`providerVerified: false`, `localMcpToolResultVerified: true`) from `UPSTREAM_GOOGLE_RPC_ATTESTED` (`providerVerified: true` only when raw response carries `GetAdvertiserById`/`SearchCreatives` RPC metadata); enforced advertiser ID/domain binding and `2 MiB` payload limit. |
| `META_COLLECTOR_TRANSPORT` | `AVAILABLE_NO_PAID_KEY_REQUIRED` | Local `meta-ads-collector` v1.7.0 Python runtime verified without any paid Graph API token. |
| `META_UPSTREAM_CONTENT` | `UPSTREAM_ZERO_ADS_OR_UNVERIFIED` | `diagnoseMetaLiveCollector` now requires `rawAdsReturned > 0` before setting `provenanceVerified: true` and exposes explicit `transportStatus` and `contentStatus`. |
| `TIKTOK_ORGANIC_HASDATA` | `POLICY_DISABLED` | Server-side hard-disabled (`$0.00`). |
| `TIKTOK_ADS_US` | `DEFERRED` | Deferred by KH-02 directive (`$0.00`). |
| `BIGQUERY_WAREHOUSE` | `NOT_CONFIGURED` | Billing disabled / not configured (`$0.00`). |
| `OFFICIAL_CSV_60_DAY_G15` | `INSUFFICIENT_EVIDENCE` | Production SQLite DB (`prisma/dev.db`) has 6 raw rows with `verified-merchant-demand` pseudo-reference and `0` official authenticated `>=60`-day US Google Trends CSV rows; `3` local CSV files on disk are `LOCAL_INTEGRITY_ONLY`. |
| `G16_TOP3_ELIGIBLE` | `0/3` | `0/3` candidates (`cand_uahpet_feeder`, `cand_pawira_fountain`, `cand_furzapper_remover`) satisfy Gate G15 longitudinal demand in `BUSINESS` scope. |
| `HISTORICAL_DEV_HOLDOUT_BACKTEST` | `INSUFFICIENT_HISTORICAL_EVIDENCE` | Policy scenarios `PASS`, point-in-time integrity `PASS` (`zeroFutureLeakageVerified: true`), DEV/HOLDOUT business verdict `INSUFFICIENT_HISTORICAL_EVIDENCE`. |
| `PRODUCTION_RELEASE` | `RELEASE_HOLD` | Engineering gates are `PASS`, but production business release remains on `RELEASE_HOLD` until real `>=60`-day official US Google Trends exports and live upstream ad creatives are ingested. |

---

## 2. Summary of Root-Cause Production Fixes in `C1` (`79b248e79c56a0a549cc8d681fd6e67ad61762fc`)

1. **[`src/services/kh02/demand/durableCsvImportAuthority.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts)**:
   - Fenced `registerCsvAuthoritySigningKey` strictly to `TEST_ONLY` / `isBusinessTrusted: false`, blocked registration in `NODE_ENV=production`, and prevented shadowing `KH02_CSV_AUTHORITY_KEY_ID`.
   - Restricted `getCsvAuthorityKeyRegistry("BUSINESS")` to the server environment key (`KH02_CSV_AUTHORITY_KEY_ID` + `KH02_CSV_AUTHORITY_HMAC_SECRET`), while honoring `REVOKED`/`COMPROMISED` overrides.
   - Enforced `KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS` allowlist unconditionally for all `BUSINESS`-scope `AUTHENTICATED_OFFICIAL_EXPORT` + `APPROVED` records in both `createSignedCsvImportAuthority` and `verifyDurableCsvImportAuthority`.
   - Validated `acquisitionSourceUrl` (`https://trends.google.com/...` with US geo) when supplied on `BUSINESS`-scope records.
   - Added `fs.lstatSync` symbolic-link checks on both the CSV authority storage directory and ledger file (`LEDGER_UNREADABLE`).

2. **[`src/services/kh02/demand/temporalDemandEngine.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts)**, **[`src/services/kh02/demand/historicalDemandIngestion.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/historicalDemandIngestion.ts)**, & **[`src/services/kh02/persistence/kh02PersistenceService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/persistence/kh02PersistenceService.ts)**:
   - Removed silent `obs.productId ?? expectedProductId` and `r.productId || targetProductId` substitution so observations missing `productId` are rejected in `BUSINESS` / strict provenance scope.
   - Passed `asOfTimestamp` (`snapshot.createdAt`) and `candidateId` into `hasVerifiableCsvOrProviderLineage` inside `requalifyHistoricalEvergreenSnapshot`.

3. **[`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts)** & **[`src/services/kh02/types.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/types.ts)**:
   - Enforced `2 MiB` (`MAX_GOOGLE_MCP_RESPONSE_BYTES`) payload limit in `decodeCallToolResult` and `recordActualGoogleMcpInvocation` (`RESPONSE_TOO_LARGE`).
   - Added `ADVERTISER_ID_MISMATCH` and `ADVERTISER_DOMAIN_MISMATCH` checks plus `provenanceTier` (`UPSTREAM_GOOGLE_RPC_ATTESTED` vs `LOCAL_MCP_RESULT_ATTESTED`), `localMcpToolResultVerified`, and `upstreamRequestVerified` in `verifyGoogleInvocationLineage`.
   - Changed `normalizeGoogleAdsResponse` so creatives with neither `destinationUrl` nor `productId` are classified as `productRelevance: "UNKNOWN"` (`pdpVerified: false`) and never emit product-bound `observations`.
   - Attached `providerInvocations` and `enrichmentExecution.reconciledCounts` in `collectGoogleAdvertiserSignals`.

4. **[`src/services/kh02/providers/metaResearchAdapter.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/metaResearchAdapter.ts)**:
   - Changed `diagnoseMetaLiveCollector` so `provenanceVerified` is `Boolean(actualQueryAttempted && upstreamQueryCompleted && rawAdsReturned > 0)` and added `transportStatus` and `contentStatus`.

---

## 3. Bounded Verification Summary on `C1` (`79b248e79c56a0a549cc8d681fd6e67ad61762fc`)

| Wave | Command | Exit Code | Files | Tests | Duration |
|---|---|---:|---:|---:|---:|
| `PRE_FIX_RED` (`C0`) | `npx vitest run tests/unit/kh02/v19_3_3_1_CsvTrustAndGoogleMetaProvenance.test.ts --no-file-parallelism` | `1` | `1` | `17 failed / 17 passed (34)` | `2.08s` |
| `A1_typecheck` | `npx tsc --noEmit` | `0` | — | — | `9.40s` |
| `A2_v19_3_3_1_security_suite` | `npx vitest run tests/unit/kh02/v19_3_3_1_CsvTrustAndGoogleMetaProvenance.test.ts --no-file-parallelism` | `0` | `1/1` | `34/34` | `1.97s` |
| `A3_g15_csv_origin_integrity` | `npx vitest run tests/unit/kh02/g15CsvOriginIntegrity.test.ts --no-file-parallelism` | `0` | `1/1` | `36/36` | `1.19s` |
| `A4_meta_google_production_flow` | `npx vitest run tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts --no-file-parallelism` | `0` | `1/1` | `14/14` | `3.23s` |
| `B1_kh02_unit_all` | `npm run kh02:test:unit -- --maxWorkers=2` | `0` | `107/107` | `2526/2526` | `252.09s` |
| `C1_kh02_integration` | `npx vitest run tests/integration/kh02 --no-file-parallelism` | `0` | `16/16` | `77/77` | `84.33s` |
| `D1_kh01_regression` | `npm run kh01:verify` | `0` | `5/5` | `69/69` | `4.10s` |
| `D2_dev_holdout_backtest` | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` | `0` | — | `Policy=PASS, PointInTime=PASS` | `1.80s` |
| `D3_db_readback` | `npx tsx scripts/kh02/runCandidateDbReadback.ts` | `0` | — | `dbConnected=true, verifiedCsv=0` | `2.40s` |
| `D4_free_mcp_smoke` | `VITEST=1 npx tsx scripts/kh02/runThreeSourceFreeMcpSmoke.ts` | `0` | — | `$0.00 spend` | `3.10s` |
