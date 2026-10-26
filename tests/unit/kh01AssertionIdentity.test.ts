import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  normalizeTestIdentity,
  parseVitestJsonAssertions,
  resolveExecutedAssertion,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Exact Test Assertion Matching & Identity (Section 10)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh01-assert-id-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createReport(data: any): string {
    const reportPath = path.join(tempDir, `report-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(data), "utf8");
    return reportPath;
  }

  it("normalizes test identity to repo-relative path and exact full name", () => {
    const id = normalizeTestIdentity({
      testFile: "src/services/security/tests/unit/adminAuthTrustBoundary.test.ts",
      fullName: "Admin Security > rejects remote client spoofing",
    });
    expect(id).toBe("src/services/security/tests/unit/adminAuthTrustBoundary.test.ts::Admin Security > rejects remote client spoofing");

    const absPath = path.join(process.cwd(), "tests/unit/adminAuthTrustBoundary.test.ts");
    const id2 = normalizeTestIdentity({
      testFile: absPath,
      fullName: "Admin Security > rejects remote client spoofing",
    });
    expect(id2).toBe("tests/unit/adminAuthTrustBoundary.test.ts::Admin Security > rejects remote client spoofing");
  });

  it("matches exact test identity and preserves PASSED status", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/security.test.ts",
          assertionResults: [
            {
              title: "validates token strictly",
              fullName: "Auth > validates token strictly",
              status: "passed",
              duration: 25,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_SECURITY",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/security.test.ts",
      expectedTestName: "Auth > validates token strictly",
    });

    expect(res.status).toBe("PASSED");
    expect(res.evidenceReference).toContain("security.test.ts::Auth > validates token strictly");
  });

  it("strictly rejects fuzzy substring matching (no partial includes match)", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/fuzzy.test.ts",
          assertionResults: [
            {
              title: "validates token strictly with extra requirements",
              fullName: "Auth > validates token strictly with extra requirements",
              status: "passed",
              duration: 25,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    // Looking for shorter string "Auth > validates token strictly", which only matches as substring
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_SECURITY",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/fuzzy.test.ts",
      expectedTestName: "Auth > validates token strictly",
    });

    expect(res.status).toBe("NOT_RUN");
  });

  it("returns BLOCKED when duplicate or ambiguous exact test titles are encountered", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/dups.test.ts",
          assertionResults: [
            {
              title: "duplicated test name",
              fullName: "duplicated test name",
              status: "passed",
              duration: 10,
            },
            {
              title: "duplicated test name",
              fullName: "duplicated test name",
              status: "failed",
              duration: 10,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    // When duplicate canonical identity detected, resolveExecutedAssertion strictly yields BLOCKED
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_DUP",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/dups.test.ts",
      expectedTestName: "duplicated test name",
    });

    expect(res.status).toBe("BLOCKED");
    expect(res.error).toContain("Duplicate assertion identity detected");
  });

  it("returns NOT_RUN when expected test is missing from output", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/sample.test.ts",
          assertionResults: [
            {
              title: "another test entirely",
              fullName: "another test entirely",
              status: "passed",
              duration: 10,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_NON_EXISTENT",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/sample.test.ts",
      expectedTestName: "expected but non existent test",
    });

    expect(res.status).toBe("NOT_RUN");
  });

  it("does not collide when same test title exists in two different files", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/suiteA.test.ts",
          assertionResults: [
            {
              title: "common check",
              fullName: "common check",
              status: "passed",
              duration: 10,
            },
          ],
        },
        {
          name: "/app/tests/integration/suiteB.test.ts",
          assertionResults: [
            {
              title: "common check",
              fullName: "common check",
              status: "failed",
              duration: 12,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    expect(parsed.valid).toBe(true);
    expect(parsed.duplicates.length).toBe(0);

    const resA = resolveExecutedAssertion(parsed, {
      gateId: "GATE_A",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/suiteA.test.ts",
      expectedTestName: "common check",
    });
    expect(resA.status).toBe("PASSED");

    const resB = resolveExecutedAssertion(parsed, {
      gateId: "GATE_B",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/integration/suiteB.test.ts",
      expectedTestName: "common check",
    });
    expect(resB.status).toBe("FAILED");
  });

  it("classifies skipped assertion as NOT_RUN and preserves failure as FAILED", () => {
    const reportPath = createReport({
      testResults: [
        {
          name: "/app/tests/unit/skip.test.ts",
          assertionResults: [
            {
              title: "skipped test",
              fullName: "skipped test",
              status: "skipped",
              duration: 0,
            },
            {
              title: "failed test",
              fullName: "failed test",
              status: "failed",
              duration: 5,
              failureMessages: ["Expected 1 to be 2"],
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const resSkip = resolveExecutedAssertion(parsed, {
      gateId: "GATE_SKIP",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/skip.test.ts",
      expectedTestName: "skipped test",
    });
    expect(resSkip.status).toBe("NOT_RUN");

    const resFail = resolveExecutedAssertion(parsed, {
      gateId: "GATE_FAIL",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/skip.test.ts",
      expectedTestName: "failed test",
    });
    expect(resFail.status).toBe("FAILED");
    expect(resFail.error).toContain("Expected 1 to be 2");
  });

  it("returns BLOCKED when jsonReportPath does not exist", () => {
    const res = resolveExecutedAssertion(
      new Map(),
      {
        gateId: "GATE_MISSING",
        type: "TEST_ASSERTION",
        expectedTestFile: "tests/unit/missing.test.ts",
        expectedTestName: "some test",
      },
      {
        stageStatus: "PASSED",
        exitCode: 0,
        command: "vitest run",
        jsonReportPath: path.join(tempDir, "non-existent-report.json"),
      }
    );

    expect(res.status).toBe("BLOCKED");
    expect(res.error).toContain("Test report was not generated or missing");
  });
});
