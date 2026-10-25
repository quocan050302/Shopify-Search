import { describe, it, expect } from "vitest";
import {
  buildCrossBoundaryReconciliationArtifact,
  validateRequiredArtifactInventory,
  ProviderSourceEvidence,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Full-Live Artifacts & Cross-Boundary Reconciliation (FINAL-08-03)", () => {
  const dummyRunId = "kh01_rel_full_live_test";
  const dummySha = "cd32c5a1feac9313ce90177c9013f525d2eb41ed";
  const dummyDiscoveryRunId = "run_discovery_live_001";

  const realProviderEvidence: ProviderSourceEvidence = {
    acceptanceRunId: dummyRunId,
    discoveryRunId: dummyDiscoveryRunId,
    workerPid: 12345,
    requestedMode: "REAL_LIVE_META",
    providerId: "meta-ads-collector",
    actualTransport: "stdio",
    observedSourceType: "REAL_UPSTREAM",
    fixtureDetected: false,
    upstreamRequestExecuted: true,
    upstreamResponseObserved: true,
    upstreamResultSetId: "rs_live_upstream_123",
    upstreamAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
    validAdsCollected: 3,
    observedAt: new Date().toISOString(),
    evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION",
    errors: [],
  };

  const fixtureProviderEvidence: ProviderSourceEvidence = {
    ...realProviderEvidence,
    actualTransport: "mock_test_boundary",
    observedSourceType: "TEST_FIXTURE",
    fixtureDetected: true,
  };

  it("buildCrossBoundaryReconciliationArtifact returns PASSED when DB, HTTP, and Browser ad IDs match with REAL_UPSTREAM provenance", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        retrievedCount: 3,
        validCount: 3,
        linkedCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        httpStatus: 200,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        missingIds: [],
        unexpectedIds: [],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        cardCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        missingIds: [],
        unexpectedIds: [],
      } as any,
      providerEvidence: realProviderEvidence,
    });

    expect(artifact.status).toBe("PASSED");
    expect(artifact.consistent).toBe(true);
    expect(artifact.missingInHttp.length).toBe(0);
    expect(artifact.missingInBrowser.length).toBe(0);
    expect(artifact.unexpectedInHttp.length).toBe(0);
    expect(artifact.unexpectedInBrowser.length).toBe(0);
    expect(artifact.evidenceOrigin).toBe("ACTUAL_CROSS_BOUNDARY_COMPARISON");
  });

  it("rejects reconciliation with status FAILED when fixture provenance is supplied in full-live scope", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        retrievedCount: 3,
        validCount: 3,
        linkedCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        httpStatus: 200,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        missingIds: [],
        unexpectedIds: [],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        cardCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        missingIds: [],
        unexpectedIds: [],
      } as any,
      providerEvidence: fixtureProviderEvidence,
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.consistent).toBe(false);
    expect(artifact.errors.some((e) => e.includes("Source provenance is not REAL_UPSTREAM"))).toBe(true);
  });

  it("fails reconciliation when duplicate ad IDs exist in HTTP boundary (V1159-06)", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_002", "ad_live_003"],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      providerEvidence: realProviderEvidence,
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.consistent).toBe(false);
    expect(artifact.duplicateIds).toContain("ad_live_002");
    expect(artifact.errors.some((e) => e.includes("HTTP duplicate IDs detected"))).toBe(true);
  });

  it("fails reconciliation when a boundary status is not PASSED (V1159-06)", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "FAILED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      providerEvidence: realProviderEvidence,
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.consistent).toBe(false);
    expect(artifact.errors.some((e) => e.includes("databaseEvidence status is not PASSED"))).toBe(true);
  });

  it("fails reconciliation when run IDs mismatch across boundaries (V1159-06)", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: "different_run_id",
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      providerEvidence: realProviderEvidence,
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.consistent).toBe(false);
    expect(artifact.errors.some((e) => e.includes("httpEvidence.runId"))).toBe(true);
  });

  it("fails reconciliation when HTTP readback is missing ad IDs present in database", () => {
    const artifact = buildCrossBoundaryReconciliationArtifact({
      acceptanceRunId: dummyRunId,
      testedCommitSha: dummySha,
      discoveryRunId: dummyDiscoveryRunId,
      databaseEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        retrievedCount: 3,
        validCount: 3,
        linkedCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        linkedAdIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
      } as any,
      httpEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        httpStatus: 200,
        adIds: ["ad_live_001", "ad_live_002"],
        missingIds: ["ad_live_003"],
        unexpectedIds: [],
      } as any,
      browserEvidence: {
        runId: dummyDiscoveryRunId,
        status: "PASSED",
        cardCount: 3,
        adIds: ["ad_live_001", "ad_live_002", "ad_live_003"],
        missingIds: [],
        unexpectedIds: [],
      } as any,
      providerEvidence: realProviderEvidence,
    });

    expect(artifact.status).toBe("FAILED");
    expect(artifact.consistent).toBe(false);
    expect(artifact.missingInHttp).toEqual(["ad_live_003"]);
  });

  it("validateRequiredArtifactInventory strictly requires cross-boundary-reconciliation.json in FULL_LIVE scope", () => {
    const offlineArtifacts = [
      { name: "acceptance-manifest.json", data: { acceptanceRunId: dummyRunId, testedCommitSha: dummySha, releaseVerdict: "ACCEPTED" } },
      { name: "gate-results.json", data: [] },
      { name: "stage-results.json", data: [] },
      { name: "security-results.json", data: {} },
      { name: "database-isolation.json", data: { status: "PASSED" } },
      { name: "database-process-identity.json", data: { verified: true } },
      { name: "exact-run-reconciliation.json", data: { status: "PASSED" } },
      { name: "offline-reconciliation.json", data: { status: "PASSED" } },
      { name: "browser-results.json", data: { status: "PASSED" } },
      { name: "browser-e2e-results.json", data: { status: "PASSED" } },
      { name: "browser-viewport-results.json", data: [] },
      { name: "worker-process-evidence.json", data: {} },
      { name: "defect-register.json", data: [] },
      { name: "artifact-validation.json", data: { isValid: true } },
      { name: "validation-results.json", data: { isValid: true } },
      { name: "release-verdict.json", data: { verdict: "ACCEPTED" } },
      { name: "execution-metadata.json", data: {} },
      { name: "suite-coverage.json", data: { passed: true } },
      { name: "screenshot-manifest.json", data: { totalScreenshots: 6 } },
      { name: "live-source-results.json", data: { status: "PASSED", detailedOutcome: "LIVE_RECONCILED" } },
      { name: "live-source-verification.json", data: { status: "PASSED", detailedOutcome: "LIVE_RECONCILED" } },
    ];

    const result = validateRequiredArtifactInventory(offlineArtifacts, "FULL_LIVE");
    expect(result.valid).toBe(false);
    expect(result.missingArtifacts).toContain("cross-boundary-reconciliation.json");
    expect(result.missingArtifacts).toContain("provider-source-provenance.json");
  });
});
