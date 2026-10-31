import { describe, it, expect } from "vitest";
import {
  validateRequiredSuiteCoverage,
  validateRequiredArtifactInventory,
  validateAcceptanceArtifact,
  ExecutedSuiteEvidence,
  KH01_REQUIRED_ARTIFACTS,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Required Artifact Inventory & Suite Coverage (FINAL-03)", () => {
  const dummyCommit = "218c0cf266cff0819a1f8a21c1cd4b08b1dbd39d";
  const dummyRunId = "kh01_rel_test123";

  const canonical26Suites = [
    "tests/unit/adminAuthTrustBoundary.test.ts",
    "tests/integration/legacyAdsWorkspaceIsolation.test.ts",
    "tests/integration/exactRunCompleteness.test.ts",
    "tests/integration/metaRunAdsIsolation.test.ts",
    "tests/unit/researchActionPolicy.test.ts",
    "tests/integration/metaReadinessSubmission.test.ts",
    "tests/unit/kh01AcceptanceTruthfulness.test.ts",
    "tests/integration/metaLiveReconciliation.test.ts",
    "tests/unit/runReconciliationInvariants.test.ts",
    "tests/unit/adServiceCrossWorkspace.test.ts",
    "tests/integration/kh01CrossBoundaryReconciliation.test.ts",
    "tests/unit/kh01AssertionIdentity.test.ts",
    "tests/unit/kh01ArtifactIntegrity.test.ts",
    "tests/unit/kh01FinalVerdict.test.ts",
    "tests/unit/kh01Security.test.ts",
    "tests/unit/kh01JobExecution.test.ts",
    "tests/unit/shopifyDecisionIntegrity.test.ts",
    "tests/unit/dbIsolation.test.ts",
    "tests/integration/kh01DatabaseIsolation.test.ts",
    "tests/integration/kh01WorkerConcurrency.test.ts",
    "tests/integration/kh01ActualWorkerProcess.test.ts",
    "tests/integration/kh01PersistenceReadback.test.ts",
    "tests/integration/kh01RealHttpReadback.test.ts",
    "tests/integration/kh01UnifiedJourney.test.ts",
    "tests/e2e/metaDiscoveryFinalAcceptance.test.ts",
    "tests/e2e/kh01RealBrowserReadback.test.ts",
  ];

  describe("validateRequiredSuiteCoverage()", () => {
    it("passes when all 26 required suites are present and passed", () => {
      const executed: ExecutedSuiteEvidence[] = canonical26Suites.map((file) => ({
        testFile: file,
        stageId: "STAGE_TEST",
        acceptanceRunId: dummyRunId,
        testedCommitSha: dummyCommit,
        actuallyExecuted: true,
        passed: 5,
        failed: 0,
        skipped: 0,
        reportPath: "/tmp/report.json",
        processExitCode: 0,
        evidenceOrigin: "ACTUAL_TEST_EXECUTION",
      }));

      const res = validateRequiredSuiteCoverage(canonical26Suites, executed);
      expect(res.passed).toBe(true);
      expect(res.missingSuites.length).toBe(0);
      expect(res.failedSuites.length).toBe(0);
      expect(res.skippedOnlySuites.length).toBe(0);
    });

    it("fails when one required suite is missing", () => {
      const executed: ExecutedSuiteEvidence[] = canonical26Suites.slice(1).map((file) => ({
        testFile: file,
        stageId: "STAGE_TEST",
        acceptanceRunId: dummyRunId,
        testedCommitSha: dummyCommit,
        actuallyExecuted: true,
        passed: 3,
        failed: 0,
        skipped: 0,
        reportPath: "/tmp/report.json",
        processExitCode: 0,
        evidenceOrigin: "ACTUAL_TEST_EXECUTION",
      }));

      const res = validateRequiredSuiteCoverage(canonical26Suites, executed);
      expect(res.passed).toBe(false);
      expect(res.missingSuites).toContain(canonical26Suites[0]);
      expect(res.errors[0]).toContain(canonical26Suites[0]);
    });

    it("fails when a suite has failed tests", () => {
      const executed: ExecutedSuiteEvidence[] = canonical26Suites.map((file, idx) => ({
        testFile: file,
        stageId: "STAGE_TEST",
        acceptanceRunId: dummyRunId,
        testedCommitSha: dummyCommit,
        actuallyExecuted: true,
        passed: idx === 0 ? 2 : 5,
        failed: idx === 0 ? 1 : 0,
        skipped: 0,
        reportPath: "/tmp/report.json",
        processExitCode: idx === 0 ? 1 : 0,
        evidenceOrigin: "ACTUAL_TEST_EXECUTION",
      }));

      const res = validateRequiredSuiteCoverage(canonical26Suites, executed);
      expect(res.passed).toBe(false);
      expect(res.failedSuites).toContain(canonical26Suites[0]);
    });

    it("fails when a suite has only skipped tests (0 passed)", () => {
      const executed: ExecutedSuiteEvidence[] = canonical26Suites.map((file, idx) => ({
        testFile: file,
        stageId: "STAGE_TEST",
        acceptanceRunId: dummyRunId,
        testedCommitSha: dummyCommit,
        actuallyExecuted: true,
        passed: idx === 0 ? 0 : 5,
        failed: 0,
        skipped: idx === 0 ? 3 : 0,
        reportPath: "/tmp/report.json",
        processExitCode: 0,
        evidenceOrigin: "ACTUAL_TEST_EXECUTION",
      }));

      const res = validateRequiredSuiteCoverage(canonical26Suites, executed);
      expect(res.passed).toBe(false);
      expect(res.skippedOnlySuites).toContain(canonical26Suites[0]);
    });
  });

  describe("validateRequiredArtifactInventory()", () => {
    function buildMockArtifactSet() {
      return KH01_REQUIRED_ARTIFACTS.map((req) => ({
        name: req.filename,
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          status: req.filename.includes("live") ? "NOT_RUN" : "PASSED",
          viewportsTested: ["1920x1080", "1440x900", "1280x800", "1024x768", "768x1024", "390x844"],
          prismaConnectionVerified: true,
          markerWriteVerified: true,
          markerReadVerified: true,
          activeDatabaseProtected: true,
          screenshots: [
            { relativePath: "screenshots/viewport_1920x1080.png", sha256: "abc1" },
            { relativePath: "screenshots/viewport_1440x900.png", sha256: "abc2" },
            { relativePath: "screenshots/viewport_1280x800.png", sha256: "abc3" },
            { relativePath: "screenshots/viewport_1024x768.png", sha256: "abc4" },
            { relativePath: "screenshots/viewport_768x1024.png", sha256: "abc5" },
            { relativePath: "screenshots/viewport_390x844.png", sha256: "abc6" },
          ],
        },
      }));
    }

    it("succeeds for complete offline artifact inventory", () => {
      const artifacts = buildMockArtifactSet();
      const res = validateRequiredArtifactInventory(artifacts, "OFFLINE");
      expect(res.valid).toBe(true);
      expect(res.missingArtifacts.length).toBe(0);
      expect(res.errors.length).toBe(0);
    });

    it("fails when a required artifact like browser-results.json is missing", () => {
      const artifacts = buildMockArtifactSet().filter((a) => a.name !== "browser-results.json");
      const res = validateRequiredArtifactInventory(artifacts, "OFFLINE");
      expect(res.valid).toBe(false);
      expect(res.missingArtifacts).toContain("browser-results.json");
    });

    it("fails when suite-coverage.json is missing", () => {
      const artifacts = buildMockArtifactSet().filter((a) => a.name !== "suite-coverage.json");
      const res = validateRequiredArtifactInventory(artifacts, "OFFLINE");
      expect(res.valid).toBe(false);
      expect(res.missingArtifacts).toContain("suite-coverage.json");
    });

    it("allows live-source-results.json NOT_RUN in OFFLINE scope, but blocks it in FULL_LIVE scope", () => {
      const artifacts = buildMockArtifactSet();
      const offlineRes = validateRequiredArtifactInventory(artifacts, "OFFLINE");
      expect(offlineRes.valid).toBe(true);

      const liveRes = validateRequiredArtifactInventory(artifacts, "FULL_LIVE");
      expect(liveRes.valid).toBe(false);
      expect(liveRes.invalidArtifacts).toContain("live-source-results.json");
    });
  });

  describe("validateAcceptanceArtifact() Deep Schema Validations", () => {
    it("rejects browser-results.json with status PASSED but fewer than 6 viewports", () => {
      const file = {
        name: "browser-results.json",
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          status: "PASSED",
          viewportsTested: ["1920x1080"],
        },
      };
      const res = validateAcceptanceArtifact(file, dummyRunId, dummyCommit);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("only tested 1/6 viewports"))).toBe(true);
    });

    it("rejects database-isolation.json with status PASSED but prismaConnectionVerified false", () => {
      const file = {
        name: "database-isolation.json",
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          status: "PASSED",
          prismaConnectionVerified: false,
          markerWriteVerified: true,
          markerReadVerified: true,
          activeDatabaseProtected: true,
        },
      };
      const res = validateAcceptanceArtifact(file, dummyRunId, dummyCommit);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("prismaConnectionVerified is false"))).toBe(true);
    });

    it("rejects suite-coverage.json with status PASSED but missingSuites present", () => {
      const file = {
        name: "suite-coverage.json",
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          status: "PASSED",
          passed: true,
          missingSuites: ["tests/integration/kh01RealHttpReadback.test.ts"],
        },
      };
      const res = validateAcceptanceArtifact(file, dummyRunId, dummyCommit);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("has missing required suites"))).toBe(true);
    });

    it("rejects live-source-results.json with status PASSED but observedSourceType TEST_FIXTURE", () => {
      const file = {
        name: "live-source-results.json",
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          status: "PASSED",
          detailedOutcome: "LIVE_RECONCILED",
          observedSourceType: "TEST_FIXTURE",
        },
      };
      const res = validateAcceptanceArtifact(file, dummyRunId, dummyCommit);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("cannot be PASSED with observedSourceType TEST_FIXTURE"))).toBe(true);
    });

    it("rejects screenshot-manifest.json when a screenshot lacks a sha256 checksum", () => {
      const file = {
        name: "screenshot-manifest.json",
        data: {
          acceptanceRunId: dummyRunId,
          testedCommitSha: dummyCommit,
          screenshots: [
            { relativePath: "screenshots/viewport_1920x1080.png", sha256: "" },
          ],
        },
      };
      const res = validateAcceptanceArtifact(file, dummyRunId, dummyCommit);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("without valid sha256"))).toBe(true);
    });
  });
});
