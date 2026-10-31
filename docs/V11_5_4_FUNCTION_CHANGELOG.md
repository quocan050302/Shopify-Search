# SWAI V11.5.4 — Function-Level Changelog (Execution Contract)

**Specification:** KH-01 Master Release Acceptance  
**Release Version:** V11.5.4 FINAL  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Inspected Baseline SHA:** `c3a1b8ec846f0b729dcd83319fab2c58f5fc7113`  
**Target Market:** United States (`RESEARCH_ONLY`)

---

## Function Entries

```text
FUNCTION: validateServerBindingPolicy
FILE: src/services/security/adminAuth.ts
EXISTING OR NEW: NEW
OLD BEHAVIOR:
Did not exist. Binding policy was assumed local if process.env.HOST was empty, or if NODE_ENV !== "production".
ROOT CAUSE:
An empty or unconfigured HOST listener could be bound by the server to 0.0.0.0 (all interfaces) or remote ports without detecting remote exposure, allowing unauthorized access when local bypass mode was enabled.
INPUT CONTRACT:
config: { host?: string; port?: number; localDesktop?: boolean; adminApiKeyConfigured?: boolean; nodeEnv?: string }
OUTPUT CONTRACT:
{ mode: "LOCAL_ONLY" | "AUTHENTICATED_REMOTE" | "INVALID"; localBypassAllowed: boolean; configurationValid: boolean; reason: string }
DEPENDENCIES:
None (pure deterministic validator).
EXACT EXECUTION LOGIC:
1. Normalize host input (trimming and lowercase).
2. Explicitly classify 0.0.0.0, empty host strings with remote intent, or non-loopback IPs as AUTHENTICATED_REMOTE or INVALID.
3. Require exact loopback binding (127.0.0.1 or localhost) to qualify for LOCAL_ONLY mode.
4. If bound to non-loopback and localDesktop is asserted without an admin API key, return configurationValid = false.
ERROR HANDLING:
Fails closed: if configuration is contradictory or ambiguous, returns configurationValid: false and localBypassAllowed: false.
SECURITY CONDITIONS:
Guarantees remote callers cannot leverage local administrator bypass on publicly bound listeners.
TEST FILE: tests/unit/adminAuthTrustBoundary.test.ts
TEST NAME: "rejects 0.0.0.0 host binding as remote"
ACTUAL RESULT: PASSED (mode === "AUTHENTICATED_REMOTE", localBypassAllowed === false)
EVIDENCE REFERENCE: tests/unit/adminAuthTrustBoundary.test.ts:25-50
STATUS: VERIFIED
```

---

```text
FUNCTION: resolveAdminPrincipal
FILE: src/services/security/adminAuth.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
When no ADMIN_API_KEY was configured in local development, checked whether a provided token contained substrings "invalid" or "bad". If it did not, an arbitrary token was treated as authentic.
ROOT CAUSE:
Flawed heuristic fallback in resolveAdminPrincipal that checked token string spelling instead of cryptographic or exact token verification against a configured secret.
INPUT CONTRACT:
request: Request (inspecting Authorization header, x-admin-key header, or admin session cookie)
OUTPUT CONTRACT:
AdminPrincipal | null
DEPENDENCIES:
resolveTrustedRequestContext, getEffectiveAdminApiKey, isTrustedLocalDeployment
EXACT EXECUTION LOGIC:
1. Extract any explicitly provided credential from Bearer token, x-admin-key header, or cookie.
2. If a credential was explicitly provided:
   a. Check if an effective admin secret verifier is configured.
   b. If no verifier is configured, immediately return null (credential cannot be verified).
   c. If a verifier is configured, perform constant-time comparison against the secret.
3. If no credential was provided at all, check if isTrustedLocalDeployment() allows local administrator bypass on genuine loopback.
ERROR HANDLING:
Returns null on any invalid token, unverified explicit token, or malformed header.
SECURITY CONDITIONS:
Arbitrary caller-supplied tokens can NEVER implicitly authenticate without a matching configured server-side secret.
TEST FILE: tests/unit/adminAuthTrustBoundary.test.ts
TEST NAME: "rejects arbitrary explicit tokens when no admin API key is configured"
ACTUAL RESULT: PASSED (null returned for "arbitrary-token-123", "some-token", "abc123")
EVIDENCE REFERENCE: tests/unit/adminAuthTrustBoundary.test.ts:85-120
STATUS: VERIFIED
```

---

```text
FUNCTION: importAdvertisementForWorkspace
FILE: src/services/ads/adService.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Accepted workspaceId and optional runId, but did not independently verify that runId actually belonged to workspaceId before inserting relationships or updating advertisements.
ROOT CAUSE:
Caller-supplied runId was trusted without verifying relational ownership in the database, allowing cross-workspace relational associations if an external caller passed another workspace's runId.
INPUT CONTRACT:
input: { workspaceId: string; runId?: string; adData: CompetitorAdInput }
OUTPUT CONTRACT:
Promise<{ ad: CompetitorAd; linked: boolean }>
DEPENDENCIES:
prisma.discoveryRun, prisma.discoveryRunAd, upsertCompetitorAd
EXACT EXECUTION LOGIC:
1. If runId is provided:
   a. Query prisma.discoveryRun by runId and workspaceId.
   b. If run does not exist or does not match workspaceId, reject operation with an error.
2. Execute canonical upsertCompetitorAd preserving global canonical identity and source provenance.
3. Atomically associate ad with DiscoveryRunAd if runId is valid and not already linked.
ERROR HANDLING:
Throws error if runId does not exist or belongs to another workspace.
SECURITY CONDITIONS:
Guarantees workspace boundary isolation; foreign workspace runs cannot be linked or mutated.
TEST FILE: tests/unit/adServiceCrossWorkspace.test.ts
TEST NAME: "rejects linking advertisement when runId belongs to another workspace"
ACTUAL RESULT: PASSED (Throws workspace mismatch error, zero foreign relationships created)
EVIDENCE REFERENCE: tests/unit/adServiceCrossWorkspace.test.ts:35-65
STATUS: VERIFIED
```

---

```text
FUNCTION: POST /api/v1/ads
FILE: src/app/api/v1/ads/route.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Called upsertCompetitorAd directly, bypassing workspace association and ownership validation.
ROOT CAUSE:
Direct call to low-level ad upsert instead of the authorized workspace import domain service.
INPUT CONTRACT:
NextRequest with JSON body: { ...adData, workspaceId?: string, runId?: string }
OUTPUT CONTRACT:
NextResponse with { success: boolean, ad: CompetitorAd }
DEPENDENCIES:
importAdvertisementForWorkspace, requireAdminAuth / getRequestWorkspace
EXACT EXECUTION LOGIC:
1. Validate authentication and extract authorized workspace context.
2. Route ad persistence through importAdvertisementForWorkspace ensuring relational checks.
3. Return canonical response with appropriate status code.
ERROR HANDLING:
Returns 400 on malformed input or run verification failure; 401/403 on authorization failure; 500 on database error.
SECURITY CONDITIONS:
Enforces workspace boundaries on incoming ad ingestion requests.
TEST FILE: tests/unit/adServiceCrossWorkspace.test.ts
TEST NAME: "POST /api/v1/ads utilizes importAdvertisementForWorkspace"
ACTUAL RESULT: PASSED
EVIDENCE REFERENCE: src/app/api/v1/ads/route.ts:40-75
STATUS: VERIFIED
```

---

```text
FUNCTION: reconcileResearchRunCounts
FILE: src/services/research/runReconciliationService.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Implicitly resolved Prisma client via global singleton or environment variable, causing mismatch during CLI acceptance testing when NODE_ENV !== "test". Also assigned displayedCount = linkedCount by policy.
ROOT CAUSE:
Lack of explicit dependency injection for Prisma client and assumption of UI rendering equality at the database layer.
INPUT CONTRACT:
runId: string, options?: { prisma?: any; observedHttpCount?: number; observedBrowserCount?: number }
OUTPUT CONTRACT:
Promise<RunCountReconciliation>
DEPENDENCIES:
prisma.discoveryRun, prisma.discoveryRunAd, evaluateRunCountInvariants
EXACT EXECUTION LOGIC:
1. Use injected options.prisma or fallback to isolated test database handle.
2. Read DiscoveryRun ledger counts and actual count of linked DiscoveryRunAd rows.
3. Validate invariants using evaluateRunCountInvariants.
4. Record observedHttpCount and observedBrowserCount if provided, keeping database counts distinct from presentation counts.
ERROR HANDLING:
Throws RunReconciliationError if run is not found in the target database.
SECURITY CONDITIONS:
Guarantees database queries run strictly against the intended isolated SQLite database instance.
TEST FILE: tests/integration/kh01CrossBoundaryReconciliation.test.ts
TEST NAME: "reconciles research run counts with isolated injected prisma"
ACTUAL RESULT: PASSED (consistent: true, exact ID matches)
EVIDENCE REFERENCE: tests/integration/kh01CrossBoundaryReconciliation.test.ts:30-80
STATUS: VERIFIED
```

---

```text
FUNCTION: evaluateRequiredArtifacts
FILE: src/lib/kh01/acceptanceGateRegistry.ts
EXISTING OR NEW: NEW
OLD BEHAVIOR:
Did not exist. Required artifacts (reconciliation and browser reports) were evaluated independently of the release verdict.
ROOT CAUSE:
Artifact creation occurred post-verdict calculation, allowing CONDITIONALLY_ACCEPTED verdicts even when exact-run reconciliation or browser reports failed.
INPUT CONTRACT:
artifacts: AcceptanceArtifactStatus[]
OUTPUT CONTRACT:
{ eligible: boolean; blockingReasons: string[]; blockingArtifactIds: string[] }
DEPENDENCIES:
None.
EXACT EXECUTION LOGIC:
1. Iterate over all artifacts marked required: true.
2. If artifact status is FAILED, BLOCKED, or NOT_RUN, mark eligible = false and record blocking reason.
3. If artifact is missing or corrupted, record blocking reason.
4. Return aggregate eligibility and lists of blocking artifact IDs.
ERROR HANDLING:
Fails closed: any non-PASSED status on a required artifact blocks acceptance.
SECURITY CONDITIONS:
Prevents release gating bypass through corrupted, failed, or unexecuted artifact generation.
TEST FILE: tests/unit/kh01ArtifactIntegrity.test.ts
TEST NAME: "evaluateRequiredArtifacts blocks release when required artifact fails"
ACTUAL RESULT: PASSED (eligible: false, blockingArtifactIds contains failed artifact ID)
EVIDENCE REFERENCE: tests/unit/kh01ArtifactIntegrity.test.ts:20-45
STATUS: VERIFIED
```

---

```text
FUNCTION: finalizeAcceptanceVerdict
FILE: src/lib/kh01/acceptanceGateRegistry.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Derived verdict solely from mandatory gates and unresolved blocking defects, ignoring artifact outcomes and CLI requested scope.
ROOT CAUSE:
Disconnection between artifact evaluation engine and verdict state machine.
INPUT CONTRACT:
input: { gates: GateEvidence[]; stages: AcceptanceStageResult[]; artifacts?: AcceptanceArtifactStatus[]; manifestValidation?: ManifestValidationResult; liveVerification?: LiveMetaVerificationResult; unresolvedBlockingDefects: DefectRecord[]; requestedScope?: "OFFLINE" | "FULL_LIVE" }
OUTPUT CONTRACT:
FinalVerdictResult: { verdict: "ACCEPTED" | "CONDITIONALLY_ACCEPTED" | "BLOCKED"; blockingReasons: string[]; blockingGateIds: string[]; blockingArtifactIds: string[]; liveStatus: string }
DEPENDENCIES:
evaluateRequiredArtifacts, deriveReleaseVerdict
EXACT EXECUTION LOGIC:
1. Check mandatory gates and blocking defects.
2. If artifacts provided, call evaluateRequiredArtifacts.
3. If requestedScope is FULL_LIVE and liveVerification did not achieve LIVE_RECONCILED, block release.
4. If any required artifact failed or is blocked, verdict is strictly BLOCKED.
5. If offline gates and artifacts pass and live is NOT_RUN or unavailable, return CONDITIONALLY_ACCEPTED.
ERROR HANDLING:
Fails closed: outputs structured blocking reasons for every failure.
SECURITY CONDITIONS:
Guarantees release verdict matches genuine evidence across all gates, stages, and artifacts.
TEST FILE: tests/unit/kh01ArtifactIntegrity.test.ts
TEST NAME: "finalizeAcceptanceVerdict blocks release when required artifact fails"
ACTUAL RESULT: PASSED (verdict: "BLOCKED")
EVIDENCE REFERENCE: tests/unit/kh01ArtifactIntegrity.test.ts:50-80
STATUS: VERIFIED
```

---

```text
FUNCTION: parseAcceptanceCliArgs
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD BEHAVIOR:
CLI entrypoint executed runFullKh01Acceptance() without inspecting command-line flags.
ROOT CAUSE:
Missing CLI argument parsing layer, preventing operators from opting into live Meta verification or enforcing offline-only execution.
INPUT CONTRACT:
argv: string[]
OUTPUT CONTRACT:
FullKh01AcceptanceOptions: { runLiveSource: boolean; requestedScope: "OFFLINE" | "FULL_LIVE"; targetMarket: string; ... }
DEPENDENCIES:
None.
EXACT EXECUTION LOGIC:
1. Scan argv for --live-meta, --offline-only, and --help.
2. If both --live-meta and --offline-only are passed, throw error (conflicting flags).
3. If unknown flags are encountered, throw error with usage information.
4. Default to runLiveSource: false (offline-only safe default).
ERROR HANDLING:
Throws error with descriptive message and exits nonzero on invalid or contradictory arguments.
SECURITY CONDITIONS:
Never triggers external live Meta data collection without explicit --live-meta CLI opt-in.
TEST FILE: tests/unit/kh01CliArgs.test.ts
TEST NAME: "parses --live-meta and --offline-only flags correctly and rejects conflicts"
ACTUAL RESULT: PASSED (6/6 tests passed)
EVIDENCE REFERENCE: tests/unit/kh01CliArgs.test.ts:15-60
STATUS: VERIFIED
```

---

```text
FUNCTION: normalizeTestIdentity
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD BEHAVIOR:
Did not exist. Test matching used file basename and fuzzy fullName.includes(expectedName).
ROOT CAUSE:
Substring matching could falsely match similarly named tests across different test suites.
INPUT CONTRACT:
input: { testFile: string; fullName: string }
OUTPUT CONTRACT:
string (canonical normalized identity in format: "relative/path/to/test.ts::full test name")
DEPENDENCIES:
path.normalize
EXACT EXECUTION LOGIC:
1. Normalize testFile relative to project workspace root.
2. Strip leading slashes and whitespace.
3. Concatenate normalized path, delimiter "::", and trimmed fullName.
ERROR HANDLING:
Throws error if testFile or fullName is empty.
SECURITY CONDITIONS:
Prevents false assertion matching and ambiguous test resolution.
TEST FILE: tests/unit/kh01AssertionIdentity.test.ts
TEST NAME: "produces unique canonical test identity"
ACTUAL RESULT: PASSED
EVIDENCE REFERENCE: tests/unit/kh01AssertionIdentity.test.ts:15-35
STATUS: VERIFIED
```

---

```text
FUNCTION: resolveExecutedAssertion
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Fell back to fullName.includes(expected.expectedTestName) or matching test file basename alone.
ROOT CAUSE:
Loose matching allowed passing tests with matching substrings to satisfy gates mapped to different assertions.
INPUT CONTRACT:
stageResult: AcceptanceStageResult, expected: GateAssertionRequirement
OUTPUT CONTRACT:
GateAssertionResolution: { matched: boolean; status: "PASSED" | "FAILED" | "NOT_RUN"; actualAssertion?: ParsedTestAssertion; reason?: string }
DEPENDENCIES:
normalizeTestIdentity
EXACT EXECUTION LOGIC:
1. Lookup assertion in stage parsed assertions map using normalized test identity (filePath::fullName).
2. If not found by full path, check for exact fullName match only within the same relative file.
3. Reject substring fuzzy matches completely.
4. Return matched status, recording FAILED or NOT_RUN if missing.
ERROR HANDLING:
Returns matched: false and status: "NOT_RUN" when assertion is absent from execution report.
SECURITY CONDITIONS:
Ensures mandatory gates reflect strictly the exact executed test assertion.
TEST FILE: tests/unit/kh01AssertionIdentity.test.ts
TEST NAME: "rejects fuzzy substring matches and requires exact assertion name"
ACTUAL RESULT: PASSED (matched: false when test name is only a substring)
EVIDENCE REFERENCE: tests/unit/kh01AssertionIdentity.test.ts:40-75
STATUS: VERIFIED
```

---

```text
FUNCTION: executeOfflineReconciliationAcceptance
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: NEW
OLD BEHAVIOR:
Offline fallback created a fixture run with retrieved=5, valid=5, but 0 linked ads, causing run reconciliation to report inconsistent or failing artifacts.
ROOT CAUSE:
Incomplete relational fixture setup in offline test fallback.
INPUT CONTRACT:
options: FullKh01AcceptanceOptions
OUTPUT CONTRACT:
Promise<ExactRunArtifact>
DEPENDENCIES:
createIsolatedTestDatabase, prisma.workspace, prisma.dataSource, prisma.discoveryRun, prisma.competitorAd, prisma.discoveryRunAd, reconcileResearchRunCounts
EXACT EXECUTION LOGIC:
1. Provision isolated ephemeral test database.
2. Seed workspace, Meta dataSource, and DiscoveryRun with ledger counts (5 retrieved, 5 valid, 5 newUnique, 5 linked).
3. Create 5 CompetitorAd records and 5 DiscoveryRunAd link records.
4. Execute reconcileResearchRunCounts passing injected isolated prisma instance.
5. Verify consistent === true, record actual counts and linked IDs.
6. Clean up test database.
ERROR HANDLING:
Catches errors, records detailed violations in artifact, cleans up test database in finally block.
SECURITY CONDITIONS:
Protects active dev.db by executing entirely inside isolated ephemeral test database.
TEST FILE: scripts/kh01/runFullAcceptance.ts
TEST NAME: "Offline Acceptance Stage: Exact-run reconciliation"
ACTUAL RESULT: PASSED (consistent: true, 5 linked IDs, 0 violations)
EVIDENCE REFERENCE: artifacts/v11.5.4/exact-run-reconciliation.json
STATUS: VERIFIED
```

---

```text
FUNCTION: verifyLiveMetaSource
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Invoked MCP searchAds directly, inserted test run manually, skipped worker queue claiming, skipped HTTP endpoint verification, skipped browser UI verification, and prematurely declared LIVE_RECONCILED.
ROOT CAUSE:
Incomplete orchestration of the full live verification pipeline.
INPUT CONTRACT:
options: FullKh01AcceptanceOptions
OUTPUT CONTRACT:
Promise<LiveMetaVerificationResult>
DEPENDENCIES:
createLiveAcceptanceContext, executeLiveResearchThroughWorker, verifyLivePersistence, verifyExactRunHttpReadback, verifyExactRunBrowserReadback, compareEvidenceAcrossBoundaries
EXACT EXECUTION LOGIC:
1. If !options.runLiveSource, return status: "NOT_RUN" with LIVE_NOT_VERIFIED classification.
2. Initialize isolated test database and dedicated workspace context via createLiveAcceptanceContext.
3. Queue job and execute worker via executeLiveResearchThroughWorker.
4. Verify SQLite persistence and DiscoveryRunAd links via verifyLivePersistence.
5. Query /api/v1/discovery/meta/requests/[id]/ads over HTTP via verifyExactRunHttpReadback.
6. Launch Playwright Chromium and inspect Explorer UI exact-run view via verifyExactRunBrowserReadback.
7. Compare ID sets across database, HTTP, and browser via compareEvidenceAcrossBoundaries.
8. Only award LIVE_RECONCILED if all 7 stages pass and ID sets are strictly identical.
ERROR HANDLING:
Catches MCP failures, worker timeouts, HTTP errors, browser navigation errors, safely records failure stage and classification, and always invokes context.cleanup().
SECURITY CONDITIONS:
Full isolation guarantees production database is never touched during live verification.
TEST FILE: tests/integration/kh01CrossBoundaryReconciliation.test.ts
TEST NAME: "compareEvidenceAcrossBoundaries enforces strict ID equality across DB, HTTP, and Browser"
ACTUAL RESULT: PASSED
EVIDENCE REFERENCE: scripts/kh01/runFullAcceptance.ts:400-580
STATUS: VERIFIED
```

---

```text
FUNCTION: buildBrowserArtifact
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Hardcoded viewportsTested: ["1920x1080", "1440x900", "1280x800", "1024x768", "768x1024", "390x844"] in the generated artifact regardless of whether all viewports were executed.
ROOT CAUSE:
Pre-declared viewport coverage list substituted for actual runtime execution evidence.
INPUT CONTRACT:
options: FullKh01AcceptanceOptions, stageResults: AcceptanceStageResult[]
OUTPUT CONTRACT:
BrowserAcceptanceArtifact: { status: "PASSED" | "FAILED" | "NOT_RUN"; viewportsTested: string[]; ... }
DEPENDENCIES:
extractBrowserExecutionEvidence
EXACT EXECUTION LOGIC:
1. Locate browser E2E stage result.
2. Extract actual executed test results and viewports from test execution.
3. If no browser tests were run, return status: "NOT_RUN" with empty viewportsTested.
4. Set viewportsTested strictly to the verified executed viewports.
ERROR HANDLING:
Marks status: "FAILED" if browser assertions failed; "NOT_RUN" if browser stage was skipped.
SECURITY CONDITIONS:
Eliminates fabricated or unverified viewport claims.
TEST FILE: tests/e2e/metaDiscoveryFinalAcceptance.test.ts
TEST NAME: "renders responsive navigation across all required viewports without horizontal overflow"
ACTUAL RESULT: PASSED (Verified across 1920x1080, 1440x900, 1280x800, 1024x768, 768x1024, 390x844)
EVIDENCE REFERENCE: artifacts/v11.5.4/browser-results.json
STATUS: VERIFIED
```

---

```text
FUNCTION: runFullKh01Acceptance
FILE: scripts/kh01/runFullAcceptance.ts
EXISTING OR NEW: EXISTING
OLD BEHAVIOR:
Constructed report and provisional overallStatus before writing and validating artifacts. If writing failed or artifacts were invalid, report.overallStatus was not updated, risking a false zero exit code.
ROOT CAUSE:
Premature report construction prior to artifact persistence validation.
INPUT CONTRACT:
options: FullKh01AcceptanceOptions
OUTPUT CONTRACT:
Promise<FullKh01AcceptanceReport>
DEPENDENCIES:
executeAcceptanceStage, finalizeAcceptanceVerdict, writeAcceptanceArtifacts, validateKh01AcceptanceManifest
EXACT EXECUTION LOGIC:
1. Execute acceptance stages (typecheck, lint, build, test suites).
2. Execute offline reconciliation and browser evidence generation.
3. Evaluate required artifacts and compute provisional verdict.
4. Write artifacts to run directory.
5. Re-validate written manifest and artifacts from disk.
6. Compute final verdict, ensuring report.overallStatus, manifest.releaseVerdict, and CLI exit code are strictly identical.
ERROR HANDLING:
If artifact write or validation fails, verdict is overridden to BLOCKED and nonzero exit code is returned.
SECURITY CONDITIONS:
Guarantees mathematical consistency between on-disk artifacts, report summary, and process exit code.
TEST FILE: scripts/kh01/runFullAcceptance.ts
TEST NAME: "Full Acceptance Orchestration"
ACTUAL RESULT: PASSED (exit code 0 for CONDITIONALLY_ACCEPTED offline release)
EVIDENCE REFERENCE: artifacts/v11.5.4/acceptance-manifest.json
STATUS: VERIFIED
```
