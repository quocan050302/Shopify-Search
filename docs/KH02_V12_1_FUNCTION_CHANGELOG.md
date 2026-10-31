# SWAI KH-02 V12.1 — Function Implementation Changelog

| Function | File | Change Implemented | Status |
|---|---|---|---|
| `collectMetaProductSignals()` | `src/services/kh02/providers/metaResearchAdapter.ts` | Replaced `"FACEBOOK"` with canonical `{ in: ["META", "FACEBOOK"] }`; applied `buildAuthorizedAdWhere(workspaceId)`; mapped `landingPageUrl`, `sourceExternalAdId`, `storeDomainEvidence`. | VERIFIED |
| `collectTikTokAdsSignals()` | `src/services/kh02/providers/tiktokAdsResearchAdapter.ts` | Enforced workspace scoping; verified US target market check; honest fallback status. | VERIFIED |
| `discoverProductCandidatesFromAds()` | `src/services/kh02/identity/productCandidateDiscovery.ts` | Grouped on canonical `landingPageUrl` rather than Ad Library URLs; prevented candidate fragmentation. | VERIFIED |
| `resolveCandidateResearchProduct()` | `src/services/kh02/identity/productCandidateDiscovery.ts` | Resolved temporary candidate IDs to persisted `ResearchProduct.id` via `adProductLink` and canonical URL matches. | VERIFIED |
| `matchCrossPlatformProductEvidence()` | `src/services/kh02/identity/crossPlatformProductMatcher.ts` | Evaluated keyword and domain overlap between candidates and incoming videos/ads; flagged cross-store matches as `PROBABLE`. | VERIFIED |
| `persistProductMatchReview()` | `src/services/kh02/identity/crossPlatformProductMatcher.ts` | Persisted operator review decisions (`CONFIRMED`, `REJECTED`, `UNCERTAIN`) into `prisma.researchEvidence` scoped to workspace. | VERIFIED |
| `getStoredProductMatchReview()` | `src/services/kh02/identity/crossPlatformProductMatcher.ts` | Retrieved persistent match reviews by matchId and workspaceId. | VERIFIED |
| `loadProductHistoricalDemand()` | `src/services/kh02/demand/temporalDemandEngine.ts` | Loaded `ProductDemandObservation` time series by real `ResearchProduct.id`. | VERIFIED |
| `evaluateTemporalDemandStability()` | `src/services/kh02/demand/temporalDemandEngine.ts` | Enforced 60-day minimum span; added cyclic extrema check (`hasCyclicSwings`); classified dead flatlines as `DECLINING`. | VERIFIED |
| `createGoogleTransparencyMcpClient()` | `src/services/kh02/providers/googleTransparencyResearchAdapter.ts` | Implemented official MCP tool protocol client supporting stdio and HTTP gateway. | VERIFIED |
| `collectGoogleAdvertiserSignals()` | `src/services/kh02/providers/googleTransparencyResearchAdapter.ts` | Checked US delivery proof (`verifiedDeliveryMarket = US`); classified product relevance (`PRODUCT_SPECIFIC` vs `BRAND_RELATED`). | VERIFIED |
| `normalizeTikTokOrganicVideo()` | `src/services/kh02/providers/tiktokOrganicResearchAdapter.ts` | Hardened parsing: rejected negative views; enforced `isSafeInteger`; safe timestamp parsing; defaulted provenance to `UNKNOWN`. | VERIFIED |
| `collectTikTokOrganicSignals()` | `src/services/kh02/providers/tiktokOrganicResearchAdapter.ts` | Enforced `ProviderCostPolicy`; respected zero-cost default (`AUTO_PAID_RESEARCH = false`). | VERIFIED |
| `checkKH02ProviderReadiness()` | `src/services/kh02/providers/sourceRegistry.ts` | Replaced hard-coded `PASSED` with distinct truthful states: `CONFIGURED`, `SOURCE_DATA_VERIFIED`, `NOT_VERIFIED`, `NOT_CONFIGURED`. | VERIFIED |
| `calculateKH02EvergreenScore()` | `src/services/kh02/scoring/evergreenOpportunityScoring.ts` | Eliminated arbitrary baselines (Pillars B–F start at 0); segregated Opportunity Score and Evidence Confidence. | VERIFIED |
| `applyKH02EligibilityGates()` | `src/services/kh02/scoring/evergreenOpportunityScoring.ts` | Partitioned candidates into explicit tiers: `VERIFIED_EVERGREEN`, `PROVISIONAL_OPPORTUNITY`, `INSUFFICIENT_EVIDENCE`. | VERIFIED |
| `runEvergreenProductResearch()` | `src/services/kh02/evergreenResearchOrchestrator.ts` | Rewired 11-stage pipeline: ad discovery -> candidate extraction -> identity resolution -> multi-platform enrichment -> candidate evidence matching -> demand loading -> scoring -> snapshot persistence. | VERIFIED |
| `createKH02ResearchRun()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Created persistent research run in `prisma.syncJob` with `jobType: "KH02_RESEARCH"`. | VERIFIED |
| `updateKH02ResearchRunStatus()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Tracked stage progress (0–100%) and error messages. | VERIFIED |
| `persistKH02RankingSnapshot()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Saved immutable JSON snapshot to database upon run completion. | VERIFIED |
| `getKH02Leaderboard()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Restored latest completed leaderboard snapshot without re-running network calls. | VERIFIED |
| `getKH02ResearchRuns()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Retrieved historical runs list scoped to authorized workspace. | VERIFIED |
| `getKH02ResearchRunById()` | `src/services/kh02/persistence/kh02PersistenceService.ts` | Retrieved exact run and snapshot with workspace isolation check. | VERIFIED |
