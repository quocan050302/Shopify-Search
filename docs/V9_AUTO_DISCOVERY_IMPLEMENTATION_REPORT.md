# SWAI V9 — Production-Grade TikTok Auto Discovery Engine
## Technical Implementation Report

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Market:** United States (US)  
**Primary Platform:** TikTok  
**Reference Baseline Commit:** `bbed23c864eb82c2d42f5fc7ee5ec1f483778596`  
**Delivery Date:** October 20, 2026  
**Environment:** Next.js 16.4.2, React 19.3.0, TypeScript 5, Prisma 7.10.1, SQLite / libSQL  

---

### Executive Summary

SWAI V9 upgrades the application from manual TikTok Creative Center link research and batch import into an automated, provider-backed **TikTok Auto Discovery Engine**. The architecture enforces strict zero-cost defaults, zero circumvention of platform authorization, real-data verification with full provenance, and honest blocked states (`REQUIRES_AUTH`, `BLOCKED_SOURCE`) rather than masking upstream restrictions with synthetic mock ads.

All 203 automated test suites pass (up from 160 baseline tests), TypeScript validation compiles with 0 errors, Next.js 16 production build compiles with all 36 static and dynamic routes verified, and the local CLI tools (`discovery:doctor`, `discovery:once`, `discovery:worker`, `discovery:dry-run`) operate safely.

---

### Key Architectural Changes & Files Created

#### 1. Additive Database Schema (`prisma/schema.prisma`)
The local SQLite database was preserved and extended additively without destructive changes or data loss:
- **`DiscoverySchedule`**: Stores automated local daily discovery configuration (workspace ID, name, enabled status, provider ID, search window, target market, keywords, dailyLimit, timezone, hourOfDayUtc, lastRunAt, nextEligibleRunAt, failureCount).
- **`DiscoveryRun`**: Tracks individual discovery execution runs linked to `SyncJob` (job ID, provider ID, status, runMode, queryConfigJson, actualRetrievedCount, validCount, newUniqueCount, existingDuplicateCount, failedCount, creditsUsed, actualCostUsd, heartbeatAt, startedAt, finishedAt).
- **`ProviderRequestLedger`**: Durable audit ledger for outbound API calls, tracking endpoints (redacted of query tokens), HTTP status, duration, estimated and actual costs, and error categories.
- **`AdSourceIdentity`**: Composite stable identity mapping (`platform`, `providerId`, `sourceExternalId`, `stableIdentityHash`, `canonicalSourceUrl`, `confidence`, `firstSeenAt`, `lastSeenAt`) preventing cross-platform and cross-run ID collisions.
- Relation added: `CompetitorAd.sourceIdentities`.

#### 2. Domain Types & Error Taxonomy (`src/services/discovery/types.ts`)
- Strict TypeScript types and Zod schemas: `DiscoveryQuerySchema`, `RawDiscoveredAdSchema`, `NormalizedDiscoveredAdSchema`, `DiscoveryScheduleConfigSchema`.
- Explicit error codes: `NO_AUTHORIZED_PROVIDER`, `PROVIDER_NOT_CONFIGURED`, `PROVIDER_PERMISSION_DENIED`, `PROVIDER_RATE_LIMITED`, `PROVIDER_REGION_UNSUPPORTED`, `PROVIDER_RESPONSE_INVALID`, `PROVIDER_BUDGET_BLOCKED`, `PROVIDER_UNAVAILABLE`, `DISCOVERY_CANCELLED`, `DISCOVERY_PARTIAL`, `DISCOVERY_DATABASE_ERROR`.
- Explicit provider availability states: `AVAILABLE`, `NOT_CONFIGURED`, `REQUIRES_AUTH`, `BLOCKED_SOURCE`, `REGION_UNSUPPORTED`, `UNVERIFIED`, `PAID_DISABLED`, `LIVE_VERIFIED`.

#### 3. Security, SSRF & Budget Request Guard (`src/services/discovery/providerRequestGuard.ts`)
- All outbound provider HTTP operations pass through `executeGuardedProviderRequest()` (aliased as `executeProviderRequest()`).
- Blocks SSRF to loopback and private networks (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, etc.).
- Enforces `FREE_DISCOVERY_MODE=true` by default, blocking paid requests (Captapi, Apify) before network dispatch.
- Logs sanitized, token-redacted records into `ProviderRequestLedger`.

#### 4. Provider Contract & Adapters (`src/services/discovery/`)
- **`providerContract.ts`**: `AdDiscoveryProvider` interface (`getCapabilities()`, `checkAvailability()`, `estimateCost()`, `discoverPage()`).
- **`providers/tiktokTopAdsProvider.ts`**: Free direct adapter for TikTok Creative Center US Top Ads. Accurately reports `REQUIRES_AUTH` without session cookie, refuses circumvention.
- **`providers/apifyTopAdsProvider.ts`**: Optional metered adapter. Strictly disabled by default under `budgetService.ts`.
- **`providers/tiktokOfficialProvider.ts`**: Official developer adapter reporting `REGION_UNSUPPORTED` for US commercial competitor ads (official API is EU DSA-only).
- **`providerRegistry.ts`**: Manages provider discovery, capability querying, and free-first selection hierarchy.

#### 5. Normalization & Ingestion Pipeline (`src/services/discovery/`)
- **`normalization/normalizeTikTokTopAd.ts`**: Maps real provider fields (material ID, brand, headline, industry, relative rankings, video duration, thumbnail). Validates dates, generates stable 32-character SHA256 identity hashes, marks Creative Center ads as `RESTRICTED` (non-embeddable).
- **`discoveryIngestionService.ts`**: Atomic transactional ingestion (`prisma.$transaction`), preserves first-observation timestamps, links `AdLifecycleEvent`, records metric observations (`AdMetricObservation`), calculates longevity scores, and prevents duplicate records.

#### 6. Job Orchestration & State Machine (`src/services/discovery/discoveryOrchestrator.ts`)
- State machine: `PENDING` -> `RUNNING` -> `COMPLETED` / `PARTIALLY_COMPLETED` / `FAILED` / `CANCELLED` / `BLOCKED_SOURCE` / `BUDGET_BLOCKED`.
- Durable leases via `SyncJob` and `DiscoveryRun` checkpoints.
- Safe bounded pagination with cycle detection and maximum page caps.

#### 7. Local Scheduled Worker & CLI (`src/workers/discoveryWorker.ts`, `scripts/`)
- Dedicated background worker process independent of Next.js web lifecycle.
- Polling for due schedules with timezone-aware daily execution.
- Stale job crash recovery (`recoverInterruptedDiscoveryJobs`).
- CLI scripts:
  - `npm run discovery:doctor`
  - `npm run discovery:once`
  - `npm run discovery:worker`
  - `npm run discovery:dry-run`

#### 8. REST API Route Handlers (`src/app/api/v1/discovery/`)
- `GET /api/v1/discovery/providers`: Lists discovery providers and capabilities.
- `GET /api/v1/discovery/config`: Retrieves configured workspace discovery schedules.
- `POST /api/v1/discovery/config`: Creates/updates discovery schedule with Zod validation.
- `POST /api/v1/discovery/run`: Triggers live or dry-run discovery job with full persistence.
- `GET /api/v1/discovery/jobs`: Paginated discovery execution history.
- `GET /api/v1/discovery/jobs/[id]`: Detailed job execution and counter inspection.
- `POST /api/v1/discovery/jobs/[id]/cancel`: Safely cancels running or pending jobs.
- `GET /api/v1/discovery/stats`: High-level metrics (total ads, runs, active schedules, worker state).

#### 9. Frontend User Interface (`src/app/discovery/page.tsx`, `Sidebar.tsx`, `explorer/page.tsx`)
- Auto Discovery navigation link added to Sidebar and Ads Explorer header.
- Search Configuration panel (keywords, industries, search window, sorting, daily limits).
- Honest Provider Status badges (`LIVE_VERIFIED`, `REQUIRES_AUTH`, `BLOCKED_SOURCE`, `NOT_CONFIGURED`, `PAID_DISABLED`).
- Execution controls: "Start Discovery (Live)" and "Dry Run (Zero DB Writes)".
- Daily schedule management toggle with local worker status indicator.
- Discovery execution history table with real-time status and metric counter display.
- Discovery results preview grid showing source attribution and Creative Center permalinks.

---

### Test Suite Execution Summary

- **Total Test Files:** 18
- **Total Tests:** 203
- **Passed:** 203 (100%)
- **Failed:** 0
- **TypeScript:** 0 compilation errors (`npx tsc --noEmit`)
- **Next.js Production Build:** 36/36 routes generated successfully (`npm run build`)
- **Prisma Schema:** Validated successfully (`npx prisma validate`)
