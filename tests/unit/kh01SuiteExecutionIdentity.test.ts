import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  collectExecutedSuiteEvidence,
  validateRequiredSuiteCoverage,
  TestExecutionEnvelope,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Suite Execution Identity & Envelopes (FINAL-08-04)", () => {
  const scratchDir = path.resolve(process.cwd(), "artifacts/.scratch-test-suite-id");
  const dummyRunId = "kh01_rel_test_env_123";
  const dummySha = "cd32c5a1feac9313ce90177c9013f525d2eb41ed";

  beforeAll(() => {
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(scratchDir)) {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    } catch {}
  });

  function createSampleVitestReport(testFilePath: string, passed = 5, failed = 0, skipped = 0): string {
    const reportData = {
      numTotalTestSuites: 1,
      numPassedTestSuites: failed === 0 ? 1 : 0,
      numFailedTestSuites: failed > 0 ? 1 : 0,
      testResults: [
        {
          name: path.resolve(process.cwd(), testFilePath),
          status: failed === 0 ? "passed" : "failed",
          assertionResults: [
            ...Array.from({ length: passed }, (_, i) => ({
              status: "passed",
              title: `Test passed assertion ${i + 1}`,
            })),
            ...Array.from({ length: failed }, (_, i) => ({
              status: "failed",
              title: `Test failed assertion ${i + 1}`,
            })),
            ...Array.from({ length: skipped }, (_, i) => ({
              status: "skipped",
              title: `Test skipped assertion ${i + 1}`,
            })),
          ],
        },
      ],
    };

    const outPath = path.join(scratchDir, `report_${crypto.randomUUID().slice(0, 8)}.json`);
    fs.writeFileSync(outPath, JSON.stringify(reportData, null, 2), "utf8");
    return outPath;
  }

  it("successfully collects suite evidence from valid execution envelopes", () => {
    const testFile = "tests/unit/adminAuthTrustBoundary.test.ts";
    const reportPath = createSampleVitestReport(testFile, 4, 0, 0);
    const reportSha256 = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");

    const envelope: TestExecutionEnvelope = {
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      stageId: "STAGE_03A_SECURITY_SUITE",
      command: "npx vitest run ...",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      processId: process.pid,
      exitCode: 0,
      reportPath,
      reportSha256,
      reportCreatedDuringExecution: true,
      executionIdentityVerified: true,
    };

    const suites = collectExecutedSuiteEvidence([envelope]);
    expect(suites.length).toBe(1);
    expect(suites[0].testFile).toBe(testFile);
    expect(suites[0].acceptanceRunId).toBe(dummyRunId);
    expect(suites[0].testedCommitSha).toBe(dummySha);
    expect(suites[0].passed).toBe(4);
    expect(suites[0].failed).toBe(0);
    expect(suites[0].actuallyExecuted).toBe(true);
    expect(suites[0].evidenceOrigin).toBe("ACTUAL_TEST_EXECUTION");
  });

  it("rejects suite when report SHA256 does not match envelope (tampered or stale report)", () => {
    const testFile = "tests/unit/adminAuthTrustBoundary.test.ts";
    const reportPath = createSampleVitestReport(testFile, 4, 0, 0);

    const envelope: TestExecutionEnvelope = {
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      stageId: "STAGE_03A_SECURITY_SUITE",
      command: "npx vitest run ...",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      processId: process.pid,
      exitCode: 0,
      reportPath,
      reportSha256: "corrupted_or_mismatched_sha256_hash",
      reportCreatedDuringExecution: true,
      executionIdentityVerified: true,
    };

    const suites = collectExecutedSuiteEvidence([envelope]);
    expect(suites.length).toBe(0);
  });

  it("rejects suite when process exit code is nonzero", () => {
    const testFile = "tests/unit/adminAuthTrustBoundary.test.ts";
    const reportPath = createSampleVitestReport(testFile, 1, 1, 0);
    const reportSha256 = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");

    const envelope: TestExecutionEnvelope = {
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      stageId: "STAGE_03A_SECURITY_SUITE",
      command: "npx vitest run ...",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      processId: process.pid,
      exitCode: 1,
      reportPath,
      reportSha256,
      reportCreatedDuringExecution: true,
      executionIdentityVerified: false,
    };

    const suites = collectExecutedSuiteEvidence([envelope]);
    expect(suites.length).toBe(0);
  });

  it("validateRequiredSuiteCoverage fails if suite executed on different commit SHA", () => {
    const testFile = "tests/unit/adminAuthTrustBoundary.test.ts";
    const reportPath = createSampleVitestReport(testFile, 3, 0, 0);
    const reportSha256 = crypto.createHash("sha256").update(fs.readFileSync(reportPath)).digest("hex");

    const envelope: TestExecutionEnvelope = {
      acceptanceRunId: dummyRunId,
      testedCommitSha: "older_sha_12345",
      stageId: "STAGE_03A_SECURITY_SUITE",
      command: "npx vitest run ...",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date().toISOString(),
      processId: process.pid,
      exitCode: 0,
      reportPath,
      reportSha256,
      reportCreatedDuringExecution: true,
      executionIdentityVerified: true,
    };

    const suites = collectExecutedSuiteEvidence([envelope]);
    const res = validateRequiredSuiteCoverage([testFile], suites, {
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
    });

    expect(res.passed).toBe(false);
    expect(res.errors[0]).toContain("testedCommitSha mismatch");
  });
});
