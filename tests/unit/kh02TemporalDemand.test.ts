import { describe, it, expect } from "vitest";
import {
  evaluateTemporalDemandStability,
  DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";

describe("SWAI KH-02 — Temporal Demand Engine", () => {
  it("fails closed with INSUFFICIENT_HISTORY when fewer than 3 valid data points exist", () => {
    const sparse: DemandDataPoint[] = [
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 50 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: null }, // Null point
    ];

    const result = evaluateTemporalDemandStability(sparse, 90);
    expect(result.demandClass).toBe("INSUFFICIENT_HISTORY");
    expect(result.stabilityScore).toBeNull();
    expect(result.eligibleForEvergreen).toBe(false);
  });

  it("fails closed when observation window is shorter than 60 days", () => {
    // 3 points, but spanning only 15 days
    const shortSpan: DemandDataPoint[] = [
      { periodStart: "2026-10-01", periodEnd: "2026-10-05", demandValue: 60 },
      { periodStart: "2026-10-06", periodEnd: "2026-10-10", demandValue: 62 },
      { periodStart: "2026-10-11", periodEnd: "2026-10-15", demandValue: 61 },
    ];

    const result = evaluateTemporalDemandStability(shortSpan, 90);
    expect(result.demandClass).toBe("INSUFFICIENT_HISTORY");
    expect(result.stabilityScore).toBeNull();
    expect(result.explanation).toContain("span only 14 days — short-term window cannot substantiate evergreen claims");
  });

  it("accurately classifies low-volatility multi-month demand as EVERGREEN_STABLE (25 pts)", () => {
    // 90-day time series with CV < 0.15 and mean = 65
    const stable: DemandDataPoint[] = [
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 64 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 66 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: 65 },
      { periodStart: "2026-10-01", periodEnd: "2026-10-31", demandValue: 64 },
    ];

    const result = evaluateTemporalDemandStability(stable, 90);
    expect(result.demandClass).toBe("EVERGREEN_STABLE");
    expect(result.stabilityScore).toBe(25);
    expect(result.eligibleForEvergreen).toBe(true);
    expect(result.coefficientOfVariation).toBeLessThan(0.1);
  });

  it("identifies seasonal waves as SEASONAL_RECURRING (18 pts)", () => {
    const seasonal: DemandDataPoint[] = [
      { periodStart: "2026-05-01", periodEnd: "2026-05-31", demandValue: 30 },
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 85 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 90 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 35 },
    ];

    const result = evaluateTemporalDemandStability(seasonal, 120);
    expect(result.demandClass).toBe("SEASONAL_RECURRING");
    expect(result.stabilityScore).toBe(18);
  });

  it("identifies emerging persistent demand when slope is positive and variation is contained", () => {
    const emerging: DemandDataPoint[] = [
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 40 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 50 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 60 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: 70 },
    ];

    const result = evaluateTemporalDemandStability(emerging, 120);
    expect(result.demandClass).toBe("EMERGING_PERSISTENT");
    expect(result.trendVelocity).toBe("ACCELERATING");
    expect(result.stabilityScore).toBe(22);
  });
});
