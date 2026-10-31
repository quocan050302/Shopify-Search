# SWAI KH-02 V12.2 — Baseline Audit

**Repository:** `quocan050302/Shopify-Search`  
**Release:** `KH-02 V12.2` — Real Ads Source Activation & Product Identity Intelligence  
**Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Starting Commit SHA:** `efa339322255a640708cc9da8b268d500ec072d1`  
**Protected Reference (origin/QA):** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Audit Timestamp:** 2026-10-26T15:08:00Z  
**Author:** Principal Solution Architect & Independent Acceptance Auditor  

---

## 1. Executive Context & Real-World Problem

When researching the primary niche **`Pet Gadgets`** (US market, 90D lookback), the application previously displayed:
- **Meta Ads**: `Source Available` (131 records in DB, but only SQLite readback, no live ingestion)
- **TikTok Ads US**: `Manual Research Only` (database readback, unconfigured live provider)
- **TikTok Organic**: `Credentials Required` (`HASDATA_API_KEY` unconfigured)
- **Google Ads**: `MCP Not Configured` (`GOOGLE_TRANSPARENCY_MCP_URL` unconfigured)
- **Demand History**: `Engine Ready` (scoring engine ready, but missing product-level time series)

The resulting leaderboard rendered:
```text
6 Candidates Evaluated
5 Provisional Candidates
0 Verified Evergreen Winners
```
More critically, several candidate titles rendered as raw ad creative headers or promotional CTAs:
- `Facebook Ad: 893760707134895`
- `Facebook Ad: 1765076104621076`
- `Facebook Ad: 2249466188957796`
- `Sign up now for 50% off your order!`

These are **advertisements or promotional calls-to-action**, not reliably identified Shopify products.

---

## 2. Test Baseline Summary

Executed prior to any modifications to verify zero pre-existing regressions:
- **`npm run build`**: PASS (Compiled in 1163ms, 51/51 routes generated, 0 errors)
- **`npm run lint`**: PASS (0 errors, 958 warnings)
- **`npm run kh01:verify`**: **PASS (69/69 passed, 0 failures)**
- **`npm run kh02:test:unit`**: **PASS (102/102 passed across 12 files)**
- **`npm run kh02:test:cas`**: PASS (7/7 passed)
- **`npm run kh02:test:heartbeat`**: PASS (7/7 passed)
- **`npm run kh02:test:reconcile`**: PASS (16/16 passed)

---

## 3. Source Infrastructure Diagnostics

| Source | Status in V12.1.4.2 | Real Runtime State | Action Plan in V12.2 |
|---|---|---|---|
| **Meta Ads** | `SOURCE_ACCESS_VERIFIED` | Local Python MCP Collector healthy (`.venv` present, version 1.7.0, tools available). Adapter was primarily querying SQLite rather than invoking live collector when needed. | Wire live collector invocation through `collectLiveMetaAds`, distinguish fresh live ingestion vs cached DB readback, maintain strict US provenance. |
| **TikTok Ads US** | `MANUAL_RESEARCH_ONLY` | Searches SQLite competitor ads. TikTok Creative Center lacks public programmatic API. | Honest capability reporting: `DB_SEARCH_ACTIVE` + manual Creative Center lookup. No fake live PASS. |
| **TikTok Organic** | `CREDENTIALS_REQUIRED` | HasData adapter exists. `HASDATA_API_KEY` missing in environment. | Implement tool discovery, strict zero-cost budget guards, and honest `BLOCKED` reporting if credentials absent. |
| **Google Ads** | `MCP_NOT_CONFIGURED` | Google Ads Transparency adapter exists. MCP server endpoint unconfigured. | Distinguish Google Ads account API from Transparency Center. Honest `BLOCKED` reporting without endpoint. |
| **Demand History** | `ENGINE_READY` | Calculation engine ready in `temporalDemandEngine.ts`. | Enable product-level search term historical matching (e.g. "Pet Hair Remover", "Dog Bark Deterrent"). |

---

## 4. Product Identity Architecture Defect Analysis

In `src/services/kh02/identity/productCandidateDiscovery.ts`:
```ts
const sortedTitles = c.titles
  .map(cleanCandidateTitle)
  .filter((t) => t.length > 5)
  .sort((a, b) => a.length - b.length);

const title = sortedTitles[0] || `${topic} Solution #${index}`;
```
**Root Causes of Defective Product Titles:**
1. **Shortest Length Preference:** Sorting by `a.length - b.length` prioritizes short ad IDs (`Facebook Ad: 123456`) and short slogans (`50% Off Today!`) over informative product descriptions.
2. **No Ad Headline Classification:** Ad IDs and promotional hooks were not identified or rejected as invalid product names.
3. **Ignored Canonical Slugs:** When landing pages follow `/products/ultrasonic-dog-bark-deterrent`, the clean product slug was ignored in favor of the raw ad headline.
4. **No Identity Status Separation:** Ad identity (`AdIdentity`) and Product identity (`ProductIdentity`) were conflated into a single flat candidate structure.

---

## 5. Implementation Roadmap for V12.2

In accordance with Section 04:
- **Phase 1: Meta Live Collector** — Enable live Meta MCP collection, separate live vs cached observations, preserve KH-01.
- **Phase 2: TikTok Ads US** — Honest programmatic provider reporting, database search preservation, US region filtering.
- **Phase 3: TikTok Organic** — HasData tool contract, zero-cost controls, honest blocker status.
- **Phase 4: Google Ads Transparency** — MCP discovery, domain resolution, honest blocker status.
- **Phase 5: Demand History Ingestion & Matching** — Product-specific search term demand series matching, temporal stability.
- **Phase 6: Product Identity Intelligence** — `classifyAdvertisingHeadline`, `resolveProductIdentity`, canonical URL slug extraction, niche relevance validation, card title fix.
- **Phase 7: Real-Source End-to-End Acceptance** — Multi-source research execution on `Pet Gadgets`, full reconciliation, Chromium E2E, commit and push.
