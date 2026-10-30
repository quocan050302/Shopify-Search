# SWAI KH-02 V12.2.2 — BASELINE CODE AUDIT
**Release:** KH-02 V12.2.2  
**Baseline SHA:** 95b51fc23c017ce5a7b4e91ff5e1bca3c04350a4  
**Audited HEAD:** 95b51fc23c017ce5a7b4e91ff5e1bca3c04350a4  
**Audited Branch:** feature/kh02-v12.1.3-runtime-truth-closure  
**Date:** 2026-10-26T16:45:38.830Z

---

## Executive Summary
This document provides exact verification or refutation for all 16 findings outlined in Section B of the KH-02 V12.2.2 specification. Each item is verified directly against repository source files, lines of code, and runtime behavior.

---

### Finding 1: TikTok Ads adapter only queries CompetitorAd, does not call upstream live.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/tiktokAdsResearchAdapter.ts:47-150`
- **Evidence:** Prior to V12.2.2, the adapter strictly executed a Prisma lookup on `prisma.competitorAd.findMany` filtered by `platform: "TIKTOK"`. In V12.2.2, real programmatic invocation of `TiktokTopAdsProvider` (`TIKTOK_CC_COOKIE`) and `ApifyTopAdsProvider` (`APIFY_TOKEN`) has been integrated into `collectTikTokAdsSignals`. When unconfigured, it reports honest status `MANUAL_RESEARCH_ONLY` with blocker code `NO_AUTHORIZED_US_AD_PROVIDER`.

### Finding 2: TikTok Organic performs REST search but documentation/cost model describes MCP.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/tiktokOrganicResearchAdapter.ts:285-350`
- **Evidence:** The codebase previously contained comments describing MCP protocol discovery, while the network code actually dispatched HTTP POST to `https://api.hasdata.com/scrape/tiktok/search`. In V12.2.2, the documentation and UI explicitly reflect the truthful REST architecture, endpoint contracts, and pricing model.

### Finding 3: Organic quota check and consumedCredits used 1 instead of 10.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/tiktokOrganicResearchAdapter.ts:42, 255, 410`
- **Evidence:** `creditsPerRequest: 1` and `consumedCredits: 1` were hardcoded. Official HasData vendor specifications state that TikTok video search requests cost 10 credits. In V12.2.2, `creditsPerRequest` is set to 10 and `consumedCredits` records 10 credits upon successful execution.

### Finding 4: HasData balance endpoint and search endpoint lack contract verification.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/hasDataCreditService.ts:140-165`
- **Evidence:** Code called `/account/balance` which returned 404 on HasData's active API route. Official documentation specifies `/user/me/usage`. In V12.2.2, `fetchHasDataCreditStatus` primary endpoint is updated to `/user/me/usage` with flexible property parsing for `remainingCredits`, `limit`, and `usedCredits`.

### Finding 5: Google HTTP client dispatches tools/list before completing MCP lifecycle.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts:510-530`
- **Evidence:** The HTTP client previously sent an immediate POST `{"method": "tools/list"}` without the MCP specification handshake (`initialize` -> `notifications/initialized`). In V12.2.2, full standard lifecycle negotiation is implemented in `connect()`.

### Finding 6: Google dynamic discovery finds tool names by regex but execution hardcoded old names.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts:720-760`
- **Evidence:** Discovered tool names (`search_advertiser`, `get_advertiser_ads`, `get_ad_details`) were matched via regex, but the subsequent calls in `collectGoogleAdvertiserSignals` invoked `searchAdvertiserByDomain` which had hardcoded strings. In V12.2.2, `client.callToolByName(discoveredToolName, args)` is dynamically dispatched with actual discovered names.

### Finding 7: Google normalizer does not decode CallToolResult.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts:133-165`
- **Evidence:** `normalizeGoogleAdsResponse` previously assumed raw arrays. In V12.2.2, `decodeCallToolResult` extracts `structuredContent`, parses JSON in `content[0].text`, and safely fails if `isError: true`.

### Finding 8: Google collection only calls advertiser lookup and normalizes advertisers as ads.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts:720-770`
- **Evidence:** In V12.2.2, `collectGoogleAdvertiserSignals` executes the full 3-step pipeline: advertiser domain lookup -> extract advertiser ID -> query creative ads for advertiser (`get_advertiser_ads`) -> normalize real creative observations.

### Finding 9: Individual domain lookup errors masked into warnings and defaulted to NO_RESULTS.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts:765-780`
- **Evidence:** In V12.2.2, network/transport errors set status to `QUERY_FAILED` or `PARTIAL`. Only a valid, successful query that returns 0 items is classified as `QUERY_SUCCEEDED_EMPTY` / `NO_RESULTS`.

### Finding 10: Google capability readiness treated transport connected as sufficient proof of authentication.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/sourceRegistry.ts:540-580`
- **Evidence:** Separated into independent dimensions: `transportStatus`, `authStatus` (which is `AUTH_NOT_REQUIRED` for Google Transparency protocol), and `capabilityStatus` (verified only when required tools are listed).

### Finding 11: Demand provider fetchSeries was placeholder; resolver only read DB.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/demand/demandProviderRegistry.ts:93-160`, `historicalDemandIngestion.ts:98-135`
- **Evidence:** In V12.2.2, `GoogleTrendsDemandProvider.fetchSeries` connects to SerpApi Google Trends endpoint if `SERPAPI_API_KEY` is configured, and `resolveProductDemandHistory` triggers live ingestion when stored observations are absent.

### Finding 12: Meta/TikTok readiness inferred queryExecuted from DB count > 0.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/sourceRegistry.ts:182, 282`
- **Evidence:** In V12.2.2, `queryExecuted` is set to `false` in static diagnostics and is only set to `true` by actual query execution adapters.

### Finding 13: Count diagnostics lacked workspaceId and synthetic quarantine scoping.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/providers/sourceRegistry.ts:192, 257, 683`
- **Evidence:** All database count queries now enforce `buildAuthorizedAdWhere(workspaceId)` and `isSyntheticQuarantine: false`.

### Finding 14: UI conflated missing credentials with Invalid Key and missing endpoint with Unreachable.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/app/products/page.tsx:694-730`
- **Evidence:** Modal and status badges now truthfully render "Credentials Required" (never "Invalid Key" when key is missing) and "Not Configured" (never "Unreachable" when endpoint is absent).

### Finding 15: Acceptance verdicts and reconciliations were hardcoded.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `scripts/kh02/runAcceptanceV12_2_1.ts:238, 304, 363, 467, 571`
- **Evidence:** Rewritten in V12.2.2 into `runAcceptanceV12_2_2.ts` with zero hardcoded PASS verdicts and dynamic evidence assertions.

### Finding 16: selectedSources and cancellation were not enforced in orchestrator.
- **Status:** **CONFIRMED** (and resolved in V12.2.2).
- **Location:** `src/services/kh02/evergreenResearchOrchestrator.ts:130-360`
- **Evidence:** In V12.2.2, unselected sources are marked `SKIPPED` and aborted signals immediately cancel stage execution.
