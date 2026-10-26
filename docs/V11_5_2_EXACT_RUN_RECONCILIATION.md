# SWAI V11.5.2 — Exact Research Run Reconciliation & Completeness Report

**Release**: V11.5.2  
**Target Specification**: KH-01 Section 07 & 08  
**Tested Baseline**: `ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Application Mode**: `RESEARCH_ONLY` (US Market)

---

## 1. Executive Summary

In previous versions, opening an exact research run (`/explorer?platform=META&requestId=RUN_A`) applied discovery research ranking filters by default (`researchMode = "NEWLY_LAUNCHED"` and `launchWithinDays = "30"`). Consequently, authentic advertisements that were collected in that run but launched more than 30 days prior (or with an unknown launch date) were silently hidden.

V11.5.2 establishes a strict architectural separation between **Exact Run Results Mode** and **Discovery Research Mode**, guaranteeing 100% completeness and verifiable count reconciliation.

---

## 2. Architectural Separation

```
URL Query Parameters
  │
  ├── Has `requestId` ──> EXACT_RUN Mode
  │                         ├── Calls `/api/v1/discovery/meta/requests/:id/ads`
  │                         ├── Disables 30-day age filtering
  │                         ├── Preserves 90d, 180d, and unknown-date records
  │                         ├── Renders single consolidated `ExactRunContextBanner`
  │                         └── Provides clean `Exit Run View` button
  │
  └── No `requestId`  ──> RESEARCH Mode
                            ├── Calls standard Discovery / Evergreen endpoints
                            ├── Applies mode filters (Newly Launched, Trending, Evergreen)
                            └── Evaluates winning potential scores
```

---

## 3. Data Integrity & Invariants

1. **Retention of Older Ads**: Advertisements with `daysRunning = 180` and `firstSeenAt = 180 days ago` linked to `DiscoveryRun` via `DiscoveryRunAd` are fully returned and displayed.
2. **Retention of Unknown Launch Dates**: Ads where `firstSeenAt` or `daysRunning` is null or zero are not filtered out.
3. **No Unrelated Fallback**: If an authorized run genuinely contains 0 ads, the endpoint returns HTTP 200 with `data: []`. It never falls back to unrelated ads from the database.
4. **Tenant Isolation**: Attempting to view ads for a run belonging to another workspace returns HTTP 403 `FORBIDDEN_WORKSPACE_RUN`. Nonexistent runs return HTTP 404 `RUN_NOT_FOUND`.
5. **Reconciliation Service**: `reconcileResearchRunCounts(runId)` verifies that:
   $$\text{Retrieved} \ge \text{Valid} = \text{Linked} = \text{Displayed}$$
   Any variance is explicitly categorized (e.g. invalid external IDs, duplicates).

---

## 4. Empirical Test Evidence

### 4.1 Integration Test: `tests/integration/exactRunCompleteness.test.ts`
- **Scenario**: Seeded Run A with 25 linked ads spanning launch ages from 1 day to 180 days, plus ads with unknown launch dates.
- **Results**:
  - `retrieves all 25 linked ads across pagination without 30-day age filtering`: **PASSED** (all 25 IDs retrieved, including 180d and unknown-date ads).
  - `returns 404 for a nonexistent research run`: **PASSED** (HTTP 404, `RUN_NOT_FOUND`).
  - `returns 403 when a foreign workspace attempts to read Run A's ads`: **PASSED** (HTTP 403, `FORBIDDEN_WORKSPACE_RUN`).
  - `returns 200 with empty list for an authorized run that genuinely has 0 ads`: **PASSED** (HTTP 200, `data: []`).
  - `reconciles run counts truthfully across ledger, relations, and display`: **PASSED** (`consistent: true`).

### 4.2 Playwright Browser Tests: `tests/e2e/metaRunExplorer.test.ts` & `tests/e2e/exactRunExplorerAcceptance.test.ts`
- **Scenario**: Real Chromium browser navigating to `/explorer?platform=META&requestId=...`.
- **Results**:
  - `loads Explorer with requestId and shows active exact run scope banner and all ads including 180d and unknown date`: **PASSED**.
  - `clears run-specific view when clicking Exit Run View`: **PASSED**.
  - `handles empty research run truthfully without fallback to unrelated ads`: **PASSED**.

---

## 5. Artifact Reference

- `artifacts/v11.5.2/exact-run-reconciliation.json`
- `artifacts/v11.5.2/browser-results.json`
