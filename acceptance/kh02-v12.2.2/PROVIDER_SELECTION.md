# SWAI KH-02 V12.2.2 — PROVIDER SELECTION MATRIX

| Provider Candidate | Target Source | Protocol | US Market Coverage | Auth Method | Unit Cost | Verified Status | Decision & Rationale |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **MetaAdsCollector MCP** | META_ADS | Local Python stdio | Complete (100% US Coverage) | None (Local stdio MCP) | Free ($0.00) | **LIVE_VERIFIED** | **SELECTED**: High-reliability canonical platform for initial product candidate discovery. |
| **TikTok Creative Center Top Ads** | TIKTOK_ADS | HTTPS Session RPC | Complete US Top Ads | `TIKTOK_CC_COOKIE` | Free ($0.00) | **SUPPORTED** | **SELECTED**: Best official US commercial trend dataset; requires active session cookie. |
| **Apify TikTok Top Ads** | TIKTOK_ADS | HTTPS REST | Complete US Top Ads | `APIFY_TOKEN` | ~$0.005 / run | **SUPPORTED** | **SELECTED (FALLBACK)**: Reliable programmatic fallback when session cookie expires. |
| **TikTok Commercial Content API** | TIKTOK_ADS | Official REST | 0% (EU/UK Only) | App ID / Secret | Free | **REJECTED** | **REJECTED**: Does not cover US advertising under TikTok API terms. |
| **HasData TikTok Search** | TIKTOK_ORGANIC | HTTPS REST | Global / US Keyword Search | `x-api-key` | 10 Credits / search | **SUPPORTED** | **SELECTED**: Fast video intelligence enrichment; guarded by `AUTO_PAID_RESEARCH`. |
| **gads-transparency-mcp** | GOOGLE_ADS | Stdio JSON-RPC | Complete Google Ads US | None (Public Transparency) | Free ($0.00) | **SUPPORTED** | **SELECTED**: Native MCP package for Ads Transparency Center competitor research. |
| **SerpApi Google Trends** | DEMAND_HISTORY | HTTPS REST | Complete US Timeline | `api_key` | 1 Search / keyword | **SUPPORTED** | **SELECTED**: Authoritative Google Trends interest-over-time time series. |
