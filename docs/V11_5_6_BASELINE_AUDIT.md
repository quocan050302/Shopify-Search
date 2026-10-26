# SWAI V11.5.6 — BASELINE & PRE-REPAIR AUDIT
## KH-01 Engineering Verification Baseline Audit

**Repository:** `quocan050302/Shopify-Search`  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Audited Starting Commit SHA:** `0561f0dd3ea77f4f9e9a20804fdd70b6115664e2`  
**Parent Implementation SHA:** `52c1cd0a77ec31e44240629c09278c0309672cd6`  
**Audit Timestamp:** 2026-10-25T13:20:00+07:00  
**Target Market:** United States (US) | **Operating Mode:** `RESEARCH_ONLY`  

---

## 1. REPOSITORY & ENVIRONMENT STATE

- **Active Branch:** `feature/v11-meta-collector-remove-muse`
- **Working Tree:** Clean (all prior changes committed and pushed to origin)
- **Local Application Database Configuration:** Default `prisma/test_template.db` template used for ephemeral isolated databases; active application DB protected.
- **Node.js Environment:** v22.22.3 (macOS Darwin)
- **Framework:** Next.js 16.4.2 (Turbopack) with React 19.3.0

---

## 2. THE SIX CONFIRMED DEFECTS & ROOT CAUSES

| Defect ID | Priority | Target Function | File Path | Confirmed Defect & Root Cause |
|---|---|---|---|---|
| **FINAL-FIX-01** | P1 | `executeLiveResearchThroughWorker()` | `scripts/kh01/runFullAcceptance.ts` | The acceptance runner directly called `discoveryOrchestrator.claimPendingDiscoveryJob()` and `discoveryOrchestrator.executeDiscoveryJob()` within its own process rather than spawning the real production background Worker subprocess (`scripts/discovery-worker.ts`). A mock `workerId` string was generated in-memory. |
| **FINAL-FIX-02** | P1 | `buildBrowserArtifact()` | `scripts/kh01/runFullAcceptance.ts` | `executedViewports` was populated by pushing a pre-declared array `["1920x1080", "1440x900", ...]` if the stage passed, rather than consuming actual per-viewport execution evidence records from Playwright test execution. |
| **FINAL-FIX-03** | P1 | `writeAcceptanceArtifacts()` | `scripts/kh01/runFullAcceptance.ts` | Directly wrote artifacts into `artifacts/v11.5.5` and `artifacts/v11.5.5/latest` concurrently in a single loop before reading back or validating subsequent files. A partial write or corrupt artifact could leave a corrupted `latest` directory. |
| **FINAL-FIX-04** | P1 | `resolveDeploymentSecurityPolicy()` | `src/services/security/adminAuth.ts` | An empty or unspecified `HOST` environment variable fell through to `LOCAL_ONLY` with `localBypassAllowed: true` when strict auth was not explicitly set. `validateServerBindingPolicy` treated `SWAI_LOCAL_DESKTOP=true` as sufficient to assume loopback on unspecified listeners. |
| **FINAL-FIX-05** | P2/P1 | `parseVitestJsonAssertions()` & `resolveExecutedAssertion()` | `scripts/kh01/runFullAcceptance.ts` | `parseVitestJsonAssertions()` silently overwrote duplicate canonical keys without raising errors. `resolveExecutedAssertion()` maintained a basename fallback (`key.endsWith('::' + expectedName) && key.includes(baseName)`), which permitted cross-directory assertion collisions. |
| **FINAL-FIX-06** | P1 | `runFullKh01Acceptance()` | `scripts/kh01/runFullAcceptance.ts` | The acceptance runner lacked execution of dedicated Worker subprocess tests, hard-coded `activeAppDbProtected: true` in DB isolation evidence without an active read/write probe, assigned `unresolvedDefects: []` without review, and updated artifacts without two-phase publication. |

---

## 3. EXISTING CODEBASE BASELINE INSPECTION

### 3.1 Worker Execution (`scripts/discovery-worker.ts` & `src/workers/discoveryWorker.ts`)
- `scripts/discovery-worker.ts` initializes the environment and calls `startDiscoveryWorker(30000)`.
- `startDiscoveryWorker` immediately invokes `processDueSchedulesOnce()`, which calls `persistWorkerHeartbeat("RUNNING")`, claims pending discovery jobs via `discoveryOrchestrator.claimPendingDiscoveryJob()`, executes them via `discoveryOrchestrator.executeDiscoveryJob()`, and updates run status in the connected database.
- Missing: An isolated acceptance subprocess manager `startIsolatedAcceptanceWorker(context)` that spawns `scripts/discovery-worker.ts` with explicit `TEST_DATABASE_URL` and `DATABASE_URL` environment variables, captures child PID, streams sanitized logs, and coordinates bounded polling on the target run claim and completion.

### 3.2 Browser Viewport Evidence (`tests/e2e/metaDiscoveryFinalAcceptance.test.ts`)
- The suite contains 5 tests, including responsive layout across 6 viewports (`1920x1080`, `1440x900`, `1280x800`, `1024x768`, `768x1024`, `390x844`).
- Missing: Structured evidence emission via `KH01_BROWSER_EVIDENCE_PATH` where the test writes a `browser-viewport-results.json` artifact detailing every executed viewport's status, dimensions, URL, horizontal overflow, and screenshot reference.

### 3.3 Artifact Publication (`scripts/kh01/runFullAcceptance.ts`)
- Artifacts are currently written directly to run-specific and base directories.
- Missing: Two-phase atomic publication (`.staging-<acceptanceRunId>` -> disk validation -> atomic rename to `artifacts/v11.5.6/<acceptanceRunId>` -> atomic `latest.json` pointer update).

### 3.4 Security Boundaries (`src/services/security/adminAuth.ts`)
- Missing: Enforcing `AUTHENTICATED_REMOTE` when `HOST` is empty/unspecified, preventing `SWAI_LOCAL_DESKTOP=true` from converting an unspecified listener to loopback without verified binding, and preserving legitimate Mac loopback desktop workflows via `dev:local` / `start:local`.

### 3.5 Assertion Identity Matching (`scripts/kh01/runFullAcceptance.ts`)
- Missing: Rejection of duplicate canonical keys in `parseVitestJsonAssertions()`, removal of the basename fallback in `resolveExecutedAssertion()`, and strict `tests/...::fullName` repository-relative matching.

---

## 4. REGRESSION RISKS & MITIGATION PLAN

1. **Child Process Cleanup:**
   - *Risk:* Spawning `scripts/discovery-worker.ts` might leave orphaned worker processes if tests time out.
   - *Mitigation:* `startIsolatedAcceptanceWorker` must attach `process.on('exit')` hooks and enforce graceful termination (`SIGTERM` -> bounded wait -> `SIGKILL`) in a `finally` block.
2. **Local Desktop DX Preservation:**
   - *Risk:* Tightening security on unspecified `HOST` could break the user's local `npm run dev:local` or `npm start` workflow.
   - *Mitigation:* Ensure `dev:local` and `start:local` pass `-H 127.0.0.1`, which sets verified loopback and allows local bypass when `SWAI_REQUIRE_AUTH` is not set.
3. **Database Concurrency in Worker Tests:**
   - *Risk:* Independent worker process sharing SQLite file could encounter `SQLITE_BUSY` or claim unrelated runs.
   - *Mitigation:* Use dedicated ephemeral SQLite test database per acceptance context, prune pre-existing runs in template, and verify run ID correlation.
