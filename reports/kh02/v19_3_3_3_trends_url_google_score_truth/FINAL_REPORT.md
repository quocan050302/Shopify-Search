# KH-02 V12.4.3.7.19.3.3.3 — Final Audit & Verification Report

## 1. Executive Summary

| Dimension | Verdict / Value |
|---|---|
| Repository | `quocan050302/Shopify-Search` |
| Locked Branch | `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` |
| Baseline Commit (`C0`) | `af1f6d0dcdbecc18ebbd3736f07c365b830f5b39` (`tree`: `d9a0ca40cd719fa4c1dcd2491f29d9dd4eb72ee5`) |
| Tested Code Commit (`C1`) | `4ac0df13cb190aac01ce6094caa299f0da1defe0` (`tree`: `dfade8bcbc28da97aae4cfe5becc41d3d2063da8`) |
| `ENGINEERING_CORRECTNESS` | `PASS` |
| `CI_VERDICT` | `CI_PASS` (GitHub Actions Run `42474097591` — `6/6` required jobs `success` on `C1`) |
| `G15_OFFICIAL_60_DAY_DEMAND` | `INSUFFICIENT_EVIDENCE` (`0` business-eligible >=60-day US exports in live store; `providerOriginVerified = false`) |
| `G16_DISTINCT_TOP3_ELIGIBILITY` | `INSUFFICIENT_EVIDENCE` (`0/3` Verified Evergreen winners in live business scope) |
| `BACKTEST_DEV_HOLDOUT` | `PASS` (policy & point-in-time zero-leakage) / `INSUFFICIENT_HISTORICAL_EVIDENCE` (live historical corpus) |
| `PRODUCTION_RELEASE_VERDICT` | `RELEASE_HOLD` |
| Paid External API Spend | `$0.00` |

---

## 2. Production Defects Closed in `C1` (`4ac0df13cb190aac01ce6094caa299f0da1defe0`)

### 2.1 P1-A (G15): Mandatory `q` and `geo` Binding on Official Google Trends Explore URLs
- **File**: `src/services/kh02/demand/durableCsvImportAuthority.ts` (`validateOfficialGoogleTrendsAcquisitionUrl`, lines `259–357`)
- **Defect on `C0`**:
  - `geo` and `q` query parameters were checked only when present (`if (parsedUrl.searchParams.has("geo"))` and `if (parsedUrl.searchParams.has("q") && ...)`), allowing bare `https://trends.google.com/trends/explore`, missing `geo`, or missing `q` URLs to pass validation.
  - `q` comparison used bidirectional substring matching (`!urlQ.includes(expQ) && !expQ.includes(urlQ)`), accepting partial prefix (`q=cat`) or superstring (`q=cat feeder accessories`) queries for `expectedQuery="cat feeder"`.
  - Duplicate query parameters (`?geo=US&geo=GB` or `?q=cat%20feeder&q=dog%20toy`) were not rejected because `.get()` inspected only the first value.
- **Fix on `C1`**:
  - Enforces exact origin `https://trends.google.com`, `https:` scheme, empty userinfo/port, and `/^\/trends\/explore(?:\/|$)/i` path.
  - Requires **exactly one** non-empty `geo` search parameter (`parsedUrl.searchParams.getAll("geo").length === 1`), rejecting missing (`ACQUISITION_GEO_REQUIRED`), blank/whitespace, duplicate (`AMBIGUOUS_ACQUISITION_PARAMETERS`), double-encoded/comma-separated, and non-US or subregion (`US-CA`) values (`ACQUISITION_GEO_MISMATCH`).
  - Requires **exactly one** non-empty `q` search parameter (`parsedUrl.searchParams.getAll("q").length === 1`), rejecting missing (`ACQUISITION_QUERY_REQUIRED`), blank/whitespace, duplicate (`AMBIGUOUS_ACQUISITION_PARAMETERS`), double-encoded (`%2520`) or multi-term comma-separated (`q=term1,term2`) queries, and requiring **exact normalized whole-term equality** (`urlQ === expQ`) against the authority record's query (`ACQUISITION_QUERY_MISMATCH`).
  - Re-validates `validateOfficialGoogleTrendsAcquisitionUrl` on readback in `verifyDurableCsvImportAuthority` and preserves `providerOriginVerified: false`.

### 2.2 P1-B (G16): No Unverified Google Ads Multi-Platform Score (`+6` Pillar C / `+10` Confidence)
- **Files**:
  - `src/services/kh02/scoring/evergreenOpportunityScoring.ts` (`isQualifiedGoogleAdsProductEvidence` lines `470–649`, `calculateKH02EvergreenScore` lines `651–1011`, and null-safe observation filtering in `verifyEvergreenCandidateIndependently` lines `306–309`)
  - `src/services/kh02/persistence/kh02PersistenceService.ts` (`requalifyHistoricalEvergreenSnapshot` lines `140–170`)
- **Defect on `C0`**:
  - `calculateKH02EvergreenScore` populated `sourceSet` directly from `candidate.supportingSourceTypes` and raw `sourceObservations[].source`, awarding `+6` Pillar C points, `+10` `evidenceConfidence`, `platformCount` increments, and cross-platform strength text whenever `"GOOGLE_ADS"` appeared—even when `sourceObservations` was empty or contained only unattested local MCP tool results (`providerVerified: false`, `upstreamRequestVerified: false`, `provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED"`), non-PDP brand homepages, `FILTER_ONLY` US market provenance, or wrong-merchant PDPs.
  - Arbitrary unsupported strings in `supportingSourceTypes` (`"BOGUS_PLATFORM_XYZ"`) remained in `sourceSet` and inflated `platformCount`.
- **Fix on `C1`**:
  - Added and exported `isQualifiedGoogleAdsProductEvidence(obs, candidate)` requiring:
    1. Source normalizes to `GOOGLE_ADS` (`GOOGLE`, `GOOGLE_ADS`, `GOOGLE_ADS_TRANSPARENCY`).
    2. Strict boolean upstream attestation (`providerVerified === true` and `upstreamRequestVerified === true` with no conflicting non-`true` value; string `"true"` and numeric `1` are rejected), `upstreamOriginStatus` not `UPSTREAM_NOT_ATTESTED`/`UNVERIFIED`, and `provenanceTier` not `LOCAL_MCP_TOOL_RESULT_VERIFIED`/`UNVERIFIED`/`NONE`.
    3. Not cached, replay, or fixture (`isCached !== true`, `provenance` not `CACHED_SOURCE`/`TEST_FIXTURE`/`SYNTHETIC_DEMO`/`MOCK`/`UNKNOWN`, `sourceMode` not `CACHE`/`CACHED`/`CACHE_ONLY`/`FIXTURE`/`REPLAY`).
    4. Verified US delivery market (`verifiedDeliveryMarket === "US"`, `marketProvenance.verificationStatus` not `FILTER_ONLY`/`UNVERIFIED`/`INFERRED`).
    5. Candidate-specific PDP product binding (`landingPageUrl` has a product path `/products/`, `/dp/`, `/gp/product/`, `/p/`, `/item/` matching `candidate.storeDomain` and `candidate.canonicalProductUrl` path, and `productRelevance` / `associationVerdict` is not `BRAND_RELATED`/`UNRELATED`/`UNKNOWN`/`BRAND_ONLY_MATCH`/`REJECTED_UNRELATED_CREATIVE`).
  - Removes `GOOGLE_ADS` from `sourceSet` unless at least one `sourceObservations` entry passes `isQualifiedGoogleAdsProductEvidence(obs, candidate)`.
  - Filters `supportingSourceTypes` and `sourceObservations` to supported platforms only (`META_ADS`, `TIKTOK_ORGANIC`, `GOOGLE_ADS`, `PINTEREST_ADS`, `AMAZON_BESTSELLERS`).
  - Updates `requalifyHistoricalEvergreenSnapshot` to demote any persisted `topThree` winner with `score.pillars.demandStability.score === null`.

---

## 3. Adversarial RED -> GREEN Proof (`C0` vs `C1`)

- **Test File**: `tests/unit/kh02/v19_3_3_3_OfficialTrendsQueryGeoAndGoogleScoreTruth.test.ts` (`48` deterministic test cases: `CSV-01..CSV-24` and `GSC-01..GSC-24`)
- **Pre-Fix on `C0` (`af1f6d0dcdbecc18ebbd3736f07c365b830f5b39`)**:
  - `29 failed (RED) | 19 passed (48 total)` (`13` CSV cases RED + `16` GSC cases RED)
  - Raw evidence: `logs/PRE_FIX_RED_C0.json`, `logs/PRE_FIX_RED_C0.log`
- **Post-Fix on `C1` (`4ac0df13cb190aac01ce6094caa299f0da1defe0`)**:
  - `48 passed (GREEN) | 0 failed (48 total)` (`24/24` CSV cases GREEN + `24/24` GSC cases GREEN)
  - Raw evidence: `logs/POST_FIX_GREEN_C1.json`, `logs/POST_FIX_GREEN_C1.log`

---

## 4. Full Regression & CI Verification on `C1` (`4ac0df13cb190aac01ce6094caa299f0da1defe0`)

| Check / Suite | Command | Result |
|---|---|---|
| TypeScript (`tsc --noEmit`) | `npx tsc --noEmit` | `PASS` (exit `0`) |
| Prisma Schema (`prisma validate`) | `npx prisma validate` | `PASS` (exit `0`) |
| ESLint (changed files) | `npx eslint ... --quiet` | `PASS` (exit `0`) |
| V19.3.3.3 Targeted Suite | `npx vitest run tests/unit/kh02/v19_3_3_3_OfficialTrendsQueryGeoAndGoogleScoreTruth.test.ts` | `48 / 48 passed` |
| V19.3.3.2 Security Suite | `npx vitest run tests/unit/kh02/v19_3_3_2_CsvOriginAndGoogleUpstreamTrust.test.ts` | `42 / 42 passed` |
| V19.3.3.1 Security Suite | `npx vitest run tests/unit/kh02/v19_3_3_1_CsvTrustAndGoogleMetaProvenance.test.ts` | `28 / 28 passed` |
| G15 CSV Origin Integrity | `npx vitest run tests/unit/kh02/g15CsvOriginIntegrity.test.ts` | `15 / 15 passed` |
| Meta/Google Flow Closure | `npx vitest run tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` | `21 / 21 passed` |
| Full KH-02 Unit Suite | `npm run kh02:test:unit -- --maxWorkers=2` | `2,614 / 2,614 passed` (`451` files) |
| KH-01 Regression | `npm run kh01:verify` | `69 / 69 passed` (`5` files) |
| Full KH-02 Integration Suite | `npx vitest run tests/integration/kh02 --no-file-parallelism` | `77 / 77 passed` (`35` files) |
| SQLite DB Readback | `npx tsx scripts/kh02/runCandidateDbReadback.ts` | `SUCCESS` (`G15=INSUFFICIENT_EVIDENCE`, `G16=INSUFFICIENT_EVIDENCE`) |
| DEV/HOLDOUT Backtest | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` | `Policy=PASS`, `ZeroFutureLeakage=true`, `Overall=INSUFFICIENT_HISTORICAL_EVIDENCE` |
| 3-Source Free MCP Smoke | `VITEST=1 npx tsx scripts/kh02/runThreeSourceFreeMcpSmoke.ts` | `PASS` (`$0.00`, `providerVerified=false`) |
| Production Build | `npm run build` | `PASS` (exit `0`) |
| GitHub Actions CI (`42474097591`) | Push `C1` (`4ac0df13cb190aac01ce6094caa299f0da1defe0`) | `6 / 6 jobs success` (`typecheck`, `security-negative`, `kh02-unit`, `kh01-regression`, `kh02-integration`, `backtest-policy`) |
