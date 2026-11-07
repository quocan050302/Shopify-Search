# KH-02 V19.3.3 — Root Cause Analysis & Production Fixes

## 1. Defect A1: G15 CSV Origin Integrity Bypass (`LOCAL_INTEGRITY_ONLY` -> `HISTORICAL_SOURCE_VERIFIED`)

- **Actual functions / files**:
  - `src/services/kh02/demand/durableCsvImportAuthority.ts` (`registerDurableCsvImportAuthority`, `verifyDurableCsvImportAuthority`, `revokeDurableCsvImportAuthority`, `listDurableCsvImportAuthorities`)
  - `src/services/kh02/demand/temporalDemandEngine.ts` (`hasVerifiableCsvOrProviderLineage`, `resolveVerifiedDemandEvidence`, `evaluateDemandSourceAuthority`, `evaluateDemandHistoryEvidence`)
  - `src/services/kh02/demand/googleTrendsCsvValidator.ts` (`validateGoogleTrendsCsvPayload`)
  - `src/services/kh02/demand/historicalDemandIngestion.ts` (`ingestHistoricalDemandCsv`)
- **Root cause**:
  - `hasVerifiableCsvOrProviderLineage()` verified physical file existence, SHA-256 byte integrity, and row date/value matching in `data/google_trends_imports/`, then returned `lineageVerified: true`, `originKind: "VERIFIED_CSV_RAW_HASH"` without verifying whether the CSV file had a durable, authenticated official import authority record or whether the file was an `ENGINEERING` test fixture (`pet_water_fountain_12w_us.csv`).
  - `resolveVerifiedDemandEvidence()`, `evaluateDemandSourceAuthority()`, and `evaluateDemandHistoryEvidence()` promoted `GOOGLE_TRENDS_CSV` observations with `originKind === "VERIFIED_CSV_RAW_HASH"` directly to `sourceAuthority = "HISTORICAL_SOURCE_VERIFIED"`, `status = "VERIFIED"`, and `eligibleForEvergreen = true` even when `providerOriginVerified === false`.
- **Reproduction**:
  - Calling `evaluateDemandHistoryEvidence` on 12 weekly rows referencing `csv-import:google-trends-explore:sha256:6b21df0e75bc5f8261bd642573ca6851ba5b84ca7478b1cd6142e27ab36028f7:q=pet_water_fountain:geo=US:start=2026-01-04:end=2026-03-22:imported=2026-03-25T00:00:00.000Z` returned `status: "VERIFIED"`, `sourceAuthority: "HISTORICAL_SOURCE_VERIFIED"`, `eligibleForEvergreen: true` prior to the fix.
  - Pre-fix reproduction artifact preserved at `reports/kh02/v19_3_3_g15_meta_google_closure/logs/G15_PRE_FIX_REPRODUCTION_FAILURE.json`.
- **Before / After behavior**:
  - **Before**: Any local CSV file in `data/google_trends_imports/` with matching SHA-256 and matching rows passed `hasVerifiableCsvOrProviderLineage` with `lineageVerified = true` and satisfied G15 (`status = "VERIFIED"`, `eligibleForEvergreen = true`).
  - **After**: Physical CSV presence + SHA-256 + row match without a valid, non-revoked, HMAC-signed durable authority record (`AUTHENTICATED_OFFICIAL_EXPORT`) in `durableCsvImportAuthority.ts` is classified strictly as `originKind: "LOCAL_INTEGRITY_ONLY"`, `lineageVerified: false`, `businessLineageEligible: false`, `providerOriginVerified: false`. `resolveVerifiedDemandEvidence`, `evaluateDemandSourceAuthority`, and `evaluateDemandHistoryEvidence` reject it with `LOCAL_CSV_NOT_LIVE_PROVIDER` (`sourceAuthority: "UNVERIFIED_SOURCE"`, `status: "UNVERIFIED_SOURCE"`, `eligibleForEvergreen: false`).
- **Negative test previously failing**:
  - `tests/unit/kh02/g15CsvOriginIntegrity.test.ts` — `N01: rejects exact reproduced pet_water_fountain_12w_us.csv fixture with valid SHA-256 and 12 weekly rows` (30 negative cases `N01`–`N30`).
- **Positive engineering verification**:
  - `tests/unit/kh02/g15CsvOriginIntegrity.test.ts` — `P01`–`P06` (`TEST_ONLY/ENGINEERING` signed authority registration, DB round-trip, restart persistence, and monotonic revocation).
- **Live verification**:
  - `scripts/kh02/runThreeSourceFreeMcpSmoke.ts` (`S6`) and `scripts/kh02/runCandidateDbReadback.ts` verify all 17 local CSV files in `data/google_trends_imports/` are classified as `LOCAL_INTEGRITY_ONLY` with `0` authenticated official exports.
- **G15 / G16 impact**:
  - Prevents any test fixture or unauthenticated local CSV from satisfying G15 or promoting a candidate to G16 Top 3.
- **External dependency remaining**:
  - Genuine Google-issued >=60-day US longitudinal demand exports registered via `AUTHENTICATED_OFFICIAL_EXPORT` authority for each shortlisted candidate.

---

## 2. Defect A2: Candidate Attribution Substitution & Legacy Snapshot Requalification

- **Actual functions / files**:
  - `src/services/kh02/demand/temporalDemandEngine.ts` (`evaluateDemandSourceAuthority`, `classifyCandidateObservationAttribution`)
  - `src/services/kh02/scoring/evergreenOpportunityScoring.ts` (`verifyEvergreenCandidateIndependently`, `calculateKH02EvergreenScore`)
  - `src/services/kh02/persistence/kh02PersistenceService.ts` (`requalifyHistoricalEvergreenSnapshot`)
- **Root cause**:
  - `evaluateDemandSourceAuthority` fell back to `obs.productId || policy.candidateContext?.productId` when invoking `hasVerifiableCsvOrProviderLineage`, inadvertently stamping the target candidate's `productId` onto observations that lacked `obs.productId` or belonged to a different product.
  - `requalifyHistoricalEvergreenSnapshot` checked `hasVerifiableCsvOrProviderLineage` without requiring `businessLineageEligible === true` and `originKind === "VERIFIED_OFFICIAL_CSV_IMPORT"` for `GOOGLE_TRENDS_CSV` rows.
- **Reproduction**:
  - Passing an observation with `productId: "prod_other_sku"` or `keyword: "cat litter mat"` to `evaluateDemandHistoryEvidence` for candidate `"uahpet water fountain"` or loading a legacy snapshot containing `LOCAL_INTEGRITY_ONLY` CSV references.
- **Before / After behavior**:
  - **Before**: Missing `obs.productId` inherited `policy.candidateContext.productId`, and legacy snapshots with local CSV hashes could retain `evergreenEligible: true`.
  - **After**: `evaluateDemandSourceAuthority` passes only `obs.productId` as the observed product ID and enforces `classifyCandidateObservationAttribution` (`FOREIGN_PRODUCT_ID_MISMATCH`, `KEYWORD_DOES_NOT_ATTRIBUTE_CANDIDATE`, `NICHE_GENERIC_TERM_NOT_PRODUCT_SPECIFIC`). `requalifyHistoricalEvergreenSnapshot` demotes any legacy snapshot whose demand evidence is `LOCAL_INTEGRITY_ONLY` (`evergreenEligibleCount = 0`).
- **Negative test previously failing**:
  - `tests/unit/kh02/g15CsvOriginIntegrity.test.ts` (`N12`, `N13`, `N14`, `N19`, `N23`).
- **Positive engineering verification**:
  - `tests/unit/kh02/g15CsvOriginIntegrity.test.ts` (`P02`, `P06`).
- **G15 / G16 impact**:
  - Enforces strict per-candidate demand attribution and ensures reload/readback demotes stale/unauthenticated snapshots.
- **External dependency remaining**:
  - Candidate-specific official historical demand data.

---

## 3. Defect B1: Meta Collector Subprocess Cleanup, Config Semantics & Raw Provenance Persistence

- **Actual functions / files**:
  - `src/services/discovery/metaCollector/metaCollectorMcpClient.ts` (`createMetaCollectorClient`, `getMetaCollectorCapabilities`, `getDetailedMetaAdsBatch`)
  - `src/services/kh02/providers/metaResearchAdapter.ts` (`diagnoseMetaLiveCollector`)
  - `src/services/discovery/discoveryIngestionService.ts` (`ingestDiscoveredAds`)
  - `src/services/discovery/types.ts` (`SourceEvidence`)
- **Root cause**:
  - `createMetaCollectorClient` did not clean up the spawned child process if `listTools()` threw after `client.connect()`, and `close()` did not remove exit/error listeners or terminate a stubborn subprocess.
  - `diagnoseMetaLiveCollector` did not check `config.enabled === false` before checking binary paths.
  - `ingestDiscoveredAds` stored only a minimal subset (`providerId`, `platform`, `sourceExternalId`, `outboundUrl`) inside `AdObservation.rawPayload`, losing `sourceTimestamp`, `rawEvidenceReference`, `sourceEvidence` (`creativeVariants`, `queryId`, `matchedQueryIds`, `providerRequestId`, `researchRunId`), and `marketEvidenceType` across DB restarts.
- **Reproduction**:
  - Ingesting a normalized Meta ad via `ingestDiscoveredAds` and reading back `AdObservation.rawPayload` from SQLite showed missing `rawEvidenceReference` and `sourceEvidence`.
- **Before / After behavior**:
  - **Before**: `AdObservation.rawPayload` omitted full `sourceEvidence` and `rawEvidenceReference`; `listTools()` failure could leave an open child process.
  - **After**: `createMetaCollectorClient` cleans up on `listTools()` failure and guarantees subprocess termination in `close()`; `diagnoseMetaLiveCollector` honors `config.enabled`; `ingestDiscoveredAds` persists full `sourceTimestamp`, `rawEvidenceReference`, `sourceEvidence`, `landingPageUrl`, `targetMarket`, and `marketEvidenceType` in `AdObservation.rawPayload`.
- **Negative test previously failing**:
  - `tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` (`B01`–`B06`).
- **Positive engineering verification**:
  - `tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` (`B04` DB round-trip verifying `firstObservedAt` preservation, `sourceRecordId !== sourceExternalAdId`, and full `AdObservation.rawPayload` survival).
- **Live verification**:
  - Verified in `META_LIVE_PROVENANCE.json` and `10_THREE_SOURCE_MCP_PROTOCOL_AND_PROVIDER_SMOKE.json`.
- **G15 / G16 impact**:
  - Preserves immutable Meta ad provenance and creative bindings in SQLite across worker/API restarts.
- **External dependency remaining**:
  - Public Meta Ad Library upstream rate-limit availability during live queries.

---

## 4. Defect C1: Google Transparency HTTP Deadlines, Subprocess Cleanup, Brand Classification & Provenance Persistence

- **Actual functions / files**:
  - `scripts/googleTransparencyServer.py` (`_InstallBoundedTimeoutAdapter`, `search_advertiser`, `get_advertiser_ads`)
  - `src/services/kh02/providers/googleTransparencyResearchAdapter.ts` (`createGoogleTransparencyMcpClient`, `invokeGoogleMcpTool`, `normalizeGoogleAdsResponse`, `persistGoogleObservationsToDatabase`)
  - `src/services/kh02/scoring/evergreenOpportunityScoring.ts` (`calculateKH02EvergreenScore`)
  - `scripts/kh02/runThreeSourceFreeMcpSmoke.ts` (`runThreeSourceFreeMcpSmoke`)
  - `scripts/kh02/runCandidateDbReadback.ts` (`executeCandidateDbReadback`)
- **Root cause**:
  - Upstream `google-ads-transparency-mcp` called `requests.Session.get/post` without explicit `(connect_timeout, read_timeout)` or response-size caps.
  - `createGoogleTransparencyMcpClient` did not kill the Python child process if `connect()` timed out or failed.
  - `normalizeGoogleAdsResponse` allowed root-domain (`/`) or `/collections/` destination URLs to be classified as `PRODUCT_SPECIFIC` when the headline contained product tokens.
  - `persistGoogleObservationsToDatabase` overwrote `obs.evidenceReference` with `CompetitorAd:${adRow.id}` (destroying the `google-transparency-mcp:sha256:...` receipt reference), defaulted `advertiser.country` to `"US"` even when `verifiedDeliveryMarket === null`, and did not persist `AdSourceIdentity` / `AdObservation` rows with the MCP invocation receipt.
  - `calculateKH02EvergreenScore` counted `FACEBOOK` and `INSTAGRAM` as separate supporting source types and granted multi-platform `GOOGLE_ADS` score points even when all Google Ads observations were `BRAND_RELATED` / `BRAND_ONLY_MATCH`.
- **Reproduction**:
  - Calling `normalizeGoogleAdsResponse` with `targetUrl: "https://uahpet.com/"` or `"https://uahpet.com/collections/all"` and headline `"UAHPET Zero Wireless Cat Water Fountain"` previously returned `evidenceClassification: "PRODUCT_SPECIFIC"`.
  - Calling `persistGoogleObservationsToDatabase` overwrote `obs.evidenceReference` with `CompetitorAd:<id>`.
- **Before / After behavior**:
  - **Before**: Root/collection URLs could become `PRODUCT_SPECIFIC`; `persistGoogleObservationsToDatabase` overwrote `obs.evidenceReference` and defaulted `country` to `"US"`; `calculateKH02EvergreenScore` double-counted Meta placements and brand-only Google ads.
  - **After**:
    - `scripts/googleTransparencyServer.py` patches `requests.Session.request` with explicit `(connect=5.0s, read=10.0s)` deadlines, 2MB payload cap, max 25 creatives, and 0 retries on 429/403/CAPTCHA.
    - `createGoogleTransparencyMcpClient` and `invokeGoogleMcpTool` enforce `finally` cleanup and child process termination.
    - `normalizeGoogleAdsResponse` classifies root (`/`) and collection/category (`/collections/`, `/category/`, `/pages/`) URLs strictly as `BRAND_RELATED` and empty creatives as `UNKNOWN`.
    - `persistGoogleObservationsToDatabase` preserves `obs.evidenceReference`, sets `obs.persistedAdId` and `obs.metrics.dbRecordReference`, sets `country: "UNKNOWN"` when `verifiedDeliveryMarket === null`, persists `AdSourceIdentity` and `AdObservation` with the full MCP invocation receipt, and returns structured `{ insertedCount, updatedCount, rejectedCount, failedCount, errors }`.
    - `calculateKH02EvergreenScore` normalizes `FACEBOOK`/`INSTAGRAM`/`META` to `META_ADS` and excludes `BRAND_RELATED`/`BRAND_ONLY_MATCH` Google observations from product-specific multi-platform scoring.
- **Negative test previously failing**:
  - `tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` (`C01`–`C05`, `D01`–`D02`, `E01`–`E02`).
- **Positive engineering verification**:
  - `tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` (14/14 passing).
- **Live verification**:
  - Verified in `GOOGLE_LIVE_PROVENANCE.json` and `10_THREE_SOURCE_MCP_PROTOCOL_AND_PROVIDER_SMOKE.json`.
- **G15 / G16 impact**:
  - Ensures brand-level Google Ads creatives cannot inflate product-specific multi-platform confidence or materialize phantom winning products.
- **External dependency remaining**:
  - Upstream Google Ads Transparency RPC availability for target merchant domains.
