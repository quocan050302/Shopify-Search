import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { getRuntimeVersionInfo } from "@/services/kh02/version/runtimeVersionService";
import {
  validateAcceptanceArtifacts,
  runNegativeControlSuite,
} from "../../../scripts/kh02/acceptanceValidatorV12_4_3_4_5";
import {
  captureDiskSpaceSnapshot,
  isProtectedRepositoryPath,
  auditOwnedCleanupOperation,
  buildSafeDiskRecoveryAudit,
  computeKh02AcceptanceExitDecision,
  executeCliSubprocessExitProofSuite,
  writeCanonicalValidBaselineFixture,
} from "../../../scripts/kh02/runFivePhaseAutoClosure";

describe("KH-02 V12.4.3.4.9 — No-False-Pass CLI, Truthful Disk Audit & 46 Negative Controls", () => {
  const validSha = "3d306a678aa59756ed5cfbeba1a89ed721e4530e";

  const makePassingInput = (overrides: Record<string, any> = {}) => ({
    baselineHeadSha: validSha,
    expectedSourceSha: validSha,
    diskHeadroomOk: true,
    guardStatus: "PASS_HEADROOM_SUFFICIENT",
    barrierReport: {
      barrierSatisfied: true,
      zeroRunningJobs: true,
      jobsScheduled: 6,
      jobsCompleted: 6,
      jobsFailed: 0,
      jobsTimedOut: 0,
    },
    overallEngineeringVerdict: "PASS",
    engineeringReleaseDecision: "READY_ENGINEERING",
    overallBusinessVerdict: "INSUFFICIENT_EVIDENCE",
    failedEngineeringGates: [],
    gates: {
      G01: { status: "PASS" },
      G06: { status: "PASS" },
      G07: { status: "BLOCKED" },
      G15: { status: "INSUFFICIENT_EVIDENCE" },
      G16: { status: "INSUFFICIENT_EVIDENCE" },
      G20: { status: "PASS" },
      G25: { status: "INSUFFICIENT_EVIDENCE" },
      G26: { status: "INSUFFICIENT_EVIDENCE" },
      G28: { status: "PASS" },
    },
    negControlSuiteReport: {
      suiteVerdict: "PASS",
      totalMutations: 46,
      totalCaughtAndRejected: 46,
    },
    validationReport: {
      overallValid: true,
      totalChecks: 20,
      passedChecks: 20,
      failedChecks: 0,
      checks: [{ checkId: "CHK_01_MANDATORY_FILES_PRESENT", passed: true }],
    },
    failedTestsCount: 0,
    skippedTestsCount: 0,
    integrationStatus: "EXECUTED",
    buildStatus: "BUILD_PASS",
    chromiumStatus: "PASS",
    parityPassed: true,
    readOnlyPassed: true,
    g06Verdict: "PASS",
    ...overrides,
  });

  it("reports runtime version 12.4.3.4.9", () => {
    expect(getRuntimeVersionInfo().appVersion).toBe("12.4.3.4.9");
  });

  describe("P0: computeKh02AcceptanceExitDecision & Real Child Subprocess Exit Proof", () => {
    it("removes unconditional .then(() => process.exit(0)) from scripts/kh02/runFivePhaseAutoClosure.ts", () => {
      const sourceText = fs.readFileSync(
        path.resolve(process.cwd(), "scripts/kh02/runFivePhaseAutoClosure.ts"),
        "utf8"
      );
      expect(sourceText).not.toContain(".then(() => process.exit(0))");
      expect(sourceText).toContain("computeKh02AcceptanceExitDecision");
    });

    it("returns exitCode 0 (ENGINEERING_ACCEPTED) when all engineering gates, barriers, and validator checks pass even if business verdict is INSUFFICIENT_EVIDENCE", () => {
      const decision = computeKh02AcceptanceExitDecision(makePassingInput());
      expect(decision.exitCode).toBe(0);
      expect(decision.exitCategory).toBe("ENGINEERING_ACCEPTED");
      expect(decision.engineeringAccepted).toBe(true);
      expect(decision.validatorAccepted).toBe(true);
      expect(decision.completionBarrierAccepted).toBe(true);
      expect(decision.sourceShaConsistent).toBe(true);
      expect(decision.businessVerdict).toBe("INSUFFICIENT_EVIDENCE");
      expect(decision.mergeReadiness).toBe("READY_FOR_OWNER_PR_REVIEW");
      expect(decision.amazonPilotReadiness).toBe("READY_FOR_ISOLATED_PILOT");
    });

    it("returns exitCode 2 (ENGINEERING_GATE_FAILURE) when overallEngineeringVerdict !== 'PASS' or any required engineering gate/sub-stage fails", () => {
      const failVerdict = computeKh02AcceptanceExitDecision(
        makePassingInput({
          overallEngineeringVerdict: "FAIL",
          failedEngineeringGates: ["G20"],
        })
      );
      expect(failVerdict.exitCode).toBe(2);
      expect(failVerdict.exitCategory).toBe("ENGINEERING_GATE_FAILURE");
      expect(failVerdict.engineeringAccepted).toBe(false);
      expect(failVerdict.mergeReadiness).toBe("BLOCKED_DO_NOT_MERGE");

      // Required test failure
      expect(
        computeKh02AcceptanceExitDecision(makePassingInput({ failedTestsCount: 1 }))
          .exitCode
      ).toBe(2);

      // Skipped test failure
      expect(
        computeKh02AcceptanceExitDecision(makePassingInput({ skippedTestsCount: 2 }))
          .exitCode
      ).toBe(2);

      // Integration suite failure
      expect(
        computeKh02AcceptanceExitDecision(
          makePassingInput({ integrationStatus: "FAIL" })
        ).exitCode
      ).toBe(2);

      // Production build failure
      expect(
        computeKh02AcceptanceExitDecision(
          makePassingInput({ buildStatus: "BUILD_FAILED" })
        ).exitCode
      ).toBe(2);

      // Chromium failure
      expect(
        computeKh02AcceptanceExitDecision(
          makePassingInput({ chromiumStatus: "FAIL" })
        ).exitCode
      ).toBe(2);

      // Parity failure
      expect(
        computeKh02AcceptanceExitDecision(makePassingInput({ parityPassed: false }))
          .exitCode
      ).toBe(2);

      // Read-only non-mutation failure
      expect(
        computeKh02AcceptanceExitDecision(makePassingInput({ readOnlyPassed: false }))
          .exitCode
      ).toBe(2);

      // Google G06 failure
      expect(
        computeKh02AcceptanceExitDecision(makePassingInput({ g06Verdict: "FAIL" }))
          .exitCode
      ).toBe(2);

      // Negative control suite failure
      expect(
        computeKh02AcceptanceExitDecision(
          makePassingInput({
            negControlSuiteReport: { suiteVerdict: "FAIL" },
          })
        ).exitCode
      ).toBe(2);
    });

    it("returns exitCode 3 (VALIDATOR_INVALID) when validationReport is missing, overallValid !== true, or failedChecks > 0 even if overallEngineeringVerdict === 'PASS'", () => {
      const invalidVal = computeKh02AcceptanceExitDecision(
        makePassingInput({
          overallEngineeringVerdict: "PASS",
          validationReport: {
            overallValid: false,
            totalChecks: 20,
            passedChecks: 19,
            failedChecks: 1,
            checks: [
              {
                checkId: "CHK_07_JUNIT_XML_DEEP_VALID",
                passed: false,
              },
            ],
          },
        })
      );
      expect(invalidVal.exitCode).toBe(3);
      expect(invalidVal.exitCategory).toBe("VALIDATOR_INVALID");
      expect(invalidVal.validatorAccepted).toBe(false);
      expect(invalidVal.failedValidatorChecks).toContain(
        "CHK_07_JUNIT_XML_DEEP_VALID"
      );

      const missingVal = computeKh02AcceptanceExitDecision(
        makePassingInput({ validationReport: null })
      );
      expect(missingVal.exitCode).toBe(3);
      expect(missingVal.exitCategory).toBe("VALIDATOR_INVALID");
    });

    it("returns exitCode 4 (INCOMPLETE_OR_RESOURCE_BLOCKED) when diskHeadroomOk is false, barrier has running/failed/timedOut jobs, or heavy wave is BLOCKED_RESOURCE", () => {
      const diskBlocked = computeKh02AcceptanceExitDecision(
        makePassingInput({ diskHeadroomOk: false })
      );
      expect(diskBlocked.exitCode).toBe(4);
      expect(diskBlocked.exitCategory).toBe("INCOMPLETE_OR_RESOURCE_BLOCKED");

      const runningBarrier = computeKh02AcceptanceExitDecision(
        makePassingInput({
          barrierReport: {
            barrierSatisfied: false,
            zeroRunningJobs: false,
            jobsScheduled: 6,
            jobsCompleted: 5,
            jobsFailed: 0,
            jobsTimedOut: 0,
          },
        })
      );
      expect(runningBarrier.exitCode).toBe(4);
      expect(runningBarrier.exitCategory).toBe("INCOMPLETE_OR_RESOURCE_BLOCKED");

      const blockedIntWave = computeKh02AcceptanceExitDecision(
        makePassingInput({ integrationStatus: "BLOCKED_RESOURCE" })
      );
      expect(blockedIntWave.exitCode).toBe(4);
      expect(blockedIntWave.exitCategory).toBe("INCOMPLETE_OR_RESOURCE_BLOCKED");
    });

    it("returns exitCode 1 (FATAL_OR_MISSING_INPUT) when input is null or testedSourceSha mismatches expectedSourceSha", () => {
      const nullDecision = computeKh02AcceptanceExitDecision(null);
      expect(nullDecision.exitCode).toBe(1);
      expect(nullDecision.exitCategory).toBe("FATAL_OR_MISSING_INPUT");

      const shaMismatch = computeKh02AcceptanceExitDecision(
        makePassingInput({
          baselineHeadSha: validSha,
          expectedSourceSha: "deadbeef00000000000000000000000000000000",
        })
      );
      expect(shaMismatch.exitCode).toBe(1);
      expect(shaMismatch.exitCategory).toBe("FATAL_OR_MISSING_INPUT");
      expect(shaMismatch.sourceShaConsistent).toBe(false);
    });

    it("spawns real child CLI subprocesses via executeCliSubprocessExitProofSuite and verifies exit code 0 for valid baseline and nonzero exit codes (2, 3, 4, 1) for forced failures", () => {
      const proof = executeCliSubprocessExitProofSuite(validSha);
      expect(proof.suiteVerdict).toBe("PASS");
      expect(proof.positiveCase.pid).toBeGreaterThan(0);
      expect(proof.positiveCase.actualExitCode).toBe(0);
      expect(proof.positiveCase.actualExitCategory).toBe("ENGINEERING_ACCEPTED");
      expect(proof.positiveCase.passed).toBe(true);

      expect(proof.failureCases.length).toBeGreaterThanOrEqual(4);
      for (const fc of proof.failureCases) {
        expect(fc.pid).toBeGreaterThan(0);
        expect(fc.actualExitCode).not.toBe(0);
        expect(fc.actualExitCode).toBe(fc.expectedExitCode);
        expect(fc.actualExitCategory).toBe(fc.expectedExitCategory);
        expect(fc.passed).toBe(true);
      }
    }, 60000);
  });

  describe("P1: captureDiskSpaceSnapshot, auditOwnedCleanupOperation & buildSafeDiskRecoveryAudit", () => {
    it("removes all static legacy disk constants (8.71, 9357185024, 226365440, 218112000, 5111808, 5873664) from scripts/kh02/runFivePhaseAutoClosure.ts", () => {
      const sourceText = fs.readFileSync(
        path.resolve(process.cwd(), "scripts/kh02/runFivePhaseAutoClosure.ts"),
        "utf8"
      );
      expect(sourceText).not.toContain("8.71");
      expect(sourceText).not.toContain("9357185024");
      expect(sourceText).not.toContain("226365440");
      expect(sourceText).not.toContain("218112000");
      expect(sourceText).not.toContain("5111808");
      expect(sourceText).not.toContain("5873664");
    });

    it("records cleanupAttempted=false, cleanedTargets=[], and totalVerifiedRemovedBytes=0 when free disk >= 15 GB and no cleanup runs", () => {
      const audit = buildSafeDiskRecoveryAudit({
        testedSourceSha: validSha,
        requiredFreeDiskGB: 15,
        statfsFn: (() => ({
          bsize: 4096,
          bavail: 5000000, // ~19.07 GB
          blocks: 50000000,
        })) as any,
      });

      expect(audit.measurementStatus).toBe("MEASURED");
      expect(audit.guardStatus).toBe("PASS_HEADROOM_SUFFICIENT");
      expect(audit.cleanupAttempted).toBe(false);
      expect(audit.cleanedTargets).toEqual([]);
      expect(audit.actionsAttempted).toEqual([]);
      expect(audit.actionsSucceeded).toEqual([]);
      expect(audit.actionsFailed).toEqual([]);
      expect(audit.totalVerifiedRemovedBytes).toBe(0);
      expect(audit.reclaimedBytes).toBe(0);
      expect(audit.heavyWavesUnblocked).toBe(true);
      expect(audit.beforeFreeBytes).toBe(4096 * 5000000);
      expect(audit.afterFreeBytes).toBe(4096 * 5000000);
    });

    it("measures exact bytes removed when cleaning a task-owned temp directory and distinguishes totalVerifiedRemovedBytes from netFreeSpaceDeltaBytes under concurrent writes", () => {
      const isolatedTmpRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "kh02-disk-audit-unit-")
      );
      const ownedDir = path.join(isolatedTmpRoot, "swai-owned-temp-cache");
      fs.mkdirSync(ownedDir, { recursive: true });
      const fileA = path.join(ownedDir, "a.bin");
      const fileB = path.join(ownedDir, "b.bin");
      fs.writeFileSync(fileA, Buffer.alloc(4096, 1));
      fs.writeFileSync(fileB, Buffer.alloc(2048, 2));

      try {
        let callIdx = 0;
        // Simulate concurrent background write that reduces net free space by 8192 bytes even though 6144 bytes were removed from ownedDir
        const mockStatfs = (() => {
          callIdx++;
          return {
            bsize: 1,
            bavail: callIdx === 1 ? 20 * 1024 ** 3 : 20 * 1024 ** 3 - 8192,
            blocks: 100 * 1024 ** 3,
          };
        }) as any;

        const audit = buildSafeDiskRecoveryAudit({
          testedSourceSha: validSha,
          requiredFreeDiskGB: 15,
          tmpRoot: isolatedTmpRoot,
          statfsFn: mockStatfs,
          forceCleanupEvenWhenSufficient: true,
          candidateCleanupTargets: [
            {
              targetPath: ownedDir,
              category: "TASK_OWNED_TMP_CACHE",
            },
          ],
        });

        expect(audit.cleanupAttempted).toBe(true);
        expect(audit.actionsSucceeded).toHaveLength(1);
        expect(audit.actionsSucceeded[0].measuredBytesBefore).toBe(6144);
        expect(audit.actionsSucceeded[0].measuredBytesAfter).toBe(0);
        expect(audit.actionsSucceeded[0].measuredBytesRemoved).toBe(6144);
        expect(audit.totalVerifiedRemovedBytes).toBe(6144);
        expect(audit.reclaimedBytes).toBe(6144);
        expect(audit.netFreeSpaceDeltaBytes).toBe(-8192);
        expect(fs.existsSync(ownedDir)).toBe(false);
      } finally {
        fs.rmSync(isolatedTmpRoot, { recursive: true, force: true });
      }
    });

    it("refuses to clean protected repository paths (dev.db, node_modules, .git, acceptance, data/google_trends_csv, src) or unowned paths", () => {
      for (const prot of [
        "dev.db",
        "node_modules",
        ".git",
        "acceptance",
        "acceptance/kh02-v12.4.3.4.8-google-provenance-runtime-closure",
        "data/google_trends_csv",
        "src/services/kh02",
      ]) {
        expect(isProtectedRepositoryPath(prot)).toBe(true);
        const res = auditOwnedCleanupOperation({
          targetPath: prot,
          category: "ATTEMPTED_PROTECTED_DELETE",
        });
        expect(res.status).toBe("REJECTED_PROTECTED_OR_UNOWNED");
        expect(res.ownershipVerified).toBe(false);
        expect(res.measuredBytesRemoved).toBe(0);
      }
    });

    it("fails closed with BLOCKED_MEASUREMENT_FAILED and zero fabricated constants when statfsSync fails", () => {
      const snap = captureDiskSpaceSnapshot(process.cwd(), (() => {
        throw new Error("EIO: statfs failed");
      }) as any);
      expect(snap.measurementStatus).toBe("BLOCKED_MEASUREMENT_FAILED");
      expect(snap.freeBytes).toBe(0);

      const audit = buildSafeDiskRecoveryAudit({
        testedSourceSha: validSha,
        statfsFn: null,
      });
      expect(audit.measurementStatus).toBe("BLOCKED_MEASUREMENT_FAILED");
      expect(audit.guardStatus).toBe("BLOCKED_MEASUREMENT_FAILED");
      expect(audit.heavyWavesUnblocked).toBe(false);
      expect(audit.beforeFreeBytes).toBe(0);
      expect(audit.reclaimedBytes).toBe(0);
    });
  });

  describe("Validator CHK_17, CHK_18 & 46 Physical-File Negative Control Mutations (MUT_01..MUT_46)", () => {
    it("passes all 20 validator checks on canonical baseline and catches all 46 physical-file mutations (MUT_01..MUT_46)", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "kh02-v12.4.3.4.9-unit-")
      );
      try {
        writeCanonicalValidBaselineFixture(tmpDir, validSha);

        const valReport = validateAcceptanceArtifacts(tmpDir, {
          skipSelfMutationReportCheck: true,
        });
        expect(valReport.overallValid).toBe(true);
        expect(valReport.failedChecks).toBe(0);
        expect(valReport.totalChecks).toBe(20);
        expect(
          valReport.checks.some(
            (c) => c.checkId === "CHK_17_SAFE_DISK_RECOVERY_AUDIT" && c.passed
          )
        ).toBe(true);
        expect(
          valReport.checks.some(
            (c) =>
              c.checkId === "CHK_18_CLI_EXIT_DECISION_CONSISTENCY" && c.passed
          )
        ).toBe(true);

        const negSuite = runNegativeControlSuite(tmpDir);
        expect(negSuite.totalMutations).toBe(46);
        expect(negSuite.totalCaughtAndRejected).toBe(46);
        expect(negSuite.suiteVerdict).toBe("PASS");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
