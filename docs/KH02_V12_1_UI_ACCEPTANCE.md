# SWAI KH-02 V12.1 — Winning Products UI & Interaction Acceptance

## 1. Executive Summary

The `/products` interface has been hardened against regressions while preserving the gold-standard SaaS reference design:
- **#1 Gold** (`#F4C95D`)
- **#2 Ice Blue** (`#66C9EB`)
- **#3 Coral** (`#F48B87`)
- **#4+ Dark Purple** (`#141026`)

---

## 2. Key UI Repairs & Features

### 1. No Automatic Network Research on Mount
The initial `useEffect` calls `GET /api/v1/kh02/leaderboard` to restore the last saved ranking snapshot from SQLite. Zero network crawl occurs when simply visiting the page.

### 2. Live Dynamic Source Status Bar
Source statuses are fetched from `/api/v1/kh02/providers/status` and display actual runtime states:
- Meta Ads: Verified (Emerald)
- TikTok Ads US: Not Verified (Amber)
- TikTok Organic: Configured / Not Configured (Blue / Slate)
- Google Ads: Configured / Not Configured (Blue / Slate)
- Demand History: Verified (Emerald)

### 3. Top 3 Qualification Gating
- If verified evergreen winners exist: Rendered in the primary Top 3 podium.
- If 0 candidates meet verified criteria: Renders an honest banner: *"No verified evergreen winners yet for '[topic]' — see provisional opportunities below"*, avoiding false claims.
- Provisional opportunities are displayed in a dedicated secondary grid with clear `"PROVISIONAL"` badges.

### 4. Real Media & Video Playback Modal
Clicking on any product thumbnail with a video or playable media opens a dedicated video modal featuring:
- Embedded video playback.
- Platform provenance badge (Meta / TikTok).
- Direct link to canonical ad/video source.

### 5. Product Intelligence Routing
- When `candidate.researchProductId` is resolved: Navigates directly to `/products/<id>/intelligence`.
- When candidate is unlinked: Clicking "Inspect Candidate" opens a detailed 6-pillar breakdown modal on the page, explaining missing signals without crashing the route.
