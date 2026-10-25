import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect } from "vitest";
import {
  evaluateRequiredArtifacts,
  finalizeAcceptanceVerdict,
  AcceptanceArtifactStatus,
  LiveMetaVerificationResult,
  GateEvidence,
  CANONICAL_ACCEPTANCE_GATES,
} from "../../src/lib/kh01/acceptanceGateRegistry";
import {
  buildBrowserArtifact,
  prepareAcceptanceArtifactSet,
  validateAcceptanceArtifact,
  publishAcceptanceArtifactsAtomically,
  parseBrowserExecutionEvidence,
  BrowserExecutionEvidence,
} from "../../scripts/kh01/runFullAcceptance";

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

  it("validateAcceptanceArtifact rejects database-process-identity.json when verified is false (V1159-04)", () => {
    const res = validateAcceptanceArtifact(
      {
        name: "database-process-identity.json",
        data: {
          acceptanceRunId: "run_test_123",
          testedCommitSha: "sha_test_123",
          verified: false,
          observedProcesses: [
            { processName: "WORKER", markerObserved: true },
            { processName: "NEXTJS_SERVER", markerObserved: true },
          ],
        },
      },
      "run_test_123",
      "sha_test_123"
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("verified"))).toBe(true);
  });

  it("validateAcceptanceArtifact rejects database-process-identity.json when required process is missing (V1159-04)", () => {
    const res = validateAcceptanceArtifact(
      {
        name: "database-process-identity.json",
        data: {
          acceptanceRunId: "run_test_123",
          testedCommitSha: "sha_test_123",
          verified: true,
          observedProcesses: [
            { processName: "WORKER", markerObserved: true },
          ],
        },
      },
      "run_test_123",
      "sha_test_123"
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Next.js"))).toBe(true);
  });

  it("buildBrowserArtifact does not hardcode untested viewports when no tests ran", () => {
    const artifact = buildBrowserArtifact("run_empty_browser", []);
    expect(artifact.status).toBe("NOT_RUN");
    expect(artifact.viewportsTested).toEqual([]);
  });

  it("buildBrowserArtifact marks status FAILED when browser evidence contains only 2 of 6 viewports even if stage PASSED", () => {
    const stages = [
      {
        stageId: "STAGE_08_META_DISCOVERY_BROWSER_E2E",
        status: "PASSED" as const,
        exitCode: 0,
        name: "Browser E2E",
        command: "vitest",
        durationMs: 100,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        assertions: [
          {
            assertionId: "ASSERTION_STAGE_08_BROWSER_E2E",
            stageId: "STAGE_08_META_DISCOVERY_BROWSER_E2E",
            acceptanceRunId: "run_test_vp",
            status: "PASSED" as const,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            evidenceType: "BROWSER_ACTION" as const,
            evidenceReference: "Passed viewport test",
            error: null,
          },
        ],
      },
    ];

    const partialEvidence: BrowserExecutionEvidence = {
      acceptanceRunId: "run_test_vp",
      browserName: "chromium",
      totalViewports: 2,
      passedViewports: 2,
      failedViewports: 0,
      valid: true,
      executions: [
        {
          testId: "viewport_390x844",
          browserName: "chromium",
          width: 390,
          height: 844,
          viewportLabel: "Mobile",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: "PASSED",
          pageUrl: "http://127.0.0.1:3000/explorer",
          browserLaunched: true,
          pageNavigated: true,
          domAssertionsExecuted: 3,
          horizontalOverflowDetected: false,
          screenshotPath: "/path/to/shot1.png",
        },
        {
          testId: "viewport_1440x900",
          browserName: "chromium",
          width: 1440,
          height: 900,
          viewportLabel: "Desktop",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          status: "PASSED",
          pageUrl: "http://127.0.0.1:3000/explorer",
          browserLaunched: true,
          pageNavigated: true,
          domAssertionsExecuted: 3,
          horizontalOverflowDetected: false,
          screenshotPath: "/path/to/shot2.png",
        },
      ],
    };

    const artifact = buildBrowserArtifact("run_test_vp", stages, partialEvidence);
    expect(artifact.status).toBe("FAILED");
    expect(artifact.viewportsTested).toEqual(["390x844", "1440x900"]);
    expect(artifact.canonicalMissingViewports.length).toBe(4);
    expect(artifact.canonicalMissingViewports).toContain("1920x1080");
  });

  it("buildBrowserArtifact marks status NOT_RUN when browser evidence file is missing and blocks release", () => {
    const stages = [
      {
        stageId: "STAGE_08_META_DISCOVERY_BROWSER_E2E",
        status: "PASSED" as const,
        exitCode: 0,
        name: "Browser E2E",
        command: "vitest",
        durationMs: 100,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        assertions: [],
      },
    ];

    const missingEvidence = parseBrowserExecutionEvidence("/nonexistent/browser-results.json", "run_missing_evidence");
    expect(missingEvidence.valid).toBe(false);

    const artifact = buildBrowserArtifact("run_missing_evidence", stages, missingEvidence);
    expect(artifact.status).toBe("NOT_RUN");

    const gates = getBasePassingGates();
    const live = getSampleLiveResult("NOT_RUN");
    const artifactStatuses: AcceptanceArtifactStatus[] = [
      {
        artifactId: "browser-results",
        required: true,
        status: artifact.status,
        evidencePath: null,
        evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION",
      },
    ];

    const verdict = finalizeAcceptanceVerdict(gates, stages, live, [], [], artifactStatuses, "OFFLINE");
    expect(verdict).toBe("BLOCKED");
  });

  function buildSampleOfflineArtifactSet(runId: string, sha: string, overrides: { releaseVerdict?: string; mismatchVerdict?: boolean } = {}) {
    const verdictValue = overrides.releaseVerdict || "CONDITIONALLY_ACCEPTED";
    const manifest = {
      acceptanceRunId: runId,
      testedCommitSha: sha,
      releaseVerdict: verdictValue,
    };
    const verdict = {
      verdict: overrides.mismatchVerdict ? "BLOCKED" : verdictValue,
      requestedScope: "OFFLINE",
    };
    const metadata = {
      acceptanceRunId: runId,
      testedCommitSha: sha,
      overallStatus: verdictValue,
    };

    const offlineFiles = [
      { name: "acceptance-manifest.json", data: manifest },
      { name: "gate-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "stage-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "security-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      {
        name: "database-isolation.json",
        data: {
          acceptanceRunId: runId,
          testedCommitSha: sha,
          status: "PASSED",
          prismaConnectionVerified: true,
          markerWriteVerified: true,
          markerReadVerified: true,
          activeDatabaseProtected: true,
        },
      },
      {
        name: "database-process-identity.json",
        data: {
          acceptanceRunId: runId,
          testedCommitSha: sha,
          status: "PASSED",
          verified: true,
          observedProcesses: [
            { processName: "WORKER", markerObserved: true },
            { processName: "NEXTJS_SERVER", markerObserved: true },
          ],
        },
      },
      { name: "exact-run-reconciliation.json", data: { acceptanceRunId: runId, testedCommitSha: sha, retrieved: 10, valid: 10, linked: 10 } },
      { name: "offline-reconciliation.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      {
        name: "browser-results.json",
        data: {
          acceptanceRunId: runId,
          testedCommitSha: sha,
          status: "PASSED",
          viewportsTested: ["1920x1080", "1440x900", "1280x800", "1024x768", "768x1024", "390x844"],
        },
      },
      { name: "browser-e2e-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "browser-viewport-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "worker-process-evidence.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "defect-register.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "artifact-validation.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "validation-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "PASSED" } },
      { name: "release-verdict.json", data: verdict },
      { name: "execution-metadata.json", data: metadata },
      {
        name: "suite-coverage.json",
        data: {
          acceptanceRunId: runId,
          testedCommitSha: sha,
          status: "PASSED",
          passed: true,
          missingSuites: [],
          failedSuites: [],
        },
      },
      {
        name: "screenshot-manifest.json",
        data: {
          acceptanceRunId: runId,
          testedCommitSha: sha,
          screenshots: [
            { relativePath: "screenshots/viewport_1920x1080.png", sha256: "abc1" },
          ],
        },
      },
      { name: "live-source-results.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "NOT_RUN", detailedOutcome: "NOT_RUN" } },
      { name: "live-source-verification.json", data: { acceptanceRunId: runId, testedCommitSha: sha, status: "NOT_RUN" } },
    ];

    return prepareAcceptanceArtifactSet(runId, sha, offlineFiles);
  }

  it("publishAcceptanceArtifactsAtomically writes to staging, verifies disk readback, renames atomically, and updates latest.json", async () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "swai-atomic-test-"));
    try {
      const runId = "run_atomic_001";
      const sha = "a1b2c3d4e5f6";
      const set = buildSampleOfflineArtifactSet(runId, sha);

      const result = await publishAcceptanceArtifactsAtomically(set, { artifactsBaseDir: tempBaseDir });
      expect(result.success).toBe(true);
      expect(fs.existsSync(result.publishedRunDir)).toBe(true);
      expect(fs.existsSync(path.join(result.publishedRunDir, "acceptance-manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(tempBaseDir, "latest.json"))).toBe(true);

      const latestPointer = JSON.parse(fs.readFileSync(path.join(tempBaseDir, "latest.json"), "utf8"));
      expect(latestPointer.acceptanceRunId).toBe(runId);
      expect(latestPointer.testedCommitSha).toBe(sha);

      // Verify checksums
      expect(result.checksums["acceptance-manifest.json"]).toBeDefined();
    } finally {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it("publishAcceptanceArtifactsAtomically blocks publication and does not update latest.json when validation fails", async () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "swai-atomic-fail-"));
    try {
      // First publish a valid initial run
      const initialRunId = "run_initial_valid";
      const initialSha = "sha_initial";
      const validSet = buildSampleOfflineArtifactSet(initialRunId, initialSha, { releaseVerdict: "ACCEPTED" });
      const initRes = await publishAcceptanceArtifactsAtomically(validSet, { artifactsBaseDir: tempBaseDir });
      expect(initRes.success).toBe(true);

      const initialLatestPointer = JSON.parse(fs.readFileSync(path.join(tempBaseDir, "latest.json"), "utf8"));
      expect(initialLatestPointer.acceptanceRunId).toBe(initialRunId);

      // Now attempt to publish an invalid set (verdict mismatch between manifest and release-verdict)
      const invalidRunId = "run_invalid_002";
      const invalidSet = buildSampleOfflineArtifactSet(invalidRunId, "sha_invalid", { releaseVerdict: "ACCEPTED", mismatchVerdict: true });

      const failResult = await publishAcceptanceArtifactsAtomically(invalidSet, { artifactsBaseDir: tempBaseDir });
      expect(failResult.success).toBe(false);
      expect(failResult.errors.some((e) => e.includes("Manifest verdict"))).toBe(true);

      // Verify latest pointer was UNTOUCHED and still points to the initial run!
      const currentLatestPointer = JSON.parse(fs.readFileSync(path.join(tempBaseDir, "latest.json"), "utf8"));
      expect(currentLatestPointer.acceptanceRunId).toBe(initialRunId);
    } finally {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it("publishAcceptanceArtifactsAtomically rejects overwrite when target run directory already exists", async () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "swai-atomic-immutable-"));
    try {
      const runId = "run_immutable_001";
      const sha = "sha_immutable";
      const set = buildSampleOfflineArtifactSet(runId, sha, { releaseVerdict: "ACCEPTED" });

      const res1 = await publishAcceptanceArtifactsAtomically(set, { artifactsBaseDir: tempBaseDir });
      expect(res1.success).toBe(true);

      // Second attempt with same runId must be rejected
      const res2 = await publishAcceptanceArtifactsAtomically(set, { artifactsBaseDir: tempBaseDir });
      expect(res2.success).toBe(false);
      expect(res2.errors[0]).toContain("already exists and is immutable");
    } finally {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });
});
