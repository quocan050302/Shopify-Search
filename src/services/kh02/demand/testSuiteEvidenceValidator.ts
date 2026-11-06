/**
 * Test Suite Execution Evidence Validator
 *
 * Implements strict engineering verification of test execution outputs and artifacts.
 * Eliminates no-op assertions and ensures that suite coverage and test counts are
 * derived from authentic runner logs, exit codes, and commit SHAs.
 *
 * Requirements: KH-02 V12.4.3.7.19.3 (Fix B)
 */

import fs from "fs";
import crypto from "crypto";

export type TestSuiteExecutionStatus = "PASS" | "FAIL" | "INCOMPLETE" | "STALE" | "NOT_RUN";

export interface TestSuiteExecutionEvidenceInput {
  command: string;
  exitCode: number;
  stdout?: string | null;
  stderr?: string | null;
  logFilePath?: string | null;
  checkoutSha: string;
  expectedCheckoutSha?: string | null;
  mandatoryTestFiles?: string[];
  callerClaimsFullCoverage?: boolean;
}

export interface ParsedRunnerMetrics {
  testFilesTotal: number;
  testFilesPassed: number;
  testFilesFailed: number;
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  executedFilePaths: string[];
}

export interface TestSuiteValidationReport {
  status: TestSuiteExecutionStatus;
  valid: boolean;
  command: string;
  exitCode: number;
  checkoutSha: string;
  logFileSha256: string | null;
  logFileBytes: number;
  metrics: ParsedRunnerMetrics;
  missingMandatoryFiles: string[];
  rejectionReasons: string[];
  verifiedAt: string;
}

/**
 * Parses Vitest / Node test runner stdout text into structured test execution counts.
 */
export function parseVitestOutputMetrics(output: string): ParsedRunnerMetrics {
  const metrics: ParsedRunnerMetrics = {
    testFilesTotal: 0,
    testFilesPassed: 0,
    testFilesFailed: 0,
    testsTotal: 0,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    executedFilePaths: [],
  };

  if (!output || typeof output !== "string") {
    return metrics;
  }

  // Parse "Test Files  X passed (X)" or "Test Files  X passed | Y failed (Z)"
  const testFilesMatch = output.match(/Test Files\s+([^\n\r]+)/i);
  if (testFilesMatch) {
    const line = testFilesMatch[1];
    const passedMatch = line.match(/(\d+)\s+passed/i);
    const failedMatch = line.match(/(\d+)\s+failed/i);
    const totalMatch = line.match(/\((\d+)\)/);
    if (passedMatch) metrics.testFilesPassed = parseInt(passedMatch[1], 10);
    if (failedMatch) metrics.testFilesFailed = parseInt(failedMatch[1], 10);
    if (totalMatch) {
      metrics.testFilesTotal = parseInt(totalMatch[1], 10);
    } else {
      metrics.testFilesTotal = metrics.testFilesPassed + metrics.testFilesFailed;
    }
  }

  // Parse "Tests  X passed (X)" or "Tests  X passed | Y failed | Z skipped (T)"
  const testsMatch = output.match(/Tests\s+([^\n\r]+)/i);
  if (testsMatch) {
    const line = testsMatch[1];
    const passedMatch = line.match(/(\d+)\s+passed/i);
    const failedMatch = line.match(/(\d+)\s+failed/i);
    const skippedMatch = line.match(/(\d+)\s+skipped/i);
    const totalMatch = line.match(/\((\d+)\)/);
    if (passedMatch) metrics.testsPassed = parseInt(passedMatch[1], 10);
    if (failedMatch) metrics.testsFailed = parseInt(failedMatch[1], 10);
    if (skippedMatch) metrics.testsSkipped = parseInt(skippedMatch[1], 10);
    if (totalMatch) {
      metrics.testsTotal = parseInt(totalMatch[1], 10);
    } else {
      metrics.testsTotal = metrics.testsPassed + metrics.testsFailed + metrics.testsSkipped;
    }
  }

  // Match executed file paths from Vitest output lines like " ✓ tests/unit/kh02/foo.test.ts"
  const fileLines = output.matchAll(/(?:✓|×|FAIL|PASS)\s+([a-zA-Z0-9_\-./\\]+\.test\.ts)/g);
  const pathSet = new Set<string>();
  for (const m of fileLines) {
    if (m[1]) {
      pathSet.add(m[1].replace(/\\/g, "/"));
    }
  }
  metrics.executedFilePaths = Array.from(pathSet);

  return metrics;
}

/**
 * Validates test suite execution evidence strictly against commit checkout, durable logs, and exit codes.
 */
export function validateTestSuiteExecutionEvidence(
  input: TestSuiteExecutionEvidenceInput
): TestSuiteValidationReport {
  const rejectionReasons: string[] = [];
  const verifiedAt = new Date().toISOString();

  // 1. Validate checkout SHA parity
  if (input.expectedCheckoutSha && input.checkoutSha !== input.expectedCheckoutSha) {
    rejectionReasons.push(
      `Execution checkout SHA mismatch: log was produced on '${input.checkoutSha}', but current expected checkout is '${input.expectedCheckoutSha}' (STALE_LOG).`
    );
  }

  // 2. Validate exit code
  if (input.exitCode !== 0) {
    rejectionReasons.push(`Command '${input.command}' exited with non-zero exit code: ${input.exitCode}.`);
  }

  // 3. Obtain raw log content
  let rawContent = input.stdout || "";
  let logFileSha256: string | null = null;
  let logFileBytes = 0;

  if (input.logFilePath) {
    if (!fs.existsSync(input.logFilePath)) {
      rejectionReasons.push(`Durable log file does not exist at '${input.logFilePath}'.`);
    } else {
      const bytes = fs.readFileSync(input.logFilePath);
      logFileBytes = bytes.length;
      logFileSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (logFileBytes === 0) {
        rejectionReasons.push(`Durable log file at '${input.logFilePath}' is empty (0 bytes).`);
      }
      if (!rawContent) {
        rawContent = bytes.toString("utf-8");
      }
    }
  } else if (!rawContent || rawContent.trim().length === 0) {
    rejectionReasons.push("Neither durable log file nor stdout content was provided for test execution verification.");
  } else {
    logFileBytes = Buffer.byteLength(rawContent, "utf-8");
    logFileSha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
  }

  // 4. Parse runner metrics
  const metrics = parseVitestOutputMetrics(rawContent);

  // 5. Check for zero tests executed
  if (metrics.testsTotal === 0 && metrics.testFilesTotal === 0) {
    rejectionReasons.push("Test output parsing found 0 total tests and 0 test files executed (ZERO_TESTS).");
  }

  // 6. Check for failed tests
  if (metrics.testsFailed > 0 || metrics.testFilesFailed > 0) {
    rejectionReasons.push(
      `Test suite had ${metrics.testsFailed} failing tests across ${metrics.testFilesFailed} failing files.`
    );
  }

  // 7. Check mandatory test files
  const missingMandatoryFiles: string[] = [];
  if (Array.isArray(input.mandatoryTestFiles) && input.mandatoryTestFiles.length > 0) {
    for (const mandatory of input.mandatoryTestFiles) {
      const normMandatory = mandatory.replace(/\\/g, "/");
      const matched = metrics.executedFilePaths.some((p) => p.includes(normMandatory) || normMandatory.includes(p));
      if (!matched) {
        missingMandatoryFiles.push(mandatory);
      }
    }
    if (missingMandatoryFiles.length > 0) {
      rejectionReasons.push(
        `Mandatory test suite files were missing from execution output: ${missingMandatoryFiles.join(", ")}.`
      );
    }
  }

  // 8. Reject untrusted synthetic claims
  if (input.callerClaimsFullCoverage && (metrics.testFilesTotal < 5 || metrics.testsTotal < 50)) {
    rejectionReasons.push(
      `Untrusted caller claimed 'fullCoverage=true' with only ${metrics.testsTotal} tests across ${metrics.testFilesTotal} files; full suite coverage rejected.`
    );
  }

  let status: TestSuiteExecutionStatus = "PASS";
  if (rejectionReasons.some((r) => r.includes("STALE_LOG"))) {
    status = "STALE";
  } else if (rejectionReasons.some((r) => r.includes("ZERO_TESTS") || r.includes("missing from execution"))) {
    status = "INCOMPLETE";
  } else if (rejectionReasons.length > 0) {
    status = "FAIL";
  }

  return {
    status,
    valid: status === "PASS",
    command: input.command,
    exitCode: input.exitCode,
    checkoutSha: input.checkoutSha,
    logFileSha256,
    logFileBytes,
    metrics,
    missingMandatoryFiles,
    rejectionReasons,
    verifiedAt,
  };
}

