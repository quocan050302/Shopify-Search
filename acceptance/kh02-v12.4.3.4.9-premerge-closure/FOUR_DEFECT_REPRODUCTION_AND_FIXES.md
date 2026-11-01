# KH-02 V12.4.3.4.7 — Four Open Defect Reproduction & Fixes

## Defect 1: Synthetic HTTP Read-Only Success Under Disk Guard
- **Before**: `runFivePhaseAutoClosure.ts` called `assessReadOnlyMutation()` with a Prisma callback returning `{ status: 200, body: { ok: true } }` when disk was below 15 GB, causing `READ_ONLY_DB_CONTENT_INTEGRITY.json` to report `httpRequestVerified: true` and `readOnlyPassed: true` with zero HTTP requests.
- **Fix**: Added `verifySqliteReadOnlySnapshotIntegrity()` (`verificationScope: "DB_ONLY_READ_SNAPSHOT"`, `status: "HTTP_NOT_EXECUTED"`, `httpRequestVerified: false`, `readOnlyPassed: false`, `actualHttpRequestCount: 0`) and `probeRealReadOnlyOverviewApi()` (`transportVerified: true`, SHA-256 `responseBodyDigest`, `identityMatched: true`). Hardened `assessReadOnlyMutation()` to reject any callback lacking real HTTP transport proof (`verificationScope: "SYNTHETIC_CALLBACK_REJECTED"`).

## Defect 2: Fixed Integration Counts, Duplicate Test Failure Masking & Hardcoded JUnit Timing
- **Before**: `INTEGRATION_SUITE_REPORT.json` used `diskHeadroomOk ? 18 : 0`; `TEST_EXECUTION_TRUTH_TABLE.json` kept the first status when a test ran in multiple suites (masking later failures) and hardcoded `skippedTests: 0`; `JUNIT_RESULTS.xml` hardcoded `time="10"` and `time="0.01"`.
- **Fix**: Implemented `buildSuiteExecutionProof()`, `buildIntegrationSuiteReport()`, `buildTestExecutionTruthTable()`, and `renderAuthenticJUnitXml()`.

## Defect 3: Synthetic Google Creative Provenance & Candidate Fallback
- **Before**: `runFivePhaseAutoClosure.ts` fabricated `creativeId: 'cr_' + idx`, `providerRequestId: 'mcp_' + dbRunId`, `researchRunId: c.researchRunId || dbRunId`, `normRecords = rawCreatives.map(...)`, and `matchedCandidateId = a.candidateIdsEvaluated[0] || shortlistCandidates[0]?.candidateId`. `googleTransparencyResearchAdapter.ts` invented `google_cr_${advId}_${idx}`, and `evergreenResearchOrchestrator.ts` set `bestCandidateId = candidate.candidateId` on the `UNMATCHED` branch.
- **Fix**: Removed all synthetic ID and provenance fallbacks across adapter, orchestrator, closure script, and `googleMcpGateEvaluator.ts`. Added `isSyntheticCreativeId()`, `isSyntheticProviderRequestId()`, `replayModeDetected`, and negative tests `G06-NEG-11`..`G06-NEG-15`.

## Defect 4: Unchecked Production Build & Unowned Port Probing
- **Before**: `runFivePhaseAutoClosure.ts` called `spawnSync('npx', ['next', 'build'])` without checking `status`/`signal`/`.next/BUILD_ID` freshness and unconditionally launched `startIsolatedAcceptanceServer`.
- **Fix**: Implemented supervised `executeAndVerifyFreshProductionBuild()` verifying child PID, `exitCode === 0`, `signal === null`, no compile errors, and fresh `.next/BUILD_ID` mtime before allowing server/Chromium launch, and added pre-spawn port occupancy check (`checkPortInUse`) to `startIsolatedAcceptanceServer()`.
