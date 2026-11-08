# KH-02 V12.4.3.7.19.3.3.3 — Baseline Branch, SHA, Tree & Call Graph

## 1. Repository & Locked Branch Lineage

| Field | Value |
|---|---|
| Repository | `quocan050302/Shopify-Search` |
| Locked Branch | `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` |
| Prior Audited Code Commit (V19.3.3.2 `C1`) | `c856f5751f877e7249ea6739d41bf862922a003b` |
| Prior Audited Code Tree (V19.3.3.2 `C1^{tree}`) | `bfab7262eeef3ead2f3ccaad28a1eced3c78f9e9` |
| Prior Verified GitHub Actions Run (V19.3.3.2 `C1`) | `42451749802` (`6/6` required jobs `success`) |
| Immutable Baseline Commit (`C0`) | `af1f6d0dcdbecc18ebbd3736f07c365b830f5b39` |
| Immutable Baseline Tree (`C0^{tree}`) | `d9a0ca40cd719fa4c1dcd2491f29d9dd4eb72ee5` |
| Tested Code Commit (`C1`) | `4ac0df13cb190aac01ce6094caa299f0da1defe0` |
| Tested Code Tree (`C1^{tree}`) | `dfade8bcbc28da97aae4cfe5becc41d3d2063da8` |

---

## 2. Production Code Delta (`C0..C1`)

```text
M  src/services/kh02/demand/durableCsvImportAuthority.ts
M  src/services/kh02/persistence/kh02PersistenceService.ts
M  src/services/kh02/scoring/evergreenOpportunityScoring.ts
A  tests/unit/kh02/v19_3_3_3_OfficialTrendsQueryGeoAndGoogleScoreTruth.test.ts
```

---

## 3. End-to-End Call Graph & Trust Boundaries

### 3.1 P1-A (G15): Official Google Trends Explore URL `q` & `geo` Binding

1. **URL Origin & Query/Geography Validation**
   - File: `src/services/kh02/demand/durableCsvImportAuthority.ts`
   - Symbol: `validateOfficialGoogleTrendsAcquisitionUrl(rawUrl, expectedQuery, expectedGeo)` (lines `259–357`)
   - Enforces:
     - Exact `https://trends.google.com` origin, `https:` scheme, empty `username`/`password`/`port`, and path matching `/^\/trends\/explore(?:\/|$)/i`.
     - `parsedUrl.searchParams.getAll("geo")`: must have length `=== 1` (`ACQUISITION_GEO_REQUIRED` if `0`, `AMBIGUOUS_ACQUISITION_PARAMETERS` if `> 1`), non-empty, no double-encoding (`/%[0-9a-fA-F]{2}/`) or comma-separated multi-region values, and `normalizeCsvAuthorityGeography(rawGeo) === "US"` matching `expectedGeo` (`ACQUISITION_GEO_MISMATCH`).
     - `parsedUrl.searchParams.getAll("q")`: must have length `=== 1` (`ACQUISITION_QUERY_REQUIRED` if `0`, `AMBIGUOUS_ACQUISITION_PARAMETERS` if `> 1`), non-empty, no double-encoding (`/%[0-9a-fA-F]{2}/`) or comma-separated multi-term comparison (`q=term1,term2`), and **whole-term normalized equality** `normalizeCsvAuthorityQuery(rawQ) === normalizeCsvAuthorityQuery(expectedQuery)` (`ACQUISITION_QUERY_MISMATCH` on prefix/substring/superstring or unrelated keyword).

2. **Schema v2 Authority Issuance & Canonical Digest Signing**
   - File: `src/services/kh02/demand/durableCsvImportAuthority.ts`
   - Symbols:
     - `computeCsvAuthorityPayloadDigest(record)` (lines `401–460`)
     - `signCsvAuthorityPayloadDigest(payloadDigest, secret)` (lines `462–468`)
     - `createSignedCsvImportAuthority(input)` (lines `470–628`)
   - Calls `validateOfficialGoogleTrendsAcquisitionUrl(input.acquisitionSourceUrl, input.query, input.geography)` for all non-test (`!isTestOnly`) `AUTHENTICATED_OFFICIAL_EXPORT` records and binds `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, and `acquisitionMethod` into the Schema `2.0` canonical HMAC-SHA256 digest.

3. **Durable Readback & Business Eligibility Verification**
   - File: `src/services/kh02/demand/durableCsvImportAuthority.ts`
   - Symbol: `verifyDurableCsvImportAuthority(query)` (lines `720–1060`)
   - Re-validates Schema `2.0`, HMAC-SHA256 signature, and calls `validateOfficialGoogleTrendsAcquisitionUrl(record.acquisitionSourceUrl, record.query, record.geography)` on readback so any pre-existing or disk-edited record missing `q` or `geo` (or having a substring/mismatched `q` or `geo`) fails closed with `verified: false`, `businessEligible: false`, `sourceOriginVerified: false`, and `providerOriginVerified: false`.

4. **Temporal Demand Engine & G15 Gate**
   - File: `src/services/kh02/demand/temporalDemandEngine.ts`
   - Symbols: `hasVerifiableCsvOrProviderLineage`, `evaluateDemandSourceAuthority`, `evaluateDemandHistoryEvidence`
   - Consumes `verifyDurableCsvImportAuthority` in `BUSINESS` scope; denies `HISTORICAL_SOURCE_VERIFIED` and `eligibleForEvergreen` whenever `businessEligible !== true`.

---

### 3.2 P1-B (G16): Google Ads Multi-Platform Score & Confidence Qualification

1. **Google MCP Lineage & Upstream Attestation**
   - File: `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
   - Symbols: `verifyGoogleInvocationLineage`, `attachGoogleMcpCreativeProvenance`, `collectGoogleAdvertiserSignals`
   - Distinguishes local MCP tool receipts (`localMcpToolResultVerified: true`, `provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED"`, `upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED"`, `providerVerified: false`, `upstreamRequestVerified: false`) from independently attested upstream Google responses.

2. **Candidate-Specific Google Product Evidence Qualification**
   - File: `src/services/kh02/scoring/evergreenOpportunityScoring.ts`
   - Symbol: `isQualifiedGoogleAdsProductEvidence(obs, candidate)` (lines `470–649`)
   - Requires all of:
     - Source normalizes to `GOOGLE_ADS` (`GOOGLE`, `GOOGLE_ADS`, `GOOGLE_ADS_TRANSPARENCY`).
     - Strict boolean upstream attestation: `(obs.providerVerified === true || metrics.providerVerified === true)` and `(obs.upstreamRequestVerified === true || metrics.upstreamRequestVerified === true)` with no conflicting non-`true` value (rejecting `"true"`, `1`, `false`, `null`, `undefined`), `upstreamOriginStatus` not `UPSTREAM_NOT_ATTESTED`/`UNVERIFIED`, and `provenanceTier` not `LOCAL_MCP_TOOL_RESULT_VERIFIED`/`UNVERIFIED`/`NONE`.
     - Not cached, replay, or fixture (`isCached !== true`, `provenance` not `CACHED_SOURCE`/`TEST_FIXTURE`/`SYNTHETIC_DEMO`/`MOCK`/`UNKNOWN`, `sourceMode` not `CACHE`/`CACHED`/`CACHE_ONLY`/`FIXTURE`/`REPLAY`).
     - Verified US delivery (`verifiedDeliveryMarket === "US"`, `marketProvenance.verificationStatus` not `FILTER_ONLY`/`UNVERIFIED`/`INFERRED`).
     - Candidate-specific PDP binding (`landingPageUrl` has a product path `/products/`, `/dp/`, `/gp/product/`, `/p/`, `/item/` matching `candidate.storeDomain` and `candidate.canonicalProductUrl` path, and `productRelevance` / `associationVerdict` is not `BRAND_RELATED`/`UNRELATED`/`UNKNOWN`/`BRAND_ONLY_MATCH`/`REJECTED_UNRELATED_CREATIVE`).

3. **Pillar C Multi-Platform Scoring & Evidence Confidence**
   - File: `src/services/kh02/scoring/evergreenOpportunityScoring.ts`
   - Symbol: `calculateKH02EvergreenScore(ctx)` (lines `651–1011`)
   - Normalizes `supportingSourceTypes` and `sourceObservations` strictly to supported platforms (`META_ADS`, `TIKTOK_ORGANIC`, `GOOGLE_ADS`, `PINTEREST_ADS`, `AMAZON_BESTSELLERS`), ignoring unsupported arbitrary platform strings (`BOGUS_PLATFORM_XYZ`, `REDDIT_ADS`, etc.).
   - Removes `GOOGLE_ADS` from `sourceSet` unless `safeObservations.some((o) => isQualifiedGoogleAdsProductEvidence(o, c))` is `true`, preventing unverified Google observations or bare `supportingSourceTypes: ["GOOGLE_ADS"]` from adding `+6` Pillar C points, `+10` `evidenceConfidence`, `platformCount` increments, or cross-platform strength claims.

4. **Historical Snapshot Readback Re-Qualification**
   - File: `src/services/kh02/persistence/kh02PersistenceService.ts`
   - Symbol: `requalifyHistoricalEvergreenSnapshot(rawSnapshot)` (lines `90–255`)
   - Re-evaluates persisted `topThree` winners on readback and demotes any candidate lacking verified G15 demand stability (`score.pillars.demandStability.score === null` or `< 15`) or failing `verifyEvergreenCandidateIndependently`.
