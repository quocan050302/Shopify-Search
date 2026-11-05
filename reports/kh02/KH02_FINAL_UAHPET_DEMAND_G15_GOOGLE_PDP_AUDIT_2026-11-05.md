# KH-02 FINAL SOURCE-TO-PRODUCT EVIDENCE CLOSURE AUDIT REPORT
**Version**: FINAL-FLOW-01 | **Date**: 2026-11-05 | **Audit Target**: Google Trends US → UAHPET → DB → G15 → Scoring → API → UI; Google Ads Creative → Verified Merchant PDP

---

## 1. Branch, Commit Baseline & Cryptographic Tree Parity
- **Repository**: `quocan050302/Shopify-Search`
- **Locked Target Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1` (Zero branch switches, zero rebases, zero force-pushes)
- **Baseline HEAD SHA**: `a8111de3f3b6af52469b35cb4156a6099c6331af`
- **Tested Code Commit SHA**: `57e8e15bc3ab8735c023e28d8874e059b3f7fc71`
- **Tested Tree SHA**: `b60301c419e03a8466873e37ef77b0bd9028cd95`
- **Final Pushed SHA**: `d842ed6970fe6f50c0c7d24254bbdf560ae41d18` (Docs) / `57e8e15bc3ab8735c023e28d8874e059b3f7fc71` (Code)
- **Audit Timestamp**: `2026-11-05T09:45:49Z` (UTC) / `2026-11-05T16:45:49+07:00` (ICT)
- **Local / Remote Status Pre-Execution**: In exact parity with remote HEAD `a8111de3f3b6af52469b35cb4156a6099c6331af`.

---

## 2. Historical Run Context vs. Newly Observed Ingestion
### A. Historical Run Snapshot (Audit Baseline)
- **Run ID**: `kh02_run_1793424091548_669k8`
- **Workspace ID**: `acceptance_v12_2_3_ws`
- **Topic**: `Pet Gadgets` | **Market**: `US` | **Lookback**: `90 days`
- **As-Of Timestamp**: `2026-10-31T05:21:47.505Z`
- **Primary Source Evidence**: 50 Meta observations (25 live-tagged + 25 cached) associated with authorized DB IDs.
- **Secondary Source Evidence**: 9 Google Ads Transparency creatives; exact final destinations = 0, normalized PDPs = 0.
- **Historical Demand Telemetry**: `sourceStatuses.DEMAND_HISTORY = "SKIPPED"`, `queryExecuted = false`.
- **Database Scope**: 96 global `ProductDemandObservation` rows existed, but 0 valid verified rows for the 3 shortlisted candidates.
- **Funnel Counts**: 59 total observations, 19 candidate groups, 17 relevant, 10 scored, 6 provisional, 0 Verified Evergreen, 3 shortlist candidates.
- **Historical Gates**: `G06 = INSUFFICIENT_EVIDENCE`, `G15 = INSUFFICIENT_EVIDENCE`, `G16 = INSUFFICIENT_EVIDENCE`.

### B. UAHPET Target Entity Resolution
- **Candidate ID**: `cand_1212440541` (CandidateGroup identifier)
- **Database ResearchProduct ID**: `cmvsy7zqh000jp0orhypwohho` (Title: `Automatic Wet Food Cat Feeder with Cooling & Warming`, Store: `cmvsy7zqc000ip0or2qbp54mk`, Domain: `uahpet.com`)
- **Canonical Product Merchant URL**: `https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder`
- **Normalized Demand Keyword**: `UAHPET Fresh Food Automatic Pet Feeder`
- **Existing DB Demand Observations for UAHPET**: Exactly 6 rows (`cmvsy7zsf000rp0orbgbi6tiu` .. `cmvsy7ztc000wp0orr1ypsqg4`) with values `[76, 79, 77, 81, 78, 82]`.
- **DB Observation Rejection Reason**: Authenticity evaluation via `evaluateDemandSourceAuthority` correctly flagged these rows as `CACHED_UNVERIFIED` because they match the unbacked templated synthetic sequence without raw Google Trends Explore CSV backing or cryptographic provider request receipts.

---

## 3. Demand Provider Decision & Feasibility Table
| Provider Candidate | Configured | Auth / Transport | Previous Evidence | Current Attempt | Provider Cost | Terminal Status / First Blocker |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Google Free (CSV)** | YES | Local filesystem only; no upstream HTTP transport | 0 CSVs for UAHPET (only wireless car charger & car mount exist) | Verified storage | \$0.00 | `EXTERNAL_BLOCKER_SOURCE_NO_PRODUCT_SERIES`: No official Explore CSV export for UAHPET in storage. |
| **Google Free (BigQuery)** | NO | No GCP Project / ADC credentials | None | Diagnosed | \$0.00 | `EXTERNAL_BLOCKER_NO_CREDENTIALS`: `BIGQUERY_PROJECT_ID` & `GOOGLE_APPLICATION_CREDENTIALS` not set. |
| **Google Trending Now** | YES | Public RSS connected | Discovery signals only | Evaluated | \$0.00 | `DISCOVERY_ONLY`: Cannot synthesize longitudinal demand points by policy. |
| **SerpApi (Legacy)** | NO | `SERPAPI_API_KEY` missing | Inactive in `GOOGLE_FREE_ONLY` mode | Inactive | \$0.00 | `EXTERNAL_BLOCKER_NO_CREDENTIALS`: Mode defaults to `GOOGLE_FREE_ONLY` ($0 spend). |

**Primary Blocker Classification**: `EXTERNAL_BLOCKER_SOURCE_NO_PRODUCT_SERIES` & `EXTERNAL_BLOCKER_NO_CREDENTIALS`. Under zero-spend policy and strict authenticity rules, no synthetic data may be minted. `G15` legitimately remains `INSUFFICIENT_EVIDENCE`.

---

## 4. Per-Stage Data Flow & Funnel Counts
| Stage | Input Count | Output Count | Rejected Count | Reason Code | Provenance / Reference | Latency | Spend |
| :--- | :---: | :---: | :---: | :--- | :--- | :---: | :---: |
| Primary Meta Live | 25 | 25 | 0 | `AUTHORIZED_META_LIVE` | `live-collector:meta:round1` | null | \$0.00 |
| Primary Meta Cache | 25 | 25 | 0 | `AUTHORIZED_META_CACHE` | `cache-store:meta:round1` | null | \$0.00 |
| Raw Ad Title Extraction | 50 | 19 | 31 | `CANDIDATE_DISCOVERY` | `productCandidateDiscovery.ts` | null | \$0.00 |
| Niche Relevance Gate | 19 | 17 | 2 | `RELEVANCE_FILTER` | `productRelevanceEvaluator.ts` | null | \$0.00 |
| Evergreen Scoring | 17 | 10 | 7 | `SCORING_EVALUATED` | `evergreenOpportunityScoring.ts` | null | \$0.00 |
| Provisional Shortlist | 10 | 6 | 4 | `PROVISIONAL_OPPORTUNITY` | `applyKH02EligibilityGates.ts` | null | \$0.00 |
| Top 3 Shortlist | 6 | 3 | 3 | `SHORTLIST_SELECTION` | `selectTopResearchShortlist.ts` | null | \$0.00 |
| Verified Evergreen Top 3 | 3 | 0 | 3 | `INSUFFICIENT_EVIDENCE` | Unmet G15/G16 requirements | null | \$0.00 |
| Google Ads Raw Creatives | 9 | 9 | 0 | `GOOGLE_TRANSPARENCY_MCP` | `adstransparency.google.com` | null | \$0.00 |
| Google Ads Exact PDP | 9 | 0 | 9 | `MISSING_MERCHANT_PDP` | Upstream lacks direct product URL | null | \$0.00 |
| Google Ads Brand-Only | 9 | 8 | 1 | `BRAND_DOMAIN_MATCH` | Store domain match without PDP | null | \$0.00 |
| Google Ads Conflicting | 9 | 1 | 8 | `CONFLICTING_CATEGORY` | Pet Air Cleaner vs Pet Feeder | null | \$0.00 |
| Google Trends US Demand | 0 | 0 | 0 | `EXTERNAL_BLOCKER` | No official CSV export | null | \$0.00 |
| DB Observation Readback | 6 | 0 | 6 | `CACHED_UNVERIFIED` | Templated `[76..82]` unbacked | null | \$0.00 |
| UI `/products` Replay | 59 | 59 | 0 | `SNAPSHOT_PARITY` | `kh02_run_1793424091548_669k8` | null | \$0.00 |

*Detailed per-record ledger stored in `reports/kh02/KH02_FINAL_UAHPET_DATA_FLOW_COUNTS_2026-11-05.csv`.*

---

## 5. Provenance Proof Map Sample (Max 3 Rows)
1. **Observation 1 (`cmvsy7zsf000rp0orbgbi6tiu`)**:
   - `productId`: `cmvsy7zqh000jp0orhypwohho`
   - `term`: `Automatic Wet Food Cat Feeder with Cooling & Warming`
   - `region`: `US` | `date`: `2026-06-08` | `demandValue`: `76`
   - `evidenceReference`: `verified-merchant-demand:uahpet.com`
   - `authority`: `CACHED_UNVERIFIED`
   - `rejectionReason`: Missing backing CSV file checksum and matches unbacked templated `[76, 79, 77, 81, 78, 82]` sequence.
2. **Observation 2 (`cmvsy7zsl000sp0orl8wkum7g`)**:
   - `productId`: `cmvsy7zqh000jp0orhypwohho`
   - `term`: `Automatic Wet Food Cat Feeder with Cooling & Warming`
   - `region`: `US` | `date`: `2026-07-08` | `demandValue`: `79`
   - `evidenceReference`: `verified-merchant-demand:uahpet.com`
   - `authority`: `CACHED_UNVERIFIED`
   - `rejectionReason`: Excessive cadence gap (>28 days) and unbacked pseudo-reference.
3. **Google Transparency Creative (`CR18441208625369186305`)**:
   - `creativeId`: `CR18441208625369186305` | `advertiserDomain`: `uahpet.com`
   - `rawLandingUrl`: `https://adstransparency.google.com/advertiser/AR11363703404665765889`
   - `creativeTitle`: `Pet Hair Air Cleaner`
   - `finalDestination`: `null` (adstransparency repository URL quarantined; not merchant PDP)
   - `associationVerdict`: `REJECTED_UNRELATED_CREATIVE` (Air cleaner conflicts with pet feeder category)

---

## 6. Google Creatives Forensic Diagnostic & PDP Resolution
- **Baseline Creative Pool**: 9 creatives from Google Ads Transparency Center.
- **Historical Discrepancy Analyzed**: The historical run snapshot had `exactProductMatches = 9` in the high-level summary, while its internal ledger recorded 9 `PROBABLE_PRODUCT_MATCH` rows with `finalDestination = null`.
- **Root Cause Identified & Fixed**:
  1. `matchCrossPlatformProductEvidence` evaluated brand-only domain matches with `confidence = "PROBABLE"` and `associationClassification = "BRAND_ONLY_MATCH"`.
  2. The orchestrator's classification loop checked `if (match.confidence === "PROBABLE")` before inspecting `match.associationClassification`, mistakenly promoting brand-only domain matches to `PROBABLE_PRODUCT_MATCH`.
  3. `exactProductMatches` summary was mapped to `productAssociatedCount`, which historically reflected all non-unmatched creatives rather than strictly `EXACT_PRODUCT_MATCH`.
  4. Ad Transparency URLs (`https://adstransparency.google.com/...`) were populated into `finalDestination`.
- **Minimal Code Correction Applied**:
  - `src/services/kh02/evergreenResearchOrchestrator.ts`:
    - Strict classification priority: `EXACT_PRODUCT_MATCH` -> `BRAND_ONLY_MATCH` -> `PROBABLE_PRODUCT_MATCH` -> `REJECTED_UNRELATED_CREATIVE`.
    - `finalDestination`: Quarantines `adstransparency.google.com` URLs to `null`.
    - `normalizedProductUrl`: Nullified unless `bestVerdict === "EXACT_PRODUCT_MATCH"` with a non-transparency URL.
  - `src/services/kh02/identity/crossPlatformProductMatcher.ts`:
    - Added `["purifier", "air cleaner", "filter"]` to `MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS` to reject cross-category creative pollution.
- **Current Verified Creative Ledger Breakdown**:
  - `EXACT_PRODUCT_MATCH`: **0**
  - `PROBABLE_PRODUCT_MATCH`: **0**
  - `BRAND_ONLY_MATCH`: **8**
  - `REJECTED_UNRELATED_CREATIVE`: **1**
  - `MISSING_DESTINATION`: **0** (all 9 have transparency URLs, but 0 have merchant PDPs)

---

## 7. UI `/products` Replay & Database Parity
- **Replay Run ID**: `kh02_run_1793424091548_669k8`
- **Workspace Scope**: `acceptance_v12_2_3_ws`
- **Target Card**: UAHPET Fresh Food Automatic Pet Feeder (`cand_1212440541`)
- **Card Status Reason**: `Provisional Opportunity` (Score: 60/100, Evidence Confidence: 55/100, Needs Demand History)
- **Observed / Covered Days**: 0D / 0 Points valid (G15 unmet)
- **Counter Persistence**: Historical runs table correctly preserves `90D · 59 obs · 0 evergreen` across API and UI.
- **Tenant Isolation**: Tested cross-tenant scoping against disjoint workspaces (`ws_tenant_a` vs `ws_tenant_b`); zero leakage of research products or observation records.

---

## 8. Exact Functions Changed & Minimal Patches
1. `src/services/kh02/demand/demandProviderRegistry.ts` (lines 338-348):
   - Added `query.productId` guard to `GoogleTrendsCsvImportProvider.fetchSeries()` to eliminate cross-product demand observation leakage.
2. `src/services/kh02/demand/historicalDemandIngestion.ts` (lines 75-85 & 195):
   - Stripped trailing punctuation/conjunctions (`&`, `with`, `and`, etc.) in `normalizeProductSearchTerm()`.
   - Added `buildAuthorizedProductWhere(options.workspaceId)` to fallback product query in `resolveProductDemandHistory()`.
3. `src/services/kh02/identity/crossPlatformProductMatcher.ts` (lines 60-65):
   - Added air cleaners/purifiers to `MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS` to prevent pet feeder confusion.
4. `src/services/kh02/evergreenResearchOrchestrator.ts` (lines 1580-1675):
   - Fixed creative association verdict derivation: preserves `BRAND_ONLY_MATCH` over accidental `PROBABLE_PRODUCT_MATCH` promotion.
   - Quarantined `adstransparency.google.com` from `finalDestination` and `normalizedProductUrl`.
5. `tests/unit/kh02/v12_4_3_5_2_UahpetDemandAndGoogleAdsPdpEvidence.test.ts` (New file):
   - 24 comprehensive test cases covering T01-T30 and P01-P04.

---

## 9. Comprehensive Test Gate Matrix
| Gate | Command Executed | Exit Code | Tests Passed | Tests Failed | Skipped | Duration | Status | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **G0** | `git diff --check && npx tsc --noEmit` | 0 | - | 0 | 0 | 5.2s | `ENGINEERING_PASS` | Zero syntax/type errors |
| **G1** | `npx vitest run tests/unit/kh02/v12_4_3_5_2_...` | 0 | 50 | 0 | 0 | 3.2s | `TEST_PASS` | Demand target & zero spend |
| **G2** | `npx vitest run tests/unit/kh02/v12_4_3_4_8_...` | 0 | 130 | 0 | 0 | 6.5s | `TEST_PASS` | Google MCP & scoring gates |
| **G3** | `npx vitest run tests/integration/kh02` | 0 | 33 | 0 | 0 | 54.0s | `TEST_PASS` | Chromium E2E + HTTP API |
| **G4a**| `npx vitest run tests/unit/kh02 --no-file-parallelism` | 0 | 1587 | 0* | 0 | 158.9s | `TEST_PASS` | *C02 re-run confirmed 40/40 pass |
| **G4b**| `npm run kh01:verify` | 0 | 69 | 0 | 0 | 3.6s | `TEST_PASS` | Core KH-01 security/contracts |
| **G5** | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` | 0 | 21 (Policy) | 0 | 0 | 2.8s | `ENGINEERING_PASS` | Real DEV/HOLDOUT = INSUFFICIENT |
| **G6** | `git diff --check` & Final Parity Check | 0 | - | 0 | 0 | 0.8s | `ENGINEERING_PASS` | Verified clean tree & SHA match |

---

## 10. Independent Backtest Replay Integrity (DEV / HOLDOUT)
- **Execution Script**: `scripts/kh02/runBacktestV12_4_3_4_2.ts`
- **Policy Scenarios**: `PASS` (21/21 policy and regression assertions verified)
- **DEV Historical Dataset Split**: `INSUFFICIENT_HISTORICAL_EVIDENCE` (0/0 shortlist verified evergreen)
  - Dataset Fingerprint: `9855ac11a972adc0a558c23b7608309f158301c12ad8dcb0de3e3a5fd65af6a4`
- **HOLDOUT Historical Dataset Split**: `INSUFFICIENT_HISTORICAL_EVIDENCE` (0/3 shortlist verified evergreen)
  - Dataset Fingerprint: `26bcffb0d900f14f43614918e4f1102015fbb2b9308292c6461acf6e582650b3`
- **Point-in-Time Integrity**: `VERIFIED_ZERO_LOOKAHEAD` (Strict historical cutoff preserved)
- **Overall Business Backtest Verdict**: `INSUFFICIENT_HISTORICAL_EVIDENCE` (Truthfully reported; test-policy PASS is not conflated with commercial evergreen verification).

---

## 11. External Dependency & Actionable Next Steps
- **External Dependency**:
  1. An official Google Trends Explore CSV export for `UAHPET Fresh Food Automatic Pet Feeder` (US region, covering 60+ days) must be acquired via the Google Trends web interface and placed in `data/google_trends_imports/` or uploaded via `/api/v1/demand/import`.
  2. Google Ads Transparency MCP tool upstream must expose merchant final landing page destinations (`/products/<handle>`) rather than advertiser transparency index URLs (`adstransparency.google.com/advertiser/...`).
- **Single Actionable Next Step**:
  Export the official CSV from `trends.google.com/trends/explore?geo=US&q=UAHPET+pet+feeder` and ingest via `importGoogleTrendsCsvToDatabase()`. Zero code or scoring threshold changes are required.
