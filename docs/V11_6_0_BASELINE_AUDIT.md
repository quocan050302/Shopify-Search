# SWAI V11.6.0 — BASELINE AUDIT REPORT
## LIVE META COLLECTION VERIFICATION & NON-BREAKING REPAIR

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Version:** V11.6.0 — Live Meta Collection Verification  
**Repository:** `quocan050302/Shopify-Search`  
**Branch:** `feature/v11-meta-collector-remove-muse`  
**Audited Baseline SHA:** `8042e3e5f1904147fc342ca009b8dd2b77457803`  
**Execution Timestamp:** 2026-10-25T15:20:00Z  

---

## 1. Actual HEAD & Working Tree Status

- **Git HEAD:** `8042e3e5f1904147fc342ca009b8dd2b77457803`
- **Branch:** `feature/v11-meta-collector-remove-muse`
- **Working Tree:** Clean (`git status --short` returned 0 modified files)
- **Upstream Sync:** Fully synchronized with `origin/feature/v11-meta-collector-remove-muse`

---

## 2. Existing MetaAdsCollector Implementation & Runtime Configuration

- **Installed Collector Package:** `meta-ads-collector==1.7.0`
- **MCP Protocol Implementation:** `mcp==2.3.0`
- **Python Virtual Environment:** `services/meta-ads-collector/.venv/` (Python 3.10+, verified operational)
- **Data Directory:** `services/meta-ads-collector/data/`
- **Transport:** Standard input/output (`stdio`) via `StdioClientTransport`
- **Capabilities Verified:**
  - `extension_version`: `0.1.0`
  - `collector_version`: `1.7.0`
  - `transport`: `stdio`
  - `persistent_worker_alive`: `true`
  - `operations`: `discover`, `advertisers`, `search`, `continue_search`, `inspect_ads`, `results`, `export_results`, `jobs`, `monitoring`, `proxy`
  - `supported.ad_types`: `ALL`, `CREDIT_ADS`, `EMPLOYMENT_ADS`, `HOUSING_ADS`, `POLITICAL_AND_ISSUE_ADS`
  - `supported.statuses`: `ACTIVE`, `ALL`, `INACTIVE`
  - `supported.search_types`: `KEYWORD_EXACT_PHRASE`, `KEYWORD_UNORDERED`, `PAGE`
  - `limits`: `default_batch: 20`, `maximum_batch: 100`, `maximum_meta_page: 30`, `max_concurrency: 2`

---

## 3. Source Transport & Verification Outcome (Read-Only Probe)

A controlled, bounded read-only probe (`npm run meta:test`) was executed against the public Meta Ad Library:
- **Target Keyword:** `pet hair remover`
- **Target Market:** `US`
- **Budget:** `5 ads`
- **Query Duration:** `4382ms`
- **Upstream Job ID:** `a01e83aa4c9540369a8000a440e35c39`
- **Ads Returned:** `5 of 5 valid ads`
- **Discovered Advertisers:** `Uproot Clean` (Page ID `104145318412873`)
- **Sample Verified Ad IDs:** `1536941208479218`, `1464108218882438`, `1133000522848754`, `1641348457417375`, `2249466188957796`
- **Database Mutation:** 0 (zero database writes in read-only probe)
- **Session Cleanup:** Closed cleanly

---

## 4. User Scenario Live Probe (`gadget`, US, 25 Ads)

Direct MCP execution was also validated for the target production scenario:
- **Target Query:** `gadget`
- **Target Market:** `US`
- **Max Results:** `25`
- **Result-Set ID:** `cff95ce527e84a8383b3136567b2d19b`
- **Upstream Job State:** `LIMIT_REACHED`
- **Upstream Requests Made:** `3`
- **Upstream Pages Fetched:** `3`
- **Ads Collected:** `25`
- **Duration:** `9.18s`
- **Sample First Ad:** ID `908825735077255`, Page `Health & Science`
- **Outcome:** Proven genuine upstream collection capability without source blocks.

---

## 5. Worker Execution & Database Safety Contract

- **Worker Implementation:** `src/workers/discoveryWorker.ts` and `scripts/discovery-worker.ts`
- **Lease & Fencing:** Atomic SQLite job claiming via `discoveryOrchestrator.claimPendingDiscoveryJob()`
- **Heartbeat:** `sync_jobs` row with `jobType: "DISCOVERY_WORKER_HEARTBEAT"`, checked by health endpoints
- **Database Safety Guard:** Strict fail-closed isolation via `assertSafeTestDatabase()`. Test and validation processes are strictly forbidden from writing to or modifying the active development database (`dev.db`).

---

## 6. Existing Test & Acceptance Baseline

- **Test Suite (`npm test`):** 88 test files, 752 unit/integration tests passing.
- **Worker Concurrency (`npm run kh01:test:concurrency`):** 9/9 passing.
- **Continuous Research Journey (`npm run kh01:test:journey`):** 8/8 passing.
- **Full Acceptance Suite (`npm run kh01:acceptance:full`):** 13/13 stages passing.

---

## 7. Identified Gaps & Non-Breaking Repair Plan

1. **Section 09 & 10 (Provenance Correctness):**
   In `src/services/discovery/providers/metaAdsCollectorProvider.ts`, `upstreamReq` was previously assigned a static boolean `true` and `upstreamResp = rawAds.length > 0`.
   *Repair:* Propagate factual upstream execution metadata from the actual MCP response (`mcpResponse.job.stats.requests_made > 0`, `mcpResponse.job.stats.ads_collected > 0`, `caps.transport === "stdio"`).
2. **Section 09 (Live Source Result Inspector):**
   Add `inspectLiveMetaSourceResult()` helper to validate structured upstream evidence, detect fixtures vs genuine ads, check library ID uniqueness, and classify provenance without guessing.
3. **Section 12 (Dedicated Live Journey Script):**
   Create `scripts/meta-live-journey.ts` implementing the complete end-to-end flow:
   - Validates live source mode.
   - Spawns isolated SQLite database.
   - Starts real Next.js server on loopback with local desktop auth.
   - Submits real research request `POST /api/v1/discovery/meta/requests` (`gadget`, US, 25 ads).
   - Starts real Discovery Worker to claim and execute the job.
   - Verifies SQLite persistence and run-ad associations.
   - Verifies HTTP readback (`/api/v1/discovery/meta/requests/{runId}` and `/ads`).
   - Verifies Chromium browser rendering and captures screenshots.
   - Produces atomic evidence bundle in `artifacts/v11.6.0/<runId>/`.
4. **Zero Regressions:**
   Ensure `npm test`, `kh01:test:concurrency`, `kh01:test:journey`, and `kh01:acceptance:full` remain 100% green.
