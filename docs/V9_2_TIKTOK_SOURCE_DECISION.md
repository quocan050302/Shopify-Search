# SWAI V9.2 — TikTok Source Decision Record (ADR)

**Status:** APPROVED & IMPLEMENTED  
**Date:** October 2026  
**Context:** SWAI V9.2 TikTok Auto Discovery & Provider Authentication Architecture  

---

## 1. Context & Problem Statement

Users of SWAI require automated discovery of high-converting, evergreen ecommerce advertisements from TikTok targeting the United States. In previous iterations (V9.0–V9.1), the system attempted to query TikTok Creative Center's internal undocumented endpoint (`ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list`) using user-provided session cookies (`TIKTOK_CC_COOKIE`).

This approach presented three fundamental challenges:
1. **Security & Credential Fragility:** Copying raw browser session headers (`sessionid`, `msToken`, `sid_tt`) exposes user account security and causes immediate collection failure once TikTok invalidates the session token or detects atypical headless traffic.
2. **Access Control & WAF Blocking:** Akamai Bot Manager on TikTok's edge network actively fingerprints non-browser HTTP clients, returning HTTP 403 / 40101 (`BLOCKED_SOURCE`) regardless of whether the cookie string is present.
3. **No Authorized Free Public API for US Commercial Ads:** TikTok's official Commercial Content API is legally constrained to the European Union (DSA compliance), while the Marketing API only exposes an advertiser's own private campaigns.

---

## 2. Decision Matrix

We evaluated four alternative technical approaches:

### Option A: Reverse-Engineered Internal Creative Center Scraping
* **Mechanism:** Query internal radar endpoints with automated cookie rotation and headless browser emulation.
* **Evaluation:** Violates platform terms, triggers Akamai challenges, requires constant maintenance of reverse-engineered telemetry tokens, and exposes user accounts to suspension.
* **Decision:** **REJECTED** as an autonomous production solution. Maintained strictly as an unverified, disabled-by-default experimental adapter.

### Option B: TikTok Commercial Content API (Official DSA)
* **Mechanism:** Use TikTok Developer Portal OAuth 2.0 application credentials.
* **Evaluation:** Officially supported and stable, but strictly restricted to EU countries. Queries for `country_code: "US"` are rejected upstream.
* **Decision:** **RETAINED** with accurate capability reporting (`REGION_UNSUPPORTED` for US market queries).

### Option C: Licensed Third-Party Cloud Actors (e.g. Apify)
* **Mechanism:** Dedicated headless scraper actor running behind residential proxy pools.
* **Evaluation:** Extremely reliable for US Top Ads discovery, but incurs infrastructure costs (~$0.01 to $0.05 per run).
* **Decision:** **INTEGRATED & BUDGET-PROTECTED**. Disabled by default (`FREE_DISCOVERY_MODE=true`). Requires explicit user opt-in (`ENABLE_APIFY_DISCOVERY=true`), valid `APIFY_API_TOKEN`, and dedicated monthly budget cap. Zero unauthorized spend is guaranteed.

### Option D: Human-in-the-Loop Hybrid Ingestion (Manual + Batch Import)
* **Mechanism:** User conducts zero-cost visual research on TikTok Creative Center via prefiltered US links, then pastes URLs into SWAI's Batch Ingestion modal (up to 50 URLs at a time) for automated parsing, normalization, deduplication, and Gemini longevity scoring.
* **Evaluation:** 100% legal, zero risk of account compromise, $0 cost, and yields 100% source-backed ad records.
* **Decision:** **PRIMARY ZERO-COST RECOMMENDATION**.

---

## 3. Provider Architecture State Summary

```
                      ┌──────────────────────────────────────┐
                      │        Discovery Orchestrator        │
                      └──────────────────┬───────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
      [ Free Mode: Active ]                            [ Paid Mode: Authorized ]
                 │                                               │
   ┌─────────────┴─────────────┐                                 │
   ▼                           ▼                                 ▼
tiktok-official         tiktok-topads                      apify-topads
Status:                 Status:                            Status:
REGION_UNSUPPORTED      NOT_CONFIGURED / BLOCKED           AVAILABLE (if enabled)
(EU DSA Only)           (Undocumented / No Session)        Budget: strictly metered
```

---

## 4. Final Architectural Rule

The discovery engine state is declared as:
- **`ENGINE_READY`**: The complete scheduling, background worker, database ingestion, deduplication, scoring, and UI pipeline is fully operational.
- **`NO_AUTHORIZED_PROVIDER`**: Because zero-cost autonomous US discovery lacks an authorized public API, the engine honestly communicates the lack of an authorized free source rather than synthesizing fake advertisements.
