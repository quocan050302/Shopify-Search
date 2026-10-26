# SWAI KH-02 V12.1 — Historical Demand Quality & Seasonality Integrity

## 1. Executive Summary

In KH-02 V12.0, the historical demand engine suffered from three major vulnerabilities:
1. **Wrong Target Identifier**: Demand history was queried using discovery candidate IDs (`cand_123456_1`) rather than resolved database `ResearchProduct.id` values, returning empty time series for all candidates.
2. **Short-Term False Claims**: Time series spanning under 60 days were permitted to contribute to evergreen claims.
3. **False Seasonality Classification**: Moderate coefficient of variation (CV) alone was classified as `SEASONAL_RECURRING`, labeling non-repeating trend variance as predictable seasonality.

In V12.1, all three defects are resolved.

---

## 2. P0 Fix: Demand Lookup with Resolved ResearchProduct.id

### Implementation
In `src/services/kh02/evergreenResearchOrchestrator.ts`:
```typescript
let demandSeries: DemandDataPoint[] = [];

// Grounded: Only query historical demand if a real ResearchProduct.id was resolved
if (candidate.researchProductId) {
  demandSeries = await loadProductHistoricalDemand(candidate.researchProductId);
}
```
If a candidate is not yet linked to an authoritative `ResearchProduct` row, demand history fails closed as empty (`INSUFFICIENT_HISTORY`), preventing synthetic data fabrication.

---

## 3. Strict Time Series Quality Standards

In `src/services/kh02/demand/temporalDemandEngine.ts`:

1. **Deduplication & Chronological Ordering**: Deduplicates identical period keys (`periodStart::periodEnd`) and sorts observations ascending by start date.
2. **Minimum Window Threshold**:
   - `< 60 days`: Strictly fails closed as `INSUFFICIENT_HISTORY` (`stabilityScore = null`).
   - `60–89 days`: Provisional long-term evidence (`scoreStatus = "PROVISIONAL"`).
   - `≥ 90–365 days`: Eligible for verified evergreen scoring (`scoreStatus = "VERIFIED"`).
3. **Dead Flatline Classification**: Low mean search volume (`mean < 12`, `stdDev < 4`) is classified as `DECLINING` (score = 3/25), rejecting dead products.

---

## 4. Cyclical Seasonality vs Volatility

### The Problem
A moderate coefficient of variation (`CV between 0.20 and 0.60`) can occur in monotonic trends or random noise. Classifying this as annual recurring seasonality misled users.

### The Fix
Introduced `hasCyclicSwings` extrema analysis:
Requires detected alternating peaks and troughs across the time series to qualify as `SEASONAL_RECURRING` (18 pts).
If periodic waves cannot be established, the series is classified as `TREND_DEPENDENT` or `MODERATE_VARIATION`, and can never be promoted to `TEST_CANDIDATE`.
