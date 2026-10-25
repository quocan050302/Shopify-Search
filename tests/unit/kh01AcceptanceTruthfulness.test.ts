import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseVitestJsonAssertions,
  normalizeTestIdentity,
} from "../../scripts/kh01/runFullAcceptance";
import {
  CANONICAL_ACCEPTANCE_GATES,
  validateKh01AcceptanceManifest,
  deriveReleaseVerdict,
  Kh01AcceptanceManifest,
  GateEvidence,
  LiveMetaVerificationResult,
} from "@/lib/kh01/acceptanceGateRegistry";

describe("KH-01 Acceptance Runner Truthfulness & Adversarial Integrity (Section 24)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh01-truth-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSampleReport(reportContent: any): string {
    const reportPath = path.join(tempDir, "test-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(reportContent), "utf8");
    return reportPath;
  }

  it("accurately parses matching test when PASSED", () => {
    const reportPath = createSampleReport({
      testResults: [
        {
          name: "/workspace/tests/unit/dbIsolation.test.ts",
          assertionResults: [
            {
              title: "blocks test execution when databaseUrl contains production.db",
              fullName: "Database Safety > blocks test execution when databaseUrl contains production.db",
              status: "passed",
              duration: 42,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const id = normalizeTestIdentity({
      testFile: "tests/unit/dbIsolation.test.ts",
      fullName: "Database Safety > blocks test execution when databaseUrl contains production.db",
    });
    const entry = parsed.get(id);

    expect(entry).toBeDefined();
    expect(entry?.status).toBe("PASSED");
    expect(entry?.durationMs).toBe(42);
  });

  it("accurately identifies FAILED test with failure messages", () => {
    const reportPath = createSampleReport({
      testResults: [
        {
          name: "/workspace/tests/unit/adminAuth.test.ts",
          assertionResults: [
            {
              title: "rejects spoofed Host header",
              fullName: "Admin Security > rejects spoofed Host header",
              status: "failed",
              duration: 15,
              failureMessages: ["Expected 401 but received 200"],
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const id = normalizeTestIdentity({
      testFile: "tests/unit/adminAuth.test.ts",
      fullName: "Admin Security > rejects spoofed Host header",
    });
    const entry = parsed.get(id);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("FAILED");
    expect(entry?.failureMessages).toContain("Expected 401 but received 200");
  });

  it("accurately classifies SKIPPED test and does not report it as passed", () => {
    const reportPath = createSampleReport({
      testResults: [
        {
          name: "/workspace/tests/unit/skipped.test.ts",
          assertionResults: [
            {
              title: "optional feature test",
              fullName: "Feature > optional feature test",
              status: "skipped",
              duration: 0,
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);
    const id = normalizeTestIdentity({
      testFile: "tests/unit/skipped.test.ts",
      fullName: "Feature > optional feature test",
    });
    const entry = parsed.get(id);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("SKIPPED");
  });

  it("returns empty map when report file is missing or contains invalid JSON", () => {
    const missingPath = path.join(tempDir, "does-not-exist.json");
    expect(parseVitestJsonAssertions(missingPath).size).toBe(0);

    const corruptPath = path.join(tempDir, "corrupt.json");
    fs.writeFileSync(corruptPath, "{ invalid json text }", "utf8");
    expect(parseVitestJsonAssertions(corruptPath).size).toBe(0);
  });

  it("manifest validator blocks manifest when target branch is incorrect", () => {
    const manifest: Kh01AcceptanceManifest = {
      applicationVersion: "11.5.2",
      protocolVersion: "11.4.5",
      acceptanceRunId: "run_test_001",
      testedCommitSha: "ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32",
      branch: "main", // VIOLATION: main branch
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates: [],
      stages: [],
      liveVerification: {
        status: "NOT_RUN",
        detailedOutcome: "NOT_RUN",
        levelsVerified: [],
        runId: null,
        source: "https://www.facebook.com/ads/library/",
        retrievedCount: 0,
        validCount: 0,
        linkedCount: 0,
        displayedCount: 0,
        evidenceReferences: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      unresolvedDefects: [],
      releaseVerdict: "BLOCKED",
    };

    const res = validateKh01AcceptanceManifest(manifest);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.includes("branch mismatch"))).toBe(true);
  });

  it("manifest validator detects duplicate gate IDs", () => {
    const gates: GateEvidence[] = [
      {
        gateId: "GATE_01_CORRECT_BRANCH",
        runId: "run_1",
        testId: "t1",
        status: "PASSED",
        evidenceType: "TEST_ASSERTION",
        evidenceReference: "ref1",
        observedAt: new Date().toISOString(),
      },
      {
        gateId: "GATE_01_CORRECT_BRANCH", // Duplicate!
        runId: "run_1",
        testId: "t2",
        status: "PASSED",
        evidenceType: "TEST_ASSERTION",
        evidenceReference: "ref2",
        observedAt: new Date().toISOString(),
      },
    ];

    const manifest: any = {
      applicationVersion: "11.5.2",
      protocolVersion: "11.4.5",
      acceptanceRunId: "run_test_002",
      testedCommitSha: "ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      stages: [],
      liveVerification: { status: "NOT_RUN", retrievedCount: 0, levelsVerified: [] },
      unresolvedDefects: [],
      releaseVerdict: "BLOCKED",
    };

    const res = validateKh01AcceptanceManifest(manifest);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.includes("Duplicate gateId"))).toBe(true);
  });

  it("rejects ACCEPTED verdict when live verification claims PASSED with 0 retrieved ads", () => {
    const liveVerification: LiveMetaVerificationResult = {
      status: "PASSED", // Claimed PASSED
      detailedOutcome: "LIVE_RECONCILED",
      levelsVerified: ["NETWORK_REACHABLE"], // Missing ADS_COLLECTED
      runId: "run_zero",
      source: "https://facebook.com/ads/library/",
      retrievedCount: 0, // 0 retrieved!
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const manifest: any = {
      applicationVersion: "11.5.2",
      protocolVersion: "11.4.5",
      acceptanceRunId: "run_test_003",
      testedCommitSha: "ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates: CANONICAL_ACCEPTANCE_GATES.map((g) => ({
        gateId: g.gateId,
        runId: "run_3",
        testId: "t",
        status: "PASSED",
        evidenceType: g.evidenceType,
        evidenceReference: "ref",
        observedAt: new Date().toISOString(),
      })),
      stages: [],
      liveVerification,
      unresolvedDefects: [],
      releaseVerdict: "ACCEPTED",
    };

    const res = validateKh01AcceptanceManifest(manifest);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.includes("retrievedCount 0"))).toBe(true);
  });

  it("deriveReleaseVerdict returns BLOCKED when any mandatory gate failed or missing", () => {
    const gates: GateEvidence[] = CANONICAL_ACCEPTANCE_GATES.map((g) => ({
      gateId: g.gateId,
      runId: "run_4",
      testId: "t",
      status: g.gateId === "GATE_03_AUTH_TRUST_BOUNDARY" ? "FAILED" : "PASSED",
      evidenceType: g.evidenceType,
      evidenceReference: "ref",
      observedAt: new Date().toISOString(),
    }));

    const liveVerification: LiveMetaVerificationResult = {
      status: "NOT_RUN",
      detailedOutcome: "NOT_RUN",
      levelsVerified: [],
      runId: null,
      source: "url",
      retrievedCount: 0,
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const verdict = deriveReleaseVerdict(gates, liveVerification);
    expect(verdict).toBe("BLOCKED");
  });

  it("deriveReleaseVerdict returns CONDITIONALLY_ACCEPTED when all mandatory pass but live testing is NOT_RUN", () => {
    const gates: GateEvidence[] = CANONICAL_ACCEPTANCE_GATES.map((g) => ({
      gateId: g.gateId,
      runId: "run_5",
      testId: "t",
      status: g.gateId === "GATE_14_LIVE_META_SOURCE" ? "NOT_RUN" : "PASSED",
      evidenceType: g.evidenceType,
      evidenceReference: "ref",
      observedAt: new Date().toISOString(),
    }));

    const liveVerification: LiveMetaVerificationResult = {
      status: "NOT_RUN",
      detailedOutcome: "NOT_RUN",
      levelsVerified: [],
      runId: null,
      source: "url",
      retrievedCount: 0,
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const verdict = deriveReleaseVerdict(gates, liveVerification);
    expect(verdict).toBe("CONDITIONALLY_ACCEPTED");
  });
});
