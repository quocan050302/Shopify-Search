import { describe, it, expect } from "vitest";
import { getAllowedResearchLimits } from "@/lib/meta/getAllowedResearchLimits";

describe("getAllowedResearchLimits", () => {
  it("computes allowed limits for capacity = 1", () => {
    const limits = getAllowedResearchLimits(1);
    expect(limits).toEqual([1]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(1);
  });

  it("computes allowed limits for capacity = 5", () => {
    const limits = getAllowedResearchLimits(5);
    expect(limits).toEqual([5]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(5);
  });

  it("computes allowed limits for capacity = 10", () => {
    const limits = getAllowedResearchLimits(10);
    expect(limits).toEqual([5, 10]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(10);
  });

  it("computes allowed limits for capacity = 20", () => {
    const limits = getAllowedResearchLimits(20);
    expect(limits).toEqual([5, 10, 15, 20]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(20);
  });

  it("computes allowed limits for capacity = 25 (standard default)", () => {
    const limits = getAllowedResearchLimits(25);
    expect(limits).toEqual([5, 10, 15, 20, 25]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(25);
  });

  it("computes allowed limits for capacity = 50", () => {
    const limits = getAllowedResearchLimits(50);
    expect(limits).toEqual([5, 10, 15, 20, 25, 50]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(50);
  });

  it("computes allowed limits for capacity = 100", () => {
    const limits = getAllowedResearchLimits(100);
    expect(limits).toEqual([5, 10, 15, 20, 25, 50, 100]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(100);
  });

  it("handles non-standard capacity like 17 cleanly", () => {
    const limits = getAllowedResearchLimits(17);
    expect(limits).toEqual([5, 10, 15, 17]);
    expect(Math.max(...limits)).toBeLessThanOrEqual(17);
  });

  it("fails safely on invalid or negative capacities", () => {
    expect(getAllowedResearchLimits(0)).toEqual([1]);
    expect(getAllowedResearchLimits(-10)).toEqual([1]);
    expect(getAllowedResearchLimits(NaN as any)).toEqual([1]);
  });
});
