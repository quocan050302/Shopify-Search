# SWAI V11.5.2 — Function-Level Engineering Changelog

**Release**: V11.5.2  
**Target Specification**: KH-01 Security, Runtime & Release Acceptance  
**Starting Commit Baseline**: `ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Operating Mode**: `RESEARCH_ONLY` (US Market)

---

## 1. Summary of Changes

V11.5.2 closes the remaining security vulnerabilities, data integrity flaws, runtime readiness submission guards, and acceptance truthfulness gaps identified in KH-01.

| File Path | Function Name | Type | Nature of Modification |
| :--- | :--- | :--- | :--- |
| `src/services/security/adminAuth.ts` | `isTrustedLocalDeployment` | New | Evaluates server-controlled deployment policy (`SWAI_DEPLOYMENT_MODE`, `SWAI_REMOTE_ACCESS`, cloud flags, public binding `0.0.0.0`). |
| `src/services/security/adminAuth.ts` | `resolveTrustedRequestContext` | New | Evaluates transport trust without trusting client-controlled proxy headers (`x-forwarded-for`, `x-real-ip`). |
| `src/services/security/adminAuth.ts` | `resolveAdminPrincipal` | New | Enforces strict secret comparison and deployment trust; fails closed for remote access attempts. |
| `src/services/security/adminAuth.ts` | `isDemonstrablyLocalLoopback` | Modified | Replaced unsafe client-origin header inference with `resolveTrustedRequestContext`. |
| `src/services/security/adminAuth.ts` | `validateAdminRequest` | Modified | Refactored to delegate to `resolveAdminPrincipal`. |
| `src/services/security/adminAuth.ts` | `requireAdminAuth` | Modified | Enforces 401/403 on credential mutations and sensitive administration. |
| `src/services/ads/adService.ts` | `searchAuthorizedCompetitorAds` | New | Canonical wrapper injecting workspace context into `searchCompetitorAds`. |
| `src/services/ads/adService.ts` | `searchCompetitorAds` | Modified | Combines search predicates and `buildAuthorizedAdWhere(workspaceId)` using `AND` semantics. |
| `src/app/api/v1/ads/route.ts` | `GET` | Modified | Resolves `resolveAuthorizedResearchContext(request)` and restricts query to authorized workspace. |
| `src/app/api/v1/ads/route.ts` | `POST` | Modified | Requires authorized research context; idempotently associates imported ad with workspace watchlist. |
| `src/app/api/v1/ads/[id]/route.ts` | `GET` | Modified | Calls `assertAdWorkspaceAccess(id, researchContext)` to block cross-tenant metadata inspection. |
| `src/services/research/authorizedScopeHelpers.ts` | `resolveAuthorizedDiscoveryRun` | New | Centralized helper resolving run and asserting workspace ownership; throws 404 for missing runs, 403 for foreign runs. |
| `src/services/research/researchAuthService.ts` | `ResearchAuthErrorCode` | Modified | Added `RUN_NOT_FOUND` and `FORBIDDEN_WORKSPACE_RUN` error codes. |
| `src/app/api/v1/evergreen/ads/route.ts` | `GET` | Modified | Replaced silent 200 empty responses with `resolveAuthorizedDiscoveryRun` returning 404/403. |
| `src/app/api/v1/discovery/meta/requests/[id]/ads/route.ts` | `GET` | Modified | Enforces `resolveAuthorizedDiscoveryRun`; canonical source of truth for exact run view. |
| `src/services/research/runReconciliationService.ts` | `reconcileResearchRunCounts` | New | Reads source tables (`DiscoveryRun`, `DiscoveryRunAd`, `CompetitorAd`) to truthfully report run counts. |
| `src/app/explorer/page.tsx` | `resolveExplorerScope` | New | Distinguishes `EXACT_RUN` from `RESEARCH` mode based on URL `requestId`. |
| `src/app/explorer/page.tsx` | `ExactRunContextBanner` | New | Single consolidated banner displaying run ID, count, and clean exit action. |
| `src/app/explorer/page.tsx` | `fetchAds` | Modified | Queries canonical run endpoint `/api/v1/discovery/meta/requests/:id/ads` directly without 30-day cutoff. |
| `src/lib/meta/researchActionPolicy.ts` | `deriveResearchAction` | New | Maps `NormalizedReadiness` to typed `ResearchAction` (`START`, `QUEUE`, `SETUP`, `DIAGNOSTICS`, `WAIT`). |
| `src/components/meta/MetaResearchForm.tsx` | `handleSubmit` | Modified | Enforces action guard; blocks submission on `UNKNOWN`, `LOADING`, and `SETUP_REQUIRED`. |
| `src/services/discovery/providers/metaAdsCollectorProvider.ts` | `verifyProviderConnection` | Modified | Distinguishes successful MCP query with 0 ads (`AVAILABLE`) from real collected ads (`LIVE_VERIFIED`). |
| `src/lib/kh01/acceptanceGateRegistry.ts` | Registry & Validator | New | Single canonical definition of 13 mandatory gates, manifest validation, and verdict derivation. |
| `scripts/kh01/runFullAcceptance.ts` | `verifyLiveMetaSource` | Modified | Removed HTML body length check; enforces real MCP connection test or truthful `NOT_RUN`/`BLOCKED_SOURCE`. |
| `scripts/kh01/runFullAcceptance.ts` | `parseVitestJsonAssertions` | Modified | Exact `testFile + fullName` keying with durationMs and skipped test tracking. |
| `scripts/kh01/runFullAcceptance.ts` | `runFullKh01Acceptance` | Modified | Executes all 10 stages, validates manifest, and writes machine-readable artifacts to `artifacts/v11.5.2/`. |

---

## 2. Detailed Function Analysis

### 2.1 `isTrustedLocalDeployment` & `resolveTrustedRequestContext`
- **File**: `src/services/security/adminAuth.ts`
- **Previous Behavior**: Relied on incoming HTTP headers `Host: localhost`, `x-forwarded-for`, `x-real-ip`.
- **Defect**: Allowed remote attackers to spoof `Host: localhost:3000` or forge loopback forwarded headers to bypass administrative protection.
- **New Behavior**: Evaluates server-side environment variables first (`SWAI_DEPLOYMENT_MODE`, `SWAI_REMOTE_ACCESS`, cloud flags). Rejects any request carrying remote forwarded IPs or non-loopback destination hosts. Fails closed when running in remote or public binding mode.

### 2.2 `searchAuthorizedCompetitorAds` & `/api/v1/ads`
- **File**: `src/services/ads/adService.ts`, `src/app/api/v1/ads/route.ts`
- **Previous Behavior**: `GET /api/v1/ads` called `searchCompetitorAds` without workspace authorization, allowing cross-tenant data leakage.
- **Defect**: Bypassed multi-tenant security established in Global Search and Evergreen APIs.
- **New Behavior**: Resolves authorized research context via `resolveAuthorizedResearchContext(request)` and passes `context.workspaceId` directly into `searchAuthorizedCompetitorAds`. Combines user search filters with workspace ownership predicates using `AND` semantics.

### 2.3 `resolveAuthorizedDiscoveryRun`
- **File**: `src/services/research/authorizedScopeHelpers.ts`
- **Previous Behavior**: Missing runs or foreign workspace runs returned 200 with an empty array `[]`.
- **Defect**: Ambiguity between a run with 0 ads, a nonexistent run, and an unauthorized cross-workspace access attempt.
- **New Behavior**: Queries database for the run. If absent, throws `ResearchAuthError("RUN_NOT_FOUND", 404)`. If run belongs to another workspace, throws `ResearchAuthError("FORBIDDEN_WORKSPACE_RUN", 403)`. Authorized runs with 0 ads return 200 with `data: []`.

### 2.4 `ExactRunContextBanner` & `fetchAds` in Explorer
- **File**: `src/app/explorer/page.tsx`
- **Previous Behavior**: Explorer defaulted to `researchMode = "NEWLY_LAUNCHED"` and `launchWithinDays = "30"`, filtering out ads older than 30 days or with unknown launch dates even when `requestId` was supplied.
- **Defect**: Legitimate research run ads (e.g. 90-day, 180-day, or unknown date ads) were silently hidden from the user. Duplicate banners were rendered.
- **New Behavior**: `resolveExplorerScope` enters `EXACT_RUN` mode whenever `requestId` is present. Bypasses 30-day filters. Calls canonical endpoint `/api/v1/discovery/meta/requests/:id/ads`. Renders single consolidated `ExactRunContextBanner` with clean `Exit Run View` button.

### 2.5 `deriveResearchAction` & `MetaResearchForm`
- **File**: `src/lib/meta/researchActionPolicy.ts`, `src/components/meta/MetaResearchForm.tsx`
- **Previous Behavior**: Form submit button remained `type="submit"` even in `UNKNOWN`, `LOADING`, or `SETUP_REQUIRED` states.
- **Defect**: Misleading UI allowed users to trigger invalid research submissions before health was known.
- **New Behavior**: `deriveResearchAction` computes button type (`submit` vs `button`), label, and enabled state. `handleSubmit` blocks keyboard and mouse submission if readiness does not permit starting or queueing.
