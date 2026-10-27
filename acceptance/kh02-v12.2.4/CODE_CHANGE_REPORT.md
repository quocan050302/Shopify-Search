# SWAI KH-02 V12.2.4 — CODE CHANGE REPORT

## 1. Google US Delivery Provenance Correction
- **Target:** `scripts/googleTransparencyServer.py`
  - Removed artificial `ad["delivery_region"] = region` assignment.
  - Returned structure: `{ requested_region, provider_filter_region, ads }`.
- **Target:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
  - Defined strict typed `AdMarketProvenance` contract.
  - Rewrote `normalizeGoogleAdsResponse`: request filter produces `verificationStatus: "FILTER_ONLY"` and `verifiedDeliveryMarket: null`.
  - Only explicit ad-level reported delivery produces `VERIFIED`.

## 2. Meta Ads to Product Discovery Root Cause & Fix
- **Target:** `src/services/kh02/providers/metaResearchAdapter.ts`
  - Ensured `DiscoveryRun` creation and passed `discoveryRunId` and `runId` to `ingestDiscoveredAds()`.
  - Added `freshLiveAdIds` to `matchingAds` query clause so newly scraped live ads link to the workspace.
- **Target:** `src/services/kh02/identity/productRelevanceEvaluator.ts`
  - Expanded pet gadget signatures and added generic household items check (as `AMBIGUOUS`).

## 3. Workspace Authorization & Security Closure
- **Target:** `src/services/kh02/persistence/kh02PersistenceService.ts`
  - Removed silent `prisma.workspace.create` auto-creation from `createKH02ResearchRun`.
  - Throws typed `WorkspacePersistenceError` (`WORKSPACE_NOT_FOUND` -> 404, `NO_WORKSPACE_CONFIGURED` -> 400).
- **Target:** `src/app/api/v1/kh02/research/route.ts`
  - Catches `WorkspacePersistenceError` and returns HTTP 404/400 instead of HTTP 500.

## 4. Truthful Acceptance Engine V12.2.4
- **Target:** `scripts/kh02/runAcceptanceV12_2_4.ts`
  - Computed all gate results dynamically.
  - Zero hardcoded PASS or BLOCKED values.
