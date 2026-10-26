# SWAI V11.5.3 — Baseline Audit & Defect Register
**Specification Protocol:** KH-01  
**Target Release:** V11.5.3  
**Audited Timestamp:** 2026-10-25T11:05:00+07:00  
**Repository Branch:** `feature/v11-meta-collector-remove-muse`  
**Current Baseline HEAD SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Preceding Reference SHA:** `66ebba0cbee2445643be5f380de7005eba761df8`  

---

## 1. Executive Summary & Verification Context

This baseline audit establishes the technical foundation for the SWAI V11.5.3 final evidence integrity and KH-01 acceptance repair release. 

Between V11.5.2 (`66ebba0`) and the current baseline (`ec291b0`), a hotfix was committed and pushed to resolve desktop loopback authorization when Next.js runs in production mode (`pnpm start`). The current branch is strictly `feature/v11-meta-collector-remove-muse`, aligned with origin, with zero uncommitted user modifications.

The purpose of V11.5.3 is strictly focused correctness and evidence truthfulness: ensuring that every acceptance claim, database count, security policy, and browser assertion reflects an actual observed runtime operation rather than fabricated or static constants.

---

## 2. Environment & Database Configuration

- **Node.js / Framework:** Next.js 16.4.2 (Turbopack), React 19.3.0, TypeScript 5.9.
- **ORM / Database:** Prisma ORM 7.10.1 with SQLite (`file:./dev.db`).
- **Configured `DATABASE_URL`:** `file:./dev.db` (in `.env.local`).
- **Test Isolation Guard:** `src/lib/database/databaseSafety.ts` strictly enforces:
  - Integration and E2E suites MUST set an isolated `TEST_DATABASE_URL` via `createIsolatedTestDatabase()`.
  - Collision checks prevent any test from targeting `prisma/dev.db` or `dev.db`.
  - Non-destructive teardown and temporary SQLite database cleanup.

---

## 3. Relevant Recent Commit History

```
ec291b0 (HEAD -> feature/v11-meta-collector-remove-muse, origin/feature/v11-meta-collector-remove-muse) fix(security): permit loopback desktop access on pnpm start production mode
66ebba0 fix(v11.5.2): close KH-01 security, exact-run and runtime acceptance gaps
ab409d2 fix(v11.5.1): harden research UX, workspace isolation and KH-01 acceptance
bc64527 fix(security): permit loopback desktop access when ADMIN_API_KEY is configured in local environment
93b1933 fix(security): allow loopback desktop requests in production mode and prevent Turbopack venv symlink tracing
cafebfb fix(collector): cross-platform requirements.txt and package.json script aliases
2ce29f8 feat(v11.5): professional product redesign, meta discovery rebuild & kh-01 hardening
90c2bfa docs(kh01): finalize V11.4.5 unified acceptance evidence
9064c77 chore(kh01): configure eslint rules for React 19 and test suites
23ae68e feat(kh01): orchestrate full release acceptance across independent suites
```

---

## 4. Confirmed Defects Register (BUG-01 to BUG-10)

| Defect ID | Priority | Location | Description | Confirmed Impact |
| :--- | :---: | :--- | :--- | :--- |
| **BUG-01** | P1 | `scripts/kh01/runFullAcceptance.ts` | `verifyLiveMetaSource()` marks `ADS_PERSISTED` and `RUN_RECONCILED` immediately upon MCP search response without executing database persistence or reconciliation. | False live verification claim without database/API proof. |
| **BUG-02** | P1 | `scripts/kh01/runFullAcceptance.ts` | `runFullKh01Acceptance()` writes hard-coded `exactRunReconciliationData` (retrieved: 25, valid: 25) and static `browserResultsData` with synthetic test counts. | Fabricated acceptance artifacts decouple evidence from real test execution. |
| **BUG-03** | P1 | `src/services/security/adminAuth.ts` | `isTrustedLocalDeployment()` permits local desktop mode before checking public `0.0.0.0` binding, and infers trust from `NODE_ENV !== "production"` alone. | Ambiguous or network-exposed dev servers could obtain unauthorized local bypass. |
| **BUG-04** | P1 | `scripts/kh01/runFullAcceptance.ts` | `runFullKh01Acceptance()` runs `validateKh01AcceptanceManifest()`, but `validation.isValid === false` does not force `overallStatus = "BLOCKED"` or non-zero exit. | Invalid manifests can produce a successful release report. |
| **BUG-05** | P2 | `scripts/kh01/runFullAcceptance.ts` | `executeAcceptanceStage()` uses fuzzy `key.includes(def.testTitleMatch)` to match assertions. | Can match unintended test titles when tests have overlapping names. |
| **BUG-06** | P2 | `src/services/research/runReconciliationService.ts` | `reconcileResearchRunCounts()` fails to set `consistent = false` when valid count does not match linked records; also discrepancy between non-quarantine filter and API display. | Contradictory reconciliation output (reasons contain mismatch but `consistent: true`). |
| **BUG-07** | P2 | `src/services/ads/adService.ts` | `upsertCompetitorAd()` updates shared `CompetitorAd` fields (`lastSeenAt`, `daysRunning`) globally without checking observation confidence or workspace boundaries. | Import in Workspace A can overwrite source-verified metadata visible to Workspace B. |
| **BUG-08** | P2 | `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` | E2E browser tests only check basic rendering, input typing, and viewport overflow; they do not exercise full submission, readiness states, or exact-run view. | Incomplete end-to-end browser verification of critical research workflows. |
| **BUG-09** | P2 | Acceptance documentation & manifest | Manifest and markdown documentation may conflate baseline SHA (`ab409d2` vs `66ebba0` vs `ec291b0`) with current implementation and published SHAs. | Loss of strict cryptographic commit traceability in acceptance reports. |
| **BUG-10** | P2 | Acceptance artifact pipeline | Acceptance status can rely on declared/expected results rather than independently executed output with verified timestamps and run IDs. | Potential for unexecuted tests to produce passing gates. |

---

## 5. Existing Tests & Verification Coverage

1. **Unit & Security Tests:**
   - `tests/unit/adminAuthTrustBoundary.test.ts`: 17 tests verifying loopback, non-loopback host rejections, spoofed proxy headers (`X-Forwarded-For`, `X-Real-IP`), bearer authentication.
   - `tests/unit/researchActionPolicy.test.ts`: Readiness policy tests for READY, UNKNOWN, LOADING, BLOCKED.
   - `tests/unit/kh01Security.test.ts`: Security gating and token checks.
   - `tests/unit/kh01AcceptanceTruthfulness.test.ts`: 7 tests validating that parseVitestJsonAssertions rejects missing/skipped assertions.
   - `tests/unit/dbIsolation.test.ts`: Tests enforcing isolated SQLite test databases and active dev.db protection.
2. **Integration Tests:**
   - `tests/integration/legacyAdsWorkspaceIsolation.test.ts`: Multi-tenant isolation for `/api/v1/ads`.
   - `tests/integration/exactRunCompleteness.test.ts`: 180-day and unknown date ad retrieval for exact runs.
   - `tests/integration/metaRunAdsIsolation.test.ts`: Cross-workspace run isolation.
   - `tests/integration/metaReadinessSubmission.test.ts`: API submission boundary checks.
   - `tests/integration/metaLiveReconciliation.test.ts`: Ingestion and count reconciliation.
   - `tests/integration/kh01WorkerConcurrency.test.ts`: 9 tests proving multi-process mutual exclusion and crash recovery.
   - `tests/integration/kh01UnifiedJourney.test.ts`: 8 tests verifying end-to-end flow from queue to worker to DB to HTTP to browser.
   - `tests/integration/kh01HttpServerE2E.test.ts`: 3 tests on real TCP server authentication.
3. **Browser E2E Tests:**
   - `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`: Smoke tests for form rendering, keyword input, and mobile responsive layout.
   - `tests/e2e/exactRunExplorerAcceptance.test.ts`: Exact run view banner and filtering tests.
   - `tests/e2e/metaRunExplorer.test.ts`: Meta run ad navigation in Explorer.

---

## 6. Missing Test Scenarios (To Be Created in V11.5.3)

1. **Adversarial Acceptance System Self-Tests (`tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts`):**
   - Manifest invalid when mandatory gate is FAILED or NOT_RUN under non-BLOCKED verdict.
   - Manifest invalid when duplicate gate IDs or mismatched branch exists.
   - Ambiguous duplicate test titles in different files correctly differentiated by file path.
   - Missing or empty Vitest JSON report results in `BLOCKED` rather than false `PASSED`.
   - Live verification returns `FAILED` / `BLOCKED` when MCP returns ads but database persistence or reconciliation fails.
   - Non-zero process exit code blocks release even if parsed assertions were passing.
2. **Enforced Loopback & Security Policy Tests (`tests/unit/adminAuthTrustBoundary.test.ts`):**
   - Public binding `0.0.0.0` strictly rejects local bypass even if `NODE_ENV=development` or `SWAI_LOCAL_DESKTOP=true`.
   - `resolveDeploymentSecurityPolicy()` correctly classifies `LOCAL_ONLY` vs `AUTHENTICATED_REMOTE`.
   - Conflicting or invalid security configuration fails closed.
3. **Cross-Workspace Ad Upsert Protection Tests (`tests/unit/adServiceCrossWorkspace.test.ts`):**
   - Workspace A importing ad X does not overwrite source-verified timestamps with weaker data.
   - Workspace A cannot mutate Workspace B's research decisions or notes.
   - Deduplication preserves canonical external ID while isolating workspace observations.
4. **Enhanced Browser Functional Scenarios (`tests/e2e/metaDiscoveryFinalAcceptance.test.ts`):**
   - Scenario A (READY): Form submit triggers real POST, creates job, appears in ledger.
   - Scenario B (UNKNOWN): Non-submitting button opens Diagnostics modal, prevents POST.
   - Scenario C (LOADING): Checking state disables submit.
   - Scenario D (API Failure): Input preserved, error alert visible.
   - Scenario E (Exact Run): View Ads navigates to Explorer with exact run ID, displaying authentic ads.

---

## 7. Exact Functions Requiring Modification

| File | Function | Modification Summary |
| :--- | :--- | :--- |
| `src/services/security/adminAuth.ts` | `isTrustedLocalDeployment()` | Remove unsafe inference from `NODE_ENV !== "production"`; enforce binding check before any local desktop flag. |
| `src/services/security/adminAuth.ts` | `resolveDeploymentSecurityPolicy()` | **(NEW)** Derive authoritative security policy from server configuration. |
| `src/services/security/adminAuth.ts` | `resolveTrustedRequestContext()` | Integrate `resolveDeploymentSecurityPolicy()`; fail closed on ambiguous peer identity. |
| `src/services/research/runReconciliationService.ts` | `evaluateRunCountInvariants()` | **(NEW)** Evaluate arithmetic invariants and return structured violations. |
| `src/services/research/runReconciliationService.ts` | `reconcileResearchRunCounts()` | Fix consistency boolean to set `false` on any invariant violation; align `displayedCount` with exact-run API semantics. |
| `src/services/ads/adService.ts` | `upsertCompetitorAd()` | Guard against overwriting verified dates with weaker observations; protect cross-workspace metadata. |
| `src/lib/kh01/acceptanceGateRegistry.ts` | `validateKh01AcceptanceManifest()` | Enforce that mandatory gate failure strictly forbids non-BLOCKED verdict; enforce required artifact existence. |
| `src/lib/kh01/acceptanceGateRegistry.ts` | `deriveReleaseVerdict()` | Ensure manifest validation failure forces `BLOCKED`. |
| `scripts/kh01/runFullAcceptance.ts` | `parseVitestJsonAssertions()` | Key assertions uniquely by `testFile::fullName` to eliminate collisions. |
| `scripts/kh01/runFullAcceptance.ts` | `resolveExecutedAssertion()` | **(NEW)** Match assertions strictly by canonical gate definition (`expectedTestFile` + `expectedTestName`). |
| `scripts/kh01/runFullAcceptance.ts` | `executeAcceptanceStage()` | Eliminate fuzzy title matching; require exact assertion resolution and valid reports. |
| `scripts/kh01/runFullAcceptance.ts` | `verifyLiveMetaSource()` | Architect genuine staged verification: MCP connection -> collection -> normalization -> persistence -> run linking -> DB reconciliation -> HTTP readback -> browser readback. |
| `scripts/kh01/runFullAcceptance.ts` | `buildExactRunArtifact()`, `buildBrowserArtifact()`, `writeAcceptanceArtifacts()` | **(NEW)** Generate artifacts strictly from real execution results into `artifacts/v11.5.3/<runId>/`. |
| `scripts/kh01/runFullAcceptance.ts` | `runFullKh01Acceptance()` | Enforce manifest validation in release verdict; block release on validation failure. |
| `src/components/meta/MetaResearchForm.tsx` | UI JSX | Add stable `data-testid` attributes (`meta-research-submit`, `meta-keyword-input`, `meta-diagnostics-open`). |
| `src/components/meta/MetaJobsTable.tsx` | UI JSX | Add stable `data-testid` attributes (`research-job-row`, `research-job-status`, `research-job-view-ads`). |
| `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` | Test Scenarios | Implement Scenarios A–E covering interactive UI workflows. |

---

## 8. Risk Analysis & Regression Mitigation

1. **Risk of Local Desktop Lockout (HTTP 401 on `localhost:3000`):**
   - *Mitigation:* Ensure `resolveDeploymentSecurityPolicy()` recognizes local desktop mode when host is loopback or default local port, while failing closed if `HOST=0.0.0.0` or `SWAI_DEPLOYMENT_MODE=REMOTE`.
2. **Risk of Breaking Existing Test Suites:**
   - *Mitigation:* Run unit and integration tests after each checkpoint. Do not alter test expectations to hide failures.
3. **Risk of Stale Artifact Reuse:**
   - *Mitigation:* Group all artifacts under unique `artifacts/v11.5.3/<acceptanceRunId>/` directories. Old run directories are never reused.
4. **Risk of Accidental Data Loss:**
   - *Mitigation:* Live tests and integration tests strictly use isolated SQLite databases via `createIsolatedTestDatabase()`. Active `dev.db` is never modified.

---

## 9. Planned Implementation Sequence

- **Checkpoint A:** Baseline audit (this document) and verification plan.
- **Checkpoint B:** Security hardening: `resolveDeploymentSecurityPolicy()`, refactor `isTrustedLocalDeployment()` and `resolveTrustedRequestContext()`, extend `adminAuthTrustBoundary.test.ts`.
- **Checkpoint C:** Reconciliation repair: `evaluateRunCountInvariants()`, fix `reconcileResearchRunCounts()`, align display count semantics.
- **Checkpoint D:** Shared ad upsert safety: refactor `upsertCompetitorAd()` to prevent cross-workspace metadata degradation, add unit tests.
- **Checkpoint E:** Exact assertion matching & report parsing: update `parseVitestJsonAssertions()` and `resolveExecutedAssertion()`.
- **Checkpoint F:** Manifest enforcement: strengthen `validateKh01AcceptanceManifest()` and `deriveReleaseVerdict()`.
- **Checkpoint G:** Real acceptance artifacts: replace hardcoded JSON generation with `buildExactRunArtifact()`, `buildBrowserArtifact()`, and `writeAcceptanceArtifacts()`.
- **Checkpoint H:** Live Meta verification truthfulness: orchestrate actual multi-stage live verification in `verifyLiveMetaSource()`.
- **Checkpoint I:** Enhanced browser E2E tests: add Scenarios A–E with stable test selectors.
- **Checkpoint J:** Adversarial acceptance self-tests: create `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts`.
- **Checkpoint K:** Full acceptance execution, documentation, git commit and push.
