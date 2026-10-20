# SWAI V9.2 — Technical Repair Report: Discovery Authentication & Provider Architecture

**Baseline Commit SHA:** `8b63abadca93fb6abd16e482475ad3124c2c546e`  
**Execution Date:** October 2026  
**Primary Focus:** TikTok Auto Discovery, Local Worker, Environment Loading, Apify Budget Safety, and Zero-Cost Integrity  

---

## 1. Executive Summary & Root Cause Analysis

### Root Causes Identified in V9.0 / V9.1:
1. **Misleading Error Reporting (The Fake 40101 Bug):**
   When `TIKTOK_CC_COOKIE` was empty, `tiktokTopAdsProvider.ts` returned `code: 40101` and labeled the provider as having received an upstream auth rejection, even though **no network request was ever made**.
2. **Inconsistent Environment Loading Across CLIs:**
   CLI entry points (`discovery-once.ts`, `discovery-doctor.ts`, etc.) and `src/lib/db.ts` relied on basic `dotenv/config`, which failed to load `.env.local` according to standard Next.js precedence rules (`.env.local` > `.env`).
3. **Unsafe Apify Budget Casting & Budget Crash Risk:**
   `apifyTopAdsProvider.ts` used an unsafe TypeScript cast (`as any`) for `"apify"`, while `budgetService.ts` lacked a registered budget record for Apify, causing potential undefined property lookups.
4. **Fragile Creative Center Endpoint & Compromised Session Cookies:**
   The internal Creative Center endpoint (`ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list`) is protected by Akamai Bot Manager and requires constantly refreshed browser session cookies. Previous credentials shared in documents were compromised and could not be reused.
5. **No Authorized Free US Competitor Top Ads API:**
   TikTok's official Commercial Content API strictly serves the EU market (DSA compliance). No zero-cost official API exists for US competitor ad scraping.

---

## 2. Exact Functions & Modules Repaired

### A. Environment Loading & Precedence (`src/lib/loadLocalEnvironment.ts`)
- **Created:** `loadLocalEnvironment(projectDir?)` using `@next/env` to guarantee Next.js-aligned environment hierarchy (`.env.local` overrides `.env`).
- **Created:** `validateDiscoveryEnvironment()` for secure diagnostic reporting without credential leakage.
- **Updated:** `src/lib/db.ts` to invoke the shared loader before initializing Prisma Client.
- **Updated:** `scripts/discovery-doctor.ts`, `scripts/discovery-once.ts`, `scripts/discovery-worker.ts`, and `scripts/discovery-dry-run.ts` to bootstrap the environment loader as their very first operation.

### B. Dedicated Apify Budget & Provider Safety
- **Repaired:** `src/services/credentials/credentialService.ts` — Added `"apify"` to the canonical `ProviderId` union and registered it in `PROVIDER_CATALOG`.
- **Repaired:** `src/services/providers/budgetService.ts` — Added a dedicated `apify` entry to `DEFAULT_BUDGETS` (disabled by default, 0 monthly limit). Added strict unknown-provider rejection in `getProviderBudget()` and `authorizePaidApiCall()`.
- **Repaired:** `src/services/discovery/providers/apifyTopAdsProvider.ts` — Eliminated the unsafe type cast. Added strict checks requiring `ENABLE_APIFY_DISCOVERY === "true"` and `FREE_DISCOVERY_MODE !== "true"`.
- **Repaired:** `src/components/settings/ApiConnectionsManager.tsx` — Added dedicated UI budget controls, icons, and type-safe state for Apify.

### C. Provider State Machine & Verification (`src/services/discovery/`)
- **Repaired:** `src/services/discovery/types.ts` — Expanded `ProviderAvailabilityState` to 12 granular, honest states (`NOT_CONFIGURED`, `READY_UNVERIFIED`, `AVAILABLE`, `LIVE_VERIFIED`, `REQUIRES_AUTH`, `PERMISSION_DENIED`, `REGION_UNSUPPORTED`, `ENDPOINT_UNSUPPORTED`, `INVALID_RESPONSE`, `RATE_LIMITED`, `BLOCKED_SOURCE`, `PAID_DISABLED`).
- **Added:** `getProviderConfigurationStatus()` and `verifyProviderConnection()` to the `AdDiscoveryProvider` interface.
- **Repaired:** `src/services/discovery/providers/tiktokTopAdsProvider.ts` — Static check returns `NOT_CONFIGURED` without cookie (no synthetic 40101). Verification results are cached for 5 minutes to prevent redundant requests on every page load.
- **Repaired:** `src/services/discovery/providers/tiktokOfficialProvider.ts` — Explicitly reports `REGION_UNSUPPORTED` for US queries with honest documentation links.
- **Repaired:** `src/services/discovery/providerRegistry.ts` — Prevents silent fallback to paid providers when a free provider fails.

### D. Request Guard & Ingestion Integrity
- **Repaired:** `src/services/discovery/providerRequestGuard.ts` — Logs actual validated ad result counts (no fake `resultCount: 1`), sanitizes sensitive query parameters, and verifies application-level JSON structures.
- **Repaired:** `src/services/discovery/discoveryOrchestrator.ts` — Added `executeDiscoveryJob()`, job leasing (`claimPendingDiscoveryJob()`), checkpoint resumption, and cancellation handling.
- **Repaired:** `src/workers/discoveryWorker.ts` — Added cross-process database heartbeat persistence (`SyncJob`), query preflight validation, and scheduler idempotency.
- **Repaired:** `src/app/api/v1/discovery/stats/route.ts` and `src/app/discovery/page.tsx` — Differentiates automatically discovered ads from manual imports, displays real DB worker heartbeat status, and exposes manual connection verification controls.

---

## 3. Test & Verification Outcomes

### Unit & Integration Test Suite
```
 RUN  v5.0.5 D:/Project_github/Running-Ads

 Test Files  19 passed (19)
      Tests  214 passed (214)
   Duration  7.22s
```
All 19 test files (214 tests) passed cleanly, including the new `tests/unit/v92DiscoveryRepair.test.ts` suite verifying:
- Environment variable loading precedence
- Apify dedicated budget registration
- TikTok provider state transitions (`NOT_CONFIGURED` -> `BLOCKED_SOURCE`)
- Honest registry lookup without paid fallback

### Type Checking & Production Build
- `npx tsc --noEmit`: 0 errors.
- `npx prisma validate`: Schema is valid.
- `npm run build`: Compiled successfully in Turbopack; 36 static/dynamic routes generated without errors.

### CLI Diagnostics & Execution
- `npm run discovery:doctor`: Passed cleanly; correctly detects environment files, database, and reports provider capabilities.
- `npm run discovery:dry-run`: Passed cleanly; validates query parameters without outbound network traffic.
- `npm run discovery:once`: Exited cleanly with `BLOCKED_SOURCE` (0 outbound requests, 0 fake records, $0 cost).

---

## 4. Remaining Blockers & Upstream Reality

1. **Undocumented TikTok Creative Center API:**
   Automating the internal Creative Center endpoint remains prohibited by TikTok's Terms of Service and is actively blocked by Akamai Bot Manager.
2. **Official API Geographic Restriction:**
   TikTok's Commercial Content API remains strictly limited to EU countries under the Digital Services Act.
3. **Recommendation:**
   Maintain SWAI in **`ENGINE_READY / NO_AUTHORIZED_PROVIDER`** mode for zero-cost automated discovery. Users may leverage the verified zero-cost **Manual & Batch Import** workflow, or optionally configure a dedicated paid Apify actor with explicit budget approval.
