/**
 * ANTI — KH-02 V12.4.3.7.19.1
 * Release Evaluator Durable Evidence Tests (G01 - G22)
 *
 * Verifies:
 * 1. Derivation of engineering status strictly from actual test logs and suite coverage.
 * 2. Rejection of caller-declared static passes, zero counts, mismatched totals, and stale SHAs.
 * 3. Enforcing that pre-production states (CONTRACT_READY, CI_NOT_CONFIGURED, INSUFFICIENT_EVIDENCE)
 *    strictly produce overallReleaseAllowed = false.
 * 4. Sanitization of logs to prevent secret leakage while preserving 64-hex SHA digests.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateReleaseEvidence,
  sanitizeReleaseLog,
  ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";

describe("KH-02 V12.4.3.7.19.1: Release Evaluator Durable Evidence (G01 - G22)", () => {
  const baseSha = "0123456789abcdef0123456789abcdef01234567";
  const lockedBranch = "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1";

  const validPassingInput: ReleaseEvidenceInput = {
    version: "12.4.3.7.19.1",
    baselineSha: baseSha,
    reportGeneratedAt: new Date().toISOString(),
    testCommand: "npx vitest run tests/unit/kh02/v12_4_3_7_19_1_*",
    testedCodeSha: baseSha,
    branch: lockedBranch,
    exitCode: 0,
    realPassed: 50,
    realFailed: 0,
    realSkipped: 0,
    realTotal: 50,
    runMode: "OFFLINE_CONTRACT_CHECK",
    fullSuiteCoverage: {
      unitPassed: true,
      integrationPassed: true,
      backtestPassed: true,
      kh01VerifyPassed: true,
    },
    backtestResults: {
      devHistoricalPassed: true,
      holdoutHistoricalPassed: true,
      policyReplayPassed: true,
    },
    ciStatus: {
      configured: false,
    },
    evidenceProofCounters: {
      rawRowsVerified: 50,
      liveOriginProofs: 0,
      fixtureOnlyCount: 0,
    },
  };

  it("G01: missing fullSuiteCoverage => ENGINEERING_INCOMPLETE", () => {
    const input = { ...validPassingInput, fullSuiteCoverage: undefined };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_INCOMPLETE");
    expect(verdict.blockerList).toContain("MISSING_SUITE_COVERAGE");
  });

  it("G02: caller all true / static pass assertion rejected => ENGINEERING_FAIL", () => {
    const input = { ...validPassingInput, callerSuppliedStaticPass: true };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("STATIC_PASS_ASSERTION_REJECTED");
  });

  it("G03: inconsistent test totals => ENGINEERING_FAIL", () => {
    const input = { ...validPassingInput, realTotal: 100, realPassed: 50, realFailed: 0, realSkipped: 0 };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("TEST_COUNT_MISMATCH");
  });

  it("G04: failed exitCode => ENGINEERING_FAIL", () => {
    const input = { ...validPassingInput, exitCode: 1 };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("TEST_COMMAND_NON_ZERO_EXIT");
  });

  it("G05: zero-test count => ENGINEERING_INCOMPLETE", () => {
    const input = { ...validPassingInput, realTotal: 0, realPassed: 0 };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_INCOMPLETE");
    expect(verdict.blockerList).toContain("ZERO_TESTS_EXECUTED");
  });

  it("G06: stale commit SHA => ENGINEERING_FAIL", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, {
      expectedTestedSha: "different_sha_1234567890abcdef",
      expectedBranch: lockedBranch,
    });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("STALE_TESTED_SHA");
  });

  it("G07: branch mismatch => ENGINEERING_FAIL", () => {
    const input = { ...validPassingInput, branch: "main" };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("BRANCH_MISMATCH");
  });

  it("G08: CI_NOT_CONFIGURED => overallReleaseAllowed = false", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.ciStatus).toBe("CI_NOT_CONFIGURED");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  it("G09: CI_NOT_RUN => overallReleaseAllowed = false", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      ciStatus: { configured: true, runStatus: "PENDING" },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  it("G10: staging CONTRACT_READY only => overallReleaseAllowed = false", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_CONTRACT_READY");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  it("G11: staging EXECUTED_PASS but targeting production denylist host => EXECUTED_FAIL", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      runMode: "STAGING_RUNTIME_SHADOW",
      stagingRuntime: {
        endpointUrl: "https://api.shopify.com/v1/ping",
        isProductionDenylisted: false,
        executed: true,
        readinessStatus: "EXECUTED_PASS",
      },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_EXECUTED_FAIL");
    expect(verdict.blockerList).toContain("PRODUCTION_ENDPOINT_TARGETED");
  });

  it("G12: 3 self-declared liveOriginProofs with no 60-day history => INSUFFICIENT_EVIDENCE", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      evidenceProofCounters: { rawRowsVerified: 50, liveOriginProofs: 3, fixtureOnlyCount: 0 },
      backtestResults: {
        devHistoricalPassed: false, // failed
        holdoutHistoricalPassed: false,
        policyReplayPassed: true,
      },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("G13: missing backtestResults => INSUFFICIENT_EVIDENCE", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      evidenceProofCounters: { rawRowsVerified: 50, liveOriginProofs: 3, fixtureOnlyCount: 0 },
      backtestResults: undefined,
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("G14: historical DEV/HOLDOUT insufficient => INSUFFICIENT_EVIDENCE", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      evidenceProofCounters: { rawRowsVerified: 50, liveOriginProofs: 3, fixtureOnlyCount: 0 },
      backtestResults: {
        devHistoricalPassed: true,
        holdoutHistoricalPassed: false,
        policyReplayPassed: true,
      },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("G15: G06 unverified => business BLOCKED", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      businessG06Status: "BLOCKED",
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("BLOCKED");
  });

  it("G16: G07 deferred => business BLOCKED", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      businessG07Status: "BLOCKED",
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("BLOCKED");
  });

  it("G17: fixtures/CSV cannot counterfeit live provider proofs (INSUFFICIENT_EVIDENCE)", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      evidenceProofCounters: { rawRowsVerified: 50, liveOriginProofs: 0, fixtureOnlyCount: 10 },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("G18: genuine test logs with correct SHA and suite coverage => local engineering PASS only", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_PASS");
    expect(verdict.overallReleaseAllowed).toBe(false); // local engineering PASS does not open production release
  });

  it("G19: missing/incomplete suite coverage => ENGINEERING_INCOMPLETE", () => {
    const input: ReleaseEvidenceInput = {
      ...validPassingInput,
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: false,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    };
    const verdict = evaluateReleaseEvidence(input, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_INCOMPLETE");
    expect(verdict.blockerList).toContain("INCOMPLETE_SUITE_COVERAGE");
  });

  it("G20: sanitized reports exclude secrets while retaining 64-hex SHA-256 digests", () => {
    const secretText = "API_KEY=sk_live_secret1234567890abcdef and hash=3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8";
    const sanitized = sanitizeReleaseLog(secretText);

    expect(sanitized).not.toContain("sk_live_secret1234567890abcdef");
    expect(sanitized).toContain("3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8");
  });

  it("G21: no overallReleaseAllowed while mandatory gates are missing", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  it("G22: staging result linked to runMode and evaluation details", () => {
    const verdict = evaluateReleaseEvidence(validPassingInput, { expectedTestedSha: baseSha, expectedBranch: lockedBranch });

    expect(verdict.evaluatorVersion).toBe("12.4.3.7.19.1");
    expect(verdict.evaluatedAt).toBeDefined();
    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_CONTRACT_READY");
  });
});

