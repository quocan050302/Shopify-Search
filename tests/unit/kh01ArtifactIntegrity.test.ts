import { describe, it, expect } from "vitest";
import {
  evaluateRequiredArtifacts,
  finalizeAcceptanceVerdict,
  AcceptanceArtifactStatus,
  LiveMetaVerificationResult,
  GateEvidence,
  CANONICAL_ACCEPTANCE_GATES,
} from "../../src/lib/kh01/acceptanceGateRegistry";
import { buildBrowserArtifact } from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Artifact Integrity & Blocking (Section 07, 08, 11)", () => {
  function getBasePassingGates(): GateEvidence[] {
    return CANONICAL_ACCEPTANCE_GATES.filter((g) => g.criticality === "MANDATORY").map((g) => ({
      gateId: g.gateId,
      runId: "test_run",
      testId: `${g.stageId}::${g.gateId}`,
      status: "PASSED",
      evidenceType: g.evidenceType,
      evidenceReference: "Valid test evidence",
      observedAt: new Date().toISOString(),
    }));
  }

  function getSampleLiveResult(status: "PASSED" | "NOT_RUN" | "FAILED" = "NOT_RUN"): LiveMetaVerificationResult {
    return {
      status,
      detailedOutcome: status === "PASSED" ? "LIVE_RECONCILED" : status === "FAILED" ? "PERSISTENCE_FAILED" : "NOT_RUN",
      levelsVerified: status === "PASSED" ? ["NETWORK_REACHABLE", "MCP_CONNECTED", "SOURCE_ACCESSIBLE", "ADS_COLLECTED", "ADS_PERSISTED", "RUN_RECONCILED"] : [],
      runId: status === "PASSED" ? "run_live_test" : null,
      source: "https://www.facebook.com/ads/library",
      retrievedCount: status === "PASSED" ? 5 : 0,
      validCount: status === "PASSED" ? 5 : 0,
      linkedCount: status === "PASSED" ? 5 : 0,
      displayedCount: status === "PASSED" ? 5 : 0,
      evidenceReferences: ["Sample evidence"],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  it("evaluateRequiredArtifacts blocks when required artifact is FAILED", () => {
    const artifacts: AcceptanceArtifactStatus[] = [
      {
        artifactId: "exact-run-reconciliation",
        required: true,
        status: "FAILED",
        evidencePath: "path/to/recon.json",
        evidenceOrigin: "ACTUAL_DATABASE_QUERY",
        error: "Reconciliation invariant violation",
      },
    ];

    const evalResult = evaluateRequiredArtifacts(artifacts);
    expect(evalResult.passed).toBe(false);
    expect(evalResult.blockingArtifactIds).toContain("exact-run-reconciliation");
  });

  it("evaluateRequiredArtifacts blocks when required artifact is NOT_RUN", () => {
    const artifacts: AcceptanceArtifactStatus[] = [
      {
        artifactId: "browser-results",
        required: true,
        status: "NOT_RUN",
        evidencePath: null,
        evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION",
      },
    ];

    const evalResult = evaluateRequiredArtifacts(artifacts);
    expect(evalResult.passed).toBe(false);
    expect(evalResult.blockingArtifactIds).toContain("browser-results");
  });

  it("finalizeAcceptanceVerdict returns BLOCKED when a required artifact is FAILED", () => {
    const gates = getBasePassingGates();
    const live = getSampleLiveResult("NOT_RUN");
    const stages = [{ stageId: "STAGE_01", status: "PASSED" as const }];

    const artifacts: AcceptanceArtifactStatus[] = [
      {
        artifactId: "exact-run-reconciliation",
        required: true,
        status: "FAILED",
        evidencePath: "artifacts/exact-run.json",
        evidenceOrigin: "ACTUAL_DATABASE_QUERY",
      },
    ];

    const verdict = finalizeAcceptanceVerdict(
      gates,
      stages,
      live,
      [],
      [],
      artifacts,
      "OFFLINE"
    );

    expect(verdict).toBe("BLOCKED");
  });

  it("finalizeAcceptanceVerdict returns BLOCKED when scope is FULL_LIVE but live is NOT_RUN", () => {
    const gates = getBasePassingGates();
    const live = getSampleLiveResult("NOT_RUN");
    const stages = [{ stageId: "STAGE_01", status: "PASSED" as const }];
    const artifacts: AcceptanceArtifactStatus[] = [
      {
        artifactId: "exact-run-reconciliation",
        required: true,
        status: "PASSED",
        evidencePath: "artifacts/exact-run.json",
        evidenceOrigin: "ACTUAL_DATABASE_QUERY",
      },
    ];

    const verdict = finalizeAcceptanceVerdict(
      gates,
      stages,
      live,
      [],
      [],
      artifacts,
      "FULL_LIVE" // Explicitly requested full live scope
    );

    expect(verdict).toBe("BLOCKED");
  });

  it("finalizeAcceptanceVerdict allows CONDITIONALLY_ACCEPTED when scope is OFFLINE and artifacts pass", () => {
    const gates = getBasePassingGates();
    const live = getSampleLiveResult("NOT_RUN");
    const stages = [{ stageId: "STAGE_01", status: "PASSED" as const }];
    const artifacts: AcceptanceArtifactStatus[] = [
      {
        artifactId: "exact-run-reconciliation",
        required: true,
        status: "PASSED",
        evidencePath: "artifacts/exact-run.json",
        evidenceOrigin: "ACTUAL_DATABASE_QUERY",
      },
      {
        artifactId: "browser-results",
        required: true,
        status: "PASSED",
        evidencePath: "artifacts/browser-results.json",
        evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION",
      },
    ];

    const verdict = finalizeAcceptanceVerdict(
      gates,
      stages,
      live,
      [],
      [],
      artifacts,
      "OFFLINE"
    );

    expect(verdict).toBe("CONDITIONALLY_ACCEPTED");
  });

  it("buildBrowserArtifact does not hardcode untested viewports when no tests ran", () => {
    const artifact = buildBrowserArtifact("run_empty_browser", []);
    expect(artifact.status).toBe("NOT_RUN");
    expect(artifact.viewportsTested).toEqual([]);
  });
});
