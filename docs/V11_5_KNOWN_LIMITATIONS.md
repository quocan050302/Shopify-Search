# SWAI V11.5 — Known Operational Boundaries & Limitations

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Version:** V11.5  
**Operating Mode:** `RESEARCH_ONLY`  
**Evaluation Date:** October 2026  

---

## 1. Operating Mode & Architecture Boundaries

### 1.1 `RESEARCH_ONLY` Operational Mode
- SWAI V11.5 operates strictly in `RESEARCH_ONLY` mode.
- Connecting a live Shopify store via OAuth or Admin REST/GraphQL APIs is not required and is explicitly restricted.
- The **"My Store Analytics"** feature in the navigation is intentionally locked with a `[FUTURE]` status badge to indicate that connected-store commerce telemetry is out of scope for this research release.

### 1.2 No Fabrication of Performance or Revenue Data
- SWAI never fabricates or synthesizes Meta ad performance metrics (impressions, spend, conversions, ROAS), store GMV, or competitor order volume.
- Where upstream public library data does not provide exact spend or conversion figures, the interface explicitly displays `UNVERIFIED` or `UNKNOWN` rather than estimating fictitious numbers.

---

## 2. Market Scope & Geolocation

### 2.1 Primary Target Market: United States (US)
- Advertising intelligence, keyword targeting, and ad library scraping defaults are calibrated for the United States (`US`) market.
- Non-US regions can be targeted via backend parameters, but the current UI filters and currency formatters are standardized on USD and US ad library endpoints.

---

## 3. Local Environment & Dependency Prerequisites

### 3.1 MetaAdsCollector Local MCP Architecture
- SWAI uses a local Model Context Protocol (MCP) server running on the user's host machine to interface with Meta's Ad Library.
- Prerequisites for automated collection:
  1. Python 3.10+ installed and accessible via `python3` or virtual environment.
  2. Python dependencies installed in the collector directory (`pip install -r requirements.txt`).
  3. Discovery background worker running locally (`npm run worker:discovery`).
- If these components are not running, the application transitions gracefully to `SETUP_REQUIRED` or `WORKER_OFFLINE` with actionable terminal setup steps, but cannot execute automated live fetches until the background processes are launched.

### 3.2 Live Source Acceptance (Opt-In)
- Meta's public ad library endpoints enforce anti-bot protections and IP-based rate limits.
- In automated test suites, Gate `KH01-GATE-12` defaults to `NOT_RUN` (classified as compliant for offline test runs) unless `--run-live-source` is explicitly passed with a valid proxy or collector session.
- Live source tests must never run in unauthenticated CI environments.

---

## 4. Database Concurrency & Storage

### 4.1 SQLite / LibSQL Concurrency
- The local database is powered by SQLite with WAL (Write-Ahead Logging) enabled.
- Multi-process worker concurrency is protected up to 10 concurrent research jobs with lease renewal fencing and randomized backoff retry (`withDbRetry`).
- High-scale multi-server deployments will require migrating the libSQL datasource to a managed PostgreSQL or Turso cluster.
