# KH-02 FINAL EVIDENCE-FLOW CLOSURE AUDIT REPORT
**Directive Version:** FINAL-FLOW-02  
**Date:** 2026-11-05  
**Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`  
**Repository:** `quocan050302/Shopify-Search`  
**Baseline HEAD SHA:** `3e78541760e7e1c782f33587a4129a155e482b8d`  
**Tested Code SHA:** `51e7165466d114f36448f87e26453fa9bd4541d5`  
**Tested Code Tree SHA:** `235509415c6a93547318ee2296b170d45a42e8b2`  
**Remote GitHub Parity at Report Creation:** `51e7165466d114f36448f87e26453fa9bd4541d5`  

---

## 1. Executive Summary & Verdict Segregation

This audit report records the forensic closure and automated verification of Directive **FINAL-FLOW-02**, addressing two specific defect vectors identified in prior audits without regressions, without lowering scoring thresholds, and with \$0 network spend.

### Verdicts
- **ENGINEERING ACCEPTANCE:** **`PASS`**  
  All 33 new focused tests (A01–A16, B01–B12, C01–C05) pass. All 69 KH-02 unit suites (1,621 tests), 9 integration suites (33 tests including Chromium E2E), 5 KH-01 verification suites (69 tests), and DEV/HOLDOUT backtests pass with zero type errors.
- **BUSINESS G15 DEMAND VERIFICATION:** **`INSUFFICIENT_EVIDENCE`**  
  No authentic, official Google Trends US Explore CSV exists on disk for UAHPET. Existing database rows (`[76, 79, 77, 81, 78, 82]`) remain correctly diagnosed as `CACHED_UNVERIFIED`.
- **BUSINESS G16 TOP 3 EVERGREEN QUALIFICATION:** **`INSUFFICIENT_EVIDENCE`**  
  Zero (0) verified Evergreen products. G16 correctly requires G15 longitudinal proof and cannot be unlocked by test fixtures.
- **DEV BACKTEST:** **`INSUFFICIENT_HISTORICAL_EVIDENCE`** (Shortlist: 0/0, Policy: PASS)
- **HOLDOUT BACKTEST:** **`INSUFFICIENT_HISTORICAL_EVIDENCE`** (Shortlist: 3/3, Policy: PASS)
- **PUSH STATUS:** **`VERIFIED`** (Code commit `51e7165` successfully pushed to remote).

---

## 2. Forensic Investigation & Code-Path Repairs

### Defect A: Google Trends CSV Provenance and Lineage Loss
1. **Diagnosis & Reproduction:**
   - In `GoogleTrendsCsvImportProvider.fetchSeries(query)`, records read from the database previously returned a hardcoded display string `source: "Google Trends Explore CSV Export"`, which was unrecognized by `evaluateDemandSourceAuthority` (which tests `/google_trends_csv|historical_ingestion/i`), causing the source to be treated as `"OTHER"` and downgraded to `CACHED_UNVERIFIED`.
   - Furthermore, `evidenceReference`, `productId`, `keyword`, and `methodologyVersion` were lost during point conversion. Downstream consumer `resolveProductDemandHistory` received points with `evidenceReference: null`, causing `hasDbProductWithoutRef` to flag the series as unverified.
   - The query previously used `keyword: { contains: query.term.trim() }`, which missed legitimate raw exports where the product-associated keyword was shorter than the candidate display name.
   - In `resolveProductDemandHistory`, if a candidate had an existing `productId` with zero records, step 2 silently fell back to searching unrelated products by title substring.
2. **Minimal Precise Repairs Implemented:**
   - **`src/services/kh02/demand/demandProviderRegistry.ts`**:
     - Extended `DemandDataPointResult` with optional fields: `productId`, `keyword`, `evidenceReference`, `methodologyVersion`, `observedAt`, `capturedAt`, `sourceCadence`, `rawResponseSha256`.
     - Extended `DemandSeriesResult.provenance` union with `"VERIFIED_HISTORICAL_SOURCE"` and added `sourceTransportType?: "LOCAL_VERIFIED_CSV" | ...`.
     - Updated `GoogleTrendsCsvImportProvider.fetchSeries`:
       - If `query.productId` is present, queries by exact `productId` and region.
       - Validates each row for physical CSV file presence, SHA-256 match, broad category rejection (`isBroadCategoryDemandTerm`), promotional ad copy rejection (`isPromotionalAdCopyDemandKeyword`), and product family alignment.
       - Preserves canonical source string `"GOOGLE_TRENDS_CSV"`, `evidenceReference`, and sets `provenance: "VERIFIED_HISTORICAL_SOURCE"`, `sourceTransportType: "LOCAL_VERIFIED_CSV"`.
   - **`src/services/kh02/demand/historicalDemandIngestion.ts`**:
     - Constrained step 2 fallback: only unbound candidates without an explicit `candidate.productId` may fall back to title substring search (`if (rawRecords.length === 0 && !candidate.productId && searchTerm.length > 2)`).
     - In live provider resolution, preserves `source: pointSource` (`"GOOGLE_TRENDS_CSV"`), original `keyword`, and `evidenceReference`.
   - **`src/services/kh02/demand/googleTrendsCsvValidator.ts`**:
     - Relaxed `effectiveExpectedKeyword` matching in `validateAndParseGoogleTrendsCsv` to permit legitimate shorter product aliases whose tokens match the expected product name.
   - **`src/app/api/v1/demand/import/route.ts`**:
     - Added workspace scoping via `resolveAuthorizedResearchContext(request)` and `buildAuthorizedProductWhere(workspaceId)`. Returns 403 `FORBIDDEN_WORKSPACE_PRODUCT` on cross-tenant attempts.
     - Added conflict detection for duplicate timestamps: conflicting values return 409 `CONFLICTING_DUPLICATE_OBSERVATION`; matching values increment `skippedCount`.

### Defect B: Google Ads Exact-Product Classification and PDP Proof
1. **Diagnosis & Reproduction:**
   - In `crossPlatformProductMatcher.ts::matchCrossPlatformProductEvidence()`, high title/brand similarity without handle match returns `confidence: "HIGH_CONFIDENCE"` but `associationClassification: "PROBABLE_PRODUCT_MATCH"`.
   - In `evergreenResearchOrchestrator.ts::runEvergreenProductResearch()`, the loop previously checked `if (match.confidence === "EXACT" || match.confidence === "HIGH_CONFIDENCE") bestVerdict = "EXACT_PRODUCT_MATCH"`, promoting `PROBABLE_PRODUCT_MATCH` to `EXACT_PRODUCT_MATCH`.
   - Furthermore, destination checks only looked at `!obs.landingPageUrl.includes("adstransparency.google.com")`, failing to verify whether the landing page was a confirmed merchant PDP.
2. **Minimal Precise Repairs Implemented:**
   - **`src/services/kh02/identity/crossPlatformProductMatcher.ts`**:
     - Added pure helper `classifyVerifiedGoogleMerchantDestination(rawUrl, candidate)`:
       - Enforces HTTPS scheme.
       - Rejects `adstransparency.google.com` (and variants/subdomains/paths).
       - Rejects generic Google domains (`google.com`, `googleadservices.com`, `doubleclick.net`).
       - Rejects link shorteners (`bit.ly`, `tinyurl.com`, `t.co`, etc.) and redirect URL query parameters (`?dest=`, `?url=`, `?adurl=`).
       - Enforces candidate store domain match (`extractRegistrableDomain`).
       - Rejects homepages, `/collections/`, `/blogs/`, `/pages/`, `/cart`, etc.
       - Validates canonical `/products/<handle>` against candidate canonical product handle.
   - **`src/services/kh02/evergreenResearchOrchestrator.ts`**:
     - `EXACT_PRODUCT_MATCH` requires BOTH `match.associationClassification === "EXACT_PRODUCT_MATCH"` AND `destCheck.isVerifiedPdp === true`.
     - If matcher produces `EXACT` or `HIGH_CONFIDENCE` but destination lacks verified merchant PDP, it is downgraded to `PROBABLE_PRODUCT_MATCH` with explicit reason.
     - Enforced counter invariants: `exactProductMatches == count(associationVerdict === "EXACT_PRODUCT_MATCH" && verifiedMerchantPdp === true)`.
     - The 9 historical Google creatives have 0 verified merchant PDPs (all 9 are Transparency URLs); ledger strictly maintains **0 exact matches, 8 brand-only matches, 1 rejected unrelated creative**.

---

## 3. Historical Run vs. Test Fixture Isolation

| Attribute | Historical Run (`kh02_run_1793424091548_669k8`) | Test Fixtures (`prod_flow02_uahpet`) |
| :--- | :--- | :--- |
| **Workspace** | `acceptance_v12_2_3_ws` | Dedicated isolated fixture workspace |
| **Execution Date** | 2026-10-31 (Immutable Baseline) | 2026-11-05 (Automated Test Execution) |
| **Meta Ads Primary** | 50 (25 live, 25 cache) | Spied / isolated in-memory |
| **Google Creatives** | 9 (8 brand-only, 1 rejected, 0 PDP) | 0 exact on historical; 1 positive in fixture test |
| **Google Trends US** | 6 unbacked rows (`[76, 79, 77, 81, 78, 82]`) | 13 weekly points spanning 84 days |
| **Authority** | `CACHED_UNVERIFIED` | `HISTORICAL_SOURCE_VERIFIED` (TEST_ONLY) |
| **G15 Business Gate** | **`INSUFFICIENT_EVIDENCE`** | **`INSUFFICIENT_EVIDENCE`** (Not promoted to business) |
| **G16 Top 3 Gate** | **`INSUFFICIENT_EVIDENCE`** | **`INSUFFICIENT_EVIDENCE`** |

---

## 4. Test Matrix & Gate Results

### Focused Test Matrix (33 Tests in `v12_4_3_5_3`)
- **CSV / Demand Provenance (A01 - A16):**
  - `A01`: Proper official-shaped local CSV fixture: parse and raw hash persisted (`PASS`)
  - `A02`: Exact target productId/region/keyword/period/value/source/reference survives CSV adapter (`PASS`)
  - `A03`: GoogleFreeDemandProvider returns historically sourced points without fake live claim (`PASS`)
  - `A04`: resolveProductDemandHistory database readback remains authoritative for verified CSV (`PASS`)
  - `A05`: >=3 points and >=60 days with credible cadence supports G15 in isolated fixture (`PASS`)
  - `A06`: G15 fixture success does not automatically make verified G16/Top3 (`PASS`)
  - `A07`: Two points and <60-day coverage rejected (`PASS`)
  - `A08`: Missing raw CSV, SHA mismatch, post-as-of receipt, future dates rejected (`PASS`)
  - `A09`: Other product ID with same keyword never leaks to UAHPET (`PASS`)
  - `A10`: Workspace A vs B isolation both read and import/write (`PASS`)
  - `A11`: Product with existing ID must not silently fallback to another product (`PASS`)
  - `A12`: Verified alias same product succeeds, broad category/unrelated SKU fails (`PASS`)
  - `A13`: Idempotent two imports, immutable checksum/date/value; conflicting duplicate fails (`PASS`)
  - `A14`: Prior [76,79,77,81,78,82] pseudo-reference remains insufficient (`PASS`)
  - `A15`: Actual import API invalid data returns non-2xx and no DB changes (`PASS`)
  - `A16`: Importer/provider/consumer source-status does not claim live HTTP for stored CSV (`PASS`)
- **Google Ads Exact-Product Classification and PDP Proof (B01 - B12):**
  - `B01`: HIGH_CONFIDENCE + PROBABLE classification NEVER increments exact (`PASS`)
  - `B02`: Exact handle + verified merchant PDP increments exact exactly once (`PASS`)
  - `B03`: Transparency advertiser URL and creative source URL can NEVER be final PDP (`PASS`)
  - `B04`: Same-domain homepage/blog/collection cannot be final PDP (`PASS`)
  - `B05`: Encoded redirect URL, malformed URL, HTTP URL, spoofed transparency hostname cannot bypass (`PASS`)
  - `B06`: Same merchant two distinct /products/handles cannot be exact (`PASS`)
  - `B07`: Cross-store title similarities cannot merge candidate identity (`PASS`)
  - `B08`: Feeder vs pet air purifier conflicting category rejected with evidence (`PASS`)
  - `B09`: Nine historical creative ledger counts preserved (0 exact) in read-only replay (`PASS`)
  - `B10`: Primary classifications mutually exclusive and total equals distinct creative count (`PASS`)
  - `B11`: No verified PDP present => clear blocker despite creative status PASSED (`PASS`)
  - `B12`: UI/API matching statuses agree with ledger and source telemetry (`PASS`)
- **UI / API Acceptance & Baseline Integrity (C01 - C05):**
  - `C01`: One real fixture import->DB->provider->G15->snapshot->GET->/products journey (`PASS`)
  - `C02`: Historical 2026-10-31 run GET replays 59 observations, 0 Verified Evergreen (`PASS`)
  - `C03`: Cross-tenant lookup doesn't expose private research or fixture records (`PASS`)
  - `C04`: Old snapshots/new schema backward compatible: no manufactured verified history count (`PASS`)
  - `C05`: Negative control: UI says PROVISIONAL when verified demand nonexistent (`PASS`)

### Verification Gates Summary
| Gate | Suite Description | Tests | Exit Code | Result |
| :--- | :--- | :--- | :--- | :--- |
| **G0** | Type check (`tsc --noEmit`) & `git diff --check` | 0 | 0 | **`PASS`** |
| **G1a**| Targeted Flow 02 Suite (`v12_4_3_5_3`) | 33 / 33 | 0 | **`PASS`** |
| **G1b**| Targeted Flow 01 Suite (`v12_4_3_5_2`) | 24 / 24 | 0 | **`PASS`** |
| **G2** | Full KH-01 Security & Acceptance (`kh01:verify`) | 69 / 69 | 0 | **`PASS`** |
| **G3** | KH-02 Integration & Chromium Browser E2E | 33 / 33 | 0 | **`PASS`** |
| **G4** | KH-02 Full Unit Suites (69 suites) | 1,621 / 1,621 | 0 | **`PASS`** |
| **G5** | Canonical DEV/HOLDOUT Backtest (`runBacktestV12_4_3_4_2.ts`) | 21 Scenarios | 0 | **`PASS`** |

---

## 5. System Resources & Zero-Spend Financial Audit

- **Logical Processors:** 12
- **Total Physical RAM:** 31.75 GB
- **Free RAM at Preflight:** 8.79 GB (Concurrency bound = 2 workers)
- **Disk Free Volume D:** 63.33 GB (44.0% free, above the 12 GB / 15% threshold)
- **Financial Audit:**
  - Approved Network Spend: \$0.00
  - Actual Network Spend: \$0.00
  - Paid API Calls (SerpApi / BigQuery / Meta): 0

---

## 6. Actionable Next Steps to Obtain Verified Business Evidence

1. **Google Trends Explore Official Export:**
   - Manually download the official CSV from `trends.google.com/explore?q=uahpet%20feeder&geo=US&date=today%203-m`.
   - Post to `/api/v1/demand/import` with header `x-workspace-id: acceptance_v12_2_3_ws`.
   - The verified adapter will store the file under `data/google_trends_imports/<sha256>.csv` and record `HISTORICAL_SOURCE_VERIFIED`.
2. **Google Ads Merchant PDP Evidence:**
   - In Google Ads Transparency Center, locate the creative's destination domain and resolve the final merchant redirect link (e.g. via headless browser destination resolver).
   - Upstream MCP adapter must supply `landingPageUrl: "https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder"` rather than the Transparency search page URL.
