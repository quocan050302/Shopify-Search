# SWAI V9 — Provider Verification & Feasibility Proof
## Live Probe Results, Upstream Schema Analysis & Policy Constraints

**Author:** Antigravity AI Engineering Team  
**Date:** October 20, 2026  
**Target:** TikTok Commercial Ads Intelligence for the United States Market  

---

### 1. Live Source Connectivity Probe

During V9 baseline verification, an automated live probe was executed against TikTok Creative Center's internal endpoint:

```http
GET https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list?page=1&limit=5&period=30&region=US HTTP/1.1
Host: ads.tiktok.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: application/json
```

#### Upstream Raw Response:
```json
{
  "code": 40101,
  "msg": "no permission"
}
```

#### Finding & Analysis:
1. **Endpoint Exists**: The endpoint is active and responds with JSON rather than a 404.
2. **Anti-Bot WAF & Session Authentication**: TikTok Creative Center enforces strict session validation (`code: 40101, "no permission"`). Direct HTTP requests without an authorized session cookie (`TIKTOK_CC_COOKIE`) are blocked by TikTok's web application firewall.
3. **No Circumvention Rule Compliance**: In strict compliance with non-negotiable Rules 5, 7, and 8:
   - SWAI refuses to deploy headless CAPTCHA bypassing, spoofed browser fingerprints, or rotating proxy pools to evade authentication.
   - The provider status is honestly reported as `REQUIRES_AUTH` or `BLOCKED_SOURCE`.
   - The engine never fabricates mock advertisement records when the live endpoint is blocked.

---

### 2. External GitHub Repository Audit & Findings

Four open-source reference implementations were audited to assess whether a legitimate, free, unauthenticated machine API exists:

#### A. `andrei0182/tiktok-market-scout`
- **Source:** Python CLI (`src/fetch.py`, `src/analyze.py`)
- **Finding:** The author explicitly noted in `README.md` that live external collection was not verified against TikTok's live production WAF during development. Real-world execution fails with standard TikTok bot mitigation blocks.
- **Verdict:** Unverified for production. Architecture concepts reviewed; code not reusable without authentication.

#### B. `lofe-w/tiktok-creative-center-scraper-public`
- **Source:** Apify Actor wrapper
- **Finding:** The repository contains documentation and input schema schemas, but its core execution runtime requires an active Apify Actor subscription. It is not an independent, self-hosted free scraper.
- **Verdict:** Paid/metered dependency. Reusable only as an optional secondary provider when authorized by the user.

#### C. `assa83/tiktok-top-ads-api`
- **Source:** TypeScript / Python client for Apify Actor
- **Finding:** Merely a client SDK invoking Apify Actor `apify/tiktok-ads-scraper`. Consumes paid Apify compute credits.
- **Verdict:** Paid metered service. Integrated into SWAI as `ApifyTopAdsProvider` (disabled by default under zero-cost policy).

#### D. `bluzername/tiktok-top-products`
- **Source:** Next.js application for TikTok Shop top products
- **Finding:** Demonstrated effective in-memory and SQLite caching models, query normalization, and error boundary handling.
- **Verdict:** Architecture patterns (deduplication, normalization) adopted into SWAI V9.

---

### 3. Provider Capabilities Comparison

| Dimension | TikTok Creative Center (Direct) | Apify Top Ads Actor | TikTok Commercial Content API (Official) |
| :--- | :--- | :--- | :--- |
| **Provider ID** | `tiktok-topads` | `apify-topads` | `tiktok-commercial-content-api` |
| **Provider Type** | Direct Session Interface | Metered Cloud Actor | Official Developer API |
| **Supports US** | **Yes** (`region=US`) | **Yes** (`countryCode: "US"`) | **No** (EU DSA regions only) |
| **Keyword Filtering** | Yes | Yes | Limited |
| **Industry Filtering** | Yes | Yes | Limited |
| **Cost Per Request** | **$0.00 (Free)** | ~$0.05 / page | Free (within quota) |
| **Default State** | **Enabled (Ready)** | **Disabled (Zero-Cost)** | **Region Unsupported** |
| **Authentication** | `TIKTOK_CC_COOKIE` | `APIFY_TOKEN` | App Key & Secret |
| **Embed Support** | Restricted (`isEmbeddable: false`) | Restricted (`isEmbeddable: false`) | Direct CDN URL (EU only) |
| **Current Live Status** | `REQUIRES_AUTH` | `PAID_DISABLED` | `REGION_UNSUPPORTED` |

---

### 4. Conclusion & Production Recommendation

- **Free-First Operational Mode:** SWAI V9 operates with zero unauthorized API calls. Users who provide their own browser session cookie via `TIKTOK_CC_COOKIE` in `.env.local` can run direct queries with zero credit cost.
- **Honest Fallback:** If `TIKTOK_CC_COOKIE` is absent, SWAI clearly indicates `REQUIRES_AUTH` in the UI and CLI doctor, and provides immediate single-click navigation to manual URL research via "Open TikTok Top Ads (US)".
- **Metered Alternative:** If the user explicitly opts into Apify and sets `ENABLE_APIFY_DISCOVERY=true` with a valid token and credit budget, `ApifyTopAdsProvider` executes seamlessly through the same normalization and transactional pipeline.
