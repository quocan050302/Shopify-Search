# 01 — Baseline HEAD, Tree, Worktree, and End-to-End Call Graph (KH-02 V12.4.3.7.19.3.3.1)

- **Audit Date**: `2026-11-08` (`Asia/Ho_Chi_Minh`)
- **Repository**: `quocan050302/Shopify-Search`
- **Locked Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Target Patch**: `V12.4.3.7.19.3.3.1` (`G15 CSV Authority Trust Boundary + Meta/Google Upstream-Provenance Truth + G16 Eligibility`)

---

## 1. Pre-Flight Baseline State (`C0`)

| Property | Value |
|---|---|
| `pwd` | `/Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search` |
| `git branch --show-current` | `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` |
| `C0` (`HEAD` & `origin/feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` before patch) | `b36c2e4b3704d8fc44a5d99a240da5caeda0dd1b` |
| `C0` Tree SHA | `db3e0e15d3a6b8fb834461155504a333cdb07fe0` |
| Prior V19.3.3 Code Commit | `6e71c24a311bffac200fb888554023f0d2e7c6b2` |
| Prior V19.3.3 Code Tree SHA | `2d928a6986844dc610d78cd84745ec9436cbf63b` |
| Initial `git status --porcelain=v1` | Empty (clean worktree) |
| Node / npm | `v24.12.0` / `11.6.2` |
| Vitest | `v5.0.5` |
| Prior Audit Folder Preserved Untouched | `reports/kh02/v19_3_3_g15_meta_google_closure/` |

###Tested Code Commit (`C1`)

| Property | Value |
|---|---|
| `C1` Commit SHA (`testedCodeCommitSha`) | `79b248e79c56a0a549cc8d681fd6e67ad61762fc` |
| `C1` Tree SHA (`testedTreeSha`) | `afdf6da09961f358e9010fc0d4547ebcb6d56cbc` |
| `C1` Parent Commit (`C0`) | `b36c2e4b3704d8fc44a5d99a240da5caeda0dd1b` |
| Worktree Status During Wave A–D Execution | Clean (`git status --porcelain=v1` empty) |

---

## 2. End-to-End Call Graph & Security Boundaries Inspected

### 2.1 P0 — G15 CSV Origin & Signing-Key / Approver Authority Call Graph

1. **[`durableCsvImportAuthority.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts)**
   - [`getCsvAuthorityKeyRegistry`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L199-L263) & [`getCsvAuthoritySigningKey`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L316-L333): Resolves HMAC-SHA256 signing keys. In `BUSINESS` scope, **only** the server environment-configured key (`KH02_CSV_AUTHORITY_KEY_ID` + `KH02_CSV_AUTHORITY_HMAC_SECRET`, with `KH02_CSV_AUTHORITY_KEY_STATUS=ACTIVE`) is trusted (`isBusinessTrusted: true`).
   - [`registerCsvAuthoritySigningKey`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L283-L310): Hard-fenced to test/engineering usage (`status = "TEST_ONLY"`, `isBusinessTrusted = false`) and blocked from registering in `NODE_ENV=production` or shadowing `KH02_CSV_AUTHORITY_KEY_ID`.
   - [`createSignedCsvImportAuthority`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L582-L725): Enforces non-empty `KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS` allowlist for all `BUSINESS`-scope (`!isTest`) `AUTHENTICATED_OFFICIAL_EXPORT` + `APPROVED` records regardless of `NODE_ENV` or `enforceApproverAuthority`; validates `acquisitionSourceUrl` (`https://trends.google.com/...`) when provided; rejects known repository fixture SHA-256 hashes.
   - [`readCsvAuthorityLedgerUnderLock`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L472-L527) & [`writeCsvAuthorityLedgerUnderLock`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L529-L546): Enforces `fs.lstatSync(...).isSymbolicLink()` checks on both the storage directory and the ledger file (`LEDGER_UNREADABLE` fail-closed).
   - [`verifyDurableCsvImportAuthority`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L880-L1240): Verifies HMAC-SHA256 digest & signature, key status (`ACTIVE`, not `REVOKED`/`COMPROMISED`/`TEST_ONLY`), monotonic revocation ledger (`AUTHORITY_REVOKED`), approver allowlist, canonical raw file path (`data/google_trends_imports/<sha256>.csv`), raw byte SHA-256 recomputation, header/query/US geography/cadence/date-span parity, workspace/product/candidate binding, and point-in-time `asOfTimestamp` (`FUTURE_IMPORT_LEAKAGE`).

2. **[`temporalDemandEngine.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts)**
   - [`hasVerifiableCsvOrProviderLineage`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts#L3971-L4351): Calls `verifyDurableCsvImportAuthority` and sets `providerOriginVerified: false` on all local CSV files (since Google Trends CSV exports do not carry a Google LLC server signature).
   - [`evaluateDemandSourceAuthority`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts#L4353-L4690): Evaluates record-level lineage using actual `obs.productId` and `obs.workspaceId` without silent substitution of `policy.targetProductId`; rejects observations missing explicit `productId` in `BUSINESS` / strict provenance scope.
   - [`evaluateDemandHistoryEvidence`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts#L4835-L5120): Evaluates Gate G15 (`>= 60` calendar days, `>= 3` data points, US geography, candidate-attributable query, `HISTORICAL_SOURCE_VERIFIED` authority).

3. **[`historicalDemandIngestion.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/historicalDemandIngestion.ts)** & **[`kh02PersistenceService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/persistence/kh02PersistenceService.ts)**
   - [`resolveProductDemandHistory`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/historicalDemandIngestion.ts#L1165-L1320): Preserves `r.productId ?? null` on DB rows instead of substituting `targetProductId`.
   - [`requalifyHistoricalEvergreenSnapshot`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/persistence/kh02PersistenceService.ts#L98-L195): Passes `asOfTimestamp` (`snapshot.createdAt`) and `candidateId` into `hasVerifiableCsvOrProviderLineage` to prevent retroactive future-import contamination of historical runs.

---

### 2.2 P1 — Google Ads Transparency & Meta Live Collector Call Graph

1. **[`googleTransparencyResearchAdapter.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts)**
   - [`discoverGoogleAdsMcpCapabilities`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L168-L355): Performs stdio FastMCP handshake (`initialize` + `tools/list`) with `providerContentObserved: false`, `providerVerified: false`, and `upstreamRequestVerified: false`.
   - [`decodeCallToolResult`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L106-L162) & [`recordActualGoogleMcpInvocation`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L397-L505): Enforces a hard `2 MiB` (`MAX_GOOGLE_MCP_RESPONSE_BYTES`) payload cap (`RESPONSE_TOO_LARGE`) and records invocation receipts in an unexported module-private Map.
   - [`verifyGoogleInvocationLineage`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L533-L685): Verifies invocation receipt existence, payload SHA-256, advertiser ID (`ADVERTISER_ID_MISMATCH`), advertiser domain (`ADVERTISER_DOMAIN_MISMATCH`), creative ID membership, and distinguishes `UPSTREAM_GOOGLE_RPC_ATTESTED` (`providerVerified: true` only when raw response contains verifiable `GetAdvertiserById` / `SearchCreatives` RPC metadata) from `LOCAL_MCP_RESULT_ATTESTED` (`providerVerified: false`, `localMcpToolResultVerified: true`).
   - [`normalizeGoogleAdsResponse`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L780-L1060): Classifies creatives lacking both `destinationUrl` and `productId` as `productRelevance: "UNKNOWN"` (`pdpVerified: false`), and keeps non-US creatives out of `verifiedUsCount`.
   - [`collectGoogleAdvertiserSignals`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/googleTransparencyResearchAdapter.ts#L1310-L1525): Attaches `providerInvocations` and reconciled enrichment execution counts (`rawCreativesCount`, `normalizedCount`, `usVerifiedCount`, `pdpBoundCount`, `candidateAttributableCount`).

2. **[`metaResearchAdapter.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/metaResearchAdapter.ts)**
   - [`diagnoseMetaLiveCollector`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/metaResearchAdapter.ts#L92-L265): Distinguishes `transportStatus` (`SKIPPED_DIAGNOSTIC_ONLY` vs `QUERY_ATTEMPTED_EMPTY_OR_BLOCKED` vs `QUERY_COMPLETED_WITH_ADS`) and `contentStatus` (`NO_QUERY_EXECUTED` vs `ZERO_ADS_RETURNED` vs `UPSTREAM_ADS_OBSERVED`), setting `provenanceVerified: Boolean(actualQueryAttempted && upstreamQueryCompleted && rawAdsReturned > 0)`.
   - [`resolveMetaMarketProvenance`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/providers/metaResearchAdapter.ts#L272-L355): Requires explicit `US` / `USA` / `UNITED STATES` in `rawTargetLocations` (`COUNTRY_ARRAY_EXPLICIT_US` or `RAW_TARGET_LOCATIONS_EXPLICIT_US`) before setting `usMarketVerified: true`; query parameters or empty location arrays never imply US delivery.
