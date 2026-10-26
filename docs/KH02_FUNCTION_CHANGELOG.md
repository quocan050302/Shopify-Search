# SWAI KH-02 — FUNCTION CHANGELOG & ARCHITECTURAL MANIFEST
**Module:** KH-02 — Evergreen Winning Products Intelligence  
**Release Version:** 12.0.0  
**Starting Commit SHA:** `354256b616bfbb04e605fe0620343f2a3b4ffd0a`  
**Branch:** `feature/v11-meta-collector-remove-muse`

---

## 1. New Core Services Added (`src/services/kh02/`)

| File | Function / Interface | Description |
|---|---|---|
| `types.ts` | `IntelligenceSource`, `SourceCapabilities`, `SourceObservation`, `KH02RankedProduct` | Unified data contracts, source capabilities, and leaderboard view models. |
| `providers/sourceRegistry.ts` | `listKH02SourceCapabilities()`, `checkKH02ProviderReadiness()`, `estimateResearchProviderCost()` | Central capabilities directory, cost estimator with zero-cost default, and readiness checker. |
| `providers/metaResearchAdapter.ts` | `collectMetaProductSignals()` | Adapts Meta Ad Library records, extracts distinct advertisers, and applies diminishing returns to creative spam. |
| `providers/tiktokAdsResearchAdapter.ts` | `collectTikTokAdsSignals()` | Truthfully isolates US advertising evidence; prevents confusing EU ad library with US commercial ads. |
| `providers/tiktokOrganicResearchAdapter.ts` | `collectTikTokOrganicSignals()` | Normalizes public product review videos, observed view counts, engagement ratios, and creator diversity. |
| `providers/googleTransparencyResearchAdapter.ts` | `collectGoogleAdvertiserSignals()` | Queries Google Ads Transparency Center by candidate landing page domain, classifies relevance (`PRODUCT_SPECIFIC`, `BRAND_RELATED`, `UNRELATED`). |
| `identity/productCandidateDiscovery.ts` | `discoverProductCandidatesFromAds()` | Groups multi-ad creatives into canonical candidates, cleans ad hooks, extracts problem statements. |
| `identity/crossPlatformProductMatcher.ts` | `matchCrossPlatformProductEvidence()`, `submitProductMatchReview()` | Evaluates cross-store similarity conservatively; enforces manual review without destructive SKU merges. |
| `demand/temporalDemandEngine.ts` | `evaluateTemporalDemandStability()` | Analyzes historical search interest over 30/90/180/365 days; calculates CV, slope, and classifies stability. |
| `scoring/evergreenOpportunityScoring.ts` | `calculateKH02EvergreenScore()`, `KH02_SCORE_VERSION` | Evaluates 100-point 6-pillar score, independent confidence, and applies compliance/risk gates. |
| `evergreenResearchOrchestrator.ts` | `runEvergreenProductResearch()` | 14-stage research orchestrator coordinating multi-source discovery, candidate matching, scoring, and leaderboard generation. |

---

## 2. New API Endpoints (`src/app/api/v1/kh02/`)

| Route | Method | Description |
|---|---|---|
| `/api/v1/kh02/research` | `POST` | Initiates evergreen winning product research for a topic/niche; enforces US market and workspace isolation. |
| `/api/v1/kh02/providers/status` | `GET` | Returns real-time capabilities and readiness status across all 5 intelligence sources. |

---

## 3. UI Enhancements

| File | Change Summary |
|---|---|
| `src/app/products/page.tsx` | Transformed into Evergreen Winning Products Intelligence Leaderboard: Top 3 Gold/Ice Blue/Coral rows, video thumbnails with play overlays, score & confidence meters, source status bar, secondary candidates (#4+), and catalog toggle. |
| `src/app/products/[id]/intelligence/page.tsx` | Extended with 3 dedicated KH-02 tabs: `Evergreen & Demand`, `Cross-Platform Signals`, and `Store Fit & Brand`, while preserving all 7 original KH-01 tabs. |
