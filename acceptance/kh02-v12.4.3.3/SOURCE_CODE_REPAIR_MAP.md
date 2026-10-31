# SWAI KH-02 V12.4.3.3 — Source Code Repair Map

| File | Functions Modified / Added | Purpose |
|---|---|---|
| `src/services/kh02/version/runtimeVersionService.ts` | `SWAI_KH02_RELEASE_VERSION` | Bumped release version to `12.4.3.3`. |
| `next.config.ts`, `src/app/products/page.tsx` | `NEXT_PUBLIC_SWAI_RELEASE_VERSION` | Synchronized frontend release version to `12.4.3.3`. |
| `src/services/kh02/types.ts` | `IntelligenceQuery`, `SourceObservation`, `ProviderExecutionMetadata` | Added V12.4.3.3 provenance, policy conflict, and multi-domain enrichment fields. |
| `src/services/kh02/providers/metaResearchAdapter.ts` | `diagnoseMetaLiveCollector`, `resolveMetaExecutionPolicyWithDiagnostics`, `normalizeMetaQueryOutcomeFields`, `aggregateMetaQueryOutcomes`, `collectMetaProductSignals` | 10-stage readiness vs execution separation, policy conflict detection, outcome normalization, and cache relevance filtering. |
| `src/services/kh02/providers/googleTransparencyResearchAdapter.ts` | `discoverGoogleAdsMcpCapabilities`, `extractRegistrableDomain`, `collectGoogleAdvertiserSignals`, `persistGoogleObservationsToDatabase` | 5 capability flags (`ENRICHMENT_ONLY`), redirect unwrapping, multi-domain enrichment queue, and removal of false 429 cooldown on empty results. |
| `src/services/kh02/identity/crossPlatformProductMatcher.ts` | `associateProductEvidence` | Classified matches into `EXACT_PRODUCT_MATCH`, `PROBABLE_PRODUCT_MATCH`, `BRAND_ONLY_MATCH`, and `REJECTED_UNRELATED_CREATIVE`. |
| `src/services/kh02/providers/sourceRegistry.ts` | `buildProviderTruthMatrix` | 10-column provider truth matrix across `META_ADS`, `GOOGLE_ADS`, `DEMAND_HISTORY`, `TIKTOK_ADS`, and `TIKTOK_ORGANIC`. |
| `src/services/kh02/discovery/geminiDiscoveryPlanner.ts` | `DOMAIN_ARCHETYPE_CATALOG`, `analyzeNicheIntent`, `validateDiscoveryPlan` | Added `dog`, `cat`, `car` archetype catalogs, symbol-only query rejection, and species/product plan validation. |
| `src/services/kh02/discovery/discoveryQueryPlanner.ts` | `evaluateShortlistCoverage` | Separated 5 archetype stages so planned archetypes are never counted as discovered product families. |
| `src/services/kh02/identity/productRelevanceEvaluator.ts` | `evaluateProductRelevance` | Strengthened species-specific (`Dog Gadgets` vs `Cat Gadgets`), specific-product (`Automatic Pet Feeder`), and `Car Accessories` relevance gates. |
| `src/services/kh02/identity/productDistinctnessEngine.ts` | `stripVariantHandleSuffixes`, `compareProductCandidates` | Collapsed color/size/pack variant handles on the same store into `SAME_PRODUCT_DIFFERENT_VARIANT`. |
| `src/services/kh02/identity/productCandidateDiscovery.ts` | `discoverProductCandidatesFromAds`, `selectTopResearchShortlist` | Preserved `supportingExternalAdIds` and `matchedQueryIds`, and enforced store diversity in Top-3 shortlist. |
| `src/services/kh02/evergreenResearchOrchestrator.ts` | `runEvergreenProductResearch` | Passed up to 5 verified domains to Google enrichment, deduplicated observations, and attached only product-specific Google matches. |
| `src/services/kh02/persistence/kh02PersistenceService.ts` | `persistKH02RankingSnapshot`, `requalifyHistoricalEvergreenSnapshot`, `getWorkspaceProviderTelemetry` | Idempotent `ResearchProduct` + `AdProductLink` materialization on persist and historical `verified-merchant-demand:` demotion. |
| `src/app/api/v1/research/products/[id]/overview/route.ts` | `GET` | Removed concurrent `syncJob.resultJson` write side effect from GET overview while preserving V12.4.3.2.1 gallery & authorization checks. |
