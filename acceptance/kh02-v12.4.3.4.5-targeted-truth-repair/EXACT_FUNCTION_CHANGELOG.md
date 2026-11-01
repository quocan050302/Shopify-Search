# KH-02 V12.4.3.4.5 — Exact Function Changelog & Architectural Repair

## 1. Chromium Isolation, Parity & Deep Assertions (`scripts/kh02/chromiumAcceptanceService.ts`)
- **`startIsolatedAcceptanceServer({ port, logFilePath, signal })`**:
  - Starts Next.js on port 3001 using fresh production build from `.next`.
  - Captures child process PID, redirects logs, probes `/products` readiness with 30s timeout, fails closed on exit or timeout.
- **`runLiveChromiumAcceptance({ baseUrl, researchRunId, shortlistCandidates, screenshotsDir })`**:
  - Launches headless Playwright Chromium.
  - Navigates to `/products?runId=${runId}&topic=Pet+Gadgets&tab=RECOMMENDED`. Asserts response HTTP 200.
  - Interacts with `pf-view-research-btn` product drawer, takes full-page screenshot.
  - Performs genuine HTTP GET to `/api/v1/research/products/[id]/overview`, validates JSON body.
  - Does NOT swallow navigation or assertion exceptions; records real failures and returns detailed metrics.
- **`reconcileSqliteHttpChromium({ candidates, httpData, domData })`**:
  - Compares candidateId, storeDomain, identityStatus, title between SQLite, HTTP API, and DOM.
  - Strictly requires comparedCandidateCount > 0 and 0 field discrepancies.
- **`assessReadOnlyMutation(fn)`**:
  - Takes DB count snapshots before and after GET requests to prove zero database mutations occur on read.
- **`computeChromiumGate(execution, parity, readOnly)`**:
  - Derives gate G24 dynamically from all underlying execution predicates.
- **`runChromiumFailureInjections()`**:
  - Executes 8 negative test scenarios verifying server down, nav failure, missing elements, and DB mutations are rejected.

## 2. Dynamic Google MCP Retrieval & Creative Pipeline Evaluation (`scripts/kh02/googleMcpGateEvaluator.ts`)
- **`evaluateGoogleMcpGates({ researchRunId, telemetry, rawManifest, normalizationLedger, associationLedger })`**:
  - Derives G06 status dynamically: PASS when live creatives are retrieved and pipeline invariants hold.
  - Distinguishes exact SKU matching from probable product matches without false downgrade to "0 creatives".
- **Measured Latencies**:
  - Removed all fabricated fallback durations (20ms, 120ms, 350ms, 15ms, Math.max(10, total-500)); uses real measured `durationMs` from MCP `stepTimeline` or records `null`.
- **`runGoogleGateNegativeTests()`**:
  - Validates 4 negative scenarios including invariant mismatch, transport failure, and empty retrieval.

## 3. Strict G16 Top-3 Verification & Anti-Gaming Identity (`scripts/kh02/g16CandidateEvaluator.ts`)
- **`evaluateG16Candidate(candidate, currentResearchRunId)`**:
  - Multi-predicate check: identityStatus=VERIFIED + merchant store domain + canonical URL + valid same-run live observation lineage.
  - Strictly enforces CheckoutChamp sales funnels (e.g. `cc.uprootclean.com`) as PROBABLE under anti-gaming identity rules.
- **`evaluateG16Top3(shortlistCandidates, currentResearchRunId)`**:
  - Dynamically computes `verifiedLiveCount` (2/3) and sets `g16Verdict: "INSUFFICIENT_EVIDENCE"`.
- **`runG16NegativeTests()`**:
  - Validates 4 negative scenarios including VERIFIED with 0 live obs, PROBABLE with live obs, and funnel promotion rejection.

## 4. Deep JUnit Validation & Physical File-Mutation Negative Controls (`scripts/kh02/acceptanceValidatorV12_4_3_4_5.ts`)
- **Deep JUnit Inspection (`CHK_03`)`**:
  - Validates XML structure, requires >= 400 testcases, and 0 failures.
- **Dynamic Gate Derivation (`computeEngineeringVerdict`)`**:
  - Evaluates all mandatory engineering gates dynamically.
- **Physical Disk File Mutations (`runNegativeControlSuite`)`**:
  - Replaced in-memory mock checks with physical file mutations on disk in isolated temporary directory.
  - Injects 12 distinct anomalies (corrupt status, failed nav, mutated DB, score mismatch, stale SHA, broken XML, fake BigQuery, broken invariants, future leakage, false funnel upgrade, failed build).
  - Asserts that the REAL validator rejects each corrupted artifact.

## 5. Runtime Version Parity (`src/services/kh02/version/runtimeVersionService.ts`, `next.config.ts`)
- Updated `SWAI_KH02_RELEASE_VERSION` and `NEXT_PUBLIC_SWAI_RELEASE_VERSION` to `12.4.3.4.5`.
- Aligned all corresponding test assertions.
