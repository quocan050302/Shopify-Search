# SWAI V11.5.7 — BASELINE & PRE-REPAIR AUDIT
## KH-01 Final Evidence Integrity Verification Audit

**Repository:** `quocan050302/Shopify-Search`  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Audited Starting Commit SHA:** `218c0cf266cff0819a1f8a21c1cd4b08b1dbd39d`  
**Previous Implementation SHA:** `c1c89f55d580543cb112ba02f90a0b936e6f2602`  
**Audit Timestamp:** 2026-10-25T14:18:00+07:00  
**Target Market:** United States (US) | **Operating Mode:** `RESEARCH_ONLY`  

---

## 1. REPOSITORY & ENVIRONMENT STATE

- **Active Branch:** `feature/v11-meta-collector-remove-muse` (Matches required branch strictly)
- **Working Tree:** Clean (verified via `git status --short`)
- **Last Audited Head:** `218c0cf266cff0819a1f8a21c1cd4b08b1dbd39d` (Commit 2: docs of V11.5.6)
- **Node.js Environment:** v22.22.3 (macOS Darwin arm64)
- **Framework & Database:** Next.js 16.4.2 (Turbopack) with React 19.3.0, Prisma with libSQL SQLite adapter.
- **Active Application Database:** `dev.db` (root) / `prisma/dev.db`
- **Isolated Test Database Location:** `prisma/test_iso_<runId>.db` or OS tmp directory.

---

## 2. THE FOUR CONFIRMED EVIDENCE INTEGRITY ISSUES

| Issue ID | Priority | Primary Files | Primary Functions | Confirmed Root Cause & Defect |
|---|---|---|---|---|
| **FINAL-01** | P1 | `src/services/discovery/metaCollector/metaCollectorMcpClient.ts`<br>`src/services/discovery/providers/metaAdsCollectorProvider.ts`<br>`scripts/kh01/runFullAcceptance.ts` | `createMetaCollectorClient()`<br>`verifyLiveMetaSource()`<br>`startIsolatedAcceptanceWorker()` | `SWAI_MOCK_META_BOUNDARY=true` allows 3 simulated fixture ads to be processed by a real worker, persisted in SQLite, and rendered through HTTP/browser. Live acceptance pipeline does not strictly reject this fixture boundary, allowing fake source data to potentially claim `LIVE_RECONCILED`. |
| **FINAL-02** | P1 | `scripts/kh01/runFullAcceptance.ts`<br>`tests/integration/kh01DatabaseIsolation.test.ts` | `collectDatabaseIsolationEvidence()` | Currently creates a `<database>.probe` file on disk, writes a token, and reads it back. This tests filesystem write/read permissions, NOT whether Prisma, the Worker, and Next.js actually connected to the isolated SQLite database and protected active `dev.db`. |
| **FINAL-03** | P1 | `scripts/kh01/runFullAcceptance.ts`<br>`src/lib/kh01/acceptanceGateRegistry.ts` | `buildCanonicalAcceptanceExecutionPlan()`<br>`validateAcceptanceArtifactSet()`<br>`validateAcceptanceArtifact()` | 1. `requiredSuites` in execution plan lists `tests/integration/kh01RealHttpReadback.test.ts`, but that suite is missing from the actual stage commands, and suite execution coverage is not checked against Vitest reports.<br>2. Artifact inventory validation does not strictly enforce the canonical required artifact file list, nor does it deeply validate internal artifact status consistency. |
| **FINAL-04** | P1 | `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`<br>`scripts/kh01/runFullAcceptance.ts` | Six-viewport test<br>`buildBrowserArtifact()`<br>`parseBrowserExecutionEvidence()` | Screenshots are written to a fixed, shared directory `artifacts/v11.5.6/screenshots/`. Subsequent runs overwrite earlier runs' screenshots, destroying evidence immutability and provenance. Run A and Run B must have isolated, immutable screenshot directories with SHA256 hashes. |

---

## 3. FUNCTION CALL GRAPHS & ARCHITECTURE

```text
1. LIVE SOURCE PIPELINE & GUARD (FINAL-01):
   verifyLiveMetaSource(options)
     ├── resolveAcceptanceSourceMode(options) -> "OFFLINE_FIXTURE" | "REAL_LIVE_META"
     ├── assertNoMockSourceForLiveAcceptance(...) -> throws if mock flag active in REAL_LIVE_META
     ├── startIsolatedAcceptanceWorker(context, { sourceMode })
     │     └── spawn(tsx scripts/discovery-worker.ts) with sanitized env (stripping mock if live)
     ├── createMetaCollectorClient()
     │     └── checks SWAI_ACCEPTANCE_SOURCE_MODE vs SWAI_MOCK_META_BOUNDARY
     └── ProviderSourceEvidence -> checks actualTransport !== "mock_test_boundary"

2. PRISMA DATABASE ISOLATION PROBE (FINAL-02):
   collectDatabaseIsolationEvidence(context)
     ├── createDatabaseIsolationProbe(context) -> allocates isolated DB
     ├── writeAndReadDatabaseMarker(testPrisma, marker) -> INSERT & SELECT on isolated DB
     ├── verifyDatabaseIdentityAcrossProcesses(...) -> verifies canonical database key across processes
     └── activeDatabaseProtection -> verifies active dev.db was unmutated and marker is absent

3. SUITE COVERAGE & ARTIFACT INVENTORY (FINAL-03):
   runFullKh01Acceptance()
     ├── buildCanonicalAcceptanceExecutionPlan() -> authoritative requiredSuites & mandatory gates
     ├── executeAcceptanceStage(...) -> produces Vitest JSON reports
     ├── collectExecutedSuiteEvidence(stages, parsedReports)
     ├── validateRequiredSuiteCoverage(requiredSuites, executedSuites) -> BLOCKS if any missing
     ├── validateRequiredArtifactInventory(artifacts, scope) -> validates canonical required files
     └── publishAcceptanceArtifactsAtomically() -> rejects publication if coverage or inventory invalid

4. RUN-SPECIFIC SCREENSHOT IMMUTABILITY (FINAL-04):
   metaDiscoveryFinalAcceptance.test.ts
     └── reads KH01_BROWSER_SCREENSHOT_DIR -> writes to scratchDir/screenshots/viewport_*.png
   runFullKh01Acceptance()
     ├── collectScreenshotEvidence(scratchDir) -> validates size > 0, formats, SHA256
     ├── stageScreenshotArtifacts(evidence, stagingDir) -> copies to staging/screenshots/
     └── atomic promotion to artifacts/v11.5.7/<runId>/screenshots/
```

---

## 4. ACTIVE DATABASE CONFIGURATION

- `dev.db`: Located at repository root. Canonical path resolved via `canonicalizeSqliteDatabasePath()`.
- Safety rule: `assertSafeTestDatabase(url, env)` enforces that `DATABASE_URL !== TEST_DATABASE_URL` during tests, and blocks any URL pointing to `production.db`, `main.db`, or `dev.db`.
- Requirement: All acceptance tests must execute against isolated SQLite instances allocated via `createIsolatedTestDatabase()` with unique ephemeral filenames.

---

## 5. TEST AND ARTIFACT DIRECTORIES

- **Artifacts Base Directory:** `artifacts/v11.5.7/`
- **Ephemeral Staging Directory:** `artifacts/v11.5.7/.staging-<acceptanceRunId>/`
- **Ephemeral Scratch Directory:** `artifacts/v11.5.7/.scratch-<acceptanceRunId>/`
- **Run Directory:** `artifacts/v11.5.7/<acceptanceRunId>/`
- **Screenshots Directory:** `artifacts/v11.5.7/<acceptanceRunId>/screenshots/`
- **Pointer File:** `artifacts/v11.5.7/latest.json`

---

## 6. CHANGES REQUIRED BY REPAIR

1. **FINAL-01 (Live Source Guard):**
   - In `metaCollectorMcpClient.ts`: Add guard rejecting mock client when `SWAI_ACCEPTANCE_SOURCE_MODE === "REAL_LIVE_META"`.
   - In `metaAdsCollectorProvider.ts`: Accurately label fixture status vs live provider status.
   - In `runFullAcceptance.ts`: Add `resolveAcceptanceSourceMode()`, `assertNoMockSourceForLiveAcceptance()`, pass `sourceMode` to `startIsolatedAcceptanceWorker()`, verify observed provider transport in `verifyLiveMetaSource()`.

2. **FINAL-02 (Prisma DB Isolation):**
   - In `runFullAcceptance.ts`: Replace `.probe` file operations with `createDatabaseIsolationProbe()`, `writeAndReadDatabaseMarker()`, using actual Prisma client queries against isolated SQLite database.
   - Verify active application DB (`dev.db`) contains zero test markers.
   - Update `tests/integration/kh01DatabaseIsolation.test.ts` to test these exact Prisma mechanisms.

3. **FINAL-03 (Suite Coverage & Artifact Inventory):**
   - Add `tests/integration/kh01RealHttpReadback.test.ts` into a mandatory execution stage (`STAGE_04C_REAL_HTTP_READBACK` or `STAGE_04B`).
   - Implement `collectExecutedSuiteEvidence()` and `validateRequiredSuiteCoverage()`. Block release if any required suite is missing, skipped-only, or failed.
   - Define `KH01_REQUIRED_ARTIFACTS` canonical inventory. Implement `validateRequiredArtifactInventory()`.
   - Add `suite-coverage.json` and `screenshot-manifest.json` as mandatory artifacts.

4. **FINAL-04 (Screenshot Immutability):**
   - In `metaDiscoveryFinalAcceptance.test.ts`: Read `KH01_BROWSER_SCREENSHOT_DIR` from environment.
   - In `runFullAcceptance.ts`: Implement `collectScreenshotEvidence()` and `stageScreenshotArtifacts()`. Copy verified screenshots to `stagingDir/screenshots/`, compute SHA256 checksums, and reference run-relative paths in `browser-results.json` and `screenshot-manifest.json`.

---

## 7. REGRESSION RISKS & MITIGATION PLAN

- **Risk:** Disabling mock boundary breaks offline tests.
  - *Mitigation:* `SWAI_MOCK_META_BOUNDARY="true"` remains fully supported for `OFFLINE_FIXTURE` mode and existing offline integration tests. It is strictly blocked only when `sourceMode === "REAL_LIVE_META"`.
- **Risk:** Next.js server fails to start if `HOST` binding is incompatible.
  - *Mitigation:* Loopback `127.0.0.1` binding is explicitly configured across all local scripts and test helpers.
- **Risk:** Additional required suites increase runner duration.
  - *Mitigation:* `kh01RealHttpReadback.test.ts` runs in ~1.2s against isolated server/database.
- **Risk:** Screenshot file copying fails or hashes mismatch.
  - *Mitigation:* Screenshots are verified for existence, non-zero byte size, and format before copying; checksums are validated both before and after copy.
