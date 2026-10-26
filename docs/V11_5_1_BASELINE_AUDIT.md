# SWAI V11.5.1 — Baseline Audit & Defect Matrix

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Release:** V11.5.1 (Final UX & Integrity Repair)  
**Master Specification:** KH-01  
**Operating Mode:** `RESEARCH_ONLY`  
**Repository:** `quocan050302/Shopify-Search`  
**Working Branch:** `feature/v11-meta-collector-remove-muse`  
**Verified Baseline Git SHA:** `bc6452792de1fc27057e9f3c5ff594f195689bfd`  
**Evaluation Date:** October 2026  
**Auditor:** Coordinated Senior Engineering & Design Team  

---

## 1. Executive Summary

SWAI V11.5 established the architectural foundation, design tokens, modular UI, and basic security fences. However, a rigorous audit of the latest commit (`bc64527`) reveals critical data integrity, workspace authorization, and UX defects that must be resolved in V11.5.1:

1. **Global Search Workspace Exposure (P0 Security):**
   `/api/v1/search` resolves caller context but executes `prisma.researchProduct.findMany` and `searchCompetitorAds` without workspace constraints, leaking cross-tenant data.
2. **Exact Run Results Disconnect (P1 Data Integrity / UX):**
   Clicking "View Ads" on a research job navigates to `/explorer?query=${firstKeyword}` instead of `/explorer?platform=META&requestId=${runId}`. This conflates separate runs that searched for the same keyword and breaks run provenance.
3. **Meta Discovery Lost Input on Failure (P1 UX):**
   `MetaResearchForm.tsx` resets form fields on submit without verifying whether `createJob()` succeeded. On network failure or rejection, user inputs are lost.
4. **Infinite Loading on Health Failure (P2 UX):**
   `normalizeMetaHealth.ts` returns `LOADING` whenever `health` is null, causing an infinite loading spinner when the health check endpoint returns 500 or network drops.
5. **Client-Side-Only Jobs Filtering & Missing True Pagination (P2 Reliability):**
   `useMetaDiscovery.ts` hardcodes `pageSize=50` and filters locally in `MetaJobsTable.tsx`, hiding jobs beyond 50 and making search incomplete.
6. **Acceptance Gate Inheritance Flaw (P1 Acceptance Truthfulness):**
   `scripts/kh01/runFullAcceptance.ts` still defaults `assertionStatus = stageStatus`, which allows a gate to be marked `PASSED` simply because vitest exited 0, even if the specific assertion was missing.
7. **Explorer Unsafe Fallback (P1 Integrity):**
   `src/app/explorer/page.tsx` falls back to general un-scoped ads if an exact run query fails or returns empty.

---

## 2. Confirmed Defect Registry

| Defect ID | Severity | Area | Source Path & Functions Involved | Description & Root Cause |
| :--- | :---: | :--- | :--- | :--- |
| **DEF-1151-01** | **P0** | Global Search Security | `src/app/api/v1/search/route.ts`<br>`GET()` | Products and Ads queries lack `where: { ...workspaceId }` filtering. Returns data from foreign workspaces. |
| **DEF-1151-02** | **P1** | Run Disconnect | `src/components/meta/MetaJobsTable.tsx`<br>`src/components/meta/MetaJobDetailsDrawer.tsx` | View Ads action uses `query=${firstKeyword}` instead of the exact `requestId` (DiscoveryRun ID). |
| **DEF-1151-03** | **P1** | Form Input Loss | `src/components/meta/MetaResearchForm.tsx`<br>`handleSubmit()` | Form fields are wiped before backend responds. On error, inputs are destroyed. |
| **DEF-1151-04** | **P2** | Infinite Loading | `src/lib/meta/normalizeMetaHealth.ts`<br>`normalizeMetaHealth()` | `if (!health \|\| isLoading) return "LOADING"`. Treats failed health fetch as ongoing loading indefinitely. |
| **DEF-1151-05** | **P2** | Budget Hardcoding | `src/components/meta/MetaResearchForm.tsx` | Options hardcoded as `[10, 20, 25, maxBudget]`. When maxBudget < 25, invalid or duplicate choices are rendered. |
| **DEF-1151-06** | **P2** | Jobs Pagination | `src/hooks/useMetaDiscovery.ts`<br>`src/components/meta/MetaJobsTable.tsx` | Fixed 50-job limit; table searches only client-side memory rather than sending `q` and `status` to backend. |
| **DEF-1151-07** | **P1** | Explorer Fallback | `src/app/explorer/page.tsx`<br>`fetchAds()` | When `requestId` returns no ads or fails, it falls back to `/api/v1/ads` without run filter, leaking unrelated ads. |
| **DEF-1151-08** | **P1** | Gate Inheritance | `scripts/kh01/runFullAcceptance.ts`<br>`executeAcceptanceStage()` | Gate evidence inherits process exit code 0 when JSON test title lookup fails. |
| **DEF-1151-09** | **P2** | Race Condition | `src/components/layout/Header.tsx`<br>`handleSearch()` | Debounced search lacks request generation ID / AbortController; fast typing causes out-of-order response overwrites. |
| **DEF-1151-10** | **P2** | Stale Restriction | `src/lib/meta/normalizeMetaHealth.ts` | Historical `lastFailureCategory` permanently restricts status even if subsequent run succeeded. |

---

## 3. Test Coverage Gaps

1. **Global Search Security:** No integration test currently verifies that querying `/api/v1/search` with Workspace A's principal cannot discover Workspace B's products or ads.
2. **Exact Run Isolation:** No test verifies that `/explorer?requestId=RUN_A` returns ONLY RUN_A's ads when RUN_B searched for the exact same keyword.
3. **Form Error Input Preservation:** No unit test verifies that form state is retained when `createJob()` returns an error.
4. **Health State Machine:** No unit tests for transition from `LOADING` to `UNKNOWN` on fetch failure.
5. **Server-Side Pagination:** No integration tests asserting `page`, `pageSize`, and `query` params on `/api/v1/discovery/meta/requests`.

---

## 4. Implementation Plan & Execution Order

- **Phase 1 (Security):** Deliverable A — Scoped Global Search (`buildAuthorizedAdWhere`, `buildAuthorizedProductWhere`, `search/route.ts`).
- **Phase 2 (Form & Readiness):** Deliverable B — `MetaResearchForm.tsx` input preservation, `getAllowedResearchLimits`, `normalizeMetaHealth.ts`, centralized setup commands in `collectorSetupCommands.ts`.
- **Phase 3 (Jobs Pagination & Polling):** Server-side pagination & filtering for Meta Discovery requests, request cancellation in `useMetaDiscovery.ts`, race-condition protection in `Header.tsx`.
- **Phase 4 (Exact Run Results):** Deliverable C — `buildExplorerUrlForRun()`, Explorer run banner, hardening `/api/v1/evergreen/ads/route.ts` and `/api/v1/discovery/meta/requests/[id]/ads/route.ts`, eliminating unsafe fallbacks.
- **Phase 5 (KH-01 Acceptance):** Deliverable D — Granular `GateEvidence` registry, version reconciliation (`11.5.1` / `11.4.5`), robust `verifyLiveMetaSource`.
- **Phase 6 (Browser E2E):** Deliverable E — Playwright suite covering desktop/mobile viewports, capturing 11 required screenshots.
- **Phase 7 (Release Audit):** Verify test results, compile release reports, commit, and push.
