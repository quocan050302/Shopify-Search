# SWAI V9.2 — TikTok Free Source Feasibility Matrix & Research Assessment

**Document Version:** 9.2.0  
**Target Market:** United States (US) Ecommerce Advertisements  
**Primary Focus:** Evergreen commercial ads with verifiable source provenance  
**Default Spending:** $0.00 (Zero unauthorized paid calls)  
**Evaluated Date:** October 2026  

---

## 1. Executive Summary

A comprehensive investigation of official TikTok developer interfaces, open-source repositories, and third-party scraping engines was conducted to identify any legitimate, zero-cost, autonomous method for discovering United States commercial TikTok ads.

**Key Finding:** There is currently **no officially supported, zero-cost public API** that permits automated bulk harvesting of United States commercial competitor advertisement records without either:
1. Violating TikTok's Terms of Service through unauthorized internal API scraping / session forgery, or
2. Requiring paid third-party infrastructure (e.g. Apify actors with residential proxies to circumvent TikTok's anti-bot WAF/Akamai protection).

In accordance with SWAI engineering standards, **the system rejects synthetic/fake data generation and rejects brittle cookie-forgery hacks**. The architecture is certified as **`ENGINE_READY / NO_AUTHORIZED_PROVIDER`** for free automated collection, while preserving 100% functionality for manual research, URL import, batch ingestion, and user-directed AI analysis.

---

## 2. Investigation of Open-Source Repositories

| Repository | Architecture / Execution Mechanism | US Top Ads Support | Licensing & Permission | Maintenance State & Feasibility |
|---|---|---|---|---|
| **andrei0182/tiktok-market-scout** | Python client wrapping undocumented Creative Center endpoints with local browser session headers. | Simulated via headers; relies on active session cookies. | MIT; lacks TikTok commercial authorization. | **Stale / Blocked**. Endpoint signatures have shifted; queries fail with WAF challenge or HTTP 403 without valid browser telemetry. |
| **lofe-w/tiktok-creative-center-scraper-public** | Wrapper designed to call an Apify Actor (`lofe/tiktok-creative-center-scraper`). Does not contain standalone scraping engine. | Requires paid Apify compute units and residential proxy pool. | MIT (Wrapper only); third-party hosted. | **Paid Dependency**. Not a free standalone engine. Fails when zero-budget rule is enforced. |
| **assa83/tiktok-top-ads-api** | Node.js script querying `ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list` using copied browser session cookies. | Filters for US region (`country_code: "US"`). | No commercial license from platform; reverse-engineered. | **High Risk / Brittle**. Session cookies expire quickly or trip Akamai Bot Manager (`risk_control`). Requires manual cookie copying every few hours. |
| **bluzername/tiktok-top-products** | Scrapes Creative Center Top Products tab rather than Top Ads video ad creatives. | Product category rankings only, not ad video assets. | Open-source sandbox. | **Out of Scope**. Does not deliver ad creative metadata, advertiser identity, or longevity metrics. |

---

## 3. Official TikTok Developer APIs Evaluation

| Official API Surface | Intended Purpose | Competitor US Ads Research? | Public Access Basis | Operational Status in SWAI |
|---|---|---|---|---|
| **TikTok API for Business (Marketing API)** | Manage advertiser's **own** ad campaigns, ad groups, creatives, and reporting metrics. | **NO**. Only returns ad objects belonging to authenticated advertiser ID. | Registered developer account with Advertiser ID. | Not applicable for competitor intelligence. |
| **TikTok Commercial Content API** | European Union Digital Services Act (DSA) transparency compliance. | **NO (EU Only)**. Explicitly restricted by regulation to advertisements displayed in EU member states. Queries for `country_code: "US"` return validation errors or empty sets. | Approved researcher/developer application via TikTok Developer Portal. | Supported in codebase as `tiktok-official` with honest `REGION_UNSUPPORTED` status for US market. |
| **TikTok Creative Center (Web UI)** | Public web catalog of trending top ads and creative insights for inspiration. | **YES (Web UI Only)**. Provides US Top Ads filtering, performance percentiles, and landing page URLs. | Public web portal via human browser interaction. No public automated REST API. | Fully supported in SWAI via **Manual Research Mode**, Direct Prefiltered Links, Single URL Import, and Batch Ingestion. |
| **TikTok oEmbed API** | Display public video players for organic posts (`tiktok.com/@user/video/id`). | **Partial**. Only functions if the ad creative was posted as a public organic video and allows embedding. | Free official endpoint (`https://www.tiktok.com/oembed`). | Fully integrated in SWAI via `tiktokEmbedService.ts`. Ad details render native player when available; otherwise safe fallback card is displayed. |

---

## 4. Comprehensive Free-Source Feasibility Matrix

| Source / Provider | Auth Method | US Support | Keyword Search | Video Playback | Pagination | Reliability | Usage Restrictions | Cost | Live Status in SWAI |
|---|---|---|---|---|---|---|---|---|---|
| **`tiktok-topads` (Internal CC)** | Browser session cookie (`TIKTOK_CC_COOKIE`) | Yes (query param `country_code: "US"`) | Yes | Fallback / Direct CC link | Yes (page, limit) | Low (Akamai blocks automated HTTP) | Undocumented, session expires frequently, risk of account ban | $0 (direct) | `BLOCKED_SOURCE` / `NOT_CONFIGURED` without cookie |
| **`tiktok-official` (Commercial Content API)** | OAuth 2.0 Client Credentials (DSA) | **No** (EU DSA strictly enforced) | Yes | Yes (official embed) | Yes (cursor) | High (official SLA) | Restricted to EU DSA member states | $0 | `REGION_UNSUPPORTED` (Honest status) |
| **`apify-topads` (Third-Party Actor)** | Apify API Token (`APIFY_API_TOKEN`) | Yes | Yes | Yes | Yes | High (uses residential proxies) | Metered actor execution ($5–$30/mo) | Paid (~$0.01–$0.05/run) | `PAID_DISABLED` by default (`FREE_DISCOVERY_MODE=true`) |
| **`captapi` (Historical)** | Captapi API Token | Yes | Yes | Metadata only | Yes | Variable | Metered credits | Paid | `PAID_DISABLED` |
| **Manual URL & Batch Import** | None (User-supplied URLs) | Yes | Manual | Native / oEmbed / Upload | N/A | 100% | User-driven verification | $0 | **AVAILABLE / PRODUCTION** |

---

## 5. Architectural Recommendation

1. **Maintain Honest Provider Status:**  
   SWAI must accurately report `ENGINE_READY` with `NO_AUTHORIZED_PROVIDER` when free mode is active. It will never simulate synthetic ads or pretend that missing cookies mean "TikTok is connected".
2. **Support User-Controlled Paid Providers:**  
   When users explicitly provide an `APIFY_API_TOKEN` and set `ENABLE_APIFY_DISCOVERY=true` with an approved budget, SWAI cleanly routes scheduled jobs to Apify with budget ceilings and metered ledger logging.
3. **Preserve Zero-Cost Workflow:**  
   Users can conduct zero-cost US research using the **Top Ads US Direct Link** button in Ads Explorer, copy high-performing ad URLs, and use **Batch Import** to ingest up to 50 ads at once with full Gemini AI longevity analysis.
