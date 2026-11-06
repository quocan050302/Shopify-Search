/**
 * ANTI — KH-02 V12.4.3.7.18.2: FINAL RELEASE GATE & THREEFOLD READINESS
 *
 * Verifies the final release gate requirements:
 * 1. Engineering readiness: provider origin admission strictly fail-closed.
 * 2. Staging readiness: staging shadow-only authorized; live network flag disabled.
 * 3. Business evidence readiness: G06, G07, G15, G16, and historical backtests
 *    remain strictly fail-closed / insufficient without optimistic promotion.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  evaluateDemandHistoryEvidence,
  evaluateDemandSourceAuthority,
} from "@/services/kh02/demand/temporalDemandEngine";
import { evaluateReleaseEvidence } from "@/services/kh02/release/releaseGateEvaluatorV19";

describe("KH-02 V12.4.3.7.18.2: Final Release Gate (RG01 - RG06)", () => {
  it("RG01: Environment hygiene — ENABLE_LIVE_NETWORK_FETCHER is not true in test environment", () => {
    expect(process.env.ENABLE_LIVE_NETWORK_FETCHER).not.toBe("true");
  });

  it("RG02: G15 remains fail-closed (INSUFFICIENT_EVIDENCE) without genuine longitudinal provider data", () => {
    // Evaluating empty or unverified observations returns INSUFFICIENT_HISTORY
    const assessment = evaluateDemandHistoryEvidence([]);
    expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(assessment.temporalCoverageValid).toBe(false);
    expect(assessment.eligibleForEvergreen).toBe(false);
  });

  it("RG03: USER_MANUAL observations never open G15 authority", () => {
    const auth = evaluateDemandSourceAuthority([
      {
        source: "USER_MANUAL",
        keyword: "cat water fountain",
        region: "US",
        periodStart: new Date("2026-07-01"),
        demandValue: 50,
      },
    ]);
    expect(auth.authority).toBe("CACHED_UNVERIFIED");
    expect(auth.productAttributionValid).toBe(false);
  });

  it("RG04: Unit fixture observations remain FIXTURE_ONLY and cannot verify Evergreen winners", () => {
    const auth = evaluateDemandSourceAuthority([
      {
        source: "GOOGLE_TRENDS_LIVE",
        isFixture: true,
        keyword: "cat water fountain",
        region: "US",
        periodStart: new Date("2026-07-01"),
        demandValue: 75,
      },
    ]);
    expect(auth.authority).toBe("FIXTURE_ONLY");
    expect(auth.productAttributionValid).toBe(false);
  });

  it("RG05: Provider sentinel artifacts byte-for-byte SHA matches filename", () => {
    const receiptsDir = path.join(process.cwd(), "data/provider_receipts");
    const sentinels = [
      "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
      "3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8",
      "366cfeb156347d783c227be3fd7e10e397c8cd00c49c909673fc5208f36b841f",
    ];

    for (const sha of sentinels) {
      const filePath = path.join(receiptsDir, `${sha}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      const bytes = fs.readFileSync(filePath);
      const computed = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(computed).toBe(sha);
    }
  });

  it("RG06: Release decision table invariant: Engineering PASS != Business GO (Defect P1-C fixed)", () => {
    // Assert separation of concerns via pure deterministic evaluator:
    // Engineering verdict: ENGINEERING_PASS
    // Staging verdict: STAGING_SHADOW_CONTRACT_READY
    // Business evidence verdict: INSUFFICIENT_EVIDENCE
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      baselineSha: "812018d4eaf3d51bcaa35b9ccb16f3f7ca92a916",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "vitest run tests/unit/kh02",
      exitCode: 0,
      realTotal: 38,
      realPassed: 38,
      realFailed: 0,
      realSkipped: 0,
      runMode: "OFFLINE_CONTRACT_CHECK",
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
      evidenceProofCounters: {
        rawRowsVerified: 38,
        liveOriginProofs: 0, // 0 live external proofs
        fixtureOnlyCount: 38,
      },
    });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_PASS");
    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_CONTRACT_READY");
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });
});
