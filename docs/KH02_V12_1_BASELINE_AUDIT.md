# SWAI KH-02 V12.1 — BASELINE AUDIT & ROOT CAUSE INVESTIGATION
**Module:** KH-02 — Evergreen Winning Products Intelligence V12.1  
**Source Branch:** `QA`  
**Verified QA Baseline SHA:** `6c80ab406566f46f0a969fa54be18bfadbd24a61`  
**Working Branch:** `feature/kh02-v12.1-evergreen-hardening`  
**Execution Mode:** RESEARCH_ONLY / ZERO REGRESSION  
**Date:** 2026-10-26

---

## 1. Audit Summary & Objectives
An independent source audit of KH-02 V12.0 identified several critical P0/P1 gaps between architectural expectations and current implementation:
1. **Meta Platform Query Bug (P0):** `collectMetaProductSignals()` in `metaResearchAdapter.ts` queries `platform: "FACEBOOK"`, while the canonical ingested platform in SWAI KH-01 is `"META"`. This prevents existing verified Meta ads from being discovered.
2. **Workspace Isolation Breach (P0):** `collectMetaProductSignals()` queries `prisma.competitorAd.findMany` globally across the database without scoping to the requesting workspace.
3. **Ad URL vs Landing Page URL Confusion (P0):** Meta ads store `sourceUrl` as `facebook.com/ads/library/?id=...`, which is an advertisement reference, not the product destination URL (`CompetitorAd.landingPageUrl`).
4. **Product Candidate Grouping Failure (P0):** `discoverProductCandidatesFromAds()` in `productCandidateDiscovery.ts` groups by `obs.sourceUrl || obs.advertiserDomain`, clustering ads around Facebook Library IDs rather than real product landing pages.
5. **Candidate ID vs ResearchProduct ID Mismatch (P0):** `candidate.candidateId` (`cand_...`) is passed to `loadProductHistoricalDemand()` and used for `/products/[id]/intelligence` navigation instead of resolving the real database `ResearchProduct.id`.
6. **Cross-Store Match Review Volatility (P1):** `submitProductMatchReview()` returns an in-memory object and does not persist operator decisions with workspace ownership in SQLite.
7. **False Seasonality Classification (P1):** `evaluateTemporalDemandStability()` classifies moderate coefficient of variation (CV) as `SEASONAL_RECURRING` without verifying recurring multi-season periodic waves.
8. **Disconnected Multi-Source Enrichment (P1):** In `evergreenResearchOrchestrator.ts`, TikTok Organic and Google Ads observations are collected after candidate grouping but never matched and attached to individual product candidates prior to scoring.
9. **Google Ads Transparency Transport (P1):** `googleTransparencyResearchAdapter.ts` sends arbitrary HTTP POST requests (`search_advertiser_by_domain`) rather than using the MCP protocol, and erroneously sets `verifiedDeliveryMarket = "US"` on unverified ads.
10. **TikTok Organic Normalization & Credits (P1):** Unhandled error modes, ambiguous timestamp resolution, and lack of real credit accounting in `tiktokOrganicResearchAdapter.ts`.
11. **Provisional Score Leakage into Evergreen Top 3 (P1):** Products with zero historical demand or provisional status are placed into the primary Top 3 and labeled evergreen winners.
12. **Synchronous HTTP Bottleneck & Lack of Persistence (P1):** `POST /api/v1/kh02/research` runs all stages synchronously in-memory, leaving no durable research run history or immutable ranking snapshots. Page reloads lose state.
13. **UI Auto-Research on Mount (P1):** `src/app/products/page.tsx` executes research automatically on mount, potentially triggering billable network requests without user interaction.

---

## 2. Baseline Verification
- Verified QA Baseline commit: `6c80ab406566f46f0a969fa54be18bfadbd24a61`
- Existing KH-01 verification suite: 69/69 tests passing (`npm run kh01:verify`).
- Clean working directory on `feature/kh02-v12.1-evergreen-hardening`.

---

## 3. Repair Roadmap
- **Checkpoint 01:** Baseline audit & documentation (Completed).
- **Checkpoint 02:** Meta platform filter, workspace-scoped queries, and ad/landing URL separation.
- **Checkpoint 03:** Product candidate grouping, identity resolution to `ResearchProduct.id`, and review persistence.
- **Checkpoint 04:** Historical demand linking, time-series validation, and rigorous seasonality classification.
- **Checkpoint 05:** Per-product multi-source evidence matching (TikTok Organic & Google Ads) and Google MCP transport client.
- **Checkpoint 06:** Evergreen scoring integrity (segregated provisional candidates, no ungrounded baseline inflation, risk gates).
- **Checkpoint 07:** Persistent research runs, worker execution, and immutable ranking snapshots.
- **Checkpoint 08:** Leaderboard UI hardening (restore on load, disable auto-mount research, verified video playback, correct product links).
- **Checkpoint 09:** Full unit, integration, and KH-01 regression testing suite.
