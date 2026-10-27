# SWAI KH-02 V12.2.4 — GOOGLE MARKET PROVENANCE ROOT CAUSE ANALYSIS

## 1. Defect Description
In previous versions, `scripts/googleTransparencyServer.py` contained:
```python
ad = client.get_ad_detail(advertiser_id, creative_id)
ad["delivery_region"] = region
ads.append(ad)
```
Because `region` was the query request parameter (`"US"`), injecting it into `delivery_region` created a false impression that Google Ads Transparency Center had independently reported that the ad was delivered in the United States.

## 2. Upstream Google Reality
The Google Ads Transparency Center search endpoint accepts a country code filter (e.g. `region="US"`), but its ad detail records do NOT return an ad-level delivery geography breakdown for individual creatives.

## 3. Mandatory Architecture Fix
1. Removed `ad["delivery_region"] = region`.
2. Implemented strict typed `AdMarketProvenance`:
   - `requestedMarket: "US"`
   - `providerFilterMarket: "US"`
   - `providerReportedMarket: null`
   - `verifiedDeliveryMarket: null`
   - `verificationStatus: "FILTER_ONLY"`
3. A query filter alone cannot produce `verifiedDeliveryMarket = "US"`.
