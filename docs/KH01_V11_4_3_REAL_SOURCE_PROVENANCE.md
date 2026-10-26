# KH-01 V11.4.3 — Real Source Provenance & Separation of Fixture Mode

## 1. Overview
In previous versions (V11.4.2 and earlier), when no authentic Meta advertisement was found in the database during acceptance runs, the script created an ad fixture using advertiser names ("Uproot Clean") and external Meta IDs resembling a genuine source record. This risked reporting internally generated synthetic fixtures as independently verified real Meta ads.

## 2. Provenance Architecture in V11.4.3
In V11.4.3, three strict execution classifications are established:
1. **`FIXTURE_INTEGRATION_E2E`**:
   - Explicitly designed for controlled integration testing.
   - Any created fixtures are unmistakably synthetic (`id: "fixture_kh01_meta_ad"`, `externalAdId: "fixture_synthetic_1642750633880173"`, `advertiser: "Synthetic Fixture Brand"`).
   - Provenance is explicitly reported as `FIXTURE_SYNTHETIC` and `isFixture: true`.
2. **`SOURCE_BACKED_E2E`**:
   - Uses an existing Meta advertisement with verified provenance recorded in the database.
   - If no authentic Meta ad is found, execution reports `BLOCKED_NO_SOURCE_AD` instead of inventing a synthetic replacement.
3. **`LIVE_SOURCE_E2E`**:
   - Requires a genuine source-backed Meta ad.
   - If the external competitor storefront blocks or rate-limits access (e.g. HTTP 401/403/429), it is honestly classified as `BLOCKED_BY_SOURCE`.
   - Never manufactures fake offers, fake pricing, or synthetic conversion signals when the source is inaccessible.

## 3. Test Verification
Verified via:
- `scripts/kh01RealE2E.ts` `resolveE2ESourceAd()`:
  - In `LIVE_SOURCE_E2E` mode with missing ads: returns `BLOCKED_NO_SOURCE_AD` safely.
  - In `FIXTURE_INTEGRATION_E2E` mode: labels synthetic records clearly and executes on isolated databases.
- `tests/integration/kh01RealE2E.test.ts` (PASSED).
