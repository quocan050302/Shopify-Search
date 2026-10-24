# KH-01 V11.4.5 — Baseline Audit Report

**Date**: 2026-10-24  
**Plan**: KH-01  
**Target Release**: V11.4.5  
**Baseline Git Commit**: `14b2d2181f472a14daef96c8b10e4a51df1047a0`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Operating Mode**: RESEARCH_ONLY  

---

## 1. Executive Summary

In V11.4.4, SWAI successfully introduced real HTTP server assertions (`tests/integration/kh01HttpServerE2E.test.ts`), real headless browser automation with Playwright Core (`tests/integration/kh01BrowserE2E.test.ts`), and initial multi-worker capacity tests (`tests/integration/kh01WorkerConcurrency.test.ts`).

However, an exhaustive audit of the V11.4.4 codebase reveals 9 key reliability, truthfulness, and architectural gaps (Findings A through I) that prevent V11.4.4 from being a fully integrated and authoritative release.

---

## 2. Detailed Findings & Gap Analysis

### Finding A: `kh01:acceptance:full` is not a True Full Orchestrator
- **File**: `package.json`
- **Issue**: Both `"kh01:acceptance"` and `"kh01:acceptance:full"` execute `tsx scripts/kh01RealE2E.ts`. The full command does not orchestrate or verify all independent test suites (unit, integration, HTTP server, browser, multi-process worker concurrency, production build).
- **Remediation**: Build a dedicated orchestrator in `scripts/kh01/runFullAcceptance.ts` that sequentially executes and aggregates evidence from all mandatory stages under a single unique `acceptanceRunId`.

### Finding B: Unconditional `PASSED` Fields in Acceptance Manifest
- **File**: `scripts/kh01RealE2E.ts`
- **Function**: `buildAcceptanceManifest()`
- **Issue**: `leaseRenewal`, `capacityRelease`, `evidenceReadiness`, and `recommendationIntegrity` are unconditionally assigned `"PASSED"`. Furthermore, snapshot reconciliation is evaluated merely as `landingSnapshotId !== null` rather than asserting ID equality across worker, database, and API readback.
- **Remediation**: Derive every manifest status strictly from `AcceptanceAssertionResult` records and assert genuine snapshot ID matching.

### Finding C: Misleading HTTP Compatibility Alias
- **File**: `scripts/kh01RealE2E.ts`
- **Issue**: Manifest assigns `httpApiReadbackVerified = routeHandlerReadbackVerified` even when `actualHttpReadback: "NOT_RUN"`.
- **Remediation**: Decouple `routeHandlerReadbackVerified` from `actualHttpReadbackVerified`. Ensure `httpApiReadbackVerified` strictly reflects genuine network HTTP execution.

### Finding D: Worker Concurrency Verification is Observational
- **File**: `scripts/kh01RealE2E.ts`
- **Function**: `verifyWorkerConcurrency()`
- **Issue**: The function merely counts active running jobs at rest. This observational health check does not prove that simultaneous worker claim attempts honor the global concurrency budget.
- **Remediation**: Rename to `inspectWorkerConcurrencyState()` and implement active multi-worker contention tests in the orchestrator.

### Finding E: Worker Recovery Verification is Insufficient
- **File**: `scripts/kh01RealE2E.ts`
- **Function**: `verifyWorkerRecovery()`
- **Issue**: Calling `recoverInterruptedKh01Jobs()` against an empty database returns a successful scan with 0 recoveries, which is counted as `PASSED` without proving actual crash recovery mechanics.
- **Remediation**: Implement `verifyCrashRecoveryScenario()` with a prepared expired lease job to verify `RUNNING -> PENDING` transition, attempt counting, payload preservation, and stale claimant rejection.

### Finding F: `releaseResearchSlot` Allows Optional Claim Token
- **File**: `src/workers/kh01Worker.ts`
- **Function**: `releaseResearchSlot(workerId, jobId, claimToken?)`
- **Issue**: `claimToken` is optional, meaning capacity could be released without validating the claimant's secret token.
- **Remediation**: Make `claimToken: string` strictly required both in TypeScript and runtime assertions.

### Finding G: Potential Worker Takeover in `acquireResearchSlot`
- **File**: `src/workers/kh01Worker.ts`
- **Function**: `acquireResearchSlot()`
- **Issue**: The function does not guard against taking over an active job owned by another worker with an unexpired lease.
- **Remediation**: Restrict slot acquisition to unleased jobs or explicit renewals by the same worker.

### Finding H: Separate Tests Preseed Records Rather Than Proving Full Pipeline
- **Issue**: `kh01HttpServerE2E.test.ts` and `kh01BrowserE2E.test.ts` manually insert completed snapshots rather than testing the queue -> claim -> execute -> persist -> HTTP -> browser flow in one continuous pipeline.
- **Remediation**: Implement `tests/integration/kh01UnifiedJourney.test.ts` (`npm run kh01:test:journey`), verifying that the exact records produced by the worker are served over HTTP and rendered in the browser.

### Finding I: Cross-Run Report Discrepancies
- **Issue**: Documentation in V11.4.4 combined artifacts from separate test runs without clearly articulating their scope and relationships.
- **Remediation**: All V11.4.5 documentation and manifests will reference a single, unified `acceptanceRunId`.

---

## 3. Implementation Roadmap
1. Checkpoint 1: Manifest truthfulness, HTTP aliases, gate registry, and slot security.
2. Checkpoint 2: Dedicated full acceptance runner (`scripts/kh01/runFullAcceptance.ts`).
3. Checkpoint 3 & 4: Active worker concurrency proof and crash recovery verification.
4. Checkpoint 5: Research slot security hardening.
5. Checkpoint 6: Unified continuous queue-to-browser journey test (`tests/integration/kh01UnifiedJourney.test.ts`).
6. Checkpoint 7: Shopify six-pillar decision integrity regression.
7. Checkpoint 8: Full acceptance orchestrator execution, documentation, and release verification.
