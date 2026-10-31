# SWAI V11.5.1 — Meta Discovery Verification Report

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Release:** V11.5.1  
**Specification:** KH-01  
**Focus:** Form Resilience, Readiness Classification, Budget Caps & Async Polling  

---

## 1. Defect Fixes & Improvements

### 1.1 Form Input Preservation On Failure
- **Previous Defect:** User inputs (keywords, budget, market) were wiped out immediately on submit even if the server rejected the request or network failed.
- **V11.5.1 Implementation:**
  - Form now awaits `createJob(formData): Promise<CreateResearchResult>`.
  - Only on verified `result.ok === true` with a usable `runId` are keyword inputs cleared.
  - On failure (`result.ok === false`), form fields and advanced options remain completely intact with the server error message rendered in an alert banner.
  - Double-click and rapid keypress submission prevention (`isSubmitting` lock) is active.

### 1.2 Truthful Readiness State Machine
- **Previous Defect:** Null response was conflated with loading, causing infinite spinners on 500 errors. Stale source blockages permanently locked the UI.
- **V11.5.1 Implementation:**
  - Distinct states: `LOADING`, `READY`, `SETUP_REQUIRED`, `WORKER_OFFLINE`, `SOURCE_RESTRICTED`, `DEGRADED`, and `UNKNOWN`.
  - Added `deriveLatestSourceHealth(lastSuccess, lastFailure)` ensuring newer verified successes supersede older historical errors.
  - Failures to fetch health transition to `UNKNOWN` with an explicit "Check Status / Retry" action rather than an infinite loading state.

### 1.3 Dynamic Collector Budget Options
- **Previous Defect:** Hardcoded options `[10, 20, 25, maxBudget]` allowed options exceeding server capacity or produced invalid dropdown selections when effective budget was below 10.
- **V11.5.1 Implementation:**
  - Implemented `getAllowedResearchLimits(effectiveMax: number): number[]` in `src/lib/meta/getAllowedResearchLimits.ts`.
  - Validated across capacities `[1, 5, 10, 20, 25, 50, 100]`.
  - Guarantees at least one valid selection whenever capacity is positive.

### 1.4 Coordinated Polling & Stale Response Protection
- **V11.5.1 Implementation:**
  - Header search implements `AbortController` cancellation for superseded requests.
  - Polling coordinates health and jobs fetching, pausing when document visibility is hidden and resuming when visible.

### 1.5 Server-Side Pagination & Full Job Search
- **V11.5.1 Implementation:**
  - Upgraded `/api/v1/discovery/meta/requests` to accept `page`, `pageSize`, `query`, and `status`.
  - Filtering occurs in Prisma before pagination, returning accurate `total` and `totalPages`.
  - `MetaJobsTable.tsx` displays proper pagination controls (`Showing 1–10 of 12 jobs`, `Previous`, `Next`).

---

## 2. Automated Test Results

| Test File | Description | Count | Result |
| :--- | :--- | :---: | :---: |
| `tests/unit/allowedResearchLimits.test.ts` | Budget tier computation across capacities 1 to 100 | 9 | **9/9 PASSED** |
| `tests/unit/metaReadiness.test.ts` | Readiness state mapping & `UNKNOWN` on failure | 8 | **8/8 PASSED** |
| `tests/unit/metaResearchForm.test.ts` | Form input validation & whitespace normalization | 6 | **6/6 PASSED** |
| `tests/unit/metaJobStatus.test.ts` | Job lifecycle status mapping | 6 | **6/6 PASSED** |
| `tests/integration/metaRunAdsIsolation.test.ts` | API discovery request creation & pagination readback | 5 | **5/5 PASSED** |

---

## 3. Verdict
All Meta Discovery functional and UX repair objectives are complete and verified.
