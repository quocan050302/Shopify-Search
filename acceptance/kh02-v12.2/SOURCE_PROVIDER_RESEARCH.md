# SWAI KH-02 V12.2 — Comprehensive Advertising Source Provider Research

**Release:** KH-02 V12.2  
**Date:** 2026-10-26  
**Auditor:** Principal Solution Architect & Advertising Integration Specialist  
**Default Policy:** ZERO UNAPPROVED PAID API OPERATIONS (`AUTO_PAID_RESEARCH=false`)

---

## 1. Executive Summary

KH-02 requires real, source-backed advertising observations and verifiable product identities to identify sustainable evergreen Shopify product opportunities.
This document provides an exhaustive, factual technical evaluation of programmatic and public intelligence providers across all five target intelligence channels.

---

## 2. Source Channel Evaluations

### 2.1 Meta Ads (Facebook & Instagram)
* **Official Public Ad Library:** `facebook.com/ads/library`
* **Local Ingestion Mechanism:** Python-based `MetaAdsCollector` MCP server (`services/meta-ads-collector/.venv/bin/python`).
* **Protocol:** stdio MCP JSON-RPC protocol.
* **Collector Version:** 1.7.0.
* **Supported Regions:** US, CA, GB, AU, and global country filters.
* **Commercial Competitor Ads Scope:** Fully operational for active commercial ads. Returns Library ID, advertiser identity, page ID, creative headlines, body copy, media URLs (images/videos), landing page URLs, first/last seen dates.
* **Cost & Terms:** Zero external paid scraping subscription fees. Queries public Ad Library endpoints directly via self-hosted headless automation.
* **Provenance Classification:**
  - Fresh MCP upstream query: `LIVE_PROVIDER`
  - Stored SQLite competitor ad: `CACHED_SOURCE`
  - Explicitly verified ad: `VERIFIED_SOURCE`
* **Status:** **OPERATIONAL & LIVE VERIFIED** via local MCP collector.

---

### 2.2 TikTok Ads US (Paid Creatives)
* **Official Commercial Content Library:** Documented API exists (`https://business-api.tiktok.com/open_api/v1.3/commercial_content/`), but legal and regulatory scope is strictly restricted to European Union (EU) and United Kingdom (UK) transparency requirements under Digital Services Act (DSA). Does **NOT** cover United States competitor advertising delivery.
* **TikTok Creative Center Top Ads:** `ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US`
  - Provides US commercial creative trends, CTR rankings, video durations, and advertiser branding.
  - Does **NOT** expose a documented public REST API or official MCP server for unauthenticated third-party automation.
* **Third-Party Provider Candidates:** Unofficial scraping proxies exist but require ongoing monthly subscriptions or violate anti-bot safeguards.
* **Truthful Status Decision:**
  - Automated programmatic live query: **BLOCKED** (Verified automated provider not configured).
  - Database search of previously imported competitor ads: **ACTIVE** (`CACHED_SOURCE`).
  - Manual import via verified Creative Center URL: **SUPPORTED**.

---

### 2.3 TikTok Organic Video Intelligence
* **Primary Provider Evaluated:** HasData TikTok Scrape API & MCP (`https://mcp.hasdata.com/mcp?apis=tiktok`).
* **Candidate Repository:** `https://github.com/HasData/tiktok-mcp`.
* **Authentication:** Requires `HASDATA_API_KEY` (or `TIKTOK_ORGANIC_API_KEY`).
* **Metering & Cost Policy:**
  - Metered commercial API (1 credit per search request).
  - Default policy: `AUTO_PAID_RESEARCH=false`.
  - When credentials are absent: System truthfully reports `CREDENTIALS_REQUIRED` / `BLOCKED`.
  - Never fakes live connection or credit balance.
* **Data Fields Returned (when authenticated):** Video ID, canonical video URL, creator handle, play count (views), likes, comments, shares, video duration, published timestamp.
* **Geographic Market Caution:** TikTok public organic videos represent global interest. Without regional audience telemetry, US market verification is classified as `UNVERIFIED`.
* **Status:** **BLOCKED** (Missing `HASDATA_API_KEY` in environment; adapter and cost guard ready).

---

### 2.4 Google Ads Transparency Center
* **Interface:** `adstransparency.google.com`
* **Official Google Ads API / MCP:** Restricted to advertiser's own managed accounts (`googleads.googleapis.com`); does **NOT** provide public competitor transparency records.
* **Third-Party Transparency MCP Reviewed:** `https://github.com/block-town/google-ads-transparency-mcp`.
* **Security & Operational Finding:** See dedicated `GOOGLE_MCP_SECURITY_REVIEW.md`. Third-party repository relies on headless browser emulation against Google reCAPTCHA endpoints. Non-compliant for production without authorized upstream API.
* **Truthful Status Decision:**
  - MCP endpoint (`GOOGLE_TRANSPARENCY_MCP_URL`): **NOT_CONFIGURED**.
  - Live Status: **BLOCKED**.
  - Adapter capabilities: Schema discovery, domain lookups, and advertiser creative normalization implemented and ready.

---

### 2.5 Historical Demand & Trend Stability
* **Source:** Google Trends (US Interest Over Time).
* **Official API Scope:** Google Trends Alpha API requires explicit enterprise partner authorization. Unofficial endpoints are prone to IP rate-limiting.
* **KH-02 Architecture:**
  - `temporalDemandEngine.ts` implements rigorous statistical evaluation: CV (coefficient of variation), covered days (>= 60), distinct observation dates (>= 3).
  - `historicalDemandIngestion.ts` links product-specific queries (e.g. "Ultrasonic Anti-Barking Device") rather than broad niche terms ("Pet Gadgets").
  - Queries stored `ProductDemandObservation` records or authorized demand providers.
* **Status:** **ENGINE READY** (Temporal policy engine operational; requires >= 3 observation points across 60+ days for verified evergreen qualification).

---

## 3. Summary Provider Activation Matrix

| Source | Provider Mechanism | Auth Required | Zero-Cost? | Automated Live Status | Database Cache Status |
|---|---|---|---|---|---|
| Meta Ads | Local Python MCP (`MetaAdsCollector`) | None (Local stdio) | Yes (100% free) | **LIVE_VERIFIED** | Active (`CACHED_SOURCE`) |
| TikTok Ads US | Creative Center / CCL | Enterprise Token | No | **BLOCKED** | Active (`CACHED_SOURCE`) |
| TikTok Organic | HasData TikTok API / MCP | `HASDATA_API_KEY` | Metered (Paid) | **BLOCKED** (Missing Key) | N/A |
| Google Ads | Transparency Center MCP | MCP Endpoint | Free/Local | **BLOCKED** (Not Configured) | N/A |
| Demand History | Stored Observations / Trends | Trends API Key | Free | **ENGINE_READY** | Active (`ProductDemandObservation`) |
