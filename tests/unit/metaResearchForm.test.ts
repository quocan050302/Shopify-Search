import { describe, it, expect } from "vitest";
import { validateMetaResearchForm } from "../../src/lib/meta/validateMetaResearchForm";

describe("validateMetaResearchForm", () => {
  it("rejects empty keywords", () => {
    const res = validateMetaResearchForm({
      keywordsInput: "   ,   ,   ",
      market: "US",
      requestedLimit: 25,
      creativePreference: "ALL",
      activeStatus: "ACTIVE",
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.keywords).toBe("Please enter at least one search keyword.");
    expect(res.cleanedKeywords).toEqual([]);
  });

  it("cleans, trims, and deduplicates keywords case-insensitively", () => {
    const res = validateMetaResearchForm({
      keywordsInput: "  pet hair remover,  DOG BRUSH , pet hair remover , cat comb  ",
      market: "US",
      requestedLimit: 25,
      creativePreference: "ALL",
      activeStatus: "ACTIVE",
    });

    expect(res.isValid).toBe(true);
    expect(res.cleanedKeywords).toEqual(["pet hair remover", "DOG BRUSH", "cat comb"]);
  });

  it("rejects keywords shorter than 2 characters", () => {
    const res = validateMetaResearchForm({
      keywordsInput: "a, gadget",
      market: "US",
      requestedLimit: 25,
      creativePreference: "ALL",
      activeStatus: "ACTIVE",
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.keywords).toContain('too short');
  });

  it("rejects more than 10 keywords", () => {
    const res = validateMetaResearchForm({
      keywordsInput: "k1, k2, k3, k4, k5, k6, k7, k8, k9, k10, k11",
      market: "US",
      requestedLimit: 25,
      creativePreference: "ALL",
      activeStatus: "ACTIVE",
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.keywords).toBe("Maximum 10 keywords allowed per search task.");
  });

  it("rejects requested limit exceeding effective provider budget", () => {
    const res = validateMetaResearchForm(
      {
        keywordsInput: "cleaning gadget",
        market: "US",
        requestedLimit: 50,
        creativePreference: "ALL",
        activeStatus: "ACTIVE",
      },
      { maxResultsPerSearch: 25 }
    );

    expect(res.isValid).toBe(false);
    expect(res.errors.limit).toContain("exceeds the effective collector capacity");
  });

  it("accepts valid request within budget", () => {
    const res = validateMetaResearchForm(
      {
        keywordsInput: "portable blender, smoothie cup",
        market: "US",
        requestedLimit: 25,
        creativePreference: "VIDEO",
        activeStatus: "ACTIVE",
        launchWithinDays: 30,
      },
      { maxResultsPerSearch: 25 }
    );

    expect(res.isValid).toBe(true);
    expect(res.cleanedKeywords).toEqual(["portable blender", "smoothie cup"]);
  });
});
