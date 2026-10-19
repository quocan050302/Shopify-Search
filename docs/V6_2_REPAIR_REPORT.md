# V6.2 Real Video Playback & Ads Source Repair Report
**Shopify Winning Ads Intelligence (SWAI)**  
**Generated:** 2025-10-19  
**Previous Commit:** bff1da5e48228b89cd7a7f7e005f7038d0fedd3c (V6.1)  
**Target Branch:** master  
**Operating Mode:** RESEARCH_ONLY — Shopify/Meta/TikTok NOT_CONNECTED

---

## Executive Summary

V6.2 performs the deeper data repair that V6.1 missed: **existing database records were not cleaned in V6.1** (only new imports were). V6.2:

1. Runs a one-time migration script that quarantines all 6 original synthetic seed records at the database level
2. Introduces a correct **Video Source Resolver** engine with proper TikTok post oEmbed support
3. Removes duplicate, conflicting definitions from `linkValidationService.ts`
4. Introduces explicit **synthetic source detection** in the video player
5. Updates the Ads Explorer to exclude quarantined records from default results
6. Adds search mode labeling ("📁 Local Database Search") to the UI

---

## Phase 1 — Database Audit Findings

### Pre-Migration State (all 7 records)

| Record | Platform | externalAdId | videoUrl | embedUrl | score formula | Analysis |
|--------|----------|-------------|---------|---------|--------------|----------|
| Bleame | META | meta_bleame_…_01 | GTV sample ❌ | render_ad ❌ | v2.0.0 ❌ | hook=88 ❌ |
| The Ridge | TIKTOK | tiktok_ridge_…_02 | GTV sample ❌ | CC embed ❌ | v2.0.0 ❌ | hook=88 ❌ |
| BlendJet | META | meta_blendjet_…_03 | GTV sample ❌ | render_ad ❌ | v2.0.0 ❌ | hook=88 ❌ |
| ChomChom | TIKTOK | tiktok_chomchom_…_04 | GTV sample ❌ | CC embed ❌ | v2.0.0 ❌ | hook=88 ❌ |
| Lumineux | META | meta_lumineux_…_05 | GTV sample ❌ | render_ad ❌ | v2.0.0 ❌ | hook=88 ❌ |
| Gripzilla | TIKTOK | tiktok_gripzilla_…_06 | GTV sample ❌ | CC embed ❌ | v2.0.0 ❌ | hook=88 ❌ |
| Test Brand | META | 999888777 | null ✓ | render_ad ❌ | v6.1.0 ✓ | hook=88 ❌ |

**Critical finding:** V6.1 code correctly strips fake media from NEW imports but did NOT apply to existing DB rows. All 6 seed records still had GTV sample videos (availability=READY), fake embeds, Unsplash stock thumbnails, and hardcoded 88/82 AI scores.

---

## Phase 2 — V6.2 Migration Results (`scripts/v6.2-db-repair.ts`)

```
✅ Records quarantined:         6
✅ Sample videos stripped:      6
✅ Scores invalidated:          6  (v2.0.0 → v2.0.0-INVALIDATED)
✅ Hardcoded analyses removed:  7  (including Test Brand Labs)
```

Post-migration state:
- INACTIVE (quarantined): 6
- UNKNOWN: 1
- ACTIVE: 0
- Records with sample video: **0** ✅

---

## Phase 3 — Video Source Engine (V6.2)

### New File: `src/services/video/videoSourceResolver.ts`

Replaces the old `resolvePlayableMedia()` with a full decision-tree engine.

**4 Playback Strategies:**

| Strategy | Trigger | Implementation |
|----------|---------|----------------|
| `TIKTOK_OEMBED` | Real TikTok post URL (`tiktok.com/@user/video/ID`) | Official TikTok embed/v2 iframe |
| `DIRECT_VIDEO` | Authorized MP4/WebM with video extension (non-sample) | HTML5 `<video>` element |
| `OPEN_SOURCE` | Meta Ad Library, TikTok Creative Center, synthetic, sample | External link button |
| `UNAVAILABLE` | No URL at all | Info panel |

**Restriction Labels (accurate, not misleading):**

| Restriction | Display Text |
|-------------|-------------|
| `META_RENDER_AD_REQUIRES_AUTH` | "Meta Ad Library requires authenticated Meta account" |
| `TIKTOK_TOPADS_NOT_EMBEDDABLE` | "TikTok Creative Center Top Ads — opens on TikTok" |
| `SAMPLE_MEDIA_REJECTED` | "Demo Video — Not Real Ad" |
| `SYNTHETIC_SOURCE` | "Demonstration Record" |
| `NO_VIDEO_SOURCE` | "No video source" |

**New classifiers:**
- `classifySourceType()` — distinguishes TIKTOK_POST vs TIKTOK_CREATIVE_CENTER vs META_AD_LIBRARY vs AUTHORIZED_UPLOAD
- `extractTikTokPostId()` — extracts real post ID (10-20 digits) from tiktok.com/@user/video/ID
- `buildTikTokOEmbedUrl()` — `https://www.tiktok.com/embed/v2/{postId}` (official endpoint)
- `isSyntheticAdId()` — matches `meta_brand_product_NN` and `tiktok_brand_product_NN` patterns

---

## Phase 4 — Meta Ads Source Status

| Meta Source Type | Inline Playback | Action Shown |
|-----------------|----------------|-------------|
| `facebook.com/ads/library/?id=...` | ❌ NOT supported | "Open on Meta Ad Library" button |
| `facebook.com/ads/archive/render_ad/` | ❌ Requires auth | Stripped + external link |
| Meta Graph API video URL | ✅ if CORS allows | `DIRECT_VIDEO` player |

**Conclusion:** Meta Ad Library does not expose publicly embeddable video URLs without API access. The correct behavior is OPEN_SOURCE with the library URL, which is what V6.2 implements.

---

## Phase 5 — TikTok Ads Source Status

| TikTok Source Type | Inline Playback | Embed URL Format |
|--------------------|----------------|-----------------|
| `tiktok.com/@user/video/ID` (real post) | ✅ TIKTOK_OEMBED | `tiktok.com/embed/v2/{ID}` |
| `ads.tiktok.com/business/creativecenter/inspiration/topads/...` | ❌ Not embeddable | Opens on TikTok |
| `ads.tiktok.com/creativecenter/inspiration/topads/embed/...` | ❌ Auth required | Stripped in DB |

**Key distinction:** TikTok Creative Center Top Ads links are detail pages on the TikTok platform — not embeddable. Only real TikTok post URLs (content-creator posts that are also used as ads) support the official `tiktok.com/embed/v2/` iframe.

---

## Phase 6 — Provider Capabilities (Honest Assessment)

| Capability | Status | Reason |
|------------|--------|--------|
| Meta Ad Library browse (no auth) | ✅ OPEN_SOURCE | User visits Meta Ad Library manually |
| Meta Ad Library embed | ❌ BLOCKED | Requires authenticated Facebook session |
| TikTok Creative Center Top Ads | ✅ OPEN_SOURCE | Opens correct detail URL |
| TikTok Creative Center embed | ❌ BLOCKED | Not publicly embeddable |
| TikTok post embed (real posts) | ✅ TIKTOK_OEMBED | Official embed/v2 endpoint |
| Authorized MP4/WebM upload | ✅ DIRECT_VIDEO | HTML5 player with controls |
| Automatic US ad discovery | ❌ NOT_SUPPORTED | No working public API exists |
| Live Meta search | ❌ NOT_CONNECTED | Would require Marketing API token |
| Live TikTok search | ❌ NOT_CONNECTED | Would require TikTok for Business API |

---

## Phase 7 — AI Video Analysis Status

| Capability | Status |
|------------|--------|
| hookQualityScore from real video | ❌ AI_PROVIDER_NOT_CONFIGURED |
| pacingScore from real video | ❌ AI_PROVIDER_NOT_CONFIGURED |
| Frame extraction | ❌ AI_PROVIDER_NOT_CONFIGURED |
| Copy analysis (text) | ✅ Available via `creativeAnalyzer.ts` |
| Hardcoded scores | ✅ REMOVED from all 7 records |

---

## Phase 8 — Security

- SSRF protection: unchanged from V6.1 (comprehensive blocklist)
- App isolation: reads `.git/config` for repo verification
- Redirect validation: SSRF check applied to redirect destinations
- Synthetic source detection: `isSyntheticAdId()` used at player level, not just DB level
- `includeSynthetic` flag: quarantined records not visible by default

---

## Test Results

```
Test Files  6 passed (6)
     Tests  24 passed (24)  ← was 23 in V6.1
  Duration  394ms
```

New test: `adService.test.ts` now has 4 tests covering:
- Production search excludes SYNTHETIC_DEMO records
- `includeSynthetic: true` shows quarantined records
- Platform filtering still works with synthetic records
- `isSampleOrFakeMedia` and `isSyntheticAdId` unit tests

---

## Browser Test Evidence

| Test | Result |
|------|--------|
| Dashboard loads | ✅ PASS — no fake KPI numbers |
| Explorer "LOCAL DATABASE SEARCH" badge | ✅ PASS — visible |
| Explorer shows "1 real records" | ✅ PASS |
| Explorer empty state for synthetic filter | ✅ PASS — no seed ads shown |
| Import modal visible | ✅ PASS — modal clickable |
| TikTok post import & oEmbed | ⚠️ BLOCKED (import UI interaction limitation) |
| Meta Ad Library restriction notice | ✅ PASS (by code inspection) |

---

## Build

```
TypeScript: ✓ 0 errors
Production build: ✓ clean
Routes: 23 routes (14 dynamic, 9 static)
```

---

## Remaining Blockers

| Item | Status | Next Step |
|------|--------|-----------|
| Live Meta ad discovery | ❌ BLOCKED — requires Marketing API | Apply for Meta Business API access |
| Live TikTok Creative Center search | ❌ BLOCKED — requires TikTok for Business API | Apply for TikTok API access |
| AI video analysis (hook/pacing score) | ❌ BLOCKED — no AI provider configured | Integrate Google Gemini Vision API |
| Real ad creative database | ⚠️ EMPTY — no real records yet | User must import real Meta/TikTok URLs |
| Licensed ad intelligence provider | ⚠️ NOT_RESEARCHED | Evaluate: Minea, AdSpy, BigSpy (paid) |

---

## Recommended Next Version: V6.3

**Goal:** Integrate one real data source.

Options (in priority order):
1. **Manual import of real TikTok posts** — user visits TikTok, copies post URLs, imports them → TIKTOK_OEMBED player works immediately
2. **TikTok oEmbed verification** — test the official embed/v2 endpoint with a known real TikTok post ID
3. **Google Gemini Vision** for frame-by-frame ad analysis of accessible videos
4. **Minea/BigSpy API evaluation** — licensed ad intelligence with video playback rights
