# SWAI V11.5.7 — FUNCTION-BY-FUNCTION CHANGELOG
## KH-01 Final Evidence Integrity Verification Changelog

**Target release:** V11.5.7 — Final Evidence Integrity Hotfix  
**Tested Implementation Commit SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`  
**Acceptance Run ID:** `kh01_rel_1792914049487_4baa2295`  
**Branch:** `feature/v11-meta-collector-remove-muse`  

---

### FUNCTION 1: `verifyLiveMetaSource()`
- **FUNCTION:** `verifyLiveMetaSource()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Allowed fixture/mock mode to proceed if `--live-meta` was passed while `SWAI_MOCK_META_BOUNDARY=true` was inherited in the environment, creating potential false-positive `LIVE_RECONCILED` awards.
- **ROOT CAUSE:** Did not assert source mode exclusivity, did not verify provider transport marker (`caps.transport !== "mock_test_boundary"`), and did not verify valid ads count (`validCount > 0`).
- **INPUT CONTRACT:** `options: FullKh01AcceptanceOptions` (`runLiveSource?: boolean`, `approvedLiveSourceUrl?: string`).
- **OUTPUT CONTRACT:** `Promise<LiveMetaVerificationResult>` (`status: "NOT_RUN" | "PASSED" | "FAILED" | "BLOCKED"`, `detailedOutcome`, `levelsVerified`, `evidenceReferences`).
- **EXACT EXECUTION STEPS:**
  1. Checks if `options.runLiveSource` is truthy; if false, immediately returns `NOT_RUN` with 0 counts.
  2. Resolves source mode via `resolveAcceptanceSourceMode()`.
  3. Calls `assertNoMockSourceForLiveAcceptance()` to fail fast if mock flags exist.
  4. Allocates isolated database and verifies provider configuration.
  5. Starts worker subprocess with `{ sourceMode: "REAL_LIVE_META" }`.
  6. Executes live research through worker; checks provider transport and ad count.
  7. Returns `PASSED` only if genuine live upstream records were collected and reconciled.
- **FUNCTIONS CALLED:** `resolveAcceptanceSourceMode()`, `assertNoMockSourceForLiveAcceptance()`, `verifyAcceptanceDatabaseIdentity()`, `startIsolatedAcceptanceWorker()`, `executeLiveResearchThroughWorker()`.
- **DATABASE OPERATIONS:** Allocates isolated test database via `createIsolatedTestDatabase()`, seeds workspace and data source records.
- **NETWORK OPERATIONS:** Optional TCP loopback communication with MCP collector and live Meta endpoints.
- **FILESYSTEM OPERATIONS:** None directly (delegated to test DB creation).
- **ERROR HANDLING:** Traps configuration/assertion errors, catches provider restrictions and rate limits, returning structured `BLOCKED` with detailed outcome.
- **SECURITY BOUNDARY:** Rejects mock boundary injection into live verification pipeline.
- **TEST FILE:** `tests/unit/kh01LiveSourceIntegrity.test.ts`
- **EXACT TEST NAME:** `returns BLOCKED with reason when runLiveSource is true but SWAI_MOCK_META_BOUNDARY is set`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/live-source-results.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Mock Meta fixtures strictly blocked from live verification.

---

### FUNCTION 2: `assertNoMockSourceForLiveAcceptance()`
- **FUNCTION:** `assertNoMockSourceForLiveAcceptance()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Need for an authoritative assertion gate preventing mock configuration from polluting live acceptance.
- **INPUT CONTRACT:** `input: { sourceMode: AcceptanceSourceMode; environment: NodeJS.ProcessEnv | Record<string, string | undefined>; providerTransport?: string; providerSourceType?: string; }`
- **OUTPUT CONTRACT:** `void` (Throws classified error on violation).
- **EXACT EXECUTION STEPS:**
  1. Inspects `input.sourceMode`.
  2. If `sourceMode === "REAL_LIVE_META"`, inspects `environment.SWAI_MOCK_META_BOUNDARY`.
  3. Rejects any non-empty, non-false value with `LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN`.
  4. Inspects `input.providerTransport` and rejects `"mock_test_boundary"`.
  5. Inspects `input.providerSourceType` and rejects `"TEST_FIXTURE"`.
- **FUNCTIONS CALLED:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Throws `Error("LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: ...")`.
- **SECURITY BOUNDARY:** Trust boundary guard ensuring live claims strictly match authentic upstream execution.
- **TEST FILE:** `tests/unit/kh01LiveSourceIntegrity.test.ts`
- **EXACT TEST NAME:** `throws LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN when sourceMode is REAL_LIVE_META and SWAI_MOCK_META_BOUNDARY is true`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/stage-results.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 6/6 boundary condition tests passed.

---

### FUNCTION 3: `startIsolatedAcceptanceWorker()`
- **FUNCTION:** `startIsolatedAcceptanceWorker()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Subprocess environment inherited `SWAI_MOCK_META_BOUNDARY` indiscriminately without checking `sourceMode`.
- **ROOT CAUSE:** Absence of explicit `sourceMode` parameter in `AcceptanceWorkerOptions`.
- **INPUT CONTRACT:** `context: LiveAcceptanceContext, options?: AcceptanceWorkerOptions`
- **OUTPUT CONTRACT:** `Promise<AcceptanceWorkerHandle>` (`pid: number`, `waitForClaim()`, `waitForCompletion()`, `stop()`).
- **EXACT EXECUTION STEPS:**
  1. Verifies database isolation for `context.databaseUrl`.
  2. Resolves `sourceMode` (defaults to `"OFFLINE_FIXTURE"` if mock present).
  3. If `sourceMode === "REAL_LIVE_META"`, validates `assertNoMockSourceForLiveAcceptance()`.
  4. Sanitizes environment: for real live mode, sets `SWAI_MOCK_META_BOUNDARY: ""`.
  5. Spawns child process using local `tsx` CLI and `scripts/discovery-worker.ts`.
  6. Captures child PID, waits 800ms to verify no premature crash, and returns handle.
- **FUNCTIONS CALLED:** `verifyAcceptanceDatabaseIdentity()`, `assertNoMockSourceForLiveAcceptance()`, `spawn()`.
- **DATABASE OPERATIONS:** None directly.
- **NETWORK OPERATIONS:** None directly.
- **FILESYSTEM OPERATIONS:** Checks `tsxCli` and `workerScript` exist.
- **ERROR HANDLING:** Throws on unverified database, missing scripts, or premature child exit.
- **SECURITY BOUNDARY:** Child process environment isolation and active DB protection.
- **TEST FILE:** `tests/integration/kh01ActualWorkerProcess.test.ts`
- **EXACT TEST NAME:** `launches real child discovery-worker.ts subprocess with genuine OS PID and isolated DB`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/worker-process-evidence.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Real subprocess execution with genuine PID.

---

### FUNCTION 4: `createMetaCollectorClient()`
- **FUNCTION:** `createMetaCollectorClient()`
- **FILE:** `src/services/discovery/metaCollector/metaCollectorMcpClient.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Returned mock Meta client whenever `SWAI_MOCK_META_BOUNDARY === "true"`, regardless of acceptance source mode.
- **ROOT CAUSE:** Lack of defense-in-depth guard against live acceptance execution.
- **INPUT CONTRACT:** None (`() => Promise<MetaCollectorClient>`).
- **OUTPUT CONTRACT:** `Promise<MetaCollectorClient>`
- **EXACT EXECUTION STEPS:**
  1. Checks `process.env.SWAI_MOCK_META_BOUNDARY`.
  2. Checks `process.env.SWAI_ACCEPTANCE_SOURCE_MODE`.
  3. If mock is requested and `SWAI_ACCEPTANCE_SOURCE_MODE === "REAL_LIVE_META"`, immediately throws `DiscoveryError(PROVIDER_RESPONSE_INVALID, LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN)`.
  4. If mock requested in offline mode, returns mock client with 3 predefined ads.
  5. Otherwise, connects to Python MCP server via stdio.
- **FUNCTIONS CALLED:** `DiscoveryError()`, `spawn()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** Stdio IPC with local Python process.
- **FILESYSTEM OPERATIONS:** Validates local virtualenv python executable.
- **ERROR HANDLING:** Throws `DiscoveryError` on invalid configurations or forbidden boundaries.
- **SECURITY BOUNDARY:** Defense-in-depth protection at the client factory level.
- **TEST FILE:** `tests/unit/kh01LiveSourceIntegrity.test.ts`
- **EXACT TEST NAME:** `throws when SWAI_MOCK_META_BOUNDARY is true and SWAI_ACCEPTANCE_SOURCE_MODE is REAL_LIVE_META`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/stage-results.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Mock client blocked in live mode.

---

### FUNCTION 5: `collectDatabaseIsolationEvidence()`
- **FUNCTION:** `collectDatabaseIsolationEvidence()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (REWRITTEN)
- **OLD BEHAVIOR:** Wrote a `<database>.probe` text file on the filesystem and read it back, comparing mtime.
- **ROOT CAUSE:** Filesystem probe does not prove SQLite database connectivity, transaction execution, or active `dev.db` protection.
- **INPUT CONTRACT:** `context: { acceptanceRunId: string; commitSha: string; }`
- **OUTPUT CONTRACT:** `Promise<DatabaseIsolationEvidence>` (`status`, `expectedDatabaseKey`, `prismaConnectionVerified`, `markerWriteVerified`, `markerReadVerified`, `activeDatabaseProtected`).
- **EXACT EXECUTION STEPS:**
  1. Calls `createDatabaseIsolationProbe()` to create isolated SQLite DB.
  2. Writes unique marker row to isolated database via Prisma.
  3. Reads back marker row through Prisma and verifies identity.
  4. Verifies active application database (`dev.db`) is protected and does not contain the marker.
  5. Tears down isolated test database.
  6. Returns structured `DatabaseIsolationEvidence`.
- **FUNCTIONS CALLED:** `createDatabaseIsolationProbe()`, `writeAndReadDatabaseMarker()`, `canonicalizeSqliteDatabasePath()`, `@libsql/client.createClient()`.
- **DATABASE OPERATIONS:** SQLite INSERT and SELECT on isolated DB; SELECT on active `dev.db`.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Creates and tears down isolated database file.
- **ERROR HANDLING:** Catches connection or query failures, recording errors in evidence.
- **SECURITY BOUNDARY:** Confirms isolation and active database protection.
- **TEST FILE:** `tests/integration/kh01DatabaseIsolation.test.ts`
- **EXACT TEST NAME:** `guarantees writes to isolated test database never touch dev.db`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/database-isolation.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Prisma-backed database isolation proof.

---

### FUNCTION 6: `writeAndReadDatabaseMarker()`
- **FUNCTION:** `writeAndReadDatabaseMarker()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Required function to prove actual Prisma database transaction write and readback.
- **INPUT CONTRACT:** `probeContext: DatabaseProbeContext, marker: { markerId: string; markerName: string; }`
- **OUTPUT CONTRACT:** `Promise<{ writeSuccess: boolean; readSuccess: boolean; observedMarker: any; error?: string; }>`
- **EXACT EXECUTION STEPS:**
  1. Executes `probeContext.prisma.workspace.create()` with unique `markerId`.
  2. Executes `probeContext.prisma.workspace.findUnique()` for `markerId`.
  3. Compares observed record ID and attributes against expected values.
  4. Returns verification result.
- **FUNCTIONS CALLED:** `prisma.workspace.create()`, `prisma.workspace.findUnique()`.
- **DATABASE OPERATIONS:** INSERT into Workspace table, SELECT from Workspace table in isolated SQLite DB.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Catches Prisma query exceptions and returns structured error.
- **SECURITY BOUNDARY:** Operates strictly on isolated test database.
- **TEST FILE:** `tests/integration/kh01DatabaseIsolation.test.ts`
- **EXACT TEST NAME:** `proves test database is strictly isolated from active application database`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/database-isolation.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Real Prisma marker write/read verified.

---

### FUNCTION 7: `verifyDatabaseIdentityAcrossProcesses()`
- **FUNCTION:** `verifyDatabaseIdentityAcrossProcesses()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Required cross-process proof that Worker, Next.js, and verifier connect to the exact same isolated database.
- **INPUT CONTRACT:** `probeContext: DatabaseProbeContext, processes: { processName: string; databaseUrl: string; }[]`
- **OUTPUT CONTRACT:** `Promise<{ crossProcessVerified: boolean; observedKeys: string[]; error?: string; }>`
- **EXACT EXECUTION STEPS:**
  1. Resolves canonical key of `probeContext.expectedDatabaseKey`.
  2. For each registered process handle, canonicalizes its configured database URL.
  3. Verifies that all observed keys match the expected key exactly.
  4. Returns cross-process identity result.
- **FUNCTIONS CALLED:** `canonicalizeSqliteDatabasePath()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Returns error on key mismatch.
- **SECURITY BOUNDARY:** Prevents multi-process database divergence.
- **TEST FILE:** `tests/integration/kh01DatabaseIsolation.test.ts`
- **EXACT TEST NAME:** `strictly rejects test context pointing to development dev.db`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/database-process-identity.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Cross-process identity verified.

---

### FUNCTION 8: `buildCanonicalAcceptanceExecutionPlan()`
- **FUNCTION:** `buildCanonicalAcceptanceExecutionPlan()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Static list in plan was not strictly enforced against executed test suite reports.
- **ROOT CAUSE:** Decoupling between declared required suites and stage execution checks.
- **INPUT CONTRACT:** `registry?: AcceptanceGateDefinition[], options?: FullKh01AcceptanceOptions`
- **OUTPUT CONTRACT:** `AcceptanceExecutionPlan` (`planId`, `requiredSuites: string[]`, `mandatoryGateCount`, `optionalGateCount`).
- **EXACT EXECUTION STEPS:**
  1. Verifies canonical gate registry contains zero duplicate IDs.
  2. Formulates canonical 26-suite required list.
  3. Returns authoritative plan with plan ID `KH-01-V11.5.7-PLAN`.
- **FUNCTIONS CALLED:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Throws on duplicate gate IDs.
- **SECURITY BOUNDARY:** Canonical definition single-source-of-truth.
- **TEST FILE:** `tests/unit/kh01RequiredArtifactInventory.test.ts`
- **EXACT TEST NAME:** `passes when all 26 required suites are present and passed`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/suite-coverage.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Authoritative 26 required suites.

---

### FUNCTION 9: `collectExecutedSuiteEvidence()`
- **FUNCTION:** `collectExecutedSuiteEvidence()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist. Execution was inferred from stage exit code rather than parsing Vitest test file reports.
- **ROOT CAUSE:** Absence of per-test-file evidence collection from JSON test reports.
- **INPUT CONTRACT:** `stages: AcceptanceStageResult[], reports: { reportPath: string; stageId: string; exitCode: number; }[]`
- **OUTPUT CONTRACT:** `ExecutedSuiteEvidence[]`
- **EXACT EXECUTION STEPS:**
  1. For each report descriptor, checks if JSON report exists on disk.
  2. Parses Vitest JSON report structure (`testResults`).
  3. Normalizes each test file path relative to repo root.
  4. Aggregates passed, failed, and skipped assertion totals per test file.
  5. Returns array of `ExecutedSuiteEvidence`.
- **FUNCTIONS CALLED:** `fs.existsSync()`, `fs.readFileSync()`, `JSON.parse()`, `path.relative()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Reads Vitest JSON reports from acceptance scratch directory.
- **ERROR HANDLING:** Safely skips missing reports and records parsing errors.
- **SECURITY BOUNDARY:** Traps report tampering and path normalization.
- **TEST FILE:** `tests/unit/kh01RequiredArtifactInventory.test.ts`
- **EXACT TEST NAME:** `passes when all 26 required suites are present and passed`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/suite-coverage.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 26 suites collected from 10 parsed test reports.

---

### FUNCTION 10: `validateRequiredSuiteCoverage()`
- **FUNCTION:** `validateRequiredSuiteCoverage()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** No check existed to guarantee 100% of required suites were executed without failure or skips.
- **INPUT CONTRACT:** `requiredSuites: string[], executedSuites: ExecutedSuiteEvidence[]`
- **OUTPUT CONTRACT:** `SuiteCoverageResult` (`passed`, `totalRequired`, `totalExecuted`, `missingSuites`, `failedSuites`, `skippedOnlySuites`, `errors`).
- **EXACT EXECUTION STEPS:**
  1. Iterates through each required suite path.
  2. Performs exact normalized path lookup in executed evidence.
  3. Verifies that the suite executed (`actuallyExecuted === true`).
  4. Verifies that `failed === 0` and process exit code === 0.
  5. Verifies that `passed > 0` (rejects skipped-only suites).
  6. Returns `passed: true` only if all suites meet all criteria.
- **FUNCTIONS CALLED:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Records specific missing, failed, or skipped-only suite errors.
- **SECURITY BOUNDARY:** Strict exact-path matching; zero fuzzy or basename matching.
- **TEST FILE:** `tests/unit/kh01RequiredArtifactInventory.test.ts`
- **EXACT TEST NAME:** `fails when one required suite is missing`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/suite-coverage.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 26/26 suites passed.

---

### FUNCTION 11: `validateRequiredArtifactInventory()`
- **FUNCTION:** `validateRequiredArtifactInventory()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Allowed incomplete artifact sets to be published.
- **INPUT CONTRACT:** `artifacts: AcceptanceArtifactItem[], requestedScope: "OFFLINE" | "FULL_LIVE"`
- **OUTPUT CONTRACT:** `RequiredArtifactInventoryResult` (`valid`, `missingArtifacts`, `invalidArtifacts`, `errors`).
- **EXACT EXECUTION STEPS:**
  1. Resolves required filenames from `KH01_REQUIRED_ARTIFACTS` for `requestedScope`.
  2. Verifies presence of each required file in the artifact list.
  3. Verifies payload is non-null and non-empty.
  4. Enforces scope-specific invariants (e.g. `live-source-results.json` allowed `NOT_RUN` in offline, required `LIVE_RECONCILED` in full live).
  5. Returns validation result.
- **FUNCTIONS CALLED:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Records missing and invalid artifacts in error list.
- **SECURITY BOUNDARY:** Mandatory release gate blocking publication if any artifact is missing.
- **TEST FILE:** `tests/unit/kh01RequiredArtifactInventory.test.ts`
- **EXACT TEST NAME:** `fails when a required artifact like browser-results.json is missing`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/artifact-validation.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 23 required artifacts enforced.

---

### FUNCTION 12: `validateAcceptanceArtifactSet()`
- **FUNCTION:** `validateAcceptanceArtifactSet()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Checked non-empty set and manifest cross-fields, but did not enforce required artifact inventory.
- **ROOT CAUSE:** Inventory check was not hooked into the artifact set validation pipeline.
- **INPUT CONTRACT:** `set: AcceptanceArtifactSet, options?: { enforceInventory?: boolean; scope?: "OFFLINE" | "FULL_LIVE" }`
- **OUTPUT CONTRACT:** `{ valid: boolean; errors: string[] }`
- **EXACT EXECUTION STEPS:**
  1. Checks for non-empty artifact set.
  2. If `options.enforceInventory !== false`, runs `validateRequiredArtifactInventory()`.
  3. Validates duplicate filenames and path traversal attempts.
  4. Calls `validateAcceptanceArtifact()` on each artifact.
  5. Cross-checks manifest verdict against release-verdict and execution metadata.
  6. Returns validity and error list.
- **FUNCTIONS CALLED:** `validateRequiredArtifactInventory()`, `validateAcceptanceArtifact()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Accumulates all validation errors into array.
- **SECURITY BOUNDARY:** Pre-publication gate.
- **TEST FILE:** `tests/unit/kh01ArtifactIntegrity.test.ts`
- **EXACT TEST NAME:** `publishAcceptanceArtifactsAtomically blocks publication and does not update latest.json when validation fails`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/artifact-validation.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Full inventory and cross-manifest integrity validated.

---

### FUNCTION 13: `publishAcceptanceArtifactsAtomically()`
- **FUNCTION:** `publishAcceptanceArtifactsAtomically()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Published only JSON files to `artifacts/v11.5.6/`; screenshots were stored in a shared directory outside the run directory.
- **ROOT CAUSE:** Lack of screenshot staging and run-specific directory immutability.
- **INPUT CONTRACT:** `set: AcceptanceArtifactSet, options?: ArtifactPublicationOptions`
- **OUTPUT CONTRACT:** `Promise<ArtifactPublicationResult>` (`success`, `publishedRunDir`, `latestPointerPath`, `checksums`, `errors`).
- **EXACT EXECUTION STEPS:**
  1. Resolves base directory (`artifacts/v11.5.7`) and staging directory (`.staging-<runId>`).
  2. Runs memory validation via `validateAcceptanceArtifactSet()`.
  3. Checks target run directory does not already exist (immutability).
  4. Stages verified screenshots into `stagingDir/screenshots/` and validates SHA256 hashes.
  5. Writes all JSON artifacts into `stagingDir/`.
  6. Reads back all files from disk, recalculates SHA256 checksums, and validates schemas.
  7. Atomically renames `stagingDir` to `targetRunDir`.
  8. Atomically writes `latest.json` pointing to the new immutable run directory.
  9. Returns publication result with checksums.
- **FUNCTIONS CALLED:** `validateAcceptanceArtifactSet()`, `stageScreenshotArtifacts()`, `validateAcceptanceArtifact()`, `fs.renameSync()`, `crypto.createHash()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Atomic directory rename, file writes, and disk readback.
- **ERROR HANDLING:** On validation failure, cleans up staging directory and leaves `latest.json` unchanged.
- **SECURITY BOUNDARY:** Immutability protection and atomic latest pointer update.
- **TEST FILE:** `tests/unit/kh01ArtifactIntegrity.test.ts`
- **EXACT TEST NAME:** `publishAcceptanceArtifactsAtomically writes to staging, verifies disk readback, renames atomically, and updates latest.json`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/latest.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Atomic publication to `artifacts/v11.5.7/<acceptanceRunId>/`.

---

### FUNCTION 14: `collectScreenshotEvidence()`
- **FUNCTION:** `collectScreenshotEvidence()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Viewport screenshots were not tracked as structured evidence with size, timestamp, and SHA256 hashes.
- **INPUT CONTRACT:** `screenshotDir: string, context: { acceptanceRunId: string }`
- **OUTPUT CONTRACT:** `Promise<ScreenshotEvidence[]>`
- **EXACT EXECUTION STEPS:**
  1. Normalizes screenshot directory path and checks for path traversal.
  2. Iterates across 6 canonical viewports (`1920x1080`, `1440x900`, `1280x800`, `1024x768`, `768x1024`, `390x844`).
  3. Checks file existence and reads file size.
  4. Computes SHA256 hash of file buffer.
  5. Determines associated status (`PASSED` if exists and size > 0, else `FAILED`).
  6. Returns array of `ScreenshotEvidence`.
- **FUNCTIONS CALLED:** `fs.existsSync()`, `fs.statSync()`, `fs.readFileSync()`, `crypto.createHash()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Inspects and reads PNG screenshot files in scratch directory.
- **ERROR HANDLING:** Traps missing or unreadable files, returning `fileExists: false`.
- **SECURITY BOUNDARY:** Path traversal prevention.
- **TEST FILE:** `tests/unit/kh01ScreenshotEvidence.test.ts`
- **EXACT TEST NAME:** `collects all 6 canonical screenshots with valid SHA256 hashes`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/screenshot-manifest.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 6 canonical screenshots collected with SHA256.

---

### FUNCTION 15: `stageScreenshotArtifacts()`
- **FUNCTION:** `stageScreenshotArtifacts()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist.
- **ROOT CAUSE:** Absence of screenshot staging mechanism to copy scratch images into final run directory.
- **INPUT CONTRACT:** `screenshotEvidence: ScreenshotEvidence[], stagingDir: string`
- **OUTPUT CONTRACT:** `Promise<StagedScreenshotResult>` (`success`, `copiedCount`, `stagedScreenshots`, `errors`).
- **EXACT EXECUTION STEPS:**
  1. Creates `stagingDir/screenshots/`.
  2. For each screenshot evidence item, verifies source file exists.
  3. Copies file into staging directory via `fs.copyFileSync()`.
  4. Reads back copied file and calculates SHA256 checksum.
  5. Verifies copied checksum matches original evidence checksum.
  6. Returns staging result.
- **FUNCTIONS CALLED:** `fs.mkdirSync()`, `fs.copyFileSync()`, `fs.readFileSync()`, `crypto.createHash()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Copies files and recalculates disk hashes.
- **ERROR HANDLING:** Fails staging if file is missing, empty, or checksum mismatches.
- **SECURITY BOUNDARY:** Verifies cryptographic integrity of copied media.
- **TEST FILE:** `tests/unit/kh01ScreenshotEvidence.test.ts`
- **EXACT TEST NAME:** `stages all 6 valid screenshots and verifies checksum equality`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/screenshots/`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Staged and verified in immutable run directory.

---

### FUNCTION 16: `parseBrowserExecutionEvidence()`
- **FUNCTION:** `parseBrowserExecutionEvidence()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Checked viewport status and dimensions, but did not verify actual existence and non-zero byte size of referenced screenshots.
- **ROOT CAUSE:** Screenshot file validation was omitted from parsed browser evidence.
- **INPUT CONTRACT:** `filePath: string, acceptanceRunId: string`
- **OUTPUT CONTRACT:** `BrowserExecutionEvidence` (`valid`, `totalViewports`, `passedViewports`, `executions`, `error`).
- **EXACT EXECUTION STEPS:**
  1. Checks if browser viewport evidence file exists on disk.
  2. Parses JSON payload and verifies run ID matches.
  3. For each viewport marked `PASSED`, asserts `browserLaunched`, `pageNavigated`, and `domAssertionsExecuted > 0`.
  4. Asserts that `screenshotPath` exists on disk and `stat.size > 0`.
  5. Returns structured evidence with validity flag.
- **FUNCTIONS CALLED:** `fs.existsSync()`, `fs.statSync()`, `JSON.parse()`.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** Inspects screenshot paths.
- **ERROR HANDLING:** Returns `valid: false` if any passed viewport lacks navigation or screenshot.
- **SECURITY BOUNDARY:** Rejects empty or fabricated screenshots.
- **TEST FILE:** `tests/unit/kh01ArtifactIntegrity.test.ts`
- **EXACT TEST NAME:** `buildBrowserArtifact marks status FAILED when browser evidence contains only 2 of 6 viewports even if stage PASSED`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/browser-viewport-results.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — Viewport screenshots strictly verified.

---

### FUNCTION 17: `buildBrowserArtifact()`
- **FUNCTION:** `buildBrowserArtifact()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Did not accept `screenshots` evidence array, and did not require all 6 canonical screenshots to award `PASSED`.
- **ROOT CAUSE:** Decoupling of screenshot validation from browser artifact status.
- **INPUT CONTRACT:** `acceptanceRunId: string, stages: AcceptanceStageResult[], browserEvidence?: BrowserExecutionEvidence, screenshots?: ScreenshotEvidence[]`
- **OUTPUT CONTRACT:** Browser artifact payload (`status`, `viewportsTested`, `screenshots`, `evidenceFile`, `evidenceOrigin`).
- **EXACT EXECUTION STEPS:**
  1. Extracts browser assertions from stages.
  2. Verifies canonical 6 viewports were executed.
  3. Verifies `screenshots` array has 6 items and all 6 are non-empty with SHA256 hashes.
  4. Sets status to `PASSED` only if 6 viewports passed and 6 screenshots are valid.
  5. Returns formatted artifact.
- **FUNCTIONS CALLED:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **FILESYSTEM OPERATIONS:** None.
- **ERROR HANDLING:** Sets `status: "FAILED"` if canonical viewports or screenshots are incomplete.
- **SECURITY BOUNDARY:** Guarantees browser evidence completeness before release.
- **TEST FILE:** `tests/unit/kh01ArtifactIntegrity.test.ts`
- **EXACT TEST NAME:** `buildBrowserArtifact does not hardcode untested viewports when no tests ran`
- **ACTUAL TEST STATUS:** PASSED
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/browser-results.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — 6 viewports and 6 screenshots required.

---

### FUNCTION 18: `runFullKh01Acceptance()`
- **FUNCTION:** `runFullKh01Acceptance()`
- **FILE:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Missing `kh01RealHttpReadback.test.ts` execution, did not collect per-test suite coverage, used `.probe` file for DB proof, saved screenshots in shared directory, and did not enforce 23-artifact inventory.
- **ROOT CAUSE:** All four evidence integrity defects converged in the main acceptance orchestrator.
- **INPUT CONTRACT:** `options: FullKh01AcceptanceOptions` (`runLiveSource?: boolean`, `requestedScope?: "OFFLINE" | "FULL_LIVE"`, `offlineOnly?: boolean`).
- **OUTPUT CONTRACT:** `Promise<FullKh01AcceptanceReport>` (`overallStatus`, `manifest`, `stages`).
- **EXACT EXECUTION STEPS:**
  1. Verifies Git branch and commit SHA.
  2. Creates authoritative `acceptanceRunId`.
  3. Resolves requested scope and source mode.
  4. Builds execution plan with 26 required suites.
  5. Executes 13 stages (including `STAGE_04C_REAL_HTTP_READBACK` and `STAGE_08_META_DISCOVERY_BROWSER_E2E`).
  6. Collects executed suite evidence and validates coverage.
  7. Collects Prisma-backed database isolation evidence.
  8. Collects browser viewport evidence and scratch screenshot evidence.
  9. Executes live source verification (if requested, strictly blocking mock boundary).
  10. Prepares complete 23-file artifact set.
  11. Publishes atomically to `artifacts/v11.5.7/<acceptanceRunId>/` with staged screenshots.
  12. Atomically updates `latest.json`.
  13. Returns authoritative verdict (`CONDITIONALLY_ACCEPTED` for offline, `ACCEPTED` for verified live).
- **FUNCTIONS CALLED:** All acceptance helper functions across the pipeline.
- **DATABASE OPERATIONS:** Executes across isolated databases; validates active DB protection.
- **NETWORK OPERATIONS:** TCP server startup, HTTP readback, Chromium browser automation.
- **FILESYSTEM OPERATIONS:** Scratch test directory execution, atomic staging, publication, latest pointer update.
- **ERROR HANDLING:** Any stage, gate, coverage, or inventory failure results in `BLOCKED` verdict.
- **SECURITY BOUNDARY:** Complete KH-01 technical release acceptance contract boundary.
- **TEST FILE:** `scripts/kh01/runFullAcceptance.ts` (Full Acceptance Suite)
- **EXACT TEST NAME:** `npm run kh01:acceptance:full -- --offline-only`
- **ACTUAL TEST STATUS:** PASSED (13/13 Stages, 13/13 Mandatory Gates, Exit Code 0)
- **EVIDENCE FILE:** `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/acceptance-manifest.json`
- **TESTED COMMIT SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`
- **VERIFICATION RESULT:** VERIFIED — CONDITIONALLY_ACCEPTED (Offline fully verified, Live source NOT_RUN).
