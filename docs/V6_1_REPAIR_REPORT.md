# V6.1 Full System Repair Report
**Shopify Winning Ads Intelligence (SWAI)**  
**Generated:** 2025-10-19  
**Reviewer:** Principal Full-Stack Engineer (Antigravity SWAI V6.1)  
**Baseline Commit:** 9c187e7995c870aaae1ed83fe9d0ea5d64a30136  
**Target Branch:** master

---

## Executive Summary

V6.1 is a full-system evidence-integrity repair. Every change removes fabricated data, hardcoded scores, non-functional embed URLs, and status misrepresentations. No features were degraded. All 23 existing tests pass. Build succeeds clean.

---

## Issues Fixed

### CRITICAL: Fake Video Sources
| Field | Before | After |
|-------|--------|-------|
| `media.videoUrl` (seed) | Google GTV sample MP4 (commondatastorage.googleapis.com) | Stripped at upsert — `null`, availability=`FALLBACK_ONLY` |
| `media.embedUrl` Meta | `facebook.com/ads/archive/render_ad/?id=...` (auth required) | Stripped at upsert — `null` |
| `media.embedUrl` TikTok | `ads.tiktok.com/…/topads/embed/…` (not public) | Stripped at upsert — `null` |
| `media.thumbnailUrl` | Unsplash stock photos | Stripped at upsert — `null` |

**Player behavior change:**  
- Direct video → HTML5 player (real URLs only)  
- Meta/TikTok sources → "Opens on Meta / Opens on TikTok" button with external link  
- Sample video → Warning banner + "Open Original Source" button  
- Stock thumbnail → Generic placeholder with "No verified thumbnail"

### CRITICAL: Hardcoded AI Scores
| Before | After |
|--------|-------|
| `hookQualityScore = 88` always | `null` — not available without real video |
| `pacingScore = 82` always | `null` — not available without real video |
| Weakness: "audio compression artifacts detected" (fabricated) | "Video creative was NOT analyzed — no pacing assessment available" |

### CRITICAL: Fabricated Scoring Defaults
| Component | Before | After |
|-----------|--------|-------|
| AI Quality | `65` hardcoded default | No score stored unless real AI analysis is performed |
| Performance (ACTIVE status) | Full points for having ACTIVE status | `0` unless genuine platform metrics exist |
| Missing data | Assigned conservative defaults | Tracked in `missingSignals[]`, weight redistributed |

### HIGH: Data Status Misrepresentation
| Field | Before | After |
|-------|--------|-------|
| `status` (import) | Defaults to `ACTIVE` | `UNKNOWN` unless source confirms |
| `targetMarket` (import) | Defaults to `US` | `UNKNOWN` unless explicitly set |
| `advertiserName` (import) | Defaults to `"Independent Merchant"` | `UNKNOWN` |
| `dataConfidence` (import) | `OBSERVED` | `UNVERIFIED` until manual confirmation |
| KPI card "Active Longevity Ads" | Hardcoded `6` | Real count from DB |
| KPI card "Winning Potential" | Hardcoded `88, "Bleame Hair Eraser"` | Calculated average from real scores |

### HIGH: Storefront 404 / Invalid Links
- Added "Not verified — may return 404" label below all storefront links
- Added separate "Visit Store Homepage" fallback button
- Products page: product URLs sourced from seed data are clearly marked as unverified
- `Visit Storefront` link no longer displayed for products with no URL

### HIGH: Watchlist Persistence Bug
- Removed hardcoded `watchlistId: "default-watchlist"` — the ID doesn't exist in DB
- Fixed: Dashboard now fetches real watchlist IDs before adding items
- Fixed: Creates watchlist automatically if none exists
- Fixed: API validates watchlistId exists before insert (returns 404 if not found)
- Added: DELETE `/api/v1/watchlists?itemId=xxx` for removing items

### MEDIUM: Provider Registry Capability Misrepresentation
| Before | After |
|--------|-------|
| `SEARCH_PUBLIC_ADS` capability for Meta | Removed — requires approved API token |
| `EMBED_PLAYBACK` for TikTok Creative Center | Removed — not a public embed endpoint |
| `CONNECTED` status when token is set | `REQUIRES_AUTH` — token present but unverified |

---

## New Components

### `src/services/links/linkValidationService.ts`
- `validateResearchUrl()` — SSRF-safe URL validation
- `checkExternalLink()` — HEAD/GET HTTP verification with timeout and redirect checks
- `resolvePlayableMedia()` — determines correct playback strategy per ad
- `isSampleOrFakeMedia()` — detects Google GTV demo videos
- `isStockImage()` — detects Unsplash/Pexels stock photos

### `/api/v1/links/validate` (GET/POST)
- GET: validates URL structure + SSRF safety (no network request)
- POST: batch HEAD verification for up to 10 URLs

### `/api/v1/audit/integrity` (GET)
- Read-only audit of all DB records
- Reports: sample media, stock thumbnails, invalid embeds, unverified status, unknown advertisers, missing sources

---

## Security Improvements
- SSRF protection: expanded to include CGNAT (100.64.0.0/10), ECS task metadata, IPv6 unique-local, `.internal` / `.local` domains
- App isolation: reads actual `.git/config` file to verify `remote.origin.url` matches `https://github.com/quocan050302/Shopify-Search`
- Dynamic `require()` for Node.js APIs in `verifyApplicationIsolation()` to prevent client-bundle contamination

---

## Test Results
```
Test Files  6 passed (6)
     Tests  23 passed (23)
  Duration  334ms
```

## Build Result
```
Next.js production build: ✓ Success
TypeScript type check:    ✓ No errors
Routes compiled:          23 routes (14 dynamic, 9 static)
```
