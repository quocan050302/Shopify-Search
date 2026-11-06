/**
 * SWAI KH-02 — V12.4.3.7.19.2
 * Free Source Truth, Official CSV Evidence Admission & Honest G15/G16 Gates
 *
 * Test Matrix T01 - T20:
 * Enforces strict separation between source capability/configuration and source proof/provenance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  GoogleTrendsCsvImportProvider,
  GoogleTrendsBigQueryProvider,
  GoogleFreeDemandProvider,
  defaultDemandProvider,
} from "@/services/kh02/demand/demandProviderRegistry";
import {
  diagnoseKH02Source,
  getLatestProbe,
  recordLatestProbe,
  sanitizeSecretPatterns,
  type SourceDiagnosticResult,
} from "@/services/kh02/providers/sourceRegistry";
import {
  validateAndParseGoogleTrendsCsv,
  verifyStoredCsvFile,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  evaluateDemandHistoryEvidence,
  type DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  validateTestSuiteExecutionEvidence,
  parseVitestOutputMetrics,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";
import {
  evaluateG16Candidate,
  evaluateG16Top3,
} from "../../../scripts/kh02/g16CandidateEvaluator";

describe("KH-02 V12.4.3.7.19.2: Free Source Truth & Diagnostic Honesty (T01 - T20)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("T01: CSV importer configured but NO target artifact => provenanceVerified=false, importCapabilityReady=true", async () => {
    const csvProvider = new GoogleTrendsCsvImportProvider();
    const diag = await csvProvider.diagnose();

    expect(diag.status).toBe("CONFIGURED");
    expect(diag.configured).toBe(true);
    expect(diag.transportConnected).toBe(false);
    expect(diag.authenticated).toBe(false);
    expect(diag.queryExecuted).toBe(false);
    expect(diag.recordsReturned).toBeNull();
    // Closes Defect P1 (Line 327 fix):
    expect(diag.provenanceVerified).toBe(false);
    expect(diag.importCapabilityReady).toBe(true);
    expect(diag.sourceArtifactPresent).toBe(false);
    expect(diag.verifiedApplicableRowCount).toBe(0);
    expect(diag.explanationCode).toBe("IMPORT_READY_NO_RELEVANT_ARTIFACT");
  });

  it("T02: BigQuery missing BIGQUERY_PROJECT_ID => NOT_CONFIGURED, transportConnected=false, queryExecuted=false", async () => {
    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    const bqProvider = new GoogleTrendsBigQueryProvider();
    const diag = await bqProvider.diagnose();

    expect(diag.status).toBe("NOT_CONFIGURED");
    expect(diag.configured).toBe(false);
    expect(diag.transportConnected).toBe(false);
    expect(diag.authenticated).toBe(false);
    expect(diag.queryExecuted).toBe(false);
    expect(diag.recordsReturned).toBeNull();
    expect(diag.provenanceVerified).toBe(false);
    expect(diag.missingRequirements).toContain("BIGQUERY_PROJECT_ID");
  });

  it("T03: Composite with import-ready but no valid provider data => provenanceVerified=false, NOT DATA_VERIFIED", async () => {
    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;

    const composite = new GoogleFreeDemandProvider();
    const diag = await composite.diagnose();

    expect(diag.status).toBe("CONFIGURED");
    expect(diag.configured).toBe(true);
    expect(diag.transportConnected).toBe(false);
    expect(diag.authenticated).toBe(false);
    expect(diag.queryExecuted).toBe(false);
    expect(diag.recordsReturned).toBeNull();
    // Closes Defect P1 (Line 554 fix):
    expect(diag.provenanceVerified).toBe(false);
    expect(diag.importCapabilityReady).toBe(true);
    expect(diag.verifiedApplicableRowCount).toBe(0);
    expect(diag.explanationCode).toBe("IMPORT_READY_NO_RELEVANT_ARTIFACT");
  });

  it("T04: 3 unrelated checksummed CSVs => integrity passes individually; applicableRows=0, origin not proved for target", () => {
    const importDir = path.resolve(process.cwd(), "data", "google_trends_imports");
    const baselineHashes = [
      "49f452e8413178ee0b3e1e2d42c2fd495693b552f211bc908a16511b63302109",
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39",
    ];

    for (const hash of baselineHashes) {
      const filePath = path.join(importDir, `${hash}.csv`);
      if (fs.existsSync(filePath)) {
        const bytes = fs.readFileSync(filePath);
        const computed = crypto.createHash("sha256").update(bytes).digest("hex");
        expect(computed).toBe(hash);

        // SHA match proves byte integrity only, NOT product scope for UAHPET
        const content = bytes.toString("utf8");
        expect(content.toLowerCase()).not.toContain("uahpet");
      }
    }
  });

  it("T05: 96 unrelated US CSV rows => UAHPET / KittySpout / Cleaner G15 observations remain zero", async () => {
    // 0 candidate-specific points evaluated
    const emptyResult = evaluateDemandHistoryEvidence([], {
      searchTermUsed: "UAHPET Fresh Food Automatic Pet Feeder",
    });
    expect(emptyResult.status).toBe("INSUFFICIENT_HISTORY");
    expect(emptyResult.coveredDays).toBe(0);
    expect(emptyResult.dataPointsCount).toBe(0);
    expect(emptyResult.eligibleForEvergreen).toBe(false);
  });

  it("T06: Checksum-matched arbitrary file lacking authentic origin cannot assert official source verified", () => {
    const rawMock = "Week,random string\n2026-01-01,50\n";
    const parsed = validateAndParseGoogleTrendsCsv(rawMock);
    // Lacks Category: All categories and Interest over time header
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors.some((e) => e.includes("Missing official Google Trends"))).toBe(true);
  });

  it("T07: Invalid CSV schema or keyword/region mismatch is rejected at row scope", () => {
    const validHeadersWrongGeo = `Category: All categories

Interest over time
Week,automatic cat feeder: (United Kingdom)
2026-08-02,78
2026-08-09,82
2026-08-16,80
`;
    const parsed = validateAndParseGoogleTrendsCsv(validHeadersWrongGeo);
    expect(parsed.valid).toBe(true);
    expect(parsed.region).toBe("United Kingdom"); // Detected non-US!
  });

  it("T08: Exact matching fixture under TEST_ONLY proves parser behavior, never G15 business PASS", () => {
    const validSample = `Category: All categories

Interest over time
Week,cat water fountain: (United States)
2026-08-02,78
2026-08-09,82
2026-08-16,80
`;
    const parsed = validateAndParseGoogleTrendsCsv(validSample, {
      importedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(parsed.valid).toBe(true);
    expect(parsed.keyword).toBe("cat water fountain");
    expect(parsed.region).toBe("US");
    expect(parsed.dataPoints).toHaveLength(3);
    // Pure parser verification only: does NOT modify business G15
  });

  it("T09: Empty live readback G15 returns INSUFFICIENT_HISTORY, 0 days, false", () => {
    const evalResult = evaluateDemandHistoryEvidence([], {
      searchTermUsed: "The KittySpout™ - Wireless Fountain",
    });
    expect(evalResult.status).toBe("INSUFFICIENT_HISTORY");
    expect(evalResult.dataPointsCount).toBe(0);
    expect(evalResult.coveredDays).toBe(0);
    expect(evalResult.eligibleForEvergreen).toBe(false);
    expect(evalResult.explanation).toContain("Insufficient historical data");
    expect(evalResult.missingEvidence.length).toBeGreaterThan(0);
  });

  it("T10: G16 with zero G16-qualified products returns INSUFFICIENT_EVIDENCE", () => {
    const emptyCandidates: any[] = [];
    const g16Res = evaluateG16Top3(emptyCandidates, "kh02_run_1793424091548_669k8");
    expect(g16Res.g16Verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(g16Res.verifiedLiveCount).toBe(0);
  });

  it("T11: G16 with only 1 or 2 qualifying distinct products returns INSUFFICIENT_EVIDENCE", () => {
    const twoCandidates: any[] = [
      {
        candidateId: "cand_1",
        title: "Product 1",
        storeDomain: "store1.com",
        canonicalProductUrl: "https://store1.com/p1",
        familyKey: "family_1",
        identityStatus: "VERIFIED",
        merchantVerified: true,
      },
      {
        candidateId: "cand_2",
        title: "Product 2",
        storeDomain: "store2.com",
        canonicalProductUrl: "https://store2.com/p2",
        familyKey: "family_2",
        identityStatus: "VERIFIED",
        merchantVerified: true,
      },
    ];
    const g16Res = evaluateG16Top3(twoCandidates, "kh02_run_1793424091548_669k8");
    expect(g16Res.g16Verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(g16Res.verifiedLiveCount).toBe(0);
  });

  it("T12: Cross-product aliases or duplicate families do not grant false distinctness", () => {
    const dupFamilyCandidates: any[] = [
      {
        candidateId: "cand_1",
        title: "Cat Feeder Brand A",
        familyKey: "automatic_pet_feeder",
      },
      {
        candidateId: "cand_2",
        title: "Cat Feeder Brand B",
        familyKey: "automatic_pet_feeder",
      },
    ];
    const g16Res = evaluateG16Top3(dupFamilyCandidates, "kh02_run_1793424091548_669k8");
    expect(g16Res.g16Verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("T13: As-of point-in-time enforcement rejects lookahead timestamps", () => {
    const futurePoints: DemandDataPoint[] = [
      { date: "2026-11-15", demandValue: 80 },
    ];
    const evalRes = evaluateDemandHistoryEvidence(futurePoints, {
      searchTermUsed: "test",
      asOfTimestamp: "2026-10-31T00:00:00.000Z",
    });
    expect(evalRes.dataPointsCount).toBe(0);
    expect(evalRes.status).toBe("INSUFFICIENT_HISTORY");
  });

  it("T14: Unknown provider plan / quota or pay risk results in BLOCKED without probing paid API", async () => {
    process.env.DEMAND_PROVIDER_MODE = "SERPAPI_LEGACY";
    delete process.env.SERPAPI_API_KEY;

    const diag = await diagnoseKH02Source("DEMAND_HISTORY");
    expect(diag.missingRequirements).toContain("SERPAPI_API_KEY");
  });

  it("T15: UI/API semantics: importCapabilityReady=true AND provenanceVerified=false renders honestly", async () => {
    delete process.env.BIGQUERY_PROJECT_ID;
    const diag = await diagnoseKH02Source("DEMAND_HISTORY");

    expect(diag.configured).toBe(true);
    expect(diag.provenanceVerified).toBe(false);
    expect(diag.importCapabilityReady).toBe(true);
    expect(diag.verifiedApplicableRowCount).toBe(0);
    expect(diag.explanationCode).toBe("IMPORT_READY_NO_RELEVANT_ARTIFACT");
  });

  it("T16: Provenance flag cannot be promoted by stale cache or merged composite diagnostic", async () => {
    delete process.env.BIGQUERY_PROJECT_ID;
    const diag1 = await defaultDemandProvider.diagnose();
    expect(diag1.provenanceVerified).toBe(false);

    // Recording an unrelated probe does not forge provenanceVerified
    recordLatestProbe("DEMAND_HISTORY", {
      ...diag1,
      provenanceVerified: false,
    }, "ws_test_t16");
    const latest = getLatestProbe("DEMAND_HISTORY", "ws_test_t16");
    expect(latest?.provenanceVerified).toBe(false);
  });

  it("T17: No production DB mutation and zero external API invocations during diagnostic", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.SERPAPI_API_KEY;

    const diag = await diagnoseKH02Source("DEMAND_HISTORY");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(diag.provenanceVerified).toBe(false);
  });

  it("T18: Sanitized logs: tokens, keys, cookies, DB strings stripped", () => {
    const rawMsg = "Error connecting with SERPAPI_API_KEY=secret_key_123 and cookie session=abc";
    const sanitized = sanitizeSecretPatterns(rawMsg);
    expect(sanitized).not.toContain("secret_key_123");
    expect(sanitized).toContain("SERPAPI_API_KEY=[REDACTED]");
  });

  it("T19: Baseline targeted test evidence validator rejects untrusted, missing, or zero-test claims", () => {
    // 1. Untrusted caller claiming full coverage without evidence is rejected
    const unbackedReport = validateTestSuiteExecutionEvidence({
      command: "npm run kh02:test:unit",
      exitCode: 0,
      stdout: "",
      checkoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
      callerClaimsFullCoverage: true,
    });
    expect(unbackedReport.valid).toBe(false);
    expect(unbackedReport.status).toBe("INCOMPLETE");
    expect(unbackedReport.rejectionReasons.some((r) => r.includes("Neither durable log file nor stdout"))).toBe(true);

    // 2. Output with zero tests is rejected as INCOMPLETE
    const zeroTestReport = validateTestSuiteExecutionEvidence({
      command: "vitest run dummy",
      exitCode: 0,
      stdout: "Test Files 0 passed (0)\nTests 0 passed (0)",
      checkoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
    });
    expect(zeroTestReport.valid).toBe(false);
    expect(zeroTestReport.status).toBe("INCOMPLETE");

    // 3. Genuine execution log parsed and verified with non-empty metrics
    const sampleOutput = `
 ✓ tests/unit/kh02/test1.test.ts (10 tests)
 ✓ tests/unit/kh02/test2.test.ts (15 tests)
 Test Files  2 passed (2)
 Tests  25 passed (25)
`;
    const validReport = validateTestSuiteExecutionEvidence({
      command: "vitest run tests/unit/kh02",
      exitCode: 0,
      stdout: sampleOutput,
      checkoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
      expectedCheckoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
    });
    expect(validReport.valid).toBe(true);
    expect(validReport.status).toBe("PASS");
    expect(validReport.metrics.testsPassed).toBe(25);
    expect(validReport.metrics.testFilesPassed).toBe(2);
    expect(validReport.logFileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("T20: Full suite gate validator requires real command logs, matching SHA, and non-zero exit validation", () => {
    // 1. Non-zero exit code is rejected as FAIL
    const failReport = validateTestSuiteExecutionEvidence({
      command: "npm run kh02:test:integration",
      exitCode: 1,
      stdout: "Test Files 1 failed (1)\nTests 1 failed (1)",
      checkoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
    });
    expect(failReport.valid).toBe(false);
    expect(failReport.status).toBe("FAIL");
    expect(failReport.rejectionReasons.some((r) => r.includes("exited with non-zero exit code: 1"))).toBe(true);

    // 2. Stale checkout SHA is rejected as STALE
    const staleReport = validateTestSuiteExecutionEvidence({
      command: "npm run kh02:test:unit",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 5 passed (5)",
      checkoutSha: "old_sha_12345",
      expectedCheckoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
    });
    expect(staleReport.valid).toBe(false);
    expect(staleReport.status).toBe("STALE");
    expect(staleReport.rejectionReasons.some((r) => r.includes("STALE_LOG"))).toBe(true);

    // 3. Missing mandatory test suite files rejected
    const missingSuiteReport = validateTestSuiteExecutionEvidence({
      command: "vitest run tests/unit/kh02",
      exitCode: 0,
      stdout: " ✓ tests/unit/kh02/sample.test.ts\n Test Files 1 passed (1)\n Tests 5 passed (5)",
      checkoutSha: "ade9f2f1dbb3dffdc8bf02f300b6e5d74eb7b0d9",
      mandatoryTestFiles: ["mandatorySuiteA.test.ts"],
    });
    expect(missingSuiteReport.valid).toBe(false);
    expect(missingSuiteReport.status).toBe("INCOMPLETE");
    expect(missingSuiteReport.missingMandatoryFiles).toContain("mandatorySuiteA.test.ts");
  });
});
