# SWAI V11.0 — Final Acceptance & Migration Report
## Full Migration: Muse AI → Self-Hosted MetaAdsCollector MCP Pipeline

**Date:** 2026-10-24  
**Target Environment:** macOS / Windows (Cross-Platform) · Next.js 16.4.2 · React 19 · Prisma 7.10.1 · libSQL/SQLite · Python 3.10+ MCP  
**Execution Agent:** Google Antigravity  
**Git Branch:** `feature/v11-meta-collector-remove-muse`  
**Base Commit SHA:** `67e9a129c3bfcefad63edee7ab8252cff599c622`  
**Upstream Source Repository:** [https://github.com/promisingcoder/MetaAdsCollector](https://github.com/promisingcoder/MetaAdsCollector)  
**Integrated Upstream Version & SHA:** `meta-ads-collector==1.7.0` (MCP 2.3.0), Commit `a9e5b14673fa41943bb831151700cc4dba1609c5`  

---

### Executive Summary

SWAI V11 has completely eliminated the legacy external Muse AI integration (including external agent gateways, Muse shared-secret tokens, ngrok/Cloudflare tunnels, and paid scraping API dependencies). It replaces the entire Facebook Ad Library discovery subsystem with a 100% self-hosted, local-first Python MCP (Model Context Protocol) server communicating over `stdio`.

All 16 Acceptance Gates defined in the Master Implementation Prompt have been met with zero regressions:
1. **Branch Isolation:** Committed entirely to `feature/v11-meta-collector-remove-muse`; `master` was never modified or pushed.
2. **Complete Muse Removal:** All active Muse runtime routes (`/api/v1/discovery/muse/*`), gateways, tokens, tunnels, and tests were removed.
3. **Data Integrity & Provenance:** Every discovered advertisement possesses a verified numeric Meta Library ID (>= 5 digits), canonical source link `https://www.facebook.com/ads/library/?id=<ID>`, and truthful observation provenance (`META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION`).
4. **Relational Tracking (`DiscoveryRunAd`):** Resolved the critical bug where research runs could not be isolated in the Winning Ads Explorer. The Explorer now filters strictly by `requestId` via relational joins.
5. **Verified Live Ingestion & Deduplication:** Successfully retrieved 5 genuine Meta advertisements from the live US Ad Library, ingested them with full provenance, and verified that a repeat probe achieved 100% deduplication (0 new, 5 duplicates).

---

### 1. Database Pre-Migration Audit & Backup

Before any schema modification, a WAL-consistent SQLite backup was created via `VACUUM INTO`:
- **Backup File:** `backups/v11_pre_migration_2026-10-24T02-25-08-507Z.db`
- **File Size:** 581,632 bytes
- **Integrity Check:** `PRAGMA integrity_check` -> `ok`
- **Pre-Migration Baseline:**
  - `CompetitorAd`: 9 records
  - `AdMediaAsset`: 10 records
  - `AdObservation`: 9 records
  - `AdSourceIdentity`: 10 records
  - `DiscoveryRun`: 3 records
  - `SyncJob`: 3 records
  - `DiscoverySchedule`: 1 record
  - `Workspace`: 1 record
- **Post-Migration & Live Ingestion Status:**
  - All 9 pre-migration ads remain completely intact.
  - 5 new verified ads from live Meta Ad Library research were ingested.
  - Total ads: 14.
  - Zero historical research records lost.

---

### 2. Schema Changes & Relational Linking

Added `DiscoveryRunAd` in `prisma/schema.prisma` providing explicit foreign-key relations between `DiscoveryRun` and `CompetitorAd`:

```prisma
model DiscoveryRunAd {
  id            String       @id @default(cuid())
  runId         String
  adId          String
  workspaceId   String       @default("default-workspace")
  providerId    String
  libraryId     String?
  ingestOutcome String       // NEW or EXISTING
  sourceUrl     String?
  observedAt    DateTime     @default(now())

  run           DiscoveryRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  ad            CompetitorAd @relation(fields: [adId], references: [id], onDelete: Cascade)

  @@unique([runId, adId])
  @@index([workspaceId, runId])
  @@index([adId])
  @@map("discovery_run_ads")
}
```

Applied via `prisma db push` and regenerated via `prisma generate`.

---

### 3. File Inventory

#### A. Created Files
- `services/meta-ads-collector/requirements.txt` (pinned dependencies: `meta-ads-collector==1.7.0`, `mcp==2.3.0`)
- `services/meta-ads-collector/README.md`
- `scripts/meta-collector-setup.sh` (POSIX macOS/Linux setup)
- `scripts/meta-collector-setup.ps1` (Windows setup)
- `scripts/meta-doctor.ts` (environment, MCP, and database diagnostics)
- `scripts/meta-once.ts` (single-run processing CLI)
- `scripts/meta-test.ts` (controlled live probe and test persistence)
- `scripts/db-backup-audit.ts` (database backup and verification)
- `src/types/adViewModel.ts` (unified AdCard/Explorer data contract)
- `src/services/discovery/metaCollector/metaCollectorConfig.ts` (cross-platform path resolution)
- `src/services/discovery/metaCollector/metaCollectorTypes.ts` (protocol schemas and types)
- `src/services/discovery/metaCollector/metaCollectorMcpClient.ts` (stdio MCP client with 7 methods)
- `src/services/discovery/normalization/normalizeMetaCollectorAd.ts` (strict Meta normalizer)
- `src/services/discovery/providers/metaAdsCollectorProvider.ts` (AdDiscoveryProvider implementation)
- `src/app/api/v1/discovery/meta/requests/route.ts` (POST / GET research requests)
- `src/app/api/v1/discovery/meta/requests/[id]/route.ts` (GET request details)
- `src/app/api/v1/discovery/meta/requests/[id]/ads/route.ts` (GET run-specific ads)
- `src/app/api/v1/discovery/meta/requests/[id]/cancel/route.ts` (POST cancellation)
- `src/app/api/v1/discovery/meta/requests/[id]/retry/route.ts` (POST retry)
- `src/app/api/v1/discovery/meta/provider/health/route.ts` (GET provider health)
- `tests/unit/metaCollectorProvider.test.ts` (unit tests for provider contract)
- `tests/unit/metaCollectorNormalization.test.ts` (unit tests for normalization & provenance)
- `tests/integration/metaDiscoveryIngestion.test.ts` (integration tests for deduplication & DiscoveryRunAd)
- `docs/V11_BASELINE_AUDIT.md`
- `docs/V11_DATA_MIGRATION_AUDIT.md`
- `docs/V11_META_COLLECTOR_FINAL_ACCEPTANCE.md` (this report)

#### B. Modified Files
- `package.json` (added `@modelcontextprotocol/sdk`, `meta:doctor`, `meta:once`, `meta:test`; removed `muse:gateway`, `muse:tunnel`)
- `.env.example` (replaced Muse token config with MetaAdsCollector settings)
- `.gitignore` (added `.venv`, `data/`, `.meta-ads-collector-mcp/`, `backups/`)
- `prisma/schema.prisma` (added `DiscoveryRunAd` and relations)
- `src/services/discovery/types.ts` (removed Muse execution modes)
- `src/services/discovery/providerRegistry.ts` (registered `meta-ads-collector`, removed `muse-ad-library` as default)
- `src/services/discovery/discoveryIngestionService.ts` (cross-provider deduplication & `DiscoveryRunAd` insertion)
- `src/services/discovery/discoveryOrchestrator.ts` (enabled local execution for `meta-ads-collector`)
- `src/workers/discoveryWorker.ts` (dynamic scheduled platform selection)
- `src/services/discovery/normalization/normalizeFacebookAd.ts` (neutral helpers & re-exports)
- `src/components/ads/AdCard.tsx` (typed AdViewModel, honest scores & FB ID)
- `src/components/ads/AdDetailDrawer.tsx` (neutral provenance text)
- `src/app/meta-discovery/page.tsx` (new local Meta research dashboard)
- `src/app/explorer/page.tsx` (requestId URL filter support & banner)
- `src/app/api/v1/evergreen/ads/route.ts` (requestId, keyword, category filtering returning AdViewModel)

#### C. Deleted Legacy Muse Files
- `src/services/discovery/muse/museBridgeService.ts`
- `src/services/discovery/muse/museRequestService.ts`
- `src/services/discovery/muse/museResultSubmissionService.ts`
- `src/services/discovery/providers/museAdLibraryProvider.ts`
- `src/services/security/museAuth.ts`
- `src/server/museGateway.ts`
- `src/app/api/v1/discovery/muse/agent/heartbeat/route.ts`
- `src/app/api/v1/discovery/muse/agent/requests/route.ts`
- `src/app/api/v1/discovery/muse/agent/requests/[id]/route.ts`
- `src/app/api/v1/discovery/muse/agent/requests/[id]/results/route.ts`
- `src/app/api/v1/discovery/muse/bridge/route.ts`
- `src/app/api/v1/discovery/muse/requests/route.ts`
- `src/app/api/v1/discovery/muse/requests/[id]/route.ts`
- `src/app/api/v1/discovery/muse/requests/[id]/import/route.ts`
- `src/app/api/v1/discovery/muse/requests/[id]/results/route.ts`
- `scripts/muse-gateway.ts`
- `scripts/muse-tunnel.ts`
- `scripts/verify-v10-e2e.ts`
- `tests/integration/museGateway.test.ts`
- `tests/integration/museQueueApi.test.ts`
- `tests/unit/museDiscovery.test.ts`

---

### 4. Verification & Test Results

#### A. Static Compilation & Lint
- `npx tsc --noEmit`: **0 errors (Exit code 0)**
- `npm run build` (Turbopack): **Compiled successfully in 1.4s (39 routes, 0 errors, 0 warnings)**

#### B. Vitest Automated Test Suite
- Command: `npm test`
- Results: **22 test files passed (22 of 22), 228 tests passed (228 of 228), 0 failed**
  - `tests/unit/metaCollectorProvider.test.ts`: 4 passed
  - `tests/unit/metaCollectorNormalization.test.ts`: 8 passed
  - `tests/integration/metaDiscoveryIngestion.test.ts`: 2 passed
  - All existing TikTok and evergreen tests preserved and passing without regressions.

#### C. Provider Diagnostics (`npm run meta:doctor`)
- Python Binary: `services/meta-ads-collector/.venv/Scripts/python.exe` (FOUND)
- MCP Handshake: `SUCCESS`
- Collector Version: `1.7.0`
- Available Tools: `discover`, `advertisers`, `search`, `continue_search`, `inspect_ads`, `results`, `export_results`, `jobs`, `monitoring`, `proxy`
- Database: `CONNECTED`
- Status: `MetaAdsCollector is ready for research.`

#### D. Live Source Verification & Relational Integrity (`npm run meta:test`)
- **Query:** `pet hair remover`, Market: `US`, Status: `ACTIVE`, Requested: 5 ads
- **Upstream Latency:** 3,807ms
- **Source Verification:** 5 genuine public Meta Ad Library advertisements retrieved
- **Verified Sample Library IDs:**
  1. `1536941208479218` (Advertiser: Uproot Clean, Page ID: 104145318412873)
  2. `1464108218882438` (Advertiser: Uproot Clean, Page ID: 104145318412873)
  3. `1133000522848754` (Advertiser: Uproot Clean, Page ID: 104145318412873, Headline: "The #1 Pet Hair/Lint/Dust Cleaner")
  4. `1641348457417375` (Advertiser: Uproot Clean, Page ID: 104145318412873)
  5. `2249466188957796` (Advertiser: Uproot Clean, Page ID: 104145318412873)
- **First Run Database Ingestion:**
  - `DiscoveryRun ID`: `cmvlsqygr0001awor55ojbaqi`
  - `Ingested Unique`: 5
  - `Duplicates`: 0
  - `DiscoveryRunAd` links: 5 rows created with `ingestOutcome: NEW`
- **Second Run Deduplication Proof:**
  - `DiscoveryRun ID`: `cmvlsrtom00016oorp8elbhsw`
  - `Ingested Unique`: 0
  - `Updated Duplicates`: 5
  - `DiscoveryRunAd` links: 5 rows created with `ingestOutcome: EXISTING`
  - Total ads in database remained constant (no duplicate rows created).
- **Explorer Filtering Proof:**
  - Query: `where: { runAds: { some: { runId: 'cmvlsqygr0001awor55ojbaqi' } } }`
  - Result: Returned exactly the 5 ads from that run. Zero unrelated seed or Bleame ads appeared.

---

### 5. Operational Runbook

#### Setup (Once)
```bash
# macOS / Linux
bash scripts/meta-collector-setup.sh

# Windows
pwsh scripts/meta-collector-setup.ps1
```

#### Verification
```bash
npm run meta:doctor
npm run meta:test
```

#### Application Workflow
```bash
# Terminal 1: Next.js Web App
npm run dev

# Terminal 2: Authoritative Discovery Worker
npm run discovery:worker

# Optional: Run a single queued job manually
npm run meta:once
```

---

### 6. Remaining Upstream Limitations
1. **Unauthenticated CDN Media Expiration:** Meta Ad Library direct image/video CDN URLs expire within several days. SWAI marks media availability as `RESTRICTED` and provides direct links to the public Ad Library page (`https://www.facebook.com/ads/library/?id=<ID>`).
2. **US Commercial Ad Metrics:** Meta Ad Library does not publish spend, impressions, ROAS, or conversions for US commercial advertisements. SWAI enforces strict omission of these fields rather than synthesizing estimates.
3. **Automated Source Barriers:** If Meta presents an interactive challenge or temporary rate-limit, SWAI reports `BLOCKED_SOURCE` or `RATE_LIMITED` honestly without attempting evasion. Manual ad import remains available as a fallback.

---

### 7. Rollback Procedure
If rollback to the pre-migration state is required:
1. Stop any running dev servers or workers.
2. Restore database backup:
   ```bash
   cp backups/v11_pre_migration_2026-10-24T02-25-08-507Z.db dev.db
   ```
3. Checkout base commit:
   ```bash
   git switch master
   ```
