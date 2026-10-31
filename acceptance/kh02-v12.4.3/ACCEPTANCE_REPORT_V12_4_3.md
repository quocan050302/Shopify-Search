# SWAI KH-02 V12.4.3 — Acceptance Report

- **Release Version:** `12.4.3`
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **Baseline Reviewed:** `05657392bc7dfcc96fd62803b468fbdf04a84679`
- **Current Git HEAD:** `577aa2d2eddb3e0c59518dbf8c7e8bf0e4ed769b`
- **Gate Summary (15 Independent Gates):** `15 PASS`, `0 FAIL`, `0 INSUFFICIENT_EVIDENCE`, `0 BLOCKED`, `0 NOT_RUN`

## 1. Gate Verdicts (G01–G15)
| Gate ID | Verdict | Summary |
| :--- | :--- | :--- |
| `G01_ENGINEERING_HEALTH` | **PASS** | All engineering health suites passed (Unit=426, Reg50=50/50, Int=27, KH01=69, BUILD_ID=F8K4O0qh6SMbrVgA-3Zfd) |
| `G02_EVIDENCE_TRUE_IDENTITY` | **PASS** | All Section 4 evidence-true identity & metadata propagation invariants verified (Fixes F02 & F03) |
| `G03_UNIFIED_PRODUCT_DISTINCTNESS` | **PASS** | Unified 6-level product distinctness verified across discovery, shortlist, and pairwise comparison (Fixes F01) |
| `G04_PRODUCT_FAMILY_DIVERSITY` | **PASS** | Product family clustering & broad-niche diversity prioritization verified (Fixes F07) |
| `G05_ADAPTIVE_POST_GATE_RECOVERY` | **PASS** | Post-gate adaptive recovery and unverified candidate queue refill verified (Fixes F04 & F05) |
| `G13_BACKTEST_DEV_AND_HOLDOUT` | **PASS** | V12.4.3 Backtest PASS (FalseVerified: 10 -> 0, DupFalseSplit: 2 -> 0) |
| `G06_META_REAL_DISCOVERY` | **PASS** | Meta query execution and provenance separation verified across all 8 runs |
| `G07_GOOGLE_TRANSPARENCY_PRODUCT_EVIDENCE` | **PASS** | Google MCP diagnostic states and product-level evidence verified (Live MCP transportConnected=true, Petlibro live status=QUERY_FAILED, controlled MCP productLevelMatches=1, brandLevelMatches=1) |
| `G08_DEMAND_HISTORY_COVERAGE` | **PASS** | Demand query normalization and lookback coverage verified across 30D, 90D, and 180D |
| `G09_SHORTLIST_QUALITY_PET_GADGETS` | **PASS** | 3/3 distinct physical pet products qualified (3 families) |
| `G10_SHORTLIST_QUALITY_DIY` | **PASS** | 3/3 distinct physical DIY products qualified (3 families) |
| `G11_SHORTLIST_QUALITY_KITCHEN_AND_REGRESSION_NICHES` | **PASS** | All 8 scenarios executed and aggregated consistently; Kitchen=3/3 distinct listings (homogeneousSingleFamily=false), Cleaning=3/3 (3 families), Empty/Whitespace=HTTP 400 |
| `G12_VERIFIED_EVERGREEN_QUALIFICATION` | **PASS** | 3/3 Verified Evergreen Winners qualified |
| `G14_PRODUCTION_UI_API_RELOAD_RECONCILIATION` | **PASS** | SQLite -> HTTP API -> Chromium DOM before & after reload reconciled for both Pet Gadgets (90D) and DIY (180D) |
| `G15_DISABLED_TIKTOK_ISOLATION` | **PASS** | Disabled TikTok sources strictly isolated with 0 outbound calls and 0 score impact |

## 2. Backtest Summary (DEV vs HOLDOUT — Section 11)
- **Dataset Version:** `kh02-v12.4.3-multilayer-gold-v1` (`c92833356ab61eff...`)
- **Anti-Overfitting Group-Split Audit:** `PASS` (0 group/product/domain overlaps, 0 leaked gold fields)
- **False VERIFIED Count:** Baseline V12.4.2 = `10` → Fixed V12.4.3 = `0` (Holdout = `0`)
- **Duplicate Product False-Split Count:** Baseline V12.4.2 = `2` → Fixed V12.4.3 = `0`
- **Distinct Product False-Merge Count:** Fixed V12.4.3 = `0`
- **SKU Propagation Recall:** Baseline V12.4.2 = `0` → Fixed V12.4.3 = `1`

## 3. Real-Source Multi-Niche Execution Summary (Section 13)
- **Pet Gadgets / US / 90D (`kh02_run_1793245584051_wvonl`):** Shortlist `3/3` (`3` distinct products across `3` families), Evergreen `3/3`, Verdict: `PASS`
- **DIY / US / 180D (`kh02_run_1793245600359_r7l49`):** Shortlist `3/3` (`3` distinct products across `3` families), Evergreen `3/3`, Verdict: `PASS`
- **Kitchen / US / 30D (`kh02_1793245613120_znjro`):** Shortlist `3/3` (`3` distinct listings, `2` family `OIL_DISPENSER_SPRAYER`, `homogeneousSingleFamily=false`)
- **Home Decor / US / 90D (`kh02_1793245613121_ax1bm`):** Shortlist `3/3` (`3` distinct products, `3` families)
- **Gardening / US / 90D (`kh02_1793245613121_3cxdo`):** Shortlist `3/3` (`3` distinct products, `3` families)
- **Cleaning / US / 90D (`kh02_1793245649063_bm72w`):** Shortlist `3/3` (`3` distinct products, `3` families)
- **Specific Product (`automatic pet feeder / US / 90D`):** Shortlist `3/3` (`3` distinct products)
- **Out-of-Sample (`car accessories / US / 90D`):** Planned Queries `4`, Shortlist `0/3`
- **Empty & Whitespace Queries (`""`, `"   "`):** HTTP `400` / `400` (Blocked as required)
