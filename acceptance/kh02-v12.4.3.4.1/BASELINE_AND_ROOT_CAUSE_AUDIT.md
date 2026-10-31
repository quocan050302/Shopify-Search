# SWAI KH-02 V12.4.3.4.1 — Latest HEAD & Change Scope Audit

## Repository & Baseline
- **Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`
- **V12.4.3.3 Protected-Scope Baseline SHA:** `e19fc569883a58fbd9bafd8f468653d26f80c6fc`
- **Prior Reviewed HEAD SHA (Product Detail & Worker Materialization Fix):** `e19fc569883a58fbd9bafd8f468653d26f80c6fc`
- **Earlier Tested Source SHA:** `bbe3dbc094ff246e7f7b539da6dc46cefa20072b`
- **Earlier Acceptance Artifact Commit:** `72f64e16d43e57106c641fbcf756461a5b828df5`
- **Tested Source SHA (`testedSourceSha`):** `689356b00d2cefebdb12356fd1a946c15ae3fcd6`

## Modified Production & Test Files (since `e19fc569883a58fbd9bafd8f468653d26f80c6fc`)

- `data/google_trends_imports/49f452e8413178ee0b3e1e2d42c2fd495693b552f211bc908a16511b63302109.csv`
- `data/google_trends_imports/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.csv`
- `data/google_trends_imports/f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39.csv`
- `next.config.ts`
- `scripts/kh02/runAcceptanceAsyncV12_4_3_4_1.ts`
- `scripts/kh02/runBacktestV12_4_3_4_1.ts`
- `src/app/api/v1/demand/import/route.ts`
- `src/app/api/v1/research/products/[id]/overview/route.ts`
- `src/app/products/page.tsx`
- `src/components/layout/Header.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/services/discovery/discoveryIngestionService.ts`
- `src/services/kh02/demand/demandProviderRegistry.ts`
- `src/services/kh02/demand/googleTrendsCsvValidator.ts`
- `src/services/kh02/demand/historicalDemandIngestion.ts`
- `src/services/kh02/demand/temporalDemandEngine.ts`
- `src/services/kh02/evergreenResearchOrchestrator.ts`
- `src/services/kh02/identity/productCandidateDiscovery.ts`
- `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
- `src/services/kh02/version/runtimeVersionService.ts`
- `tests/integration/kh02HttpServerE2E.test.ts`
- `tests/integration/kh02ResearchApi.test.ts`
- `tests/unit/kh02/v12_4_3_1_EvidenceProvenanceAndAsyncTruth.test.ts`
- `tests/unit/kh02/v12_4_3_2_1_ProductMediaAndFlowIntegrity.test.ts`
- `tests/unit/kh02/v12_4_3_2_LiveDiscoveryAuditAudienceUx.test.ts`
- `tests/unit/kh02/v12_4_3_3_1_MetaGoogleLiveIntegrity.test.ts`
- `tests/unit/kh02/v12_4_3_3_2_DemandAndIdentityIntegrity.test.ts`
- `tests/unit/kh02/v12_4_3_3_MetaGoogleRelevanceProvenance.test.ts`
- `tests/unit/kh02/v12_4_3_4_1_ZeroSpendGoogleFreeAutomation.test.ts`
- `tests/unit/kh02/v12_4_3_4_GoogleFreeDemandAndTikTokDisabled.test.ts`
- `tests/unit/kh02/v12_4_3_IdentityDistinctnessRecovery.test.ts`
- `tests/unit/kh02V12_1_4_2_Reliability.test.ts`
- `tests/unit/kh02V12_2_3_ProviderDiscovery.test.ts`

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
- **Fix:** Preserved `materializeKH02CandidatesToDatabase` and read-only `virtualProductFromCandidate` projection from `e19fc569883a58fbd9bafd8f468653d26f80c6fc`, while excluding `rejectedCandidates` from materialization, enforcing workspace/domain guards on virtual products, and preventing `PROBABLE` candidates from creating `CONFIRMED` `AdProductLink`s.
