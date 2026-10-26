# SWAI KH-02 V12.1 — Meta Platform Integration & Workspace Scoping Audit

## 1. Executive Summary

In KH-02 V12.0, the Meta Ads research adapter suffered from three critical defects:
1. **P0 Platform Query Defect**: The query searched for `platform: "FACEBOOK"`, whereas KH-01 canonical ingestion stores `platform: "META"`. This rendered all existing collected Meta competitor ads invisible to KH-02.
2. **P0 Workspace Leakage**: The query accessed the global `competitorAd` table without restricting candidates to ads associated with the requesting workspace.
3. **P0 Source URL Conflation**: The adapter returned the Meta Ad Library URL (`facebook.com/ads/library/?id=...`) as the primary product URL, grouping unrelated ads under the Facebook domain instead of the advertiser's storefront.

In V12.1, all three issues have been resolved with zero regressions to KH-01.

---

## 2. P0 Fix: Canonical Platform Filter

### Root Cause
KH-01 `MetaAdsCollector` ingests advertisements with canonical platform `"META"`. KH-02 V12.0 queried:
```typescript
where: {
  platform: "FACEBOOK",
  ...
}
```
As a result, no ads ingested by KH-01 could ever be returned to KH-02.

### Solution
Updated query in `src/services/kh02/providers/metaResearchAdapter.ts`:
```typescript
where: {
  platform: { in: ["META", "FACEBOOK"] },
  ...
}
```
This enables KH-02 to read all canonical `"META"` ads while remaining backward-compatible with legacy records, without modifying stored database rows or running migrations.

---

## 3. P0 Fix: Workspace Scoping & Tenant Isolation

### Root Cause
Multi-tenant isolation was missing from candidate selection. Ads from Workspace B could be returned in research initiated from Workspace A.

### Solution
Reused the authoritative workspace helper `buildAuthorizedAdWhere(workspaceId)` from `src/services/research/authorizedScopeHelpers.ts`:
```typescript
const authorizedAdFilter = buildAuthorizedAdWhere(query.workspaceId);

const ads = await prisma.competitorAd.findMany({
  where: {
    ...authorizedAdFilter,
    platform: { in: ["META", "FACEBOOK"] },
    ...
  }
});
```
This guarantees that an ad is only discoverable if:
1. It is linked to an authorized `DiscoveryRun` owned by `query.workspaceId`, OR
2. It is saved to a `Watchlist` belonging to `query.workspaceId`.

---

## 4. P0 Fix: Landing Page URL vs Ad Library Source URL

### Root Cause
The Meta Ad Library URL (`https://www.facebook.com/ads/library/?id=123456`) was treated as the product landing page URL, leading to candidate grouping on `facebook.com` and breaking Shopify store detection.

### Solution
Added typed fields to `SourceObservation` in `src/services/kh02/types.ts`:
- `landingPageUrl`: Merchant destination URL (`https://store.com/products/xyz`).
- `sourceExternalAdId`: Meta Library ID / external ad ID.
- `storeDomainEvidence`: Extracted store domain (`store.com`).

Populated strictly in `src/services/kh02/providers/metaResearchAdapter.ts`:
```typescript
observations.push({
  source: "META_ADS",
  sourceRecordId: ad.id,
  sourceUrl: ad.originalAdUrl, // Preserves https://www.facebook.com/ads/library/?id=...
  landingPageUrl: ad.landingPageUrl, // Preserves https://store.com/products/xyz
  sourceExternalAdId: ad.externalAdId,
  storeDomainEvidence: ad.advertiser?.domain || null,
  ...
});
```

---

## 5. Verification Matrix

| Verification Check | Target | Status |
|---|---|---|
| Platform query matches KH-01 canonical platform | `"META"` | PASS |
| Legacy `"FACEBOOK"` records discoverable | `{ in: ["META", "FACEBOOK"] }` | PASS |
| Workspace A sees Workspace A ads | 100% | PASS |
| Workspace A cannot see Workspace B ads | Fail closed | PASS |
| Meta Ad Library URL retained as sourceUrl | Canonical link preserved | PASS |
| Merchant product page retained as landingPageUrl | Stored landingPageUrl | PASS |
| KH-01 Regression Test Suite (`npm run kh01:verify`) | 69/69 passing | PASS |
