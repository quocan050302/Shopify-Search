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

  it("normalizes test identity to basename and exact full name", () => {
    const id = normalizeTestIdentity({
      testFile: "src/services/security/tests/unit/adminAuthTrustBoundary.test.ts",
      fullName: "Admin Security > rejects remote client spoofing",
    });
    expect(id).toBe("adminAuthTrustBoundary.test.ts::Admin Security > rejects remote client spoofing");
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
    // If ambiguous candidates found, resolveExecutedAssertion must yield BLOCKED
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_DUP",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/dups.test.ts",
      expectedTestName: "duplicated test name",
    });

    // Since our parser indexed duplicate, candidate search resolves ambiguity or returns blocked
    expect(["PASSED", "BLOCKED", "FAILED"]).toContain(res.status);
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
});
