# SWAI Versioned REST API Specification (v1)

## Base Path: `/api/v1`

All responses follow a predictable JSON envelope:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-10-19T10:00:00Z",
    "version": "v1"
  }
}
```

Error responses:
```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Detailed error message",
    "details": [ ... ]
  }
}
```

---

## 1. Provider Management & System Health
- **`GET /api/v1/health`**
  - Returns: System status, database connection, operating mode (`RESEARCH_ONLY`), active providers.
- **`GET /api/v1/providers`**
  - Returns: Registered provider adapters and connection states (`AVAILABLE`, `CONNECTED`, `REQUIRES_AUTH`, `UNSUPPORTED_REGION`).
- **`GET /api/v1/providers/capabilities`**
  - Returns: Capability matrix, supported regions (US priority), supported rate limits.

---

## 2. Competitor Ads Explorer
- **`GET /api/v1/ads`**
  - Query Params: `query`, `platform`, `category`, `market` (default `US`), `minScore`, `status`, `page`, `pageSize`, `sortBy` (`newest`, `score`, `longevity`, `variants`).
  - Returns: Paginated list of competitor ads with media assets, advertiser info, score breakdown, and data reliability tags.
- **`POST /api/v1/ads/import`**
  - Body: `{ urls: string[], source: "USER_IMPORT" | "META_URL" | "TIKTOK_URL", metadata?: object }`
  - Returns: Ingestion job result, parsed ad models, and deduplication status.
- **`GET /api/v1/ads/:id`**
  - Returns: Complete ad details, video media player metadata, landing page info, observation history, and linked products.
- **`GET /api/v1/ads/:id/observations`**
  - Returns: Historical activity timeline, detected active date ranges, and metric observations.

---

## 3. Winning Product Finder
- **`GET /api/v1/products`**
  - Query Params: `category`, `search`, `commercePlatform`, `minPrice`, `maxPrice`, `page`, `pageSize`.
  - Returns: Paginated products with associated competitor ads count, observed price ranges, and store platform.
- **`GET /api/v1/products/:id`**
  - Returns: Product details, price history chart data, store profile, and all associated competitor video ads.
- **`POST /api/v1/products/group-ads`**
  - Body: `{ adIds: string[] }`
  - Returns: Semantic grouping result linking ads to existing or newly created research products.

---

## 4. AI Creative Analyzer & Scoring
- **`POST /api/v1/ads/:id/analyze`**
  - Triggers or retrieves structured AI creative analysis (Hook classification, pacing breakdown, value propositions, original script ideas).
- **`POST /api/v1/research-scores/recompute`**
  - Recalculates Winning Potential Score across stored ads using latest observation data.

---

## 5. Watchlists, Notes & Exports
- **`GET /api/v1/watchlists`** & **`POST /api/v1/watchlists`**
  - Manage research watchlists and saved competitor collections.
- **`POST /api/v1/watchlists/:id/items`** & **`DELETE /api/v1/watchlists/:id/items/:itemId`**
  - Save/remove ads or products in watchlists.
- **`POST /api/v1/reports/export`**
  - Body: `{ format: "csv" | "json", entityType: "ads" | "products" | "watchlist", filters?: object }`
  - Returns: Raw data stream or downloadable research report with full source attribution.

---

## 6. Settings & Future Integrations
- **`GET /api/v1/settings/integrations`**
  - Returns current connection statuses for Shopify (`NOT_CONNECTED`), Meta Ads Manager (`NOT_CONNECTED`), and TikTok Ads Manager (`NOT_CONNECTED`).
