import { describe, it, expect } from "vitest";
import { compareEvidenceAcrossBoundaries } from "../../scripts/kh01/runFullAcceptance";
import { evaluateRunCountInvariants, RunCounts } from "../../src/services/research/runReconciliationService";

describe("KH-01 Cross-Boundary Reconciliation & Evidence Comparison (Section 12 & 17)", () => {
  it("passes when DB, HTTP, and Browser ad IDs match exactly", () => {
    const dbIds = ["ad_001", "ad_002", "ad_003"];
    const httpIds = ["ad_001", "ad_002", "ad_003"];
    const browserIds = ["ad_001", "ad_002", "ad_003"];

    const res = compareEvidenceAcrossBoundaries(dbIds, httpIds, browserIds);
    expect(res.consistent).toBe(true);
    expect(res.missingInHttp).toHaveLength(0);
    expect(res.unexpectedInHttp).toHaveLength(0);
    expect(res.missingInBrowser).toHaveLength(0);
    expect(res.unexpectedInBrowser).toHaveLength(0);
  });

  it("fails when counts are equal but ad IDs differ (no superficial count match)", () => {
    const dbIds = ["ad_001", "ad_002", "ad_003"];
    const httpIds = ["ad_001", "ad_002", "ad_004"]; // count is 3, but different ID
    const browserIds = ["ad_001", "ad_002", "ad_003"];

    const res = compareEvidenceAcrossBoundaries(dbIds, httpIds, browserIds);
    expect(res.consistent).toBe(false);
    expect(res.missingInHttp).toContain("ad_003");
    expect(res.unexpectedInHttp).toContain("ad_004");
  });

  it("detects ad missing from HTTP readback", () => {
    const dbIds = ["ad_001", "ad_002", "ad_003"];
    const httpIds = ["ad_001", "ad_002"];
    const browserIds = ["ad_001", "ad_002"];

    const res = compareEvidenceAcrossBoundaries(dbIds, httpIds, browserIds);
    expect(res.consistent).toBe(false);
    expect(res.missingInHttp).toContain("ad_003");
    expect(res.missingInBrowser).toContain("ad_003");
  });

  it("detects ad missing from Browser UI render", () => {
    const dbIds = ["ad_001", "ad_002", "ad_003"];
    const httpIds = ["ad_001", "ad_002", "ad_003"];
    const browserIds = ["ad_001", "ad_002"]; // Browser only rendered 2

    const res = compareEvidenceAcrossBoundaries(dbIds, httpIds, browserIds);
    expect(res.consistent).toBe(false);
    expect(res.missingInBrowser).toContain("ad_003");
  });

  it("detects unexpected unrelated ad injected into Browser UI", () => {
    const dbIds = ["ad_001", "ad_002"];
    const httpIds = ["ad_001", "ad_002"];
    const browserIds = ["ad_001", "ad_002", "ad_unrelated_foreign"];

    const res = compareEvidenceAcrossBoundaries(dbIds, httpIds, browserIds);
    expect(res.consistent).toBe(false);
    expect(res.unexpectedInBrowser).toContain("ad_unrelated_foreign");
  });

  it("fails when database ledger has 0 records even if arrays match as empty", () => {
    const res = compareEvidenceAcrossBoundaries([], [], []);
    // Empty result cannot prove ad collection
    expect(res.consistent).toBe(false);
  });

  it("reconcile invariants fail when linked count does not match displayed count", () => {
    const counts: RunCounts = {
      retrieved: 5,
      valid: 5,
      newUnique: 5,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      linked: 5,
      displayed: 4, // HTTP or Browser dropped 1 record
      quarantined: 0,
    };

    const evalRes = evaluateRunCountInvariants(counts);
    expect(evalRes.consistent).toBe(false);
    expect(evalRes.violations.some((v) => v.code === "LINKED_DISPLAYED_MISMATCH")).toBe(true);
  });
});
