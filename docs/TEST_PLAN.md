# SWAI Comprehensive Test Plan & Verification Strategy

## 1. Testing Layers

### Unit Testing (Vitest)
- **URL Resolvers**: Test Meta Ad Library, TikTok Creative Center, TikTok video permalinks, and invalid formats.
- **SSRF Guard**: Test malicious localhost, cloud metadata (`169.254.169.254`), private CIDR IPs, and valid public URLs.
- **Scoring Engine**: Test formula normalization, missing metric handling, confidence weighting, and score edge cases.
- **Platform Detector**: Test Shopify store detection rules (CDN scripts, Shopify object cues, custom domains).
- **Future Shopify Services**: Test financial math contracts with isolated test fixtures.

### Integration Testing (Service & Database)
- **Provider Adapters**: Verify capability detection, configuration validation, and error envelopes.
- **Ad Repository**: Test upsert idempotency, observation logging, and product-ad linkage.
- **Watchlists & Notes**: Test persistence, deletion, and tag operations.

### Browser & End-to-End Verification
- **Navigation & Layout**: Dark theme, sidebar navigation, responsive breakpoints.
- **Explorer Flow**: Search, filter by US market and category, open detail drawer, play real video / view official fallback.
- **Product Flow**: View grouped products, price history observations, store profiles.
- **Settings State**: Verify honest disconnected status for Shopify, Meta Ads, and TikTok Ads.
