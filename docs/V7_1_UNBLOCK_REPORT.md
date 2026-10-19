# SWAI V7.1 — Real Data Unblocking & Video AI Integration Report

**Date:** 2026-10-19
**Commit:** (see git log — pushed to master after this report)
**Version:** V7.1
**Mode:** RESEARCH_ONLY — preserved

---

## Executive Summary

V7.1 addresses the three primary blockers preventing SWAI from using real advertisement
data and analyzing actual video creatives:

1. **TikTok embed:** Implemented official `player/v1` embed with oEmbed verification
2. **Video upload:** Authorized MP4/WebM upload with magic-byte validation and persistent storage
3. **Gemini AI:** Integrated real video analysis adapter; correctly reports unconfigured/unavailable status

No fabricated ads, scores, analyses, or provider responses were created.

---

## A. PROVIDER FEASIBILITY REPORT

### Search Mode Separation

| Mode | Status | Notes |
|------|--------|-------|
| `LOCAL_SEARCH` | ✅ AVAILABLE | Searches local SQLite research database |
| `MANUAL_IMPORT` | ✅ AVAILABLE | Paste any Meta/TikTok URL into Import modal |
| `CONNECTED_PROVIDER_SEARCH` | ⚠ PARTIALLY_BLOCKED | Requires API credentials for most providers |

### Provider Assessment

#### Meta Ad Library

| Capability | Status |
|-----------|--------|
| Manual URL import | ✅ IMPLEMENTED & WORKING |
| Automated search API | ⚠ REQUIRES_AUTH — `META_AD_LIBRARY_ACCESS_TOKEN` not set |
| Video playback inline | ❌ BLOCKED — `render_ad` requires authenticated Meta session |
| Open source link | ✅ AVAILABLE |

**Why automated search is unavailable:**
Meta's Ad Library API (`ad_archive` permission) requires business verification and a
separately approved developer app — not a standard developer token. Setting a token
does not automatically grant `ad_archive` access.

**Credential setup required:**
1. Create Meta Developer App at developers.facebook.com
2. Request `ad_archive` permission (business verification required)
3. Generate long-lived token
4. Set `META_AD_LIBRARY_ACCESS_TOKEN` in `.env.local`

#### TikTok Creative Center

| Capability | Status |
|-----------|--------|
| Browse Top Ads | ✅ AVAILABLE (external browser) |
| Manual URL import | ✅ AVAILABLE |
| Video playback inline | ❌ BLOCKED — Creative Center links are NOT embeddable |
| Automated Top Ads search API | ❌ BLOCKED — No public API exists |

> [!IMPORTANT]
> TikTok Creative Center `id` URL params are **material IDs**, not TikTok post video IDs.
> They cannot be embedded. To get an embeddable video, find the underlying TikTok post URL
> (`tiktok.com/@username/video/ID`).

#### TikTok Post oEmbed — **NEW IN V7.1**

| Capability | Status |
|-----------|--------|
| Post existence validation | ✅ IMPLEMENTED — via TikTok oEmbed API |
| Inline video embed | ✅ IMPLEMENTED — via `player/v1/{postId}` |
| Post ID extraction | ✅ IMPLEMENTED — 10–30 digit numeric IDs from path |
| Creative Center URL rejection | ✅ IMPLEMENTED — clear error message |
| Short URL (vm.tiktok.com) handling | ✅ IMPLEMENTED — explains redirect requirement |
| Removed/private post handling | ✅ IMPLEMENTED — returns `POST_NOT_FOUND` / `ACCESS_RESTRICTED` |

**Embed endpoint used:**
```
https://www.tiktok.com/player/v1/{postId}?autoplay=0&controls=1&loop=0&rel=0
```
This is the official documented endpoint (not the deprecated `/embed/v2/`).

**oEmbed validation endpoint:**
```
https://www.tiktok.com/oembed?url=https://www.tiktok.com/@user/video/{id}
```

#### TikTok Commercial Content API (EU DSA)

| Status | Notes |
|--------|-------|
| ❌ NOT APPLICABLE | EU region only — no US commercial ad data |

Do not confuse this with competitor US ad discovery.

#### Captapi (Candidate Third-Party Provider)

| Evaluation Item | Status |
|----------------|--------|
| US commercial ad coverage | ⚠ NOT_VERIFIED — requires API key test |
| Commercial ad metadata | ⚠ NOT_VERIFIED |
| Actual creative URLs | ⚠ NOT_VERIFIED |
| Run date accuracy | ⚠ NOT_VERIFIED |
| Playback rights | ⚠ NOT_VERIFIED — check ToS |
| API pricing | Not evaluated |
| Rate limits | Not evaluated |

**SWAI adapter status:** IMPLEMENTED — live verification blocked until credentials provided.
Set `CAPTAPI_KEY` in `.env.local` to enable. Reported in `/api/v1/providers/feasibility`.

---

## B. TIKTOK EMBED — IMPLEMENTED

### New File: `src/services/video/tiktokEmbedService.ts`

Functions:
- `extractTikTokPostIdFromUrl(url)` — classifies URL type, extracts numeric post ID
- `buildTikTokPlayerUrl(postId, options)` — builds `player/v1` URL with query params
- `getTikTokEmbedMetadata(postUrl)` — validates post existence via oEmbed API
- `resolveTikTokPlayerSource(url, options)` — full pipeline: classify → validate → resolve

### Updated: `src/services/video/videoSourceResolver.ts`

- `buildTikTokOEmbedUrl()` updated from deprecated `/embed/v2/` to `/player/v1/`

### Blocking Cases Handled

| Case | Result |
|------|--------|
| Creative Center URL | `OPEN_SOURCE` + `CREATIVE_CENTER_NOT_EMBEDDABLE` |
| Short URL (vm.tiktok.com) | `OPEN_SOURCE` + `SHORT_URL_REQUIRES_RESOLUTION` |
| Removed post (404) | `UNAVAILABLE` + `POST_REMOVED_OR_UNAVAILABLE` |
| Private/restricted post | `OPEN_SOURCE` + `POST_ACCESS_RESTRICTED` |
| oEmbed network timeout | `TIKTOK_OEMBED` with warning (attempt embed, flag unconfirmed) |
| Real post URL | `TIKTOK_OEMBED` + verified `player/v1` URL |

---

## C. VIDEO UPLOAD — IMPLEMENTED

### New Route: `POST /api/v1/media/upload`

**File:** `src/app/api/v1/media/upload/route.ts`

| Feature | Status |
|---------|--------|
| MP4 support | ✅ — `ftyp` magic byte validation |
| WebM support | ✅ — `EBML` header validation |
| Magic byte validation | ✅ — not trusting client `Content-Type` |
| UUID-based filenames | ✅ — no user-controlled paths |
| Path traversal protection | ✅ — `..` stripped before char whitelist |
| Shell injection protection | ✅ — only `[a-zA-Z0-9\-_.]` allowed |
| Configurable size limit | ✅ — `MAX_UPLOAD_SIZE_MB` env var (default 100MB) |
| Persistent storage | ✅ — `/public/uploads/` (survives restart) |
| HTML5 playback URL | ✅ — `/uploads/{uuid}.mp4` |

> [!NOTE]
> `/public/uploads/` is appropriate for local research use. For production deployment,
> replace with cloud object storage (AWS S3, Google Cloud Storage, etc.).

Functions exported for testing:
- `validateVideoMagicBytes(buffer)` — returns detected format + MIME type
- `getAuthorizedVideoPlaybackUrl(filename)` — sanitizes and returns public path

---

## D. AI ANALYSIS — IMPLEMENTED

### New File: `src/services/ai/geminiAdapter.ts`

**SDK:** `@google/generative-ai@0.24.1`
**Model:** `gemini-1.5-flash` (flash for speed; configurable to `gemini-1.5-pro`)

| Function | Description |
|---------|-------------|
| `validateGeminiConfiguration()` | Reports config status without live API call |
| `validateVideoForGeminiAnalysis(url)` | Checks if URL is Gemini-eligible |
| `analyzeVideoWithGemini(url, context)` | Full creative analysis with provenance |
| `analyzeOpeningHook(url, adCopy)` | Hook-focused analysis with timestamp |
| `extractCreativeSellingAngles(url)` | Angle extraction with delivery method |
| `classifyEvergreenCreative(url)` | EVERGREEN / TREND_DRIVEN classification |

### Analysis States (Accurate, Never Fabricated)

| State | Meaning |
|-------|---------|
| `COMPLETE` | Gemini returned parseable analysis |
| `AI_PROVIDER_NOT_CONFIGURED` | `GEMINI_API_KEY` not set in server env |
| `MEDIA_UNAVAILABLE` | No accessible, Gemini-eligible video URL |
| `ANALYSIS_FAILED` | API call succeeded but response unparseable or error |

### All Analysis Results Include

- `modelId` — exact Gemini model string used
- `promptVersion` — `v2.0.0` (increment when prompts change)
- `sourceVideoReference` — URL of analyzed video
- `analysisTimestamp` — ISO 8601
- `confidence` — HIGH / MEDIUM / LOW / NONE
- `confidenceNote` — why confidence is at that level
- `limitations` — blocking factors

> [!IMPORTANT]
> `GEMINI_API_KEY` is server-side only. Never expose to the browser. Never commit to git.

**Credential setup:**
1. Generate key at aistudio.google.com
2. Add to `.env.local`: `GEMINI_API_KEY=your-key`
3. Restart dev server

### Updated: `/api/v1/ads/[id]/analyze`

Now attempts Gemini video analysis when:
- `GEMINI_API_KEY` is configured AND
- An accessible video URL exists (direct MP4 or TikTok post URL)

Falls back to copy-only analysis in all other cases. Reports `analysisMode` clearly:
- `GEMINI_VIDEO_ANALYSIS` — Gemini succeeded
- `GEMINI_CONFIGURED_NO_VIDEO` — key present, no accessible video
- `GEMINI_ATTEMPTED_FAILED` — key present + video present, API failed
- `COPY_ONLY` — default, no key configured

---

## E. NEW API ROUTES

| Route | Method | Status |
|-------|--------|--------|
| `/api/v1/media/upload` | POST | ✅ NEW |
| `/api/v1/providers/feasibility` | GET | ✅ NEW |
| `/api/v1/ads/[id]/analyze` | POST | ✅ UPGRADED (Gemini integration) |

---

## F. V7 EVERGREEN — PRESERVED

No changes to V7 evergreen scoring. All principles maintained:
- Two sparse observations ≠ continuous active days
- Long-running ads do not prove profitability
- `isSyntheticQuarantine` records excluded from all rankings
- Missing data stays missing — no manufactured defaults

---

## G. TEST RESULTS

### V7.1 Tests (`tests/unit/v71.test.ts`) — 39 new tests

| Group | Tests | Status |
|-------|-------|--------|
| TikTok URL classification | 8 | ✅ All pass |
| TikTok player/v1 URL building | 3 | ✅ All pass |
| Creative Center not embeddable | 3 | ✅ All pass |
| Video magic byte validation | 7 | ✅ All pass |
| Upload URL sanitization | 4 | ✅ All pass |
| Gemini configuration detection | 5 | ✅ All pass |
| oEmbed error handling | 3 | ✅ All pass |
| Synthetic ad ID detection | 4 | ✅ All pass |
| Creative Center ID vs Post ID | 2 | ✅ All pass |

### Full Test Suite

| Metric | Result |
|--------|--------|
| Test files | 8 passed |
| Tests | **94 passed, 0 failed** |
| TypeScript errors | 0 |
| Production build | ✅ Clean |

---

## H. DELIVERY STATUS

| Item | Status | Notes |
|------|--------|-------|
| TikTok post embed (`player/v1`) | ✅ IMPLEMENTED | oEmbed validation included |
| TikTok Creative Center distinction | ✅ IMPLEMENTED | Clear error on non-embeddable URLs |
| Authorized MP4 upload | ✅ IMPLEMENTED | Magic byte validated, persistent |
| Authorized WebM upload | ✅ IMPLEMENTED | Magic byte validated, persistent |
| HTML5 playback after reload | ✅ IMPLEMENTED | Stored in `/public/uploads/` |
| Gemini adapter | ✅ IMPLEMENTED | `AI_PROVIDER_NOT_CONFIGURED` when no key |
| Gemini hook analysis | ✅ IMPLEMENTED | Returns accurate status |
| Gemini creative angles | ✅ IMPLEMENTED | Returns accurate status |
| Gemini evergreen classification | ✅ IMPLEMENTED | Returns accurate status |
| Provider feasibility report | ✅ IMPLEMENTED | `/api/v1/providers/feasibility` |
| Meta API live verification | ⚠ BLOCKED | Requires `META_AD_LIBRARY_ACCESS_TOKEN` with `ad_archive` |
| TikTok Creative Center API | ❌ NOT_APPLICABLE | No public US API exists |
| Captapi integration | ⚠ BLOCKED | Requires `CAPTAPI_KEY` |
| Gemini live analysis | ⚠ BLOCKED | Requires `GEMINI_API_KEY` |
| RESEARCH_ONLY mode | ✅ PRESERVED | |
| APP #1 | ✅ PRESERVED | Not modified |
| V7 Evergreen engine | ✅ PRESERVED | |

### Required Credentials for Full Capability

| Credential | Provider | Purpose |
|-----------|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio | AI video creative analysis |
| `META_AD_LIBRARY_ACCESS_TOKEN` | Meta Developer App | Automated Meta Ad Library search |
| `CAPTAPI_KEY` | captapi.com | Third-party ad data (if evaluated) |
| `MAX_UPLOAD_SIZE_MB` | — | Override default 100MB upload limit |

---

## I. LIVE TEST RECORDS

### TikTok Post Embed

**To test V7.1 TikTok embed:**
1. Find a real TikTok post URL (format: `tiktok.com/@username/video/ID`)
2. Import via "Import Ad URL" → paste URL
3. The ad card will show inline TikTok player via `player/v1`

**oEmbed validation:** POST `/api/v1/ads` → internally calls `resolveTikTokPlayerSource()`
with `validateViaOEmbed: true`.

### Video Upload Test

```bash
curl -X POST http://localhost:3000/api/v1/media/upload \
  -F "video=@/path/to/test.mp4" \
  -F "label=test upload"
```

Expected response includes `playbackUrl: "/uploads/{uuid}.mp4"` — playable in HTML5 video.

### Gemini Configuration Test

```
GET http://localhost:3000/api/v1/providers/feasibility
```
Returns `aiAnalysis.status: "NOT_CONFIGURED"` when key absent,
`"KEY_PRESENT_UNVERIFIED"` when key present.

---

*Report generated by SWAI V7.1. No fabricated data. All statuses reflect actual implementation state.*
