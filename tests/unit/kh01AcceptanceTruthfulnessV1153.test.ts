import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseVitestJsonAssertions,
  resolveExecutedAssertion,
  writeAcceptanceArtifacts,
} from "../../scripts/kh01/runFullAcceptance";
import {
  CANONICAL_ACCEPTANCE_GATES,
  validateKh01AcceptanceManifest,
  deriveReleaseVerdict,
  finalizeAcceptanceVerdict,
  Kh01AcceptanceManifest,
  GateEvidence,
  LiveMetaVerificationResult,
} from "@/lib/kh01/acceptanceGateRegistry";

describe("KH-01 Acceptance Truthfulness & Adversarial Invariants V11.5.3 (PART 15)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh01-truth-v1153-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createSampleReport(reportContent: any): string {
    const reportPath = path.join(tempDir, `test-report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(reportContent), "utf8");
    return reportPath;
  }

  function getBasePassingGates(runId: string = "kh01_acceptance_truth_run"): GateEvidence[] {
    return CANONICAL_ACCEPTANCE_GATES.filter((g) => g.criticality === "MANDATORY").map((g) => ({
      gateId: g.gateId,
      runId,
      testId: `${g.stageId}::${g.gateId}`,
      status: "PASSED",
      evidenceType: g.evidenceType,
      evidenceReference: `Valid observation for ${g.gateId}`,
      observedAt: new Date().toISOString(),
    }));
  }

  function createSampleLiveResult(overrides: Partial<LiveMetaVerificationResult> = {}): LiveMetaVerificationResult {
    return {
      status: "NOT_RUN",
      detailedOutcome: "NOT_RUN",
      levelsVerified: [],
      runId: null,
      source: "https://www.facebook.com/ads/library",
      retrievedCount: 0,
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: ["Live Meta source extraction not requested"],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  // 1. All gates passed with valid evidence
  it("allows CONDITIONALLY_ACCEPTED when all mandatory gates pass and live is NOT_RUN", () => {
    const gates = getBasePassingGates("test_run_01");
    const live = createSampleLiveResult();

    const verdict = deriveReleaseVerdict(gates, live, []);
    expect(verdict).toBe("CONDITIONALLY_ACCEPTED");

    const manifest: Kh01AcceptanceManifest = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_01",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      stages: [{ stageId: "STAGE_01", name: "Stage 1", command: "cmd", status: "PASSED", exitCode: 0, durationMs: 10, startedAt: "", completedAt: "", assertions: [] }],
      liveVerification: live,
      unresolvedDefects: [],
      releaseVerdict: verdict,
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(true);
  });

  // 2. One mandatory gate failed
  it("blocks release when one mandatory gate fails", () => {
    const gates = getBasePassingGates();
    gates[0].status = "FAILED";
    gates[0].error = "Assertion failed";

    const live = createSampleLiveResult();
    const verdict = deriveReleaseVerdict(gates, live, []);
    expect(verdict).toBe("BLOCKED");

    const final = finalizeAcceptanceVerdict(gates, [{ stageId: "STAGE_01", status: "PASSED" }], live, []);
    expect(final).toBe("BLOCKED");
  });

  // 3. One mandatory gate skipped / NOT_RUN
  it("blocks release when one mandatory gate is skipped/NOT_RUN", () => {
    const gates = getBasePassingGates();
    gates[1].status = "NOT_RUN";

    const live = createSampleLiveResult();
    const verdict = deriveReleaseVerdict(gates, live, []);
    expect(verdict).toBe("BLOCKED");
  });

  // 4. Missing mandatory gate
  it("blocks release when a mandatory gate is missing from manifest", () => {
    const gates = getBasePassingGates("test_run_missing_gate").slice(1); // remove gate 0

    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_missing_gate",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      releaseVerdict: "CONDITIONALLY_ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Missing mandatory gate evidence for"))).toBe(true);
  });

  // 5. Duplicate gate ID
  it("rejects manifest with duplicate gate IDs", () => {
    const gates = getBasePassingGates("test_run_dup_gate");
    gates.push({ ...gates[0] }); // duplicate first gate

    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_dup_gate",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      releaseVerdict: "CONDITIONALLY_ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Duplicate gateId"))).toBe(true);
  });

  // 6 & 7. Two tests with overlapping or identical titles in different files
  it("differentiates identical or overlapping test titles across different test files", () => {
    const reportPath = createSampleReport({
      testResults: [
        {
          name: "/workspace/tests/unit/suiteA.test.ts",
          assertionResults: [
            {
              title: "verifies workspace isolation",
              fullName: "Isolation > verifies workspace isolation",
              status: "passed",
              duration: 20,
            },
          ],
        },
        {
          name: "/workspace/tests/unit/suiteB.test.ts",
          assertionResults: [
            {
              title: "verifies workspace isolation",
              fullName: "Isolation > verifies workspace isolation",
              status: "failed",
              duration: 35,
              failureMessages: ["Workspace breach detected"],
            },
          ],
        },
      ],
    });

    const parsed = parseVitestJsonAssertions(reportPath);

    // Exact file + fullName resolution
    const resA = resolveExecutedAssertion(parsed, {
      gateId: "GATE_TEST_A",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/suiteA.test.ts",
      expectedTestName: "Isolation > verifies workspace isolation",
    });
    expect(resA.status).toBe("PASSED");

    const resB = resolveExecutedAssertion(parsed, {
      gateId: "GATE_TEST_B",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/suiteB.test.ts",
      expectedTestName: "Isolation > verifies workspace isolation",
    });
    expect(resB.status).toBe("FAILED");
  });

  // 8 & 10. Missing report and invalid JSON
  it("handles missing Vitest report safely as empty map", () => {
    const nonExistent = path.join(tempDir, "missing-report.json");
    const parsed = parseVitestJsonAssertions(nonExistent);
    expect(parsed.size).toBe(0);
  });

  it("handles corrupted JSON safely without throwing", () => {
    const corruptPath = path.join(tempDir, "corrupted.json");
    fs.writeFileSync(corruptPath, "{ invalid json ...", "utf8");
    const parsed = parseVitestJsonAssertions(corruptPath);
    expect(parsed.size).toBe(0);
  });

  // 11. Process exit code nonzero
  it("blocks release if any stage has nonzero exit code", () => {
    const gates = getBasePassingGates();
    const live = createSampleLiveResult();

    const finalVerdict = finalizeAcceptanceVerdict(
      gates,
      [
        { stageId: "STAGE_01", status: "PASSED" },
        { stageId: "STAGE_02", status: "FAILED" }, // Nonzero exit code
      ],
      live,
      []
    );
    expect(finalVerdict).toBe("BLOCKED");
  });

  // 12. Stage passed but required assertion missing
  it("resolves missing required test assertion as NOT_RUN", () => {
    const reportPath = createSampleReport({
      testResults: [
        {
          name: "/workspace/tests/unit/other.test.ts",
          assertionResults: [{ title: "other test", fullName: "other test", status: "passed", duration: 1 }],
        },
      ],
    });
    const parsed = parseVitestJsonAssertions(reportPath);
    const res = resolveExecutedAssertion(parsed, {
      gateId: "GATE_MISSING",
      type: "TEST_ASSERTION",
      expectedTestFile: "tests/unit/expected.test.ts",
      expectedTestName: "Expected test that was not run",
    });

    expect(res.status).toBe("NOT_RUN");
  });

  // 13. Manifest invalid while stages passed
  it("finalizeAcceptanceVerdict blocks release when manifest validation fails", () => {
    const gates = getBasePassingGates();
    const live = createSampleLiveResult();

    const final = finalizeAcceptanceVerdict(
      gates,
      [{ stageId: "STAGE_01", status: "PASSED" }],
      live,
      [],
      ["Missing required artifact"] // validation error present
    );
    expect(final).toBe("BLOCKED");
  });

  // 16. Live MCP returned ads but 0 persisted
  it("does not award ADS_PERSISTED or RUN_RECONCILED when zero ads persisted in DB", () => {
    const live = createSampleLiveResult({
      status: "FAILED",
      detailedOutcome: "PERSISTENCE_FAILED",
      levelsVerified: ["ADS_COLLECTED"], // MCP worked, but DB failed
      retrievedCount: 5,
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: ["Database insertion returned 0 records"],
    });

    const gates = getBasePassingGates();
    const verdict = deriveReleaseVerdict(gates, live, []);
    expect(verdict).toBe("CONDITIONALLY_ACCEPTED"); // Cannot be full ACCEPTED
    expect(verdict).not.toBe("ACCEPTED");
  });

  // 24 & 25. Full ACCEPTED requires LIVE_RECONCILED with actual levels
  it("rejects full ACCEPTED verdict if live verification is missing required levels", () => {
    const gates = getBasePassingGates();
    const fakeLive = createSampleLiveResult({
      status: "PASSED",
      detailedOutcome: "LIVE_RECONCILED",
      levelsVerified: ["ADS_COLLECTED"], // Missing ADS_PERSISTED and RUN_RECONCILED
      runId: "run_fake_live",
      source: "https://facebook.com/ads/library/?id=fake",
      retrievedCount: 5,
      validCount: 5,
      linkedCount: 5,
      displayedCount: 5,
      evidenceReferences: ["fake"],
    });

    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_fake_live",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      stages: [{ stageId: "STAGE_01", status: "PASSED", exitCode: 0 }],
      liveVerification: fakeLive,
      releaseVerdict: "ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("ADS_PERSISTED"))).toBe(true);
  });

  // 28. Partial artifact write failure blocks release
  it("writeAcceptanceArtifacts returns errors if destination directory cannot be created or file fails", async () => {
    const invalidPath = "\0invalid_path";
    const res = await writeAcceptanceArtifacts(invalidPath, [
      { name: "test.json", data: { hello: "world" } },
    ]);
    expect(res.success).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  // 29. Unresolved P1 defect blocks release
  it("blocks release when unresolved defect is present in manifest", () => {
    const gates = getBasePassingGates();
    const live = createSampleLiveResult();

    const verdict = deriveReleaseVerdict(gates, live, ["BUG-01: Live verification flaw"]);
    expect(verdict).toBe("BLOCKED");

    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_unresolved",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      stages: [{ stageId: "STAGE_01", status: "PASSED", exitCode: 0 }],
      liveVerification: live,
      unresolvedDefects: ["BUG-01: Live verification flaw"],
      releaseVerdict: "CONDITIONALLY_ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("unresolved P0/P1 defects"))).toBe(true);
  });

  // 30. Wrong tested SHA blocks validation
  it("rejects manifest with UNKNOWN or invalid testedCommitSha", () => {
    const gates = getBasePassingGates("test_run_sha");
    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_sha",
      testedCommitSha: "UNKNOWN",
      branch: "feature/v11-meta-collector-remove-muse",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      releaseVerdict: "CONDITIONALLY_ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("testedCommitSha"))).toBe(true);
  });

  // 31. Branch mismatch blocks validation
  it("rejects manifest if executed branch is not feature/v11-meta-collector-remove-muse", () => {
    const gates = getBasePassingGates("test_run_branch");
    const manifest: any = {
      applicationVersion: "11.5.3",
      protocolVersion: "11.4.5",
      acceptanceRunId: "test_run_branch",
      testedCommitSha: "66ebba0cbee2445643be5f380de7005eba761df8",
      branch: "main",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates,
      releaseVerdict: "CONDITIONALLY_ACCEPTED",
    };

    const validation = validateKh01AcceptanceManifest(manifest);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Target branch mismatch"))).toBe(true);
  });

  // 32. Invariant: Database linked 5, API/displayed 4
  it("evaluateRunCountInvariants flags discrepancy when linked > displayed", async () => {
    const { evaluateRunCountInvariants } = await import("@/services/research/runReconciliationService");
    const evalResult = evaluateRunCountInvariants({
      retrieved: 5,
      valid: 5,
      linked: 5,
      displayed: 4, // 1 missing from display!
      newUnique: 5,
      duplicates: 0,
      rejected: 0,
      failed: 0,
      quarantined: 0,
    });
    expect(evalResult.consistent).toBe(false);
    expect(evalResult.violations.some((v) => v.code === "LINKED_DISPLAYED_MISMATCH")).toBe(true);
  });
});
