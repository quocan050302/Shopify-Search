# SWAI V11.5.8 — FUNCTION-BY-FUNCTION CHANGELOG
## KH-01 Final Acceptance Evidence Closure

**Target Release:** V11.5.8 — Final Acceptance Evidence Closure  
**Tested Implementation Commit SHA:** `edb2b146581b93242b85b94e7c4e7b14dfb258f1`  
**Acceptance Run ID:** `kh01_rel_1792923804096_ba1028ef`  
**Active Branch:** `feature/v11-meta-collector-remove-muse`  
**Operating Mode:** `RESEARCH_ONLY` | **Target Market:** United States (US)  

---

### FUNCTION 1: `observeDatabaseIdentityFromPrisma()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromPrisma()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Cross-process database identity evaluated string keys created within the test runner without executing an authenticated readback query from the Prisma probe boundary.
- **ROOT CAUSE:** FINAL-08-01: Lack of dedicated observation helper connecting directly through Prisma client to verify runtime marker persistence and canonical file path.
- **INPUT CONTRACT:** `prisma: PrismaClient`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>` (`processName: "PRISMA_VERIFIER"`, `processId: number`, `markerObserved: boolean`, `observedDatabaseKey: string`, `observationMethod: "PRISMA_QUERY"`)
- **EXACT EXECUTION STEPS:**
  1. Executes `prisma.workspace.findUnique({ where: { id: markerId } })`.
  2. Resolves active database configuration via `resolveDatabaseConfiguration()`.
  3. Canonicalizes SQLite file path via `canonicalizeSqliteDatabasePath()`.
  4. Verifies returned workspace record ID exactly matches `markerId`.
  5. Returns structured `ProcessDatabaseObservation` with `observationMethod: "PRISMA_QUERY"`.
- **DEPENDENCIES:** `@prisma/client`, `@/lib/database/databaseConfig`
- **DATABASE OPERATIONS:** Executes SQL query `SELECT * FROM Workspace WHERE id = ?` via Prisma Client.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None (local SQLite query).
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 2: `observeDatabaseIdentityFromWorker()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromWorker()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Worker database identity was inferred from runner environment or passed as synthetic parameters.
- **ROOT CAUSE:** FINAL-08-01: Worker executes in an independent OS child process; the parent supervisor had no mechanism to await and capture the worker's genuine startup database observation event.
- **INPUT CONTRACT:** `worker: AcceptanceWorkerHandle`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>` (`processName: "WORKER"`, `processId: number`, `markerObserved: boolean`, `observedDatabaseKey: string`, `observationMethod: "WORKER_PROCESS_EVENT"`)
- **EXACT EXECUTION STEPS:**
  1. Calls `worker.waitForDbObservation(8000)` to ensure child process finishes Prisma initialization and emits startup event.
  2. Retrieves observations via `worker.getDbObservations()`.
  3. Filters for observation matching `markerId` or `acceptanceRunId`.
  4. Resolves authentic OS child process PID from matched event.
  5. Returns `ProcessDatabaseObservation` with `observationMethod: "WORKER_PROCESS_EVENT"`.
- **DEPENDENCIES:** `AcceptanceWorkerHandle`, `ProcessDatabaseObservation`
- **DATABASE OPERATIONS:** None in supervisor; child worker process queries database and emits event.
- **WORKER OPERATIONS:** Communicates with active `discovery-worker.ts` subprocess via event buffer and stdout pipe.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 3: `observeDatabaseIdentityFromNextServer()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromNextServer()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** No Next.js server runtime database observation existed; server process was excluded from database identity verification.
- **ROOT CAUSE:** FINAL-08-01: Next.js server runs as an independent HTTP server process with its own PID and connection pool; no diagnostic endpoint existed to interrogate its active connection.
- **INPUT CONTRACT:** `server: { baseUrl?: string; url?: string }`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>` (`processName: "NEXTJS_SERVER"`, `processId: number`, `markerObserved: boolean`, `observedDatabaseKey: string`, `observationMethod: "HTTP_DATABASE_READBACK"`)
- **EXACT EXECUTION STEPS:**
  1. Resolves server loopback address from `server.baseUrl || server.url`.
  2. Constructs diagnostic URL: `${serverUrl}/api/v1/test/db-observation?markerId=${markerId}&acceptanceRunId=${acceptanceRunId}`.
  3. Executes HTTP GET with `Authorization: Bearer swai-acceptance-secret-token` and `x-acceptance-token`.
  4. Parses JSON response extracting `processId`, `observedDatabaseKey`, and `markerObserved`.
  5. Canonicalizes database key and returns `ProcessDatabaseObservation`.
- **DEPENDENCIES:** `fetch`, `@/lib/database/databaseConfig`
- **DATABASE OPERATIONS:** None in supervisor; Next.js server executes Prisma query internally.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** HTTP GET request over TCP loopback to Next.js server.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 4: `verifyActiveDatabaseMarkerAbsent()`
- **FUNCTION NAME:** `verifyActiveDatabaseMarkerAbsent()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Swallowed active database query errors in an empty catch block, returning `activeDatabaseProtected: true` even if the query failed or table was corrupted.
- **ROOT CAUSE:** FINAL-08-05: Missing fail-closed error handling in active database protection probe.
- **INPUT CONTRACT:** `activeAppDbRaw: string`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ActiveDatabaseProtectionEvidence>` (`status: "PASSED" | "FAILED" | "NOT_VERIFIED"`, `activeDatabaseProtected: boolean | null`, `error?: string`)
- **EXACT EXECUTION STEPS:**
  1. Checks if `activeAppDbRaw` exists on filesystem; if not, returns `PASSED` (leakage impossible).
  2. Connects to active development database using `@libsql/client`.
  3. Queries `sqlite_master` for table `Workspace`. If missing, returns `PASSED` (table absent).
  4. Queries `SELECT id FROM Workspace WHERE id = ?` passing `markerId`.
  5. If rows returned > 0: returns `FAILED` (`activeDatabaseProtected: false`).
  6. If 0 rows returned: returns `PASSED` (`activeDatabaseProtected: true`).
  7. On unexpected error: returns `NOT_VERIFIED` (`activeDatabaseProtected: null`), failing closed.
- **DEPENDENCIES:** `@libsql/client`, `fs`
- **DATABASE OPERATIONS:** Direct libSQL client queries against `dev.db`.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 5: `verifyDatabaseIdentityAcrossProcesses()`
- **FUNCTION NAME:** `verifyDatabaseIdentityAcrossProcesses()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Accepted simple `{ processName, databaseKey }` pairs without validating process boundary diversity or marker readback.
- **ROOT CAUSE:** FINAL-08-01: Permitted verification to pass without genuine cross-process observation evidence.
- **INPUT CONTRACT:** `context: DatabaseProbeContext`, `observations: ProcessDatabaseObservation[]`
- **OUTPUT CONTRACT:** `CrossProcessDatabaseEvidence` (`verified: boolean`, `observedProcesses`, `missingProcesses`, `mismatchedProcesses`, `sharedMarkerVerified`, `sharedRunVerified`)
- **EXACT EXECUTION STEPS:**
  1. Identifies mandatory process boundaries (`ACCEPTANCE_RUNNER`, `WORKER`, `NEXTJS_SERVER`).
  2. Ensures observations exist for each mandatory boundary.
  3. Canonicalizes observed keys and compares each against `context.expectedDatabaseKey`.
  4. Validates that every process reported `markerObserved === true`.
  5. If discovery run ID is present, validates `sharedRunVerified`.
  6. Returns `verified: true` only if all mandatory processes are present, keys match, and markers are confirmed.
- **DEPENDENCIES:** `DatabaseProbeContext`, `ProcessDatabaseObservation`, `CrossProcessDatabaseEvidence`
- **DATABASE OPERATIONS:** None (pure evidence evaluation).
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 6: `collectCrossProcessDatabaseEvidence()`
- **FUNCTION NAME:** `collectCrossProcessDatabaseEvidence()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Single-process Prisma isolation probe was conflated with multi-process verification.
- **ROOT CAUSE:** FINAL-08-01: Decoupling local probe verification from distributed cross-boundary verification.
- **INPUT CONTRACT:** `context: DatabaseProbeContext`, `observations: ProcessDatabaseObservation[]`
- **OUTPUT CONTRACT:** `CrossProcessDatabaseEvidence`
- **EXACT EXECUTION STEPS:**
  1. Standardizes observation timestamps and references.
  2. Invokes `verifyDatabaseIdentityAcrossProcesses(context, observations)`.
  3. Returns strongly typed `CrossProcessDatabaseEvidence`.
- **DEPENDENCIES:** `verifyDatabaseIdentityAcrossProcesses()`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 7: `collectDatabaseIsolationEvidence()`
- **FUNCTION NAME:** `collectDatabaseIsolationEvidence()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Cleaned up isolated test database prematurely in `finally {}` block before Worker and Next.js observations could be collected; swallowed active DB query exceptions.
- **ROOT CAUSE:** FINAL-08-01 & FINAL-08-05: Probe database destroyed before dependent child processes could inspect it.
- **INPUT CONTRACT:** `context: { acceptanceRunId: string; commitSha: string; isolatedDbUrl?: string }`
- **OUTPUT CONTRACT:** `Promise<DatabaseIsolationEvidence & { cleanup: () => Promise<void> }>`
- **EXACT EXECUTION STEPS:**
  1. Allocates isolated SQLite database and verifies non-equality with active development DB.
  2. Writes and reads test marker using Prisma client in isolated database.
  3. Executes `verifyActiveDatabaseMarkerAbsent()` with strict fail-closed checks.
  4. Keeps probe database alive and returns deferred `cleanup: async () => probe.cleanup()`.
- **DEPENDENCIES:** `createDatabaseIsolationProbe()`, `writeAndReadDatabaseMarker()`, `verifyActiveDatabaseMarkerAbsent()`
- **DATABASE OPERATIONS:** Creates temporary SQLite database, runs Prisma push, writes and reads `Workspace` marker, queries active app DB.
- **WORKER OPERATIONS:** None directly.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 8: `captureWorkerProviderProvenance()`
- **FUNCTION NAME:** `captureWorkerProviderProvenance()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Provenance was synthesized in runner from CLI options (`REAL_UPSTREAM` vs `TEST_FIXTURE`).
- **ROOT CAUSE:** FINAL-08-02: Missing formal contract capturing actual transport and request/response observations from inside the worker process.
- **INPUT CONTRACT:** `input: { acceptanceRunId: string; discoveryRunId: string; workerPid: number; requestedMode: string; providerId: string; actualTransport: string; observedSourceType: string; fixtureDetected: boolean; upstreamRequestExecuted: boolean; upstreamResponseObserved: boolean; upstreamResultSetId: string | null; upstreamAdIds: string[]; validAdsCollected: number; observedAt: string; errors?: string[]; }`
- **OUTPUT CONTRACT:** `ProviderSourceEvidence`
- **EXACT EXECUTION STEPS:**
  1. Validates all required provenance fields are provided.
  2. Sets `evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION"`.
  3. Returns strongly typed `ProviderSourceEvidence`.
- **DEPENDENCIES:** `ProviderSourceEvidence`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** Formats execution metadata captured from worker subprocess.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 9: `buildCrossBoundaryReconciliationArtifact()`
- **FUNCTION NAME:** `buildCrossBoundaryReconciliationArtifact()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Registered in required artifact inventory for `FULL_LIVE`, but never constructed or written to disk, breaking full-live runs.
- **ROOT CAUSE:** FINAL-08-03: Missing artifact generator function for cross-boundary reconciliation.
- **INPUT CONTRACT:** `input: { acceptanceRunId: string; testedCommitSha: string; discoveryRunId: string; databaseAdIds: string[]; httpAdIds: string[]; browserAdIds: string[]; providerEvidence: ProviderSourceEvidence | null; }`
- **OUTPUT CONTRACT:** `CrossBoundaryReconciliationEvidence`
- **EXACT EXECUTION STEPS:**
  1. Computes set differences between `databaseAdIds`, `httpAdIds`, and `browserAdIds`.
  2. Inspects `providerEvidence` ensuring `observedSourceType === "REAL_UPSTREAM"` and `fixtureDetected === false`.
  3. Asserts zero missing and zero unexpected ad IDs across all boundaries.
  4. Returns `CrossBoundaryReconciliationEvidence` with `status: "PASSED"` or `"FAILED"`.
- **DEPENDENCIES:** `ProviderSourceEvidence`, `CrossBoundaryReconciliationEvidence`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 10: `executeAcceptanceStage()`
- **FUNCTION NAME:** `executeAcceptanceStage()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Executed shell commands without capturing process PID, execution time window, or report SHA256 checksum in an execution envelope.
- **ROOT CAUSE:** FINAL-08-04: Test suites lacked cryptographic and supervisor execution attestation.
- **INPUT CONTRACT:** `stageId: string`, `name: string`, `command: string`, `acceptanceRunId: string`, `assertions: Array<{ id: string; type: GateEvidenceType; ... }>`, `reportPath?: string`, `envOverrides?: Record<string, string>`
- **OUTPUT CONTRACT:** `Promise<AcceptanceStageResult>` (includes `envelope: TestExecutionEnvelope`)
- **EXACT EXECUTION STEPS:**
  1. Records `startedAt = new Date().toISOString()`.
  2. Spawns child process passing `KH01_ACCEPTANCE_RUN_ID` and `KH01_TESTED_COMMIT_SHA`.
  3. Awaits completion and measures execution duration.
  4. If `reportPath` provided, verifies report file creation timestamp falls within execution window.
  5. Computes SHA256 checksum of output report.
  6. Attaches `TestExecutionEnvelope` to stage result and returns.
- **DEPENDENCIES:** `child_process`, `crypto`, `fs`, `TestExecutionEnvelope`
- **DATABASE OPERATIONS:** None directly.
- **WORKER OPERATIONS:** Executes vitest, tsc, or npm commands via child processes.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** May execute Playwright/Chromium browser stages.

---

### FUNCTION 11: `collectExecutedSuiteEvidence()`
- **FUNCTION NAME:** `collectExecutedSuiteEvidence()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Parsed test report files without validating supervisor execution envelopes or report checksums.
- **ROOT CAUSE:** FINAL-08-04: Allowed stale or unverified test report files to be attributed to the active run.
- **INPUT CONTRACT:** `envelopes: TestExecutionEnvelope[]`
- **OUTPUT CONTRACT:** `ExecutedSuiteEvidence[]`
- **EXACT EXECUTION STEPS:**
  1. Iterates over validated `TestExecutionEnvelope` instances.
  2. Verifies report file exists and its SHA256 matches `envelope.reportSha256`.
  3. Parses Vitest JSON report extracting test suite file, assertions passed/failed, and duration.
  4. Binds authentic `acceptanceRunId`, `testedCommitSha`, and `processExitCode` from envelope.
  5. Returns array of `ExecutedSuiteEvidence`.
- **DEPENDENCIES:** `fs`, `crypto`, `TestExecutionEnvelope`, `ExecutedSuiteEvidence`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 12: `validateRequiredSuiteCoverage()`
- **FUNCTION NAME:** `validateRequiredSuiteCoverage()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Validated only 26 canonical suites, ignoring V11.5.7 hardening suites and V11.5.8 regression suites.
- **ROOT CAUSE:** FINAL-08-07: Incomplete coverage validation allowed releases to pass without running all critical test suites.
- **INPUT CONTRACT:** `requiredSuites: string[]`, `executedEvidence: ExecutedSuiteEvidence[]`, `context: { acceptanceRunId: string; testedCommitSha: string }`
- **OUTPUT CONTRACT:** `{ passed: boolean; totalRequired: number; totalExecuted: number; missingSuites: string[]; failedSuites: string[]; errors: string[]; ... }`
- **EXACT EXECUTION STEPS:**
  1. Canonicalizes suite file paths.
  2. Compares 34 required suites against executed evidence.
  3. Validates that every required suite has `passed > 0`, `failed === 0`, and `processExitCode === 0`.
  4. Validates `testedCommitSha` matches git HEAD SHA.
  5. Returns comprehensive suite coverage result.
- **DEPENDENCIES:** `path`, `ExecutedSuiteEvidence`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 13: `validateAcceptanceArtifactSet()`
- **FUNCTION NAME:** `validateAcceptanceArtifactSet()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Condition `if (d.acceptanceRunId && d.acceptanceRunId !== runId)` allowed artifacts with null or missing run IDs to bypass validation.
- **ROOT CAUSE:** FINAL-08-06: Permissive validation logic allowed untagged artifacts.
- **INPUT CONTRACT:** `set: AcceptanceArtifactSet`
- **OUTPUT CONTRACT:** `AcceptanceArtifactValidationResult` (`isValid: boolean`, `errors: string[]`)
- **EXACT EXECUTION STEPS:**
  1. Inspects all files in artifact set.
  2. Strictly requires `acceptanceRunId === set.acceptanceRunId` (fails if missing).
  3. Strictly requires `testedCommitSha === set.testedCommitSha` on execution evidence.
  4. Validates `database-process-identity.json` contains verified multi-process observations.
  5. Returns validation status and array of classified errors.
- **DEPENDENCIES:** `AcceptanceArtifactSet`, `AcceptanceArtifactValidationResult`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 14: `evaluateReleaseDefects()`
- **FUNCTION NAME:** `evaluateReleaseDefects()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Defect register was a static array with hardcoded `status: "FIXED_VERIFIED"`.
- **ROOT CAUSE:** FINAL-08-08: Statically declared defect fixes could not dynamically reflect actual test failures.
- **INPUT CONTRACT:** `definitions: ReleaseDefectDefinition[]`, `executedEvidence: { executedSuites: ExecutedSuiteEvidence[]; testedCommitSha?: string; }`
- **OUTPUT CONTRACT:** `ReleaseDefect[]` (`id`, `severity`, `status`, `evidenceReference`)
- **EXACT EXECUTION STEPS:**
  1. Iterates through 18 defect definitions (`FINAL-FIX-01` through `FINAL-FIX-06`, `FINAL-01` through `FINAL-04`, `FINAL-08-01` through `FINAL-08-08`).
  2. Locates corresponding executed test suite in `executedEvidence`.
  3. If suite missing: marks defect `OPEN` with unexecuted suite error.
  4. If suite failed or assertions skipped: marks defect `OPEN` with assertion failure details.
  5. If suite passed: marks defect `FIXED_VERIFIED` with exact passed assertions count and commit SHA.
  6. Returns dynamically evaluated defect array.
- **DEPENDENCIES:** `ReleaseDefectDefinition`, `ExecutedSuiteEvidence`, `ReleaseDefect`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 15: `buildCanonicalAcceptanceExecutionPlan()`
- **FUNCTION NAME:** `buildCanonicalAcceptanceExecutionPlan()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Planned only 26 suites, omitting V11.5.7 hardening suites and V11.5.8 regression suites.
- **ROOT CAUSE:** FINAL-08-07: Execution plan was out of sync with mandatory gate requirements.
- **INPUT CONTRACT:** `registry?: AcceptanceGateDefinition[]`, `options?: FullKh01AcceptanceOptions`
- **OUTPUT CONTRACT:** `AcceptanceExecutionPlan` (`planId: "KH-01-V11.5.8-PLAN"`, `applicationVersion: "11.5.8"`, `requiredSuites: string[]`, `gates`)
- **EXACT EXECUTION STEPS:**
  1. Checks canonical gates for duplicate identifiers.
  2. Registers all 34 required test suites (26 canonical + 3 V11.5.7 hardening + 5 V11.5.8 regression).
  3. Sets application version to `"11.5.8"`.
  4. Returns complete execution plan.
- **DEPENDENCIES:** `CANONICAL_ACCEPTANCE_GATES`, `AcceptanceGateDefinition`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 16: `executeLiveResearchThroughWorker()`
- **FUNCTION NAME:** `executeLiveResearchThroughWorker()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Returned only completion counts without capturing worker provider evidence; passed `pageSize: 3` violating Zod schema.
- **ROOT CAUSE:** FINAL-08-02: Missing extraction of worker provider provenance events; schema bounds mismatch.
- **INPUT CONTRACT:** `worker: AcceptanceWorkerHandle`, `context: LiveAcceptanceContext`, `query: { market: string; limit: number; pageSize?: number }`
- **OUTPUT CONTRACT:** `Promise<{ runId: string; completed: boolean; validCount: number; providerEvidence: ProviderSourceEvidence | null; ... }>`
- **EXACT EXECUTION STEPS:**
  1. Clamps `pageSize: Math.min(100, Math.max(5, query.limit || 20))` adhering to Zod schema (`>= 5`).
  2. Enqueues discovery run and job in isolated database.
  3. Waits for worker handle to claim and complete run.
  4. Extracts provider provenance event emitted by worker via `worker.getProviderEvidences()`.
  5. Returns run result bundled with `providerEvidence`.
- **DEPENDENCIES:** `AcceptanceWorkerHandle`, `LiveAcceptanceContext`, `ProviderSourceEvidence`
- **DATABASE OPERATIONS:** Inserts research run and sync job records; queries run state and ad records via Prisma.
- **WORKER OPERATIONS:** Child worker executes job claim, orchestration, provider fetch, and completion.
- **NETWORK OPERATIONS:** None directly.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 17: `verifyLiveMetaSource()`
- **FUNCTION NAME:** `verifyLiveMetaSource()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Inferred provenance from CLI options without validating actual provider transport inside the worker.
- **ROOT CAUSE:** FINAL-08-02: Live source gate must enforce authentic upstream provider transport (`caps.transport !== "mock_test_boundary"`).
- **INPUT CONTRACT:** `options: FullKh01AcceptanceOptions`
- **OUTPUT CONTRACT:** `Promise<LiveMetaVerificationResult>`
- **EXACT EXECUTION STEPS:**
  1. Returns `NOT_RUN` if `options.runLiveSource` is false.
  2. Starts isolated worker subprocess and executes live research run.
  3. Validates worker's returned `providerEvidence`: asserts `observedSourceType === "REAL_UPSTREAM"`, `fixtureDetected === false`, `upstreamRequestExecuted === true`, and `upstreamResponseObserved === true`.
  4. Executes multi-boundary cross-reconciliation (DB, HTTP, Browser).
  5. Returns `PASSED` only if all verifications succeed.
- **DEPENDENCIES:** `assertNoMockSourceForLiveAcceptance()`, `executeLiveResearchThroughWorker()`, `buildCrossBoundaryReconciliationArtifact()`
- **DATABASE OPERATIONS:** Creates isolated SQLite database and executes test queries.
- **WORKER OPERATIONS:** Spawns and manages worker subprocess.
- **NETWORK OPERATIONS:** Loopback TCP communication with live Meta collector MCP server.
- **BROWSER OPERATIONS:** Chromium DOM readback if full-live requested.

---

### FUNCTION 18: `runFullKh01Acceptance()`
- **FUNCTION NAME:** `runFullKh01Acceptance()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (MODIFIED)
- **OLD BEHAVIOR:** Hardcoded version `11.5.7`, hardcoded artifact destination, did not observe Worker/Next.js DB boundaries in offline mode, lacked cross-boundary reconciliation in `filesToWrite`.
- **ROOT CAUSE:** FINAL-08-01, FINAL-08-03, FINAL-08-07, FINAL-08-08.
- **INPUT CONTRACT:** `options?: FullKh01AcceptanceOptions`
- **OUTPUT CONTRACT:** `Promise<FullKh01AcceptanceReport>`
- **EXACT EXECUTION STEPS:**
  1. Initializes acceptance run ID (`kh01_rel_...`), resolves git info (`edb2b146...`), builds execution plan.
  2. Executes 13 acceptance stages sequentially, capturing `TestExecutionEnvelope` for each.
  3. Collects database isolation probe, keeping probe open for multi-process verification.
  4. Executes real isolated Worker and Next.js server probes against the probe DB to collect genuine `ProcessDatabaseObservation`s.
  5. Cleans up probe DB.
  6. Verifies cross-process database identity across all 3 genuine boundaries (`ACCEPTANCE_RUNNER`, `WORKER`, `NEXTJS_SERVER`).
  7. Evaluates release defects dynamically against executed suites.
  8. Validates manifest, gates, and prepares artifact set.
  9. Atomically publishes artifacts to `artifacts/v11.5.8/<acceptanceRunId>/`.
  10. Returns complete report and prints summary.
- **DEPENDENCIES:** All acceptance helpers, Vitest, TypeScript, Next.js, Prisma, Playwright.
- **DATABASE OPERATIONS:** Creates isolated DBs, runs queries, executes migrations, cleans up.
- **WORKER OPERATIONS:** Spawns worker child processes for testing and isolation probes.
- **NETWORK OPERATIONS:** Loopback HTTP requests to Next.js server.
- **BROWSER OPERATIONS:** Launches headless Chromium for E2E tests and screenshots across 6 viewports.

---

### FUNCTION 19: `GET()`
- **FUNCTION NAME:** `GET()`
- **FILE PATH:** `src/app/api/v1/test/db-observation/route.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Did not exist. Next.js server lacked a diagnostic endpoint to observe its runtime database connection and marker presence.
- **ROOT CAUSE:** FINAL-08-01: Could not query Next.js server's running process to prove what SQLite database it was connected to.
- **INPUT CONTRACT:** `request: NextRequest` (query parameters `markerId`, `acceptanceRunId`; headers `Authorization: Bearer <token>` or `x-acceptance-token`)
- **OUTPUT CONTRACT:** `Promise<NextResponse>` (`{ success: boolean, processName: "NEXTJS_SERVER", processId: number, observedDatabaseKey: string, markerObserved: boolean, ... }`)
- **EXACT EXECUTION STEPS:**
  1. Validates test isolation environment flags (`SWAI_TEST_ISOLATION === "strict"`, etc.); rejects with 403 in standard production.
  2. Authenticates request via bearer token or `x-acceptance-token`; rejects with 401 if invalid.
  3. Reads `markerId` and `acceptanceRunId` from URL search parameters; rejects with 400 if missing.
  4. Resolves database configuration and canonicalizes SQLite database key.
  5. Executes Prisma query `prisma.workspace.findUnique({ where: { id: markerId } })`.
  6. Sets `markerObserved: Boolean(ws && ws.id === markerId)`.
  7. Returns JSON response with `processId: process.pid`, `observedDatabaseKey`, `markerObserved: true`.
- **DEPENDENCIES:** `next/server`, `@/lib/db`, `@/lib/database/databaseConfig`
- **DATABASE OPERATIONS:** Executes Prisma query against the running Next.js server's configured SQLite database.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** HTTP GET endpoint handler.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 20: `emitWorkerDiscoveryEvents()`
- **FUNCTION NAME:** `emitWorkerDiscoveryEvents()`
- **FILE PATH:** `src/services/discovery/discoveryOrchestrator.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Worker executed runs and updated database without emitting structured cross-process provenance or database observation events.
- **ROOT CAUSE:** FINAL-08-01 & FINAL-08-02: Orchestrator inside worker child process did not export its PID, transport, or DB canonical key to the parent supervisor.
- **INPUT CONTRACT:** `run: { id: string; workspaceId: string }, provider: { id: string }, lastPageResult: any, actualRetrieved: number, failedTotal: number, requestCount: number, finishTime: Date, lastError: string | null, collectedExternalIds: string[]`
- **OUTPUT CONTRACT:** `Promise<void>`
- **EXACT EXECUTION STEPS:**
  1. Inspects `lastPageResult` and environment to determine `requestedMode`, `actualTransport`, `fixtureDetected`, `upstreamReq`, `upstreamResp`, and `observedSourceType`.
  2. Constructs `providerEvidence` payload with `evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION"`.
  3. Emits `[KH01_EVENT]` line containing `eventType: "KH01_WORKER_PROVIDER_PROVENANCE"`.
  4. Resolves database configuration URL and canonicalizes SQLite path.
  5. Constructs `dbObservation` payload with `processName: "WORKER"`, `processId: process.pid`, and `observedDatabaseKey`.
  6. Emits `[KH01_EVENT]` line containing `eventType: "KH01_WORKER_DATABASE_OBSERVATION"`.
  7. If `KH01_WORKER_EVIDENCE_DIR` is set in environment, writes JSON files to disk.
- **DEPENDENCIES:** `@/lib/database/databaseConfig`, `fs`, `path`
- **DATABASE OPERATIONS:** Resolves DB configuration and checks workspace identifier.
- **WORKER OPERATIONS:** Runs inside the discovery worker subprocess during orchestrated discovery execution.
- **NETWORK OPERATIONS:** Evaluates provider network execution metadata.
- **BROWSER OPERATIONS:** None.
