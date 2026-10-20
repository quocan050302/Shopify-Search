# SWAI V9 — Source Feasibility Matrix & Provider Architecture Analysis

**Document Version:** 1.0.0 (V9 Auto Discovery)  
**Date:** 2026-10-20  
**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Market:** United States (US)  
**Operating Mode:** `RESEARCH_ONLY`  

---

## 1. Executive Summary

This document evaluates the feasibility, legality, terms, and technical characteristics of candidate data sources for the SWAI TikTok Auto Discovery Engine.

In accordance with SWAI V9 Core Principles:
- **Zero-Cost Default:** Default configuration makes 0 paid requests.
- **No Unapproved Scraping / No Evasion:** No rotating proxies, identity spoofing, or CAPTCHA bypasses.
- **Real Data Only:** Zero fabricated metrics or synthetic ad records in production.
- **Honest Blocked States:** If an automated free source is blocked or requires unauthorized circumvention, mark `BLOCKED_SOURCE` or `NO_AUTHORIZED_PROVIDER` instead of silently faking discovery.

---

## 2. Source Feasibility Matrix

| Source / Project | Type | Repository / Provider | License | US Commercial Ads | Keyword Search | Industry Filters | First/Last Dates | Auth / Session | Pricing | Live Tested Status | SWAI V9 Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TikTok Creative Center Direct (Internal API)** | Direct HTTP API | [`andrei0182/tiktok-market-scout`](https://github.com/andrei0182/tiktok-market-scout) | MIT | Yes (via `creative_radar_api`) | Yes | Yes | Period filters (7d/30d/180d) | Requires active `TIKTOK_CC_COOKIE` from browser | Free | **BLOCKED without browser cookie**; WAF/anti-bot blocks unauthenticated scripts | Supported via User-Supplied Session Cookie or Manual Import; BLOCKED by default |
| **Apify: TikTok Creative Center Scraper** | Actor Provider | [`lofe-w/tiktok-creative-center-scraper-public`](https://github.com/lofe-w/tiktok-creative-center-scraper-public) | MIT | Yes (28 regions incl. US) | Yes (`dashboard_search`) | Yes | Period filters | Apify API Token + TikTok Session Cookie | Paid ($0.002/item + Actor CU) | Documented, requires Apify credits & cookie | Supported as Optional Paid Provider (Disabled by default) |
| **Apify: TikTok Top Ads Scraper** | Actor Provider | [`assa83/tiktok-top-ads-api`](https://github.com/assa83/tiktok-top-ads-api) (`lagenuina_agency`) | MIT | Yes (US supported) | Yes | Yes (Skincare, etc.) | 7d/30d/180d | Apify API Token (`APIFY_TOKEN`) | Paid (Apify CU / monthly subscription) | Verified schema via community exports | Supported as Optional Paid Provider (Disabled by default) |
| **TikTok Official Research API** | Official Platform API | [TikTok for Developers](https://developers.tiktok.com) | Proprietary | Restricted | Yes | No | Yes | OAuth Client + Academic/Vetted Token | Free for approved applicants | Requires university/vetted NGO partnership | Ineligible for commercial research |
| **TikTok EU Commercial Content Library** | Official Platform API | [TikTok DSA Transparency](https://library.tiktok.com) | Proprietary | **NO (EU Only)** | Yes | No | Yes | Free Public Token | Free | Verified (EU DSA only) | UNSUPPORTED for US market |
| **Captapi Ads Intelligence** | Third-party Licensed API | [Captapi](https://captapi.com) | Commercial | Yes | Yes | Yes | Yes | API Key (`CAPTAPI_KEY`) | Paid (Metered per credit) | Disabled by default in SWAI | Optional Paid Provider (Disabled by default) |
| **TikTok Creative Center Manual / Batch Import** | Public Web Portal | [ads.tiktok.com/creativecenter](https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US) | Public | Yes (US Primary) | Yes | Yes | 7d/30d/180d | None (Browser access) | Free ($0.00) | **LIVE VERIFIED** (Batch import up to 50 URLs) | Primary Free Manual Research Baseline |

---

## 3. Detailed Technical Analysis of Sources

### 3.1. TikTok Market Scout (`andrei0182/tiktok-market-scout`)
- **Mechanism:** Queries `https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list`.
- **Finding:** The author explicitly discloses that the code was written in a sandbox where `ads.tiktok.com` was blocked and that live execution was never verified. Direct cURL/fetch calls to `creative_radar_api` without a valid `TIKTOK_CC_COOKIE` return HTTP 403 Forbidden or redirect to a CAPTCHA gate.
- **Architectural Decision for SWAI:** We implement an authorized adapter (`TiktokTopAdsProvider`) that can consume `TIKTOK_CC_COOKIE` if provided by the user. If unconfigured or unauthorized, it reports `REQUIRES_AUTH` or `BLOCKED_SOURCE` honestly without attempting evasive CAPTCHA solving.

### 3.2. Apify Actor Clients (`lofe-w` and `assa83`)
- **Mechanism:** Offloads browser automation and cookie rotation to the Apify platform, returning structured JSON items.
- **Finding:** Schema includes `adId`, `adTitle`, `brandName`, `ctr`, `likes`, `industryName`, `objectiveKey`, `durationSec`, `countryCode`, `periodDays`, `landingPageUrl`, `videoUrl720p`, and `detailUrl` (`https://ads.tiktok.com/business/creativecenter/topads/{adId}/pc/en?...`).
- **Architectural Decision for SWAI:** We implement `ApifyTopAdsProvider` as a secondary, user-authorized provider. It connects to the SWAI budget service (`budgetService.ts`) and is strictly disabled by default. If the user provides `APIFY_TOKEN` and sets `allowAutomaticRequests: true`, it can run scheduled discovery within strict budget limits.

### 3.3. Architecture Pattern from `bluzername/tiktok-top-products`
- **Mechanism:** Cron-based caching pattern that decouples scheduled collection from page loads, preventing inadvertent paid API triggers.
- **Architectural Decision for SWAI:** SWAI adopts this exact pattern in Section K (`src/workers/discoveryWorker.ts` and `scripts/discovery-worker.ts`). Frontend visits in Ads Explorer or Discovery never trigger external network requests. Only the local worker executes scheduled queries.

---

## 4. Provider Selection & Execution Hierarchy

SWAI enforces a strict 4-tier provider selection priority:

1. **Tier 1 (Primary Free Automated):** `TiktokTopAdsProvider` (Official / Creative Center authorized interface with optional session credentials).
2. **Tier 2 (Primary Free Manual Baseline):** `TiktokCreativeCenterManual` (Batch URL import via prefiltered US links). Always available at $0.00.
3. **Tier 3 (User-Authorized Metered API):** `ApifyTopAdsProvider` or `CaptapiProvider`. Strictly disabled by default; requires explicit enablement, budget allocation, and admin authorization.
4. **Tier 4 (Fallback):** If Tier 1 is unconfigured or blocked and Tier 3 is disabled, discovery halts safely with status `BLOCKED_SOURCE` or `REQUIRES_AUTH`. **Never fall back to synthetic or mock data.**

---

## 5. Final Provider Decision for SWAI V9

1. **Free Discovery Engine:** Implement the full automated discovery engine with the multi-provider interface (`AdDiscoveryProvider`).
2. **Standard Adapters:**
   - `tiktok-topads`: Direct Creative Center interface. Checks live status; reports `BLOCKED_SOURCE` if unauthenticated.
   - `apify-topads`: Apify Top Ads Actor adapter. Disabled by default; fully supported when user configures credentials and budget.
   - `manual-import`: Batch import pipeline for zero-cost research.
3. **Honest Reporting:** When run without external paid keys or session cookies, the Discovery Engine clearly indicates:
   `Status: BLOCKED_SOURCE (Requires TikTok session authorization or user-authorized Apify token)`
   with zero fabricated ads in the production database.
