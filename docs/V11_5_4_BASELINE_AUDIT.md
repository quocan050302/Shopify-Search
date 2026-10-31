# SWAI V11.5.4 — Baseline and Root Cause Audit

**Target Specification:** KH-01 Master Release Acceptance  
**Release Version:** V11.5.4 FINAL  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Inspected Baseline SHA:** `c3a1b8ec846f0b729dcd83319fab2c58f5fc7113`  
**Execution Mode:** `RESEARCH_ONLY`  
**Target Market:** United States (US)

---

## 1. Executive Summary

This audit assesses the state of SWAI prior to the V11.5.4 code-hardening release. While previous iterations (V11.5.2 and V11.5.3) established isolated SQLite databases and genuine worker concurrency, several critical security, runtime, reconciliation, and release-blocking defects remained.

The V11.5.4 engineering contract defines ten non-negotiable repairs (FINAL-01 through FINAL-10) to close these gaps and guarantee that all release claims are strictly backed by authentic runtime execution evidence.

---

## 2. Root Cause Audit & Defect Classification Matrix

| Defect ID | Priority | Description & Current State | Audit Classification |
|---|---|---|---|
| **FINAL-01** | P1 | Live source verification (`verifyLiveMetaSource`) skipped worker queuing, readback, and browser verification, awarding `LIVE_RECONCILED` prematurely. | **CONFIRMED** (Restructured into 7-stage boundary pipeline) |
| **FINAL-02** | P1 | CLI entrypoint did not parse `--live-meta` / `--offline-only` or reject invalid arguments. | **CONFIRMED** (Implemented `parseAcceptanceCliArgs` & `runAcceptanceCli`) |
| **FINAL-03** | P1 | Offline reconciliation fixture created runs with 5 valid ads but 0 links, causing reconciliation failures that were not handled properly. | **CONFIRMED** (Implemented relational fixture linking 5 ads to run in `executeOfflineReconciliationAcceptance`) |
| **FINAL-04** | P1 | Required acceptance artifacts (`exact-run-reconciliation`, `browser-results`) failure did not block release verdict. | **CONFIRMED** (Enforced in `finalizeAcceptanceVerdict` via `evaluateRequiredArtifacts`) |
| **FINAL-05** | P1 | Post-write verdict inconsistency: report was finalized before artifact write, allowing write errors to not reflect in CLI exit code. | **CONFIRMED** (Report finalized strictly after write validation, ensuring CLI exit code matches manifest verdict) |
| **FINAL-06** | P1 | Arbitrary explicitly provided admin tokens were accepted if secret unconfigured, relying on insecure substring checks (`invalid`/`bad`). | **CONFIRMED** (Rejects explicit tokens when unverified; added `validateServerBindingPolicy`) |
| **FINAL-07** | P2 | Assertion resolution fallback used fuzzy substring matching (`fullName.includes(...)`). | **CONFIRMED** (Removed substring matching, enforced exact test identity via `normalizeTestIdentity`) |
| **FINAL-08** | P2 | Browser artifact claimed hardcoded 6 viewports (`viewportsTested`) without verifying actual execution. | **CONFIRMED** (Removed hardcoded list, only records verified viewports) |
| **FINAL-09** | P2 | In `reconcileResearchRunCounts`, `displayedCount` was assigned equal to `linkedCount` by policy assumption without cross-boundary evidence. | **CONFIRMED** (Added observed cross-boundary counts and dependency injection support) |
| **FINAL-10** | P1 | Agreement required between CLI displayed verdict, report overall status, manifest verdict, and exit code. | **CONFIRMED** (Guaranteed mathematical consistency and nonzero exit on BLOCKED) |

---

## 3. Working Tree and Active Database Invariants

- **Active Application Database:** `prisma/dev.db` (strictly protected; no test modifications allowed).
- **Test Database Isolation:** Isolated ephemeral SQLite files allocated under `file:./prisma/test-...` and torn down after each test suite.
- **Git Invariant:** Branch strictly checked as `feature/v11-meta-collector-remove-muse`.
