import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  verifyDatabaseIdentityAcrossProcesses,
  observeDatabaseIdentityFromPrisma,
  observeDatabaseIdentityFromWorker,
  observeDatabaseIdentityFromNextServer,
  ProcessDatabaseObservation,
} from "../../scripts/kh01/runFullAcceptance";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { canonicalizeSqliteDatabasePath } from "../../src/lib/database/databaseConfig";

describe("KH-01 Cross-Process Database Identity (FINAL-08-01)", () => {
  let testDb: TestDatabaseHandle;
  const acceptanceRunId = `run_acc_${Date.now()}`;
  const markerId = "ws_cross_proc_marker";

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "cross-proc-id" });
    await testDb.prisma.workspace.create({
      data: {
        id: markerId,
        name: "Cross Process Acceptance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });
  });

  afterEach(async () => {
    if (testDb) {
      await testDb.teardown();
    }
  });

  it("observeDatabaseIdentityFromPrisma verifies actual database record and configuration", async () => {
    const loc = canonicalizeSqliteDatabasePath(testDb.url);
    const obs = await observeDatabaseIdentityFromPrisma(testDb.prisma, {
      acceptanceRunId,
      expectedDatabaseKey: loc.canonicalKey,
      markerId,
      processName: "PRISMA_VERIFIER",
    });

    expect(obs.processName).toBe("PRISMA_VERIFIER");
    expect(obs.markerObserved).toBe(true);
    expect(obs.markerId).toBe(markerId);
    expect(obs.observationMethod).toBe("PRISMA_QUERY");
    expect(obs.error).toBeUndefined();
  });

  it("verifyDatabaseIdentityAcrossProcesses fails closed when only parent Prisma observations are supplied", () => {
    const loc = canonicalizeSqliteDatabasePath(testDb.url);
    const parentObs: ProcessDatabaseObservation = {
      processName: "ACCEPTANCE_RUNNER",
      processId: process.pid,
      acceptanceRunId,
      discoveryRunId: null,
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: null,
      observedAdIds: [],
      observedAt: new Date().toISOString(),
      observationMethod: "PRISMA_QUERY",
      evidenceReference: "Parent runner observation",
    };

    const verifierObs: ProcessDatabaseObservation = {
      processName: "PRISMA_VERIFIER",
      processId: process.pid,
      acceptanceRunId,
      discoveryRunId: null,
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: null,
      observedAdIds: [],
      observedAt: new Date().toISOString(),
      observationMethod: "PRISMA_QUERY",
      evidenceReference: "Prisma verifier observation",
    };

    const res = verifyDatabaseIdentityAcrossProcesses(
      {
        acceptanceRunId,
        expectedDatabaseKey: loc.canonicalKey,
        markerId,
        requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
      },
      [parentObs, verifierObs]
    );

    expect(res.verified).toBe(false);
    expect(res.status).toBe("FAILED");
    expect(res.missingProcesses).toContain("WORKER");
    expect(res.missingProcesses).toContain("NEXTJS_SERVER");
  });

  it("verifyDatabaseIdentityAcrossProcesses detects worker pointing to mismatched database", () => {
    const loc = canonicalizeSqliteDatabasePath(testDb.url);
    const runnerObs: ProcessDatabaseObservation = {
      processName: "ACCEPTANCE_RUNNER",
      processId: process.pid,
      acceptanceRunId,
      discoveryRunId: null,
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: null,
      observedAdIds: [],
      observedAt: new Date().toISOString(),
      observationMethod: "PRISMA_QUERY",
      evidenceReference: "Parent runner",
    };

    const workerObs: ProcessDatabaseObservation = {
      processName: "WORKER",
      processId: 99999,
      acceptanceRunId,
      discoveryRunId: null,
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: "sqlite:/different/path/other.db",
      markerId,
      markerObserved: true,
      observedRunId: null,
      observedAdIds: [],
      observedAt: new Date().toISOString(),
      observationMethod: "WORKER_PROCESS_EVENT",
      evidenceReference: "Worker event",
    };

    const nextObs: ProcessDatabaseObservation = {
      processName: "NEXTJS_SERVER",
      processId: 88888,
      acceptanceRunId,
      discoveryRunId: null,
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: null,
      observedAdIds: [],
      observedAt: new Date().toISOString(),
      observationMethod: "HTTP_DATABASE_READBACK",
      evidenceReference: "Next HTTP diagnostic",
    };

    const res = verifyDatabaseIdentityAcrossProcesses(
      {
        acceptanceRunId,
        expectedDatabaseKey: loc.canonicalKey,
        markerId,
        requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
      },
      [runnerObs, workerObs, nextObs]
    );

    expect(res.verified).toBe(false);
    expect(res.mismatchedProcesses).toContain("WORKER");
  });

  it("verifyDatabaseIdentityAcrossProcesses succeeds when Parent, Worker, and Next.js all observe same key and marker", () => {
    const loc = canonicalizeSqliteDatabasePath(testDb.url);
    const runnerObs: ProcessDatabaseObservation = {
      processName: "ACCEPTANCE_RUNNER",
      processId: process.pid,
      acceptanceRunId,
      discoveryRunId: "run_shared_001",
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: "run_shared_001",
      observedAdIds: ["ad_1", "ad_2"],
      observedAt: new Date().toISOString(),
      observationMethod: "PRISMA_QUERY",
      evidenceReference: "Parent runner",
    };

    const workerObs: ProcessDatabaseObservation = {
      processName: "WORKER",
      processId: 99999,
      acceptanceRunId,
      discoveryRunId: "run_shared_001",
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: "run_shared_001",
      observedAdIds: ["ad_1", "ad_2"],
      observedAt: new Date().toISOString(),
      observationMethod: "WORKER_PROCESS_EVENT",
      evidenceReference: "Worker event",
    };

    const nextObs: ProcessDatabaseObservation = {
      processName: "NEXTJS_SERVER",
      processId: 88888,
      acceptanceRunId,
      discoveryRunId: "run_shared_001",
      expectedDatabaseKey: loc.canonicalKey,
      observedDatabaseKey: loc.canonicalKey,
      markerId,
      markerObserved: true,
      observedRunId: "run_shared_001",
      observedAdIds: ["ad_1", "ad_2"],
      observedAt: new Date().toISOString(),
      observationMethod: "HTTP_DATABASE_READBACK",
      evidenceReference: "Next HTTP diagnostic",
    };

    const res = verifyDatabaseIdentityAcrossProcesses(
      {
        acceptanceRunId,
        expectedDatabaseKey: loc.canonicalKey,
        markerId,
        discoveryRunId: "run_shared_001",
        requiredProcesses: ["ACCEPTANCE_RUNNER", "WORKER", "NEXTJS_SERVER"],
      },
      [runnerObs, workerObs, nextObs]
    );

    expect(res.verified).toBe(true);
    expect(res.status).toBe("PASSED");
    expect(res.sharedRunVerified).toBe(true);
    expect(res.sharedMarkerVerified).toBe(true);
  });
});
