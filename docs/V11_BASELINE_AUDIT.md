# SWAI V11.0 — Baseline Audit Report
**Date:** 2026-10-24  
**Feature Branch:** `feature/v11-meta-collector-remove-muse`  
**Base Commit / HEAD SHA:** `67e9a129c3bfcefad63edee7ab8252cff599c622`  
**Upstream Remote:** `https://github.com/quocan050302/Shopify-Search.git` (origin/master)

---

## 1. Environment & System Baseline

| Component | Detected Version / Status |
| :--- | :--- |
| **Operating System** | Windows (Dev target environment with full cross-platform compatibility for macOS) |
| **Node.js Runtime** | `v22.14.0` |
| **npm Version** | `11.1.0` |
| **Python Runtime** | `Python 3.11.9` (meets Python 3.10+ requirement for MetaAdsCollector MCP) |
| **Next.js Version** | `16.4.2` (React 19.3.0) |
| **Prisma ORM** | `7.10.1` (`@prisma/adapter-libsql`, `@libsql/client 0.18.0`) |
| **TypeScript** | `^5` |
| **Working Tree Status** | Clean on branch `feature/v11-meta-collector-remove-muse` |

---

## 2. Database Baseline & Configuration

- **Database Engine:** SQLite via `@libsql/client` and `@prisma/adapter-libsql`
- **Configured `DATABASE_URL`:** `file:./dev.db`
- **Resolved Absolute Path:** `D:/Project_github/Running-Ads/dev.db` (585,728 bytes)
- **Pre-Migration Backup:** `D:/Project_github/Running-Ads/backups/v11_pre_migration_2026-10-24T02-21-45-623Z.db` (581,632 bytes)
- **Integrity Check:** `PRAGMA integrity_check` -> `ok`
- **Active Record Inventory:**
  - `Workspace`: 1
  - `CompetitorAd`: 9 (7 legacy seed/demo, 2 discovery-imported; 0 quarantined)
  - `AdMediaAsset`: 9
  - `AdObservation`: 65
  - `AdSourceIdentity`: 0
  - `DiscoveryRun`: 32 (all 32 `tiktok-topads`)
  - `SyncJob`: 18
  - `ProviderRequestLedger`: 0
  - `DiscoverySchedule`: 11

---

## 3. Migration Scope & Objectives

1. **Remove Old Muse AI Architecture:**
   - External Muse services: `src/services/discovery/muse/*`
   - Provider: `src/services/discovery/providers/museAdLibraryProvider.ts`
   - Security: `src/services/security/museAuth.ts`
   - Gateway/tunnel: `src/server/museGateway.ts`, `scripts/muse-gateway.ts`, `scripts/muse-tunnel.ts`
   - Legacy routes: `src/app/api/v1/discovery/muse/**`
   - Muse-specific tests, scripts, and documentation references
   - Zero tolerance for hardcoded tokens, tunnels, or external agent dependencies

2. **Integrate Self-Hosted MetaAdsCollector MCP:**
   - Upstream Repo: `https://github.com/promisingcoder/MetaAdsCollector` (Target SHA: `a9e5b14673fa41943bb831151700cc4dba1609c5`)
   - Python virtual environment: `services/meta-ads-collector/.venv`
   - Setup script: `scripts/meta-collector-setup.sh` (with cross-platform/PowerShell support)
   - Official MCP client: `src/services/discovery/metaCollector/metaCollectorMcpClient.ts`
   - Provider implementation: `src/services/discovery/providers/metaAdsCollectorProvider.ts`
   - Normalization & deduplication: `src/services/discovery/normalization/normalizeFacebookAd.ts` -> `normalizeMetaCollectorAd`

3. **Database & Orchestrator Evolution:**
   - Add model `DiscoveryRunAd` (`runId` <-> `adId` relational tracking with outcome & provenance)
   - Repair orchestrator (`src/services/discovery/discoveryOrchestrator.ts`) to route `META` queries to `meta-ads-collector`
   - Repair worker (`src/workers/discoveryWorker.ts`) to handle `META` schedules and background runs without platform hardcoding

4. **API & UI Modernization:**
   - New endpoints: `/api/v1/discovery/meta/requests`, `/api/v1/discovery/meta/provider/health`
   - Redesign `/meta-discovery` to show real local MCP status, job creation, and progress
   - Fix `/explorer` and `AdCard` data model mismatch (`AdViewModel`), fix `requestId` filtering to view exact ads from a specific research run
