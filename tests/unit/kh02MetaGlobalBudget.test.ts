import { describe, it, expect } from "vitest";
import {
  MetaQueryBudgetTracker,
  buildKH02DiscoveryQueryPlan,
} from "@/services/kh02/discovery/discoveryQueryPlanner";

describe("SWAI KH-02 — Meta Global Query Budget Enforcement (12 Mandatory Scenarios)", () => {
  const defaultBudget = {
    maxLogicalSubqueries: 3,
    maxProviderRequests: 4,
    maxPages: 4,
    maxUniqueAds: 50,
    maxDurationMs: 45000,
  };

  it("1. Every query succeeds within budget", () => {
    const tracker = new MetaQueryBudgetTracker(defaultBudget);
    const r1 = tracker.reserveRequests(2);
    expect(r1).toBe(2);
    expect(tracker.remainingRequests).toBe(2);
    tracker.finalizeUsage(r1, 2, 10, 2);

    const r2 = tracker.reserveRequests(2);
    expect(r2).toBe(2);
    expect(tracker.remainingRequests).toBe(0);
    tracker.finalizeUsage(r2, 2, 15, 2);

    expect(tracker.isExhausted).toBe(true);
    expect(tracker.getUsage().actualProviderRequests).toBe(4);
    expect(tracker.getUsage().totalAdsCollected).toBe(25);
  });

  it("2. Every query fails — failed attempts remain accounted for and do not refund allowance", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 3 });
    const r1 = tracker.reserveRequests(2);
    expect(r1).toBe(2);
    tracker.recordFailure(r1);

    expect(tracker.remainingRequests).toBe(1);
    const r2 = tracker.reserveRequests(2);
    expect(r2).toBe(1); // Capped by remaining budget!
    tracker.recordFailure(r2);

    expect(tracker.remainingRequests).toBe(0);
    expect(tracker.canExecuteSubquery()).toBe(false);
    expect(tracker.reserveRequests(1)).toBe(0);
    expect(tracker.getUsage().actualProviderRequests).toBe(3);
  });

  it("3. First query fails, second succeeds within remaining budget", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 3 });
    const r1 = tracker.reserveRequests(2);
    expect(r1).toBe(2);
    tracker.recordFailure(r1);

    const r2 = tracker.reserveRequests(2);
    expect(r2).toBe(1); // only 1 remaining!
    tracker.finalizeUsage(r2, 1, 8, 1);

    expect(tracker.getUsage().actualProviderRequests).toBe(3);
    expect(tracker.getUsage().totalAdsCollected).toBe(8);
  });

  it("4. Last query fails — total usage still bounded strictly", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 3 });
    const r1 = tracker.reserveRequests(2);
    tracker.finalizeUsage(r1, 2, 12, 2);

    const r2 = tracker.reserveRequests(2);
    expect(r2).toBe(1);
    tracker.recordFailure(r2);

    expect(tracker.getUsage().actualProviderRequests).toBe(3);
    expect(tracker.canExecuteSubquery()).toBe(false);
  });

  it("5. One query succeeds empty — consumed requests remain counted", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 2 });
    const r1 = tracker.reserveRequests(2);
    tracker.finalizeUsage(r1, 2, 0, 1); // 0 ads

    expect(tracker.getUsage().actualProviderRequests).toBe(2);
    expect(tracker.getUsage().totalAdsCollected).toBe(0);
    expect(tracker.remainingRequests).toBe(0);
  });

  it("6. Partial success — tracks actual ads and requests accurately", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 4 });
    const r1 = tracker.reserveRequests(2);
    tracker.finalizeUsage(r1, 2, 5, 1);

    const r2 = tracker.reserveRequests(2);
    tracker.recordFailure(r2);

    const usage = tracker.getUsageSummary();
    expect(usage.consumedRequests).toBe(4);
    expect(usage.uniqueAdsObserved).toBe(5);
  });

  it("7. Provider timeout — failure records the reserved attempt", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 2 });
    const r1 = tracker.reserveRequests(2);
    // Timeout triggers catch block
    tracker.recordFailure(r1);

    expect(tracker.remainingRequests).toBe(0);
    expect(tracker.canExecuteSubquery()).toBe(false);
  });

  it("8. Retry after failure — retry must consume from remaining budget", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 3 });
    const r1 = tracker.reserveRequests(1);
    tracker.recordFailure(r1); // 1 consumed

    // Retry attempt
    const rRetry = tracker.reserveRequests(1);
    expect(rRetry).toBe(1);
    tracker.finalizeUsage(rRetry, 1, 4, 1); // 2 consumed total

    expect(tracker.remainingRequests).toBe(1);
  });

  it("9. Pagination — actual pages consumed reconciles properly", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 4 });
    const r1 = tracker.reserveRequests(3); // planned 3 pages
    // Only 1 page was available upstream
    tracker.finalizeUsage(r1, 1, 10, 1);

    // 2 unused requests refunded because only 1 page was requested upstream
    expect(tracker.getUsage().actualProviderRequests).toBe(1);
    expect(tracker.remainingRequests).toBe(3);
  });

  it("10. Concurrent reservation — atomic deduction prevents race overspend", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 3 });

    // Two parallel workers attempt to reserve 2 requests each
    const resA = tracker.reserveRequests(2);
    const resB = tracker.reserveRequests(2);

    expect(resA).toBe(2);
    expect(resB).toBe(1); // Capped by remaining allowance!
    expect(tracker.remainingRequests).toBe(0);
  });

  it("11. Budget exhausted before subquery — returns 0 reservation and stops execution", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxProviderRequests: 2 });
    const r1 = tracker.reserveRequests(2);
    tracker.finalizeUsage(r1, 2, 20, 2);

    expect(tracker.canExecuteSubquery()).toBe(false);
    expect(tracker.reserveRequests(1)).toBe(0);
  });

  it("12. Cancellation / max duration elapsed — stops immediately", () => {
    const tracker = new MetaQueryBudgetTracker({ ...defaultBudget, maxDurationMs: 0 });
    expect(tracker.isExhausted).toBe(true);
    expect(tracker.canExecuteSubquery()).toBe(false);
  });
});
