# SWAI KH-02 V12.4.3.1 — Source Code Change Summary

## 1. Phase A — Strict Meta Query Provenance (`F01`, `F02`)
- `src/services/kh02/providers/metaResearchAdapter.ts`: Added `MetaExecutionPolicy` (`LIVE_FIRST`, `CACHE_SUPPLEMENTED`, `CACHE_ONLY`, `OFFLINE_FIXTURE`), `EvidenceTrueQueryExecution`, `subqueryBindings`, and explicit `NOT_ATTEMPTED` (`attempted: false`, `actualApiCalls: 0`, `upstreamReturnedCount: null`, `returnedCount: 0`) outcomes when live Meta collection is not attempted.
- `src/services/kh02/evergreenResearchOrchestrator.ts`: Removed synthetic fallback `SUCCEEDED_WITH_RESULTS` / `actualApiCalls: 1` fabrication when `allMetaQueryOutcomes` is empty; removed loose substring attribution across cached pool ads in `queryYields`.

## 2. Phase B — Product-Level Historical Demand Verification & Independent Evergreen Audit (`F03`, `F04`, `F06`)
- `src/services/kh02/demand/temporalDemandEngine.ts`: Added `DemandSourceAuthority` (`AUTHORITATIVE_VERIFIED`, `HISTORICAL_SOURCE_VERIFIED`, `ESTIMATED_OR_PROXY`, `CACHED_UNVERIFIED`, `FIXTURE_ONLY`, `UNKNOWN_SOURCE`), `evaluateDemandSourceAuthority()`, product-family alignment checks, and broad category proxy rejection.
- `src/services/kh02/demand/historicalDemandIngestion.ts`: Preserved `id`, `productId`, `keyword`, `evidenceReference`, `methodologyVersion`, and `isFixture` on `DemandDataPoint`; excluded `prod_fixture_*` rows from real candidate resolution.
- `src/services/kh02/scoring/evergreenOpportunityScoring.ts`: Added `EvergreenVerificationEvidence`, `CandidateVerificationDimensions` (5 separated dimensions), and `verifyEvergreenCandidateIndependently()`. Demotes any candidate where `evergreenVerification.verifiedByGate === false`.

## 3. Phase D — Runtime Version Parity Closure (`F05`)
- `next.config.ts`: Updated `NEXT_PUBLIC_SWAI_RELEASE_VERSION` from `"12.4.2"` to `"12.4.3.1"`.
- `src/services/kh02/version/runtimeVersionService.ts`: Updated `SWAI_KH02_RELEASE_VERSION = "12.4.3.1"` and added `sourceRevisionSha`, `buildRevisionSha`, `backendBootSha`, `workerBootSha`, and `databaseFingerprint`.
- `src/app/products/page.tsx`: Updated UI release version to `"12.4.3.1"` and added separated verification dimension badges (`kh02-badge-demand-status`, `kh02-badge-ai-review-status`, `kh02-badge-evergreen-status`).

## 4. Phase E & F — Specific-Query Relevance Isolation (`F08`), Customer Psychology Isolation (`F09`), & Google 11-State Truth (`F07`)
- `src/services/kh02/identity/productRelevanceEvaluator.ts`: Enforced specific-product query gates (`automatic pet feeder`, `cat water fountain`, etc.) so sibling niche gadgets are rejected as `IRRELEVANT`.
- `src/services/kh02/psychology/customerPsychologyService.ts` & `src/services/kh02/identity/productCandidateDiscovery.ts`: Fixed negated `"no Wi-Fi, no Bluetooth"` regex match that assigned wireless audio/commuter psychology to the `uahpet.com` cat feeder; added `validateCustomerPsychologyAlignment()` and post-enrichment psychology recomputation.
- `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`: Added all 11 Section 7 `stateBreakdown` flags and `isControlledMcp` distinction.

## 5. Phase C, G, H, I — Acceptance Gate Engine, Bounded Async Pool, & Backtest (`F10`)
- `src/services/kh02/acceptance/gateAndAsyncVerifierV12_4_3_1.ts`: Implemented `evaluateSplitG06MetaGates`, `evaluateG12IndependentEvergreen`, `validateFreshTestExecutionLog`, `runBoundedAsyncJobPool`, and `validateCompletionBarrier`.
- `tests/unit/kh02/v12_4_3_1_EvidenceProvenanceAndAsyncTruth.test.ts`: Added 25 unit and adversarial regression tests covering F01–F10 and Mutations A–J.
- `scripts/kh02/runBacktestV12_4_3_1.ts` & `scripts/kh02/runAcceptanceAsyncV12_4_3_1.ts`: Implemented DEV/HOLDOUT backtest and bounded async acceptance runner.
