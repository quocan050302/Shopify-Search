# SWAI Domain Model & Data Schema Specification

## 1. Domain Entities & Relationships

### Core Competitor Research
- **`Advertiser`**: The brand, page, or merchant running campaigns. Identified by platform ID (`meta_page_id`, `tiktok_advertiser_id`) or handle.
- **`CompetitorAd`**: A unique observed advertisement creative. Contains headline, primary text, target link, original platform URL, discovery timestamp, and research score.
- **`AdMediaAsset`**: The video or image asset metadata associated with an ad (aspect ratio, duration, resolution, embed URL, thumbnail URL, availability status).
- **`AdObservation`**: A chronological timestamped record of an ad being seen active or modified over time.
- **`AdMetricObservation`**: Specific metric points (e.g. impressions range, likes, days running) tagged with data classification (`VERIFIED`, `OBSERVED`, `ESTIMATED`, `UNAVAILABLE`).

### Product Research & Commerce Linkage
- **`ResearchProduct`**: A normalized product detected from competitor ads or landing pages.
- **`CompetitorStore`**: The merchant domain hosting the landing page (e.g., `brandname.com`), with detected commerce platform (`SHOPIFY_CONFIRMED`, `SHOPIFY_POSSIBLE`, `OTHER`, `UNKNOWN`).
- **`ProductListing`**: Specific listing or variant on a store, with tracked price observations over time.
- **`AdProductLink`**: Many-to-many relationship linking competitor ads to specific products, with confidence level (`CONFIRMED`, `HIGH_CONFIDENCE`, `PROBABLE`).

### AI Intelligence & Scoring
- **`CreativeAnalysis`**: Structured AI inspection of the video creative (Hook type, pacing, value propositions, emotional trigger, call-to-action classification, weaknesses, suggested script/concept).
- **`ResearchScore`**: The Winning Potential Score (0–100) calculated from longevity, creative variants, active recency, performance signals, and AI assessment. Includes formula version and component breakdown.

### Watchlists & Collaboration
- **`Watchlist`**: User-curated research collections (e.g., "Trending Kitchen Gadgets Q4").
- **`WatchlistItem`**: Polymorphic reference to an ad or a product saved in a watchlist.
- **`ResearchNote`**: User notes, priority tags, and hypothesis tracking.
- **`SavedSearch`**: Saved filter presets for continuous category scanning.

### Future Commerce (Ready but Inactive)
- **`ConnectedShop`**: Shopify store connection metadata, status (`NOT_CONNECTED`), access scopes.
- **`AdvertisingAccount`**: Owned Meta/TikTok ad account integration metadata, status (`NOT_CONNECTED`).
- **`DailyAdPerformance`**: User's owned ad spend and attributed sales.
