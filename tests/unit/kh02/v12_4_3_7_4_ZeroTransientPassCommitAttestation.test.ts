import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createAcceptanceRunState,
  transitionAcceptanceRunState,
  markAcceptanceFailed,
  atomicWriteFinalArtifact,
  publishFinalVerdictAfterEvidenceBarrier,
  simulateAcceptanceCrashInjectionAtStage,
  validateCommitPushAttestation,
  computeV12_4_3_7_2ReleaseVerdicts,
  type CrashInjectionStageV12_4_3_7_4,
} from "../../../scripts/kh02/acceptanceTruth";

const TEST_SHA = "7577a9bfd58817053d23c8a5b134ac0f138fc7d2";
const TEST_BRANCH = "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1";

describe("KH-02 V12.4.3.7.4 — Zero Transient False-Pass & True Post-Push Commit Attestation", () => {
  describe("P0-A: Acceptance State Machine & Crash Injection Proof", () => {
    it("creates, transitions, and terminates RUN_STATE.json cleanly", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-state-test-"));
      try {
        const state0 = createAcceptanceRunState(tempDir, {
          runId: "run_test_01",
          codeSha: TEST_SHA,
          treeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          branch: TEST_BRANCH,
        });
        expect(state0.status).toBe("RUNNING");
        expect(state0.stage).toBe("CREATED");
        expect(state0.isFinal).toBe(false);

        const state1 = transitionAcceptanceRunState(
          tempDir,
          "RUNNING_TESTS",
          "Running Vitest"
        );
        expect(state1.stage).toBe("RUNNING_TESTS");

        const state2 = transitionAcceptanceRunState(
          tempDir,
          "MUTATION_RUNNING",
          "Running physical mutations"
        );
        expect(state2.stage).toBe("MUTATION_RUNNING");

        const state3 = transitionAcceptanceRunState(
          tempDir,
          "TESTS_COMPLETED",
          "Mutations finished"
        );
        expect(state3.stage).toBe("TESTS_COMPLETED");

        const state4 = transitionAcceptanceRunState(
          tempDir,
          "FINAL_VERDICT_COMPUTED",
          "24 computed"
        );
        expect(state4.stage).toBe("FINAL_VERDICT_COMPUTED");

        const state5 = transitionAcceptanceRunState(
          tempDir,
          "ARTIFACTS_VALIDATED",
          "23 validated"
        );
        expect(state5.stage).toBe("ARTIFACTS_VALIDATED");

        const state6 = transitionAcceptanceRunState(
          tempDir,
          "EVIDENCE_COMMITTED",
          "Commit E created"
        );
        expect(state6.stage).toBe("EVIDENCE_COMMITTED");

        const state7 = transitionAcceptanceRunState(
          tempDir,
          "PUSH_VERIFIED",
          "Commit E pushed"
        );
        expect(state7.stage).toBe("PUSH_VERIFIED");

        const state8 = transitionAcceptanceRunState(
          tempDir,
          "ATTESTED",
          "Attestation commit pushed"
        );
        expect(state8.stage).toBe("ATTESTED");
        expect(state8.status).toBe("COMPLETED");
        expect(state8.isFinal).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects illegal transitions skipping mutation stages", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-state-illegal-"));
      try {
        createAcceptanceRunState(tempDir, {
          runId: "run_illegal_01",
          codeSha: TEST_SHA,
          treeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          branch: TEST_BRANCH,
        });
        transitionAcceptanceRunState(tempDir, "RUNNING_TESTS", "Running");
        expect(() => {
          transitionAcceptanceRunState(
            tempDir,
            "FINAL_VERDICT_COMPUTED",
            "Premature verdict computation without mutations"
          );
        }).toThrow(/ILLEGAL_RUN_STATE_TRANSITION_TO_FINAL_VERDICT_WITHOUT_MUTATIONS/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("marks terminal failure and records failure reason", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-state-fail-"));
      try {
        createAcceptanceRunState(tempDir, {
          runId: "run_fail_01",
          codeSha: TEST_SHA,
          treeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          branch: TEST_BRANCH,
        });
        const failedState = markAcceptanceFailed(
          tempDir,
          "FATAL_TEST_CRASH",
          "Vitest worker timed out",
          false
        );
        expect(failedState.status).toBe("FAILED");
        expect(failedState.stage).toBe("FAILED");
        expect(failedState.isFinal).toBe(false);
        expect(failedState.failureReason).toContain("FATAL_TEST_CRASH");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("passes all 7 mandatory crash injection stages without leaving outward release PASS", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-crash-all7-"));
      const stages: CrashInjectionStageV12_4_3_7_4[] = [
        "BEFORE_MUTATION_STARTS",
        "MID_PHYSICAL_MUTATION",
        "JUST_AFTER_22_WRITTEN",
        "WHILE_WRITING_24",
        "AFTER_FINAL_VALIDATION_BEFORE_COMMIT",
        "AFTER_EVIDENCE_PUSH_BEFORE_ATTESTATION",
        "BEFORE_LAST_REMOTE_VERIFICATION",
      ];
      try {
        for (const stage of stages) {
          const res = simulateAcceptanceCrashInjectionAtStage(stage, tempDir, TEST_SHA);
          expect(res.crashedAsExpected).toBe(true);
          expect(res.file24ExistsAfterCrash).toBe(false);
          expect(res.file27ExistsAfterCrash).toBe(false);
          expect(res.outwardReleasePassPublished).toBe(false);
          expect(res.passed).toBe(true);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("atomicWriteFinalArtifact writes file atomically and preserves contents", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-atomic-write-"));
      try {
        const payload = { hello: "world", value: 42 };
        atomicWriteFinalArtifact(tempDir, "test.json", payload);
        const readBack = JSON.parse(
          fs.readFileSync(path.join(tempDir, "test.json"), "utf8")
        );
        expect(readBack).toEqual(payload);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("publishFinalVerdictAfterEvidenceBarrier refuses to publish when mutationSuite is incomplete", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-barrier-refuse-"));
      try {
        createAcceptanceRunState(tempDir, {
          runId: "run_barrier_01",
          codeSha: TEST_SHA,
          treeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          branch: TEST_BRANCH,
        });
        transitionAcceptanceRunState(tempDir, "RUNNING_TESTS", "Running");
        transitionAcceptanceRunState(tempDir, "MUTATION_RUNNING", "Mutations");
        transitionAcceptanceRunState(tempDir, "TESTS_COMPLETED", "Done");
        expect(() => {
          publishFinalVerdictAfterEvidenceBarrier(
            tempDir,
            {
              expectedCodeSha: TEST_SHA,
              mutationSuite: null,
            } as any
          );
        }).toThrow(/BARRIER_VIOLATION/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("P0-B: Meaningful Mutations & Inconclusive Baseline Rejection", () => {
    it("rejects mutation receipts marked with kind !== ACTUAL_COMPLETED_MUTATION_RUN", () => {
      const res = computeV12_4_3_7_2ReleaseVerdicts({
        expectedCodeSha: TEST_SHA,
        mutationSuite: {
          codeSha: TEST_SHA,
          kind: "FIXTURE_PSEUDO_MUTATION" as any,
          completedAt: "2026-11-02T10:00:00.000Z",
          totalMutationsExecuted: 98,
          caughtMutationsCount: 98,
          falsePassesCount: 0,
          inconclusiveCount: 0,
          sourceTreeRestoredClean: true,
        },
      } as any);
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("FAIL");
    });

    it("rejects mutation receipts with isFixtureOnly === true or scope === TEST_FIXTURE", () => {
      const res = computeV12_4_3_7_2ReleaseVerdicts({
        expectedCodeSha: TEST_SHA,
        mutationSuite: {
          codeSha: TEST_SHA,
          kind: "ACTUAL_COMPLETED_MUTATION_RUN",
          isFixtureOnly: true,
          completedAt: "2026-11-02T10:00:00.000Z",
          totalMutationsExecuted: 98,
          caughtMutationsCount: 98,
          falsePassesCount: 0,
          inconclusiveCount: 0,
          sourceTreeRestoredClean: true,
        },
      } as any);
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("FAIL");
    });

    it("rejects mutation receipts with inconclusiveCount > 0", () => {
      const res = computeV12_4_3_7_2ReleaseVerdicts({
        expectedCodeSha: TEST_SHA,
        mutationSuite: {
          codeSha: TEST_SHA,
          kind: "ACTUAL_COMPLETED_MUTATION_RUN",
          isFixtureOnly: false,
          completedAt: "2026-11-02T10:00:00.000Z",
          totalMutationsExecuted: 98,
          caughtMutationsCount: 98,
          falsePassesCount: 0,
          inconclusiveCount: 1,
          sourceTreeRestoredClean: true,
        },
      } as any);
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("FAIL");
    });

    it("rejects mutation receipts when acceptanceRunId mismatches", () => {
      const res = computeV12_4_3_7_2ReleaseVerdicts({
        expectedCodeSha: TEST_SHA,
        acceptanceRunId: "run_alpha",
        mutationSuite: {
          codeSha: TEST_SHA,
          kind: "ACTUAL_COMPLETED_MUTATION_RUN",
          acceptanceRunId: "run_beta",
          completedAt: "2026-11-02T10:00:00.000Z",
          totalMutationsExecuted: 98,
          caughtMutationsCount: 98,
          falsePassesCount: 0,
          inconclusiveCount: 0,
          sourceTreeRestoredClean: true,
        },
      } as any);
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("FAIL");
    });
  });

  describe("P0-C: Non-Circular Commit Attestation (S -> E -> A)", () => {
    it("validates a truthful non-placeholder, non-self-referential attestation", () => {
      const res = validateCommitPushAttestation(
        {
          codeSha: TEST_SHA,
          testedCodeSha: TEST_SHA,
          testedTreeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          evidenceContentCommitSha: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          remoteHeadObservedAfterEvidencePush: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          branch: TEST_BRANCH,
          attestationScope: "EVIDENCE_COMMIT_E_ALREADY_PUSHED",
          isSelfReferential: false,
          remoteReadbackVerified: true,
          ancestryVerifiedStoE: true,
          provider: "ORIGIN_GIT_REMOTE_LS_REMOTE",
          verificationMethod: "GIT_LS_REMOTE_AND_ANCESTRY_AUDIT",
          remoteRefReadbackAt: new Date().toISOString(),
          evidenceManifestSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          independentValidatorReportSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        {
          expectedCodeSha: TEST_SHA,
        }
      );
      expect(res.valid).toBe(true);
      expect(res.reasons).toHaveLength(0);
    });

    it("rejects PENDING_EVIDENCE_COMMIT placeholder", () => {
      const res = validateCommitPushAttestation(
        {
          codeSha: TEST_SHA,
          testedCodeSha: TEST_SHA,
          testedTreeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          evidenceContentCommitSha: "PENDING_EVIDENCE_COMMIT",
          branch: TEST_BRANCH,
          attestationScope: "EVIDENCE_COMMIT_E_ALREADY_PUSHED",
          isSelfReferential: false,
          remoteReadbackVerified: true,
          ancestryVerifiedStoE: true,
          provider: "ORIGIN_GIT_REMOTE_LS_REMOTE",
          verificationMethod: "GIT_LS_REMOTE_AND_ANCESTRY_AUDIT",
          remoteRefReadbackAt: new Date().toISOString(),
          evidenceManifestSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          independentValidatorReportSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        { expectedCodeSha: TEST_SHA }
      );
      expect(res.valid).toBe(false);
      expect(res.reasons.some((r) => r.includes("PENDING_EVIDENCE_COMMIT"))).toBe(true);
    });

    it("rejects self-referential attestation commit SHA", () => {
      const res = validateCommitPushAttestation(
        {
          codeSha: TEST_SHA,
          testedCodeSha: TEST_SHA,
          testedTreeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          evidenceContentCommitSha: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          attestationCommitSha: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          remoteHeadObservedAfterEvidencePush: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          isSelfReferential: true,
          branch: TEST_BRANCH,
          remoteReadbackVerified: true,
          ancestryVerifiedStoE: true,
          provider: "ORIGIN_GIT_REMOTE_LS_REMOTE",
          verificationMethod: "GIT_LS_REMOTE_AND_ANCESTRY_AUDIT",
          remoteRefReadbackAt: new Date().toISOString(),
          evidenceManifestSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          independentValidatorReportSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        { expectedCodeSha: TEST_SHA }
      );
      expect(res.valid).toBe(false);
      expect(res.reasons.some((r) => r.includes("SELF_REFERENTIAL"))).toBe(true);
    });

    it("rejects unpushed evidence SHA when remote head does not match", () => {
      const res = validateCommitPushAttestation(
        {
          codeSha: TEST_SHA,
          testedCodeSha: TEST_SHA,
          testedTreeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          evidenceContentCommitSha: "1111111111111111111111111111111111111111",
          remoteHeadObservedAfterEvidencePush: "2222222222222222222222222222222222222222",
          branch: TEST_BRANCH,
          attestationScope: "EVIDENCE_COMMIT_E_ALREADY_PUSHED",
          isSelfReferential: false,
          remoteReadbackVerified: true,
          ancestryVerifiedStoE: true,
          provider: "ORIGIN_GIT_REMOTE_LS_REMOTE",
          verificationMethod: "GIT_LS_REMOTE_AND_ANCESTRY_AUDIT",
          remoteRefReadbackAt: new Date().toISOString(),
          evidenceManifestSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          independentValidatorReportSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        { expectedCodeSha: TEST_SHA }
      );
      expect(res.valid).toBe(false);
      expect(res.reasons.some((r) => r.includes("REMOTE_HEAD_OBSERVED_MISMATCH"))).toBe(true);
    });

    it("rejects wrong branch name", () => {
      const res = validateCommitPushAttestation(
        {
          codeSha: TEST_SHA,
          testedCodeSha: TEST_SHA,
          testedTreeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
          evidenceContentCommitSha: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          remoteHeadObservedAfterEvidencePush: "aec0685dd8e491c38028caac96b201b3fd30ee90",
          branch: "main",
          attestationScope: "EVIDENCE_COMMIT_E_ALREADY_PUSHED",
          isSelfReferential: false,
          remoteReadbackVerified: true,
          ancestryVerifiedStoE: true,
          provider: "ORIGIN_GIT_REMOTE_LS_REMOTE",
          verificationMethod: "GIT_LS_REMOTE_AND_ANCESTRY_AUDIT",
          remoteRefReadbackAt: new Date().toISOString(),
          evidenceManifestSha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          independentValidatorReportSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        },
        { expectedCodeSha: TEST_SHA }
      );
      expect(res.valid).toBe(false);
      expect(res.reasons.some((r) => r.includes("INVALID_ATTESTATION_BRANCH"))).toBe(true);
    });
  });
});
