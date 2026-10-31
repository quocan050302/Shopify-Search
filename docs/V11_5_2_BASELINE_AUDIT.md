# SWAI V11.5.2 — Baseline Audit & Technical Defect Matrix

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Release:** V11.5.2 (Final KH-01 Security, Runtime & Release Acceptance)  
**Specification:** KH-01  
**Operating Mode:** `RESEARCH_ONLY`  
**Repository:** `quocan050302/Shopify-Search`  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Starting Commit SHA:** `ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32`  
**Evaluation Date:** October 2026  
**Auditor:** Coordinated Staff Engineering & Release Team  

---

## 1. Executive Summary

SWAI V11.5.1 resolved critical cross-tenant exposure in Global Search, prevented form input loss on failure, introduced dynamic budget calculations, implemented exact run Explorer URLs, and eliminated inherited acceptance gate passes.

However, an in-depth audit of the codebase at commit `ab409d2` identifies six remaining architectural, security, and runtime defects that must be closed in V11.5.2 to achieve verifiable final KH-01 acceptance:

1. **Unsafe Loopback Authentication Trust Boundary (P1 Security):**
   `src/services/security/adminAuth.ts` uses `isDemonstrablyLocalLoopback()` by evaluating `Host`, `x-forwarded-for`, and `x-real-ip`. While spoofed forwarded headers from known proxies are checked, client-supplied headers alone should not serve as an authentication boundary. A server-controlled deployment policy (`resolveTrustedRequestContext`, `isTrustedLocalDeployment`) must be established to separate transport trust, administrator authentication, and workspace authorization.

2. **Legacy Ads API Cross-Tenant Exposure (P1 Security):**
   `src/app/api/v1/ads/route.ts` `GET` still calls `searchCompetitorAds()` without passing the authorized caller's `workspaceId`. Furthermore, `POST` import does not enforce workspace scoping or relational ownership links.

3. **Explorer Exact Run 30-Day Filtering Conflation (P1 Data Integrity):**
   In `src/app/explorer/page.tsx`, `ExplorerContent` unconditionally initializes `researchMode = "NEWLY_LAUNCHED"` and `launchWithinDays = "30"`. When opening `/explorer?platform=META&requestId=RUN_ID`, this silently filters out older advertisements (>30 days) or ads with unknown launch dates that were legitimately captured during that research run. Exact-run view must show 100% of run-associated records.

4. **Ambiguous API Error Semantics on Unauthorized Runs (P2 API Semantics):**
   In `src/app/api/v1/evergreen/ads/route.ts`, requesting an unauthorized foreign workspace run or a nonexistent run returns HTTP 200 with an empty array. This conflates a run with zero ads with unauthorized / nonexistent runs. A unified `resolveAuthorizedDiscoveryRun(runId, context)` helper must normalize error handling (404/403 vs 200).

5. **Readiness-Aware Form Submission & Action Derivation (P2 UX & Runtime):**
   `MetaResearchForm.tsx` buttons can remain active or submit even when the collector is in `UNKNOWN`, `LOADING`, or `SETUP_REQUIRED` state. An explicit `deriveResearchAction(readiness)` policy must govern user actions, and the backend POST API must enforce matching capability validation.

6. **Acceptance Runner Live Source Classification & Test Identity (P1 Acceptance Truthfulness):**
   `scripts/kh01/runFullAcceptance.ts` still contains a legacy fallback in `verifyLiveMetaSource()` that treats HTML length > 500 as proof of advertising extraction. Furthermore, test matching in Vitest reports uses substring matching (`key.includes`) rather than canonical test identities (`testFile + fullName`), and lacks an authoritative gate registry (`src/lib/kh01/acceptanceGateRegistry.ts`).

---

## 2. Master Function Repair Matrix

| File Path | Existing Function | Current Defect / Responsibility | V11.5.2 Required Repair |
| :--- | :--- | :--- | :--- |
| `src/services/security/adminAuth.ts` | `isDemonstrablyLocalLoopback()` | Relies on HTTP headers (`Host`, `x-forwarded-for`) | Replace with server-controlled local deployment detection (`isTrustedLocalDeployment`, `resolveTrustedRequestContext`) |
| `src/services/security/adminAuth.ts` | `validateAdminRequest()` | Combines loopback bypass and secret validation | Implement `resolveAdminPrincipal`, fail closed when network-accessible |
| `src/services/security/adminAuth.ts` | `requireAdminAuth()` | Enforces admin check | Return 401/403 strictly; protect all sensitive mutations |
| `src/app/api/v1/ads/route.ts` | `GET()` | Missing workspace scoping | Require `resolveAuthorizedResearchContext(request)` and pass `workspaceId` |
| `src/app/api/v1/ads/route.ts` | `POST()` | Unscoped import | Enforce authorized workspace and relational ownership link |
| `src/services/ads/adService.ts` | `searchCompetitorAds()` | Accepts optional `workspaceId` | Audit all call sites; enforce workspace constraint on protected calls |
| `src/app/explorer/page.tsx` | `ExplorerContent()` | Hardcodes `launchWithinDays=30` | Separate `EXACT_RUN` mode from `RESEARCH` mode; eliminate default 30-day filter |
| `src/app/explorer/page.tsx` | `fetchAds()` | Single fetch path | Branch into exact-run fetch (calling canonical run ads endpoint) vs research fetch |
| `src/app/api/v1/evergreen/ads/route.ts` | `GET()` | Returns 200 with `[]` for foreign run | Use `resolveAuthorizedDiscoveryRun`: return 404/403 for unauthorized runs |
| `src/components/meta/MetaResearchForm.tsx` | `handleSubmit()` | Submits regardless of readiness | Enforce `deriveResearchAction(readiness)`; block submit on UNKNOWN/LOADING |
| `src/lib/meta/normalizeMetaHealth.ts` | `normalizeMetaHealth()` | Status classification | Structure `CollectorHealthEvidence`; distinguish unverified from live-verified |
| `scripts/kh01/runFullAcceptance.ts` | `verifyLiveMetaSource()` | HTML length > 500 = PASSED | Execute real MCP collector when opted in; classify `NOT_RUN` honestly without fabricating data |
| `scripts/kh01/runFullAcceptance.ts` | `parseVitestJsonAssertions()` | Substring title matching | Exact matching with `testFile + fullName`; prevent stale report reuse |

---

## 3. Database Safety Plan

- **Active Database:** `prisma/dev.db` (and `DATABASE_URL="file:./dev.db"`).
- **Test Database:** Ephemeral SQLite databases created in `os.tmpdir()/swai-vitest-isolated/...` via `tests/setupTestEnvironment.ts`.
- **Invariants:**
  1. No migrations or schema drops will be executed against `dev.db`.
  2. No existing `DiscoveryRun`, `DiscoveryRunAd`, or `CompetitorAd` records will be deleted.
  3. All new tests must use isolated test contexts or mock fixtures.

---

## 4. Planned New Test Files

1. `tests/unit/adminAuthTrustBoundary.test.ts`
2. `tests/integration/adminAccessSecurity.test.ts`
3. `tests/integration/legacyAdsWorkspaceIsolation.test.ts`
4. `tests/integration/exactRunCompleteness.test.ts`
5. `tests/unit/researchActionPolicy.test.ts`
6. `tests/integration/metaReadinessSubmission.test.ts`
7. `tests/integration/metaLiveReconciliation.test.ts`
8. `tests/unit/kh01AcceptanceTruthfulness.test.ts`
9. `tests/e2e/exactRunExplorerAcceptance.test.ts`
10. `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`
