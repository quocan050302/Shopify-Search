# SWAI KH-02 V12.1.1 — BASELINE AUDIT

**Date:** 2026-10-26  
**Module:** KH-02 Evergreen Winning Products Intelligence  
**Branch:** `feature/kh02-v12.1.1-runtime-acceptance`  
**Base Branch:** `feature/kh02-v12.1-evergreen-hardening` (at commit `c4c943d26cb8789f2b39b51eba34a849c361a5c5`)  
**Upstream QA SHA:** `6c80ab406566f46f0a969fa54be18bfadbd24a61`  
**Execution Mode:** `RESEARCH_ONLY`, Non-Breaking Runtime Hardening & Real Acceptance  

---

## 1. Actual Architecture Map

```text
USER / CLIENT
      │
      ▼
POST /api/v1/kh02/research
      │
      ├──> Input Validation (Zod, topic, market=US, lookbackDays)
      ├──> Authorization (Workspace Context, x-workspace-id)
      │
      ▼
KH-02 RESEARCH JOB RUNTIME (src/workers/kh02Worker.ts & persistence)
      │
      ├──> Atomically Claimed SyncJob (jobType: "KH02_RESEARCH", status: PENDING -> RUNNING)
      ├──> Multi-Provider Discovery & Collection:
      │       ├── Meta Ads Adapter (Workspace-scoped, canonical META filter, real landingPageUrl)
      │       ├── TikTok Ads Adapter (US verified market checks, honest fallback)
      │       ├── TikTok Organic Adapter (HasData credit-guarded, fail-safe parser)
      │       └── Google Ads Transparency (Schema-driven MCP tool discovery & invocation)
      │
      ▼
PRODUCT CANDIDATE DISCOVERY & RESOLUTION
      │
      ├──> Extract Candidate by canonical landingPageUrl (deduplicates Ad Library creative variants)
      ├──> Map candidate to canonical ResearchProduct.id via AdProductLink
      ├──> Match cross-platform evidence (product-specific vs brand-related)
      │
      ▼
HISTORICAL DEMAND ANALYSIS
      │
      ├──> Load time series for resolved ResearchProduct.id (ProductDemandObservation)
      ├──> Evaluate temporal stability (chronological sorting, CV extrema checking, span >= 60d)
      │
      ▼
SIX-PILLAR EVERGREEN SCORING & GATING
      │
      ├──> Pillar A: Demand Stability (25 pts)
      ├──> Pillar B: Problem-Solution Fit (20 pts)
      ├──> Pillar C: Multi-Platform Validation (20 pts)
      ├──> Pillar D: Brandability / Store Fit (15 pts)
      ├──> Pillar E: Creative Depth (10 pts)
      ├──> Pillar F: Competition Sustainability (10 pts)
      │
      ▼
PERSISTENT RANKING SNAPSHOT & READBACK
      │
      ├──> SyncJob resultJson updated atomically (status: COMPLETED / FAILED)
      ├──> Immutable snapshot restored on page reload: GET /api/v1/kh02/leaderboard
      └──> Verified Top 3 Podium vs Provisional Opportunities
```

---

## 2. Existing Capabilities

1. **Meta Ads Discovery:** Successfully reads genuine-shape `CompetitorAd` with canonical platform `META` and filters strictly by `workspaceId`.
2. **Product Candidate Grouping:** Correctly isolates unique landing page URLs (`store.com/products/xyz`), avoiding fragmentation of identical products across multiple Ad Library creative IDs.
3. **Real Product ID Mapping:** Maps temporary candidate IDs to database `ResearchProduct.id` to enable downstream demand time series lookups.
4. **Demand Time Series Stability Quality:** Rejects series spanning `< 60` days (`INSUFFICIENT_HISTORY`), detects flatlines, and verifies cyclical swings before assigning `SEASONAL_RECURRING`.
5. **Persistence Models:** Reuses existing `SyncJob` with `jobType: "KH02_RESEARCH"` for run state and immutable ranking snapshots.

---

## 3. Confirmed Defects & Runtime Hardening Scope (R01 - R11)

| ID | Module | Confirmed Defect | Target Correction |
|---|---|---|---|
| **R01** | Google MCP | Google MCP adapter assumes hard-coded tool names (`get_ads`) without formal tool discovery and schema validation | Implement `discoverGoogleAdsMcpCapabilities`, `validateGoogleMcpToolArguments`, and schema-driven invocation |
| **R02** | Demand History | Demand history can report verified without sufficient distinct temporal observations | Enforce multi-point requirement, distinct observation timestamps, and explicit `UNVERIFIED` state on missing data |
| **R03** | Meta Provenance | Meta ads adapter assumes target market `"US"` without checking ad-level delivery region | Implement `resolveMetaMarketProvenance` with separate `requestedMarket` vs `verifiedDeliveryMarket` |
| **R04** | Source Status | Status endpoint may report connected without validating search capability | Implement capability-level discovery and report `AVAILABLE`, `PARTIAL`, `UNAVAILABLE`, `INVALID_SCHEMA` |
| **R05** | Research Worker | POST route executes orchestrator synchronously in-line | Make job creation return durable PENDING run, with background worker execution and async polling |
| **R06** | Worker Resilience | Missing heartbeat renewal, fencing tokens, stale job recovery, and retry classification for KH-02 | Implement dedicated `src/workers/kh02Worker.ts` with fencing tokens, atomic lease renewal, and stale recovery |
| **R07** | HasData Credits | Credit accounting uses rough heuristic without querying or verifying authoritative HasData balance | Implement `fetchHasDataCreditStatus`, `evaluateHasDataQuota`, and explicit `UNSUPPORTED`/`UNAVAILABLE` if missing |
| **R08** | TikTok Organic | Organic adapter lacks explicit capability resolution and distinct collection error classification | Implement `resolveTikTokCapabilities` and `collectTikTokOrganicEvidence` with typed return status |
| **R09** | Live Acceptance | Live acceptance reports do not distinguish offline verified mocks from real network responses | Generate granular source-specific acceptance JSON records (`SOURCE_VERIFICATION.json`) |
| **R10** | Browser E2E | Browser tests lack verified Chromium artifacts (screenshots, traces, console logs) | Create dedicated Playwright Chromium test suite and save real visual and network artifacts |
| **R11** | CI Acceptance | CI workflows lack structured gate matrix and artifact retention | Provide GitHub Actions workflow and full 15-file acceptance dossier |

---

## 4. KH-01 Non-Regression Protection

- **Shared Components:** `prisma.syncJob`, `prisma.researchEvidence`, `prisma.competitorAd`, `prisma.advertiser`, `src/services/research/researchAuthService.ts`.
- **Constraint:** All changes to shared components must remain strictly backwards-compatible.
- **Verification:** Run `npm run kh01:verify` (69/69 passing) before and after all changes.
