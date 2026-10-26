# SWAI KH-02 V12.1 — P0 ROOT CAUSES & REMEDIATION SPECIFICATION
**Module:** KH-02 — Evergreen Winning Products Intelligence V12.1  
**Target Market:** United States  
**Priority:** P0 Defects (Platform Identity, Workspace Scoping, Product Identity, Real Product ID, Demand Linking)

---

## 1. P0 Bug #1: Meta Platform Filter Mismatch
- **File:** `src/services/kh02/providers/metaResearchAdapter.ts`
- **Root Cause:** Line 53 queries `platform: "FACEBOOK"`. In the database, all KH-01 ingested ads from `metaAdsCollectorProvider.ts` use `platform: "META"`. Consequently, `prisma.competitorAd.findMany` returns 0 ads even when hundreds of verified Meta ads exist in the database.
- **Remediation:** Query `platform: "META"` (or `{ in: ["META", "FACEBOOK"] }` for backward compatibility without changing stored data).

---

## 2. P0 Bug #2: Global CompetitorAd Reads Without Workspace Scoping
- **Files:** `src/services/kh02/providers/metaResearchAdapter.ts`, `src/services/kh02/providers/tiktokAdsResearchAdapter.ts`
- **Root Cause:** Both adapters call `prisma.competitorAd.findMany` without filtering by `workspaceId`. A tenant in Workspace A could inspect advertisements ingested in Workspace B.
- **Remediation:** Filter candidate ads through authorized workspace associations:
  - Ad IDs present in `DiscoveryRunAd` belonging to a `DiscoveryRun` in `query.workspaceId`.
  - Or ads linked via `AdProductLink` → `ResearchProduct` associated with `query.workspaceId` (or `ResearchEvidence` scoped to `query.workspaceId`).

---

## 3. P0 Bug #3: Ad URL Treated As Product Landing URL
- **Files:** `src/services/kh02/types.ts`, `src/services/kh02/providers/metaResearchAdapter.ts`
- **Root Cause:** `sourceUrl` on Meta is `facebook.com/ads/library/?id=...`. This is an ad library observation link, not a Shopify product URL. `CompetitorAd.landingPageUrl` contains the actual destination URL (e.g. `https://store.com/products/pet-remover`).
- **Remediation:** Extend `SourceObservation` with `landingPageUrl?: string | null`, `sourceExternalAdId?: string | null`, and `storeDomainEvidence?: string | null`. Populate `landingPageUrl` from `CompetitorAd.landingPageUrl`, and keep `sourceUrl` strictly for the creative source.

---

## 4. P0 Bug #4: Candidate Grouping on Facebook Library URLs
- **File:** `src/services/kh02/identity/productCandidateDiscovery.ts`
- **Root Cause:** `discoverProductCandidatesFromAds()` uses `const rawUrl = obs.sourceUrl || obs.advertiserDomain || "";`. Because `sourceUrl` was the Ad Library URL, every single ad was treated as a separate unique product or grouped under facebook.com!
- **Remediation:**
  1. Priority 1: Check existing `AdProductLink` → `ResearchProduct`.
  2. Priority 2: Use canonicalized `obs.landingPageUrl`.
  3. Priority 3: Same store domain with confirmed SKU/model keywords.
  4. Priority 4: Conservative candidate clustering with multiple ads per landing page.

---

## 5. P0 Bug #5: Candidate ID Passed to Demand Loader & Navigation
- **Files:** `src/services/kh02/evergreenResearchOrchestrator.ts`, `src/app/products/page.tsx`
- **Root Cause:** The orchestrator called `loadProductHistoricalDemand(candidate.candidateId)`. Because `candidate.candidateId` is a temporary string (`cand_123456_0`), `prisma.productDemandObservation.findMany({ where: { productId: ... } })` always returned empty arrays! Demand was perpetually classified as `INSUFFICIENT_HISTORY`. Furthermore, the UI linked to `/products/${candidate.candidateId}/intelligence`, which 404'd because the database expects a UUID `ResearchProduct.id`.
- **Remediation:** Implement `resolveCandidateResearchProduct()`:
  - Look up existing `ResearchProduct` via canonical landing page URL or linked `AdProductLink`.
  - Pass the resolved `researchProductId` to `loadProductHistoricalDemand(researchProductId)`.
  - Update UI links to navigate using `researchProductId` (or offer a dedicated candidate detail modal/review drawer if unpersisted).
