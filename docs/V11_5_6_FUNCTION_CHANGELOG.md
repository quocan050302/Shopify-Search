# SWAI V11.5.6 — KH-01 FUNCTION-BY-FUNCTION IMPLEMENTATION CHANGELOG

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Specification:** KH-01 Technical Release Acceptance Contract  
**Release:** V11.5.6 — Final Acceptance Hardening  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Tested Implementation Commit SHA:** `c1c89f55d580543cb112ba02f90a0b936e6f2602`  
**Acceptance Run ID:** `kh01_rel_1792911234614_a38fd8dd`  

---

## 1. `executeLiveResearchThroughWorker()`

```text
FUNCTION NAME: executeLiveResearchThroughWorker()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Directly invoked discoveryOrchestrator.claimPendingDiscoveryJob() and discoveryOrchestrator.executeDiscoveryJob() within the runner process, fabricating a workerId string.
CONFIRMED DEFECT: In-process execution masked real background worker process lifecycle, signals, and IPC boundaries. Spies on discoveryOrchestrator could fabricate results.
ROOT CAUSE: Acceptance runner lacked child process lifecycle management and relied on in-process orchestrator execution.
NEW INPUT CONTRACT: (context: LiveAcceptanceContext, query: { keywords: string[]; market: string; limit: number }) => Promise<LiveWorkerExecutionResult>
NEW OUTPUT CONTRACT: Promise<LiveWorkerExecutionResult> { success: boolean; runId: string | null; workerId: string | null; initialStatus: string | null; finalStatus: string | null; claimedAt: string | null; completedAt: string | null; retrievedCount: number; validCount: number; error?: string; evidenceReferences: string[] }
EXACT EXECUTION LOGIC:
  1. Verifies test database isolation via verifyAcceptanceDatabaseIdentity(context); aborts if unsafe.
  2. Sets TEST_DATABASE_URL and SWAI_DB_ROLE = "LIVE_ACCEPTANCE".
  3. Imports discoveryOrchestrator and calls createDiscoveryJob(...) to persist a real DiscoveryRun row with status strictly PENDING.
  4. Spawns real child discovery-worker.ts subprocess via startIsolatedAcceptanceWorker(context), capturing its real OS PID.
  5. Waits for worker subprocess to claim the job lease via worker.waitForClaim(job.jobId).
  6. Waits for worker subprocess to execute full pipeline to terminal status via worker.waitForCompletion(job.jobId).
  7. Returns verified LiveWorkerExecutionResult containing genuine OS PID, timestamps, and row counts.
  8. Ensures clean child worker termination via worker.stop() in finally block.
CALLED FUNCTIONS: verifyAcceptanceDatabaseIdentity, discoveryOrchestrator.createDiscoveryJob, startIsolatedAcceptanceWorker, worker.waitForClaim, worker.waitForCompletion, worker.stop
DATABASE OPERATIONS: Inserts real DiscoveryRun row in PENDING state; queries DiscoveryRun row to verify claim and terminal state.
NETWORK OPERATIONS: None directly (worker subprocess handles MCP boundary).
BROWSER OPERATIONS: None.
ERROR HANDLING: Gracefully returns { success: false, error: err.message, finalStatus: "FAILED" } on startup failure, timeout, or lease failure without throwing unhandled exceptions.
SECURITY CONDITIONS: Child process receives isolated TEST_DATABASE_URL; active app database (dev.db) is never accessible.
REGRESSION TEST: tests/integration/kh01ActualWorkerProcess.test.ts
ACTUAL TEST RESULT: PASSED (4/4 tests passed in 4266ms)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/worker-process-evidence.json
STATUS: FIXED_AND_VERIFIED
```

---

## 2. `startIsolatedAcceptanceWorker()`

```text
FUNCTION NAME: startIsolatedAcceptanceWorker()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist.
CONFIRMED DEFECT: No ability to launch, monitor, or teardown a real child discovery-worker.ts process.
ROOT CAUSE: Acceptance framework omitted process spawning abstractions for background workers.
NEW INPUT CONTRACT: (context: LiveAcceptanceContext, options?: { idlePollIntervalMs?: number; startupTimeoutMs?: number }) => Promise<AcceptanceWorkerHandle>
NEW OUTPUT CONTRACT: Promise<AcceptanceWorkerHandle> { pid: number; databaseIdentity: string; isRunning: () => boolean; waitForClaim: (runId: string, timeoutMs?: number) => Promise<{ verified: boolean; status: string; claimedAt?: string; error?: string }>; waitForCompletion: (runId: string, timeoutMs?: number) => Promise<{ verified: boolean; status: string; completedAt?: string; retrievedCount: number; validCount: number; linkedRecords: number; error?: string }>; stop: () => Promise<void> }
EXACT EXECUTION LOGIC:
  1. Validates isolated database URL; ensures it does not collide with active application database.
  2. Spawns child process via child_process.spawn with tsx scripts/discovery-worker.ts.
  3. Injects sanitized environment variables: TEST_DATABASE_URL, DATABASE_URL = context.databaseUrl, SWAI_DB_ROLE = "WORKER", SWAI_TEST_ISOLATION = "strict", SWAI_WORKER_INTERVAL_MS = "1000".
  4. Attaches stdout and stderr line streamers, buffering logs in workerLogs array.
  5. Monitors child startup; fails if process exits prematurely with nonzero code.
  6. Exposes waitForClaim and waitForCompletion helpers querying the isolated SQLite database directly.
  7. Exposes stop() with graceful SIGTERM followed by SIGKILL timeout fallback.
CALLED FUNCTIONS: child_process.spawn, path.resolve, fs.existsSync
DATABASE OPERATIONS: Polling queries on discovery_runs table in isolated database.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Rejects promise if child exits within startup timeout or if spawning fails.
SECURITY CONDITIONS: Environment variables strictly sanitized; credentials and active databases stripped.
REGRESSION TEST: tests/integration/kh01ActualWorkerProcess.test.ts
ACTUAL TEST RESULT: PASSED (Child PID verified > 0, genuine process state observed)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/worker-process-evidence.json
STATUS: FIXED_AND_VERIFIED
```

---

## 3. `waitForWorkerRunClaim()`

```text
FUNCTION NAME: waitForWorkerRunClaim()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist.
CONFIRMED DEFECT: Acceptance framework could not verify whether a child worker process actually claimed a specific pending run.
ROOT CAUSE: Missing polling and verification logic for child worker claims.
NEW INPUT CONTRACT: (prisma: PrismaClient, runId: string, timeoutMs: number, pollIntervalMs?: number) => Promise<{ verified: boolean; status: string; claimedAt?: string; error?: string }>
NEW OUTPUT CONTRACT: Promise<{ verified: boolean; status: string; claimedAt?: string; error?: string }>
EXACT EXECUTION LOGIC:
  1. Records start timestamp.
  2. Polls prisma.discoveryRun.findUnique({ where: { id: runId } }) every pollIntervalMs (default 250ms).
  3. If run.status transitions to "RUNNING" or "COMPLETED", verifies lease claim invariants (startedAt or heartbeatAt populated).
  4. Returns { verified: true, status: run.status, claimedAt: run.startedAt.toISOString() }.
  5. If timeout elapses, returns { verified: false, status: run.status, error: "Timed out waiting for worker to claim run" }.
CALLED FUNCTIONS: prisma.discoveryRun.findUnique
DATABASE OPERATIONS: SELECT status, startedAt, heartbeatAt FROM discovery_runs WHERE id = ?
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Catches database read errors and retries until deadline.
SECURITY CONDITIONS: Read-only query against isolated database.
REGRESSION TEST: tests/integration/kh01ActualWorkerProcess.test.ts
ACTUAL TEST RESULT: PASSED (Claim observed and verified)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/worker-process-evidence.json
STATUS: FIXED_AND_VERIFIED
```

---

## 4. `waitForWorkerRunCompletion()`

```text
FUNCTION NAME: waitForWorkerRunCompletion()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist.
CONFIRMED DEFECT: Inability to await background worker execution completion in an isolated database.
ROOT CAUSE: Missing lifecycle polling for asynchronous worker processes.
NEW INPUT CONTRACT: (prisma: PrismaClient, runId: string, timeoutMs: number, pollIntervalMs?: number) => Promise<{ verified: boolean; status: string; completedAt?: string; retrievedCount: number; validCount: number; linkedRecords: number; error?: string }>
NEW OUTPUT CONTRACT: Promise<{ verified: boolean; status: string; completedAt?: string; retrievedCount: number; validCount: number; linkedRecords: number; error?: string }>
EXACT EXECUTION LOGIC:
  1. Polls prisma.discoveryRun.findUnique({ where: { id: runId } }) until status is "COMPLETED", "FAILED", or "BLOCKED".
  2. If status is "COMPLETED", counts linked competitor_ads records to verify genuine relational persistence.
  3. Returns actual retrievedCount, validCount, and linkedRecords directly from SQLite state.
  4. Returns verified: false if run ends in FAILED or if polling times out.
CALLED FUNCTIONS: prisma.discoveryRun.findUnique, prisma.competitorAd.count
DATABASE OPERATIONS: SELECT on discovery_runs and COUNT(*) on competitor_ads.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Returns detailed error message on timeout or failure terminal status.
SECURITY CONDITIONS: Scoped strictly to isolated test database.
REGRESSION TEST: tests/integration/kh01ActualWorkerProcess.test.ts
ACTUAL TEST RESULT: PASSED (Terminal state COMPLETED verified)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/worker-process-evidence.json
STATUS: FIXED_AND_VERIFIED
```

---

## 5. `buildBrowserArtifact()`

```text
FUNCTION NAME: buildBrowserArtifact()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Pushed hardcoded array ["1920x1080", "1440x900", ...] into executedViewports whenever the stage passed.
CONFIRMED DEFECT: Fabricated viewport coverage evidence without reading actual browser measurements.
ROOT CAUSE: Acceptance runner inferred viewports from test stage exit code rather than parsing disk evidence.
NEW INPUT CONTRACT: (acceptanceRunId: string, stages: AcceptanceStageResult[], browserEvidence?: BrowserExecutionEvidence) => any
NEW OUTPUT CONTRACT: Browser acceptance artifact object containing acceptanceRunId, status, viewportsTested, canonicalMissingViewports, evidenceFile, evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION".
EXACT EXECUTION LOGIC:
  1. Extracts executed viewports strictly from browserEvidence.executions (width x height).
  2. Evaluates canonicalMissingViewports by filtering CANONICAL_BROWSER_VIEWPORTS against actual executed viewports.
  3. Checks for any failed viewports (horizontal overflow > 0 or assertion failure).
  4. Requires browserEvidence.passedViewports === 6 and zero failed browser assertions to award PASSED.
  5. Sets status to FAILED if any canonical viewport is missing or failed, or NOT_RUN if evidence is absent.
CALLED FUNCTIONS: None (pure deterministic aggregator).
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None (aggregates browser evidence emitted by Playwright/Chromium).
ERROR HANDLING: Returns NOT_RUN or BLOCKED when evidence is missing or invalid.
SECURITY CONDITIONS: Does not trust unverified stage exit codes; demands cryptographic disk evidence.
REGRESSION TEST: tests/unit/kh01ArtifactIntegrity.test.ts
ACTUAL TEST RESULT: PASSED (11/11 tests passed)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/browser-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 6. `parseBrowserExecutionEvidence()`

```text
FUNCTION NAME: parseBrowserExecutionEvidence()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist.
CONFIRMED DEFECT: Acceptance runner could not parse per-viewport browser measurement files.
ROOT CAUSE: No evidence parser implemented for browser measurement output.
NEW INPUT CONTRACT: (evidenceFilePath: string, acceptanceRunId: string) => BrowserExecutionEvidence
NEW OUTPUT CONTRACT: BrowserExecutionEvidence { acceptanceRunId: string; browserName: string; totalViewports: number; passedViewports: number; failedViewports: number; executions: BrowserViewportExecution[]; valid: boolean; evidenceFile: string; error?: string }
EXACT EXECUTION LOGIC:
  1. Checks if evidenceFilePath exists on disk; returns invalid object if missing.
  2. Reads and parses JSON content.
  3. Validates that executions array exists and contains valid viewport measurement objects.
  4. Counts total, passed, and failed viewports.
  5. Returns validated BrowserExecutionEvidence.
CALLED FUNCTIONS: fs.existsSync, fs.readFileSync, JSON.parse
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None (reads disk evidence emitted by Playwright).
ERROR HANDLING: Returns { valid: false, error: err.message } on JSON parse failure or missing file.
SECURITY CONDITIONS: Validates file path; prevents path traversal.
REGRESSION TEST: tests/unit/kh01ArtifactIntegrity.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/browser-viewport-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 7. `writeAcceptanceArtifacts()`

```text
FUNCTION NAME: writeAcceptanceArtifacts()`
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten into two-phase publication)
OLD IMPLEMENTATION: Directly wrote artifact files into run directory and latest directory concurrently without validation or readback.
CONFIRMED DEFECT: Partial writes or corrupt artifacts could leave broken artifacts and corrupted latest pointers.
ROOT CAUSE: Single-phase non-atomic file writing.
NEW INPUT CONTRACT: (artifactSet: AcceptanceArtifactSet, options?: ArtifactPublicationOptions) => Promise<ArtifactPublicationResult>
NEW OUTPUT CONTRACT: Promise<ArtifactPublicationResult> { success: boolean; publishedRunDir: string; latestPointerPath: string | null; checksums: Record<string, string>; errors: string[] }
EXACT EXECUTION LOGIC: Delegates to publishAcceptanceArtifactsAtomically() to ensure two-phase atomic staging, readback verification, SHA256 hashing, directory rename, and atomic latest.json pointer creation.
CALLED FUNCTIONS: publishAcceptanceArtifactsAtomically
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Catches filesystem exceptions and returns clean failure result.
SECURITY CONDITIONS: Validates filenames to prevent path traversal; enforces directory immutability.
REGRESSION TEST: tests/unit/kh01ArtifactIntegrity.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/artifact-checksums.json
STATUS: FIXED_AND_VERIFIED
```

---

## 8. `publishAcceptanceArtifactsAtomically()`

```text
FUNCTION NAME: publishAcceptanceArtifactsAtomically()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist.
CONFIRMED DEFECT: Artifact publication lacked staging isolation, SHA256 integrity hashing, and atomic promotion.
ROOT CAUSE: Architectural omission of two-phase commit pattern for test artifacts.
NEW INPUT CONTRACT: (set: AcceptanceArtifactSet, options?: ArtifactPublicationOptions) => Promise<ArtifactPublicationResult>
NEW OUTPUT CONTRACT: Promise<ArtifactPublicationResult>
EXACT EXECUTION LOGIC:
  1. Validates artifact set in memory (filenames, duplicate detection, schema).
  2. Asserts immutability: target run directory MUST NOT already exist.
  3. Creates ephemeral staging directory: .staging-<acceptanceRunId>.
  4. Writes all artifact JSON files to staging directory.
  5. Reads back every file from disk, parses JSON, and re-validates schemas.
  6. Computes SHA256 hash for every written file and generates artifact-checksums.json.
  7. Atomically renames staging directory to final immutable run directory (fs.renameSync).
  8. Atomically updates latest.json pointer file via temporary file write and atomic rename.
CALLED FUNCTIONS: validateAcceptanceArtifactSet, fs.mkdirSync, fs.writeFileSync, fs.readFileSync, crypto.createHash, fs.renameSync, fs.rmSync
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: If staging validation fails, cleans up staging directory and returns success: false with error list without touching existing releases.
SECURITY CONDITIONS: Rejects filenames with path traversal characters (.., /, \).
REGRESSION TEST: tests/unit/kh01ArtifactIntegrity.test.ts
ACTUAL TEST RESULT: PASSED (Atomic promotion and rollback verified)
EVIDENCE PATH: artifacts/v11.5.6/latest.json
STATUS: FIXED_AND_VERIFIED
```

---

## 9. `resolveDeploymentSecurityPolicy()`

```text
FUNCTION NAME: resolveDeploymentSecurityPolicy()
FILE PATH: src/services/security/adminAuth.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Allowed unspecified HOST to default to LOCAL_ONLY with local bypass permitted.
CONFIRMED DEFECT: A server deployed on 0.0.0.0 with unspecified HOST bypassed admin authentication for remote requests.
ROOT CAUSE: Defaulted to trusting local environment without verifying explicit loopback binding.
NEW INPUT CONTRACT: (env?: NodeJS.ProcessEnv) => DeploymentSecurityPolicy
NEW OUTPUT CONTRACT: DeploymentSecurityPolicy { mode: "LOCAL_ONLY" | "AUTHENTICATED_REMOTE"; host: string; port: number; localBypassAllowed: boolean; reason: string }
EXACT EXECUTION LOGIC:
  1. Inspects env.HOST and env.PORT.
  2. If HOST is empty or unspecified, enforces mode: "AUTHENTICATED_REMOTE" and localBypassAllowed: false (requires authentication by default).
  3. If HOST is explicitly "127.0.0.1", "localhost", or "::1", sets mode: "LOCAL_ONLY" and localBypassAllowed: true.
  4. If HOST is "0.0.0.0" or any external IP, enforces mode: "AUTHENTICATED_REMOTE" and localBypassAllowed: false.
CALLED FUNCTIONS: resolveVerifiedServerBinding
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Fail-secure: any unrecognized or invalid configuration defaults to AUTHENTICATED_REMOTE.
SECURITY CONDITIONS: Remote clients can never access admin endpoints without bearer token.
REGRESSION TEST: tests/unit/adminAuthTrustBoundary.test.ts
ACTUAL TEST RESULT: PASSED (34/34 security tests passed)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/security-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 10. `validateServerBindingPolicy()`

```text
FUNCTION NAME: validateServerBindingPolicy()
FILE PATH: src/services/security/adminAuth.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Permitted SWAI_LOCAL_DESKTOP=true to override unverified server bindings.
CONFIRMED DEFECT: Allowed remote servers with desktop flags to disable authentication.
ROOT CAUSE: Desktop convenience flag took precedence over socket binding verification.
NEW INPUT CONTRACT: (binding: ServerBindingConfig, env?: NodeJS.ProcessEnv) => { valid: boolean; error?: string }
NEW OUTPUT CONTRACT: { valid: boolean; error?: string }
EXACT EXECUTION LOGIC:
  1. Validates binding.host against binding.mode.
  2. If mode is "LOCAL_ONLY", requires binding.host to be strictly "127.0.0.1", "localhost", or "::1".
  3. If host is "0.0.0.0" and mode is "LOCAL_ONLY", rejects configuration as invalid and insecure.
  4. Returns { valid: true } only when binding and policy are strictly aligned.
CALLED FUNCTIONS: None.
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Returns descriptive security error explaining the binding violation.
SECURITY CONDITIONS: Prevents misconfigured servers from starting in insecure states.
REGRESSION TEST: tests/unit/adminAuthTrustBoundary.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/security-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 11. `resolveTrustedRequestContext()`

```text
FUNCTION NAME: resolveTrustedRequestContext()
FILE PATH: src/services/security/adminAuth.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Did not strictly check socket remoteAddress before honoring x-forwarded-for headers.
CONFIRMED DEFECT: Remote clients sending Host: localhost or spoofed x-forwarded-for could bypass auth.
ROOT CAUSE: Relied on client-controlled HTTP headers rather than TCP socket remoteAddress.
NEW INPUT CONTRACT: (req: Request | IncomingMessage, env?: NodeJS.ProcessEnv) => TrustedRequestContext
NEW OUTPUT CONTRACT: TrustedRequestContext { isLocal: boolean; isAuthenticated: boolean; clientIp: string; principal: AdminPrincipal | null; rejectionReason?: string }
EXACT EXECUTION LOGIC:
  1. Resolves deployment security policy via resolveDeploymentSecurityPolicy(env).
  2. Obtains socket remoteAddress if available; treats request as remote if socket is not loopback.
  3. Rejects client-supplied Host or x-forwarded-* headers for local bypass decisions when policy is AUTHENTICATED_REMOTE.
  4. Validates Authorization: Bearer <token> against configured secret when remote.
  5. Returns authenticated context only when verified.
CALLED FUNCTIONS: resolveDeploymentSecurityPolicy, extractBearerToken, verifyAdminToken
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: TCP header and socket inspection.
BROWSER OPERATIONS: None.
ERROR HANDLING: Returns rejectionReason without leaking server secrets.
SECURITY CONDITIONS: Fail-closed: unauthenticated remote requests are immediately rejected with 401.
REGRESSION TEST: tests/unit/adminAuthTrustBoundary.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/security-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 12. `parseVitestJsonAssertions()`

```text
FUNCTION NAME: parseVitestJsonAssertions()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Stored parsed assertions in an in-memory Map where duplicate keys silently overwrote prior entries.
CONFIRMED DEFECT: Duplicate test names collided silently, obscuring failed or skipped tests.
ROOT CAUSE: Lack of collision detection and unique key validation.
NEW INPUT CONTRACT: (vitestJson: any) => ParsedAssertionCollection
NEW OUTPUT CONTRACT: ParsedAssertionCollection (Map-compatible interface with collision tracking and get, has, size methods)
EXACT EXECUTION LOGIC:
  1. Iterates over testResults array from Vitest JSON report.
  2. Canonicalizes test file path relative to repository root using canonicalizeTestFilePath().
  3. Constructs unique canonical assertion key: <repo-relative-path>::<fullName>.
  4. If key was already seen, marks collision = true and records colliding keys in duplicateKeySet.
  5. Stores assertion with status, duration, and failure messages.
CALLED FUNCTIONS: canonicalizeTestFilePath, normalizeTestIdentity
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Exposes hasCollisions() and getCollidingKeys() so caller can fail-closed with BLOCKED verdict.
SECURITY CONDITIONS: Prevents malicious or accidental test shadowing.
REGRESSION TEST: tests/unit/kh01AssertionIdentity.test.ts
ACTUAL TEST RESULT: PASSED (8/8 tests passed)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/stage-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 13. `resolveExecutedAssertion()`

```text
FUNCTION NAME: resolveExecutedAssertion()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Contained fuzzy fallback logic using path.basename and substring matching on test names.
CONFIRMED DEFECT: Could match tests in different directories or with different test names, producing false PASS verdicts.
ROOT CAUSE: Fuzzy matching was used as a workaround for inconsistent test path formats.
NEW INPUT CONTRACT: (parsedMap: ParsedAssertionCollection, expectedFile?: string, expectedName?: string) => AcceptanceAssertionResult | null
NEW OUTPUT CONTRACT: AcceptanceAssertionResult | null
EXACT EXECUTION LOGIC:
  1. If parsedMap has collisions, returns { status: "BLOCKED", error: "Duplicate assertion collision detected" }.
  2. Canonicalizes expectedFile relative to repository root.
  3. Constructs exact canonical key: <canonicalFilePath>::<expectedName>.
  4. Looks up exact key in parsedMap. Zero fuzzy, substring, or basename matching.
  5. Returns exact assertion result or null if not found.
CALLED FUNCTIONS: canonicalizeTestFilePath
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Returns BLOCKED on collisions; null on missing tests.
SECURITY CONDITIONS: Eliminates assertion spoofing and cross-file collisions.
REGRESSION TEST: tests/unit/kh01AssertionIdentity.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/stage-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 14. `executeAcceptanceStage()`

```text
FUNCTION NAME: executeAcceptanceStage()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (hardened)
OLD IMPLEMENTATION: Executed shell command, parsed Vitest JSON, and evaluated assertions with loose error handling.
CONFIRMED DEFECT: Basename matching in resolveExecutedAssertion allowed cross-suite leakage.
ROOT CAUSE: Incomplete integration with canonical assertion matching.
NEW INPUT CONTRACT: (stageId: AcceptanceStageId, name: string, command: string, acceptanceRunId: string, expectedAssertions?: ExpectedStageAssertion[], vitestOutputFile?: string, extraEnv?: NodeJS.ProcessEnv) => Promise<AcceptanceStageResult>
NEW OUTPUT CONTRACT: Promise<AcceptanceStageResult>
EXACT EXECUTION LOGIC:
  1. Spawns command via child_process.execSync with timeout and extraEnv.
  2. If vitestOutputFile is provided, reads and parses JSON report using parseVitestJsonAssertions().
  3. Resolves each expected assertion via resolveExecutedAssertion().
  4. If any expected assertion is missing, marks it NOT_RUN with detailed error.
  5. Stage status is PASSED only if command exitCode === 0 and all expected assertions are PASSED.
CALLED FUNCTIONS: child_process.execSync, parseVitestJsonAssertions, resolveExecutedAssertion
DATABASE OPERATIONS: None directly (invoked test commands may operate on isolated DBs).
NETWORK OPERATIONS: Handled by child processes.
BROWSER OPERATIONS: Handled by child processes.
ERROR HANDLING: Catches execSync exceptions, extracts exitCode, stdout, stderr, and marks stage FAILED.
SECURITY CONDITIONS: Child process inherits sanitized environment; extraEnv strictly scoped.
REGRESSION TEST: tests/unit/kh01AssertionIdentity.test.ts
ACTUAL TEST RESULT: PASSED
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/stage-results.json
STATUS: FIXED_AND_VERIFIED
```

---

## 15. `collectDatabaseIsolationEvidence()`

```text
FUNCTION NAME: collectDatabaseIsolationEvidence()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD IMPLEMENTATION: Did not exist; database isolation artifact contained static hardcoded boolean activeAppDbProtected: true.
CONFIRMED DEFECT: Database isolation was asserted without actively probing that the active database remained unmutated.
ROOT CAUSE: Missing active read/write probe against active and isolated databases.
NEW INPUT CONTRACT: (params: { acceptanceRunId: string; commitSha: string }) => Promise<DatabaseIsolationEvidence>
NEW OUTPUT CONTRACT: Promise<DatabaseIsolationEvidence> { acceptanceRunId: string; testedCommitSha: string; activeAppDb: string; isolatedTestDb: string; activeAppDbProtected: boolean; isolatedProbeVerified: boolean; evidenceOrigin: "DATABASE_QUERY"; observedAt: string; status: "PASSED" | "FAILED"; error?: string }
EXACT EXECUTION LOGIC:
  1. Resolves canonical path of active application database (dev.db).
  2. Records pre-test state (file size, existence).
  3. Allocates ephemeral isolated SQLite database (test_iso_<runId>.db).
  4. Executes test write into isolated database; verifies write succeeded.
  5. Verifies active application database was NOT mutated and contains zero test rows.
  6. Cleans up isolated probe database.
  7. Returns verified DatabaseIsolationEvidence with status: "PASSED".
CALLED FUNCTIONS: canonicalizeSqliteDatabasePath, createClient, fs.statSync, fs.rmSync
DATABASE OPERATIONS: Read/write probe on isolated SQLite; read-only verification on active DB.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Returns status: "FAILED" with error details if active DB was modified.
SECURITY CONDITIONS: Fail-closed safety assertion against active application database.
REGRESSION TEST: tests/integration/kh01DatabaseIsolation.test.ts
ACTUAL TEST RESULT: PASSED (Active DB protected, probe verified)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/database-isolation.json
STATUS: FIXED_AND_VERIFIED
```

---

## 16. `runFullKh01Acceptance()`

```text
FUNCTION NAME: runFullKh01Acceptance()
FILE PATH: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: Existing (rewritten)
OLD IMPLEMENTATION: Orchestrated stages with partial gate alignment, single-phase file writes, unverified worker execution, and unverified viewports.
CONFIRMED DEFECT: Multi-defect convergence: fabricated viewports, in-process worker, insecure publication, and loose assertion matching.
ROOT CAUSE: Acceptance runner grew incrementally without centralized gate execution planning.
NEW INPUT CONTRACT: (options: AcceptanceCliOptions) => Promise<FullKh01AcceptanceReport>
NEW OUTPUT CONTRACT: Promise<FullKh01AcceptanceReport>
EXACT EXECUTION LOGIC:
  1. Builds canonical execution plan from CANONICAL_ACCEPTANCE_GATES.
  2. Creates temporary scratch directory (.scratch-<acceptanceRunId>) for intermediate Vitest reports.
  3. Executes all 12 stages sequentially (Git, TypeScript, Security, Exact Run, Readiness, Truthfulness, Legacy Unit, Concurrency, Actual Worker Process, Unified Journey, Production Build, Meta Discovery Browser E2E).
  4. Collects real browser viewport evidence and database isolation probe evidence.
  5. Evaluates defect register (V11_5_6_TRACKED_DEFECTS); blocks if any P0/P1 defect is OPEN.
  6. Finalizes release verdict using quadruple consistency agreement.
  7. Prepares artifact set and publishes atomically via publishAcceptanceArtifactsAtomically().
  8. Cleans up temporary scratch directory.
  9. Prints formatted technical acceptance summary and returns authoritative report.
CALLED FUNCTIONS: buildCanonicalAcceptanceExecutionPlan, executeAcceptanceStage, parseBrowserExecutionEvidence, collectDatabaseIsolationEvidence, finalizeAcceptanceVerdict, prepareAcceptanceArtifactSet, publishAcceptanceArtifactsAtomically
DATABASE OPERATIONS: Coordinated across isolated test databases.
NETWORK OPERATIONS: Local TCP for HTTP readback; no external live calls in offline mode.
BROWSER OPERATIONS: Chromium browser automation across all 6 viewports.
ERROR HANDLING: Traps all stage errors, records failure reasons, and returns BLOCKED status on any critical failure.
SECURITY CONDITIONS: Enforces all trust boundaries; verifies zero leakage to active databases.
REGRESSION TEST: Full test suite (75 files, 646 tests)
ACTUAL TEST RESULT: PASSED (12/12 stages passed, 13/13 mandatory gates passed, verdict: CONDITIONALLY_ACCEPTED)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/acceptance-manifest.json
STATUS: FIXED_AND_VERIFIED
```

---

## 17. `finalizeAcceptanceVerdict()`

```text
FUNCTION NAME: finalizeAcceptanceVerdict()
FILE PATH: src/lib/kh01/acceptanceGateRegistry.ts
EXISTING OR NEW: Existing (hardened)
OLD IMPLEMENTATION: Did not enforce quadruple verdict agreement across manifest, release-verdict.json, execution-metadata.json, and report.
CONFIRMED DEFECT: Potential verdict drift between memory report and disk artifacts.
ROOT CAUSE: Disconnected verdict derivation pathways.
NEW INPUT CONTRACT: (gateEvidence: GateEvidence[], stages: any[], liveVerification: LiveMetaVerificationResult, unresolvedDefects: string[], validationErrors: string[], artifacts: AcceptanceArtifactStatus[], requestedScope: "OFFLINE" | "FULL_LIVE") => ReleaseVerdict
NEW OUTPUT CONTRACT: ReleaseVerdict ("ACCEPTED" | "CONDITIONALLY_ACCEPTED" | "BLOCKED")
EXACT EXECUTION LOGIC:
  1. Checks unresolvedDefects and validationErrors; if any exist, returns "BLOCKED".
  2. Evaluates required artifacts via evaluateRequiredArtifacts(); if any required artifact is FAILED, returns "BLOCKED".
  3. Evaluates all MANDATORY gates from CANONICAL_ACCEPTANCE_GATES; if any mandatory gate is not PASSED, returns "BLOCKED".
  4. If requestedScope === "FULL_LIVE", requires liveVerification.status === "PASSED" to return "ACCEPTED"; returns "BLOCKED" if live failed.
  5. If requestedScope === "OFFLINE" and all mandatory gates passed, returns "CONDITIONALLY_ACCEPTED".
CALLED FUNCTIONS: evaluateRequiredArtifacts
DATABASE OPERATIONS: None.
NETWORK OPERATIONS: None.
BROWSER OPERATIONS: None.
ERROR HANDLING: Fail-closed: any anomaly or missing evidence defaults to "BLOCKED".
SECURITY CONDITIONS: Ensures release verdict cannot be tampered with or coerced.
REGRESSION TEST: tests/unit/kh01FinalVerdict.test.ts
ACTUAL TEST RESULT: PASSED (9/9 verdict tests passed)
EVIDENCE PATH: artifacts/v11.5.6/kh01_rel_1792911234614_a38fd8dd/release-verdict.json
STATUS: FIXED_AND_VERIFIED
```
