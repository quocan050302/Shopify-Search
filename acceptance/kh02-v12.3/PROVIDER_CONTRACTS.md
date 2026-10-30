# SWAI KH-02 V12.3 — Provider Contracts & Interface Specifications

## 1. SerpApi Google Trends Contract
- **Endpoint:** `https://serpapi.com/search.json?engine=google_trends`
- **Authentication:** `api_key` query parameter (derived from `SERPAPI_API_KEY` server environment variable).
- **Cost Policy:** `AUTO_PAID_RESEARCH=false` strictly enforced. Free tier limit respected.
- **Contract Boundary:** Parameterized by `q` (product-specific disambiguated search term), `geo` (default "US"), and `date` (mapped to discovery window 30D/90D).

## 2. Google Ads Transparency MCP Bridge Contract
- **Transport:** Standard input/output (`stdio`) process bridge using FastMCP.
- **Python Runtime:** Pin pinned git commit in `services/google-transparency/.venv/bin/python`.
- **Tools Contract:**
  - `search_advertiser(query: str)`: Returns exact advertiser ID matching store domain.
  - `get_advertiser_ads(advertiser_id: str, region: str, count: int)`: Returns raw creative payloads with delivery metadata.
- **Provenance Rule:** Provider filter market preserved distinctly from verified ad delivery market.

## 3. Meta Ads Collector MCP Contract
- **Transport:** Local MCP stdio Python collector (`MetaAdsCollector`).
- **Authentication:** Local session scraping; zero paid metered requests.
- **Normalization:** Ingestion trace emits ACCEPTED, UPDATED, DUPLICATE, or REJECTED statuses with raw source IDs.
