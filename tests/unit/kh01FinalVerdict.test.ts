import { describe, it, expect } from "vitest";
import {
  CANONICAL_ACCEPTANCE_GATES,
  finalizeAcceptanceVerdict,
  GateEvidence,
  LiveMetaVerificationResult,
  AcceptanceArtifactStatus,
} from "../../src/lib/kh01/acceptanceGateRegistry";

describe("KH-01 Release Verdict & Final Decision (Parts 18, 19, 29)", () => {
  const allPassingGates: GateEvidence[] = CANONICAL_ACCEPTANCE_GATES.map((g) => ({
    gateId: g.gateId,
    runId: "run_test_acc",
    testId: g.gateId,
    status: "PASSED",
    evidenceType: g.evidenceType,
    evidenceReference: `Passed assertion for ${g.gateId}`,
    observedAt: new Date().toISOString(),
  }));

  const offlinePassingStages = [
    { stageId: "STAGE_01_GIT_STATE", status: "PASSED" as const },
    { stageId: "STAGE_02_TYPESCRIPT", status: "PASSED" as const },
    { stageId: "STAGE_03A_SECURITY", status: "PASSED" as const },
    { stageId: "STAGE_03B_EXACT_RUN", status: "PASSED" as const },
    { stageId: "STAGE_03C_READINESS", status: "PASSED" as const },
    { stageId: "STAGE_03D_TRUTHFULNESS", status: "PASSED" as const },
    { stageId: "STAGE_03E_DOMAIN_UNIT", status: "PASSED" as const },
    { stageId: "STAGE_04_CONCURRENCY_RECOVERY", status: "PASSED" as const },
    { stageId: "STAGE_05_UNIFIED_JOURNEY", status: "PASSED" as const },
    { stageId: "STAGE_06_PRODUCTION_BUILD", status: "PASSED" as const },
    { stageId: "STAGE_08_META_DISCOVERY_BROWSER_E2E", status: "PASSED" as const },
    { stageId: "STAGE_09_ARTIFACT_VALIDATION", status: "PASSED" as const },
    { stageId: "STAGE_10_FINAL_MANIFEST_VALIDATION", status: "PASSED" as const },
  ];

  const passingArtifacts: AcceptanceArtifactStatus[] = [
    { artifactId: "gate-results", required: true, status: "PASSED", evidencePath: "gate-results.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "stage-results", required: true, status: "PASSED", evidencePath: "stage-results.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "database-isolation", required: true, status: "PASSED", evidencePath: "database-isolation.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "security-results", required: true, status: "PASSED", evidencePath: "security-results.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "offline-reconciliation", required: true, status: "PASSED", evidencePath: "offline-reconciliation.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "browser-e2e-results", required: true, status: "PASSED", evidencePath: "browser-e2e-results.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "artifact-validation", required: true, status: "PASSED", evidencePath: "artifact-validation.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "release-verdict", required: true, status: "PASSED", evidencePath: "release-verdict.json", evidenceOrigin: "ACTUAL_FILE" },
    { artifactId: "execution-metadata", required: true, status: "PASSED", evidencePath: "execution-metadata.json", evidenceOrigin: "ACTUAL_FILE" },
  ];

  const unexecutedLiveResult: LiveMetaVerificationResult = {
    status: "NOT_RUN",
    detailedOutcome: "NOT_RUN",
    levelsVerified: [],
    runId: null,
    source: "https://www.facebook.com/ads/library/",
    retrievedCount: 0,
    validCount: 0,
    linkedCount: 0,
    displayedCount: 0,
    evidenceReferences: ["Live Meta source was not requested (--offline-only)"],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const fullyVerifiedLiveResult: LiveMetaVerificationResult = {
    status: "PASSED",
    detailedOutcome: "LIVE_RECONCILED",
    levelsVerified: [
      "MCP_CONNECTED",
      "SOURCE_ACCESSIBLE",
      "ADS_COLLECTED",
      "ADS_PERSISTED",
      "RUN_RECONCILED",
    ],
    runId: "run_live_123",
    source: "https://www.facebook.com/ads/library/",
    retrievedCount: 5,
    validCount: 5,
    linkedCount: 5,
    displayedCount: 5,
    evidenceReferences: ["Collected and reconciled 5 ads"],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  it("yields CONDITIONALLY_ACCEPTED when all offline checks pass and live was not requested", () => {
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      unexecutedLiveResult,
      [],
      [],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("CONDITIONALLY_ACCEPTED");
  });

  it("yields ACCEPTED when all offline checks pass and full live Meta was verified", () => {
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      fullyVerifiedLiveResult,
      [],
      [],
      passingArtifacts,
      "FULL_LIVE"
    );
    expect(verdict).toBe("ACCEPTED");
  });

  it("blocks release when any mandatory gate fails", () => {
    const firstMandatoryDef = CANONICAL_ACCEPTANCE_GATES.find((g) => g.criticality === "MANDATORY")!;
    const corruptedGates = allPassingGates.map((g) =>
      g.gateId === firstMandatoryDef.gateId ? { ...g, status: "FAILED" as const } : g
    );
    const verdict = finalizeAcceptanceVerdict(
      corruptedGates,
      offlinePassingStages,
      unexecutedLiveResult,
      [],
      [],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when any mandatory gate is NOT_RUN", () => {
    const firstMandatoryDef = CANONICAL_ACCEPTANCE_GATES.find((g) => g.criticality === "MANDATORY")!;
    const corruptedGates = allPassingGates.map((g) =>
      g.gateId === firstMandatoryDef.gateId ? { ...g, status: "NOT_RUN" as const } : g
    );
    const verdict = finalizeAcceptanceVerdict(
      corruptedGates,
      offlinePassingStages,
      unexecutedLiveResult,
      [],
      [],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when any acceptance stage fails", () => {
    const corruptedStages = offlinePassingStages.map((s) =>
      s.stageId === "STAGE_08_META_DISCOVERY_BROWSER_E2E" ? { ...s, status: "FAILED" as const } : s
    );
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      corruptedStages,
      unexecutedLiveResult,
      [],
      [],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when manifest has validation errors", () => {
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      unexecutedLiveResult,
      [],
      ["Manifest error: Tested commit SHA does not match HEAD"],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when any required artifact is FAILED or NOT_RUN", () => {
    const corruptedArtifacts = passingArtifacts.map((a) =>
      a.artifactId === "database-isolation" ? { ...a, status: "FAILED" as const } : a
    );
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      unexecutedLiveResult,
      [],
      [],
      corruptedArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when FULL_LIVE was requested but live Meta verification failed", () => {
    const failedLiveResult: LiveMetaVerificationResult = {
      ...unexecutedLiveResult,
      status: "FAILED",
      detailedOutcome: "RECONCILIATION_FAILED",
      error: "Upstream rate limit or challenge",
    };

    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      failedLiveResult,
      [],
      [],
      passingArtifacts,
      "FULL_LIVE"
    );
    expect(verdict).toBe("BLOCKED");
  });

  it("blocks release when unresolved defects are listed", () => {
    const verdict = finalizeAcceptanceVerdict(
      allPassingGates,
      offlinePassingStages,
      unexecutedLiveResult,
      ["FIX-01: Live research still bypasses worker"],
      [],
      passingArtifacts,
      "OFFLINE"
    );
    expect(verdict).toBe("BLOCKED");
  });
});
