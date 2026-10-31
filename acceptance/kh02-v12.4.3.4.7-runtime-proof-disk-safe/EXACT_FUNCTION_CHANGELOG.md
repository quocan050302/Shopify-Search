# KH-02 V12.4.3.4.7 — Exact Function Changelog

## 1. `scripts/kh02/chromiumAcceptanceService.ts`
- `verifySqliteReadOnlySnapshotIntegrity(db)`: Captures DB-only SHA-256 table digests and returns `verificationScope: "DB_ONLY_READ_SNAPSHOT"`, `status: "HTTP_NOT_EXECUTED"`, `httpRequestVerified: false`, `readOnlyPassed: false`, `actualHttpRequestCount: 0`.
- `probeRealReadOnlyOverviewApi(options)`: Performs real HTTP GET to `/api/v1/research/products/[id]/overview`, computes SHA-256 `responseBodyDigest`, and verifies `runId`, `candidateId`, and `productId` identity match.
- `assessReadOnlyMutation(fnToExecute, db)`: Rejects synthetic callbacks lacking `transportVerified === true` (`verificationScope: "SYNTHETIC_CALLBACK_REJECTED"`).
- `executeAndVerifyFreshProductionBuild(options)`: Supervised async production build checking child PID, `exitCode === 0`, `signal === null`, and `.next/BUILD_ID` freshness (`mtimeMs >= buildStartMs - 1000`).
- `checkPortInUse(port, host)` & `startIsolatedAcceptanceServer(options)`: Fails closed with `PORT_CONFLICT` if target port is already occupied before spawning `next start`.

## 2. `scripts/kh02/runFivePhaseAutoClosure.ts`
- `buildSuiteExecutionProof(summary, expectedSourceSha, parsedJsonOverride)`: Verifies child PID, exitCode, signal, SHA match, and JSON report existence.
- `buildIntegrationSuiteReport(params)`: Derives integration counts strictly from verified child Vitest JSON report; returns `NOT_EXECUTED`, `BLOCKED_RESOURCE`, `PARTIAL`, or `FAIL` when appropriate.
- `buildTestExecutionTruthTable(params)`: Rejects unverified suites, tracks `skippedTests`, and ensures any failure across duplicate test executions marks the unique test as `failed`.
- `renderAuthenticJUnitXml(truthTable)`: Emits real per-test and suite durations and `<skipped />` / `<failure>` tags.
- `queryAndEvaluateG15CandidateDemand(candidate, db)`: Queries `productDemandObservation` by exact `productId` / validated canonical `keyword` without 15-char substring matching or `.catch(() => [])`.

## 3. `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`, `src/services/kh02/evergreenResearchOrchestrator.ts`, `scripts/kh02/googleMcpGateEvaluator.ts`
- `fetchGoogleTransparencyCreatives(...)`: Records `providerInvocationRecords`, preserves `creative_id: null` instead of inventing `google_cr_*`, and records `MISSING_UPSTREAM_CREATIVE_ID` in `rejectedRecords`.
- `runEvergreenProductResearch(...)`: Keeps `matchedCandidateId = null` when verdict is `UNMATCHED` (removing `bestCandidateId = candidate.candidateId` overwrite).
- `isSyntheticCreativeId(id)`, `isSyntheticProviderRequestId(id, runId)`, `evaluateGoogleMcpGates(input)`: Rejects synthetic IDs, skipped normalization, inferred candidate IDs, and cached replay runs (`REPLAY_CACHED_OR_PREVIOUS_RUN`).

## 4. `scripts/kh02/runBacktestV12_4_3_4_2.ts` & `scripts/kh02/acceptanceValidatorV12_4_3_4_5.ts`
- `runRealHistoricalProductReplay()`: Excludes fixture/synthetic provenance records and tracks `adObservationOnlyCount` and `excludedFixtureRecordCount`.
- `validateAcceptanceArtifacts(acceptanceDir)` & `runNegativeControlSuite(baselineAcceptanceDir)`: Enforces V12.4.3.4.7 execution proofs and expands negative controls to 33 physical-file mutations (`MUT_01`..`MUT_33`).
