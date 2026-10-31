/**
 * SWAI KH-02 V12.4.3.4.6 — Independent Acceptance Manifest Validator & 26 Physical-File Negative Controls
 *
 * Enforces:
 * 1. All 32 mandatory artifacts for `acceptance/kh02-v12.4.3.4.6-strict-evidence-closure/`.
 * 2. Recomputed gate consistency (`CHK_16`) from raw evidence artifacts rather than static threshold counts
 *    (any single mandatory engineering gate failure rejects `overallEngineeringVerdict === "PASS"`, and a genuine 28/28 PASS is accepted).
 * 3. Strengthened `CHK_05` (test truth table + JUnit cross-check), `CHK_06` (integration suites on disk & in JUnit),
 *    `CHK_10` (three-way SQLite/HTTP/DOM parity + persisted SQLite proof), `CHK_10B` (read-only SHA-256 content digests),
 *    `CHK_12` (Google explicit live provenance, set reconciliation & exact vs probable separation), and `CHK_13` (G16 lineage & merchant proof refs).
 * 4. 26 physical-file negative control mutations (`MUT_01` .. `MUT_26`) executed in isolated `os.tmpdir()` directories.
 */

import fs from "fs";
import path from "path";
import os from "os";

export const MANDATORY_ACCEPTANCE_ARTIFACTS = [
  "PRE_FLIGHT_GIT_AND_ENV.json",
  "DEFECT_REPRODUCTION_AND_CLOSURE.json",
  "EXACT_FUNCTION_CHANGELOG.md",
  "ASYNC_WAVE_EXECUTION_REPORT.json",
  "COMPLETION_BARRIER_REPORT.json",
  "DISK_RAM_SQLITE_SAFETY.json",
  "TEST_EXECUTION_TRUTH_TABLE.json",
  "RAW_TEST_SUMMARY.json",
  "JUNIT_RESULTS.xml",
  "INTEGRATION_SUITE_REPORT.json",
  "NEXT_BUILD_LOG.txt",
  "SERVER_READY_PROBES.json",
  "CHROMIUM_EXECUTION_REPORT.json",
  "CHROMIUM_FAILURE_INJECTION_TESTS.json",
  "SQLITE_HTTP_CHROMIUM_PARITY.json",
  "READ_ONLY_DB_CONTENT_INTEGRITY.json",
  "GOOGLE_MCP_EXECUTION_TIMELINE.json",
  "GOOGLE_RAW_CREATIVE_MANIFEST.json",
  "GOOGLE_NORMALIZATION_LEDGER.json",
  "GOOGLE_CREATIVE_ASSOCIATION_LEDGER.json",
  "GOOGLE_PRODUCT_ASSOCIATION_PROOF.json",
  "GOOGLE_SAME_RUN_RECONCILIATION.json",
  "G06_GATE_EVALUATION.json",
  "G15_PRODUCT_DEMAND_PROOF.json",
  "G16_CURRENT_RUN_VERIFIED_PROOF.json",
  "REAL_HISTORICAL_DEV_BACKTEST.json",
  "REAL_HISTORICAL_HOLDOUT_BACKTEST.json",
  "HISTORICAL_POINT_IN_TIME_AUDIT.json",
  "PRODUCTION_REPLAY_PARITY.json",
  "GATE_TRUTH_MATRIX_V12_4_3_4_6.json",
  "NEGATIVE_CONTROL_MUTATION_SUITE.json",
  "FINAL_RELEASE_DECISION_V12_4_3_4_6.md",
] as const;

export interface ValidationCheckResult {
  checkId: string;
  description: string;
  passed: boolean;
  failureReason?: string;
}

export interface AcceptanceValidationReport {
  evaluatedAt: string;
  version: string;
  targetDirectory: string;
  overallValid: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: ValidationCheckResult[];
}

export interface NegativeControlCaseResult {
  mutationId: string;
  description: string;
  targetArtifact: string;
  injectedDefect: string;
  validatorRejected: boolean;
  caughtByCheckIds: string[];
  passed: boolean;
}

export interface NegativeControlSuiteReport {
  evaluatedAt: string;
  version: string;
  totalMutations: number;
  totalCaughtAndRejected: number;
  suiteVerdict: "PASS" | "FAIL";
  cases: NegativeControlCaseResult[];
}

function safeReadJson(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeReadText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function parseJUnitXmlMetrics(xmlContent: string): {
  validXml: boolean;
  testsuiteCount: number;
  testcaseCount: number;
  totalTestsAttr: number;
  totalFailuresAttr: number;
  totalErrorsAttr: number;
  failureTagCount: number;
  errorTagCount: number;
} {
  if (!xmlContent || !xmlContent.includes("<testsuites") || !xmlContent.includes("</testsuites>")) {
    return {
      validXml: false,
      testsuiteCount: 0,
      testcaseCount: 0,
      totalTestsAttr: 0,
      totalFailuresAttr: 0,
      totalErrorsAttr: 0,
      failureTagCount: 0,
      errorTagCount: 0,
    };
  }

  const testsuiteMatches = xmlContent.match(/<testsuite\b[^>]*>/g) || [];
  const testcaseMatches = xmlContent.match(/<testcase\b[^>]*>/g) || [];
  const failureTagMatches = xmlContent.match(/<failure\b[^>]*>/g) || [];
  const errorTagMatches = xmlContent.match(/<error\b[^>]*>/g) || [];

  const rootMatch = xmlContent.match(/<testsuites\b([^>]*)>/);
  let totalTestsAttr = 0;
  let totalFailuresAttr = 0;
  let totalErrorsAttr = 0;

  if (rootMatch) {
    const attrs = rootMatch[1];
    const tMatch = attrs.match(/\btests="(\d+)"/);
    const fMatch = attrs.match(/\bfailures="(\d+)"/);
    const eMatch = attrs.match(/\berrors="(\d+)"/);
    if (tMatch) totalTestsAttr = parseInt(tMatch[1], 10);
    if (fMatch) totalFailuresAttr = parseInt(fMatch[1], 10);
    if (eMatch) totalErrorsAttr = parseInt(eMatch[1], 10);
  }

  if (totalTestsAttr === 0 && testsuiteMatches.length > 0) {
    for (const ts of testsuiteMatches) {
      const tMatch = ts.match(/\btests="(\d+)"/);
      const fMatch = ts.match(/\bfailures="(\d+)"/);
      const eMatch = ts.match(/\berrors="(\d+)"/);
      if (tMatch) totalTestsAttr += parseInt(tMatch[1], 10);
      if (fMatch) totalFailuresAttr += parseInt(fMatch[1], 10);
      if (eMatch) totalErrorsAttr += parseInt(eMatch[1], 10);
    }
  }

  return {
    validXml: testsuiteMatches.length > 0 && testcaseMatches.length > 0,
    testsuiteCount: testsuiteMatches.length,
    testcaseCount: testcaseMatches.length,
    totalTestsAttr,
    totalFailuresAttr,
    totalErrorsAttr,
    failureTagCount: failureTagMatches.length,
    errorTagCount: errorTagMatches.length,
  };
}

/**
 * Validates the complete acceptance directory against strict structural, content, and cross-artifact invariants.
 */
export function validateAcceptanceArtifacts(
  acceptanceDir: string,
  options?: { skipSelfMutationReportCheck?: boolean; skipCliExitDecisionCheck?: boolean }
): AcceptanceValidationReport {
  const checks: ValidationCheckResult[] = [];
  const addCheck = (checkId: string, description: string, passed: boolean, failureReason?: string) => {
    checks.push({
      checkId,
      description,
      passed,
      ...(passed ? {} : { failureReason: failureReason || "Check failed" }),
    });
  };

  // 1. Check all mandatory files exist and are non-empty
  const missingFiles: string[] = [];
  const requiredArtifactList: string[] = [...MANDATORY_ACCEPTANCE_ARTIFACTS];
  if (acceptanceDir.includes("12.4.3.4.8") || acceptanceDir.includes("12.4.3.4.9")) {
    requiredArtifactList.push(
      "SOURCE_SHA_PROVENANCE.json",
      "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json"
    );
  }
  if (acceptanceDir.includes("12.4.3.4.9")) {
    requiredArtifactList.push(
      "SAFE_DISK_RECOVERY_AUDIT.json",
      "RESOURCE_WAVE_GUARDS.json"
    );
    if (!options?.skipCliExitDecisionCheck) {
      requiredArtifactList.push(
        "CLI_EXIT_DECISION.json",
        "CLI_POSITIVE_AND_FAILURE_EXIT_PROOF.json"
      );
    }
  }
  for (const filename of requiredArtifactList) {
    if (options?.skipSelfMutationReportCheck && filename === "NEGATIVE_CONTROL_MUTATION_SUITE.json") {
      continue;
    }
    const fullPath = path.join(acceptanceDir, filename);
    if (!fs.existsSync(fullPath)) {
      missingFiles.push(filename);
    } else {
      const stat = fs.statSync(fullPath);
      if (stat.size === 0) {
        missingFiles.push(`${filename} (0 bytes)`);
      }
    }
  }
  addCheck(
    "CHK_01_MANDATORY_FILES_PRESENT",
    "All mandatory acceptance artifacts exist and are non-empty",
    missingFiles.length === 0,
    missingFiles.length > 0 ? `Missing or empty files: ${missingFiles.join(", ")}` : undefined
  );

  // 2. Pre-flight Git, Env, and Source SHA Provenance
  const preFlight = safeReadJson(path.join(acceptanceDir, "PRE_FLIGHT_GIT_AND_ENV.json"));
  const shaProvenance = safeReadJson(path.join(acceptanceDir, "SOURCE_SHA_PROVENANCE.json"));
  const shaProvenanceOk =
    !shaProvenance ||
    (typeof shaProvenance.testedSourceSha === "string" &&
      shaProvenance.testedSourceSha.length >= 7 &&
      shaProvenance.testedSourceSha === preFlight?.headSha &&
      shaProvenance.branch === "feature/kh02-v12.1.3-runtime-truth-closure");
  const preFlightOk = Boolean(
    preFlight &&
      preFlight.branch === "feature/kh02-v12.1.3-runtime-truth-closure" &&
      typeof preFlight.headSha === "string" &&
      preFlight.headSha.length >= 7 &&
      typeof preFlight.freeDiskGB === "number" &&
      preFlight.freeDiskGB >= 15 &&
      shaProvenanceOk
  );
  addCheck(
    "CHK_02_PREFLIGHT_VALID",
    "PRE_FLIGHT_GIT_AND_ENV and SOURCE_SHA_PROVENANCE have matching branch, testedSourceSha === headSha, and freeDiskGB >= 15",
    preFlightOk,
    !preFlightOk ? "Invalid branch, SOURCE_SHA_PROVENANCE mismatch, missing headSha, or freeDiskGB < 15" : undefined
  );

  // 2b. Defect reproduction and closure proof
  const defectClosure = safeReadJson(path.join(acceptanceDir, "DEFECT_REPRODUCTION_AND_CLOSURE.json"));
  const defectClosureOk = Boolean(
    defectClosure &&
      Array.isArray(defectClosure.defects) &&
      defectClosure.defects.length >= 5 &&
      defectClosure.defects.every(
        (d: any) =>
          Boolean(d.defectId) &&
          Boolean(d.targetFile) &&
          d.reproducedBeforeFix === true &&
          d.closedAfterFix === true
      )
  );
  addCheck(
    "CHK_02B_DEFECT_REPRODUCTION_AND_CLOSURE",
    "DEFECT_REPRODUCTION_AND_CLOSURE proves all 5 audit defects were reproduced and closed",
    defectClosureOk,
    !defectClosureOk ? "DEFECT_REPRODUCTION_AND_CLOSURE missing or incomplete" : undefined
  );

  // 3. Completion Barrier & Async Wave Report
  const barrier = safeReadJson(path.join(acceptanceDir, "COMPLETION_BARRIER_REPORT.json"));
  const barrierOk = Boolean(
    barrier &&
      barrier.barrierSatisfied === true &&
      barrier.zeroRunningJobs === true &&
      typeof barrier.jobsScheduled === "number" &&
      barrier.jobsScheduled > 0 &&
      barrier.jobsCompleted === barrier.jobsScheduled &&
      barrier.jobsFailed === 0 &&
      barrier.jobsTimedOut === 0
  );
  addCheck(
    "CHK_03_COMPLETION_BARRIER",
    "COMPLETION_BARRIER_REPORT proves all scheduled async waves completed with 0 running/failed/timedOut",
    barrierOk,
    !barrierOk ? "Completion barrier not satisfied or failed/running jobs > 0" : undefined
  );

  // 4. Disk, RAM, SQLite Safety
  const safety = safeReadJson(path.join(acceptanceDir, "DISK_RAM_SQLITE_SAFETY.json"));
  const safetyOk = Boolean(
    safety &&
      typeof safety.initialFreeDiskGB === "number" &&
      typeof safety.finalFreeDiskGB === "number" &&
      typeof safety.minFreeDiskGB === "number" &&
      safety.initialFreeDiskGB >= safety.minFreeDiskGB &&
      safety.finalFreeDiskGB >= safety.minFreeDiskGB &&
      safety.sqliteIntegrityCheck === "ok"
  );
  addCheck(
    "CHK_04_DISK_RAM_SQLITE_SAFETY",
    "DISK_RAM_SQLITE_SAFETY verifies disk free space >= minFreeDiskGB and sqliteIntegrityCheck === 'ok'",
    safetyOk,
    !safetyOk ? "Disk free space below threshold or SQLite integrity check failed" : undefined
  );

  // 5. Test Execution Truth Table, Raw Test Summary & JUnit XML cross-check (Phase 4.2)
  const truthTable = safeReadJson(path.join(acceptanceDir, "TEST_EXECUTION_TRUTH_TABLE.json"));
  const rawSummary = safeReadJson(path.join(acceptanceDir, "RAW_TEST_SUMMARY.json"));
  const junitXml = safeReadText(path.join(acceptanceDir, "JUNIT_RESULTS.xml")) || "";
  const junitMetrics = parseJUnitXmlMetrics(junitXml);

  const truthTableOk = Boolean(
    truthTable &&
      typeof truthTable.uniqueTestsExecuted === "number" &&
      truthTable.uniqueTestsExecuted >= 400 &&
      typeof truthTable.uniqueTestsPassed === "number" &&
      truthTable.uniqueTestsPassed === truthTable.uniqueTestsExecuted &&
      truthTable.failedTests === 0 &&
      (truthTable.failedExecutionsCount === undefined || truthTable.failedExecutionsCount === 0) &&
      (truthTable.zeroFailedTests === undefined || truthTable.zeroFailedTests === true) &&
      typeof truthTable.skippedTests === "number" &&
      truthTable.uniqueTestsExecuted ===
        truthTable.uniqueTestsPassed + truthTable.failedTests + truthTable.skippedTests &&
      typeof truthTable.totalRawTestExecutions === "number" &&
      truthTable.totalRawTestExecutions >= truthTable.uniqueTestsExecuted &&
      typeof truthTable.duplicateTestExecutionsCount === "number" &&
      truthTable.duplicateTestExecutionsCount ===
        truthTable.totalRawTestExecutions - truthTable.uniqueTestsExecuted &&
      rawSummary &&
      rawSummary.numFailedTests === 0 &&
      rawSummary.numTotalTests === truthTable.totalRawTestExecutions
  );
  addCheck(
    "CHK_05_TEST_TRUTH_TABLE",
    "TEST_EXECUTION_TRUTH_TABLE reconciles unique vs raw executions with RAW_TEST_SUMMARY and 0 failures",
    truthTableOk,
    !truthTableOk ? "Test truth table failed Tests > 0, uniqueTestsExecuted < 400, or mismatch with RAW_TEST_SUMMARY" : undefined
  );

  // 6. Integration Suite Report (Phase 2 & 4.3)
  const intReport = safeReadJson(path.join(acceptanceDir, "INTEGRATION_SUITE_REPORT.json"));
  const intFilesExistAndInJunit =
    intReport &&
    Array.isArray(intReport.executedSuiteFiles) &&
    intReport.executedSuiteFiles.length >= 2 &&
    intReport.executedSuiteFiles.every((relFile: string) => {
      const abs = path.resolve(process.cwd(), relFile);
      const baseName = path.basename(relFile);
      return fs.existsSync(abs) && junitXml.includes(baseName);
    });
  const intStatusValid =
    !intReport?.status || intReport.status === "EXECUTED" || intReport.status === "PASS";
  const intExecProofValid =
    !intReport?.executionProof ||
    (typeof intReport.executionProof.pid === "number" &&
      intReport.executionProof.pid > 0 &&
      intReport.executionProof.exitCode === 0 &&
      intReport.executionProof.jsonReportExists !== false &&
      (!preFlight?.headSha ||
        !intReport.executionProof.sourceSha ||
        intReport.executionProof.sourceSha === preFlight.headSha));
  const intShaValid =
    !intReport?.testedSourceSha ||
    !preFlight?.headSha ||
    intReport.testedSourceSha === preFlight.headSha;
  const intSkippedValid =
    intReport?.skippedTests === undefined || intReport.skippedTests === 0;

  const intReportOk = Boolean(
    intReport &&
      intStatusValid &&
      intExecProofValid &&
      intShaValid &&
      intSkippedValid &&
      intFilesExistAndInJunit &&
      typeof intReport.totalTests === "number" &&
      intReport.totalTests >= 10 &&
      intReport.passedTests === intReport.totalTests &&
      intReport.failedTests === 0
  );
  addCheck(
    "CHK_06_INTEGRATION_SUITE_REPORT",
    "INTEGRATION_SUITE_REPORT has verified child execution proof, >= 2 existing integration test files in JUNIT_RESULTS.xml, and >= 10 passing tests",
    intReportOk,
    !intReportOk ? "Integration suite report missing execution proof, files on disk/JUnit, or has failing/skipped tests" : undefined
  );

  // 7. Deep JUnit XML validation
  const junitOk = Boolean(
    junitMetrics.validXml &&
      junitMetrics.testcaseCount >= 400 &&
      junitMetrics.totalTestsAttr === junitMetrics.testcaseCount &&
      junitMetrics.totalFailuresAttr === 0 &&
      junitMetrics.totalErrorsAttr === 0 &&
      junitMetrics.failureTagCount === 0 &&
      junitMetrics.errorTagCount === 0 &&
      (!truthTable || junitMetrics.testcaseCount === truthTable.totalRawTestExecutions)
  );
  addCheck(
    "CHK_07_JUNIT_XML_DEEP_VALID",
    "JUNIT_RESULTS.xml has >= 400 testcases, matches truthTable.totalRawTestExecutions, and has 0 failure/error tags",
    junitOk,
    !junitOk
      ? `JUnit XML invalid: testcases=${junitMetrics.testcaseCount}, failuresAttr=${junitMetrics.totalFailuresAttr}, failureTags=${junitMetrics.failureTagCount}`
      : undefined
  );

  // 8. Next Build Log & Execution Proof (Phase 4)
  const buildLog = safeReadText(path.join(acceptanceDir, "NEXT_BUILD_LOG.txt")) || "";
  const buildProof = safeReadJson(path.join(acceptanceDir, "NEXT_BUILD_EXECUTION_PROOF.json"));
  const buildProofOk =
    !buildProof ||
    (buildProof.status === "BUILD_PASS" &&
      buildProof.exitCode === 0 &&
      typeof buildProof.pid === "number" &&
      buildProof.pid > 0 &&
      buildProof.buildIdFreshlyUpdated === true &&
      buildProof.allowServerAndChromiumLaunch === true);
  const buildLogOk =
    buildProofOk &&
    buildLog.length > 100 &&
    (buildLog.includes("Compiled successfully") ||
      buildLog.includes("Route (app)") ||
      buildLog.includes("Generating static pages")) &&
    !buildLog.includes("Build error occurred") &&
    !buildLog.includes("Failed to compile");
  addCheck(
    "CHK_08_NEXT_BUILD_LOG",
    "NEXT_BUILD_LOG.txt and NEXT_BUILD_EXECUTION_PROOF.json prove a fresh successful production build without compile errors",
    buildLogOk,
    !buildLogOk ? "NEXT_BUILD_LOG.txt or NEXT_BUILD_EXECUTION_PROOF.json missing build success/fresh BUILD_ID proof" : undefined
  );

  // 9. Chromium Execution & Failure Injection Reports
  const chromiumExec = safeReadJson(path.join(acceptanceDir, "CHROMIUM_EXECUTION_REPORT.json"));
  const chromiumInject = safeReadJson(path.join(acceptanceDir, "CHROMIUM_FAILURE_INJECTION_TESTS.json"));
  const chromiumOk = Boolean(
    chromiumExec &&
      chromiumExec.executed === true &&
      chromiumExec.browserLaunched === true &&
      chromiumExec.serverReady === true &&
      chromiumExec.pageNavigationSucceeded === true &&
      chromiumExec.pageLoaded !== false &&
      (chromiumExec.mainDocumentHttpStatus === undefined ||
        (typeof chromiumExec.mainDocumentHttpStatus === "number" &&
          chromiumExec.mainDocumentHttpStatus >= 200 &&
          chromiumExec.mainDocumentHttpStatus < 400)) &&
      typeof chromiumExec.actualAssertionCount === "number" &&
      chromiumExec.actualAssertionCount >= 4 &&
      Array.isArray(chromiumExec.assertionFailures) &&
      chromiumExec.assertionFailures.length === 0 &&
      chromiumExec.status === "PASS" &&
      chromiumInject &&
      chromiumInject.passed === true &&
      chromiumInject.totalInjections >= 11 &&
      chromiumInject.totalCaught === chromiumInject.totalInjections
  );
  addCheck(
    "CHK_09_CHROMIUM_EXECUTION_AND_INJECTION",
    "CHROMIUM_EXECUTION_REPORT and CHROMIUM_FAILURE_INJECTION_TESTS (11 scenarios) both pass",
    chromiumOk,
    !chromiumOk ? "Chromium execution failed or failure injection suite did not catch all 11 scenarios" : undefined
  );

  // 10. SQLite / HTTP / Chromium Three-Way Parity (Phase 4.4)
  const parity = safeReadJson(path.join(acceptanceDir, "SQLITE_HTTP_CHROMIUM_PARITY.json"));
  const fieldComps: any[] = Array.isArray(parity?.fieldComparisons) ? parity.fieldComparisons : [];
  const allFieldCompsMatchValues =
    fieldComps.length > 0 &&
    fieldComps.every(
      (fc: any) =>
        fc.verdict === "PASS" &&
        fc.expectedNormalizedValue !== null &&
        fc.expectedNormalizedValue !== undefined &&
        fc.observedNormalizedValue !== null &&
        fc.observedNormalizedValue !== undefined &&
        fc.expectedNormalizedValue === fc.observedNormalizedValue &&
        ((fc.pair === "DB_VS_HTTP" && fc.presentDb === true && fc.presentHttp === true) ||
          (fc.pair === "DB_VS_DOM" && fc.presentDb === true && fc.presentDom === true) ||
          (fc.pair === "HTTP_VS_DOM" && fc.presentHttp === true && fc.presentDom === true))
    );
  const hasRequiredParityFields =
    fieldComps.some((fc: any) => fc.pair === "DB_VS_HTTP" && fc.field === "candidateId") &&
    fieldComps.some((fc: any) => fc.pair === "DB_VS_HTTP" && fc.field === "storeDomain") &&
    fieldComps.some((fc: any) => fc.pair === "DB_VS_HTTP" && fc.field === "identityStatus") &&
    fieldComps.some((fc: any) => fc.pair === "DB_VS_DOM" && fc.field === "title") &&
    fieldComps.some((fc: any) => fc.pair === "DB_VS_DOM" && fc.field === "rank") &&
    fieldComps.some((fc: any) => fc.pair === "HTTP_VS_DOM" && fc.field === "title");

  const parityOk = Boolean(
    parity &&
      parity.persistedFromSqliteVerified === true &&
      parity.dbVsHttpVerdict === "PASS" &&
      parity.dbVsDomVerdict === "PASS" &&
      parity.httpVsDomVerdict === "PASS" &&
      parity.sameRunReconciliationPassed === true &&
      parity.httpApiParityPassed === true &&
      parity.chromiumParityPassed === true &&
      typeof parity.comparedCandidateCount === "number" &&
      parity.comparedCandidateCount > 0 &&
      typeof parity.comparedHttpFieldCount === "number" &&
      parity.comparedHttpFieldCount >= 4 &&
      typeof parity.comparedDomFieldCount === "number" &&
      parity.comparedDomFieldCount >= 4 &&
      Array.isArray(parity.fieldDiscrepancies) &&
      parity.fieldDiscrepancies.length === 0 &&
      allFieldCompsMatchValues &&
      hasRequiredParityFields
  );
  addCheck(
    "CHK_10_SQLITE_HTTP_CHROMIUM_PARITY",
    "SQLITE_HTTP_CHROMIUM_PARITY proves persisted SQLite, HTTP API, and Chromium DOM three-way field parity",
    parityOk,
    !parityOk ? "Parity check failed, missing persisted SQLite proof, comparedDomFieldCount < 4, or field comparison mismatch" : undefined
  );

  // 10B. Read-Only DB Content Integrity & Real HTTP Transport Proof (Phase 1 & 4.4)
  const readOnly = safeReadJson(path.join(acceptanceDir, "READ_ONLY_DB_CONTENT_INTEGRITY.json"));
  const beforeDigests = readOnly?.beforeSnapshot?.tableDigests;
  const afterDigests = readOnly?.afterSnapshot?.tableDigests;
  const requiredTables = ["syncJob", "researchProduct", "competitorStore", "adProductLink", "evergreenProductScore"];
  const digestsEqual =
    Boolean(beforeDigests && afterDigests) &&
    requiredTables.every(
      (t) =>
        beforeDigests[t] &&
        afterDigests[t] &&
        typeof beforeDigests[t].sha256Digest === "string" &&
        beforeDigests[t].sha256Digest.length === 64 &&
        beforeDigests[t].rowCount === afterDigests[t].rowCount &&
        beforeDigests[t].sha256Digest === afterDigests[t].sha256Digest
    );
  const readOnlyScopeValid =
    readOnly?.verificationScope !== "DB_ONLY_READ_SNAPSHOT" &&
    readOnly?.verificationScope !== "SYNTHETIC_CALLBACK_REJECTED" &&
    readOnly?.verificationScope !== "HTTP_PROBE_FAILED" &&
    readOnly?.status !== "HTTP_NOT_EXECUTED" &&
    (readOnly?.actualHttpRequestCount === undefined || readOnly.actualHttpRequestCount >= 1) &&
    (readOnly?.responseBodyDigest === undefined ||
      (typeof readOnly.responseBodyDigest === "string" &&
        readOnly.responseBodyDigest.length === 64));

  const readOnlyOk = Boolean(
    readOnly &&
      readOnlyScopeValid &&
      readOnly.readOnlyPassed === true &&
      readOnly.httpRequestVerified === true &&
      readOnly.httpStatusCode === 200 &&
      readOnly.contentDigestsMatch === true &&
      readOnly.rowCountsMatch === true &&
      readOnly.mutationsDetected === false &&
      Array.isArray(readOnly.mutatedTables) &&
      readOnly.mutatedTables.length === 0 &&
      digestsEqual
  );
  addCheck(
    "CHK_10B_READ_ONLY_DB_CONTENT_INTEGRITY",
    "READ_ONLY_DB_CONTENT_INTEGRITY verifies real HTTP 200 GET transport proof and identical SHA-256 table content digests before and after",
    readOnlyOk,
    !readOnlyOk ? "Read-only DB content digest mismatch, HTTP not executed/synthetic callback, HTTP status != 200, or mutationsDetected" : undefined
  );

  // 11. Google MCP Creative Pipeline Set Reconciliation & Explicit Live Provenance (Phase 3)
  const gRaw = safeReadJson(path.join(acceptanceDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json"));
  const gNorm =
    safeReadJson(path.join(acceptanceDir, "GOOGLE_NORMALIZATION_LEDGER.json")) ||
    safeReadJson(path.join(acceptanceDir, "GOOGLE_NORMALIZATION_AND_REJECTION_LEDGER.json"));
  const gAssoc = safeReadJson(path.join(acceptanceDir, "GOOGLE_CREATIVE_ASSOCIATION_LEDGER.json"));
  const gAssocProof = safeReadJson(path.join(acceptanceDir, "GOOGLE_PRODUCT_ASSOCIATION_PROOF.json"));
  const g06Eval = safeReadJson(path.join(acceptanceDir, "G06_GATE_EVALUATION.json"));
  const gLineageMatrix = safeReadJson(path.join(acceptanceDir, "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json"));

  const rawCreativesList: any[] = Array.isArray(gRaw?.creatives) ? gRaw.creatives : [];
  const hasSyntheticGoogleIds = rawCreativesList.some((c: any) => {
    const cid = String(c?.creativeId ?? c?.creative_id ?? c?.id ?? "").trim();
    const provReqId =
      typeof c?.providerRequestId === "string" ? c.providerRequestId.trim() : null;
    const mcpInvRef =
      typeof c?.mcpInvocationRef === "string" ? c.mcpInvocationRef.trim() : null;
    const reqId = String(provReqId ?? mcpInvRef ?? "").trim();
    const runId = String(gRaw?.researchRunId ?? "").trim();
    const declaredOrigin = c?.providerRequestIdOrigin;
    return (
      /^cr_\d+$/.test(cid) ||
      /^google_cr_.*_\d+$/i.test(cid) ||
      /^(?:mcp_|synthetic_|fake_)/i.test(reqId) ||
      (provReqId !== null &&
        provReqId !== "" &&
        (/^(?:google_mcp_|local_)/i.test(provReqId) ||
          (mcpInvRef !== null && provReqId === mcpInvRef))) ||
      (declaredOrigin === "UPSTREAM" && (!provReqId || provReqId === "")) ||
      (declaredOrigin === "ABSENT" && provReqId !== null && provReqId !== "") ||
      (runId && reqId === `mcp_${runId}`)
    );
  });

  // Validate GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json when present
  let lineageMatrixValid = true;
  if (gLineageMatrix && typeof gLineageMatrix === "object") {
    const matrixEntries: any[] = Array.isArray(gLineageMatrix.entries)
      ? gLineageMatrix.entries
      : Array.isArray(gLineageMatrix.creativeLineageMatrix)
      ? gLineageMatrix.creativeLineageMatrix
      : [];
    const invLedger: any[] = Array.isArray(gLineageMatrix.invocationLedger)
      ? gLineageMatrix.invocationLedger
      : [];
    const targetRunId = String(gLineageMatrix.researchRunId || gRaw?.researchRunId || "").trim();

    for (const entry of matrixEntries) {
      const eOrigin = entry?.providerRequestIdOrigin;
      const eReqId = entry?.providerRequestId ?? null;
      const eMcpRef = entry?.mcpInvocationRef ?? null;
      const eMethod = entry?.lineageMethod;

      if (eOrigin === "UPSTREAM" && (!eReqId || /^(?:google_mcp_|mcp_|local_|synthetic_|fake_)/i.test(String(eReqId)))) {
        lineageMatrixValid = false;
      }
      if (eOrigin === "ABSENT" && eReqId !== null) {
        lineageMatrixValid = false;
      }
      if (eReqId && eMcpRef && eReqId === eMcpRef) {
        lineageMatrixValid = false;
      }
      if (eMethod === "VERIFIED_LOCAL_INVOCATION_ONLY") {
        if (eReqId !== null || eOrigin !== "ABSENT" || !eMcpRef || !entry?.responseEvidenceHash) {
          lineageMatrixValid = false;
        }
        if (invLedger.length > 0) {
          const matchedInv = invLedger.find(
            (inv: any) =>
              (inv?.mcpInvocationRef === eMcpRef || inv?.invocationId === eMcpRef) &&
              inv?.status === "SUCCEEDED"
          );
          const returnedIds: string[] = Array.isArray(matchedInv?.returnedCreativeIds)
            ? matchedInv.returnedCreativeIds
            : Array.isArray(matchedInv?.actualReturnedCreativeIds)
            ? matchedInv.actualReturnedCreativeIds
            : [];
          if (
            !matchedInv ||
            matchedInv.researchRunId !== targetRunId ||
            matchedInv.responseEvidenceHash !== entry.responseEvidenceHash ||
            !returnedIds.includes(entry.creativeId)
          ) {
            lineageMatrixValid = false;
          }
        }
      }
    }
    if (
      g06Eval?.overallG06Verdict === "PASS" &&
      typeof gLineageMatrix.rejectedUnverifiedLineageCount === "number" &&
      gLineageMatrix.rejectedUnverifiedLineageCount > 0
    ) {
      lineageMatrixValid = false;
    }
  }

  const explicitLiveCreatives = rawCreativesList.filter((c: any) => {
    if (!c || c.isCached !== false) return false;
    const cid = String(c.creativeId ?? c.creative_id ?? c.id ?? "").trim();
    const reqId = String(c.providerRequestId ?? c.mcpInvocationRef ?? "").trim();
    if (!cid || /^cr_\d+$/.test(cid) || /^google_cr_.*_\d+$/i.test(cid)) return false;
    if (!reqId || /^(?:mcp_|synthetic_|fake_)/i.test(reqId)) return false;
    return (
      (c.sourceMode === "LIVE_PROVIDER" ||
        c.provenance === "LIVE_PROVIDER" ||
        c.provenance === "REAL_UPSTREAM") &&
      Boolean(c.researchRunId)
    );
  });

  const setRec = g06Eval?.setReconciliation;
  const setRecValid = Boolean(
    setRec &&
      setRec.setInvariantPassed === true &&
      Array.isArray(setRec.unaccountedRawCreativeIds) &&
      setRec.unaccountedRawCreativeIds.length === 0 &&
      Array.isArray(setRec.unknownNormalizedCreativeIds) &&
      setRec.unknownNormalizedCreativeIds.length === 0 &&
      Array.isArray(setRec.unknownRejectedCreativeIds) &&
      setRec.unknownRejectedCreativeIds.length === 0 &&
      Array.isArray(setRec.unknownAssociationCreativeIds) &&
      setRec.unknownAssociationCreativeIds.length === 0 &&
      Array.isArray(setRec.unknownAssociationCandidateIds) &&
      setRec.unknownAssociationCandidateIds.length === 0
  );

  const exactSkuConsistency =
    g06Eval &&
    ((g06Eval.exactProductSkuMatchesCount > 0 &&
      g06Eval.subGates?.GOOGLE_EXACT_PRODUCT_EVIDENCE === "PASS") ||
      (g06Eval.exactProductSkuMatchesCount === 0 &&
        g06Eval.subGates?.GOOGLE_EXACT_PRODUCT_EVIDENCE === "INSUFFICIENT_EVIDENCE"));

  const normStageExecutedValid = gNorm?.normalizationStageExecuted !== false;
  const replayModeHonest =
    g06Eval?.replayModeDetected !== true || g06Eval?.overallG06Verdict !== "PASS";

  const googlePipelineOk = Boolean(
    gRaw &&
      gNorm &&
      (gAssoc || gAssocProof) &&
      gAssocProof &&
      g06Eval &&
      normStageExecutedValid &&
      replayModeHonest &&
      !hasSyntheticGoogleIds &&
      lineageMatrixValid &&
      typeof gRaw.rawCount === "number" &&
      gRaw.rawCount === rawCreativesList.length &&
      gRaw.rawCount === (gNorm.normalizedDistinctCount || 0) + (gNorm.rejectedBeforeNormalizationCount || 0) &&
      g06Eval.pipelineInvariantPassed === true &&
      setRecValid &&
      g06Eval.liveCreativesRetrievedCount === explicitLiveCreatives.length &&
      (g06Eval.overallG06Verdict !== "PASS" || explicitLiveCreatives.length > 0) &&
      exactSkuConsistency
  );
  addCheck(
    "CHK_11_GOOGLE_CREATIVE_PIPELINE",
    "Google MCP raw, normalized, and association ledgers satisfy set-based ID reconciliation, explicit live provenance, non-synthetic IDs, and exact-match honesty",
    googlePipelineOk,
    !googlePipelineOk ? "Google creative pipeline set reconciliation failed, synthetic/cached creative counted live, normalization skipped, or false exact SKU claim" : undefined
  );

  // 12. G15 Product Demand Proof (Phase 5.4)
  const g15 = safeReadJson(path.join(acceptanceDir, "G15_PRODUCT_DEMAND_PROOF.json"));
  const g15EntriesList: any[] = Array.isArray(g15?.entries) ? g15.entries : [];
  const hasInvalidG15Entry = g15EntriesList.some(
    (e: any) =>
      e.queryStatus === "DB_QUERY_FAILED" ||
      e.queryMode === "SUBSTRING_FALLBACK" ||
      (e.g15Qualifying === true && e.hasLongitudinalDemand !== true)
  );
  const recomputedG15Qualifying = g15EntriesList.filter(
    (e: any) =>
      e.g15Qualifying === true &&
      e.hasLongitudinalDemand === true &&
      e.queryStatus !== "DB_QUERY_FAILED" &&
      e.queryMode !== "SUBSTRING_FALLBACK" &&
      (e.coveredDays ?? 0) >= 60
  ).length;
  const g15Ok = Boolean(
    g15 &&
      Array.isArray(g15.entries) &&
      !hasInvalidG15Entry &&
      typeof g15.g15QualifyingCount === "number" &&
      (g15EntriesList.length === 0 || g15.g15QualifyingCount === recomputedG15Qualifying) &&
      ((g15.g15QualifyingCount >= 3 && g15.g15Verdict === "PASS") ||
        (g15.g15QualifyingCount < 3 && g15.g15Verdict === "INSUFFICIENT_EVIDENCE"))
  );
  addCheck(
    "CHK_12_G15_HONESTY",
    "G15_PRODUCT_DEMAND_PROOF rejects DB_QUERY_FAILED/SUBSTRING_FALLBACK and truthfully reports INSUFFICIENT_EVIDENCE when < 3 candidates have >= 60d demand",
    g15Ok,
    !g15Ok ? "G15 verdict inconsistent with g15QualifyingCount or contains DB_QUERY_FAILED/SUBSTRING_FALLBACK" : undefined
  );

  // 13. G16 Current Run Verified Proof (Phase 4.5)
  const g16 = safeReadJson(path.join(acceptanceDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json"));
  const g16Entries: any[] = Array.isArray(g16?.entries) ? g16.entries : [];
  const recomputedVerifiedEntries = g16Entries.filter(
    (e: any) =>
      e.isLiveVerified === true &&
      e.identityStatus === "VERIFIED" &&
      e.isCheckoutChampFunnel === false &&
      e.merchantVerified === true &&
      Array.isArray(e.merchantProofRefs) &&
      e.merchantProofRefs.length > 0 &&
      typeof e.validLineageObservationsCount === "number" &&
      e.validLineageObservationsCount > 0 &&
      Array.isArray(e.liveObservationIds) &&
      e.liveObservationIds.length === e.validLineageObservationsCount &&
      e.predicateResults?.authenticallyLive === true &&
      e.predicateResults?.sameRunLineage === true &&
      e.predicateResults?.candidateProductMatch === true &&
      e.predicateResults?.verifiedMerchantIdentity === true &&
      e.predicateResults?.nonFunnelStore === true
  );
  const anyInvalidLiveClaim = g16Entries.some(
    (e: any) => e.isLiveVerified === true && !recomputedVerifiedEntries.includes(e)
  );
  const reqCount = g16?.requiredCount ?? 3;
  const reqFamilies = g16?.requireDistinctFamilies !== false;
  const expectedG16Verdict =
    !anyInvalidLiveClaim &&
    recomputedVerifiedEntries.length >= reqCount &&
    (g16?.distinctCanonicalProductsCount ?? 0) >= reqCount &&
    (!reqFamilies || (g16?.distinctFamiliesCount ?? 0) >= reqCount)
      ? "PASS"
      : "INSUFFICIENT_EVIDENCE";

  const g16Ok = Boolean(
    g16 &&
      !anyInvalidLiveClaim &&
      g16.verifiedLiveCount === recomputedVerifiedEntries.length &&
      g16.g16Verdict === expectedG16Verdict
  );
  addCheck(
    "CHK_13_G16_HONESTY",
    "G16_CURRENT_RUN_VERIFIED_PROOF enforces liveObservationIds, same-run lineage, merchantProofRefs, and Top-3 family/product distinctness",
    g16Ok,
    !g16Ok ? "G16 entry claimed isLiveVerified without liveObservationIds/merchantProofRefs/sameRunLineage or verdict violated distinctness" : undefined
  );

  // 14. Historical Backtest & Point-in-Time Audit (Phase 5.5)
  const devBt = safeReadJson(path.join(acceptanceDir, "REAL_HISTORICAL_DEV_BACKTEST.json"));
  const holdoutBt = safeReadJson(path.join(acceptanceDir, "REAL_HISTORICAL_HOLDOUT_BACKTEST.json"));
  const pitAudit = safeReadJson(path.join(acceptanceDir, "HISTORICAL_POINT_IN_TIME_AUDIT.json"));
  const btOk = Boolean(
    devBt &&
      holdoutBt &&
      pitAudit &&
      devBt.futureLeakageDetected === false &&
      holdoutBt.futureLeakageDetected === false &&
      pitAudit.temporalSeparationStrict === true &&
      pitAudit.futureDataLeakageDetected === false &&
      pitAudit.pointInTimeIntegrityVerdict === "PASS" &&
      pitAudit.joinedMetadataLeakagePrevented !== false
  );
  addCheck(
    "CHK_14_HISTORICAL_BACKTEST_INTEGRITY",
    "Historical DEV and HOLDOUT backtest artifacts verify strict temporal separation and zero future/joined metadata leakage",
    btOk,
    !btOk ? "Historical backtest missing or future/joined metadata leakage detected" : undefined
  );

  // 15. No placeholder tokens in final decision markdown
  const decisionMd =
    safeReadText(path.join(acceptanceDir, "FINAL_RELEASE_DECISION_V12_4_3_4_6.md")) ||
    safeReadText(path.join(acceptanceDir, "FINAL_RELEASE_DECISION_V12_4_3_4_5.md")) ||
    "";
  const hasPlaceholders = /\b(TODO|TBD|PLACEHOLDER|MOCK_PASS|FAKE_PASS)\b/.test(decisionMd);
  const decisionOk =
    decisionMd.length > 200 &&
    !hasPlaceholders &&
    decisionMd.includes("overallEngineeringVerdict") &&
    decisionMd.includes("overallBusinessVerdict");
  addCheck(
    "CHK_15_FINAL_DECISION_MARKDOWN",
    "FINAL_RELEASE_DECISION_V12_4_3_4_6.md is complete and contains zero placeholder tokens",
    decisionOk,
    !decisionOk ? "Final release decision markdown missing or contains placeholder tokens" : undefined
  );

  // 16. Recomputed Gate Matrix Consistency (Phase 4.1 — replaces hardcoded threshold count)
  const gateMatrix =
    safeReadJson(path.join(acceptanceDir, "GATE_TRUTH_MATRIX_V12_4_3_4_6.json")) ||
    safeReadJson(path.join(acceptanceDir, "GATE_TRUTH_MATRIX_V12_4_3_4_5.json"));
  const gatesObj = gateMatrix?.gates && typeof gateMatrix.gates === "object" ? gateMatrix.gates : null;

  let matrixConsistent = false;
  let matrixFailureReason = "Gate truth matrix missing";

  if (gateMatrix && gatesObj) {
    const businessGateKeys = new Set(["G07", "G15", "G16", "G25", "G26", "GOOGLE_EXACT_PRODUCT_EVIDENCE"]);
    const gateEntries = Object.entries(gatesObj) as Array<[string, any]>;

    // Verify key evidence-backed gates match raw artifacts
    const expectedG06 = g06Eval?.overallG06Verdict || "FAIL";
    const expectedG15 = g15?.g15Verdict || "INSUFFICIENT_EVIDENCE";
    const expectedG16 = g16?.g16Verdict || "INSUFFICIENT_EVIDENCE";
    const expectedG18 = chromiumOk ? "PASS" : "FAIL";
    const expectedG19 = parityOk ? "PASS" : "FAIL";
    const expectedG20 = readOnlyOk ? "PASS" : "FAIL";
    const expectedG21 = truthTableOk && junitOk && intReportOk ? "PASS" : "FAIL";
    const expectedG23 = safetyOk ? "PASS" : "FAIL";
    const expectedG24 = barrierOk ? "PASS" : "FAIL";
    const expectedG25 =
      devBt?.demandCoverageStatus === "AUTHORITATIVE_DEMAND_CONFIRMED"
        ? "PASS"
        : "INSUFFICIENT_EVIDENCE";
    const expectedG26 =
      holdoutBt?.demandCoverageStatus === "AUTHORITATIVE_DEMAND_CONFIRMED"
        ? "PASS"
        : "INSUFFICIENT_EVIDENCE";

    const rawEvidenceGateChecks: Array<[string, string]> = [
      ["G06", expectedG06],
      ["G15", expectedG15],
      ["G16", expectedG16],
      ["G18", expectedG18],
      ["G19", expectedG19],
      ["G20", expectedG20],
      ["G21", expectedG21],
      ["G23", expectedG23],
      ["G24", expectedG24],
      ["G25", expectedG25],
      ["G26", expectedG26],
    ];

    const mismatchedEvidenceGates: string[] = [];
    for (const [gKey, expStatus] of rawEvidenceGateChecks) {
      const reportedStatus = gatesObj[gKey]?.status;
      if (reportedStatus !== expStatus) {
        mismatchedEvidenceGates.push(`${gKey}(reported=${reportedStatus}, expected=${expStatus})`);
      }
    }

    // Phase 5: Reject any gate claiming PASS if executionProofMissing===true or testedSourceSha mismatches preFlight.headSha
    for (const [gKey, gObj] of gateEntries) {
      if (gObj?.status === "PASS") {
        if (gObj.executionProofMissing === true || gObj.executionId === null) {
          mismatchedEvidenceGates.push(`${gKey}(claimed PASS with missing execution proof)`);
        }
        if (
          gObj.testedSourceSha &&
          preFlight?.headSha &&
          gObj.testedSourceSha !== preFlight.headSha
        ) {
          mismatchedEvidenceGates.push(
            `${gKey}(testedSourceSha=${gObj.testedSourceSha} != headSha=${preFlight.headSha})`
          );
        }
      }
    }

    // Every non-business gate in gatesObj is a mandatory engineering gate
    const failedEngineeringGates = gateEntries
      .filter(([k]) => !businessGateKeys.has(k))
      .filter(([_, g]) => g?.status !== "PASS")
      .map(([k, g]) => `${k}:${g?.status}`);

    const recomputedEngVerdict =
      failedEngineeringGates.length === 0 && mismatchedEvidenceGates.length === 0
        ? "PASS"
        : "FAIL";

    const allBusinessPassed =
      expectedG15 === "PASS" &&
      expectedG16 === "PASS" &&
      expectedG25 === "PASS" &&
      expectedG26 === "PASS";
    const recomputedBizVerdict = allBusinessPassed ? "PASS" : "INSUFFICIENT_EVIDENCE";

    if (mismatchedEvidenceGates.length > 0) {
      matrixConsistent = false;
      matrixFailureReason = `Gate matrix contradicts raw evidence on: ${mismatchedEvidenceGates.join(", ")}`;
    } else if (gateMatrix.overallEngineeringVerdict !== recomputedEngVerdict) {
      matrixConsistent = false;
      matrixFailureReason = `overallEngineeringVerdict '${gateMatrix.overallEngineeringVerdict}' contradicts recomputed '${recomputedEngVerdict}' (failedEngGates=${failedEngineeringGates.join(",")})`;
    } else if (gateMatrix.overallBusinessVerdict !== recomputedBizVerdict) {
      matrixConsistent = false;
      matrixFailureReason = `overallBusinessVerdict '${gateMatrix.overallBusinessVerdict}' contradicts recomputed '${recomputedBizVerdict}'`;
    } else {
      matrixConsistent = true;
    }
  }

  addCheck(
    "CHK_16_GATE_MATRIX_DYNAMICS",
    "GATE_TRUTH_MATRIX_V12_4_3_4_6 matches recomputed engineering and business verdicts from raw artifacts without masking any gate failure",
    matrixConsistent,
    !matrixConsistent ? matrixFailureReason : undefined
  );

  // 17. Safe Disk Recovery Audit & Resource Wave Guards (V12.4.3.4.9 P1)
  const safeDiskAudit = safeReadJson(path.join(acceptanceDir, "SAFE_DISK_RECOVERY_AUDIT.json"));
  const resourceGuards = safeReadJson(path.join(acceptanceDir, "RESOURCE_WAVE_GUARDS.json"));
  if (safeDiskAudit !== null || acceptanceDir.includes("12.4.3.4.9")) {
    const hasLegacyStaticConstants =
      safeDiskAudit?.beforeFreeDiskGB === 8.71 ||
      safeDiskAudit?.beforeFreeDiskBytes === 9357185024 ||
      safeDiskAudit?.reclaimedBytes === 226365440 ||
      safeDiskAudit?.reclaimedGB === 0.22;

    const cleanedTargets: any[] = Array.isArray(safeDiskAudit?.cleanedTargets)
      ? safeDiskAudit.cleanedTargets
      : [];
    const actionsAttempted: any[] = Array.isArray(safeDiskAudit?.actionsAttempted)
      ? safeDiskAudit.actionsAttempted
      : [];
    const actionsSucceeded: any[] = Array.isArray(safeDiskAudit?.actionsSucceeded)
      ? safeDiskAudit.actionsSucceeded
      : [];
    const actionsFailed: any[] = Array.isArray(safeDiskAudit?.actionsFailed)
      ? safeDiskAudit.actionsFailed
      : [];
    const protectedPathsList: any[] = Array.isArray(safeDiskAudit?.protectedPathsVerifiedPresent)
      ? safeDiskAudit.protectedPathsVerifiedPresent
      : [];

    const sumRemovedTargets = cleanedTargets.reduce(
      (acc, t) => acc + (typeof t?.bytesRemoved === "number" ? t.bytesRemoved : 0),
      0
    );
    const sumRemovedActions = actionsSucceeded.reduce(
      (acc, a) => acc + (typeof a?.measuredBytesRemoved === "number" ? a.measuredBytesRemoved : 0),
      0
    );

    const protectedRuleBroken =
      protectedPathsList.length === 0 ||
      protectedPathsList.some(
        (p: any) =>
          p?.untouched !== true ||
          (p?.path !== "data/google_trends_csv" && p?.exists !== true)
      ) ||
      cleanedTargets.some((t: any) => {
        const rel = String(t?.path || "");
        return (
          t?.ownershipVerified !== true ||
          rel === "dev.db" ||
          rel === "node_modules" ||
          rel === ".git" ||
          rel.startsWith("acceptance") ||
          rel.startsWith("data/google_trends_csv")
        );
      });

    const cleanupAccountingConsistent =
      safeDiskAudit?.cleanupAttempted === false
        ? cleanedTargets.length === 0 &&
          actionsAttempted.length === 0 &&
          actionsSucceeded.length === 0 &&
          actionsFailed.length === 0 &&
          safeDiskAudit?.totalVerifiedRemovedBytes === 0 &&
          safeDiskAudit?.reclaimedBytes === 0
        : safeDiskAudit?.cleanupAttempted === true &&
          typeof safeDiskAudit?.totalVerifiedRemovedBytes === "number" &&
          safeDiskAudit.totalVerifiedRemovedBytes === sumRemovedTargets &&
          safeDiskAudit.totalVerifiedRemovedBytes === sumRemovedActions &&
          safeDiskAudit.reclaimedBytes === safeDiskAudit.totalVerifiedRemovedBytes;

    const guardsValid =
      !resourceGuards ||
      (resourceGuards.heavyWavesUnblocked === true &&
        Array.isArray(resourceGuards.waveGuards) &&
        resourceGuards.waveGuards.length >= 5 &&
        resourceGuards.waveGuards.every((wg: any) => wg?.allowed === true));

    const diskAuditOk = Boolean(
      safeDiskAudit &&
        !hasLegacyStaticConstants &&
        safeDiskAudit.measurementStatus === "MEASURED" &&
        typeof safeDiskAudit.beforeMeasuredAt === "string" &&
        typeof safeDiskAudit.afterMeasuredAt === "string" &&
        typeof safeDiskAudit.beforeFreeBytes === "number" &&
        safeDiskAudit.beforeFreeBytes > 0 &&
        typeof safeDiskAudit.afterFreeBytes === "number" &&
        safeDiskAudit.afterFreeBytes > 0 &&
        typeof safeDiskAudit.afterFreeDiskGB === "number" &&
        safeDiskAudit.afterFreeDiskGB >= (safeDiskAudit.requiredFreeDiskGB ?? 15) &&
        safeDiskAudit.heavyWavesUnblocked === true &&
        safeDiskAudit.guardStatus === "PASS_HEADROOM_SUFFICIENT" &&
        !protectedRuleBroken &&
        cleanupAccountingConsistent &&
        guardsValid
    );

    addCheck(
      "CHK_17_SAFE_DISK_RECOVERY_AUDIT",
      "SAFE_DISK_RECOVERY_AUDIT and RESOURCE_WAVE_GUARDS record authentic live statfs measurements, zero static legacy constants, verified cleanup accounting, and untouched protected paths",
      diskAuditOk,
      !diskAuditOk
        ? "SAFE_DISK_RECOVERY_AUDIT has legacy hardcoded constants, inconsistent cleanup accounting, touched protected path, or failed headroom guard"
        : undefined
    );
  }

  // 18. CLI Exit Decision & Subprocess Proof Consistency (V12.4.3.4.9 P0)
  if (!options?.skipCliExitDecisionCheck) {
    const cliDecision = safeReadJson(path.join(acceptanceDir, "CLI_EXIT_DECISION.json"));
    const cliExitProof = safeReadJson(
      path.join(acceptanceDir, "CLI_POSITIVE_AND_FAILURE_EXIT_PROOF.json")
    );
    if (cliDecision !== null || cliExitProof !== null || acceptanceDir.includes("12.4.3.4.9")) {
      const coreChecksPassed = checks.every((c) => c.passed);
      const expectedZeroExit =
        coreChecksPassed &&
        matrixConsistent &&
        gateMatrix?.overallEngineeringVerdict === "PASS";

      const shaMatchesDecision =
        !preFlight?.headSha || cliDecision?.testedSourceSha === preFlight.headSha;
      const decisionMatchesVerdict = expectedZeroExit
        ? cliDecision?.exitCode === 0 &&
          cliDecision?.exitCategory === "ENGINEERING_ACCEPTED" &&
          cliDecision?.engineeringAccepted === true &&
          cliDecision?.validatorAccepted === true &&
          cliDecision?.completionBarrierAccepted === true &&
          cliDecision?.sourceShaConsistent === true
        : typeof cliDecision?.exitCode === "number" &&
          cliDecision.exitCode !== 0 &&
          !(cliDecision.engineeringAccepted === true && cliDecision.validatorAccepted === true);

      const bizVerdictMatches =
        !gateMatrix?.overallBusinessVerdict ||
        cliDecision?.businessVerdict === gateMatrix.overallBusinessVerdict;

      const subprocessProofOk =
        !cliExitProof && !acceptanceDir.includes("12.4.3.4.9")
          ? true
          : Boolean(
              cliExitProof &&
                cliExitProof.suiteVerdict === "PASS" &&
                cliExitProof.positiveCase &&
                typeof cliExitProof.positiveCase.pid === "number" &&
                cliExitProof.positiveCase.pid > 0 &&
                cliExitProof.positiveCase.actualExitCode === 0 &&
                cliExitProof.positiveCase.passed === true &&
                Array.isArray(cliExitProof.failureCases) &&
                cliExitProof.failureCases.length >= 3 &&
                cliExitProof.failureCases.every(
                  (fc: any) =>
                    typeof fc?.pid === "number" &&
                    fc.pid > 0 &&
                    typeof fc.actualExitCode === "number" &&
                    fc.actualExitCode !== 0 &&
                    fc.actualExitCode === fc.expectedExitCode &&
                    fc.passed === true
                )
            );

      const cliConsistencyOk = Boolean(
        cliDecision &&
          shaMatchesDecision &&
          decisionMatchesVerdict &&
          bizVerdictMatches &&
          subprocessProofOk
      );

      addCheck(
        "CHK_18_CLI_EXIT_DECISION_CONSISTENCY",
        "CLI_EXIT_DECISION and CLI_POSITIVE_AND_FAILURE_EXIT_PROOF match recomputed engineering/validator acceptance and verify real child subprocess exit codes",
        cliConsistencyOk,
        !cliConsistencyOk
          ? "CLI_EXIT_DECISION contradicts engineering/validator verdict or CLI_POSITIVE_AND_FAILURE_EXIT_PROOF failed subprocess verification"
          : undefined
      );
    }
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = checks.length - passedChecks;

  return {
    evaluatedAt: new Date().toISOString(),
    version: "12.4.3.4.9",
    targetDirectory: acceptanceDir,
    overallValid: failedChecks === 0,
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    checks,
  };
}

export function computeEngineeringVerdict(
  validationReport: AcceptanceValidationReport,
  negativeSuiteReport: NegativeControlSuiteReport
): "PASS" | "FAIL" {
  return validationReport.overallValid && negativeSuiteReport.suiteVerdict === "PASS"
    ? "PASS"
    : "FAIL";
}

function copyDirectorySync(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectorySync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Executes 26 real file-mutation negative controls in isolated temp directories.
 * Every single mutation MUST cause `validateAcceptanceArtifacts(tempDir)` to return `overallValid === false`.
 */
export function runNegativeControlSuite(baselineAcceptanceDir: string): NegativeControlSuiteReport {
  const gateMatrixFile = fs.existsSync(path.join(baselineAcceptanceDir, "GATE_TRUTH_MATRIX_V12_4_3_4_6.json"))
    ? "GATE_TRUTH_MATRIX_V12_4_3_4_6.json"
    : "GATE_TRUTH_MATRIX_V12_4_3_4_5.json";
  const finalDecisionFile = fs.existsSync(path.join(baselineAcceptanceDir, "FINAL_RELEASE_DECISION_V12_4_3_4_6.md"))
    ? "FINAL_RELEASE_DECISION_V12_4_3_4_6.md"
    : "FINAL_RELEASE_DECISION_V12_4_3_4_5.md";

  const mutations: Array<{
    mutationId: string;
    description: string;
    targetArtifact: string;
    injectedDefect: string;
    mutate: (tempDir: string) => void;
  }> = [
    {
      mutationId: "MUT_01_DELETE_MANDATORY_ARTIFACT",
      description: "Delete CHROMIUM_EXECUTION_REPORT.json from acceptance directory",
      targetArtifact: "CHROMIUM_EXECUTION_REPORT.json",
      injectedDefect: "Physical file deleted",
      mutate: (tempDir) => {
        fs.unlinkSync(path.join(tempDir, "CHROMIUM_EXECUTION_REPORT.json"));
      },
    },
    {
      mutationId: "MUT_02_CORRUPT_JSON_SYNTAX",
      description: "Write malformed JSON into G06_GATE_EVALUATION.json",
      targetArtifact: "G06_GATE_EVALUATION.json",
      injectedDefect: "SyntaxError: truncated JSON payload",
      mutate: (tempDir) => {
        fs.writeFileSync(path.join(tempDir, "G06_GATE_EVALUATION.json"), "{ broken_json: ", "utf8");
      },
    },
    {
      mutationId: "MUT_03_JUNIT_INJECT_FAILURE_TAG",
      description: "Inject a <failure> tag into JUNIT_RESULTS.xml while keeping header failures='0'",
      targetArtifact: "JUNIT_RESULTS.xml",
      injectedDefect: "<failure message='Simulated test failure'>Stack</failure>",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "JUNIT_RESULTS.xml");
        const xml = fs.readFileSync(p, "utf8");
        const mutated = xml.includes("</testcase>")
          ? xml.replace(
              "</testcase>",
              "<failure message=\"Simulated failure\">AssertionError</failure></testcase>"
            )
          : xml.replace(
              /(<testcase\b[^>]*?)\s*\/>/,
              "$1><failure message=\"Simulated failure\">AssertionError</failure></testcase>"
            );
        fs.writeFileSync(p, mutated, "utf8");
      },
    },
    {
      mutationId: "MUT_04_FAKE_G15_PASS_WITH_ZERO_QUALIFYING",
      description: "Mutate G15_PRODUCT_DEMAND_PROOF.json to claim g15Verdict='PASS' while g15QualifyingCount=0",
      targetArtifact: "G15_PRODUCT_DEMAND_PROOF.json",
      injectedDefect: "g15Verdict='PASS' with g15QualifyingCount=0",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G15_PRODUCT_DEMAND_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.g15QualifyingCount = 0;
        data.g15Verdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_05_FAKE_G16_PASS_WITH_TWO_VERIFIED",
      description: "Mutate G16_CURRENT_RUN_VERIFIED_PROOF.json to claim g16Verdict='PASS' with verifiedLiveCount=2",
      targetArtifact: "G16_CURRENT_RUN_VERIFIED_PROOF.json",
      injectedDefect: "g16Verdict='PASS' with verifiedLiveCount=2",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.verifiedLiveCount = 2;
        data.g16Verdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_06_GOOGLE_PIPELINE_INVARIANT_BREAK",
      description: "Mutate GOOGLE_RAW_CREATIVE_MANIFEST.json rawCount to 999 breaking normalization invariant",
      targetArtifact: "GOOGLE_RAW_CREATIVE_MANIFEST.json",
      injectedDefect: "rawCount=999 != normalized + rejected",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.rawCount = 999;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_07_PARITY_ZERO_COMPARISONS_FALSE_PASS",
      description: "Mutate SQLITE_HTTP_CHROMIUM_PARITY.json to have comparedCandidateCount=0 while sameRunReconciliationPassed=true",
      targetArtifact: "SQLITE_HTTP_CHROMIUM_PARITY.json",
      injectedDefect: "comparedCandidateCount=0 with sameRunReconciliationPassed=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SQLITE_HTTP_CHROMIUM_PARITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.comparedCandidateCount = 0;
        data.sameRunReconciliationPassed = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_08_COMPLETION_BARRIER_RUNNING_JOBS",
      description: "Mutate COMPLETION_BARRIER_REPORT.json to set zeroRunningJobs=false",
      targetArtifact: "COMPLETION_BARRIER_REPORT.json",
      injectedDefect: "zeroRunningJobs=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "COMPLETION_BARRIER_REPORT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.zeroRunningJobs = false;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_09_DISK_BELOW_THRESHOLD",
      description: "Mutate DISK_RAM_SQLITE_SAFETY.json to set finalFreeDiskGB=2.5 below minFreeDiskGB=15",
      targetArtifact: "DISK_RAM_SQLITE_SAFETY.json",
      injectedDefect: "finalFreeDiskGB=2.5 < 15",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "DISK_RAM_SQLITE_SAFETY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.finalFreeDiskGB = 2.5;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_10_BACKTEST_FUTURE_LEAKAGE",
      description: "Mutate REAL_HISTORICAL_DEV_BACKTEST.json to set futureLeakageDetected=true",
      targetArtifact: "REAL_HISTORICAL_DEV_BACKTEST.json",
      injectedDefect: "futureLeakageDetected=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "REAL_HISTORICAL_DEV_BACKTEST.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.futureLeakageDetected = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_11_PLACEHOLDER_IN_FINAL_DECISION",
      description: "Inject TODO placeholder token into FINAL_RELEASE_DECISION_V12_4_3_4_6.md",
      targetArtifact: finalDecisionFile,
      injectedDefect: "Injected 'TODO: replace placeholder'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, finalDecisionFile);
        const md = fs.readFileSync(p, "utf8");
        fs.writeFileSync(p, md + "\nTODO: replace placeholder\n", "utf8");
      },
    },
    {
      mutationId: "MUT_12_ALL_28_GATES_FAKE_PASS",
      description: "Mutate GATE_TRUTH_MATRIX to force overallBusinessVerdict='PASS' despite G15/G16 INSUFFICIENT_EVIDENCE",
      targetArtifact: gateMatrixFile,
      injectedDefect: "overallBusinessVerdict='PASS' while G15=0/3",
      mutate: (tempDir) => {
        const p = path.join(tempDir, gateMatrixFile);
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.overallBusinessVerdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    // ── V12.4.3.4.6 Phase 4.6: 14 New Physical-File Mutations (MUT_13 .. MUT_26) ──
    {
      mutationId: "MUT_13_G16_AGGREGATE_WITHOUT_LIVE_IDS",
      description: "G16 entry claims isLiveVerified=true with liveObservationsCount=3 and liveObservationIds=[]",
      targetArtifact: "G16_CURRENT_RUN_VERIFIED_PROOF.json",
      injectedDefect: "isLiveVerified=true with liveObservationIds=[] and validLineageObservationsCount=0",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.entries) && data.entries[0]) {
          data.entries[0].isLiveVerified = true;
          data.entries[0].liveObservationsCount = 3;
          data.entries[0].liveObservationIds = [];
          data.entries[0].validLineageObservationsCount = 0;
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_14_G16_MISSING_RUN_ID_LINEAGE",
      description: "G16 entry claims isLiveVerified=true when predicateResults.sameRunLineage=false",
      targetArtifact: "G16_CURRENT_RUN_VERIFIED_PROOF.json",
      injectedDefect: "isLiveVerified=true with predicateResults.sameRunLineage=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.entries) && data.entries[0]) {
          data.entries[0].isLiveVerified = true;
          data.entries[0].predicateResults = {
            ...(data.entries[0].predicateResults || {}),
            sameRunLineage: false,
          };
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_15_G16_DUPLICATE_FAMILIES_FALSE_PASS",
      description: "G16 claims g16Verdict='PASS' with verifiedLiveCount=3 but distinctFamiliesCount=2",
      targetArtifact: "G16_CURRENT_RUN_VERIFIED_PROOF.json",
      injectedDefect: "g16Verdict='PASS' with distinctFamiliesCount=2",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.verifiedLiveCount = 3;
        data.distinctCanonicalProductsCount = 3;
        data.distinctFamiliesCount = 2;
        data.requireDistinctFamilies = true;
        data.g16Verdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_16_G16_UNPROVEN_MERCHANT_IDENTITY",
      description: "G16 entry claims isLiveVerified=true with merchantProofRefs=[] and merchantVerified=false",
      targetArtifact: "G16_CURRENT_RUN_VERIFIED_PROOF.json",
      injectedDefect: "isLiveVerified=true with merchantProofRefs=[]",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G16_CURRENT_RUN_VERIFIED_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.entries) && data.entries[0]) {
          data.entries[0].isLiveVerified = true;
          data.entries[0].merchantVerified = false;
          data.entries[0].merchantProofRefs = [];
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_17_PARITY_MISSING_HTTP_CANDIDATE_ID",
      description: "Parity artifact has missing HTTP candidateId (presentHttp=false) while dbVsHttpVerdict='PASS'",
      targetArtifact: "SQLITE_HTTP_CHROMIUM_PARITY.json",
      injectedDefect: "DB_VS_HTTP candidateId presentHttp=false while dbVsHttpVerdict='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SQLITE_HTTP_CHROMIUM_PARITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.fieldComparisons) && data.fieldComparisons[0]) {
          data.fieldComparisons[0].presentHttp = false;
          data.fieldComparisons[0].observedNormalizedValue = null;
        } else {
          data.comparedHttpFieldCount = 0;
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_18_PARITY_ZERO_DOM_FIELDS",
      description: "Parity artifact has comparedDomFieldCount=0 while chromiumParityPassed=true",
      targetArtifact: "SQLITE_HTTP_CHROMIUM_PARITY.json",
      injectedDefect: "comparedDomFieldCount=0 with chromiumParityPassed=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SQLITE_HTTP_CHROMIUM_PARITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.comparedDomFieldCount = 0;
        data.chromiumParityPassed = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_19_PARITY_15CHAR_TITLE_MISMATCH",
      description: "Parity artifact has DOM title mismatch beyond 15 chars while dbVsDomVerdict='PASS'",
      targetArtifact: "SQLITE_HTTP_CHROMIUM_PARITY.json",
      injectedDefect: "observedNormalizedValue differs after 15 chars while verdict='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SQLITE_HTTP_CHROMIUM_PARITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        const domTitleComp = (data.fieldComparisons || []).find(
          (fc: any) => fc.pair === "DB_VS_DOM" && fc.field === "title"
        );
        if (domTitleComp) {
          domTitleComp.observedNormalizedValue =
            String(domTitleComp.expectedNormalizedValue || "").slice(0, 15) + " substituted product bowl";
          domTitleComp.verdict = "PASS";
        } else {
          data.dbVsDomVerdict = "FAIL";
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_20_PARITY_IN_MEMORY_NOT_SQLITE",
      description: "Parity artifact has persistedFromSqliteVerified=false while sameRunReconciliationPassed=true",
      targetArtifact: "SQLITE_HTTP_CHROMIUM_PARITY.json",
      injectedDefect: "persistedFromSqliteVerified=false with sameRunReconciliationPassed=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SQLITE_HTTP_CHROMIUM_PARITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.persistedFromSqliteVerified = false;
        data.sameRunReconciliationPassed = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_21_READ_ONLY_CONTENT_DIGEST_CHANGED",
      description: "Read-only DB artifact has unchanged row counts but mutated SHA-256 content digest while readOnlyPassed=true",
      targetArtifact: "READ_ONLY_DB_CONTENT_INTEGRITY.json",
      injectedDefect: "afterSnapshot.tableDigests.researchProduct.sha256Digest mutated with rowCountsMatch=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "READ_ONLY_DB_CONTENT_INTEGRITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (data.afterSnapshot?.tableDigests?.researchProduct) {
          data.afterSnapshot.tableDigests.researchProduct.sha256Digest = "f".repeat(64);
        } else {
          data.contentDigestsMatch = false;
        }
        data.readOnlyPassed = true;
        data.rowCountsMatch = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_22_GOOGLE_UNDEFINED_ISCACHED_COUNTED_LIVE",
      description: "Google raw manifest has isCached=undefined on all creatives while G06_GATE_EVALUATION claims liveCreativesRetrievedCount > 0",
      targetArtifact: "GOOGLE_RAW_CREATIVE_MANIFEST.json",
      injectedDefect: "All creatives have isCached=undefined while G06 claims liveCreativesRetrievedCount > 0",
      mutate: (tempDir) => {
        const pRaw = path.join(tempDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json");
        const rawData = JSON.parse(fs.readFileSync(pRaw, "utf8"));
        rawData.creatives = (rawData.creatives || []).map((c: any) => {
          const copy = { ...c };
          delete copy.isCached;
          delete copy.sourceMode;
          return copy;
        });
        fs.writeFileSync(pRaw, JSON.stringify(rawData, null, 2), "utf8");

        const pG06 = path.join(tempDir, "G06_GATE_EVALUATION.json");
        const g06Data = JSON.parse(fs.readFileSync(pG06, "utf8"));
        g06Data.liveCreativesRetrievedCount = Math.max(1, g06Data.liveCreativesRetrievedCount || 1);
        g06Data.overallG06Verdict = "PASS";
        fs.writeFileSync(pG06, JSON.stringify(g06Data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_23_GOOGLE_CREATIVE_ID_SET_MISMATCH",
      description: "Google gate evaluation has matching counts but unknownNormalizedCreativeIds=['cr_fake'] while G06_CREATIVE_PIPELINE='PASS'",
      targetArtifact: "G06_GATE_EVALUATION.json",
      injectedDefect: "setReconciliation.unknownNormalizedCreativeIds=['cr_fake'] with pipelineInvariantPassed=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G06_GATE_EVALUATION.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.pipelineInvariantPassed = true;
        data.setReconciliation = {
          ...(data.setReconciliation || {}),
          setInvariantPassed: true,
          unknownNormalizedCreativeIds: ["cr_fake"],
        };
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_24_GOOGLE_PROBABLE_CLAIMED_AS_EXACT",
      description: "G06_GATE_EVALUATION claims GOOGLE_EXACT_PRODUCT_EVIDENCE='PASS' while exactProductSkuMatchesCount=0",
      targetArtifact: "G06_GATE_EVALUATION.json",
      injectedDefect: "exactProductSkuMatchesCount=0 with GOOGLE_EXACT_PRODUCT_EVIDENCE='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G06_GATE_EVALUATION.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.exactProductSkuMatchesCount = 0;
        data.subGates = {
          ...(data.subGates || {}),
          GOOGLE_EXACT_PRODUCT_EVIDENCE: "PASS",
        };
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_25_BACKTEST_POST_CUTOFF_METADATA_LEAK",
      description: "HISTORICAL_POINT_IN_TIME_AUDIT has joinedMetadataLeakagePrevented=false while claiming PASS",
      targetArtifact: "HISTORICAL_POINT_IN_TIME_AUDIT.json",
      injectedDefect: "joinedMetadataLeakagePrevented=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "HISTORICAL_POINT_IN_TIME_AUDIT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.joinedMetadataLeakagePrevented = false;
        data.pointInTimeIntegrityVerdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_26_GATE_MATRIX_SINGLE_ENG_FAILURE_MASKED",
      description: "Gate matrix has 20+ PASS gates, 2 INSUFFICIENT_EVIDENCE, 1 BLOCKED, and G20='FAIL' while overallEngineeringVerdict='PASS'",
      targetArtifact: gateMatrixFile,
      injectedDefect: "gates.G20.status='FAIL' while overallEngineeringVerdict='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, gateMatrixFile);
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (data.gates && data.gates.G20) {
          data.gates.G20.status = "FAIL";
        }
        data.overallEngineeringVerdict = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    // ── V12.4.3.4.7 Phase 5.6: 7 New Physical-File Mutations (MUT_27 .. MUT_33) ──
    {
      mutationId: "MUT_27_DB_ONLY_READ_CLAIMS_HTTP_VERIFIED",
      description: "READ_ONLY_DB_CONTENT_INTEGRITY has verificationScope='DB_ONLY_READ_SNAPSHOT' and actualHttpRequestCount=0 while claiming httpRequestVerified=true and readOnlyPassed=true",
      targetArtifact: "READ_ONLY_DB_CONTENT_INTEGRITY.json",
      injectedDefect: "verificationScope='DB_ONLY_READ_SNAPSHOT' & actualHttpRequestCount=0 with httpRequestVerified=true",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "READ_ONLY_DB_CONTENT_INTEGRITY.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.verificationScope = "DB_ONLY_READ_SNAPSHOT";
        data.actualHttpRequestCount = 0;
        data.httpRequestVerified = true;
        data.readOnlyPassed = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_28_INTEGRATION_EXIT_CODE_NONZERO_CLAIMS_PASS",
      description: "INTEGRATION_SUITE_REPORT has child executionProof.exitCode=1 while claiming totalTests=18 and passedTests=18",
      targetArtifact: "INTEGRATION_SUITE_REPORT.json",
      injectedDefect: "executionProof.exitCode=1 while passedTests=18 and failedTests=0",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "INTEGRATION_SUITE_REPORT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.executionProof = {
          pid: 12345,
          exitCode: 1,
          jsonReportExists: true,
        };
        data.totalTests = 18;
        data.passedTests = 18;
        data.failedTests = 0;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_29_GOOGLE_SYNTHETIC_CR0_AND_MCP_RUNID",
      description: "GOOGLE_RAW_CREATIVE_MANIFEST uses synthetic creativeId='cr_0' and providerRequestId='mcp_run_1' while G06 claims PASS",
      targetArtifact: "GOOGLE_RAW_CREATIVE_MANIFEST.json",
      injectedDefect: "creativeId='cr_0' and providerRequestId='mcp_run_1'",
      mutate: (tempDir) => {
        const pRaw = path.join(tempDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json");
        const rawData = JSON.parse(fs.readFileSync(pRaw, "utf8"));
        if (Array.isArray(rawData.creatives) && rawData.creatives[0]) {
          rawData.creatives[0].creativeId = "cr_0";
          rawData.creatives[0].providerRequestId = "mcp_run_1";
        }
        fs.writeFileSync(pRaw, JSON.stringify(rawData, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_30_GOOGLE_RAW_NORM_COUNT_EQUAL_BUT_STAGE_SKIPPED",
      description: "GOOGLE_NORMALIZATION_LEDGER has normalizationStageExecuted=false while counts match and G06 claims PASS",
      targetArtifact: "GOOGLE_NORMALIZATION_LEDGER.json",
      injectedDefect: "normalizationStageExecuted=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_NORMALIZATION_LEDGER.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.normalizationStageExecuted = false;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_31_BUILD_STALE_BUILD_ID_CLAIMS_PASS",
      description: "NEXT_BUILD_EXECUTION_PROOF has buildIdFreshlyUpdated=false and status='BUILD_FAILED' while NEXT_BUILD_LOG has old success text",
      targetArtifact: "NEXT_BUILD_LOG.txt",
      injectedDefect: "NEXT_BUILD_EXECUTION_PROOF.buildIdFreshlyUpdated=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "NEXT_BUILD_EXECUTION_PROOF.json");
        fs.writeFileSync(
          p,
          JSON.stringify(
            {
              executed: true,
              status: "BUILD_FAILED",
              pid: 4321,
              exitCode: 0,
              buildIdFreshlyUpdated: false,
              allowServerAndChromiumLaunch: false,
            },
            null,
            2
          ),
          "utf8"
        );
      },
    },
    {
      mutationId: "MUT_32_G15_DB_QUERY_FAILED_SWALLOWED_AS_PASS",
      description: "G15_PRODUCT_DEMAND_PROOF has an entry with queryStatus='DB_QUERY_FAILED' and queryMode='SUBSTRING_FALLBACK' while claiming g15Verdict='PASS'",
      targetArtifact: "G15_PRODUCT_DEMAND_PROOF.json",
      injectedDefect: "entry with queryStatus='DB_QUERY_FAILED' and g15Verdict='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "G15_PRODUCT_DEMAND_PROOF.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.g15QualifyingCount = 3;
        data.g15Verdict = "PASS";
        data.entries = [
          {
            candidateId: "c1",
            queryStatus: "DB_QUERY_FAILED",
            queryMode: "SUBSTRING_FALLBACK",
            g15Qualifying: true,
            hasLongitudinalDemand: true,
            coveredDays: 90,
          },
        ];
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_33_GATE_PASS_WITHOUT_EXECUTION_PROOF",
      description: "GATE_TRUTH_MATRIX claims G03='PASS' with executionProofMissing=true and executionId=null",
      targetArtifact: gateMatrixFile,
      injectedDefect: "gates.G03.executionProofMissing=true and executionId=null while status='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, gateMatrixFile);
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (data.gates && data.gates.G03) {
          data.gates.G03.status = "PASS";
          data.gates.G03.executionProofMissing = true;
          data.gates.G03.executionId = null;
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    // ── V12.4.3.4.8 Phase 3.2: 8 Additional Provenance & Runtime Truth Mutations (MUT_34 .. MUT_41) ──
    {
      mutationId: "MUT_34_N01_CORRUPT_PROVIDER_REQUEST_ID_ORIGIN",
      description: "N01: GOOGLE_RAW_CREATIVE_MANIFEST creative has providerRequestIdOrigin='UPSTREAM' with providerRequestId=null",
      targetArtifact: "GOOGLE_RAW_CREATIVE_MANIFEST.json",
      injectedDefect: "providerRequestIdOrigin='UPSTREAM' with providerRequestId=null",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.creatives) && data.creatives[0]) {
          data.creatives[0].providerRequestId = null;
          data.creatives[0].providerRequestIdOrigin = "UPSTREAM";
          data.creatives[0].mcpInvocationRef = "google_mcp_inv_1";
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_35_N02_LOCAL_INVOCATION_ID_AS_UPSTREAM_REQUEST_ID",
      description: "N02: GOOGLE_RAW_CREATIVE_MANIFEST sets providerRequestId equal to local mcpInvocationRef ('google_mcp_...')",
      targetArtifact: "GOOGLE_RAW_CREATIVE_MANIFEST.json",
      injectedDefect: "providerRequestId='google_mcp_run_123' === mcpInvocationRef",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_RAW_CREATIVE_MANIFEST.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.creatives) && data.creatives[0]) {
          data.creatives[0].providerRequestId = "google_mcp_run_123_uahpet_1";
          data.creatives[0].mcpInvocationRef = "google_mcp_run_123_uahpet_1";
          data.creatives[0].providerRequestIdOrigin = "UPSTREAM";
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_36_N03_LOCAL_INVOCATION_WITHOUT_MATCHING_COMPLETED_CALL",
      description: "N03: GOOGLE_REQUEST_ID_LINEAGE_MATRIX has VERIFIED_LOCAL_INVOCATION_ONLY entry without matching SUCCEEDED call in invocationLedger",
      targetArtifact: "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json",
      injectedDefect: "invocationLedger empty while entry claims VERIFIED_LOCAL_INVOCATION_ONLY",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json");
        fs.writeFileSync(
          p,
          JSON.stringify(
            {
              researchRunId: "run_1",
              rejectedUnverifiedLineageCount: 0,
              invocationLedger: [
                {
                  mcpInvocationRef: "google_mcp_inv_other",
                  status: "FAILED",
                  researchRunId: "run_1",
                  responseEvidenceHash: "hash_1",
                  returnedCreativeIds: [],
                },
              ],
              entries: [
                {
                  creativeId: "CR-1",
                  providerRequestId: null,
                  providerRequestIdOrigin: "ABSENT",
                  mcpInvocationRef: "google_mcp_inv_missing",
                  responseEvidenceHash: "hash_1",
                  lineageMethod: "VERIFIED_LOCAL_INVOCATION_ONLY",
                  verified: true,
                },
              ],
            },
            null,
            2
          ),
          "utf8"
        );
      },
    },
    {
      mutationId: "MUT_37_N04_N05_N06_LINEAGE_CREATIVE_HASH_OR_RUN_MISMATCH",
      description: "N04/N05/N06: GOOGLE_REQUEST_ID_LINEAGE_MATRIX has creative missing from returnedCreativeIds or missing responseEvidenceHash",
      targetArtifact: "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json",
      injectedDefect: "creativeId not in returnedCreativeIds and missing responseEvidenceHash",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "GOOGLE_REQUEST_ID_LINEAGE_MATRIX.json");
        fs.writeFileSync(
          p,
          JSON.stringify(
            {
              researchRunId: "run_1",
              rejectedUnverifiedLineageCount: 0,
              invocationLedger: [
                {
                  mcpInvocationRef: "google_mcp_inv_1",
                  status: "SUCCEEDED",
                  researchRunId: "run_wrong",
                  responseEvidenceHash: "hash_1",
                  returnedCreativeIds: ["CR-OTHER"],
                },
              ],
              entries: [
                {
                  creativeId: "CR-1",
                  providerRequestId: null,
                  providerRequestIdOrigin: "ABSENT",
                  mcpInvocationRef: "google_mcp_inv_1",
                  responseEvidenceHash: null,
                  lineageMethod: "VERIFIED_LOCAL_INVOCATION_ONLY",
                  verified: true,
                },
              ],
            },
            null,
            2
          ),
          "utf8"
        );
      },
    },
    {
      mutationId: "MUT_38_N10_CHROMIUM_MAIN_DOC_HTTP_500_CLAIMS_PASS",
      description: "N10: CHROMIUM_EXECUTION_REPORT has mainDocumentHttpStatus=500 and pageLoaded=false while status='PASS'",
      targetArtifact: "CHROMIUM_EXECUTION_REPORT.json",
      injectedDefect: "mainDocumentHttpStatus=500 & pageLoaded=false with status='PASS'",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "CHROMIUM_EXECUTION_REPORT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.mainDocumentHttpStatus = 500;
        data.pageLoaded = false;
        data.status = "PASS";
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_39_N13_FAILED_DUPLICATE_TEST_HIDDEN_BY_RETRY",
      description: "N13: TEST_EXECUTION_TRUTH_TABLE has failedExecutionsCount=2 while failedTests=0 and zeroFailedTests=true",
      targetArtifact: "TEST_EXECUTION_TRUTH_TABLE.json",
      injectedDefect: "failedExecutionsCount=2 masked by retry",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "TEST_EXECUTION_TRUTH_TABLE.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.failedExecutionsCount = 2;
        data.failedTests = 0;
        data.zeroFailedTests = true;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_40_N15_SOURCE_SHA_PROVENANCE_MISMATCH",
      description: "N15: SOURCE_SHA_PROVENANCE has testedSourceSha!='headSha' in PRE_FLIGHT_GIT_AND_ENV",
      targetArtifact: "SOURCE_SHA_PROVENANCE.json",
      injectedDefect: "testedSourceSha='deadbeef...' != preFlight.headSha",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SOURCE_SHA_PROVENANCE.json");
        fs.writeFileSync(
          p,
          JSON.stringify(
            {
              branch: "feature/kh02-v12.1.3-runtime-truth-closure",
              testedSourceSha: "deadbeef00000000000000000000000000000000",
            },
            null,
            2
          ),
          "utf8"
        );
      },
    },
    // ── V12.4.3.4.9 Phase 4: 6 Additional Disk Audit & CLI Exit Consistency Mutations (MUT_41 .. MUT_46) ──
    {
      mutationId: "MUT_41_DISK_AUDIT_HARDCODED_LEGACY_BYTES",
      description: "SAFE_DISK_RECOVERY_AUDIT uses legacy hardcoded beforeFreeDiskGB=8.71 and reclaimedBytes=226365440",
      targetArtifact: "SAFE_DISK_RECOVERY_AUDIT.json",
      injectedDefect: "beforeFreeDiskGB=8.71, beforeFreeDiskBytes=9357185024, reclaimedBytes=226365440",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SAFE_DISK_RECOVERY_AUDIT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.beforeFreeDiskGB = 8.71;
        data.beforeFreeDiskBytes = 9357185024;
        data.reclaimedBytes = 226365440;
        data.reclaimedGB = 0.22;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_42_DISK_AUDIT_FAKE_CLEANED_TARGETS_WITHOUT_CLEANUP",
      description: "SAFE_DISK_RECOVERY_AUDIT claims cleanedTargets and reclaimedBytes>0 while cleanupAttempted=false",
      targetArtifact: "SAFE_DISK_RECOVERY_AUDIT.json",
      injectedDefect: "cleanupAttempted=false with non-empty cleanedTargets and totalVerifiedRemovedBytes=218112000",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SAFE_DISK_RECOVERY_AUDIT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        data.cleanupAttempted = false;
        data.cleanedTargets = [
          {
            path: ".next/cache",
            category: "REGENERABLE_NEXT_BUILD_CACHE",
            bytesRemoved: 218112000,
            ownershipVerified: true,
          },
        ];
        data.totalVerifiedRemovedBytes = 218112000;
        data.reclaimedBytes = 218112000;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_43_DISK_AUDIT_PROTECTED_PATH_TOUCHED",
      description: "SAFE_DISK_RECOVERY_AUDIT marks protected path dev.db as untouched=false",
      targetArtifact: "SAFE_DISK_RECOVERY_AUDIT.json",
      injectedDefect: "protectedPathsVerifiedPresent[0].untouched=false",
      mutate: (tempDir) => {
        const p = path.join(tempDir, "SAFE_DISK_RECOVERY_AUDIT.json");
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        if (Array.isArray(data.protectedPathsVerifiedPresent) && data.protectedPathsVerifiedPresent[0]) {
          data.protectedPathsVerifiedPresent[0].untouched = false;
        } else {
          data.protectedPathsVerifiedPresent = [{ path: "dev.db", exists: true, untouched: false }];
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_44_CLI_EXIT_ZERO_DESPITE_ENG_VERDICT_FAIL",
      description: "CLI_EXIT_DECISION claims exitCode=0 and engineeringAccepted=true while GATE_TRUTH_MATRIX has overallEngineeringVerdict='FAIL'",
      targetArtifact: "CLI_EXIT_DECISION.json",
      injectedDefect: "exitCode=0 with overallEngineeringVerdict='FAIL'",
      mutate: (tempDir) => {
        const pGate = path.join(tempDir, gateMatrixFile);
        const gateData = JSON.parse(fs.readFileSync(pGate, "utf8"));
        if (gateData.gates?.G20) gateData.gates.G20.status = "FAIL";
        gateData.overallEngineeringVerdict = "FAIL";
        fs.writeFileSync(pGate, JSON.stringify(gateData, null, 2), "utf8");

        const pCli = path.join(tempDir, "CLI_EXIT_DECISION.json");
        const cliData = JSON.parse(fs.readFileSync(pCli, "utf8"));
        cliData.exitCode = 0;
        cliData.exitCategory = "ENGINEERING_ACCEPTED";
        cliData.engineeringAccepted = true;
        cliData.validatorAccepted = true;
        fs.writeFileSync(pCli, JSON.stringify(cliData, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_45_CLI_EXIT_DECISION_CONTRADICTS_VALID_BASELINE",
      description: "CLI_EXIT_DECISION reports exitCode=2 (ENGINEERING_GATE_FAILURE) while all engineering and validator checks pass",
      targetArtifact: "CLI_EXIT_DECISION.json",
      injectedDefect: "exitCode=2 and engineeringAccepted=false on a passing engineering run",
      mutate: (tempDir) => {
        const pCli = path.join(tempDir, "CLI_EXIT_DECISION.json");
        const cliData = JSON.parse(fs.readFileSync(pCli, "utf8"));
        cliData.exitCode = 2;
        cliData.exitCategory = "ENGINEERING_GATE_FAILURE";
        cliData.engineeringAccepted = false;
        fs.writeFileSync(pCli, JSON.stringify(cliData, null, 2), "utf8");
      },
    },
    {
      mutationId: "MUT_46_CLI_SUBPROCESS_FAILURE_PROOF_RETURNS_ZERO",
      description: "CLI_POSITIVE_AND_FAILURE_EXIT_PROOF has a forced failure subprocess case with actualExitCode=0",
      targetArtifact: "CLI_POSITIVE_AND_FAILURE_EXIT_PROOF.json",
      injectedDefect: "failureCases[0].actualExitCode=0",
      mutate: (tempDir) => {
        const pProof = path.join(tempDir, "CLI_POSITIVE_AND_FAILURE_EXIT_PROOF.json");
        const proofData = JSON.parse(fs.readFileSync(pProof, "utf8"));
        if (Array.isArray(proofData.failureCases) && proofData.failureCases[0]) {
          proofData.failureCases[0].actualExitCode = 0;
        } else {
          proofData.suiteVerdict = "FAIL";
        }
        fs.writeFileSync(pProof, JSON.stringify(proofData, null, 2), "utf8");
      },
    },
  ];

  const results: NegativeControlCaseResult[] = [];

  for (const m of mutations) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `kh02-neg-${m.mutationId}-`));
    try {
      copyDirectorySync(baselineAcceptanceDir, tempDir);

      // Verify baseline in tempDir is 100% valid BEFORE injecting the mutation
      // so an environmental blocker never masks whether the specific mutation was caught
      const preVal = validateAcceptanceArtifacts(tempDir, {
        skipSelfMutationReportCheck: true,
      });
      const preFailedSet = new Set(preVal.checks.filter((c) => !c.passed).map((c) => c.checkId));

      m.mutate(tempDir);

      const valReport = validateAcceptanceArtifacts(tempDir, {
        skipSelfMutationReportCheck: true,
      });

      const newlyFailedCheckIds = valReport.checks
        .filter((c) => !c.passed && !preFailedSet.has(c.checkId))
        .map((c) => c.checkId);
      const validatorRejected = valReport.overallValid === false && newlyFailedCheckIds.length > 0;

      results.push({
        mutationId: m.mutationId,
        description: m.description,
        targetArtifact: m.targetArtifact,
        injectedDefect: m.injectedDefect,
        validatorRejected,
        caughtByCheckIds: newlyFailedCheckIds,
        passed: validatorRejected,
      });
    } catch (err: any) {
      results.push({
        mutationId: m.mutationId,
        description: m.description,
        targetArtifact: m.targetArtifact,
        injectedDefect: m.injectedDefect,
        validatorRejected: false,
        caughtByCheckIds: [`EXCEPTION: ${err?.message}`],
        passed: false,
      });
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  const totalCaught = results.filter((r) => r.passed).length;

  return {
    evaluatedAt: new Date().toISOString(),
    version: "12.4.3.4.6",
    totalMutations: mutations.length,
    totalCaughtAndRejected: totalCaught,
    suiteVerdict: totalCaught === mutations.length ? "PASS" : "FAIL",
    cases: results,
  };
}
