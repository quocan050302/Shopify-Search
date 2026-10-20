# SWAI V9.1 — Discovery Root Cause & Repair Report

**Date:** 2026-10-20
**Commit Base:** cbb179e1abec136d3f87e152063df915a20d4d7f (master)
**Scope:** V9.1 repair of TikTok Auto Discovery Engine

---

## 1. Root Cause Analysis

### Bug 1 — Misleading 40101 Assumption Without a Probe
**File:** tiktokTopAdsProvider.ts checkAvailability()

When TIKTOK_CC_COOKIE was absent, the provider returned REQUIRES_AUTH and stated
"Without it, TikTok responds with code 40101" — but no HTTP request was made.

**Fix:** Separated into distinct states:
- NOT_CONFIGURED: Cookie env var not set — no probe made
- BLOCKED_SOURCE: HTTP 401/403 from TikTok during live probe
- BLOCKED_SOURCE: TikTok returned code 40101 during live probe
- UNVERIFIED: Unexpected API code
- AVAILABLE: Live probe returned code 0

---

### Bug 2 — Apify Selected on APIFY_TOKEN Presence Alone
**File:** providerRegistry.ts selectDiscoveryProvider()

BEFORE: if (ENABLE_APIFY_DISCOVERY === "true" || APIFY_TOKEN) — token alone triggered paid discovery.
**Fix:** Requires ENABLE_APIFY_DISCOVERY=true exclusively.

---

### Bug 3 — Apify Using Wrong Budget Key (captapi instead of apify)
**File:** apifyTopAdsProvider.ts checkAvailability()

**Fix:** Uses "apify" key (gracefully undefined -> falls through to ENABLE_APIFY_DISCOVERY guard).

---

### Bug 4 — Stats Route Counted All TikTok Ads as "Discovered"
**File:** stats/route.ts totalDiscoveredAds

BEFORE: prisma.competitorAd.count({ where: { platform: "TIKTOK" } }) — included manual imports.
**Fix:** Counts only ads with AdSourceIdentity records (auto-discovery ingestion).

---

### Bug 5 — Worker Online Status From Module-Memory (Cross-Process Blind)
**File:** stats/route.ts workerStatus

getDiscoveryWorkerStatus() reads from module-level let isRunning = false. Always false across processes.
**Fix:** DB heartbeat query on DiscoveryRun.heartbeatAt within last 5 minutes.

---

### Bug 6 — Blocked Jobs Recorded totalRequestCount: 1 (No Requests Made)
**File:** discoveryOrchestrator.ts

**Fix:** Blocked runs now record totalRequestCount: 0.

---

### Bug 7 — Blocked Jobs Always Used Generic errorCategory
**File:** discoveryOrchestrator.ts

**Fix:** errorCategory derived from availability.status:
- NOT_CONFIGURED -> PROVIDER_NOT_CONFIGURED
- PAID_DISABLED -> PROVIDER_BUDGET_BLOCKED
- REQUIRES_AUTH / BLOCKED_SOURCE -> PROVIDER_PERMISSION_DENIED

---

### Bug 8 — Dashboard Mixed Schedule Enabled with Worker Online
**File:** discovery/page.tsx

**Fix:** Worker card uses isOnline from DB heartbeat, separate from Schedule Active/Paused.

---

## 2. Files Changed

- providers/tiktokTopAdsProvider.ts — separated error states, removed false 40101 claim
- providerRegistry.ts — Apify requires ENABLE_APIFY_DISCOVERY=true
- providers/apifyTopAdsProvider.ts — fixed budget key to "apify"
- api/v1/discovery/stats/route.ts — auto-discovered ads count; DB heartbeat worker status
- discoveryOrchestrator.ts — totalRequestCount: 0 for blocked; exact errorCategory
- app/discovery/page.tsx — Worker card uses isOnline + DB heartbeat
- .env.example — full documentation of all V9.1 variables

---

## 3. Unresolved Access Requirements

TIKTOK_CC_COOKIE — browser session cookie from ads.tiktok.com
- How to obtain: Log in to Creative Center -> DevTools -> Network -> copy Cookie header
- Validity: ~7-30 days; must be refreshed manually
- No workaround: the endpoint requires an authenticated session

ENDPOINT DISCLAIMER:
ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list is an undocumented internal
endpoint. TikTok may change schema, increase WAF restrictions, or deprecate it without
notice. SWAI reports UNVERIFIED or BLOCKED_SOURCE and NEVER fabricates ads.

---

## 4. Dashboard Acceptance Criteria

| Condition | Display |
|---|---|
| Cookie not set | Provider: NOT CONFIGURED - Worker: Offline |
| Cookie set, probe succeeds | Provider: AVAILABLE - Run enabled |
| Cookie set, probe fails 40101 | Provider: BLOCKED SOURCE |
| Worker running via CLI | Worker: Online (green, DB heartbeat) |
| Worker not running | Worker: Offline (grey) |
| Schedule enabled, worker offline | Schedule: Active - Worker: Offline (separate) |

The dashboard MUST NOT display AUTO DISCOVERY READY without a successful authorized
live request confirming provider availability.
