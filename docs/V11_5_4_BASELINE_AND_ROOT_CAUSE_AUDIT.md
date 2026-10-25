# SWAI V11.5.4 — Baseline & Root Cause Audit
**Specification Protocol:** KH-01  
**Target Release:** V11.5.4 FINAL  
**Audited Baseline SHA:** `c3a1b8ec846f0b729dcd83319fab2c58f5fc7113`  
**Repository Branch:** `feature/v11-meta-collector-remove-muse`  
**Audited Timestamp:** 2026-10-25T11:51:00+07:00  
**Application Mode:** `RESEARCH_ONLY`  
**Target Market:** United States

---

## 1. Executive Inspection & Git Verification

A clean git inspection was conducted at the start of V11.5.4 execution:
- `git status --short`: clean working directory (0 modified files)
- `git branch --show-current`: `feature/v11-meta-collector-remove-muse`
- `git rev-parse HEAD`: `c3a1b8ec846f0b729dcd83319fab2c58f5fc7113`
- `git fetch origin`: fully up-to-date with remote origin

All recent commits leading to `c3a1b8e` (including V11.5.1, V11.5.2, and V11.5.3) are intact and respected. The active application SQLite database (`prisma/dev.db`) is strictly protected and preserved.

---

## 2. Ten Non-Negotiable Defect Audit Register

| Defect ID | Priority | Location | Description | Audit Status | Root Cause & Reproduction |
| :--- | :---: | :--- | :--- | :---: | :--- |
| **FINAL-01** | P1 | `scripts/kh01/runFullAcceptance.ts` | `verifyLiveMetaSource()` performs isolated DB queries but does not execute the actual queued worker claiming flow (`processDueSchedulesOnce()`), nor does it run Playwright against live-ingested IDs. | **CONFIRMED** | `verifyLiveMetaSource()` called MCP search directly and created a run, but did not invoke the worker queue lifecycle or cross-boundary ID equality across DB, HTTP, and Playwright DOM. |
| **FINAL-02** | P1 | `scripts/kh01/runFullAcceptance.ts` | CLI `--live-meta` argument is not parsed by the acceptance entrypoint script. | **CONFIRMED** | Line 1293 calls `runFullKh01Acceptance()` with no arguments; `process.argv` is ignored. CLI invocation always defaults to offline-only. |
| **FINAL-03** | P1 | `scripts/kh01/runFullAcceptance.ts` | `buildExactRunArtifact()` creates a run with 5 valid records but 0 linked records, causing reconciliation failure. | **CONFIRMED** | The fixture inserted `DiscoveryRun` (`valid: 5`), but omitted `CompetitorAd` and `DiscoveryRunAd` associations. `reconcileResearchRunCounts` properly returned `consistent: false`. |
| **FINAL-04** | P1 | `scripts/kh01/runFullAcceptance.ts`, `src/lib/kh01/acceptanceGateRegistry.ts` | Reconciliation and browser artifact failures do not block the release verdict. | **CONFIRMED** | `finalizeAcceptanceVerdict()` only checked gates and manifest validation; it did not receive or evaluate `AcceptanceArtifactStatus[]`. |
| **FINAL-05** | P1 | `src/services/security/adminAuth.ts`, `package.json` | `resolveDeploymentSecurityPolicy()` treated empty `HOST` as local loopback; `package.json` lacked explicit loopback startup scripts. | **CONFIRMED** | Missing `HOST` does not prove socket binding. Need `validateServerBindingPolicy()` and explicit `dev:local` / `start:local` scripts (`next dev -H 127.0.0.1`). |
| **FINAL-06** | P1 | `src/services/security/adminAuth.ts` | `resolveAdminPrincipal()` allows arbitrary tokens to authenticate when no secret is configured unless the token contains "invalid" or "bad". | **CONFIRMED** | Lines 305–314 explicitly checked `providedToken.includes("invalid")` rather than rejecting any unverifiable token when credentials are provided. |
| **FINAL-07** | P2 | `scripts/kh01/runFullAcceptance.ts` | `resolveExecutedAssertion()` still contained substring fallback (`includes(expectedTestName)`). | **CONFIRMED** | Line 663 had `entry.fullName.includes(expected.expectedTestName)`. Test matching must use `normalizeTestIdentity()` with exact relative path and full test name. |
| **FINAL-08** | P2 | `scripts/kh01/runFullAcceptance.ts`, `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` | `buildBrowserArtifact()` wrote a hard-coded array of 6 viewports (`viewportsTested`) without evidence of actual execution across all 6. | **CONFIRMED** | Lines 930–937 declared 6 viewports statically. Need `extractBrowserExecutionEvidence()` and explicit viewport execution in E2E tests. |
| **FINAL-09** | P2 | `src/services/ads/adService.ts`, `src/app/api/v1/ads/route.ts` | `POST /api/v1/ads` still called `upsertCompetitorAd` directly without validating workspace run ownership; reconciliation assigned `displayed = linked`. | **CONFIRMED** | `importAdvertisementForWorkspace` did not verify `runId` workspace ownership. Route called upsert directly. DB reconciliation must report DB facts, leaving HTTP/browser reconciliation separate. |
| **FINAL-10** | P1 | `scripts/kh01/runFullAcceptance.ts` | Post-write verdict inconsistency: `report.overallStatus` was constructed before `writeAcceptanceArtifacts()`, so write failures did not update the return value or CLI exit code. | **CONFIRMED** | Line 1251 constructed `report` before line 1265. If artifact writing failed, `overallStatus` became `BLOCKED`, but `report.overallStatus` remained `CONDITIONALLY_ACCEPTED`, exiting 0. |

---

## 3. Implementation Plan & Execution Checkpoints

In strict accordance with Section 20 of the specification:

1. **Checkpoint 1 — Baseline & Audit:** (Completed — this document).
2. **Checkpoint 2 — CLI:** Implement `parseAcceptanceCliArgs()` and `runAcceptanceCli()`; support `--live-meta`, `--offline-only`, `--help`, reject unknown/conflicting args.
3. **Checkpoint 3 — Live Execution & Worker Pipeline:** Implement `createLiveAcceptanceContext()`, `executeLiveResearchThroughWorker()`, `verifyLivePersistence()`, `verifyExactRunHttpReadback()`, `verifyExactRunBrowserReadback()`, and `compareEvidenceAcrossBoundaries()`.
4. **Checkpoint 4 — Reconciliation:** Separate Database, HTTP, and Browser reconciliation facts; remove assigned display assumption; provide positive coherent fixture for offline acceptance.
5. **Checkpoint 5 — Artifacts & Viewport Integrity:** Implement `extractBrowserExecutionEvidence()`; remove hardcoded `viewportsTested`; ensure artifacts reflect authentic execution.
6. **Checkpoint 6 — Verdict & Mandatory Artifact Blocking:** Implement `evaluateRequiredArtifacts()`; update `finalizeAcceptanceVerdict()` to require mandatory artifacts.
7. **Checkpoint 7 — Report Consistency & Post-Write Atomicity:** Implement `finalizeAndPublishAcceptance()`; ensure `report.overallStatus`, manifest, artifacts, and CLI exit code are strictly consistent.
8. **Checkpoint 8 — Security & Authentication Hardening:** Implement `validateServerBindingPolicy()`; fix `resolveAdminPrincipal()` to reject unverifiable tokens; add `dev:local` / `start:local` scripts; fix `importAdvertisementForWorkspace()`.
9. **Checkpoint 9 — Exact Assertion Identity:** Implement `normalizeTestIdentity()`; remove all substring fallbacks in `resolveExecutedAssertion()`.
10. **Checkpoint 10 — Browser E2E:** Execute actual Playwright workflow across all 6 required viewports; record authentic screenshots and metrics.
11. **Checkpoint 11 — Offline Acceptance & Self-Tests:** Run complete test suite and acceptance runner in offline mode.
12. **Checkpoint 12 — Optional Live Acceptance:** Test CLI live opt-in flags and verify truthful handling when collector is offline/active.
13. **Checkpoint 13 — Commit, Verification & Release:** Commit implementation, run full acceptance on implementation SHA, write documentation, and push to feature branch.
