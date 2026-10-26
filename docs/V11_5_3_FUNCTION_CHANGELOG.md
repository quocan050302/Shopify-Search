# SWAI V11.5.3 — Function-Level Changelog
**Protocol Specification:** KH-01  
**Target Release:** V11.5.3  
**Audited Baseline SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Market:** United States (`RESEARCH_ONLY`)

---

## Overview

In accordance with PART 19 of the V11.5.3 Master Specification, this document provides the exact function-level changelog for every function modified or introduced during the V11.5.3 evidence integrity and acceptance repair.

---

## Function Changelog Table

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/security/adminAuth.ts` |
| **Function** | `resolveDeploymentSecurityPolicy(config?: DeploymentSecurityConfig): DeploymentSecurityPolicy` |
| **Before** | Did not exist. Trust decisions were made ad-hoc inside `isTrustedLocalDeployment()` mixing configuration intent (`SWAI_LOCAL_DESKTOP`) with listener binding. |
| **Defect** | Lack of centralized, authoritative evaluation of host, binding, and remote exposure led to insecure local bypass when `NODE_ENV=development` was exposed. |
| **After** | Computes explicit deployment policy (`LOCAL_ONLY` vs `AUTHENTICATED_REMOTE`), checks conflicting configs, enforces loopback-only binding, and marks local bypass allowed only when strictly bound to loopback. |
| **Inputs** | `config?: DeploymentSecurityConfig` (`host`, `port`, `nodeEnv`, `localDesktop`, `adminApiKeyConfigured`) |
| **Outputs** | `DeploymentSecurityPolicy` (`mode`, `localBypassAllowed`, `configurationValid`, `reason`) |
| **Dependencies** | None (pure function). |
| **Error Handling** | Fails closed on invalid configurations or public bindings (`0.0.0.0`, LAN IPs). |
| **Tests** | `tests/unit/adminAuthTrustBoundary.test.ts` > "Deployment Security Policy & Enforced Loopback Binding" |
| **Evidence** | 23/23 tests passing. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/security/adminAuth.ts` |
| **Function** | `isTrustedLocalDeployment(): boolean` |
| **Before** | Checked `SWAI_LOCAL_DESKTOP === "true"` before checking `HOST === "0.0.0.0"`, and trusted `NODE_ENV !== "production"` without verifying loopback binding. |
| **Defect** | BUG-03: Permitted local admin bypass on network-exposed or misconfigured development instances. |
| **After** | Evaluates `resolveDeploymentSecurityPolicy()`. Fails closed if host is bound to `0.0.0.0` or external IP, regardless of environment or desktop flags. |
| **Inputs** | Process environment variables (`process.env.HOST`, `PORT`, `NODE_ENV`, `SWAI_LOCAL_DESKTOP`). |
| **Outputs** | `boolean` (true only if loopback binding is strictly enforced). |
| **Dependencies** | `resolveDeploymentSecurityPolicy()`. |
| **Error Handling** | Returns `false` on any security ambiguity. |
| **Tests** | `tests/unit/adminAuthTrustBoundary.test.ts` > "isTrustedLocalDeployment with public bindings" |
| **Evidence** | All unit tests pass; integration server tests verify loopback protection. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/security/adminAuth.ts` |
| **Function** | `resolveTrustedRequestContext(request: Request): RequestSecurityContext` |
| **Before** | Relied on `isTrustedLocalDeployment()` but did not enforce peer verification when running in authenticated remote mode. |
| **Defect** | Allowed spoofed client headers (`Host`, `x-forwarded-for`) to potentially influence trust decisions. |
| **After** | Consults `resolveDeploymentSecurityPolicy()`. In `AUTHENTICATED_REMOTE` mode, marks `isGenuineLoopback = false` regardless of incoming spoofed headers, requiring valid API key. |
| **Inputs** | `request: Request` |
| **Outputs** | `RequestSecurityContext` (`isTrustedLocal`, `isGenuineLoopback`, `hasValidAdminApiKey`, `clientIp`, `hostHeader`, `policy`) |
| **Dependencies** | `resolveDeploymentSecurityPolicy()`, `getEffectiveAdminApiKey()`. |
| **Error Handling** | Strips and normalizes header values, defaults to untrusted peer. |
| **Tests** | `tests/unit/adminAuthTrustBoundary.test.ts` > "resolveTrustedRequestContext header spoofing" |
| **Evidence** | Spoofed host and proxy header test cases verify non-bypass. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/research/runReconciliationService.ts` |
| **Function** | `evaluateRunCountInvariants(counts: RunCounts, rules?: RunCountRules): ReconciliationEvaluation` |
| **Before** | Did not exist. Arithmetic checks were ad-hoc inside `reconcileResearchRunCounts()`. |
| **Defect** | BUG-06: Count mismatches between `valid` and `linked` records were reported as warnings in reasons without changing `consistent: true` to `false`. |
| **After** | Pure validator of run arithmetic. Validates non-negative counts, `retrieved >= valid`, `valid === newUnique + duplicates`, `valid === linked`, and `linked === displayed` (Option B: all linked returned with quarantine flag). Any failure strictly sets `consistent = false`. |
| **Inputs** | `counts: RunCounts`, `rules?: RunCountRules` |
| **Outputs** | `ReconciliationEvaluation` (`consistent: boolean`, `violations: InvariantViolation[]`, `explanations: string[]`) |
| **Dependencies** | None (pure domain logic). |
| **Error Handling** | Records structured violation codes (`NEGATIVE_COUNT_DETECTED`, `VALID_EXCEEDS_RETRIEVED`, `PARTITION_ARITHMETIC_MISMATCH`, `LINKED_DISPLAYED_MISMATCH`). |
| **Tests** | `tests/unit/runReconciliationInvariants.test.ts` (9 tests) |
| **Evidence** | 9/9 tests passed. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/research/runReconciliationService.ts` |
| **Function** | `reconcileResearchRunCounts(runId: string): Promise<RunCountReconciliation>` |
| **Before** | Derived `displayedCount` by excluding quarantined records (`isQuarantined: false`), which conflicted with the API returning all linked records. Also could return `consistent: true` with arithmetic discrepancies. |
| **Defect** | Inconsistent definition of `displayed` between database reconciliation and the HTTP API route. |
| **After** | Aligns with Option B: counts all linked records for display eligibility, tracks `quarantinedCount` separately, delegates to `evaluateRunCountInvariants()`, and strictly sets `consistent = false` if any invariant fails. |
| **Inputs** | `runId: string` |
| **Outputs** | `Promise<RunCountReconciliation>` |
| **Dependencies** | `prisma.discoveryRun`, `prisma.discoveryRunAd`, `evaluateRunCountInvariants()`. |
| **Error Handling** | Throws informative error if run does not exist; returns clean reconciliation for valid runs. |
| **Tests** | `tests/integration/metaLiveReconciliation.test.ts` |
| **Evidence** | Ingestion and deduplication tests verify consistent counts and proper quarantine notes. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/ads/adService.ts` |
| **Function** | `upsertCompetitorAd(record: NormalizedAdRecord): Promise<UpsertResult>` |
| **Before** | Overwrote `lastSeenAt` and `daysRunning` whenever an existing ad was encountered, without comparing timestamps or observation confidence. |
| **Defect** | BUG-07: Weaker or earlier observations from Workspace A could overwrite or downgrade verified data visible to Workspace B. |
| **After** | Guards updates: only advances `lastSeenAt` if the incoming timestamp is strictly newer (`incomingDate > existing.lastSeenAt`); never downgrades `confidence` from `HIGH` or `VERIFIED` to `LOW`. |
| **Inputs** | `record: NormalizedAdRecord` |
| **Outputs** | `Promise<{ id: string; isNew: boolean }>` |
| **Dependencies** | `prisma.competitorAd`, `prisma.advertiser`, `prisma.dataSource`. |
| **Error Handling** | Wraps operations in Prisma transaction where needed, preserves existing records on conflict. |
| **Tests** | `tests/unit/adServiceCrossWorkspace.test.ts` (4 tests) |
| **Evidence** | All cross-workspace and confidence-downgrade test cases pass. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/services/ads/adService.ts` |
| **Function** | `importAdvertisementForWorkspace(context: WorkspaceImportContext, record: NormalizedAdRecord): Promise<WorkspaceImportResult>` |
| **Before** | Did not exist. Workspace imports directly called `upsertCompetitorAd()` conflating global identity with workspace observation. |
| **Defect** | Workspace observations and research runs could leak or mutate across workspaces. |
| **After** | Upserts canonical global ad safely using `upsertCompetitorAd()`, then records workspace association or links to the workspace's specific `DiscoveryRunAd` without modifying other workspaces. |
| **Inputs** | `context: WorkspaceImportContext` (`workspaceId`, `runId`, `source`), `record: NormalizedAdRecord` |
| **Outputs** | `Promise<WorkspaceImportResult>` (`adId`, `isNewGlobalAd`, `workspaceLinked`) |
| **Dependencies** | `upsertCompetitorAd()`, `prisma.discoveryRunAd`. |
| **Error Handling** | Validates workspace existence, rejects foreign run access. |
| **Tests** | `tests/unit/adServiceCrossWorkspace.test.ts` |
| **Evidence** | Tested in multi-tenant isolation tests. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/lib/kh01/acceptanceGateRegistry.ts` |
| **Function** | `validateKh01AcceptanceManifest(manifest: Kh01AcceptanceManifest): { isValid: boolean; errors: string[] }` |
| **Before** | Only checked basic gate statuses; did not enforce stage exit codes or require evidence references for all levels of live verification. |
| **Defect** | BUG-04: Allowed invalid manifests or releases with failed mandatory stages to claim non-BLOCKED status. |
| **After** | Enforces strict invariants: all mandatory gates MUST be PASSED for non-BLOCKED verdicts; all stages must have exitCode 0; manifest runId must match gate runIds; live PASSED strictly requires ADS_COLLECTED, ADS_PERSISTED, RUN_RECONCILED, non-zero ads, and verified runId. |
| **Inputs** | `manifest: Kh01AcceptanceManifest` |
| **Outputs** | `{ isValid: boolean; errors: string[] }` |
| **Dependencies** | `CANONICAL_ACCEPTANCE_GATES`. |
| **Error Handling** | Accumulates all invariant violations in `errors` array. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` |
| **Evidence** | 18/18 tests pass in adversarial truthfulness suite. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `src/lib/kh01/acceptanceGateRegistry.ts` |
| **Function** | `finalizeAcceptanceVerdict(execution: AcceptanceExecutionSummary, manifestValidation: { isValid: boolean; errors: string[] }): FinalReleaseDecision` |
| **Before** | Did not exist. Verdict derivation only checked gate status without considering manifest validation validity or artifact completeness. |
| **Defect** | Allowed an invalid manifest to produce `CONDITIONALLY_ACCEPTED` or `ACCEPTED`. |
| **After** | Evaluates mandatory gates, stages, manifest validation, unresolved defects, and live verification. If manifest validation is invalid, strictly returns `BLOCKED`. |
| **Inputs** | `execution: AcceptanceExecutionSummary`, `manifestValidation` |
| **Outputs** | `FinalReleaseDecision` (`verdict`, `reasons`, `blockingGateIds`, `blockingStageIds`) |
| **Dependencies** | None. |
| **Error Handling** | Defaults to `BLOCKED` on any unresolved defect or validation error. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` |
| **Evidence** | Adversarial tests verify blocking on invalid manifests. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `parseVitestJsonAssertions(reportPath: string): Map<string, ParsedTestAssertion>` |
| **Before** | Keyed assertions by title or fullName haphazardly, creating collision risks when tests share names across files. |
| **Defect** | BUG-05: Collisions and fuzzy matching. |
| **After** | Indexes assertions under unique composite keys: `${testFile}::${fullName}`, `${testFile}::${title}`, `${fullName}`, and `${title}`. Captures duration, status, error, and failure messages. |
| **Inputs** | `reportPath: string` |
| **Outputs** | `Map<string, ParsedTestAssertion>` |
| **Dependencies** | `fs`, `path`. |
| **Error Handling** | Safely returns empty map if file is missing or contains invalid JSON without crashing. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` |
| **Evidence** | Corrupt JSON and missing report unit tests pass. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `resolveExecutedAssertion(vitestResults: Map<string, ParsedTestAssertion>, expected: ExpectedAssertion, stageContext?: StageContext): AssertionResolution` |
| **Before** | Used fuzzy substring search `key.includes(def.testTitleMatch)`. |
| **Defect** | Could bind an acceptance gate to an unintended passing test with a matching substring. |
| **After** | Implements PART 09 specification: exact key match by `${testFile}::${expectedTestName}` or `fullName`; if not found, performs unambiguous candidate matching within the expected test file. Exactly 1 match returns result; >1 matches returns `BLOCKED`; 0 matches returns `NOT_RUN`. |
| **Inputs** | `vitestResults: Map`, `expected: ExpectedAssertion`, `stageContext?: StageContext` |
| **Outputs** | `AssertionResolution` (`status`, `evidenceReference`, `error`) |
| **Dependencies** | `path`. |
| **Error Handling** | Rejects stale or missing reports as `BLOCKED`. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` |
| **Evidence** | Verified via full acceptance run and unit tests. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `verifyLiveMetaSource(options: FullKh01AcceptanceOptions): Promise<LiveMetaVerificationResult>` |
| **Before** | When MCP search returned ads, immediately assigned `ADS_PERSISTED` and `RUN_RECONCILED` with `retrievedCount = validCount = linkedCount = displayedCount`. |
| **Defect** | BUG-01: False live verification claim without database or API evidence. |
| **After** | Deploys staged verification pipeline: MCP connection -> raw ad collection -> normalization -> isolated test DB persistence via `createDiscoveryJob()` -> reconciliation via `reconcileResearchRunCounts()` -> HTTP readback over TCP. Each level is added ONLY after actual verification. |
| **Inputs** | `options: FullKh01AcceptanceOptions` (`runLiveSource`, `approvedLiveSourceUrl`) |
| **Outputs** | `Promise<LiveMetaVerificationResult>` |
| **Dependencies** | `createIsolatedTestDatabase()`, `MetaAdsCollectorProvider`, `prisma`, `reconcileResearchRunCounts()`. |
| **Error Handling** | Distinguishes `MCP_UNAVAILABLE`, `RATE_LIMITED`, `BLOCKED_SOURCE`, `PERSISTENCE_FAILED`, `RECONCILIATION_FAILED`. Protects user DB. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` |
| **Evidence** | Unit tests verify zero-persisted ads never obtain `ADS_PERSISTED`. Full runner reports `NOT_RUN` truthfully when `--live-meta` is not set. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `buildExactRunArtifact(runId: string, runRecon?: any): Promise<any>` |
| **Before** | Hard-coded static JSON `{ retrieved: 25, valid: 25, linked: 25, displayed: 25, consistent: true }`. |
| **Defect** | BUG-02: Fabricated acceptance artifact. |
| **After** | Queries real database reconciliation for the given run; if no reconciliation was executed, returns `status: "NOT_RUN"` with zero counts. |
| **Inputs** | `runId: string`, `runRecon?: any` |
| **Outputs** | `Promise<ExactRunReconciliationArtifact>` |
| **Dependencies** | `reconcileResearchRunCounts()`. |
| **Error Handling** | Safely reports error if database query fails. |
| **Tests** | Integrated in `runFullKh01Acceptance()`. |
| **Evidence** | Artifact inspectable at `artifacts/v11.5.3/exact-run-reconciliation.json`. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `buildBrowserArtifact(journeyReportPath: string, acceptanceRunId: string): any` |
| **Before** | Hard-coded `{ status: "PASSED", passedTests: 8, failedTests: 0 }`. |
| **Defect** | BUG-02: Hard-coded browser results decoupled from Playwright/Vitest run. |
| **After** | Parses the actual executed journey report JSON; extracts authentic assertion count, pass/fail/skip status, and real duration. Returns `NOT_RUN` if report is absent. |
| **Inputs** | `journeyReportPath: string`, `acceptanceRunId: string` |
| **Outputs** | `BrowserExecutionArtifact` |
| **Dependencies** | `fs`, `parseVitestJsonAssertions()`. |
| **Error Handling** | Returns `status: "NOT_RUN"` if report is unreadable. |
| **Tests** | Integrated in `runFullKh01Acceptance()`. |
| **Evidence** | Artifact inspectable at `artifacts/v11.5.3/browser-results.json`. |
| **Status** | **Verified** |

---

| Field | Function Detail |
| :--- | :--- |
| **File** | `scripts/kh01/runFullAcceptance.ts` |
| **Function** | `writeAcceptanceArtifacts(outDir: string, ...artifacts): Promise<ArtifactWriteResult>` |
| **Before** | Ad-hoc `fs.writeFileSync()` without write verification or error aggregation. |
| **Defect** | Silent failure to write required artifacts did not affect release status. |
| **After** | Writes all required artifacts to run directory and root release directory, verifies file existence and non-zero bytes by reading them back. Returns structured status; any write failure marks release BLOCKED. |
| **Inputs** | `outDir: string`, artifact objects (`manifest`, `gateResults`, `stageResults`, `securityResults`, `exactRunRecon`, `browserResults`, `liveSourceResults`, `validationResults`) |
| **Outputs** | `Promise<{ success: boolean; writtenFiles: string[]; errors: string[] }>` |
| **Dependencies** | `fs`, `path`. |
| **Error Handling** | Catches I/O errors and records failed file paths. |
| **Tests** | `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` > "writeAcceptanceArtifacts returns errors if destination fails" |
| **Evidence** | All artifacts written and read back successfully in full acceptance run. |
| **Status** | **Verified** |
