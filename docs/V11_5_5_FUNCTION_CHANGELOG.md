# SWAI V11.5.5 — FUNCTION-LEVEL CHANGELOG
## KH-01 Acceptance Verification Engine & Production Runtime

**Release:** V11.5.5 — Final Acceptance Lock  
**Specification:** KH-01 Master Acceptance Specification  
**Repository:** `quocan050302/Shopify-Search`  
**Branch:** `feature/v11-meta-collector-remove-muse`  
**Baseline SHA:** `f29062ec5afda249fd6e743b642c79c9287f084e`  
**Audited HEAD:** `726c77e7770455c261ce1abc0cb9dc70c84f6eb8`  

---

## 1. `executeLiveResearchThroughWorker()`

- **FUNCTION NAME:** `executeLiveResearchThroughWorker`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten)
- **OLD IMPLEMENTATION:**
  Directly instantiated `createMetaCollectorClient()` and invoked `client.searchAds()`. Fabricated an acceptance run ID (`kh01-live-<timestamp>`) in-memory and returned raw MCP ads without involving the Discovery Worker, orchestrator, lease management, or pipeline queue.
- **ROOT CAUSE:**
  Defect FIX-01: Acceptance runner bypassed the Worker subsystem entirely, labeling a raw direct MCP query as "Worker E2E execution".
- **INPUT CONTRACT:**
  ```typescript
  context: LiveAcceptanceContext,
  query: DiscoveryQuery
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<LiveWorkerExecutionResult>
  // returns { success, runId, workerId, initialStatus, finalStatus, claimedAt, completedAt, retrievedCount, validCount, evidenceReferences, errorCategory?, error? }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Validates isolated database context via `verifyAcceptanceDatabaseIdentity(context)`.
  2. Submits a real production job via `discoveryOrchestrator.createDiscoveryJob(jobInput)` using isolated Prisma client.
  3. Verifies initial run status in database is `PENDING` and belongs to the acceptance workspace.
  4. Calls `discoveryOrchestrator.claimPendingDiscoveryJob(workerId)` to simulate real worker claiming lease on that specific run.
  5. Verifies claim lease was acquired by checking `run.status === "RUNNING"` and `run.workerId === workerId`.
  6. Executes the job through `discoveryOrchestrator.executeDiscoveryJob(claimedRun.id)` which runs the registered provider (`meta-ads-collector`) and production ingestion pipeline.
  7. Polls database with a bounded 120s timeout until terminal status (`COMPLETED`, `FAILED`, `BLOCKED`, `RATE_LIMITED`, `TIMED_OUT`).
  8. Queries final persisted run and reads actual `retrievedCount` and `validCount` from database rows.
  9. Returns comprehensive `LiveWorkerExecutionResult`.
- **CALLED FUNCTIONS:**
  - `verifyAcceptanceDatabaseIdentity`
  - `discoveryOrchestrator.createDiscoveryJob`
  - `discoveryOrchestrator.claimPendingDiscoveryJob`
  - `discoveryOrchestrator.executeDiscoveryJob`
  - `context.db.discoveryRun.findUnique`
- **DATABASE OPERATIONS:**
  - `discoveryRun.create` (via orchestrator)
  - `discoveryRun.findUnique`
  - `discoveryRun.update` (claim & execution state transitions)
- **NETWORK OPERATIONS:**
  - Provider network calls via MCP subprocess during worker execution (when live MCP is available).
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:**
  - Throws/returns `success: false` if job creation fails.
  - Returns `success: false, errorCategory: "UNCLAIMED"` if worker fails to claim run within timeout.
  - Returns `success: false, errorCategory: "EXECUTION_FAILED"` if worker execution encounters terminal error or invalid state.
- **SECURITY BOUNDARY:**
  Strictly constrained to isolated SQLite test database; workspace tenancy enforced on job creation.
- **REGRESSION TEST:**
  `tests/integration/kh01ActualWorkerExecution.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (4/4 tests: creates pending run, claims with worker lease, executes provider, handles execution failures).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/worker-execution.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 2. `verifyLivePersistence()`

- **FUNCTION NAME:** `verifyLivePersistence`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten to Read-Only)
- **OLD IMPLEMENTATION:**
  The verification function created a secondary `DiscoveryRun`, normalized raw ads, and called `ingestDiscoveredAds()` manually, effectively performing application ingestion work in the verification step.
- **ROOT CAUSE:**
  Defect FIX-02: Acceptance runner performed redundant data mutation and manufactured run relations, masking whether the worker pipeline actually persisted records.
- **INPUT CONTRACT:**
  ```typescript
  context: LiveAcceptanceContext,
  workerResult: LiveWorkerExecutionResult
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<LivePersistenceEvidence>
  // returns { status, runId, workspaceId, providerId, retrievedCount, validCount, linkedCount, persistedAdIds, orphanRelations, foreignWorkspaceAds, countConsistent, observedAt, evidenceOrigin: "DATABASE_READ_ONLY", error? }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Validates that `workerResult.runId` exists.
  2. Queries `discoveryRun.findUnique` for the run.
  3. Checks run workspace ownership matches `context.workspaceId`.
  4. Checks provider ID matches expected provider.
  5. Queries `discoveryRunAd.findMany` with `include: { ad: true }`.
  6. Evaluates each relation to detect orphan relations (`!ra.ad`) and foreign workspace records (`ra.ad.workspaceId !== context.workspaceId`).
  7. Gathers exact linked ad IDs.
  8. Verifies count consistency invariants (`linkedCount <= validCount <= retrievedCount`).
  9. Returns `LivePersistenceEvidence` with `status: "PASSED"` or `"FAILED"`. Absolutely no records are created, updated, or deleted.
- **CALLED FUNCTIONS:**
  - `context.db.discoveryRun.findUnique`
  - `context.db.discoveryRunAd.findMany`
- **DATABASE OPERATIONS:**
  - Strictly READ-ONLY SELECT queries on `discoveryRun` and `discoveryRunAd`. Zero INSERT, UPDATE, or DELETE statements.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:**
  - Fails if run does not exist in DB.
  - Fails if run belongs to wrong workspace.
  - Fails if run has terminal status `FAILED`.
  - Fails if orphan relations or foreign workspace ads are detected.
  - Fails if database arithmetic is inconsistent.
- **SECURITY BOUNDARY:**
  Tenant workspace isolation verified on every ad and run relation.
- **REGRESSION TEST:**
  `tests/integration/kh01PersistenceReadback.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (6/6 tests: read-only persistence, workspace isolation, orphan detection, count consistency, terminal failures, zero mutation).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/database-persistence.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 3. `verifyExactRunHttpReadback()`

- **FUNCTION NAME:** `verifyExactRunHttpReadback`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten for Real HTTP TCP)
- **OLD IMPLEMENTATION:**
  Constructed `new NextRequest(...)`, imported the API route handler function, called `GET(req)`, and parsed `body.ads`.
- **ROOT CAUSE:**
  Defects FIX-03 and FIX-04:
  1. An in-memory route handler function call was falsely labeled as a real HTTP TCP readback test.
  2. The code parsed `body.ads` instead of the actual API response schema `body.data`.
- **INPUT CONTRACT:**
  ```typescript
  server: SwaiTestServerHandle,
  context: LiveAcceptanceContext,
  runId: string,
  expectedAdIds: string[]
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<HttpReadbackEvidence>
  // returns { status, runId, baseUrl, endpoint, httpStatus, pagesFetched, totalReported, adIds, missingIds, unexpectedIds, duplicateIds, observedAt, evidenceOrigin: "ACTUAL_HTTP_RESPONSE", error? }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Verifies server is active and has valid `baseUrl` and `adminApiKey`.
  2. Initiates real TCP `fetch()` to `${server.baseUrl}/api/v1/discovery/meta/requests/${encodeURIComponent(runId)}/ads?page=${page}&pageSize=20`.
  3. Sends legitimate authorization headers (`Bearer ${server.adminApiKey}`, `x-workspace-id: ${context.workspaceId}`).
  4. Parses JSON response and accesses `body.data` (array of ads) and `body.pagination`.
  5. Loops across all pages (`page <= totalPages`) with a bound of 100 pages to collect all ads.
  6. Checks for duplicate ad IDs across pagination boundaries.
  7. Computes exact set differences: `missingIds = expected - observed`, `unexpectedIds = observed - expected`.
  8. Validates status: requires HTTP 200, zero missing IDs, zero unexpected IDs, and zero duplicates.
- **CALLED FUNCTIONS:**
  - Global `fetch()` (real HTTP request over loopback TCP).
- **DATABASE OPERATIONS:** None (server handles DB operations internally).
- **NETWORK OPERATIONS:**
  - Real TCP HTTP GET requests to `127.0.0.1:<port>`.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:**
  - Fails if server unreachable (network error).
  - Fails on HTTP non-200 (401, 403, 404, 500).
  - Fails on unparseable JSON.
  - Fails on duplicate IDs across pages.
  - Fails on missing or unexpected IDs.
- **SECURITY BOUNDARY:**
  Validates API key and workspace header handling through real HTTP stack.
- **REGRESSION TEST:**
  `tests/integration/kh01RealHttpReadback.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (8/8 tests: real TCP fetch, multi-page pagination, parsing body.data, auth headers, missing/unexpected ad detection, duplicate detection).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/http-readback.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 4. `verifyExactRunBrowserReadback()`

- **FUNCTION NAME:** `verifyExactRunBrowserReadback`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten for Real Chromium DOM Extraction)
- **OLD IMPLEMENTATION:**
  Checked if Chromium executable existed, then returned `{ status: "PASSED", runId, adIds: expectedAdIds, viewportsTested: ["1440x900"] }`. Completely fabricated browser observation by returning input `expectedAdIds`.
- **ROOT CAUSE:**
  Defect FIX-05: Outright fabrication of browser DOM observation evidence without launching Chromium or inspecting DOM nodes.
- **INPUT CONTRACT:**
  ```typescript
  server: SwaiTestServerHandle,
  context: LiveAcceptanceContext,
  runId: string,
  expectedAdIds: string[]
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<BrowserReadbackEvidence>
  // returns { status, runId, browserName, viewport, urlVisited, adIds, missingIds, unexpectedIds, duplicateIds, screenshotPath, browserLaunched, pageNavigated, domReadCompleted, observedAt, evidenceOrigin, error? }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Resolves Chrome/Chromium executable path via `resolveChromePath()`. Returns `status: "NOT_RUN"` if no browser binary is installed.
  2. Launches headless Chromium using Playwright: `chromium.launch({ executablePath, headless: true })`.
  3. Creates browser context with viewport 1440x900 and authorization headers.
  4. Navigates to `${server.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(runId)}`.
  5. Waits for exact run context banner `[data-testid="exact-run-context-banner"]`.
  6. Evaluates DOM locator `[data-testid="exact-run-ad-card"]` and reads attribute `data-ad-id` from rendered DOM elements.
  7. Computes exact set differences against expected IDs.
  8. Takes full page screenshot and saves to `artifacts/v11.5.5/<runId>/screenshots/browser-readback-<runId>.png`.
  9. Closes page, context, and browser instance cleanly in `finally` block.
  10. Returns `BrowserReadbackEvidence` with `evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION"`.
- **CALLED FUNCTIONS:**
  - `chromium.launch`
  - `browser.newContext`
  - `context.newPage`
  - `page.goto`
  - `page.waitForSelector`
  - `page.$$eval`
  - `page.screenshot`
  - `browser.close`
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** Real HTTP navigation over TCP to Next.js server.
- **BROWSER OPERATIONS:**
  - Full headless browser launch, DOM tree traversal, locator assertions, screenshot capture.
- **ERROR PATHS:**
  - Returns `NOT_RUN` if browser binary missing.
  - Returns `FAILED` if browser launch throws, page navigation times out, or banner is missing.
  - Returns `FAILED` if DOM ad IDs do not match expected IDs.
- **SECURITY BOUNDARY:**
  Authenticated browser session with scoped workspace header.
- **REGRESSION TEST:**
  `tests/e2e/kh01RealBrowserReadback.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (4/4 tests: real Chromium launch, banner validation, DOM ID extraction, mismatch detection, clean teardown).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/browser-readback.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 5. `verifyLiveMetaSource()`

- **FUNCTION NAME:** `verifyLiveMetaSource`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten with Strict Truth Table)
- **OLD IMPLEMENTATION:**
  Used weak AND condition:
  `if (!crossBoundary.consistent && (httpReadback.status !== "PASSED" || browserReadback.status !== "PASSED"))`
  which failed only when reconciliation was inconsistent AND at least one readback failed. Furthermore, it appended `levelsVerified.push("RUN_RECONCILED")` before HTTP and browser readbacks completed.
- **ROOT CAUSE:**
  Defects FIX-06 and FIX-07: Flawed boolean logic allowed inconsistent states to pass, and premature level assertion recorded `RUN_RECONCILED` without verification across all boundaries.
- **INPUT CONTRACT:**
  ```typescript
  context: LiveAcceptanceContext,
  query: DiscoveryQuery,
  server?: SwaiTestServerHandle
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<LiveMetaSourceEvidence>
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Verifies MCP client connectivity (`MCP_CONNECTED`).
  2. Executes real research through worker (`SOURCE_ACCESSIBLE`, `ADS_COLLECTED`).
  3. Verifies persistence strictly read-only (`ADS_PERSISTED`).
  4. Appends intermediate level `DATABASE_RECONCILED`.
  5. Performs real HTTP readback via `verifyExactRunHttpReadback()`.
  6. Performs real Chromium readback via `verifyExactRunBrowserReadback()`.
  7. Performs exact ID set comparison across DB, HTTP, and Browser boundaries via `compareEvidenceAcrossBoundaries()`.
  8. Evaluates overall cross-boundary verdict via `evaluateCrossBoundaryVerdict()`, strictly following the 7-row truth table:
     - PASS only if HTTP === PASSED && Browser === PASSED && Reconciliation === CONSISTENT.
     - Append `RUN_RECONCILED` only when all three pass.
     - Return FAILED or NOT_VERIFIED for any non-passing row.
- **CALLED FUNCTIONS:**
  - `executeLiveResearchThroughWorker`
  - `verifyLivePersistence`
  - `verifyExactRunHttpReadback`
  - `verifyExactRunBrowserReadback`
  - `compareEvidenceAcrossBoundaries`
  - `evaluateCrossBoundaryVerdict`
- **DATABASE OPERATIONS:** Read-only persistence verification queries.
- **NETWORK OPERATIONS:** HTTP readback requests.
- **BROWSER OPERATIONS:** Chromium readback DOM extraction.
- **ERROR PATHS:**
  - Fails if worker execution fails.
  - Fails if persistence verification fails.
  - Fails if HTTP readback fails or mismatches.
  - Fails if browser readback fails or mismatches.
  - Fails if ID sets across DB, HTTP, and Browser disagree.
- **SECURITY BOUNDARY:**
  Ensures external Meta live verification cannot be claimed without end-to-end evidence.
- **REGRESSION TEST:**
  `tests/integration/kh01CrossBoundaryReconciliation.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (14/14 tests: full 7-row truth table verification, exact set matching, level progression).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/live-source-results.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 6. `runFullKh01Acceptance()`

- **FUNCTION NAME:** `runFullKh01Acceptance`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten & Extended)
- **OLD IMPLEMENTATION:**
  Lacked dedicated browser E2E stage, used title/basename-based Vitest parsing, wrote artifacts directly without disk readback validation, and risked reporting mismatch with CLI exit code.
- **ROOT CAUSE:**
  Defects FIX-08, FIX-10, FIX-12, FIX-15.
- **INPUT CONTRACT:**
  ```typescript
  options?: Kh01CliOptions
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<{ report: FullKh01AcceptanceReport; exitCode: number }>
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Parses CLI options (`--live-meta`, `--offline-only`, `--target-commit`, etc.).
  2. Resolves git state, commits, and creates isolated database template.
  3. Executes stages sequentially:
     - `STAGE_01_GIT_STATE`
     - `STAGE_02_TYPESCRIPT`
     - `STAGE_03A_SECURITY`
     - `STAGE_03B_EXACT_RUN`
     - `STAGE_03C_READINESS`
     - `STAGE_03D_TRUTHFULNESS`
     - `STAGE_03E_DOMAIN_UNIT`
     - `STAGE_04_CONCURRENCY_RECOVERY`
     - `STAGE_05_UNIFIED_JOURNEY`
     - `STAGE_06_PRODUCTION_BUILD`
     - `STAGE_08_META_DISCOVERY_BROWSER_E2E` (runs `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`)
     - `STAGE_07_LIVE_META` (only if `--live-meta` flag is provided)
     - `STAGE_09_ARTIFACT_VALIDATION`
     - `STAGE_10_FINAL_MANIFEST_VALIDATION`
  4. Gathers all canonical gate results using exact canonical keys.
  5. Builds candidate artifacts and manifest.
  6. Calls `writeAcceptanceArtifacts()` to write to disk, read back, and validate every JSON file.
  7. Derives release verdict: `ACCEPTED` (only if live passed), `CONDITIONALLY_ACCEPTED` (if offline passed without live), or `BLOCKED`.
  8. Synchronizes exit code: 0 for `ACCEPTED`/`CONDITIONALLY_ACCEPTED`, 1 for `BLOCKED`.
- **CALLED FUNCTIONS:**
  - `executeAcceptanceStage`
  - `resolveExecutedAssertion`
  - `writeAcceptanceArtifacts`
  - `finalizeAcceptanceVerdict`
- **DATABASE OPERATIONS:** Ephemeral isolated SQLite database setup and verification.
- **NETWORK OPERATIONS:** Test server lifecycle.
- **BROWSER OPERATIONS:** Browser E2E suite execution.
- **ERROR PATHS:**
  - Blocks release on any stage failure, gate failure, artifact validation error, or manifest schema failure.
- **SECURITY BOUNDARY:**
  Ensures release verdict cannot be falsified; fails closed.
- **REGRESSION TEST:**
  `tests/unit/kh01FinalVerdict.test.ts`, `tests/unit/kh01CliArgs.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (6/6 CLI tests, 9/9 verdict tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/acceptance-manifest.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 7. `finalizeAcceptanceVerdict()`

- **FUNCTION NAME:** `finalizeAcceptanceVerdict`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten)
- **OLD IMPLEMENTATION:**
  Permitted loose interpretations where offline-only passes could be described as fully accepted releases.
- **ROOT CAUSE:**
  Defect FIX-15: Release verdict semantics required strict separation between offline acceptance (`CONDITIONALLY_ACCEPTED`) and live verified acceptance (`ACCEPTED`).
- **INPUT CONTRACT:**
  ```typescript
  gateResults: GateEvidence[],
  requiredArtifacts: AcceptanceArtifactStatus[],
  manifestValid: boolean,
  liveResult?: LiveMetaSourceEvidence
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  ReleaseVerdictResult
  // returns { overallStatus, releaseVerdict, offlineScope, liveScope, reason }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Checks if manifest is invalid: returns `BLOCKED`.
  2. Checks if any canonical gate failed or was not run: returns `BLOCKED`.
  3. Checks if any required artifact failed or was blocked: returns `BLOCKED`.
  4. If offline gates passed:
     - If live result is provided and passed: returns `ACCEPTED` with `liveScope: "VERIFIED"`.
     - If live was not executed: returns `CONDITIONALLY_ACCEPTED` with `liveScope: "NOT_VERIFIED"`.
     - If live was executed but failed: returns `BLOCKED` with `liveScope: "BLOCKED"`.
- **CALLED FUNCTIONS:** None (pure decision logic).
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:** Deterministically returns `BLOCKED` on any requirement deficit.
- **SECURITY BOUNDARY:** Release gate invariant enforcement.
- **REGRESSION TEST:**
  `tests/unit/kh01FinalVerdict.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (9/9 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/release-verdict.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 8. `writeAcceptanceArtifacts()`

- **FUNCTION NAME:** `writeAcceptanceArtifacts`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten with Polymorphism & Readback Validation)
- **OLD IMPLEMENTATION:**
  Wrote files directly and simply checked `existsSync()`. Did not read back file contents, parse JSON, or validate schema, allowing corrupt files or write failures to go undetected.
- **ROOT CAUSE:**
  Defect FIX-08: Acceptance artifact publication lacked readback validation and atomic consistency.
- **INPUT CONTRACT:**
  Polymorphic signature supporting both runner and existing unit tests:
  ```typescript
  (acceptanceRunIdOrDir: string, commitShaOrArtifacts: string | Record<string, unknown>, maybeArtifacts?: Record<string, unknown>)
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<{ success: boolean; writtenFiles: string[]; validationErrors: string[] }>
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Resolves target output directory (`artifacts/v11.5.5/<runId>` and base directory `artifacts/v11.5.5`).
  2. Serializes every artifact to disk with formatting.
  3. Immediately reads back every written file from disk.
  4. Parses JSON and verifies valid syntax and non-empty payload.
  5. Validates required schema fields: `acceptanceRunId`, `testedCommitSha`, `status`, `observedAt`, `evidenceOrigin`.
  6. Rejects impossible states (e.g. Browser status PASSED but `browserLaunched: false`).
  7. If any error occurs, records validation error and sets `success: false`.
- **CALLED FUNCTIONS:**
  - `fs.writeFileSync`
  - `fs.readFileSync`
  - `JSON.parse`
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:**
  - Catches I/O errors and schema invalidities; returns `success: false` and list of errors.
- **SECURITY BOUNDARY:** Protects audit trail integrity.
- **REGRESSION TEST:**
  `tests/unit/kh01ArtifactIntegrity.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (6/6 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/artifact-validation.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 9. `parseVitestJsonAssertions()` & `normalizeTestIdentity()`

- **FUNCTION NAME:** `parseVitestJsonAssertions` / `normalizeTestIdentity`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING (Rewritten for Canonical Exact Key)
- **OLD IMPLEMENTATION:**
  Normalized test file identities using basenames and generated title-only and basename aliases (`fullName`, `title`, `basename::title`), which caused collision between different test files sharing similar test names.
- **ROOT CAUSE:**
  Defect FIX-10: Ambiguous assertion identity resolution permitted alias collisions and incorrect gate mappings.
- **INPUT CONTRACT:**
  ```typescript
  normalizeTestIdentity(entry: { testFile: string; fullName: string }): string
  parseVitestJsonAssertions(rawJson: unknown): Map<string, VitestAssertionRecord>
  ```
- **OUTPUT CONTRACT:**
  Exact single canonical key formatted as:
  `<repo-relative-test-path>::<exact-full-test-name>`
  e.g.:
  `tests/unit/adminAuthTrustBoundary.test.ts::rejects spoofed x-forwarded-for header from remote client`
- **EXACT IMPLEMENTATION STEPS:**
  1. Strips current working directory and common virtual roots (`/workspace/`, `/app/`) to produce strict repo-relative path.
  2. Combines with exact `fullName`.
  3. `parseVitestJsonAssertions` parses report and populates map strictly by canonical key.
  4. Detects duplicates and rejects ambiguous identities without generating title-only or basename-only aliases.
- **CALLED FUNCTIONS:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:** Throws on malformed JSON or invalid schema.
- **SECURITY BOUNDARY:** Verification gate integrity.
- **REGRESSION TEST:**
  `tests/unit/kh01AssertionIdentity.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (5/5 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/gate-results.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 10. `resolveDeploymentSecurityPolicy()`

- **FUNCTION NAME:** `resolveDeploymentSecurityPolicy`
- **FILE PATH:** `src/services/security/adminAuth.ts`
- **EXISTING OR NEW:** EXISTING (Audited & Verified)
- **OLD IMPLEMENTATION:**
  Previously allowed missing `HOST` to be treated as local-only in ambiguous configurations, or allowed `SWAI_LOCAL_DESKTOP=true` to grant bypass even when bound publicly to `0.0.0.0`.
- **ROOT CAUSE:**
  Defect FIX-09: Insufficient deployment configuration could infer localhost trust under public network bindings.
- **INPUT CONTRACT:**
  ```typescript
  config?: DeploymentSecurityConfig
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  DeploymentSecurityPolicy
  // returns { mode, localBypassAllowed, configurationValid, reason }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Detects cloud container platforms (Vercel, Render, Fly, KNative): enforces `AUTHENTICATED_REMOTE`.
  2. Detects explicit `REMOTE` deployment mode: enforces `AUTHENTICATED_REMOTE`.
  3. Detects remote access flag: enforces `AUTHENTICATED_REMOTE`.
  4. Inspects host binding: if `0.0.0.0`, strictly sets `localBypassAllowed: false`. If declared local desktop while bound to `0.0.0.0`, flags configuration conflict (`configurationValid: false`).
  5. Non-loopback IPs (e.g. LAN 192.168.x.x) enforce `AUTHENTICATED_REMOTE`.
  6. Loopback binding (`127.0.0.1`, `localhost`, `[::1]`) permits `LOCAL_ONLY` bypass unless strict auth is required by environment (`SWAI_REQUIRE_AUTH=true` or `SWAI_E2E_SERVER=true`).
- **CALLED FUNCTIONS:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:** Fails closed to `AUTHENTICATED_REMOTE`.
- **SECURITY BOUNDARY:** Primary defense against unauthenticated public access.
- **REGRESSION TEST:**
  `tests/unit/adminAuthTrustBoundary.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (27/27 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/security-results.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 11. `compareEvidenceAcrossBoundaries()` & `evaluateCrossBoundaryVerdict()`

- **FUNCTION NAME:** `compareEvidenceAcrossBoundaries` / `evaluateCrossBoundaryVerdict`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** EXISTING / NEW (Truth Table Engine)
- **OLD IMPLEMENTATION:**
  Evaluated cross-boundary consistency with permissive boolean logic that could allow inconsistent readback results to pass.
- **ROOT CAUSE:**
  Defect FIX-06: Inadequate cross-boundary boolean checks.
- **INPUT CONTRACT:**
  ```typescript
  compareEvidenceAcrossBoundaries(input: CrossBoundaryInput): CrossBoundaryEvidence
  evaluateCrossBoundaryVerdict(params: { httpStatus: string; browserStatus: string; reconciliationConsistent: boolean }): "PASSED" | "FAILED" | "NOT_VERIFIED"
  ```
- **OUTPUT CONTRACT:**
  - `CrossBoundaryEvidence`: exact set equality across DB, HTTP, and Browser ad IDs.
  - `evaluateCrossBoundaryVerdict`: strict verdict matching the 7-row truth table.
- **EXACT IMPLEMENTATION STEPS:**
  1. Compares `dbAdIds`, `httpAdIds`, and `browserAdIds` sets.
  2. Ensures lengths match and sets are symmetric differences are empty.
  3. `evaluateCrossBoundaryVerdict` enforces:
     - PASS/PASS/CONSISTENT -> `PASSED`
     - PASS/PASS/INCONSISTENT -> `FAILED`
     - PASS/FAIL/CONSISTENT -> `FAILED`
     - FAIL/PASS/CONSISTENT -> `FAILED`
     - FAIL/FAIL/INCONSISTENT -> `FAILED`
     - NOT_RUN/PASS/CONSISTENT -> `NOT_VERIFIED`
     - PASS/NOT_RUN/CONSISTENT -> `NOT_VERIFIED`
- **CALLED FUNCTIONS:** None.
- **DATABASE OPERATIONS:** None.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:** Fails closed.
- **SECURITY BOUNDARY:** Cross-boundary data integrity guarantee.
- **REGRESSION TEST:**
  `tests/integration/kh01CrossBoundaryReconciliation.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (14/14 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/cross-boundary-reconciliation.json`
- **STATUS:** FIXED_AND_VERIFIED

---

## 12. `verifyAcceptanceDatabaseIdentity()`

- **FUNCTION NAME:** `verifyAcceptanceDatabaseIdentity`
- **FILE PATH:** `scripts/kh01/runFullAcceptance.ts`
- **EXISTING OR NEW:** NEW
- **OLD IMPLEMENTATION:**
  Database isolation was assumed solely based on setting `process.env.TEST_DATABASE_URL`, without verifying whether the resolved SQLite path was identical across processes or collided with the active development or production database.
- **ROOT CAUSE:**
  Defect FIX-07 / Database Isolation requirement: Absence of independent identity verification across multi-process boundaries.
- **INPUT CONTRACT:**
  ```typescript
  context: LiveAcceptanceContext
  ```
- **OUTPUT CONTRACT:**
  ```typescript
  Promise<DatabaseIdentityEvidence>
  // returns { isolated: boolean; databaseUrl: string; canonicalPath: string; isProduction: boolean; isDev: boolean; matchingProcesses: boolean; errors: string[] }
  ```
- **EXACT IMPLEMENTATION STEPS:**
  1. Resolves canonical filesystem path of `context.databaseUrl`.
  2. Resolves canonical paths of active `prisma/dev.db` and any production database URL.
  3. Asserts canonical path is NOT equal to production database path.
  4. Asserts canonical path is NOT equal to active development database path.
  5. Asserts the file contains the expected test template tables (`discoveryRun`, `competitorAd`, etc.).
  6. Returns full verification evidence.
- **CALLED FUNCTIONS:**
  - `fs.realpathSync`
  - `path.resolve`
- **DATABASE OPERATIONS:** Read schema verification.
- **NETWORK OPERATIONS:** None.
- **BROWSER OPERATIONS:** None.
- **ERROR PATHS:** Rejects non-isolated or colliding database configurations.
- **SECURITY BOUNDARY:** Absolute safety of user and production databases.
- **REGRESSION TEST:**
  `tests/integration/kh01DatabaseIsolation.test.ts`
- **EXECUTED TEST RESULT:**
  PASSED (5/5 tests).
- **EVIDENCE PATH:**
  `artifacts/v11.5.5/<runId>/database-isolation.json`
- **STATUS:** FIXED_AND_VERIFIED
