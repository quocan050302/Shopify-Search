# Advertising Data Sources & Provider Feasibility Matrix

## 1. Provider Feasibility Matrix

| Data Source | Access Method | Geographic Coverage | API Availability | Auth Required | Rate Limits | Supported Fields | Video Playback Method | Commercial / Legal Constraints | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Meta Ad Library API** | Official Graph API (`/ads_archive`) | Global (US requires political ad authorization for certain filters; commercial ads searchable via page/archive query) | Available via Developer App | Yes (User/App Access Token) | 200 calls/hour per user | Ad creative text, page name, first/last seen, snapshot URL | Official Embed / Archive Snapshot Link | Video files must not be scraped; snapshot URL provides official iframe or preview | `AVAILABLE` (Requires Token) |
| **TikTok Creative Center** | Public Web / Creative Insights | US, UK, Global Top Ads | Limited public machine API (Scraping prohibited by ToS) | No for public web, Yes for Commercial API | Session rate limits | Top trending ad video, industry, likes, CTR rank, duration | Official Video Player / Embed | Commercial Content API restricted to specific EU DSA transparency; US commercial ads viewed via public embed links | `AVAILABLE` (Public Observation / Embed) |
| **TikTok Commercial Content API** | Official REST API | Strictly EU (DSA compliance), Selected global pilots | Restricted Enterprise Access | High (Official developer approval) | Tiered API quota | Ad video URL, advertiser name, impressions bracket, targeting | Direct CDN video URL | EU data cannot be misrepresented as US advertising data | `REQUIRES_LICENSE` (Restricted Region) |
| **Direct URL Ingestion** | Regex URL Resolver + Metadata Extractor | US and Global links | In-app Parser | None | App rate limit | Extracted platform ID, clean canonical URL, domain | Embedded iframe or direct safe link | Operates within fair-use analytical reference; preserves original attribution | `AVAILABLE` (Immediate) |
| **Manual User Observation** | Structured Form Import | US & any market | Web UI Form | Authenticated user | Internal DB writes | Product URL, advertiser, ad copy, price, metrics | User provided URL / safe embed | Tagged as `OBSERVED` with full user audit trail | `AVAILABLE` (Immediate) |
| **Shopify Storefront Inspection** | Safe Public HTTP probe (`/products.json`, meta tags) | Global ecommerce stores | Public HTTP | None | Non-abusive backoff | Store name, platform confirmation, product title, prices, variants | N/A (Commerce metadata) | Strictly public storefront metadata; respect robots.txt & SSRF boundaries | `AVAILABLE` (Immediate) |

---

## 2. Hard Platform Constraints & Truthfulness Rules

1. **No Fake Metrics**: If Meta Ad Library does not disclose private click counts or exact dollar spend for non-political ads, SWAI flags those metrics as `UNAVAILABLE`.
2. **Attribution Integrity**: Every ad card displays the direct permalink back to the Meta Ad Library snapshot or TikTok Creative Center.
3. **SSRF Guard**: External URLs are checked against private IP ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, etc.) before any server-side fetching is attempted.
4. **Media Policy**: Video media is rendered using official authorized embeds, accessible direct CDN streams when legally licensed, or transparent external redirects to the original platform.
