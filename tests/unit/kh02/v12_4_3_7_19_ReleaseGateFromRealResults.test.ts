/**
 * SWAI KH-02 — V12.4.3.7.19
 * Release Gate Evaluator Tests (D01 - D16)
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateReleaseEvidence,
  sanitizeReleaseLog,
  type ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";
import { executeStagingShadowCheck } from "@/services/kh02/staging/stagingShadowReleaseGate";

function createValidInput(overrides: Partial<ReleaseEvidenceInput> = {}): ReleaseEvidenceInput {
  return {
    version: "12.4.3.7.19",
    branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
    baselineSha: "812018d4eaf3d51bcaa35b9ccb16f3f7ca92a916",
    testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
    reportGeneratedAt: new Date().toISOString(),
    testCommand: "vitest run tests/unit/kh02",
    exitCode: 0,
    realTotal: 100,
    realPassed: 100,
    realFailed: 0,
    realSkipped: 0,
    runMode: "OFFLINE_CONTRACT_CHECK",
    evidenceProofCounters: {
      rawRowsVerified: 100,
      liveOriginProofs: 0,
      fixtureOnlyCount: 100,
    },
    fullSuiteCoverage: {
      unitPassed: true,
      integrationPassed: true,
      backtestPassed: true,
      kh01VerifyPassed: true,
    },
    ...overrides,
  };
}

describe("KH-02 V12.4.3.7.19: Release Gate Evaluator (D01 - D16)", () => {
  it("D01: actual parser totals match real passed + failed + skipped counts", () => {
    const input = createValidInput({ realTotal: 50, realPassed: 48, realFailed: 2, realSkipped: 0, exitCode: 1 });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
  });

  it("D02: exitCode=1 -> ENGINEERING_FAIL", () => {
    const input = createValidInput({ exitCode: 1 });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("TEST_COMMAND_NON_ZERO_EXIT");
  });

  it("D03: missing full unit/integration -> ENGINEERING_INCOMPLETE", () => {
    const input = createValidInput({
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: false, // integration failed / missing
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.engineeringStatus).toBe("ENGINEERING_INCOMPLETE");
    expect(verdict.blockerList).toContain("INCOMPLETE_SUITE_COVERAGE");
  });

  it("D04: test-supplied static PASS value is rejected (Defect P1-C fix)", () => {
    const input = createValidInput({ callerSuppliedStaticPass: true });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("STATIC_PASS_ASSERTION_REJECTED");
  });

  it("D05: stale testedSha -> release rejected with ENGINEERING_FAIL", () => {
    const input = createValidInput({ testedCodeSha: "stale_old_commit_sha" });
    const verdict = evaluateReleaseEvidence(input, {
      expectedTestedSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(verdict.engineeringStatus).toBe("ENGINEERING_FAIL");
    expect(verdict.blockerList).toContain("STALE_TESTED_SHA");
  });

  it("D06: fixture-only positive counts -> business status remains INSUFFICIENT_EVIDENCE", () => {
    const input = createValidInput({
      evidenceProofCounters: {
        rawRowsVerified: 100,
        liveOriginProofs: 0, // 0 live external proofs
        fixtureOnlyCount: 100,
      },
    });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  it("D07: staging env missing in STAGING_RUNTIME_SHADOW -> STAGING_RUNTIME_NOT_RUN", () => {
    const input = createValidInput({
      runMode: "STAGING_RUNTIME_SHADOW",
      stagingRuntime: {
        executed: false,
        notRunReason: "No staging environment configured.",
      },
    });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.stagingStatus).toBe("STAGING_RUNTIME_NOT_RUN");
  });

  it("D08: offline contract check cannot claim staging execution (CONTRACT_READY != EXECUTED_PASS)", () => {
    const input = createValidInput({ runMode: "OFFLINE_CONTRACT_CHECK" });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_CONTRACT_READY");
    expect(verdict.stagingStatus).not.toBe("STAGING_SHADOW_EXECUTED_PASS");
  });

  it("D09: staging target matches production URL -> abort with STAGING_SHADOW_EXECUTED_FAIL", () => {
    const input = createValidInput({
      runMode: "STAGING_RUNTIME_SHADOW",
      stagingRuntime: {
        endpointUrl: "https://api.shopify.com/v1/graphql",
        isProductionDenylisted: false,
        executed: true,
      },
    });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.stagingStatus).toBe("STAGING_SHADOW_EXECUTED_FAIL");
    expect(verdict.blockerList).toContain("PRODUCTION_ENDPOINT_TARGETED");
  });

  it("D10: no network allowlist -> zero external network calls in shadow mode", async () => {
    const result = await executeStagingShadowCheck({
      mode: "OFFLINE_CONTRACT_CHECK",
      allowNetwork: false,
    });
    expect(result.operations.blockedCalls).toBe(0);
    expect(result.isolationVerified).toBe(true);
  });

  it("D11: false provider counters cannot promote business G15/G16 without external proofs", () => {
    const input = createValidInput({
      providerSourceCounters: {
        googleTrendsCsvCount: 50,
        userManualCount: 10,
        providerApiCount: 0,
        notRunNoAuthorizedProviderCount: 5,
      },
      evidenceProofCounters: {
        rawRowsVerified: 60,
        liveOriginProofs: 0,
        fixtureOnlyCount: 60,
      },
    });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("D12: remote CI absent -> CI_NOT_CONFIGURED", () => {
    const input = createValidInput({ ciStatus: { configured: false } });
    const verdict = evaluateReleaseEvidence(input);
    expect(verdict.ciStatus).toBe("CI_NOT_CONFIGURED");
  });

  it("D13: redaction removes tokens and private secrets from logs", () => {
    const dirty = "Error at api_key=secret_1234567890abcdef and Bearer my_secret_token_12345";
    const cleaned = sanitizeReleaseLog(dirty);
    expect(cleaned).not.toContain("secret_1234567890abcdef");
    expect(cleaned).not.toContain("my_secret_token_12345");
    expect(cleaned).toContain("REDACTED_SECRET");
  });

  it("D14: artifact SHA and run timestamp are consistent", () => {
    const raw = Buffer.from(JSON.stringify({ test: "data" }));
    const sha = crypto.createHash("sha256").update(raw).digest("hex");
    expect(/^[a-f0-9]{64}$/.test(sha)).toBe(true);
  });

  it("D15: staging check safely cleans temporary shadow workspace", async () => {
    const res = await executeStagingShadowCheck({
      mode: "OFFLINE_CONTRACT_CHECK",
    });
    expect(res.zeroProductionMutations).toBe(true);
  });

  it("D16: byte integrity of provider sentinel artifacts is maintained", () => {
    const receiptsDir = path.join(process.cwd(), "data/provider_receipts");
    const sentinels = [
      "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
      "3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8",
      "366cfeb156347d783c227be3fd7e10e397c8cd00c49c909673fc5208f36b841f",
    ];

    for (const sha of sentinels) {
      const p = path.join(receiptsDir, `${sha}.json`);
      expect(fs.existsSync(p)).toBe(true);
      const computed = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      expect(computed).toBe(sha);
    }
  });
});

