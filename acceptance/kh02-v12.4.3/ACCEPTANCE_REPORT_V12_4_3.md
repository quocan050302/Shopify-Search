# SWAI KH-02 V12.4.3 — Acceptance Report

- **Release Version:** `12.4.3`
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **Baseline Reviewed:** `05657392bc7dfcc96fd62803b468fbdf04a84679`
- **Current Git HEAD:** `05657392bc7dfcc96fd62803b468fbdf04a84679`
- **Gate Summary (15 Independent Gates):** `11 PASS`, `0 FAIL`, `4 INSUFFICIENT_EVIDENCE`, `0 BLOCKED`, `0 NOT_RUN`

## 1. Gate Verdicts (G01–G15)
| Gate ID | Verdict | Summary |
| :--- | :--- | :--- |
| `G01_ENGINEERING_HEALTH` | **PASS** | All engineering health suites passed (Unit=426, Reg50=50/50, Int=27, KH01=69, BUILD_ID=sSusuFuGPBscW_X7UuyRB) |
| `G02_EVIDENCE_TRUE_IDENTITY` | **PASS** | All Section 4 evidence-true identity & metadata propagation invariants verified (Fixes F02 & F03) |
| `G03_UNIFIED_PRODUCT_DISTINCTNESS` | **PASS** | Unified 6-level product distinctness verified across discovery, shortlist, and pairwise comparison (Fixes F01) |
| `G04_PRODUCT_FAMILY_DIVERSITY` | **PASS** | Product family clustering & broad-niche diversity prioritization verified (Fixes F07) |
| `G05_ADAPTIVE_POST_GATE_RECOVERY` | **PASS** | Post-gate adaptive recovery and unverified candidate queue refill verified (Fixes F04 & F05) |
| `G13_BACKTEST_DEV_AND_HOLDOUT` | **PASS** | V12.4.3 Backtest PASS (FalseVerified: 10 -> 0, DupFalseSplit: 2 -> 0) |
| `G06_META_REAL_DISCOVERY` | **PASS** | Meta query execution and provenance separation verified across all 8 runs |
| `G07_GOOGLE_TRANSPARENCY_PRODUCT_EVIDENCE` | **PASS** | Google MCP diagnostic states and product-level evidence verified (Live MCP transportConnected=true, Petlibro live status=QUERY_FAILED, controlled MCP productLevelMatches=1, brandLevelMatches=1) |
| `G08_DEMAND_HISTORY_COVERAGE` | **PASS** | Demand query normalization and lookback coverage verified across 30D, 90D, and 180D |
| `G09_SHORTLIST_QUALITY_PET_GADGETS` | **INSUFFICIENT_EVIDENCE** | Pet Gadgets / US / 90D yielded 2/3 distinct physical products from current real source observations (Only 2 independently identifiable, niche-relevant product opportunity(s) were supported by available source evidence (requested 3).) |
| `G10_SHORTLIST_QUALITY_DIY` | **INSUFFICIENT_EVIDENCE** | DIY / US / 180D yielded 1/3 distinct physical products from current real source observations after filtering B2B/app/seasonal noise (Only 1 independently identifiable, niche-relevant product opportunity(s) were supported by available source evidence (requested 3). (1 additional candidate(s) belonged to already-selected product family 'Cordless & Hot Melt Glue Gun' without independent family/model differentiation and were not counted as separate category opportunities.)) |
| `G11_SHORTLIST_QUALITY_KITCHEN_AND_REGRESSION_NICHES` | **INSUFFICIENT_EVIDENCE** | All 8 scenarios executed and aggregated consistently with Empty/Whitespace=HTTP 400 and Out-of-Sample plannedQueries=4; Kitchen yielded 2/3 distinct products after rejecting unverified/social-only ad URLs (Only 2 independently identifiable, niche-relevant product opportunity(s) were supported by available source evidence (requested 3).) |
| `G12_VERIFIED_EVERGREEN_QUALIFICATION` | **INSUFFICIENT_EVIDENCE** | 0/3 live candidates met both verified merchant identity and >=60D historical demand stability; Evergreen thresholds were strictly preserved without false promotion |
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
- **Pet Gadgets / US / 90D (`kh02_run_1793206464699_2unqo`):** Shortlist `2/3` (`2` distinct products across `2` families), Evergreen `0/3`, Verdict: `INSUFFICIENT_EVIDENCE`
- **DIY / US / 180D (`kh02_run_1793206513125_wtb9p`):** Shortlist `1/3` (`1` distinct products across `1` families), Evergreen `0/3`, Verdict: `INSUFFICIENT_EVIDENCE`
- **Kitchen / US / 30D (`kh02_1793206551468_v07jl`):** Shortlist `2/3` (`2` distinct listings, `2` family `OIL_DISPENSER_SPRAYER`, `homogeneousSingleFamily=false`)
- **Home Decor / US / 90D (`kh02_1793206571551_wxtb0`):** Shortlist `0/3` (`0` distinct products, `0` families)
- **Gardening / US / 90D (`kh02_1793206584391_z0umd`):** Shortlist `0/3` (`0` distinct products, `0` families)
- **Cleaning / US / 90D (`kh02_1793206597520_vs35k`):** Shortlist `1/3` (`1` distinct products, `1` families)
- **Specific Product (`automatic pet feeder / US / 90D`):** Shortlist `2/3` (`2` distinct products)
- **Out-of-Sample (`car accessories / US / 90D`):** Planned Queries `4`, Shortlist `2/3`
- **Empty & Whitespace Queries (`""`, `"   "`):** HTTP `400` / `400` (Blocked as required)
