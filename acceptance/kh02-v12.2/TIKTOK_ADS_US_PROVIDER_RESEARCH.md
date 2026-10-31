# SWAI KH-02 V12.2 — TikTok Ads US Technical Provider Research

**Target Channel:** TikTok Ads US (Commercial Competitor Creatives)  
**Date:** 2026-10-26  
**Auditor:** Principal Advertising Intelligence Integration Specialist  

---

## 1. Objective

Determine the legitimate programmatic options for acquiring real-world TikTok competitor advertising intelligence for the United States ecommerce market.

---

## 2. Examination of Provider Candidates

### 2.1 Candidate A: Official TikTok Commercial Content Library (CCL) API
* **Endpoint:** `https://business-api.tiktok.com/open_api/v1.3/commercial_content/`
* **Official Purpose:** Established pursuant to Article 39 of the EU Digital Services Act (DSA) and UK online safety compliance.
* **Geographic Coverage:** Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden, United Kingdom.
* **US Market Availability:** **ZERO**. TikTok CCL does not index, report, or disclose advertisements served to United States audiences.
* **Verdict:** Unusable for US market competitor research. Using it for US claims would constitute false geographical provenance.

### 2.2 Candidate B: TikTok Creative Center Top Ads
* **Interface:** `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US`
* **Features:**
  - Regional filter for United States (`region=US`).
  - Industry categorization (Pets, E-Commerce, Beauty & Personal Care).
  - Relative performance metrics (top 1% - 20% CTR ranking, video engagement, duration).
* **Automated API Access:**
  - **No public REST API** is published by TikTok for the Creative Center.
  - Endpoints used by the web UI require active browser cookies and Cloudflare anti-bot token verification.
  - Automated unauthorized scraping of these endpoints violates TikTok Terms of Service (Section 9.2).
* **Verdict:** Supported via manual lookup and authenticated batch URL import. Automated headless scraping is prohibited.

### 2.3 Candidate C: Third-Party Advertising Intelligence SaaS
* **Providers Evaluated:** PiPiAds, Foreplay.co, Dropispy.
* **Access Model:** Paid subscription with proprietary browser extensions or unofficial private scrapers.
* **Pricing:** $79 - $299 / month.
* **Terms & Reliability:** Reverse-engineered endpoints with unpredictable uptime and risk of credential revocation.
* **Verdict:** Rejected under zero-cost default policy without explicit client subscription approval.

---

## 3. Architecture & Integration Decision

1. **Automated Live Status:**
   ```text
   TIKTOK_ADS_US_LIVE: BLOCKED
   Reason: Verified automated data provider not configured.
   ```
2. **Database Competitor Ad Retrieval:**
   - Existing imported TikTok competitor ads in SQLite are queried by topic/keywords.
   - Observations retain `provenance: "CACHED_SOURCE"` and explicit geographic delivery verification (`isVerifiedUS = ad.targetMarket === "US"`).
3. **Manual Import Workflow:**
   - Users can import specific Creative Center top ad URLs or TikTok video IDs via existing KH-01 import tools.
