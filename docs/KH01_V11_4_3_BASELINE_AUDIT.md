# KH-01 V11.4.3 — Baseline Audit & Defect Catalog

**Target Version**: V11.4.3  
**Audit Date**: 2026-10-24  
**Starting Commit SHA**: `17420d1eca89b0e58f9f8b4f6c08f1112216ec0f`  
**Repository**: `quocan050302/Shopify-Search`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Operating Mode**: RESEARCH_ONLY  

---

## 1. Environment & Runtime Baseline

* **Node.js**: v22.22.3
* **npm**: 10.9.8
* **TypeScript**: 5.9.3
* **Prisma**: 7.10.1 (CLI, Client, Engines)
* **libSQL Adapter**: `@prisma/adapter-libsql` v7.10.1, `@libsql/client` v0.18.0
* **Next.js**: 16.4.2 (React 19.3.0, Turbopack)
* **Vitest**: 5.0.5
* **Active Database**: `dev.db` (SQLite, 952 KB, `PRAGMA integrity_check: ok`)
* **Verified Database Counts**:
  * `CompetitorAd`: 59
  * `Advertiser`: 17
  * `DiscoveryRun`: 103
  * `ResearchProduct`: 47

---

## 2. Comprehensive Defect Analysis (Defects A–K)

### Defect A — Premature Prisma Client Construction in Test Harness
* **Files**: `tests/setupTestEnvironment.ts`, `src/lib/db.ts`, `scripts/kh01RealE2E.ts`
* **Defect Detail**: `tests/setupTestEnvironment.ts` statically imports `canonicalizeSqliteDatabasePath` and `assertSafeTestDatabase` from `@/lib/db`. Because `src/lib/db.ts` contains top-level statement `export const prisma = globalForPrisma.prisma || createPrismaClient();`, the singleton `prisma` instance is instantiated before `process.env.TEST_DATABASE_URL` is set, defaulting to `dev.db`.
* **Database Implication**: Integration tests could inadvertently bind to `dev.db` if the module cache is not cleanly purged.
* **Required Correction**: Separate configuration and safety assertion logic into pure modules (`databaseConfig.ts`, `databaseSafety.ts`) free of Prisma client construction side-effects. Enforce dynamic/lazy singleton initialization.

### Defect B — Missing Reproducible Test Schema
* **Files**: `tests/helpers/createIsolatedTestDatabase.ts`, `tests/setupTestEnvironment.ts`
* **Defect Detail**: The isolated DB factory relies on copying `prisma/test_template.db`. However, `*.db` is ignored in `.gitignore`, meaning clean checkouts lack this file. In its absence, `fs.writeFileSync(path, "")` created an empty 0-byte file without table schemas.
* **Database Implication**: Tests fail immediately with `no such table` errors on clean clone environments.
* **Required Correction**: Provide programmatic schema initialization via `prisma db push` or DDL migration on the target isolated SQLite database without relying on untracked binary templates.

### Defect C — Environment-Dependent Database Safety Guards
* **Files**: `src/lib/db.ts`
* **Defect Detail**: Safety assertions checked whether `TEST_DATABASE_URL` was provided or whether `SWAI_TEST_ISOLATION === "strict"`. If a developer ran tests without these specific environment variables, the system could fall back to `DATABASE_URL` or `dev.db`.
* **Database Implication**: Potential silent test writes to production/research databases.
* **Required Correction**: Fail-closed database role contract (`APPLICATION`, `UNIT_TEST`, `INTEGRATION_TEST`, `LIVE_ACCEPTANCE`). In test mode, missing isolated configuration must fail immediately before any database connection.

### Defect D — Non-Atomic Worker Claim Fencing on Mutations
* **Files**: `src/workers/kh01Worker.ts`
* **Defect Detail**: In `renewKh01Lease`, `updateJobIfOwned`, and progress updates, the system read the job record and then updated by `id` and `status: "RUNNING"`. The `claimToken` was stored in `resultJson`. A concurrent claim could usurped ownership between the read and write operations.
* **Database Implication**: Split-brain execution where two workers both believe they hold active leases.
* **Required Correction**: Enforce database-level conditional mutations incorporating `claimToken` or monotonic `fencingVersion` directly into the database query where schema permits, or inside an atomic transaction.

### Defect E — Global Concurrency of Heavy Research Jobs Unenforced Across Workers
* **Files**: `src/workers/kh01Worker.ts`
* **Defect Detail**: Bounded concurrency (`concurrency = 1`) was enforced locally within a single process loop via `isPolling` boolean. Two separate worker processes could concurrently claim two distinct `PENDING` jobs.
* **Database Implication**: System resource exhaustion and potential IP rate-limiting from competitor websites.
* **Required Correction**: Database-backed global research concurrency slot (`acquireResearchSlot`, `releaseResearchSlot`) limiting active heavy research tasks to 1 across the shared database scope.

### Defect F — Unsafe ID-Only Executor Signature
* **Files**: `src/services/research/landingPageInspectionService.ts`
* **Defect Detail**: `executeLandingPageResearchJob` typed input as `jobOrClaim: string | ClaimedKh01Job`.
* **Database Implication**: Permitted callers to attempt executing a job with only a string ID without an atomic claim.
* **Required Correction**: Restrict signature strictly to `executeLandingPageResearchJob(claim: ClaimedKh01Job, signal?: AbortSignal)`. Remove all ID-only code paths.

### Defect G — Persistence Boundary Race Windows
* **Files**: `src/services/research/researchResultPersistenceService.ts`
* **Defect Detail**: Terminal updates on `syncJob` within `persistCompletedResearchResult` updated by `id` and `status: "RUNNING"`, relying on an in-memory check of `claimToken`.
* **Database Implication**: Stale workers could finalize a job that was reclaimed by another worker after lease expiry.
* **Required Correction**: Incorporate `claimToken` comparison directly into the transaction condition.

### Defect H — Fictional Ad Provenance in E2E Runner
* **Files**: `scripts/kh01RealE2E.ts`
* **Defect Detail**: When no source ad was found, the script created a synthetic ad fixture with `externalAdId: "1642750633880173"` and labeled it verified provenance.
* **Database Implication**: Masked whether the system was testing against genuine Meta ad data or synthetic fixtures.
* **Required Correction**: Explicitly separate `FIXTURE_INTEGRATION_E2E` from `SOURCE_BACKED_E2E` and `LIVE_SOURCE_E2E`. Live mode must fail if no authentic source ad exists (`BLOCKED_NO_SOURCE_AD`).

### Defect I — Database Readback Conflated with HTTP API Readback
* **Files**: `scripts/kh01RealE2E.ts`
* **Defect Detail**: The runner performed `prisma.researchProduct.findUnique()` and set `apiReadbackVerified: true`.
* **Database Implication**: Did not test HTTP routing, middleware, serialization, or Next.js route handlers.
* **Required Correction**: Explicitly distinguish `databaseReadbackVerified`, `httpApiReadbackVerified`, and `browserReadbackVerified`. Real HTTP requests must be sent to `/api/v1/research/products/:id/overview`.

### Defect J — Handcrafted E2E Opportunity Scoring Input
* **Files**: `scripts/kh01RealE2E.ts`
* **Defect Detail**: E2E runner constructed manually selected fields (`identityConfidence: "PROBABLE"`, `clearCtaObserved: true`) rather than using `buildProductOpportunityInput`.
* **Database Implication**: Bypassed production evidence aggregation.
* **Required Correction**: Call production aggregation service to derive opportunity assessment from genuine stored records.

### Defect K — Conflation of Access Restriction with Live Acceptance
* **Files**: `scripts/kh01RealE2E.ts`, `docs/KH01_V11_4_2_REAL_E2E.md`
* **Defect Detail**: When competitor storefront rate-limited (HTTP 429), the run reported `BLOCKED_BY_SOURCE` with exit code 0. While honest, this did not represent successful live extraction.
* **Database Implication**: Could mislead operators into believing live scraping succeeded.
* **Required Correction**: Distinguish `ACCEPTED` (successful live extraction) from `BLOCKED_BY_SOURCE` (inaccessible source), requiring deterministic fixtures for complete data-flow validation.
