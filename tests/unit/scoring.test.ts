import { describe, it, expect } from "vitest";
import {
  normalizeResearchSignal,
  calculateEvidenceConfidence,
  calculateWinningPotentialScore,
} from "@/services/scoring/scoringEngine";

describe("Winning Potential Scoring Engine", () => {
  it("normalizes signal values to 0-100 scale", () => {
    expect(normalizeResearchSignal(45, 90)).toBe(50);
    expect(normalizeResearchSignal(90, 90)).toBe(100);
    expect(normalizeResearchSignal(150, 90)).toBe(100);
    expect(normalizeResearchSignal(-5, 90)).toBe(0);
  });

  it("calculates high potential for long-running active ads with variants", () => {
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    const result = calculateWinningPotentialScore({
      firstSeenAt: fortyDaysAgo,
      lastSeenAt: now,
      variantCount: 6,
      status: "ACTIVE",
      hasLandingPage: true,
      hasCallToAction: true,
      aiQualityScore: 85,
    });

    expect(result.totalScore).toBeGreaterThanOrEqual(65);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(70);
    expect(["HIGH_POTENTIAL", "MEDIUM_POTENTIAL"]).toContain(result.tier);
    expect(result.components.longevity.daysActive).toBeGreaterThanOrEqual(40);
  });

  it("flags insufficient evidence when confidence is low", () => {
    const now = new Date();

    const result = calculateWinningPotentialScore({
      firstSeenAt: now,
      lastSeenAt: now,
      status: "UNKNOWN",
      hasLandingPage: false,
      hasCallToAction: false,
    });

    expect(result.confidenceScore).toBeLessThan(40);
    expect(result.tier).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.missingSignals).toContain("GENUINE_ENGAGEMENT_METRICS");
  });
});
