# KH-01 V11.4.5 — Unified Technical Release Acceptance Orchestrator

## Executive Summary
In KH-01 V11.4.4, `package.json` mapped both `kh01:acceptance` and `kh01:acceptance:full` to `scripts/kh01RealE2E.ts` (Finding A). The "full" command did not orchestrate independent suites, did not guarantee that the HTTP server, Playwright browser, multi-process worker concurrency, or crash recovery suites had run, and did not bind them to a single authoritative release manifest.

In KH-01 V11.4.5, a dedicated full acceptance orchestrator was created at `scripts/kh01/runFullAcceptance.ts` and bound to `npm run kh01:acceptance:full`.

---

## Architecture of `runFullKh01Acceptance()`

The orchestrator executes a sequence of strictly ordered, independent verification stages:

```
[1. STAGE_01_GIT_STATE]
    └── git branch --show-current
    └── Verifies execution is strictly on feature/v11-meta-collector-remove-muse
    
[2. STAGE_02_TYPESCRIPT]
    └── npx tsc --noEmit
    └── Zero TypeScript type errors allowed

[3. STAGE_03_UNIT_SUITE]
    └── npx vitest run tests/unit/kh01Security.test.ts tests/unit/kh01JobExecution.test.ts 
                       tests/unit/shopifyDecisionIntegrity.test.ts tests/unit/dbIsolation.test.ts
    └── Verifies security primitives, job engine, and economic decision integrity

[4. STAGE_04_CONCURRENCY_RECOVERY]
    └── npx vitest run tests/integration/kh01WorkerConcurrency.test.ts
    └── Verifies mutual exclusion, peak active overlap bounds, and crash recovery

[5. STAGE_05_UNIFIED_JOURNEY]
    └── npx vitest run tests/integration/kh01UnifiedJourney.test.ts
    └── Verifies queue -> worker -> DB -> Next.js HTTP server -> Chromium browser

[6. STAGE_06_PRODUCTION_BUILD]
    └── npm run build
    └── Production bundle build validation

[7. MANIFEST & DECISION]
    └── Generates authoritative Section 14 Manifest
    └── All gates derived strictly from executed stage results
    └── Writes artifacts/kh01-v11.4.5/full-acceptance-manifest.json
```

---

## Authoritative Run Provenance
- A single cryptographically unique `acceptanceRunId` (e.g. `kh01_rel_<timestamp>_<uuid>`) is generated at the start of the full run.
- All stages, assertions, and manifest fields carry this identical identifier.
- Exit semantics: Exits `0` if and only if all mandatory gates pass (`ACCEPTED`). Exits non-zero if any mandatory gate fails or is blocked.
