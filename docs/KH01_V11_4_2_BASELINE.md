# KH-01 V11.4.2 — Engineering Baseline Report

## Executive Summary
- **Master Plan**: KH-01
- **Target Version**: V11.4.2
- **Repository**: `quocan050302/Shopify-Search`
- **Branch**: `feature/v11-meta-collector-remove-muse`
- **Starting Head SHA**: `9b0e9c0707a5e123d95f0cfebcd185878a3a3c74`
- **Operating Mode**: `RESEARCH_ONLY`
- **Database Backup**: `./dev.db.backup_kh01_v11_4_2_pre_hardening` (952 KB, integrity: `ok`)

---

## Baseline Model Counts

| Model | Baseline Count | Status |
| :--- | :--- | :--- |
| `CompetitorAd` | 59 | Active authentic ads |
| `Advertiser` | 17 | Verified |
| `AdMediaAsset` | 59 | Verified |
| `AdObservation` | 169 | Verified |
| `DiscoveryRun` | 91 | Verified |
| `DiscoveryRunAd` | 0 | Clean |
| `ResearchProduct` | 37 | Verified |
| `AdProductLink` | 6 | Verified |
| `CompetitorOfferSnapshot` | 0 | Verified |
| `LandingPageSnapshot` | 0 | Verified |
| `ResearchEvidence` | 0 | Verified |
| `ProductEconomicsScenario` | 0 | Verified |
| `SupplierQuote` | 0 | Verified |
| `FulfillmentAssessment` | 0 | Verified |
| `ProductOpportunityAssessment` | 0 | Verified |
| `ResearchDecision` | 18 | Verified audit records |
| `SyncJob` | 55 | Verified |

---

## Scope of V11.4.2 Engineering Upgrades
1. **Checkpoint 1 — Fail-Closed Database Isolation**:
   - `src/lib/db.ts`: Canonicalize SQLite database paths, resolve symlinks, drive letters, and relative paths.
   - Replace naive `.includes("production.db")` check with strict `resolveDatabaseConfiguration()`.
   - Implement `createIsolatedTestDatabase()` test factory using unique per-run temporary SQLite files.
   - Separate test Vitest configuration from live-source opt-in.
2. **Checkpoint 2 — Secure Network Dispatcher**:
   - `src/services/links/linkValidationService.ts` & `verifiedPublicTransport.ts`:
   - Implement destination-pinned dispatcher (using Undici / Node http agent) that connects directly to the resolved and validated IP while retaining TLS SNI and Host header.
   - Eliminate TOCTOU DNS rebinding risk.
3. **Checkpoint 3 — Worker Lifecycle, Fencing & Leases**:
   - `src/workers/kh01Worker.ts` & `landingPageInspectionService.ts`:
   - Reconcile lease duration (use single canonical `KH01_LEASE_DURATION_MS = 60_000`).
   - Claim fencing: Ensure stale workers cannot overwrite newer claimant states.
   - Recover interrupted jobs based on actual `leaseExpiresAt`, not `startedAt`.
   - Prevent double attempt counter increments.
4. **Checkpoint 4 — Transactional & Idempotent Persistence**:
   - `src/services/research/researchResultPersistenceService.ts`:
   - Coordinate writes of `LandingPageSnapshot`, `CompetitorOfferSnapshot`, `ResearchEvidence`, and terminal `SyncJob` status atomically.
   - Enrich content fingerprint to include actual observed price, currency, and bundle quantity.
   - Eliminate implicit `"default-workspace"` fallback.
5. **Checkpoint 5 — Research & Business Scoring Integrity**:
   - `src/services/research/opportunityAssessmentService.ts`:
   - Distinct handling of partial research scores with explicit coverage labels.
   - Ensure unverified supplier quotes and unknown shipping prevent test candidate recommendations.
   - Make heuristic thresholds configurable.
6. **Checkpoint 6 — Product Intelligence UI State Alignment**:
   - `src/app/products/[id]/intelligence/page.tsx`:
   - Distinguish `WORKER_OFFLINE`, `WORKER_BUSY`, `JOB_QUEUED`, `JOB_RUNNING`.
   - Show Research Result Integrity panel with actual persisted IDs.
   - Fully typed DTOs and responsive layout.
7. **Checkpoint 7 — Real End-to-End Acceptance**:
   - `scripts/kh01RealE2E.ts` and automated E2E test verifying queue -> claim -> fetch -> parse -> transactional persistence -> API readback -> opportunity calculation -> decision persistence.
8. **Checkpoint 8 — Regression, Verification & Git Delivery**:
   - All tests passing, `npm run build` passing, zero master branch contamination.
