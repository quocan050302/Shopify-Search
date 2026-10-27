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
  - Tightened pet gadget signatures and disambiguated generic device terms (GPS, fountain, feeder, tracker).
  - Explicitly excluded non-pet domains (car/fleet trackers, garden decorative fountains, chemical stain removers).

## 3. Telemetry & Multi-Source Separation
- **Target:** `src/services/kh02/providers/metaResearchAdapter.ts` & `src/services/kh02/evergreenResearchOrchestrator.ts`
  - Separated fresh live records from cached records. Removed `.some()` live inference.
- **Target:** `src/services/kh02/persistence/kh02PersistenceService.ts`
  - Deleted multi-source `totalObservationsCollected` fallback for Meta count.

## 4. Truthful Acceptance Engine V12.2.4
- **Target:** `scripts/kh02/runAcceptanceV12_2_4.ts`
  - Computed all 39 release gate results dynamically from real evaluation functions.
  - Zero hardcoded PASS or BLOCKED values.
  - Reconciled exact candidate readback across Source, Database, HTTP API, and Chromium Browser on the SAME live research run (`kh02_run_1793090618422_mb5oc`).
