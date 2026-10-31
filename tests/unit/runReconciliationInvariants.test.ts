import { describe, it, expect } from "vitest";
import {
  evaluateRunCountInvariants,
  RunCounts,
} from "@/services/research/runReconciliationService";

describe("Research Run Invariant Arithmetic & Reconciliation (Section 10)", () => {
  it("passes when all counts match legitimate clean ingestion", () => {
    const counts: RunCounts = {
      retrieved: 25,
      valid: 25,
      newUnique: 25,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 25,
      displayed: 25,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(true);
    expect(evalRes.violations).toHaveLength(0);
    expect(evalRes.explanations[0]).toContain("fully consistent");
  });

  it("passes when ingestion includes legitimate deduplication", () => {
    const counts: RunCounts = {
      retrieved: 25,
      valid: 25,
      newUnique: 18,
      duplicates: 7,
      rejected: 0,
      failed: 0,
      linked: 25,
      displayed: 25,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(true);
    expect(evalRes.violations).toHaveLength(0);
  });

  it("fails when valid count exceeds retrieved count (retrieved < valid)", () => {
    const counts: RunCounts = {
      retrieved: 10,
      valid: 15,
      newUnique: 15,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 15,
      displayed: 15,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "RETRIEVED_LESS_THAN_VALID")).toBe(true);
  });

  it("fails when valid partition arithmetic is inconsistent (valid !== newUnique + duplicates)", () => {
    const counts: RunCounts = {
      retrieved: 25,
      valid: 25,
      newUnique: 10,
      duplicates: 10, // sum is 20, valid is 25
      rejected: 0,
      failed: 0,
      linked: 25,
      displayed: 25,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "VALID_PARTITION_MISMATCH")).toBe(true);
  });

  it("fails when valid records do not match linked relations (valid !== linked)", () => {
    const counts: RunCounts = {
      retrieved: 25,
      valid: 25,
      newUnique: 25,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 20, // 5 missing linked relations
      displayed: 20,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "VALID_LINKED_MISMATCH")).toBe(true);
  });

  it("fails when linked records do not match displayed count", () => {
    const counts: RunCounts = {
      retrieved: 25,
      valid: 25,
      newUnique: 25,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 25,
      displayed: 20, // 5 missing from UI
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "LINKED_DISPLAYED_MISMATCH")).toBe(true);
  });

  it("detects and rejects negative count values", () => {
    const counts: RunCounts = {
      retrieved: -5,
      valid: 0,
      newUnique: 0,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 0,
      displayed: 0,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "NEGATIVE_COUNT")).toBe(true);
  });

  it("handles zero-result query truthfully and consistently", () => {
    const counts: RunCounts = {
      retrieved: 0,
      valid: 0,
      newUnique: 0,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 0,
      displayed: 0,
      quarantined: 0,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(true);
    expect(evalRes.violations).toHaveLength(0);
  });

  it("reports note when quarantined records are present without breaking display consistency", () => {
    const counts: RunCounts = {
      retrieved: 5,
      valid: 5,
      newUnique: 5,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 5,
      displayed: 5,
      quarantined: 2,
    };
    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(true);
    expect(evalRes.explanations.some((e) => e.includes("synthetic quarantine"))).toBe(true);
  });
});
