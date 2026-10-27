# SWAI KH-02 V12.2.4 — PRODUCT DISCOVERY ROOT CAUSE ANALYSIS

## 1. Defect Description
Previously inspected runs reported:
- Meta upstream records returned: 10
- New unique ads inserted: 0
- Live research candidates discovered: 0
- Live browser product cards: 0

## 2. Root Cause Tracing
1. In `metaResearchAdapter.ts`, `collectLiveMetaAds()` called `ingestDiscoveredAds()` without a `discoveryRunId` context.
2. `ingestDiscoveredAds()` only populated `DiscoveryRunAd` if `context.discoveryRunId` or `context.runId` was provided.
3. Because `DiscoveryRunAd` was omitted, the newly inserted `CompetitorAd` records were not associated with the active `workspaceId`.
4. Subsequent calls to `buildAuthorizedAdWhere(workspaceId)` filtered out these ads, returning 0 records.
5. In addition, `productRelevanceEvaluator.ts` lacked modern pet gadget terms, causing borderline products to be rejected as `IRRELEVANT`.

## 3. Resolution & Verification
1. `collectLiveMetaAds()` now upserts a `DiscoveryRun` and supplies its ID to `ingestDiscoveredAds()`.
2. `matchingAds` query includes `freshLiveAdIds`.
3. `productRelevanceEvaluator.ts` recognizes pet gadgets (e.g. "Two-in-One Pet Car Seat Belt") as `RELEVANT` (score 0.95).
4. Live query now discovers candidates, correctly evaluates relevance, and renders cards without fabrication.
