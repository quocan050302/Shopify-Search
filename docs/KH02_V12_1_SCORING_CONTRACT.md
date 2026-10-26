# SWAI KH-02 V12.1 — Six-Pillar Scoring Contract & Evergreen Eligibility

## 1. Six-Pillar 100-Point Framework

| Pillar | Max Weight | Grounded Evidence Requirement |
|---|---|---|
| **Demand Stability** | 25 pts | Google Trends multi-month time series (CV, mean, cyclic swings) |
| **Problem-Solution Fit** | 20 pts | Explicit pain point in copy, clear demonstrable utility |
| **Multi-Platform Validation** | 20 pts | Independent corroboration across Meta, TikTok, Google |
| **Brandability / Store Fit** | 15 pts | Dedicated store domain, niche category, SKU expansion |
| **Creative Depth** | 10 pts | Unique ad creative count (≥5) and video demonstration |
| **Competition Sustainability** | 10 pts | 2–8 independent advertisers (neither zero nor saturated) |

---

## 2. Removal of Ungrounded Baseline Points

In V12.0, candidates received arbitrary positive baselines (e.g. Pillar B = 6, Pillar C = 4, Pillar D = 8) without observing evidence. In V12.1:
- **All pillars start at 0 points**.
- Points accumulate strictly upon observation of verified facts.
- Opportunity Score and Evidence Confidence are strictly segregated metrics.

---

## 3. Evergreen Eligibility Gates (`applyKH02EligibilityGates`)

Candidates are classified into explicit, non-overlapping product tiers:
1. `VERIFIED_EVERGREEN`: Meets all gates:
   - `scoreStatus === "VERIFIED"`
   - `demandStability >= 15` pts
   - Demand is not `DECLINING`, `TREND_DEPENDENT`, or `INSUFFICIENT_HISTORY`
   - Opportunity Score `≥ 65`
   - Evidence Confidence `≥ 65%`
   - No compliance/trademark flags
   - **Only candidates in this tier qualify for the primary Top 3 Leaderboard**.
2. `PROVISIONAL_OPPORTUNITY`: Promising commercial signals observed, but long-term historical demand or supplier quotes are pending. Displayed in the secondary Provisional Shortlist.
3. `INSUFFICIENT_EVIDENCE`: Lacks baseline evidence.
4. `REQUIRES_MANUAL_REVIEW`: Compliance or trademark safety flag detected.
5. `REJECTED`: Fails economic or competitive thresholds.
