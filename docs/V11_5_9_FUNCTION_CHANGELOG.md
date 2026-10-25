# SWAI V11.5.9 — FUNCTION-BY-FUNCTION CHANGELOG
## KH-01 Final Security & Acceptance Correctness Lock

**Target Release:** V11.5.9 — Final Security & Acceptance Correctness Lock  
**Tested Implementation Commit SHA:** `aba474000f9180e2b4f7917e4d4999cc6e544e2f`  
**Acceptance Run ID:** `kh01_rel_1792928286105_f08ae063`  
**Active Branch:** `feature/v11-meta-collector-remove-muse`  
**Operating Mode:** `RESEARCH_ONLY` | **Target Market:** United States (US)  

---

### FUNCTION 1: `resolveDbObservationSecurityContext()`
- **FUNCTION NAME:** `resolveDbObservationSecurityContext()`
- **FILE PATH:** `src/app/api/v1/test/db-observation/route.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** In V11.5.8, diagnostic DB observation route lacked a dedicated security context resolver and accepted a hardcoded static bearer token (`swai-acceptance-secret-token`) without verifying run-specific configuration or active development DB protection.
- **ROOT CAUSE:** V1159-01: Insecure diagnostic route credentials and absence of active DB fail-closed security guards.
- **INPUT CONTRACT:** `env: NodeJS.ProcessEnv = process.env`
- **OUTPUT CONTRACT:** `DbObservationSecurityContext` (`enabled: boolean`, `isolatedDatabaseVerified: boolean`, `expectedAcceptanceRunId: string`, `expectedDatabaseKey: string`, `authenticationConfigured: boolean`, `error?: string`)
- **EXACT EXECUTION STEPS:**
  1. Checks `env.SWAI_E2E_SERVER === "true"` and `env.SWAI_TEST_ISOLATION === "strict"`. Fails closed if false.
  2. Verifies `env.SWAI_DB_ROLE` is `"LIVE_ACCEPTANCE"` or `"INTEGRATION_TEST"`.
  3. Resolves database configuration via `resolveDatabaseConfiguration(env)` and computes SQLite canonical path key.
  4. Asserts that the canonical key does NOT match `file:./dev.db`, `file:./prisma/dev.db`, or end with `dev.db` / `production.db`.
  5. Validates non-empty `env.KH01_ACCEPTANCE_RUN_ID`.
  6. Validates non-empty `env.KH01_DB_OBSERVATION_TOKEN` with at least 16 characters.
  7. Returns `DbObservationSecurityContext` with `enabled: true`.
- **DEPENDENCIES:** `@/lib/database/databaseConfig`
- **DATABASE OPERATIONS:** Inspects database configuration URL; no queries executed directly.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 2: `verifyDbObservationToken()`
- **FUNCTION NAME:** `verifyDbObservationToken()`
- **FILE PATH:** `src/app/api/v1/test/db-observation/route.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** In V11.5.8, token comparison matched against a hardcoded static token string with standard string comparison (`===`), susceptible to timing attacks.
- **ROOT CAUSE:** V1159-01: Static diagnostic secrets and non-timing-safe token matching.
- **INPUT CONTRACT:** `providedToken: string | null`, `configuredToken: string | undefined`
- **OUTPUT CONTRACT:** `boolean`
- **EXACT EXECUTION STEPS:**
  1. Checks both tokens are non-null, non-undefined, and trimmed length > 0.
  2. Converts provided and configured token strings to UTF-8 Byte Buffers.
  3. Rejects immediately if buffer lengths differ (returns false).
  4. Executes `crypto.timingSafeEqual(bufProvided, bufConfigured)` to prevent side-channel timing leaks.
- **DEPENDENCIES:** Node.js native `crypto`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 3: `GET()` (DB Observation Route Handler)
- **FUNCTION NAME:** `GET()`
- **FILE PATH:** `src/app/api/v1/test/db-observation/route.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Allowed diagnostic queries with hard-coded credentials; did not validate run IDs, exposing internal database inspection indiscriminately.
- **ROOT CAUSE:** V1159-01: Diagnostic route lacked run-bound authorization and active database rejection.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `Promise<NextResponse>` (JSON payload with `success`, `processId`, `observedDatabaseKey`, `markerObserved`, etc.)
- **EXACT EXECUTION STEPS:**
  1. Invokes `resolveDbObservationSecurityContext(process.env)`. Returns HTTP 403 on disabled context.
  2. Extracts bearer token from `Authorization` header or `x-acceptance-token` / `x-diagnostic-token`.
  3. Verifies token via `verifyDbObservationToken()`. Returns HTTP 401 on mismatch.
  4. Validates query parameter `acceptanceRunId` matches `secCtx.expectedAcceptanceRunId`. Returns HTTP 403 on mismatch.
  5. Validates query parameter `markerId`. Returns HTTP 400 if empty.
  6. Queries `prisma.workspace.findUnique({ where: { id: markerId } })`.
  7. Returns HTTP 200 with minimal, non-leaking diagnostic identity: `processId: process.pid`, `observedDatabaseKey: secCtx.expectedDatabaseKey`, `markerObserved: Boolean(ws)`.
- **DEPENDENCIES:** `next/server`, `@/lib/db`, Node.js native `crypto`
- **DATABASE OPERATIONS:** Isolated SQLite query via `prisma.workspace.findUnique` on the verified isolated test DB.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** Handles HTTP GET request over loopback.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 4: `startSwaiTestServer()`
- **FUNCTION NAME:** `startSwaiTestServer()`
- **FILE PATH:** `tests/e2e/helpers/startSwaiTestServer.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Did not generate or forward dynamic run-specific tokens `KH01_DB_OBSERVATION_TOKEN` and `KH01_ACCEPTANCE_RUN_ID` to the Next.js server child process.
- **ROOT CAUSE:** V1159-01: Next.js server lacked dynamic diagnostic secrets for cross-process observation.
- **INPUT CONTRACT:** `options?: { ...; acceptanceRunId?: string; dbObservationToken?: string }`
- **OUTPUT CONTRACT:** `Promise<SwaiTestServerHandle>` (contains `acceptanceRunId` and `dbObservationToken`)
- **EXACT EXECUTION STEPS:**
  1. Receives or generates random cryptographic `acceptanceRunId` and `dbObservationToken` (32-byte hex).
  2. Sets child environment: `KH01_ACCEPTANCE_RUN_ID`, `KH01_DB_OBSERVATION_TOKEN`, `SWAI_E2E_SERVER: "true"`, `SWAI_TEST_ISOLATION: "strict"`.
  3. Spawns Next.js standalone server process using isolated test database.
  4. Waits for health endpoint `/api/v1/health` to respond.
  5. Returns server handle exposing `dbObservationToken` and `acceptanceRunId`.
- **DEPENDENCIES:** `child_process`, `crypto`
- **DATABASE OPERATIONS:** Child Next.js process connects to isolated SQLite database.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** Polls HTTP health endpoint over localhost.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 5: `findDuplicateAdIds()`
- **FUNCTION NAME:** `findDuplicateAdIds()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** No helper existed to detect duplicate ad IDs across boundary evidence arrays; duplicate ad records could bypass reconciliation undetected.
- **ROOT CAUSE:** V1159-06: Cross-boundary reconciliation did not detect duplicate ad IDs in HTTP, DB, or Browser readback.
- **INPUT CONTRACT:** `ids: string[]`
- **OUTPUT CONTRACT:** `string[]` (list of unique duplicate IDs)
- **EXACT EXECUTION STEPS:**
  1. Iterates over `ids` using a `seen` set and `duplicates` set.
  2. If an ID has already been seen, adds it to `duplicates`.
  3. Returns `Array.from(duplicates)`.
- **DEPENDENCIES:** None.
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 6: `validateCrossBoundaryEvidenceInputs()`
- **FUNCTION NAME:** `validateCrossBoundaryEvidenceInputs()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Missing boundary evidence inputs were unchecked or handled loosely without strict fail-closed errors.
- **ROOT CAUSE:** V1159-06: Incomplete boundary evidence validation.
- **INPUT CONTRACT:** `input: CrossBoundaryReconciliationInput`
- **OUTPUT CONTRACT:** `string[]` (list of input validation errors)
- **EXACT EXECUTION STEPS:**
  1. Validates `acceptanceRunId`, `testedCommitSha`, and `discoveryRunId` are non-empty strings.
  2. Validates `databaseEvidence`, `httpEvidence`, `browserEvidence`, and `providerEvidence` are present.
  3. Returns array of validation error messages.
- **DEPENDENCIES:** None.
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 7: `buildCrossBoundaryReconciliationArtifact()`
- **FUNCTION NAME:** `buildCrossBoundaryReconciliationArtifact()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Permitted non-PASSED boundary statuses; did not verify runId alignment across boundaries; did not detect duplicate ad IDs; lacked strict upstream provider verification.
- **ROOT CAUSE:** V1159-06: Cross-boundary reconciliation false-positives under imperfect boundary execution.
- **INPUT CONTRACT:** `input: CrossBoundaryReconciliationInput`
- **OUTPUT CONTRACT:** `CrossBoundaryReconciliationArtifact`
- **EXACT EXECUTION STEPS:**
  1. Executes `validateCrossBoundaryEvidenceInputs(input)`.
  2. Verifies boundary statuses: `databaseEvidence.status === "PASSED"`, `httpEvidence.status === "PASSED"`, `browserEvidence.status === "PASSED"`.
  3. Verifies `providerEvidence.observedSourceType === "REAL_UPSTREAM"`, `fixtureDetected === false`, `upstreamRequestExecuted === true`, `upstreamResponseObserved === true`.
  4. Verifies runId alignment: `databaseEvidence.runId`, `httpEvidence.runId`, and `browserEvidence.runId` must strictly equal `input.discoveryRunId`.
  5. Scans for duplicate ad IDs across DB, HTTP, and Browser boundaries via `findDuplicateAdIds()`.
  6. Compares sets: computes `missingInHttp`, `unexpectedInHttp`, `missingInBrowser`, and `unexpectedInBrowser`.
  7. Sets `status: "PASSED"` and `consistent: true` ONLY when errors array is empty, all boundaries passed, duplicates are 0, and sets match exactly. Otherwise sets `status: "FAILED"` and `consistent: false`.
- **DEPENDENCIES:** `findDuplicateAdIds`, `validateCrossBoundaryEvidenceInputs`
- **DATABASE OPERATIONS:** Analyzes database boundary ad ID arrays.
- **WORKER OPERATIONS:** Analyzes provider evidence captured from worker.
- **NETWORK OPERATIONS:** Analyzes HTTP readback ad ID arrays.
- **BROWSER OPERATIONS:** Analyzes Chromium browser DOM card ad ID arrays.

---

### FUNCTION 8: `verifyPublishedAcceptanceEvidence()`
- **FUNCTION NAME:** `verifyPublishedAcceptanceEvidence()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** Acceptance evidence publication completed without verifying file presence, non-zero file sizes, and valid JSON parsing on the final target directory.
- **ROOT CAUSE:** V1159-04: Lack of post-publication evidence verification.
- **INPUT CONTRACT:** `location: string`, `expectedArtifacts: string[]`
- **OUTPUT CONTRACT:** `Promise<ArtifactPublicationVerificationResult>` (`verified: boolean`, `errors: string[]`, `verifiedFiles: string[]`)
- **EXACT EXECUTION STEPS:**
  1. Checks target directory exists on disk.
  2. Iterates over `expectedArtifacts`, asserting each file exists and file size > 0.
  3. Attempts `JSON.parse` on every published JSON artifact to verify schema validity.
  4. Returns `verified: true` only if all expected artifacts are valid and readable.
- **DEPENDENCIES:** `fs.promises`, `path`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 9: `evaluateDatabaseIsolationVerdict()`
- **FUNCTION NAME:** `evaluateDatabaseIsolationVerdict()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD BEHAVIOR:** When active database protection returned `NOT_VERIFIED`, the isolation verdict could remain eligible for release under ambiguous status handling.
- **ROOT CAUSE:** V1159-02: Truth table in isolation evaluation permitted `NOT_VERIFIED` to be treated leniently.
- **INPUT CONTRACT:** `input: DatabaseIsolationVerdictInput` (`isolatedDatabaseVerified: boolean`, `activeDatabaseProtected: boolean | null`, `activeProtectionStatus: "PASSED" | "FAILED" | "NOT_VERIFIED"`)
- **OUTPUT CONTRACT:** `{ status: "PASSED" | "FAILED" | "NOT_VERIFIED"; activeDatabaseProtected: boolean; eligibleForAcceptance: boolean; error?: string }`
- **EXACT EXECUTION STEPS:**
  1. If `activeProtectionStatus === "NOT_VERIFIED"` or `activeDatabaseProtected === null`: returns `status: "NOT_VERIFIED"`, `activeDatabaseProtected: false`, `eligibleForAcceptance: false`.
  2. If `isolatedDatabaseVerified === true` and `activeDatabaseProtected === true` and `activeProtectionStatus === "PASSED"`: returns `status: "PASSED"`, `activeDatabaseProtected: true`, `eligibleForAcceptance: true`.
  3. Otherwise: returns `status: "FAILED"`, `activeDatabaseProtected: false`, `eligibleForAcceptance: false`.
- **DEPENDENCIES:** None.
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 10: `verifyDatabaseIdentityAcrossProcesses()`
- **FUNCTION NAME:** `verifyDatabaseIdentityAcrossProcesses()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Allowed release even when Worker or Next.js server observations were missing or errored; did not require run IDs under discovery runs; lacked verification scopes.
- **ROOT CAUSE:** V1159-03, V1159-05: Permissive cross-process database identity validation.
- **INPUT CONTRACT:** `input: DatabaseProcessIdentityEvidence`, `scope: DatabaseVerificationScope = "SHARED_MARKER"`
- **OUTPUT CONTRACT:** `DatabaseProcessIdentityEvidence` (updated with `verified`, `missingProcesses`, `mismatchedProcesses`, `sharedRunVerified`, `errors`)
- **EXACT EXECUTION STEPS:**
  1. Checks if input is marked legacy: if so, sets `verified: false` and adds configuration-only error.
  2. Checks for process errors: if any process reported an error, adds error and sets `verified: false`.
  3. Verifies required processes (`WORKER`, `NEXTJS_SERVER`, `PRISMA_VERIFIER`, `ACCEPTANCE_RUNNER`) are present in observations.
  4. Verifies canonical database key matches `expectedDatabaseKey` for every process.
  5. For scope `SHARED_DISCOVERY_RUN`: verifies each process observed the actual `discoveryRunId`.
  6. For scope `SHARED_MARKER`: verifies each process observed `markerObserved === true`.
  7. Sets `verified: true` only when all required processes are present, keys match, and errors array is empty.
- **DEPENDENCIES:** `canonicalizeSqliteDatabasePath`
- **DATABASE OPERATIONS:** Analyzes multi-process database observation records.
- **WORKER OPERATIONS:** Validates worker process database identity record.
- **NETWORK OPERATIONS:** Validates Next.js HTTP server database identity record.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 11: `observeDatabaseIdentityFromNextServer()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromNextServer()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Used a hard-coded bearer token (`swai-acceptance-secret-token`), had fallback to default port 3000, and fell back to expected DB key if the response lacked `observedDatabaseKey`.
- **ROOT CAUSE:** V1159-01, V1159-03: Permissive fallback credentials and synthetic database identity key defaults.
- **INPUT CONTRACT:** `server: { baseUrl?: string; url?: string; dbObservationToken?: string; acceptanceRunId?: string }`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>`
- **EXACT EXECUTION STEPS:**
  1. Validates `server.baseUrl || server.url`. Fails immediately without fallback if missing.
  2. Resolves token from `server.dbObservationToken` or `context.dbObservationToken`.
  3. Sends HTTP GET with `Authorization: Bearer ${token}` and `acceptanceRunId` query parameter.
  4. Fails closed if HTTP status !== 200.
  5. Extracts `data.observedDatabaseKey || null` strictly without falling back to expected key.
  6. Returns observation with authentic `processId` from Next.js server.
- **DEPENDENCIES:** `fetch`, `canonicalizeSqliteDatabasePath`
- **DATABASE OPERATIONS:** Next.js server queries Prisma workspace table.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** Authenticated HTTP GET request over loopback to Next.js server.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 12: `observeDatabaseIdentityFromWorker()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromWorker()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Fell back to synthetic expected key if worker observation did not provide `observedDatabaseKey`.
- **ROOT CAUSE:** V1159-03: Potential synthetic fallback on incomplete worker observation.
- **INPUT CONTRACT:** `worker: AcceptanceWorkerHandle`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>`
- **EXACT EXECUTION STEPS:**
  1. Awaits worker startup event via `worker.waitForDbObservation(8000)`.
  2. Retrieves observations via `worker.getDbObservations()`.
  3. Matches observation by `markerId` or `acceptanceRunId`.
  4. Returns `observedDatabaseKey: matched.databaseKey || null` strictly without synthetic fallback.
- **DEPENDENCIES:** `AcceptanceWorkerHandle`
- **DATABASE OPERATIONS:** Worker subprocess queries Prisma workspace.
- **WORKER OPERATIONS:** Captures real child process PID and DB observation event.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 13: `observeDatabaseIdentityFromPrisma()`
- **FUNCTION NAME:** `observeDatabaseIdentityFromPrisma()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** PRESERVED
- **OLD BEHAVIOR:** Executed direct Prisma readback query against isolated database.
- **ROOT CAUSE:** None (maintained integrity from V11.5.8).
- **INPUT CONTRACT:** `prisma: PrismaClient`, `context: LiveAcceptanceContext`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ProcessDatabaseObservation>`
- **EXACT EXECUTION STEPS:**
  1. Queries `prisma.workspace.findUnique({ where: { id: markerId } })`.
  2. Resolves database configuration via `resolveDatabaseConfiguration()`.
  3. Returns observation with `processId: process.pid`, `markerObserved: Boolean(ws)`.
- **DEPENDENCIES:** `@prisma/client`, `@/lib/database/databaseConfig`
- **DATABASE OPERATIONS:** Executes SQL query via Prisma Client on isolated SQLite DB.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 14: `collectDatabaseIsolationEvidence()`
- **FUNCTION NAME:** `collectDatabaseIsolationEvidence()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Did not integrate `evaluateDatabaseIsolationVerdict()`; handled `activeDatabaseProtected` with possible loose truth evaluation.
- **ROOT CAUSE:** V1159-02: Missing centralized fail-closed isolation verdict evaluator.
- **INPUT CONTRACT:** `options: Kh01AcceptanceOptions`, `context: LiveAcceptanceContext`
- **OUTPUT CONTRACT:** `Promise<DatabaseIsolationEvidence>`
- **EXACT EXECUTION STEPS:**
  1. Verifies isolated database file was created on disk.
  2. Evaluates active database protection via `verifyActiveDatabaseMarkerAbsent()`.
  3. Calls `evaluateDatabaseIsolationVerdict()` with isolation and active protection results.
  4. Returns structured `DatabaseIsolationEvidence` containing status and error details.
- **DEPENDENCIES:** `evaluateDatabaseIsolationVerdict`, `verifyActiveDatabaseMarkerAbsent`
- **DATABASE OPERATIONS:** Queries active DB to ensure zero marker leakage.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 15: `validateAcceptanceArtifact()`
- **FUNCTION NAME:** `validateAcceptanceArtifact()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Allowed `database-process-identity.json` without verifying `verified === true` or checking that `WORKER` and `NEXTJS_SERVER` observations were present without errors.
- **ROOT CAUSE:** V1159-04: Weak artifact schema validation for database process identity.
- **INPUT CONTRACT:** `artifactName: string`, `data: any`
- **OUTPUT CONTRACT:** `string[]` (list of validation errors)
- **EXACT EXECUTION STEPS:**
  1. Validates base artifact identity fields (`acceptanceRunId`, `testedCommitSha`).
  2. For `database-process-identity.json`:
     - Asserts `d.verified === true`.
     - Asserts `d.activeDatabaseProtected === true`.
     - Asserts `d.observedProcesses` contains verified `WORKER` and `NEXTJS_SERVER` entries.
     - Asserts `d.errors` is empty.
  3. Returns accumulated validation errors.
- **DEPENDENCIES:** None.
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 16: `buildCanonicalAcceptanceExecutionPlan()`
- **FUNCTION NAME:** `buildCanonicalAcceptanceExecutionPlan()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Required 34 suites; did not include `tests/integration/kh01FinalAcceptanceFailClosed.test.ts` in required suites or Stage 03D truthfulness suite.
- **ROOT CAUSE:** V1159-07, V1159-08: Missing comprehensive fail-closed integration test suite in canonical plan.
- **INPUT CONTRACT:** `options: Kh01AcceptanceOptions`
- **OUTPUT CONTRACT:** `Kh01AcceptanceExecutionPlan` (35 required suites, planId `KH-01-V11.5.9-PLAN`, version `11.5.9`)
- **EXACT EXECUTION STEPS:**
  1. Adds `tests/integration/kh01FinalAcceptanceFailClosed.test.ts` to `requiredSuites` (total 35 suites).
  2. Updates `applicationVersion` to `"11.5.9"`.
  3. Updates `STAGE_03D_TRUTHFULNESS_SUITE` to execute `kh01FinalAcceptanceFailClosed.test.ts`.
  4. Returns immutable canonical execution plan.
- **DEPENDENCIES:** `Kh01AcceptanceExecutionPlan`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 17: `evaluateReleaseDefects()`
- **FUNCTION NAME:** `evaluateReleaseDefects()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** PRESERVED / EXTENDED
- **OLD BEHAVIOR:** Evaluated 18 defects; did not include V1159-01 through V1159-08 definitions.
- **ROOT CAUSE:** V1159-08: Lack of dynamic evaluation for V11.5.9 defects.
- **INPUT CONTRACT:** `defectDefs: ReleaseDefectDefinition[]`, `context: { executedSuites: string[]; testedCommitSha: string }`
- **OUTPUT CONTRACT:** `ReleaseDefectRecord[]` (26 tracked defects dynamically evaluated)
- **EXACT EXECUTION STEPS:**
  1. Iterates over `defectDefs` (including all 8 V11.5.9 defects).
  2. Checks whether verifying test file is included in `context.executedSuites`.
  3. If executed: sets status `FIXED_VERIFIED` with verified assertion count and commit SHA reference.
  4. If omitted: sets status `OPEN`, blocking release.
- **DEPENDENCIES:** `ReleaseDefectDefinition`, `ReleaseDefectRecord`
- **DATABASE OPERATIONS:** None.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.

---

### FUNCTION 18: `runFullKh01Acceptance()`
- **FUNCTION NAME:** `runFullKh01Acceptance()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** MODIFIED
- **OLD BEHAVIOR:** Passed default token to Next.js server; omitted `database-process-identity` from artifact statuses; published to `artifacts/v11.5.8/`.
- **ROOT CAUSE:** V1159-01, V1159-04: Hardcoded publication directories and missing process identity gate checks.
- **INPUT CONTRACT:** `options: Kh01AcceptanceOptions = {}`
- **OUTPUT CONTRACT:** `Promise<FullKh01AcceptanceReport>`
- **EXACT EXECUTION STEPS:**
  1. Generates cryptographically secure `dbObservationToken` and unique `acceptanceRunId`.
  2. Passes token and run ID to `startSwaiTestServer()`.
  3. Executes all 13 stages sequentially under active execution envelopes.
  4. Records `database-process-identity` in `artifactStatuses`.
  5. Evaluates defect register with all 26 defects dynamically verified.
  6. Atomically stages and publishes artifacts to `artifacts/v11.5.9/<acceptanceRunId>/`.
  7. Verifies published evidence via `verifyPublishedAcceptanceEvidence()`.
  8. Emits final verdict: `CONDITIONALLY_ACCEPTED` for offline scope.
- **DEPENDENCIES:** All acceptance runner sub-modules and helpers
- **DATABASE OPERATIONS:** Complete isolated SQLite lifecycle; active database safety checks.
- **WORKER OPERATIONS:** Spawns and supervises real child worker process.
- **NETWORK OPERATIONS:** Next.js server lifecycle and HTTP readback tests.
- **BROWSER OPERATIONS:** Headless Chromium browser automation across 6 viewports.

---

### FUNCTION 19: `verifyActiveDatabaseMarkerAbsent()`
- **FUNCTION NAME:** `verifyActiveDatabaseMarkerAbsent()`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** PRESERVED / HARDENED
- **OLD BEHAVIOR:** Protected active database via direct libSQL query against `dev.db`.
- **ROOT CAUSE:** Maintained and validated under V1159-02 truth table.
- **INPUT CONTRACT:** `activeAppDbRaw: string`, `markerId: string`
- **OUTPUT CONTRACT:** `Promise<ActiveDatabaseProtectionEvidence>`
- **EXACT EXECUTION STEPS:**
  1. Asserts target `dev.db` exists.
  2. Queries `sqlite_master` for table `Workspace`.
  3. Queries `SELECT id FROM Workspace WHERE id = ?`.
  4. Returns `PASSED` when 0 rows match; `FAILED` if rows > 0; `NOT_VERIFIED` on error.
- **DEPENDENCIES:** `@libsql/client`, `fs`
- **DATABASE OPERATIONS:** Read-only query against `dev.db`.
- **WORKER OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
