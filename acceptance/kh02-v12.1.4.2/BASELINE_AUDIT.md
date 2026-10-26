# SWAI KH-02 V12.1.4.2 — BASELINE AUDIT

**Audit Date:** 2026-10-26T21:26:00Z  
**Repository:** `quocan050302/Shopify-Search`  
**Mandatory Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Starting Commit SHA:** `ee797389e29620ab20df24649769515a7ba91c7d`  
**Protected Reference (origin/QA) SHA:** `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`  
**Target Release Version:** `KH-02 V12.1.4.2`  

---

## 1. Executive Summary & Defect Characterization

When a user opens `http://127.0.0.1:3000/products` and analyzes an evergreen niche (e.g., `Niche: Pet Gadgets`, `Market: United States`, `Lookback: 90D`), the application fails with:
```text
Research execution timed out waiting for worker snapshot.
```

Concurrently, the provider status indicators display:
```text
Meta Ads: Not Configured
TikTok Ads US: Not Verified
TikTok Organic: Not Configured
Google Ads: Not Configured
Demand History: Configured
```

### 1.1 Root Causes Identified

1. **Frontend Polling & Execution Decoupling Defect (`src/app/products/page.tsx`):**
   - `pollJobExecution` contains a rigid `maxAttempts = 60` loop with a 1-second delay (`await new Promise((r) => setTimeout(r, 1000));`).
   - If the research execution exceeds 60 seconds (typical for broad 90D/365D queries across 4 platforms), or if the worker is not running, the frontend throws `Research execution timed out waiting for worker snapshot.`, marking the frontend UI state as failed even though the background backend job is still validly queued or running.
   - On page refresh or navigation, active research state is completely lost from UI tracking.

2. **Process Architecture & Worker Supervision Defect:**
   - In local development (`npm run dev`), `scripts/startSwaiServer.ts` only launches the Next.js process (`next dev`).
   - The KH-02 worker resides in a separate process (`src/workers/kh02Worker.ts` invoked via `npm run kh02:worker`).
   - Unless the developer or user runs `npm run kh02:worker` in a separate terminal, enqueued jobs remain permanently `PENDING`.
   - Furthermore, `getResearchWorkerHealth()` only returned in-memory process-local state (`isRunning`, `activeJobId`, `lastHeartbeat`). The Next.js HTTP server process cannot observe worker liveness across processes.

3. **Status Badges & Readiness Classification Defect:**
   - Backend `checkKH02ProviderReadiness` returns `SOURCE_ACCESS_VERIFIED` for Meta Ads (indexed in database).
   - In `products/page.tsx`, `getSourceBadge` only matched `SOURCE_DATA_VERIFIED`, `PASSED`, `CONFIGURED`, and `NOT_VERIFIED`. Because `SOURCE_ACCESS_VERIFIED` was unhandled, it fell through to default `Not Configured`.
   - TikTok Ads US has no live automated scraper; it queries existing stored competitor ads in SQLite. This must be truthfully labeled `Manual Research Only` / `Database Readback`.
   - TikTok Organic requires `HASDATA_API_KEY` or `TIKTOK_ORGANIC_API_KEY`. Without credentials, it should truthfully report `API Credentials Required`.
   - Google Ads Transparency requires MCP server configuration (`GOOGLE_TRANSPARENCY_MCP_URL`). Without it, it should truthfully report `MCP Not Configured`.
   - Demand History engine is configured, but product-level demand history requires temporal observation evidence.

---

## 2. Code Dependencies & Baseline Test State

### 2.1 Git Preflight
- Branch: `feature/kh02-v12.1.3-runtime-truth-closure` (verified)
- Working tree: Clean
- Remote origin: Synced at `ee797389e29620ab20df24649769515a7ba91c7d`
- `origin/QA`: `ea2a236401eaa9e5fe48cd1a2d4724b7c8426a76`

### 2.2 KH-01 Protection Verification
- Command: `npm run kh01:verify`
- Result: **PASS** (69 passed out of 69 tests across 5 test files)
  - `tests/integration/kh01ProductIntelligenceWorkspace.test.ts` (2 tests)
  - `tests/unit/kh01Security.test.ts` (30 tests)
  - `tests/unit/kh01EconomicsOpportunity.test.ts` (18 tests)
  - `tests/unit/kh01LandingPage.test.ts` (8 tests)
  - `tests/unit/kh01ProductOffer.test.ts` (11 tests)
- **Zero regression policy on KH-01 maintained.**

### 2.3 KH-02 Unit Test Baseline
- Command: `npm run kh02:test:unit`
- Result: **PASS** (89 passed out of 89 tests across 11 test files)
  - `tests/unit/kh02V12_1_3_Ownership.test.ts` (5 tests)
  - `tests/unit/kh02V12_1_4_AtomicCas.test.ts` (7 tests)
  - `tests/unit/kh02V12_1_4_1_HeartbeatRetry.test.ts` (7 tests)
  - `tests/unit/kh02V12_1_1_Runtime.test.ts` (20 tests)
  - `tests/unit/kh02V12_1_P0.test.ts` (8 tests)
  - `tests/unit/kh02V12_1_4_1_Reconciliation.test.ts` (16 tests)
  - `tests/unit/kh02V12_1_2_RuntimeOwnership.test.ts` (9 tests)
  - `tests/unit/kh02SourceAdapters.test.ts` (4 tests)
  - `tests/unit/kh02ProductIdentity.test.ts` (2 tests)
  - `tests/unit/kh02EvergreenScoring.test.ts` (6 tests)
  - `tests/unit/kh02TemporalDemand.test.ts` (5 tests)

---

## 3. Detailed Change Plan for V12.1.4.2

1. **Part C & D: Research Execution Architecture & Resilient Polling:**
   - Decouple frontend observation timeout from backend job execution.
   - Implement `useKH02ResearchJob` hook / state machine in `src/app/products/page.tsx` that persists active `runId` in session/local storage, recovers on page mount/reload, handles transient network issues, and displays human-readable research stages (`QUEUED`, `WAITING_FOR_WORKER`, `COLLECTING_ADS`, `SCORING`, `SAVING_RESULTS`).
   - If research takes > 60 seconds, display non-terminal status: `"Research is still running in the background. You can leave this page and return later."`
   - Update `getKH02ResearchRunById` and `src/app/api/v1/kh02/research/runs/[runId]/route.ts` to return `errorMessage`, `startedAt`, `completedAt`, and `stage`.
   - Add endpoint `GET /api/v1/kh02/research/active` to query any active/running jobs for the authorized workspace.

2. **Part E: Shared Observable Worker Health & Supervision:**
   - Persist KH-02 worker heartbeats in SQLite via `SyncJob` with `jobType: "KH02_WORKER_HEARTBEAT"` (following the established KH-01 pattern).
   - Implement `getSharedResearchWorkerHealth()` reading the authoritative DB heartbeat record, returning `ALIVE` (< 30s), `STALE` (< 60s), or `OFFLINE` (> 60s).
   - Expose `GET /api/v1/kh02/worker/status` returning observable health and queue metrics.
   - In `products/page.tsx`, if a job is `PENDING` and no worker is alive, immediately show: `"Research queued — worker not running. Please start 'npm run kh02:worker'."`
   - In `scripts/startSwaiServer.ts`, add option / local dev support to optionally supervise the worker process cleanly.

3. **Part G, H, I, J, K, L, M: Source Diagnostics, Auto-Setup & Truthful Badges:**
   - Implement `diagnoseKH02Source` and `testKH02SourceConnection` in `src/services/kh02/providers/sourceRegistry.ts`.
   - Expose `POST /api/v1/kh02/providers/test-connection` with allowlist and zero-cost protection (`AUTO_PAID_RESEARCH=false`).
   - Fix Meta Ads badge mapping in `src/app/products/page.tsx` (`SOURCE_ACCESS_VERIFIED` -> `"Source Available"` / `"Connected"`).
   - Truthfully report TikTok Ads US as `"Manual Research Only"` / `"Database Readback"` when no live scraper is configured.
   - Truthfully report TikTok Organic as `"API Credentials Required"` when `HASDATA_API_KEY` is missing.
   - Truthfully report Google Ads Transparency as `"MCP Not Configured"` when MCP is not available.
   - Truthfully report Demand History as `"Engine Ready (Need Observations)"`.
   - Add "Test Connection" and "Check All Sources" actions to the UI.

4. **Part F: Large Niche Research Bounded Execution:**
   - In `src/services/kh02/evergreenResearchOrchestrator.ts`, enforce per-source timeouts, page caps, candidate bounds, and graceful partial provider degradation.

5. **Part P & Q: Full Acceptance & Regression Verification:**
   - Write comprehensive unit, integration, and E2E tests for worker health, long-running job tracking, reload recovery, and source diagnostics.
   - Build `scripts/kh02/runAcceptanceV12_1_4_2.ts` validating all Gates A through AD.
   - Commit and push to `feature/kh02-v12.1.3-runtime-truth-closure`.
