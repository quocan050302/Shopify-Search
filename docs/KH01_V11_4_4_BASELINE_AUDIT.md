# KH-01 V11.4.4 — Baseline Audit Report

**Date**: 2026-10-24  
**Initial Commit SHA**: `53e6feb5ce1290b37317c6249dbe2d6cbf45141c` (`53e6feb`)  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Operating Mode**: `RESEARCH_ONLY`  
**Target Market**: United States  
**Application Stack**: Next.js 16.4.2, React 19.3.0, TypeScript 5, Prisma 7.10.1, libSQL/SQLite, Vitest 5.0.5  

---

## 1. Initial State & Baseline Verification
- **Git Branch Status**: Clean working directory on `feature/v11-meta-collector-remove-muse`, perfectly synchronized with `origin/feature/v11-meta-collector-remove-muse`.
- **Vitest Suite**: 36 test files, 370 tests passing (Duration: ~11.25s).
- **TypeScript Compilation**: `npx tsc --noEmit` passed with 0 errors.
- **Previous Release (V11.4.3)**: Delivered database safety foundations, lazy transaction reflection proxy, verified transport assertions, and research snapshot persistence.

---

## 2. Identified Deficiencies and Gaps (Gaps 1–8)

### Gap 1: In-Process Route Handler Testing Labelled as HTTP API Readback
- **Location**: `scripts/kh01RealE2E.ts` -> `verifyHttpApiReadback()`
- **Issue**: Directly creates `new NextRequest(...)` and invokes `getProductOverviewRoute` / `getJobStatusRoute` within the Node/tsx process. Does not bind to an actual network socket or test the Next.js server runtime, middleware, routing, port binding, or real HTTP headers.
- **Remediation**:
  1. Rename existing direct function to `verifyRouteHandlerReadback()` and report under `routeHandlerReadbackVerified`.
  2. Implement `verifyHttpServerReadback(baseUrl, productId, jobId, expected, authContext)` in `scripts/kh01/verifyHttpServerReadback.ts`, using real `fetch()` calls against a live loopback server (`http://127.0.0.1:<port>`).

### Gap 2: Hard-Coded Acceptance Flags in Runner
- **Location**: `scripts/kh01RealE2E.ts` -> `executeKh01EndToEndAcceptance()`
- **Issue**: Manifest hardcodes `globalConcurrencyVerified: true`, `recoveryVerified: true`, `database.isolated: true`, `database.schemaInitialized: true`, `database.activeDatabaseProtected: true`.
- **Remediation**: Derive all manifest flags from genuine runtime assertions (`ASSERTION`, `DATABASE_QUERY`, `HTTP_RESPONSE`, `BROWSER_ACTION`, `PROCESS_TEST`).

### Gap 3: Permissive Source Provenance Check
- **Location**: `scripts/kh01RealE2E.ts` line 804 (`sourceProvenanceVerified: candidateAd !== null`)
- **Issue**: Synthetic fixture ads satisfy this check, conflating test fixtures with genuine Meta source ads.
- **Remediation**: Differentiate explicit provenance levels: `FIXTURE_SYNTHETIC`, `SOURCE_BACKED`, and `LIVE_SOURCE_VERIFIED`. Only genuine ads qualify for source-backed verification.

### Gap 4: Browser E2E Not Executed
- **Location**: `scripts/kh01RealE2E.ts` line 434 (`browserReadbackVerified = "NOT_RUN"`)
- **Issue**: Honest reporting in V11.4.3, but no real browser tests interacted with `/products/[id]/intelligence`.
- **Remediation**: Implement Playwright / browser automation E2E suite (`tests/e2e/kh01ProductIntelligence.spec.ts` or `scripts/kh01/runBrowserE2E.ts`) rendering real pages, validating product header, 6 pillars, offer panel, landing page panel, economics form, decision persistence, and product switching.

### Gap 5: Incomplete Research Slot API Lifecycle
- **Location**: `src/workers/kh01Worker.ts` -> `releaseResearchSlot()`
- **Issue**: `releaseResearchSlot` returns `true` unconditionally without mutating persistent state.
- **Remediation**: Align slot lifecycle with authoritative job claims. Either implement durable reservation persistence with ownership verification and state updates, or cleanly internalize slot capacity and remove inert stubs.

### Gap 6: Worker Claim Fencing In-Memory Mutation Before Commit
- **Location**: `src/workers/kh01Worker.ts` line 268-270 (`claim.fencingVersion = nextFencingVersion`)
- **Issue**: In-memory claim is mutated prior to the database transaction committing. If the transaction fails, the in-memory version is out of sync.
- **Remediation**: Advance `claim.fencingVersion` only after the transaction successfully commits.

### Gap 7: Test Database Role Safety in Production Mode
- **Location**: `src/lib/database/databaseSafety.ts` line 15-16
- **Issue**: Bypasses checks if `NODE_ENV !== "test" && VITEST !== "true"`. When Next.js runs in production mode (`next start`), `NODE_ENV === "production"`, causing `SWAI_DB_ROLE=INTEGRATION_TEST` to skip collision protection.
- **Remediation**: Implement `isProtectedTestExecution(environment)` checking `NODE_ENV === "test" || VITEST === "true" || SWAI_DB_ROLE === "INTEGRATION_TEST" || SWAI_DB_ROLE === "LIVE_ACCEPTANCE"`.

### Gap 8: Separation of Live-Source Restrictions from Application Health
- **Location**: `scripts/kh01RealE2E.ts`
- **Issue**: Live competitor sites returning HTTP 403/429 must be recorded truthfully as `BLOCKED_BY_SOURCE` without conflating with application failure or claiming successful live extraction.
- **Remediation**: Separate fixture integration status, live extraction status, and overall application release decision.

---

## 3. Implementation Order Across Checkpoints
1. **Checkpoint 2 (Database E2E Safety)**: Harden `assertSafeTestDatabase()` with `isProtectedTestExecution()` to support production Next.js E2E server safely.
2. **Checkpoint 1 (Real HTTP Server Acceptance)**: Build `startSwaiTestServer()`, implement `verifyHttpServerReadback()`, and rename route handler verifier.
3. **Checkpoint 3 (Browser Acceptance)**: Build automated headless browser E2E test for Product Intelligence workspace.
4. **Checkpoint 4 (Worker Capacity & Slot Lifecycle)**: Make `acquireResearchSlot()`, `renewResearchSlot()`, and `releaseResearchSlot()` genuinely verify ownership and mutate database state; test cross-process concurrency.
5. **Checkpoint 5 (Worker Claim Fencing Integrity)**: Prevent premature in-memory version mutation, ensure atomic compare-and-swap on claims, and test stale claimant rejection.
6. **Checkpoint 6 (Acceptance Manifest & Decision Policy)**: Build pure `buildAcceptanceManifest()` and `calculateAcceptanceDecision()`, redact claim tokens, and populate real commit SHA.
7. **Checkpoint 7 (Business & Shopify Research Validation)**: Test six-pillar opportunity assessment, economic gating, and decision persistence.
8. **Checkpoint 8 (Final Verification, Documentation & Release)**: Add npm scripts, run all test suites, measure performance, write docs, commit, and push.
