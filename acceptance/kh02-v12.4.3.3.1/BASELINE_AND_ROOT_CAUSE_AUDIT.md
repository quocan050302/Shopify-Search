# SWAI KH-02 V12.4.3.3.1 — Baseline & Root Cause Audit

## Repository & Baseline
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **V12.4.3.3 Protected-Scope Baseline SHA:** `87627ae851a02d855245ca71b8bd9435826a7811`
- **Prior Reviewed HEAD SHA:** `095ee83202001a1630e844e64f8e41a6c5f02c44`
- **Tested Source SHA (`testedSourceSha`):** `f4a7eea16a947b44bd5943c6ee39c53a55c365b7`

## Confirmed Root Causes & Production Repairs

### 1. Meta Subquery-to-DB Lineage Loss (`G04`)
- **Root Cause:** `metaResearchAdapter.ts` stored untrimmed `rawId` keys in `subqueryBindingMap` and did not bind `norm.sourceExternalId` or `trace.persistedId`, while Round 2 live re-observations of Round 1 cached ads in `evergreenResearchOrchestrator.ts` kept `provenance: "CACHED_SOURCE"`. Additionally, `selectTopResearchShortlist` did not prioritize current-run live-grounded candidates ahead of cache-only candidates.
- **Fix:** Trimmed and bound `rawId`, `norm.sourceExternalId`, and `trace.persistedId` in `metaResearchAdapter.ts`; upgraded Round 1 cached observations to `LIVE_PROVIDER` and merged `matchedQueryIds` when Round 2 live queries re-observed the same ad in `evergreenResearchOrchestrator.ts`; prioritized current-run live-grounded candidates in `selectTopResearchShortlist`.

### 2. Broad-Niche Product Family Inflation (`G12`)
- **Root Cause:** `KittySpout Wireless Fountain` and `Pawira Stainless Steel Water Fountain` lacked a `cat|dog|pet` prefix and fell through to token-based fallback keys, counting two water fountains as 2 distinct families. `UNRESOLVED_FAMILY` was also counted toward `distinctFamilyCount`.
- **Fix:** Extended `pet_water_fountain`, `Home Cleaning Gadgets`, and `Car Accessories` rules in `productDistinctnessEngine.ts`, excluded `unresolved_family` from `evaluateOpportunityDiversity`, and enforced strict family diversity in `selectTopResearchShortlist`.

### 3. Niche Contamination in Pet Gadgets, DIY Tools, and Car Accessories (`G09`, `G26`)
- **Root Cause:** `productRelevanceEvaluator.ts` matched generic category suffix words (`accessories`, `gadgets`, `tools`) in the fallback matcher, allowing `Golf Organizer Pouch With Golf Accessories Set` into `Car Accessories`, `Crochet Starter Kit` into `DIY Tools`, and `Dog Food Starter Bundle` into `Pet Gadgets`.
- **Fix:** Added explicit consumable pet food/bundle exclusions, textile/crochet/yarn craft exclusions, and golf/non-automotive exclusions in `productRelevanceEvaluator.ts`, and stripped generic category suffix tokens from fallback matching.

### 4. Google Ads MCP Per-Operation Deadlines & Process Cleanup (`G05`, `G06`, `G07`, `G27`)
- **Root Cause:** `collectGoogleAdvertiserSignals` lacked per-operation deadlines around `connect()`, `listTools()`, `searchAdvertiserByDomain()`, and `getAdvertiserAds()`, and did not guarantee `client.close()` on connect timeout.
- **Fix:** Added timer-safe `withOperationDeadline()` across all 4 MCP operations, guaranteed `client.close()` in `finally`, added structured `stepTimeline`, and ensured only genuine HTTP 429 responses set the rate-limit cooldown.

### 5. Live Verified Top-3 Separation (`G16`) & Same-Run DB/HTTP/Chromium Reconciliation (`G17`)
- **Root Cause:** `G16` previously conflated `PROBABLE` ad-supported candidates with `VERIFIED` merchant-page candidates. `G17` previously failed because the acceptance runner did not persist the run via `persistKH02RankingSnapshot` or pass real Playwright Chromium `browserEvidence`.
- **Fix:** Added `isCandidateLiveVerified()` requiring `identityStatus === "VERIFIED"` + positive current-run live observations linked to `executedQueryIds`, persisted all acceptance runs to SQLite, and executed real Playwright Chromium DOM reconciliation on the exact same `researchRunId`.
