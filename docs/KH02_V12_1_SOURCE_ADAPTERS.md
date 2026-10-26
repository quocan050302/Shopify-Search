# SWAI KH-02 V12.1 — Multi-Source Adapters & Readiness Hardening

## 1. Executive Summary

KH-02 V12.0 claimed full multi-platform capability across 4 platforms, but:
1. **Google Ads Transparency**: Hard-coded REST call to an invented endpoint without actual MCP tool protocol handling, and defaulted `verifiedDeliveryMarket` to `"US"` without upstream evidence.
2. **TikTok Organic**: Used a naive cost formula (`Math.ceil(maxResults / 10)`), permitted negative views, lacked integer overflow protection, and threw unhandled errors on malformed timestamps.
3. **TikTok Ads US**: Falsely claimed US delivery for unverified regional ads.
4. **False Positive Readiness**: Reported `PASSED` for sources based solely on static environment flags rather than live connectivity.

In V12.1, all adapters enforce honest capability contracts and fail-closed readiness states.

---

## 2. Google Ads Transparency MCP Adapter

### Protocol Integration
Implemented `createGoogleTransparencyMcpClient()` supporting stdio (`@modelcontextprotocol/sdk`) and HTTP MCP gateway:
- `connect()`
- `listTools()`
- `searchAdvertiserByDomain(domain)`
- `getAds(advertiserId, region)`
- `getAdDetail(creativeId)`
- `close()`

### Honest Geographic Market Provenance
```typescript
const deliveryRegion = ad.region || ad.delivery_region || ad.target_country || null;
const verifiedDeliveryMarket = (deliveryRegion === "US" || deliveryRegion === "USA") ? "US" : null;
```
Unless the record proves US delivery, `verifiedDeliveryMarket` remains `null`.

### Product Relevance Categorization
- `PRODUCT_SPECIFIC`: Creative headline/body matches candidate product keywords.
- `BRAND_RELATED`: Creative matches store domain but lacks specific product copy.
- `UNRELATED`: Irrelevant creative.

---

## 3. TikTok Organic Adapter Hardening

### Provider Cost Policy
```typescript
export interface ProviderCostPolicy {
  creditsPerRequest: number;
  pageSize: number;
  maximumPages: number;
  freeMonthlyAllowance?: number;
  quotaVerifiedAt: string | null;
}

export const TIKTOK_ORGANIC_COST_POLICY: ProviderCostPolicy = {
  creditsPerRequest: 1,
  pageSize: 20,
  maximumPages: 2,
  freeMonthlyAllowance: 0,
  quotaVerifiedAt: "2026-10-26T00:00:00.000Z",
};
```

### Normalization Safety
- Rejects negative metrics (sets to `null`).
- Enforces `Number.isSafeInteger` against integer overflows.
- Safely parses dates without throwing on corrupted strings.
- Defaults `sourceProvenance` to `"UNKNOWN"` unless verified upstream.
- Distinguishes lifetime views per day from multi-observation growth velocity.

---

## 4. Truthful Provider Readiness Checks

`checkKH02ProviderReadiness()` reports distinct, truthful operational tiers:
- `NOT_CONFIGURED`: Required credentials or endpoints are missing.
- `CONFIGURED`: Credentials or endpoint present.
- `SOURCE_DATA_VERIFIED`: Genuine records verified in database for workspace.
- `NOT_VERIFIED`: Automated US provider unverified (e.g. TikTok Ads US).
- `BLOCKED_SOURCE`: Provider blocked or challenged by upstream.
