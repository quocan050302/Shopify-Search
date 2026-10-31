# SWAI KH-02 V12.4.3.3 — Baseline Failure Reproduction Report

- **Repository:** `quocan050302/Shopify-Search`
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **Base Commit:** `51c8ec8314b5e92834813d26ccfb9862d6a8e42e` (`V12.4.3.2.1`)
- **Evaluated HEAD:** `51c8ec8314b5e92834813d26ccfb9862d6a8e42e` (`V12.4.3.3`)

## Reproduced Baseline Defects & Fixes

1. **Meta Live Readiness vs Execution Conflation (`diagnoseMetaLiveCollector`)**
   - **Baseline Defect:** `diagnoseMetaLiveCollector()` populated `recordsReturned` with the historical SQLite `CompetitorAd` count (`319`), making readiness look like current-run live execution.
   - **Fix:** Added explicit 10-stage readiness & execution fields (`collectorInstalled`, `collectorConfigured`, `transportReachable`, `queryCapabilityAvailable`, `actualQueryAttempted`, `upstreamQueryCompleted`, `rawAdsReturned`, `validObservationsNormalized`, `recordsPersisted`, `recordsAssociatedWithCandidates`) and separated `recordsReturned: 0` from `databaseRecordsIndexed: 319`.

2. **Meta Execution Policy Conflict & Cache Relevance Bypass (`metaResearchAdapter.ts`)**
   - **Baseline Defect:** Conflicting `sourceMode` and `metaExecutionPolicy` flags were not explicitly reconciled, and cached SQLite fallback rows bypassed `evaluateProductRelevance()`.
   - **Fix:** Implemented `resolveMetaExecutionPolicyWithDiagnostics()`, updated `normalizeMetaQueryOutcomeFields()` so `NOT_ATTEMPTED` resets counts to `0`/`null`, separated `sourceExecutionStatus`, `persistenceOutcome`, and `qualifiedProductOutcome`, and filtered cached SQLite ads through `evaluateProductRelevance()`.

3. **Google Single-Domain Cap & False HTTP 429 Cooldown on Empty Results (`googleTransparencyResearchAdapter.ts`)**
   - **Baseline Defect:** `collectGoogleAdvertiserSignals()` sliced `storeDomains` to `.slice(0, 1)` and triggered a global 180-second `HTTP 429` cooldown whenever `observations.length === 0` even if `lastError` came from an earlier failed attempt or empty response.
   - **Fix:** Replaced the 1-domain cap with a bounded multi-domain queue (`maxLiveDomains` up to 5 verified merchant domains) with per-domain `domainOutcomes`, separated `BLOCKED` (403/captcha/anti-bot) from `QUERY_FAILED` (timeout) and `RATE_LIMITED` (HTTP 429), and removed the false cooldown on empty results.

4. **Google Brand-Only Creative Inflation (`crossPlatformProductMatcher.ts`)**
   - **Baseline Defect:** `associateProductEvidence()` linked any Google creative on the same `storeDomain` to a product candidate with `0.76` confidence even when the creative promoted a completely different product model.
   - **Fix:** Added `associationClassification` (`EXACT_PRODUCT_MATCH`, `PROBABLE_PRODUCT_MATCH`, `BRAND_ONLY_MATCH`, `REJECTED_UNRELATED_CREATIVE`) and `isProductSpecificEvidence: boolean`. Only product-specific matches count toward product evidence.

5. **Archetype Inflation Before Product Verification (`evergreenResearchOrchestrator.ts` & `discoveryQueryPlanner.ts`)**
   - **Baseline Defect:** Planned query `archetypeId`s were added to `coveredArchetypeIds` before verifying whether any qualified product existed for that archetype.
   - **Fix:** Separated 5 archetype sets (`plannedArchetypeIds`, `queriedArchetypeIds`, `archetypesWithReturnedAds`, `archetypesWithRelevantCandidates`, `archetypesWithQualifiedProducts`) so `distinctProductArchetypesObserved === 0` when `qualifiedProducts === 0`.

6. **Variant Handle Duplication & Same-Store Top-3 Monopolization (`productDistinctnessEngine.ts` & `productCandidateDiscovery.ts`)**
   - **Baseline Defect:** Color/size/pack handle suffixes (`-blue`, `-large`, `-2pack`) prevented variant collapsing on the same merchant, and a single store could occupy multiple Top-3 shortlist slots.
   - **Fix:** Added `stripVariantHandleSuffixes()` and enforced store-domain diversity across Top-3 shortlist slots by default.
