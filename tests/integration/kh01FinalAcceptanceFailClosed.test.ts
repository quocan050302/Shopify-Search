import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import {
  GET as dbObservationHandler,
  resolveDbObservationSecurityContext,
  verifyDbObservationToken,
} from "../../src/app/api/v1/test/db-observation/route";
import {
  verifyDatabaseIdentityAcrossProcesses,
  observeDatabaseIdentityFromNextServer,
  evaluateDatabaseIsolationVerdict,
  buildCrossBoundaryReconciliationArtifact,
  validateCrossBoundaryEvidenceInputs,
  findDuplicateAdIds,
  ProcessDatabaseObservation,
  ProviderSourceEvidence,
  verifyPublishedAcceptanceEvidence,
} from "../../scripts/kh01/runFullAcceptance";
import {
  finalizeAcceptanceVerdict,
  CANONICAL_ACCEPTANCE_GATES,
  GateEvidence,
  AcceptanceArtifactStatus,
  LiveMetaVerificationResult,
} from "../../src/lib/kh01/acceptanceGateRegistry";

describe("KH-01 V11.5.9 Final Acceptance Fail-Closed & Security Invariants", () => {
  const acceptanceRunId = `kh01_rel_test_${Date.now()}`;
  const commitSha = "ba8657f568971c5cf1773e95be59898ae1a6386c";
  const isolatedDbKey = "sqlite:/tmp/test-isolated-run.db";
  const validToken = "valid_random_test_token_1234567890abcdef";

  function getBasePassingGates(): GateEvidence[] {
    return CANONICAL_ACCEPTANCE_GATES.filter((g) => g.criticality === "MANDATORY").map((g) => ({
      gateId: g.gateId,
      runId: acceptanceRunId,
      testId: `stage::${g.gateId}`,
      status: "PASSED" as const,
      evidenceType: "TEST_ASSERTION" as const,
      evidenceReference: "Valid test reference",
      observedAt: new Date().toISOString(),
    }));
  }

  function getBaseStages() {
    return [
      {
        stageId: "STAGE_01_GIT_STATE",
        name: "Git State",
        command: "git branch",
        status: "PASSED" as const,
        exitCode: 0,
        durationMs: 50,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        assertions: [],
      },
    ];
  }

  function getOfflineLiveResult(): LiveMetaVerificationResult {
    return {
      status: "NOT_RUN",
      detailedOutcome: "NOT_RUN",
      levelsVerified: [],
      runId: null,
      source: "OFFLINE_TEST",
      retrievedCount: 0,
      validCount: 0,
      linkedCount: 0,
      displayedCount: 0,
      evidenceReferences: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  /*
   * ---------------------------------------------------------
   * SECTION 1: Diagnostic Endpoint Authentication & Preconditions (NEG-01 .. NEG-04)
   * ---------------------------------------------------------
   */
  describe("Diagnostic Database Endpoint Security (V1159-01)", () => {
    it("NEG-01: rejects historical hard-coded token with HTTP 401", async () => {
      const savedEnv = { ...process.env };
      try {
        process.env.SWAI_E2E_SERVER = "true";
        process.env.SWAI_TEST_ISOLATION = "strict";
        process.env.SWAI_DB_ROLE = "INTEGRATION_TEST";
        process.env.KH01_ACCEPTANCE_RUN_ID = acceptanceRunId;
        process.env.KH01_DB_OBSERVATION_TOKEN = validToken;
        process.env.TEST_DATABASE_URL = "file:/tmp/isolated-valid-test.db";
        process.env.DATABASE_URL = "file:/tmp/isolated-valid-test.db";

        const req = new NextRequest(
          `http://127.0.0.1:3000/api/v1/test/db-observation?markerId=ws_test&acceptanceRunId=${acceptanceRunId}`,
          {
            headers: {
              authorization: "Bearer swai-acceptance-secret-token", // Old static token
            },
          }
        );

        const res = await dbObservationHandler(req);
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.success).toBe(false);
      } finally {
        process.env = savedEnv;
      }
    });

    it("NEG-02: rejects request when server lacks configured diagnostic token with HTTP 403", async () => {
      const savedEnv = { ...process.env };
      try {
        process.env.SWAI_E2E_SERVER = "true";
        process.env.SWAI_TEST_ISOLATION = "strict";
        process.env.SWAI_DB_ROLE = "INTEGRATION_TEST";
        process.env.KH01_ACCEPTANCE_RUN_ID = acceptanceRunId;
        delete process.env.KH01_DB_OBSERVATION_TOKEN;
        process.env.TEST_DATABASE_URL = "file:/tmp/isolated-valid-test.db";

        const req = new NextRequest(
          `http://127.0.0.1:3000/api/v1/test/db-observation?markerId=ws_test&acceptanceRunId=${acceptanceRunId}`,
          {
            headers: {
              authorization: `Bearer ${validToken}`,
            },
          }
        );

        const res = await dbObservationHandler(req);
        expect(res.status).toBe(403);
      } finally {
        process.env = savedEnv;
      }
    });

    it("NEG-03: rejects endpoint when running against protected active development DB (dev.db) with HTTP 403", async () => {
      const savedEnv = { ...process.env };
      try {
        process.env.SWAI_E2E_SERVER = "true";
        process.env.SWAI_TEST_ISOLATION = "strict";
        process.env.SWAI_DB_ROLE = "INTEGRATION_TEST";
        process.env.KH01_ACCEPTANCE_RUN_ID = acceptanceRunId;
        process.env.KH01_DB_OBSERVATION_TOKEN = validToken;
        process.env.DATABASE_URL = "file:./dev.db";
        delete process.env.TEST_DATABASE_URL;

        const req = new NextRequest(
          `http://127.0.0.1:3000/api/v1/test/db-observation?markerId=ws_test&acceptanceRunId=${acceptanceRunId}`,
          {
            headers: {
              authorization: `Bearer ${validToken}`,
            },
          }
        );

        const res = await dbObservationHandler(req);
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toContain("protected development database");
      } finally {
        process.env = savedEnv;
      }
    });

    it("NEG-04: rejects request with mismatched acceptanceRunId with HTTP 403", async () => {
      const savedEnv = { ...process.env };
      try {
        process.env.SWAI_E2E_SERVER = "true";
        process.env.SWAI_TEST_ISOLATION = "strict";
        process.env.SWAI_DB_ROLE = "INTEGRATION_TEST";
        process.env.KH01_ACCEPTANCE_RUN_ID = acceptanceRunId;
        process.env.KH01_DB_OBSERVATION_TOKEN = validToken;
        process.env.TEST_DATABASE_URL = "file:/tmp/isolated-valid-test.db";
        process.env.DATABASE_URL = "file:/tmp/isolated-valid-test.db";

        const req = new NextRequest(
          `http://127.0.0.1:3000/api/v1/test/db-observation?markerId=ws_test&acceptanceRunId=wrong_run_id_999`,
          {
            headers: {
              authorization: `Bearer ${validToken}`,
            },
          }
        );

        const res = await dbObservationHandler(req);
        expect(res.status).toBe(403);
      } finally {
        process.env = savedEnv;
      }
    });

    it("timing-safe token verification correctly matches identical tokens and rejects different lengths/values", () => {
      expect(verifyDbObservationToken(validToken, validToken)).toBe(true);
      expect(verifyDbObservationToken("wrong_token_1234567890abcdef", validToken)).toBe(false);
      expect(verifyDbObservationToken(null, validToken)).toBe(false);
      expect(verifyDbObservationToken(validToken, undefined)).toBe(false);
      expect(verifyDbObservationToken("short", validToken)).toBe(false);
    });
  });

  /*
   * ---------------------------------------------------------
   * SECTION 2: Active Database Protection Fail-Closed (NEG-05)
   * ---------------------------------------------------------
   */
  describe("Database Isolation Evaluation Invariants (V1159-02)", () => {
    it("NEG-05: evaluateDatabaseIsolationVerdict marks NOT_VERIFIED protection as NOT eligible for acceptance", () => {
      const verdict = evaluateDatabaseIsolationVerdict({
        canonicalPathsDifferent: true,
        prismaConnectionVerified: true,
        markerWriteVerified: true,
        markerReadVerified: true,
        activeDatabaseStatus: "NOT_VERIFIED",
        activeDatabaseProtected: null,
        errors: [],
      });

      expect(verdict.status).toBe("NOT_VERIFIED");
      expect(verdict.eligibleForAcceptance).toBe(false);

      // Verify that this blocks release in finalizeAcceptanceVerdict
      const artifactStatuses: AcceptanceArtifactStatus[] = [
        {
          artifactId: "database-isolation",
          required: true,
          status: verdict.status as any,
          evidencePath: "artifacts/v11.5.9/run/database-isolation.json",
          evidenceOrigin: "ACTUAL_DATABASE_QUERY",
          error: "Active database protection unverified",
        },
      ];

      const releaseVerdict = finalizeAcceptanceVerdict(
        getBasePassingGates(),
        getBaseStages(),
        getOfflineLiveResult(),
        ["Database isolation protection NOT_VERIFIED"],
        [],
        artifactStatuses,
        "OFFLINE"
      );

      expect(releaseVerdict).toBe("BLOCKED");
    });
  });

  /*
   * ---------------------------------------------------------
   * SECTION 3: Cross-Process Database Release Gate (NEG-06, NEG-07, NEG-09, NEG-10)
   * ---------------------------------------------------------
   */
  describe("Cross-Process Database Identity Release Blockers (V1159-03, V1159-05)", () => {
    it("NEG-06: missing Worker observation fails cross-process verification and strictly blocks release", () => {
      const runnerObs: ProcessDatabaseObservation = {
        processName: "ACCEPTANCE_RUNNER",
        processId: 1001,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "PRISMA_QUERY",
        evidenceReference: "Runner",
      };

      const nextObs: ProcessDatabaseObservation = {
        processName: "NEXTJS_SERVER",
        processId: 1002,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "HTTP_DATABASE_READBACK",
        evidenceReference: "Next.js",
      };

      // Worker is omitted!
      const evidence = verifyDatabaseIdentityAcrossProcesses(
        {
          acceptanceRunId,
          expectedDatabaseKey: isolatedDbKey,
          markerId: "ws_marker",
          requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
        },
        [runnerObs, nextObs]
      );

      expect(evidence.verified).toBe(false);
      expect(evidence.status).toBe("FAILED");
      expect(evidence.missingProcesses).toContain("WORKER");

      // Verify release decision strictly blocks
      const artifactStatuses: AcceptanceArtifactStatus[] = [
        {
          artifactId: "database-process-identity",
          required: true,
          status: evidence.verified ? "PASSED" : "FAILED",
          evidencePath: "artifacts/v11.5.9/run/database-process-identity.json",
          evidenceOrigin: "ACTUAL_MULTI_PROCESS_QUERY",
          error: "Worker observation missing",
        },
      ];

      const releaseVerdict = finalizeAcceptanceVerdict(
        getBasePassingGates(),
        getBaseStages(),
        getOfflineLiveResult(),
        ["Missing required Worker database observation"],
        [],
        artifactStatuses,
        "OFFLINE"
      );

      expect(releaseVerdict).toBe("BLOCKED");
    });

    it("NEG-07: missing Next.js observation fails cross-process verification and strictly blocks release", () => {
      const runnerObs: ProcessDatabaseObservation = {
        processName: "ACCEPTANCE_RUNNER",
        processId: 1001,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "PRISMA_QUERY",
        evidenceReference: "Runner",
      };

      const workerObs: ProcessDatabaseObservation = {
        processName: "WORKER",
        processId: 1003,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "WORKER_PROCESS_EVENT",
        evidenceReference: "Worker",
      };

      // Next.js is omitted!
      const evidence = verifyDatabaseIdentityAcrossProcesses(
        {
          acceptanceRunId,
          expectedDatabaseKey: isolatedDbKey,
          markerId: "ws_marker",
          requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
        },
        [runnerObs, workerObs]
      );

      expect(evidence.verified).toBe(false);
      expect(evidence.missingProcesses).toContain("NEXTJS_SERVER");

      const artifactStatuses: AcceptanceArtifactStatus[] = [
        {
          artifactId: "database-process-identity",
          required: true,
          status: evidence.verified ? "PASSED" : "FAILED",
          evidencePath: "artifacts/v11.5.9/run/database-process-identity.json",
          evidenceOrigin: "ACTUAL_MULTI_PROCESS_QUERY",
        },
      ];

      const releaseVerdict = finalizeAcceptanceVerdict(
        getBasePassingGates(),
        getBaseStages(),
        getOfflineLiveResult(),
        ["Missing Next.js server observation"],
        [],
        artifactStatuses,
        "OFFLINE"
      );

      expect(releaseVerdict).toBe("BLOCKED");
    });

    it("NEG-08: SHARED_DISCOVERY_RUN scope requires each process to observe the actual run ID", () => {
      const runnerObs: ProcessDatabaseObservation = {
        processName: "ACCEPTANCE_RUNNER",
        processId: 1001,
        acceptanceRunId,
        discoveryRunId: "run_actual_001",
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: "run_actual_001",
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "PRISMA_QUERY",
        evidenceReference: "Runner",
      };

      // Worker omitted discoveryRunId!
      const workerObs: ProcessDatabaseObservation = {
        processName: "WORKER",
        processId: 1003,
        acceptanceRunId,
        discoveryRunId: null, // missing!
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "WORKER_PROCESS_EVENT",
        evidenceReference: "Worker",
      };

      const nextObs: ProcessDatabaseObservation = {
        processName: "NEXTJS_SERVER",
        processId: 1002,
        acceptanceRunId,
        discoveryRunId: "run_actual_001",
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: "run_actual_001",
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "HTTP_DATABASE_READBACK",
        evidenceReference: "Next.js",
      };

      const evidence = verifyDatabaseIdentityAcrossProcesses(
        {
          acceptanceRunId,
          expectedDatabaseKey: isolatedDbKey,
          markerId: "ws_marker",
          verificationScope: "SHARED_DISCOVERY_RUN",
          discoveryRunId: "run_actual_001",
          requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
        },
        [runnerObs, workerObs, nextObs]
      );

      expect(evidence.sharedRunVerified).toBe(false);
      expect(evidence.verified).toBe(false);
      expect(evidence.errors.some((e: string) => e.includes("WORKER omitted observed discoveryRunId"))).toBe(true);
    });

    it("NEG-09 & NEG-10: detects mismatched database key reported by Worker or Next.js", () => {
      const runnerObs: ProcessDatabaseObservation = {
        processName: "ACCEPTANCE_RUNNER",
        processId: 1001,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: isolatedDbKey,
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "PRISMA_QUERY",
        evidenceReference: "Runner",
      };

      const workerObs: ProcessDatabaseObservation = {
        processName: "WORKER",
        processId: 1003,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: "sqlite:/different/other.db", // NEG-09
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "WORKER_PROCESS_EVENT",
        evidenceReference: "Worker",
      };

      const nextObs: ProcessDatabaseObservation = {
        processName: "NEXTJS_SERVER",
        processId: 1002,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: isolatedDbKey,
        observedDatabaseKey: null, // NEG-10: Next omitted observedDatabaseKey
        markerId: "ws_marker",
        markerObserved: true,
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "HTTP_DATABASE_READBACK",
        evidenceReference: "Next.js",
      };

      const evidence = verifyDatabaseIdentityAcrossProcesses(
        {
          acceptanceRunId,
          expectedDatabaseKey: isolatedDbKey,
          markerId: "ws_marker",
          requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
        },
        [runnerObs, workerObs, nextObs]
      );

      expect(evidence.verified).toBe(false);
      expect(evidence.mismatchedProcesses).toContain("WORKER");
      expect(evidence.mismatchedProcesses).toContain("NEXTJS_SERVER");
    });
  });

  /*
   * ---------------------------------------------------------
   * SECTION 4: Cross-Boundary Reconciliation Invariants (NEG-11 .. NEG-18)
   * ---------------------------------------------------------
   */
  describe("Cross-Boundary Reconciliation Invariants (V1159-06)", () => {
    const discoveryRunId = "run_recon_001";
    const realProviderEvidence: ProviderSourceEvidence = {
      acceptanceRunId,
      discoveryRunId,
      workerPid: 54321,
      requestedMode: "REAL_LIVE_META",
      providerId: "meta-ads-collector",
      actualTransport: "stdio",
      observedSourceType: "REAL_UPSTREAM",
      fixtureDetected: false,
      upstreamRequestExecuted: true,
      upstreamResponseObserved: true,
      upstreamResultSetId: "rs_test_123",
      upstreamAdIds: ["ad_1", "ad_2", "ad_3"],
      validAdsCollected: 3,
      observedAt: new Date().toISOString(),
      evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION",
      errors: [],
    };

    it("NEG-14: detects duplicate ad IDs in HTTP boundary and marks reconciliation FAILED", () => {
      const duplicates = findDuplicateAdIds(["ad_1", "ad_2", "ad_2", "ad_3"]);
      expect(duplicates).toEqual(["ad_2"]);

      const artifact = buildCrossBoundaryReconciliationArtifact({
        acceptanceRunId,
        testedCommitSha: commitSha,
        discoveryRunId,
        databaseEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2", "ad_3"],
          linkedAdIds: ["ad_1", "ad_2", "ad_3"],
        },
        httpEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2", "ad_2", "ad_3"], // Duplicate!
        },
        browserEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2", "ad_3"],
        },
        providerEvidence: realProviderEvidence,
      });

      expect(artifact.status).toBe("FAILED");
      expect(artifact.consistent).toBe(false);
      expect(artifact.duplicateIds).toContain("ad_2");
      expect(artifact.errors.some((e: string) => e.includes("HTTP duplicate IDs detected"))).toBe(true);
    });

    it("NEG-15 & NEG-16: detects duplicate ad IDs in Database or Browser boundary", () => {
      const artifact = buildCrossBoundaryReconciliationArtifact({
        acceptanceRunId,
        testedCommitSha: commitSha,
        discoveryRunId,
        databaseEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_1", "ad_2"], // DB duplicate
          linkedAdIds: ["ad_1", "ad_1", "ad_2"],
        },
        httpEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
        },
        browserEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2", "ad_2"], // Browser duplicate
        },
        providerEvidence: realProviderEvidence,
      });

      expect(artifact.status).toBe("FAILED");
      expect(artifact.consistent).toBe(false);
      expect(artifact.duplicateIds).toContain("ad_1");
      expect(artifact.duplicateIds).toContain("ad_2");
    });

    it("NEG-17: rejects same counts with different IDs across boundaries", () => {
      const artifact = buildCrossBoundaryReconciliationArtifact({
        acceptanceRunId,
        testedCommitSha: commitSha,
        discoveryRunId,
        databaseEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
          linkedAdIds: ["ad_1", "ad_2"],
        },
        httpEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_DIFFERENT"],
        },
        browserEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
        },
        providerEvidence: realProviderEvidence,
      });

      expect(artifact.status).toBe("FAILED");
      expect(artifact.consistent).toBe(false);
      expect(artifact.missingInHttp).toContain("ad_2");
      expect(artifact.unexpectedInHttp).toContain("ad_DIFFERENT");
    });

    it("NEG-18: rejects mismatched provider discoveryRunId", () => {
      const artifact = buildCrossBoundaryReconciliationArtifact({
        acceptanceRunId,
        testedCommitSha: commitSha,
        discoveryRunId,
        databaseEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
          linkedAdIds: ["ad_1", "ad_2"],
        },
        httpEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
        },
        browserEvidence: {
          runId: discoveryRunId,
          status: "PASSED",
          adIds: ["ad_1", "ad_2"],
        },
        providerEvidence: {
          ...realProviderEvidence,
          discoveryRunId: "wrong_provider_run_id",
        },
      });

      expect(artifact.status).toBe("FAILED");
      expect(artifact.consistent).toBe(false);
      expect(artifact.errors.some((e: string) => e.includes("providerEvidence.discoveryRunId"))).toBe(true);
    });
  });

  /*
   * ---------------------------------------------------------
   * SECTION 5: Valid Isolated Offline Acceptance (NEG-24)
   * ---------------------------------------------------------
   */
  describe("Valid Offline Workflow Invariant (NEG-24)", () => {
    it("NEG-24: yields CONDITIONALLY_ACCEPTED when all offline checks pass and live is NOT_RUN", () => {
      const gates = getBasePassingGates();
      const stages = getBaseStages();
      const live = getOfflineLiveResult();

      const artifactStatuses: AcceptanceArtifactStatus[] = [
        {
          artifactId: "exact-run-reconciliation",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/exact-run-reconciliation.json",
          evidenceOrigin: "ACTUAL_DATABASE_QUERY",
        },
        {
          artifactId: "browser-results",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/browser-results.json",
          evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION",
        },
        {
          artifactId: "database-isolation",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/database-isolation.json",
          evidenceOrigin: "ACTUAL_DATABASE_QUERY",
        },
        {
          artifactId: "database-process-identity",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/database-process-identity.json",
          evidenceOrigin: "ACTUAL_MULTI_PROCESS_QUERY",
        },
        {
          artifactId: "suite-coverage",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/suite-coverage.json",
          evidenceOrigin: "ACTUAL_TEST_EXECUTION",
        },
        {
          artifactId: "screenshot-manifest",
          required: true,
          status: "PASSED",
          evidencePath: "artifacts/v11.5.9/run/screenshot-manifest.json",
          evidenceOrigin: "ACTUAL_BROWSER_OBSERVATION",
        },
      ];

      const verdict = finalizeAcceptanceVerdict(
        gates,
        stages,
        live,
        [],
        [],
        artifactStatuses,
        "OFFLINE"
      );

      expect(verdict).toBe("CONDITIONALLY_ACCEPTED");
    });
  });
});
