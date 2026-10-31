# SWAI KH-02 V12.3.2 — Code Change Report

## Repaired Files
1. **`src/services/kh02/evergreenResearchOrchestrator.ts`**
   - Wired `enrichProductCandidatesWithEvidence` into Stage 4b before Google Ads and Scoring.
   - Prioritized candidate ranking before applying `maxCandidates` bounding.
   - Fixed false `isLive` telemetry for Google Ads and TikTok Organic.
   - Attached `candidateFunnel` to result object.
2. **`src/services/kh02/identity/productMetadataExtractor.ts`**
   - Implemented SSRF protection: IPv4/IPv6 private IP rejection, loopback/metadata blocking.
   - Switched to manual redirect following with 5-hop depth limit and per-hop validation.
   - Added 256KB chunked streaming byte cap with stream reader cancellation.
3. **`src/services/kh02/discovery/discoveryQueryPlanner.ts`**
   - Upgraded `MetaQueryBudgetTracker` to atomically reserve capacity and keep failed attempts accounted for on error.
4. **`src/services/kh02/identity/productIdentityResolver.ts`**
   - Enforced Section 9.7: slug alone without independent evidence yields PROBABLE, not VERIFIED.
5. **`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`**
   - Prevented defaulting to stdio command when caller explicitly passes `mcpUrl`.
6. **`src/services/kh02/version/runtimeVersionService.ts` & `src/app/api/v1/kh02/version/route.ts`**
   - Added runtime version diagnostics endpoint returning safe Git SHA and timestamp.
7. **`src/app/products/page.tsx`**
   - Displayed runtime version badge and candidate funnel metrics in UI.
   - Ensured 'Top 3 Products to Evaluate' section renders reliably with shortfall explanation.
8. **`scripts/kh02/runAcceptanceV12_3_2.ts`**
   - Replaced hardcoded P0-05 pass with dynamic assertion and created 17 release gates.
