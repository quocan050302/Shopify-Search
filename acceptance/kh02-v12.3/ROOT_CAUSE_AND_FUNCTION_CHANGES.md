# SWAI KH-02 V12.3 — Root Cause & Function Changes Audit

**Date:** 2026-10-27T16:10:08.370Z  
**Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Starting SHA:** `e078893fa09148c8f95140d2f465af2ca74fb294` (Dirty: `true`)  
**Status:** Clean Closure across all 18 Baseline Findings

---

## Comprehensive 18-Finding Root Cause & Implementation Matrix

### 1. `buildKH02DiscoveryQueryPlan()` Production Integration
- **Finding:** `buildKH02DiscoveryQueryPlan()` was defined in `src/services/kh02/discovery/discoveryQueryPlanner.ts` but never called in the production collection path.
- **Affected Functions:** `collectLiveMetaAds()` in `src/services/kh02/providers/metaResearchAdapter.ts`.
- **Root Cause:** The collection path passed only the raw topic directly to `searchAds()`, bypassing planned subqueries.
- **Fix:** Integrated `buildKH02DiscoveryQueryPlan(topic, market, windowDays)` directly into `collectLiveMetaAds()`. The adapter executes the primary query, then sequentially executes planned subqueries within bounded request and ad limits, tagging each record with `queryKeyword` and `queryId`.
- **Evidence:** `tests/unit/kh02V12_3_ProductIntelligence.test.ts` ("executes planned discovery subqueries within budget") and runtime execution querying primary + subqueries ("pet hair remover", "automatic pet feeder", "pet water fountain").

### 2. Production Meta Query Topic Expansion
- **Finding:** Production Meta research called the single broad topic (e.g. "Pet Gadgets"), which returned catalog-level dropshipper ads.
- **Affected Functions:** `collectLiveMetaAds()` in `src/services/kh02/providers/metaResearchAdapter.ts`.
- **Root Cause:** Lack of subquery execution resulted in low specificity and single-advertiser page-name matches.
- **Fix:** Enabled multi-query collection under a global budget (max 30 records, max 3 subqueries), maintaining external ID deduplication across subqueries.
- **Evidence:** Multi-query execution logs in `SOURCE_QUERY_EVIDENCE.json`.

### 3. Search Strategy: `KEYWORD_EXACT_PHRASE` & Relevance Layer
- **Finding:** Switching from `KEYWORD_UNORDERED` to `KEYWORD_EXACT_PHRASE` alone is insufficient to guarantee product quality.
- **Affected Functions:** `createMetaCollectorClient().searchAds()` in `src/services/discovery/metaCollector/metaCollectorMcpClient.ts`, `evaluateProductRelevance()` in `src/services/kh02/identity/productRelevanceEvaluator.ts`.
- **Root Cause:** Exact phrase reduces noise from generic words, but Meta Ad Library still matches page names containing the phrase unless an downstream relevance layer filters out off-niche products.
- **Fix:** Combined `KEYWORD_EXACT_PHRASE` at the collection boundary with strict content-based relevance evaluation in `evaluateProductRelevance()`.
- **Evidence:** DHgate seller "Gadgets" running 6 unrelated products was successfully filtered; all 7 off-niche products (sunglasses, speaker, shoes, Christmas ball) rejected.

### 4. Meta Normalizer Creative Isolation (Cross-Creative Bug)
- **Finding:** Meta carousel ads had headline, URL, and thumbnail from a pet product, but video from a Bluetooth speaker.
- **Affected Functions:** `normalizeMetaCollectorAd()` in `src/services/discovery/normalization/normalizeMetaCollectorAd.ts`.
- **Root Cause:** The normalizer picked `primaryCreative` for headline and URL, but later scanned `ad.creatives` globally and took `firstVideo = creatives.find(c => c.videoUrl)`, assigning a speaker video to a pet product.
- **Fix:** Strictly bound headline, bodyText, callToAction, landingPageUrl, image thumbnail, and videoUrl to `primaryCreative`. If `primaryCreative` has no video, `videoUrl` remains `null`. Added `parentAdExternalId` and `selectedCreativeIndex` to `sourceEvidence`.
- **Evidence:** Unit tests in `ProductIntelligence.test.ts` ("prevents cross-creative media leakage in multi-product carousel ads").

### 5. Product Identity & Clean Metadata Extraction
- **Finding:** Product identity relied on raw ad headlines, causing clickbait titles ("Hidden Dangers") or campaign codes ("Ad50fb", "Wmt004 1") to be treated as product names.
- **Affected Functions:** `classifyAdvertisingHeadline()`, `classifyAdvertisingHeadlineRaw()` in `src/services/kh02/identity/adHeadlineClassifier.ts`, `resolveProductIdentity()` in `src/services/kh02/identity/productIdentityResolver.ts`.
- **Root Cause:** Lack of pattern recognition for editorial hooks, internal ad IDs, and structured slug extraction.
- **Fix:** Added regex classification for clickbait hooks ("Hidden Dangers", "Why Dogs Hate..."), internal campaign codes (`Ad\d+[a-z]+`, `Wmt\d+`), extracted model numbers (`Gg002 L1`), and normalized Shopify product slugs into clean product handles.
- **Evidence:** Verified in `PRODUCT_IDENTITY_REPORT.json` and unit tests in `ProductIntelligence.test.ts`.

### 6. Google Ads Transparency MCP: Standalone vs Same-Run
- **Finding:** Standalone Chewy lookup succeeded, but same-run candidate enrichment was never executed or proven.
- **Affected Functions:** `runEvergreenProductResearch()` in `src/services/kh02/evergreenResearchOrchestrator.ts`, `collectGoogleAdvertiserSignals()` in `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`.
- **Root Cause:** Candidate store domains were not routed into Google MCP domain lookup during the research run.
- **Fix:** Integrated candidate domain extraction with Google MCP `searchAdvertiserByDomain()`. Confirmed domains trigger creative queries; candidates without domains are explicitly marked `SKIPPED_NO_CONFIRMED_DOMAIN`.
- **Evidence:** Same-run enrichment verified in `GOOGLE_SAME_RUN_ENRICHMENT.json` and `GOOGLE_STANDALONE_QUERY.json`.

### 7. Acceptance Runner Self-Comparison Flaw
- **Finding:** Runner constructed source and DB expected/actual data from the exact same observations object (`evaluateGateD07(container, container)`).
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts` (Phase 11).
- **Root Cause:** Flawed test scaffolding that compared an object against itself rather than reading from Prisma DB.
- **Fix:** Rewrote Layer 1 and Layer 2 reconciliation. Layer 1 independently reads `prisma.discoveryRunAd` for `authoritativeRunId` and compares against upstream `providerTelemetry.META_ADS.auditTraces`. Layer 2 reads DB snapshot and compares against independent HTTP API response.
- **Evidence:** `SINGLE_RUN_RECONCILIATION.json` and `SOURCE_DB_RECONCILIATION.json` (`exactMatch: true`, 0 lost records).

### 8. Schema Mismatch in Acceptance Observations Accessor
- **Finding:** Runner read `dbResult.sourceObservations` which was not populated in the return schema.
- **Affected Functions:** `evergreenResearchOrchestrator.ts`, `runAcceptanceV12_3.ts`.
- **Root Cause:** Orchestrator returned candidates and telemetry but omitted `sourceObservations` at top level.
- **Fix:** Added `sourceObservations?: SourceObservation[]` to `EvergreenLeaderboardResult` and populated it in orchestrator. Exported `extractResearchRunEvidence()`.
- **Evidence:** Validated in `tests/unit/kh02V12_3_ProductIntelligence.test.ts`.

### 9. Literal PASS Verdict Shortcuts Removed
- **Finding:** Acceptance runner hardcoded `META_CONNECTION_VERDICT: "PASS"` and other verdicts unconditionally.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts`.
- **Root Cause:** Hardcoded strings in acceptance script matrix.
- **Fix:** Replaced all literal strings with dynamic boolean checks (`metaConnectionPass`, `metaLiveQueryPass`, `metaIngestionPass`, `sourceDbReconciliation.exactMatch`, etc.).
- **Evidence:** `RELEASE_GATE_RESULTS.json` dynamically computed from runtime execution.

### 10. REAL_SOURCE_E2E Rigorous Multi-Tier Requirements
- **Finding:** `REAL_SOURCE_E2E` verdict was based solely on `pageLoaded` and `terminalStateObserved`.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts`.
- **Root Cause:** Superficial check that did not verify reconciliation or rendered candidate cards.
- **Fix:** Required `authoritativeRunId`, `pageLoaded`, `terminalStateObserved`, `sourceDbReconciliation.exactMatch`, `dbHttpReconciliation.verdict === "PASS"`, `httpBrowserReconciliation.exactMatch`, `postReloadConsistent`, and non-zero candidates for non-empty track.
- **Evidence:** Passing all 8 criteria in `HTTP_BROWSER_RECONCILIATION.json`.

### 11. Single-Run Reconciliation Integrity Propagation
- **Finding:** Single-run reconciliation failures did not prevent `REAL_SOURCE_E2E` from passing.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts`.
- **Root Cause:** Disconnected verdict variables.
- **Fix:** `realSourceE2EPass` explicitly requires `reconciliationVerdict === "PASS"`. If Layer 1, 2, or 3 fails, E2E strictly fails.
- **Evidence:** Verified by mutation Case 1 in `FALSE_PASS_MUTATIONS.json`.

### 12. Real Next.js Production Build Validation
- **Finding:** `buildPassed` was inferred from typecheck and lint, without running `next build`.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts` (Phase 3).
- **Root Cause:** Developer shortcut in acceptance script.
- **Fix:** Executed `npm run build` directly and verified exit code 0 (52/52 routes statically/dynamically optimized).
- **Evidence:** Phase 3 console log: `Typecheck: PASS, Lint: PASS, Build: PASS`.

### 13. Google MCP Same-Run Status Accuracy
- **Finding:** Candidates without store domains were given `SUCCEEDED_EMPTY` instead of accurate status.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts`, `googleTransparencyResearchAdapter.ts`.
- **Root Cause:** Over-generalization of empty results.
- **Fix:** Differentiated `SKIPPED_NO_CONFIRMED_DOMAIN`, `NOT_RUN`, `QUERY_FAILED`, `SUCCEEDED_EMPTY`, and `ENRICHED`.
- **Evidence:** `GOOGLE_SAME_RUN_ENRICHMENT.json`.

### 14. Demand History Truthful External Blocker Reporting
- **Finding:** Demand history was reported based on presence of API key in environment without validating actual connection.
- **Affected Functions:** `scripts/kh02/runAcceptanceV12_3.ts` (Phase 8), `evergreenResearchOrchestrator.ts`.
- **Root Cause:** Conflating configured status with live verification.
- **Fix:** Missing `SERPAPI_API_KEY` is explicitly reported as `BLOCKED_EXTERNAL_REQUIREMENT`. Does not penalize software code gates, but keeps evergreen qualification at `PROVISIONAL`.
- **Evidence:** `DEMAND_HISTORY_REPORT.json` and `RELEASE_GATE_RESULTS.json`.

### 15. Search Input Validation (No Silent Pet Fallback)
- **Finding:** Submitting an empty search input silently fell back to searching "Pet Gadgets".
- **Affected Functions:** `src/app/products/page.tsx`, `src/app/api/v1/kh02/research/route.ts`.
- **Root Cause:** `executeResearch` had `topic.trim() || "Pet Gadgets"`.
- **Fix:** Blocked empty/whitespace submissions, disabled Analyze button when input `< 2` characters, prevented Enter key submission, and added Zod `.trim().min(2)` in API schema.
- **Evidence:** Unit tests and browser E2E empty input test.

### 16. UI Heading Persisted Run Topic Binding
- **Finding:** UI results heading displayed draft input instead of the persisted topic of the active run.
- **Affected Functions:** `src/app/products/page.tsx`.
- **Root Cause:** Heading used `topic` state rather than `leaderboard.topic`.
- **Fix:** Bound heading to `leaderboard?.topic || activeRunTopic || topic`. Added explicit subtitle `(Kết quả lần tìm trước: "${leaderboard.topic}")` when draft input differs from rendered leaderboard.
- **Evidence:** Validated in Chromium browser run and unit tests.

### 17. Deterministic Product Deduplication
- **Finding:** Deduplication relied loosely on advertiser name and raw titles, causing duplicates of identical catalog products.
- **Affected Functions:** `discoverProductCandidatesFromAds()` in `src/services/kh02/identity/productCandidateDiscovery.ts`.
- **Root Cause:** Inconsistent candidate keys when store domain was missing.
- **Fix:** Grouped candidates by canonical handle/domain or advertiser + clean product name, with deterministic candidate IDs.
- **Evidence:** Two ads for "Sunflower Kids Sunglasses" consolidated into 1 card (`PRODUCT_DEDUP_REPORT.json`).

### 18. Grounded Customer Psychology (No Arbitrary Length Heuristics)
- **Finding:** Ad descriptions with `length > 15` were automatically marked `OBSERVED`, creating hallucinated claims (e.g. washable cover, joint relief for simple dog beds).
- **Affected Functions:** `analyzeCustomerPsychology()` in `src/services/kh02/psychology/customerPsychologyService.ts`.
- **Root Cause:** Weak heuristic that assumed long ad copy implied observed proof.
- **Fix:** Replaced length heuristic with explicit substring matching from copy text. Unmatched claims remain `INFERRED` or `HYPOTHESIS`. Product archetypes prevent cross-category claim leakage.
- **Evidence:** Minimal "Dog bed" produces no shedding or vacuum claims; unit tests in `ProductIntelligence.test.ts` verify claim grounding.
