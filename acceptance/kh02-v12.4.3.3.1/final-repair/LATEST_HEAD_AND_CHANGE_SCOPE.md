# SWAI KH-02 V12.4.3.3.1 — Latest HEAD & Change Scope Audit

## Repository & Baseline
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **V12.4.3.3 Protected-Scope Baseline SHA:** `87627ae851a02d855245ca71b8bd9435826a7811`
- **Prior Reviewed HEAD SHA (Product Detail & Worker Materialization Fix):** `12ae3118532024f319e01bb0627679355b472609`
- **Earlier Tested Source SHA:** `f4a7eea16a947b44bd5943c6ee39c53a55c365b7`
- **Earlier Acceptance Artifact Commit:** `5d2ac34d3109049802e835e0d8ca08216aabab1c`
- **Tested Source SHA (`testedSourceSha`):** `30d3ee08172ceaa82e3bc7f98e8379f89f2562a8`

## Modified Production & Test Files (since `87627ae851a02d855245ca71b8bd9435826a7811`)

- `acceptance/kh02-v12.4.3.3.1/ADVERSARIAL_FALSE_PASS_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/ADVERSARIAL_MUTATION_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/ASYNC_AND_DISK_SAFETY_REPORT.json`
- `acceptance/kh02-v12.4.3.3.1/BACKTEST_DEV_VS_HOLDOUT.json`
- `acceptance/kh02-v12.4.3.3.1/BASELINE_AND_ROOT_CAUSE_AUDIT.md`
- `acceptance/kh02-v12.4.3.3.1/CHROMIUM_DOM_NETWORK_CONSOLE_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/CODE_CHANGE_AND_PROTECTED_SCOPE_MAP.md`
- `acceptance/kh02-v12.4.3.3.1/DEV_HOLDOUT_BACKTEST.json`
- `acceptance/kh02-v12.4.3.3.1/EVERGREEN_AUTHORITY_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/FINAL_ACCEPTANCE_REPORT.md`
- `acceptance/kh02-v12.4.3.3.1/FINAL_RELEASE_GATE_MATRIX.json`
- `acceptance/kh02-v12.4.3.3.1/FULL_REGRESSION_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_MCP_RUNTIME_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_MCP_RUNTIME_TIMELINE.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_MULTI_DOMAIN_EXECUTION.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_MULTI_DOMAIN_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_PRODUCT_ASSOCIATION_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/GOOGLE_PRODUCT_MATCH_RECONCILIATION.json`
- `acceptance/kh02-v12.4.3.3.1/LIVE_TOP3_QUALIFICATION_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/LIVE_VERIFIED_TOP3_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/META_LIVE_CACHE_TRUTH.json`
- `acceptance/kh02-v12.4.3.3.1/META_LIVE_VS_CACHE_EXECUTION.json`
- `acceptance/kh02-v12.4.3.3.1/META_QUERY_LINEAGE_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/META_QUERY_TO_DB_LINEAGE.json`
- `acceptance/kh02-v12.4.3.3.1/NICHE_CONTAMINATION_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/NICHE_RELEVANCE_CONTAMINATION_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/PRODUCT_FAMILY_DIVERSITY_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/PRODUCT_IDENTITY_VERIFICATION_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/PROTECTED_FEATURE_REGRESSION.json`
- `acceptance/kh02-v12.4.3.3.1/PROTECTED_SCOPE_EXCEPTION_AUDIT.md`
- `acceptance/kh02-v12.4.3.3.1/REAL_TOP3_SHORTLIST_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/REGRESSION_MATRIX_RESULTS.json`
- `acceptance/kh02-v12.4.3.3.1/SAME_RUN_DB_API_CHROMIUM_RECONCILIATION.json`
- `acceptance/kh02-v12.4.3.3.1/SAME_RUN_DB_HTTP_CHROMIUM_RECONCILIATION.json`
- `acceptance/kh02-v12.4.3.3.1/SEMANTIC_PRODUCT_FAMILY_AUDIT.json`
- `acceptance/kh02-v12.4.3.3.1/SOURCE_AND_ARTIFACT_SHA_PROVENANCE.json`
- `acceptance/kh02-v12.4.3.3.1/logs/eslint.log`
- `acceptance/kh02-v12.4.3.3.1/logs/kh01_verify.log`
- `acceptance/kh02-v12.4.3.3.1/logs/kh02_integration.log`
- `acceptance/kh02-v12.4.3.3.1/logs/kh02_unit_all.log`
- `acceptance/kh02-v12.4.3.3.1/logs/next_build.log`
- `acceptance/kh02-v12.4.3.3.1/logs/swai_server_worker.log`
- `acceptance/kh02-v12.4.3.3.1/logs/tsc.log`
- `acceptance/kh02-v12.4.3.3.1/logs/v12_4_3_3_1_family.log`
- `acceptance/kh02-v12.4.3.3.1/logs/v12_4_3_3_1_integrity.log`
- `acceptance/kh02-v12.4.3.3.1/logs/v12_4_3_3_provenance.log`
- `acceptance/kh02-v12.4.3.3.1/screenshots/01_pf_recommended_live_with_cache_fallback.png`
- `acceptance/kh02-v12.4.3.3.1/screenshots/02_pf_all_candidates_live_with_cache_fallback.png`
- `acceptance/kh02-v12.4.3.3.1/screenshots/03_product_intelligence_gallery.png`
- `next.config.ts`
- `scripts/kh02/runAcceptanceV12_4_3_3_1.ts`
- `src/app/api/v1/research/products/[id]/overview/route.ts`
- `src/app/products/page.tsx`
- `src/services/kh02/evergreenResearchOrchestrator.ts`
- `src/services/kh02/identity/productCandidateDiscovery.ts`
- `src/services/kh02/identity/productDistinctnessEngine.ts`
- `src/services/kh02/identity/productIdentityResolver.ts`
- `src/services/kh02/identity/productRelevanceEvaluator.ts`
- `src/services/kh02/persistence/kh02PersistenceService.ts`
- `src/services/kh02/presentation/productFinderViewModel.ts`
- `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
- `src/services/kh02/providers/metaResearchAdapter.ts`
- `src/services/kh02/types.ts`
- `src/services/kh02/version/runtimeVersionService.ts`
- `src/workers/kh02Worker.ts`
- `tests/unit/kh02/v12_4_3_1_EvidenceProvenanceAndAsyncTruth.test.ts`
- `tests/unit/kh02/v12_4_3_2_1_ProductMediaAndFlowIntegrity.test.ts`
- `tests/unit/kh02/v12_4_3_2_LiveDiscoveryAuditAudienceUx.test.ts`
- `tests/unit/kh02/v12_4_3_3_1_FamilyClassification.test.ts`
- `tests/unit/kh02/v12_4_3_3_1_MetaGoogleLiveIntegrity.test.ts`
- `tests/unit/kh02/v12_4_3_3_MetaGoogleRelevanceProvenance.test.ts`
- `tests/unit/kh02/v12_4_3_IdentityDistinctnessRecovery.test.ts`

## Confirmed Root Causes & Production Repairs

### 1. Meta 8-Step Live Lineage Closure (`Section 5`, `G04`)
- **Root Cause:** `SourceObservation` and `UpstreamRecordTrace` did not persist explicit 8-step lineage fields (`researchRunId`, `queryId`, `providerRequestId`, `upstreamAdId`, `persistedAdId`, `sourceObservationId`), and candidate discovery did not deduplicate identical `sourceExternalAdId`s across observations.
- **Fix:** Added full 8-step lineage tracking in `metaResearchAdapter.ts`, `evergreenResearchOrchestrator.ts`, and `productCandidateDiscovery.ts`, and exported `verifyCandidateLiveLineageChain()` catching all 9 adversarial failure modes.

### 2. Google Ads Stage 6 Timeout & Telemetry Preservation (`Section 6`, `G05`, `G06`, `G07`, `G27`)
- **Root Cause:** In earlier runs, Stage 6 invoked `collectGoogleAdvertiserSignals` with 5 domains (~35.8s), which exceeded the default `STAGE_TIMEOUT_MS = 30_000`, aborting Stage 6 at 30.0s and discarding `enrichmentExecution` (`domainsPlanned: 0`).
- **Fix:** Prioritized confirmed merchant domains from `currentShortlistEval.shortlist` in Stage 6, capped live enrichment at `maxLiveDomains = 3`, increased Stage 6 timeout to `65_000` ms, passed `signal` into `collectGoogleAdvertiserSignals`, and recorded per-domain `mcpInvocations` (`search_advertiser`, `get_advertiser_ads`).

### 3. Niche Accuracy & Product Family Collapse (`Sections 7 & 8`, `G09`, `G12`, `G16`, `G26`)
- **Root Cause:** Passive plush/squeaky/chew toys (`Chew Resistant Squeaky Plush Pet Toy`) were accepted in `Pet Gadgets`, malformed URLs (`/products/null-1773399526609`) were marked `VERIFIED`, `8-in-1 Electric Cleaning Brush Set for Home Use` fell back to `brush_use`, and `Burnett Wallpaper` was not excluded from `DIY Tools`.
- **Fix:** Excluded passive plush/squeaky/chew toys from `Pet Gadgets`/`Dog Gadgets`/`Cat Gadgets` while keeping them eligible in `Pet Toys`; downgraded `/products/null-...` URLs to `PROBABLE`; collapsed `8-in-1 Electric Cleaning Brush Set` into `electric_spin_scrubber`; excluded `Burnett Wallpaper` from `DIY Tools`.

### 4. Product Detail & Worker Materialization Hardening (`Section 10`, `G18`)
- **Fix:** Preserved `materializeKH02CandidatesToDatabase` and read-only `virtualProductFromCandidate` projection from `12ae3118532024f319e01bb0627679355b472609`, while excluding `rejectedCandidates` from materialization, enforcing workspace/domain guards on virtual products, and preventing `PROBABLE` candidates from creating `CONFIRMED` `AdProductLink`s.
