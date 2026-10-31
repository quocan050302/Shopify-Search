import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "path";
import path from "path";
import tmpOs from "os";
import net from "net";
import { EventEmitter } from "events";
import { SWAI_KH02_RELEASE_VERSION } from "@/services/kh02/version/runtimeVersionService";
import {
  verifySqliteReadOnlySnapshotIntegrity,
  probeRealReadOnlyOverviewApi,
  assessReadOnlyMutation,
  executeAndVerifyFreshProductionBuild,
  startIsolatedAcceptanceServer,
} from "../../../scripts/kh02/chromiumAcceptanceService";
import {
  buildSuiteExecutionProof,
  buildIntegrationSuiteReport,
  buildTestExecutionTruthTable,
  renderAuthenticJUnitXml,
  queryAndEvaluateG15CandidateDemand,
  writeCanonicalValidBaselineFixture,
} from "../../../scripts/kh02/runFivePhaseAutoClosure";
import {
  isSyntheticCreativeId,
  isSyntheticProviderRequestId,
  isExplicitlyLiveGoogleCreative,
  evaluateGoogleMcpGates,
  runGoogleGateNegativeTests,
} from "../../../scripts/kh02/googleMcpGateEvaluator";
import {
  validateAcceptanceArtifacts,
  runNegativeControlSuite,
} from "../../../scripts/kh02/acceptanceValidatorV12_4_3_4_5";

function createMockDb(options?: { mutateOnSecondCall?: boolean }) {
  let calls = 0;
  return {
    syncJob: {
      findMany: async () => {
        calls++;
        return [
          {
            id: "job_1",
            workspaceId: "ws_1",
            jobType: "KH02_RESEARCH",
            status:
              options?.mutateOnSecondCall && calls > 1
                ? "MUTATED_IN_PLACE"
                : "COMPLETED",
            progress: 100,
            totalItems: 3,
            errorMessage: null,
            resultJson: "{}",
            startedAt: new Date("2026-10-31T00:00:00.000Z"),
            completedAt: new Date("2026-10-31T00:01:00.000Z"),
            createdAt: new Date("2026-10-31T00:00:00.000Z"),
          },
        ];
      },
    },
    researchProduct: { findMany: async () => [] },
    competitorStore: { findMany: async () => [] },
    adProductLink: { findMany: async () => [] },
    evergreenProductScore: { findMany: async () => [] },
  };
}

describe("KH-02 V12.4.3.4.7 — Real Execution Proof, Disk-Safe Closure & Acceptance Truth", () => {
  it("reports runtime version 12.4.3.4.7, 12.4.3.4.8, or 12.4.3.4.9", () => {
    expect(["12.4.3.4.7", "12.4.3.4.8", "12.4.3.4.9"]).toContain(SWAI_KH02_RELEASE_VERSION);
  });

  describe("Phase 1: Real HTTP Read-Only Verification vs DB-Only Snapshot", () => {
    it("verifySqliteReadOnlySnapshotIntegrity returns DB_ONLY_READ_SNAPSHOT and never claims httpRequestVerified or readOnlyPassed", async () => {
      const mockDb = createMockDb();
      const res = await verifySqliteReadOnlySnapshotIntegrity(mockDb);

      expect(res.verificationScope).toBe("DB_ONLY_READ_SNAPSHOT");
      expect(res.status).toBe("HTTP_NOT_EXECUTED");
      expect(res.httpRequestVerified).toBe(false);
      expect(res.readOnlyPassed).toBe(false);
      expect(res.actualHttpRequestCount).toBe(0);
      expect(res.contentDigestsMatch).toBe(true);
      expect(res.rowCountsMatch).toBe(true);
      expect(res.mutationsDetected).toBe(false);
    });

    it("assessReadOnlyMutation rejects synthetic Prisma/in-memory callback returning { status: 200, body: { ok: true } }", async () => {
      const mockDb = createMockDb();
      const res = await assessReadOnlyMutation(async () => {
        return {
          status: 200,
          body: { ok: true, candidatesCount: 1 },
        };
      }, mockDb);

      expect(res.verificationScope).toBe("SYNTHETIC_CALLBACK_REJECTED");
      expect(res.httpRequestVerified).toBe(false);
      expect(res.readOnlyPassed).toBe(false);
      expect(res.actualHttpRequestCount).toBe(0);
      expect(res.status).toBe("FAIL");
    });

    it("probeRealReadOnlyOverviewApi + assessReadOnlyMutation rejects HTTP 500, invalid JSON, wrong runId, wrong candidateId, and in-place DB row mutation", async () => {
      const mockDb = createMockDb();

      // 1. HTTP 500
      const probe500 = await probeRealReadOnlyOverviewApi({
        baseUrl: "http://127.0.0.1:3001",
        runId: "run_1",
        candidateId: "c1",
        fetchImpl: (async () =>
          ({
            status: 500,
            ok: false,
            text: async () => JSON.stringify({ error: "Internal Server Error" }),
          }) as any) as any,
      });
      expect(probe500.transportVerified).toBe(false);
      const ro500 = await assessReadOnlyMutation(async () => probe500, mockDb);
      expect(ro500.readOnlyPassed).toBe(false);
      expect(ro500.httpRequestVerified).toBe(false);

      // 2. HTTP 200 with invalid JSON
      const probeBadJson = await probeRealReadOnlyOverviewApi({
        baseUrl: "http://127.0.0.1:3001",
        runId: "run_1",
        candidateId: "c1",
        fetchImpl: (async () =>
          ({
            status: 200,
            ok: true,
            text: async () => "<html>Not JSON</html>",
          }) as any) as any,
      });
      expect(probeBadJson.transportVerified).toBe(false);
      expect(probeBadJson.validJson).toBe(false);

      // 3. HTTP 200 with wrong runId
      const probeWrongRun = await probeRealReadOnlyOverviewApi({
        baseUrl: "http://127.0.0.1:3001",
        runId: "run_expected",
        candidateId: "c1",
        fetchImpl: (async () =>
          ({
            status: 200,
            ok: true,
            text: async () =>
              JSON.stringify({
                data: {
                  kh02ResearchContext: {
                    researchRunId: "run_other",
                    candidateId: "c1",
                  },
                },
              }),
          }) as any) as any,
      });
      expect(probeWrongRun.identityMatched).toBe(false);
      expect(probeWrongRun.transportVerified).toBe(false);

      // 4. HTTP 200 with wrong candidateId
      const probeWrongCand = await probeRealReadOnlyOverviewApi({
        baseUrl: "http://127.0.0.1:3001",
        runId: "run_1",
        candidateId: "c1",
        fetchImpl: (async () =>
          ({
            status: 200,
            ok: true,
            text: async () =>
              JSON.stringify({
                data: {
                  kh02ResearchContext: {
                    researchRunId: "run_1",
                    candidateId: "c_different",
                  },
                },
              }),
          }) as any) as any,
      });
      expect(probeWrongCand.identityMatched).toBe(false);
      expect(probeWrongCand.transportVerified).toBe(false);

      // 5. Valid HTTP 200 probe
      const validFetch = (async () =>
        ({
          status: 200,
          ok: true,
          text: async () =>
            JSON.stringify({
              data: {
                kh02ResearchContext: {
                  researchRunId: "run_1",
                  candidateId: "c1",
                  researchProductId: "p1",
                  canonicalProductName: "Smart Pet Fountain",
                  storeDomain: "uahpet.com",
                  identityStatus: "VERIFIED",
                },
              },
            }),
        }) as any) as any;

      const validProbe = await probeRealReadOnlyOverviewApi({
        baseUrl: "http://127.0.0.1:3001",
        runId: "run_1",
        candidateId: "c1",
        productId: "p1",
        fetchImpl: validFetch,
      });
      expect(validProbe.transportVerified).toBe(true);
      expect(validProbe.responseBodyDigest).toHaveLength(64);

      // 5a. Valid HTTP 200 probe + in-place DB row mutation -> FAIL
      const mutatingDb = createMockDb({ mutateOnSecondCall: true });
      const roMutated = await assessReadOnlyMutation(
        async () => validProbe,
        mutatingDb
      );
      expect(roMutated.httpRequestVerified).toBe(true);
      expect(roMutated.rowCountsMatch).toBe(true);
      expect(roMutated.contentDigestsMatch).toBe(false);
      expect(roMutated.readOnlyPassed).toBe(false);

      // 5b. Valid HTTP 200 probe + stable DB -> PASS
      const stableDb = createMockDb({ mutateOnSecondCall: false });
      const roPass = await assessReadOnlyMutation(
        async () => validProbe,
        stableDb
      );
      expect(roPass.verificationScope).toBe("HTTP_GET_NONMUTATION");
      expect(roPass.status).toBe("PASS");
      expect(roPass.httpRequestVerified).toBe(true);
      expect(roPass.readOnlyPassed).toBe(true);
      expect(roPass.actualHttpRequestCount).toBe(1);
      expect(roPass.responseBodyDigest).toHaveLength(64);
    });
  });

  describe("Phase 2: Authentic Test & Integration Reporting", () => {
    const sha = "1234567890abcdef1234567890abcdef12345678";

    it("buildIntegrationSuiteReport never uses fixed 18/18 and fails closed on missing child process, non-zero exit, missing JSON, or wrong SHA", () => {
      // 1. Disk sufficient, command not started
      const notStarted = buildIntegrationSuiteReport({
        suiteSummary: null,
        expectedSourceSha: sha,
        diskHeadroomOk: true,
      });
      expect(notStarted.status).toBe("NOT_EXECUTED");
      expect(notStarted.totalTests).toBe(0);
      expect(notStarted.passedTests).toBe(0);

      // 2. Disk blocked
      const blocked = buildIntegrationSuiteReport({
        suiteSummary: null,
        expectedSourceSha: sha,
        diskHeadroomOk: false,
        initialFreeDiskGB: 8.93,
      });
      expect(blocked.status).toBe("BLOCKED_RESOURCE");
      expect(blocked.totalTests).toBe(0);

      // 3. Child exited 1 despite reporting 18 passed tests in JSON
      const exitOne = buildIntegrationSuiteReport({
        suiteSummary: {
          suiteId: "kh02_integration",
          pid: 5511,
          headSha: sha,
          startedAt: "2026-10-31T00:00:00.000Z",
          completedAt: "2026-10-31T00:00:05.000Z",
          durationMs: 5000,
          exitCode: 1,
          signal: null,
        },
        expectedSourceSha: sha,
        diskHeadroomOk: true,
        parsedJsonOverride: {
          testResults: [
            {
              name: "tests/integration/kh02ResearchApi.test.ts",
              assertionResults: Array.from({ length: 18 }, (_, i) => ({
                fullName: `int_test_${i}`,
                status: "passed",
                duration: 12,
              })),
            },
          ],
        },
      });
      expect(exitOne.status).toBe("FAIL");

      // 4. Missing JSON reporter output
      const missingJson = buildIntegrationSuiteReport({
        suiteSummary: {
          suiteId: "kh02_integration",
          pid: 5512,
          headSha: sha,
          startedAt: "2026-10-31T00:00:00.000Z",
          completedAt: "2026-10-31T00:00:05.000Z",
          durationMs: 5000,
          exitCode: 0,
          signal: null,
          jsonReportPath: "/nonexistent/report.json",
        },
        expectedSourceSha: sha,
        diskHeadroomOk: true,
      });
      expect(missingJson.status).toBe("FAIL");

      // 5. Skipped test reported in JSON -> PARTIAL
      const partial = buildIntegrationSuiteReport({
        suiteSummary: {
          suiteId: "kh02_integration",
          pid: 5513,
          headSha: sha,
          startedAt: "2026-10-31T00:00:00.000Z",
          completedAt: "2026-10-31T00:00:05.000Z",
          durationMs: 5000,
          exitCode: 0,
          signal: null,
        },
        expectedSourceSha: sha,
        diskHeadroomOk: true,
        parsedJsonOverride: {
          testResults: [
            {
              name: "tests/integration/kh02ResearchApi.test.ts",
              assertionResults: [
                { fullName: "t1", status: "passed", duration: 10 },
                { fullName: "t2", status: "skipped", duration: 0 },
              ],
            },
          ],
        },
      });
      expect(partial.status).toBe("PARTIAL");
      expect(partial.skippedTests).toBe(1);

      // 6. Wrong source SHA -> FAIL
      const wrongSha = buildIntegrationSuiteReport({
        suiteSummary: {
          suiteId: "kh02_integration",
          pid: 5514,
          headSha: "deadbeef",
          startedAt: "2026-10-31T00:00:00.000Z",
          completedAt: "2026-10-31T00:00:05.000Z",
          durationMs: 5000,
          exitCode: 0,
          signal: null,
        },
        expectedSourceSha: sha,
        diskHeadroomOk: true,
        parsedJsonOverride: {
          testResults: [
            {
              name: "tests/integration/kh02ResearchApi.test.ts",
              assertionResults: [{ fullName: "t1", status: "passed", duration: 10 }],
            },
          ],
        },
      });
      expect(wrongSha.status).toBe("FAIL");
    });

    it("buildTestExecutionTruthTable propagates duplicate test failure, tracks skippedTests, rejects unverified suites, and renders authentic JUnit XML", () => {
      const truth = buildTestExecutionTruthTable({
        expectedSourceSha: sha,
        diskHeadroomOk: true,
        suites: [
          {
            suiteId: "suite_1",
            pid: 1001,
            headSha: sha,
            startedAt: "2026-10-31T00:00:00.000Z",
            completedAt: "2026-10-31T00:00:02.000Z",
            durationMs: 2000,
            exitCode: 0,
          },
          {
            suiteId: "suite_2",
            pid: 1002,
            headSha: sha,
            startedAt: "2026-10-31T00:00:02.000Z",
            completedAt: "2026-10-31T00:00:04.000Z",
            durationMs: 2000,
            exitCode: 1,
          },
          {
            // Unverified mocked suite without PID -> must be rejected!
            suiteId: "mocked_suite_no_pid",
            pid: null,
            headSha: sha,
            startedAt: "2026-10-31T00:00:00.000Z",
            completedAt: "2026-10-31T00:00:01.000Z",
            durationMs: 1000,
            exitCode: 0,
          },
        ],
        parsedJsonBySuiteId: {
          suite_1: {
            testResults: [
              {
                name: "tests/unit/sample.test.ts",
                assertionResults: [
                  { fullName: "duplicate_test", status: "passed", duration: 125 },
                  { fullName: "skipped_test", status: "pending", duration: 0 },
                ],
              },
            ],
          },
          suite_2: {
            testResults: [
              {
                name: "tests/unit/sample.test.ts",
                assertionResults: [
                  {
                    fullName: "duplicate_test",
                    status: "failed",
                    duration: 250,
                    failureMessages: ["Expected true to be false"],
                  },
                ],
              },
            ],
          },
          mocked_suite_no_pid: {
            testResults: [
              {
                name: "tests/unit/fake.test.ts",
                assertionResults: [
                  { fullName: "fake_test", status: "passed", duration: 5 },
                ],
              },
            ],
          },
        },
      });

      expect(truth.validSuitesCount).toBe(2);
      expect(truth.invalidSuitesRejectedCount).toBe(1);
      expect(truth.totalRawTestExecutions).toBe(3);
      expect(truth.uniqueTestsExecuted).toBe(2);
      expect(truth.duplicateTestExecutionsCount).toBe(1);
      // Duplicate test passed in suite_1 and failed in suite_2 -> MUST be counted as failed!
      expect(truth.failedTests).toBe(1);
      expect(truth.skippedTests).toBe(1);
      expect(truth.uniqueTestsPassed).toBe(0);

      const xml = renderAuthenticJUnitXml(truth);
      expect(xml).toContain('time="0.1250"');
      expect(xml).toContain('time="0.2500"');
      expect(xml).toContain("<skipped />");
      expect(xml).toContain("Expected true to be false");
      expect(xml).not.toContain('time="10"');
    });
  });

  describe("Phase 3: Authentic Google Creative Provenance & Association Truth", () => {
    it("rejects synthetic creative IDs (cr_0, google_cr_*_0) and synthetic providerRequestIds (mcp_runId)", () => {
      expect(isSyntheticCreativeId("cr_0")).toBe(true);
      expect(isSyntheticCreativeId("cr_15")).toBe(true);
      expect(isSyntheticCreativeId("google_cr_adv123_0")).toBe(true);
      expect(isSyntheticCreativeId("CR-88412-REAL")).toBe(false);

      expect(isSyntheticProviderRequestId("mcp_run_1", "run_1")).toBe(true);
      expect(isSyntheticProviderRequestId("synthetic_req", "run_1")).toBe(true);
      expect(isSyntheticProviderRequestId("g_req_real_99", "run_1")).toBe(false);

      expect(
        isExplicitlyLiveGoogleCreative(
          {
            creativeId: "cr_0",
            isCached: false,
            sourceMode: "LIVE_PROVIDER",
            provenance: "REAL_UPSTREAM",
            researchRunId: "run_1",
            providerRequestId: "g_req_real_99",
          },
          "run_1"
        )
      ).toBe(false);

      expect(
        isExplicitlyLiveGoogleCreative(
          {
            creativeId: "CR-88412-REAL",
            isCached: false,
            sourceMode: "LIVE_PROVIDER",
            provenance: "REAL_UPSTREAM",
            researchRunId: "run_1",
            providerRequestId: "mcp_run_1",
          },
          "run_1"
        )
      ).toBe(false);
    });

    it("passes all Google MCP negative test scenarios (G06-NEG-01 through G06-NEG-20)", () => {
      const suite = runGoogleGateNegativeTests();
      expect(suite.totalTests).toBeGreaterThanOrEqual(15);
      expect(suite.totalPassed).toBe(suite.totalTests);
      expect(suite.passed).toBe(true);
    });
  });

  describe("Phase 4: Supervised Production Build & Port Occupancy Guard", () => {
    it("executeAndVerifyFreshProductionBuild fails closed on exitCode != 0, timeout, or stale .next/BUILD_ID", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(tmpOs.tmpdir(), "kh02-build-test-")
      );
      try {
        const buildDir = path.join(tmpDir, ".next");
        fs.mkdirSync(buildDir, { recursive: true });
        const logPath = path.join(tmpDir, "build.log");

        // 1. Exit code 1
        const failRes = await executeAndVerifyFreshProductionBuild({
          sourceSha: "sha_1",
          buildLogPath: logPath,
          buildDir,
          spawnImpl: (() => {
            const ee: any = new EventEmitter();
            ee.pid = 4101;
            ee.stdout = new EventEmitter();
            ee.stderr = new EventEmitter();
            ee.kill = () => {};
            setTimeout(() => {
              ee.stderr.emit("data", Buffer.from("Failed to compile\n"));
              ee.emit("close", 1, null);
            }, 10);
            return ee;
          }) as any,
        });
        expect(failRes.status).toBe("BUILD_FAILED");
        expect(failRes.allowServerAndChromiumLaunch).toBe(false);

        // 2. Exit code 0 but stale BUILD_ID (mtime 60s before buildStartMs)
        const buildIdFile = path.join(buildDir, "BUILD_ID");
        fs.writeFileSync(buildIdFile, "old_build_id", "utf8");
        const pastDate = new Date(Date.now() - 60_000);
        fs.utimesSync(buildIdFile, pastDate, pastDate);

        const staleRes = await executeAndVerifyFreshProductionBuild({
          sourceSha: "sha_1",
          buildLogPath: logPath,
          buildDir,
          spawnImpl: (() => {
            const ee: any = new EventEmitter();
            ee.pid = 4102;
            ee.stdout = new EventEmitter();
            ee.stderr = new EventEmitter();
            ee.kill = () => {};
            setTimeout(() => {
              ee.stdout.emit("data", Buffer.from("✓ Compiled successfully\n"));
              ee.emit("close", 0, null);
            }, 10);
            return ee;
          }) as any,
        });
        expect(staleRes.status).toBe("BUILD_FAILED");
        expect(staleRes.buildIdFreshlyUpdated).toBe(false);
        expect(staleRes.allowServerAndChromiumLaunch).toBe(false);

        // 3. Exit code 0 + fresh BUILD_ID -> BUILD_PASS
        const freshRes = await executeAndVerifyFreshProductionBuild({
          sourceSha: "sha_1",
          buildLogPath: logPath,
          buildDir,
          spawnImpl: (() => {
            const ee: any = new EventEmitter();
            ee.pid = 4103;
            ee.stdout = new EventEmitter();
            ee.stderr = new EventEmitter();
            ee.kill = () => {};
            setTimeout(() => {
              fs.writeFileSync(buildIdFile, "fresh_build_123", "utf8");
              ee.stdout.emit(
                "data",
                Buffer.from(
                  "✓ Compiled successfully\nWarning: bigqueryClientAdapter dynamic import\n"
                )
              );
              ee.emit("close", 0, null);
            }, 15);
            return ee;
          }) as any,
        });
        expect(freshRes.status).toBe("BUILD_PASS");
        expect(freshRes.buildIdFreshlyUpdated).toBe(true);
        expect(freshRes.allowServerAndChromiumLaunch).toBe(true);
        expect(freshRes.warningsCount).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("startIsolatedAcceptanceServer refuses to attach to an already occupied port (PORT_CONFLICT)", async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(tmpOs.tmpdir(), "kh02-port-test-")
      );
      const dummyServer = net.createServer();
      await new Promise<void>((resolve) =>
        dummyServer.listen(0, "127.0.0.1", () => resolve())
      );
      const addr = dummyServer.address() as net.AddressInfo;
      const occupiedPort = addr.port;

      try {
        fs.writeFileSync(path.join(tmpDir, "BUILD_ID"), "b_123", "utf8");
        await expect(
          startIsolatedAcceptanceServer({
            port: occupiedPort,
            buildPath: tmpDir,
            allowDynamicPortFallback: false,
          })
        ).rejects.toThrow(/PORT_CONFLICT/);
      } finally {
        await new Promise<void>((resolve) => dummyServer.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Phase 5: G15 Exact Identity Query & 33 Physical-File Negative Control Mutations", () => {
    it("queryAndEvaluateG15CandidateDemand uses exact product identity (never 15-char substring) and distinguishes DB_QUERY_FAILED from ZERO_REAL_OBSERVATIONS", async () => {
      let capturedWhere: any = null;
      const mockZeroDb = {
        productDemandObservation: {
          findMany: async (args: any) => {
            capturedWhere = args?.where;
            return [];
          },
        },
      };

      const zeroRes = await queryAndEvaluateG15CandidateDemand(
        {
          candidateId: "cand_uahpet_1",
          researchProductId: "prod_uahpet_1",
          title: "UAHPET Stainless Steel Pet Water Fountain",
        },
        mockZeroDb
      );
      expect(zeroRes.queryStatus).toBe("ZERO_REAL_OBSERVATIONS");
      expect(zeroRes.queryMode).toBe("EXACT_PRODUCT_IDENTITY");
      expect(zeroRes.g15Qualifying).toBe(false);
      // Verify no `{ contains: ... }` substring clause was used
      expect(JSON.stringify(capturedWhere)).not.toContain("contains");

      const mockFailingDb = {
        productDemandObservation: {
          findMany: async () => {
            throw new Error("SQLITE_CORRUPT: disk I/O error");
          },
        },
      };
      const errRes = await queryAndEvaluateG15CandidateDemand(
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Stainless Steel Pet Water Fountain",
        },
        mockFailingDb
      );
      expect(errRes.queryStatus).toBe("DB_QUERY_FAILED");
      expect(errRes.g15Qualifying).toBe(false);
      expect(errRes.error).toContain("SQLITE_CORRUPT");
    });

    it("catches all 33 physical-file negative control mutations (MUT_01 through MUT_33)", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(tmpOs.tmpdir(), "kh02-v124347-neg-")
      );
      try {
        const sha = "b".repeat(40);
        writeCanonicalValidBaselineFixture(tmpDir, sha);

        const baseVal = validateAcceptanceArtifacts(tmpDir, {
          skipSelfMutationReportCheck: true,
        });
        expect(baseVal.overallValid).toBe(true);
        expect(baseVal.failedChecks).toBe(0);

        const negSuite = runNegativeControlSuite(tmpDir);
        expect(negSuite.totalMutations).toBeGreaterThanOrEqual(33);
        expect(negSuite.totalCaughtAndRejected).toBe(negSuite.totalMutations);
        expect(negSuite.suiteVerdict).toBe("PASS");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
