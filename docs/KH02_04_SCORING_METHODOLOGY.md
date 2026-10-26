# SWAI KH-02 — Evergreen Opportunity Scoring Methodology (V12.0.0)
**Document ID:** `KH02_04_SCORING_METHODOLOGY`  
**Module:** KH-02 — Evergreen Winning Products Intelligence  
**Formula Version:** `12.0.0`  
**Date:** October 26, 2026  
**Status:** IMPLEMENTED  

---

## 1. Executive Summary

Traditional dropshipping and ad spy tools rank products based purely on short-term popularity: raw view counts, ad variant volume, or a 7-day social spike. This creates false confidence and severe inventory risk for long-term branded Shopify businesses.

SWAI KH-02 implements a **100-point Six-Pillar Opportunity Framework** coupled with an independent **Evidence Confidence Score (0–100)**:

$$\text{Opportunity Score} \in [0, 100], \quad \text{Evidence Confidence} \in [0, 100]$$

A product with a high model-predicted score but low evidence confidence is flagged as **`PROVISIONAL — NEEDS MORE RESEARCH`**, preventing unverified products from claiming evergreen status.

---

## 2. Six-Pillar Architecture & Weight Allocation

| Pillar | Max Weight | Primary Evaluation Criteria | Evidence Sources |
| :--- | :---: | :--- | :--- |
| **A. Demand Stability** | **25 pts** | Statistical variance (CV), multi-month persistence, seasonality waves, absence of decay. | Google Trends time series, historical demand observations. |
| **B. Problem-Solution Fit** | **20 pts** | Tangible consumer problem, urgency, clear pain point statement, everyday utility. | Ad copy, landing page value propositions, customer objections. |
| **C. Multi-Platform Validation** | **20 pts** | Corroboration across independent advertising and social discovery channels. | Meta Ads, TikTok Ads US, TikTok Organic, Google Ads. |
| **D. Brandability & Store Fit** | **15 pts** | Suitability for a long-term branded niche store, catalog coherence, bundling potential. | Store domain records, product category classification. |
| **E. Creative Depth** | **10 pts** | Variety of visual demonstrations, distinct angles, UGC video availability. | Video assets, unique creative library IDs, formats. |
| **F. Competition Sustainability** | **10 pts** | Breadth of independent advertisers without race-to-the-bottom commodity crowding. | Unique advertiser count, store domain distribution. |
| **Total** | **100 pts** | | |

---

## 3. Strict Scoring Gates & Invariants

### 3.1 Separate Score Status
Every score is tagged with one of three explicit confidence classifications:
1. **`VERIFIED`:** Full historical demand series ($\ge 60-90$ days) plus multi-platform evidence ($\text{Confidence} \ge 65/100$).
2. **`PROVISIONAL`:** Solid commercial signals but incomplete temporal demand data or single-platform presence.
3. **`INSUFFICIENT_EVIDENCE`:** Lacks critical data points; cannot be recommended for capital commitment.

### 3.2 Null Score Policy on Data Gaps
If Pillar A (Demand Stability) cannot be calculated due to missing time series, the score is not artificially boosted with a median average. The system reports `stabilityScore: null` and caps the provisional score at 80.

### 3.3 Risk & Compliance Gates
- **Compliance / Safety Risk:** If trademark infringement, unverified medical claims, or liability concerns are detected, the recommendation is forced to **`REQUIRES_MANUAL_REVIEW`** regardless of point total.
- **Fragility / Heavy Shipping:** Flagged as an operational risk that warns the researcher of high return rates.

---

## 4. Verification Checkpoint

The V12.0.0 scoring methodology is implemented in:
- `src/services/kh02/scoring/evergreenOpportunityScoring.ts`

Phase 4 requirements are fulfilled.
