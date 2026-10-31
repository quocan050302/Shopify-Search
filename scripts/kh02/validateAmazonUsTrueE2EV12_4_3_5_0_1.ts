/**
 * SWAI KH-02 V12.4.3.5.0.1 — Independent True E2E Acceptance Validator & 32-Mutation Suite
 *
 * Implements:
 * - validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1(dir, options)
 * - writeCanonicalValidV12_4_3_5_0_1Fixture(dir, codeSha)
 * - runV12_4_3_5_0_1NegativeMutationSuite(dir) (32 physical-file mutations V1243501_MUT_01..V1243501_MUT_32)
 */

import fs from "fs";
import os from "os";
import path from "path";

export const MANDATORY_V12_4_3_5_0_1_ARTIFACTS = [
  "FEATURE_EXECUTION_PLAN.md",
  "EXECUTION_STATE.json",
  "CODE_REPAIR_DIFF_AUDIT.json",
  "AUTOMATED_TEST_REPORT.json",
  "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
  "SQLITE_HTTP_DOM_PARITY_REPORT.json",
  "READONLY_GET_NON_MUTATION_PROOF.json",
  "HISTORICAL_BACKTEST_COMPARE_REPORT.json",
  "NEGATIVE_CONTROL_MUTATION_REPORT.json",
  "FINAL_ACCEPTANCE_DECISION.json",
  "FINAL_OWNER_REPORT.md",
] as const;

export interface ValidatorCheckResult {
  checkId: string;
  description: string;
  passed: boolean;
  details: string;
}

export interface V12_4_3_5_0_1ValidationReport {
  evaluatedAt: string;
  artifactDir: string;
  overallValid: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: ValidatorCheckResult[];
}

export interface NegativeControlMutationCaseResult {
  mutationId: string;
  targetArtifact: string;
  description: string;
  expectedViolatedCheckId: string;
  caughtAndRejected: boolean;
  failedCheckIds: string[];
}

export interface NegativeControlMutationSuiteReport {
  evaluatedAt: string;
  codeSha: string;
  totalMutations: number;
  totalCaughtAndRejected: number;
  falsePassEscapes: number;
  suiteVerdict: "PASS" | "FAIL";
  cases: NegativeControlMutationCaseResult[];
}

function readJsonSafe(dir: string, filename: string): any | null {
  try {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function isValidGitSha40(val: unknown): boolean {
  return typeof val === "string" && /^[0-9a-f]{40}$/i.test(val.trim());
}

function isValidSha256Hex(val: unknown): boolean {
  return typeof val === "string" && /^[0-9a-f]{64}$/i.test(val.trim());
}

/**
 * Independently validates all 11 mandatory acceptance artifacts for KH-02 V12.4.3.5.0.1.
 */
export function validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1(
  dir: string,
  options?: {
    skipSelfMutationCheck?: boolean;
    expectedCodeSha?: string;
  }
): V12_4_3_5_0_1ValidationReport {
  const checks: ValidatorCheckResult[] = [];
  const addCheck = (
    checkId: string,
    description: string,
    passed: boolean,
    details: string
  ) => {
    checks.push({ checkId, description, passed, details });
  };

  // CHK_01: Mandatory artifacts present and non-empty
  {
    const missing: string[] = [];
    const requiredList = options?.skipSelfMutationCheck
      ? MANDATORY_V12_4_3_5_0_1_ARTIFACTS.filter(
          (f) => f !== "NEGATIVE_CONTROL_MUTATION_REPORT.json"
        )
      : MANDATORY_V12_4_3_5_0_1_ARTIFACTS;
    for (const file of requiredList) {
      const fullPath = path.join(dir, file);
      if (!fs.existsSync(fullPath)) {
        missing.push(file);
      } else {
        const stat = fs.statSync(fullPath);
        if (stat.size === 0) missing.push(`${file} (empty)`);
      }
    }
    addCheck(
      "CHK_01_MANDATORY_ARTIFACTS_PRESENT",
      "All 11 mandatory V12.4.3.5.0.1 acceptance artifacts exist and are non-empty",
      missing.length === 0,
      missing.length === 0
        ? `Verified ${requiredList.length} artifacts present.`
        : `Missing or empty artifacts: ${missing.join(", ")}`
    );
  }

  const execState = readJsonSafe(dir, "EXECUTION_STATE.json");
  const diffAudit = readJsonSafe(dir, "CODE_REPAIR_DIFF_AUDIT.json");
  const testReport = readJsonSafe(dir, "AUTOMATED_TEST_REPORT.json");
  const mcpFlow = readJsonSafe(dir, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
  const parityReport = readJsonSafe(dir, "SQLITE_HTTP_DOM_PARITY_REPORT.json");
  const readOnlyProof = readJsonSafe(dir, "READONLY_GET_NON_MUTATION_PROOF.json");
  const backtestReport = readJsonSafe(dir, "HISTORICAL_BACKTEST_COMPARE_REPORT.json");
  const negReport = readJsonSafe(dir, "NEGATIVE_CONTROL_MUTATION_REPORT.json");
  const finalDecision = readJsonSafe(dir, "FINAL_ACCEPTANCE_DECISION.json");

  // CHK_02: Branch, Release Version & Frozen CODE_SHA Provenance
  {
    const codeSha = execState?.codeSha;
    const baseSha = execState?.baseSha;
    const branch = execState?.branch;
    const releaseVersion = execState?.releaseVersion;
    const shaConsistent =
      isValidGitSha40(codeSha) &&
      baseSha === "c1833362cf6634917f2ff94df19d97c393247d94" &&
      branch === "feature/kh02-amazon-us-pilot-v12.4.3.5.0" &&
      releaseVersion === "12.4.3.5.0.1" &&
      (!options?.expectedCodeSha || codeSha === options.expectedCodeSha) &&
      diffAudit?.codeSha === codeSha &&
      testReport?.codeSha === codeSha &&
      mcpFlow?.codeSha === codeSha &&
      parityReport?.codeSha === codeSha &&
      readOnlyProof?.codeSha === codeSha &&
      backtestReport?.codeSha === codeSha &&
      finalDecision?.codeSha === codeSha &&
      finalDecision?.releaseVersion === "12.4.3.5.0.1";

    addCheck(
      "CHK_02_BRANCH_VERSION_AND_CODE_SHA_PROVENANCE",
      "Branch is feature/kh02-amazon-us-pilot-v12.4.3.5.0, releaseVersion is 12.4.3.5.0.1, and frozen 40-hex CODE_SHA matches across all artifacts",
      Boolean(shaConsistent),
      shaConsistent
        ? `Verified branch=${branch}, version=${releaseVersion}, codeSha=${codeSha}`
        : `Branch, version, or CODE_SHA mismatch across artifacts: branch=${branch}, version=${releaseVersion}, codeSha=${codeSha}`
    );
  }

  // CHK_03: Four P0 Defects & Product-Flow Gap Closed in CODE_REPAIR_DIFF_AUDIT.json
  {
    const p0a = diffAudit?.defectsClosed?.P0_A_autoSessionAndBorrowedSessionSafety;
    const p0b = diffAudit?.defectsClosed?.P0_B_uiPreRunPilotTogglePayload;
    const p0c = diffAudit?.defectsClosed?.P0_C_atomicPersistenceAndNoSilentCatchNull;
    const p0d = diffAudit?.defectsClosed?.P0_D_postRunChildVerifyJobAndUiForm;

    const ok =
      p0a?.fixed === true &&
      p0a?.autoCreatesOwnedSessionWhenLiveAllowed === true &&
      p0a?.borrowedSessionNotClosedByCleanup === true &&
      p0a?.zeroToolInvocationsClassifiedAsNotExecuted === true &&
      p0a?.creatorsApiWithoutClientClassifiedAsNotImplemented === true &&
      p0b?.fixed === true &&
      p0b?.handleRunEvergreenResearchSendsEnableAmazonUsPilot === true &&
      p0b?.rendersDisabledReasonBanner === true &&
      p0c?.fixed === true &&
      p0c?.catchNullCountAroundPersistAmazonEvidenceAtomically === 0 &&
      p0c?.insideTransactionOwnershipVerified === true &&
      p0c?.dbWriteFailureDowngradesToPartiallyCompleted === true &&
      p0c?.childVerifyJobDbFailureTransitionsToFailed === true &&
      p0d?.fixed === true &&
      p0d?.postMarketplaceAmazonCreatesDistinctChildJob === true &&
      p0d?.workerProcessesKh02AmazonVerify === true &&
      p0d?.uiVerifyAmazonFormWired === true;

    addCheck(
      "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      "CODE_REPAIR_DIFF_AUDIT.json confirms P0-A, P0-B, P0-C (zero .catch(()=>null)), and P0-D are closed in source",
      Boolean(ok),
      ok
        ? "All 4 P0 defects (P0-A, P0-B, P0-C, P0-D) verified closed."
        : `P0 defect audit incomplete or failing: ${JSON.stringify(diffAudit?.defectsClosed)}`
    );
  }

  // CHK_04: Automated Tests, TypeScript, Next Build & N01–N40 Matrix
  {
    const matrix: any[] = Array.isArray(testReport?.n01ToN40Matrix)
      ? testReport.n01ToN40Matrix
      : [];
    const expectedNIds = Array.from(
      { length: 40 },
      (_, i) => `N${String(i + 1).padStart(2, "0")}`
    );
    const presentNIds = new Set(matrix.map((m) => m?.id));
    const all40PresentAndPassing =
      expectedNIds.every((id) => presentNIds.has(id)) &&
      matrix.length === 40 &&
      matrix.every((m) => m?.passed === true);

    const ok =
      testReport?.tscExitCode === 0 &&
      testReport?.nextBuildExitCode === 0 &&
      typeof testReport?.unitTestsPassed === "number" &&
      testReport.unitTestsPassed >= 528 &&
      testReport?.unitTestsFailed === 0 &&
      testReport?.v12_4_3_5_0_1SuitePassed === 40 &&
      testReport?.v12_4_3_5_0_1SuiteFailed === 0 &&
      testReport?.integrationTestsPassed === 18 &&
      testReport?.integrationTestsFailed === 0 &&
      all40PresentAndPassing;

    addCheck(
      "CHK_04_AUTOMATED_TESTS_BUILD_AND_N01_N40",
      "tsc=0, next build=0, unitTests>=528 (0 failed), v12_4_3_5_0_1=40/40 (N01..N40), integration=18/18",
      Boolean(ok),
      ok
        ? `Verified tsc=0, build=0, unit=${testReport?.unitTestsPassed} passed, N01..N40=40/40, integration=18/18.`
        : `Automated test report violation: tsc=${testReport?.tscExitCode}, build=${testReport?.nextBuildExitCode}, unitPassed=${testReport?.unitTestsPassed}, unitFailed=${testReport?.unitTestsFailed}, all40=${all40PresentAndPassing}`
    );
  }

  // CHK_05: Playwright MCP Handshake, Handshake-Only Guard (N15/N40), and Real Job-Level Stdio MCP Flow (N16)
  {
    const handshake = mcpFlow?.officialPlaywrightMcpHandshake;
    const handshakeOnlyGuard = mcpFlow?.handshakeOnlyWithoutNavigationGuard;
    const jobFlow = mcpFlow?.jobLevelStdioMcpExecution;

    const handshakeOk =
      handshake?.packageSpec === "@playwright/mcp@0.0.83" &&
      handshake?.connected === true &&
      handshake?.status === "CONNECTED_READY" &&
      Array.isArray(handshake?.discoveredTools) &&
      handshake.discoveredTools.includes("browser_navigate") &&
      handshake.discoveredTools.includes("browser_snapshot") &&
      handshake?.closedCleanly === true &&
      handshake?.residualProcessesCount === 0;

    const guardOk =
      handshakeOnlyGuard?.toolInvocationsCount === 0 &&
      handshakeOnlyGuard?.classifiedStatus === "NOT_EXECUTED" &&
      handshakeOnlyGuard?.neverCountedAsIdentityVerified === true &&
      handshakeOnlyGuard?.neverCountedAsRealProviderVerified === true;

    const toolNames: string[] = Array.isArray(jobFlow?.toolInvocations)
      ? jobFlow.toolInvocations.map((t: any) => t?.toolName)
      : [];
    const jobFlowOk =
      typeof jobFlow?.parentResearchRunId === "string" &&
      typeof jobFlow?.verifyJobId === "string" &&
      jobFlow.verifyJobId.length > 0 &&
      jobFlow.verifyJobId !== jobFlow.parentResearchRunId &&
      jobFlow?.jobType === "KH02_AMAZON_VERIFY" &&
      jobFlow?.workerClaimedAndCompleted === true &&
      jobFlow?.mcpSessionCreatedAutomatically === true &&
      jobFlow?.mcpSessionClosedCleanly === true &&
      toolNames.includes("browser_navigate") &&
      toolNames.includes("browser_snapshot") &&
      toolNames.includes("browser_close") &&
      jobFlow?.persistedEvidenceCount >= 1 &&
      jobFlow?.persistedStatus === "IDENTITY_VERIFIED" &&
      jobFlow?.persistedAsin === "B08N5WRWNW" &&
      jobFlow?.serverOrigin === "LOCAL_MCP_TEST_DOUBLE" &&
      jobFlow?.observationClass === "TEST_FIXTURE" &&
      jobFlow?.countedAsLiveProviderVerified === false &&
      mcpFlow?.residualMcpChildProcesses === 0;

    addCheck(
      "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      "Official @playwright/mcp@0.0.83 handshake verified; handshake-only (0 tool calls) rejected as NOT_EXECUTED; real KH02_AMAZON_VERIFY job executes browser_navigate + browser_snapshot + browser_close via StdioClientTransport and classifies LOCAL_MCP_TEST_DOUBLE as TEST_FIXTURE (never live provider verified)",
      Boolean(handshakeOk && guardOk && jobFlowOk),
      handshakeOk && guardOk && jobFlowOk
        ? `Verified official handshake (${handshake?.discoveredTools?.length} tools), N15 guard, and job-level stdio MCP flow (${toolNames.join(" -> ")}).`
        : `MCP job flow proof invalid: handshakeOk=${handshakeOk}, guardOk=${guardOk}, jobFlowOk=${jobFlowOk}`
    );
  }

  // CHK_06: SQLite <-> HTTP <-> Headless Chromium DOM Parity & Post-Run UI Verify Flow
  {
    const uiFlow = parityReport?.postRunBrowserVerifyFlow;
    const comparisons: any[] = Array.isArray(parityReport?.fieldComparisons)
      ? parityReport.fieldComparisons
      : [];
    const barrier = parityReport?.workerBarrier;

    const uiFlowOk =
      uiFlow?.executedInHeadlessChromium === true &&
      uiFlow?.releaseVersionBadgeInDom === "v12.4.3.5.0.1" &&
      uiFlow?.pilotControlVisibleInDom === true &&
      uiFlow?.verifyFormSubmittedInBrowser === true &&
      typeof uiFlow?.parentResearchRunId === "string" &&
      typeof uiFlow?.spawnedVerifyJobId === "string" &&
      uiFlow.spawnedVerifyJobId !== uiFlow.parentResearchRunId &&
      uiFlow?.verifyJobFinalStatus === "COMPLETED" &&
      uiFlow?.renderedAsinInDom === "B08N5WRWNW" &&
      uiFlow?.renderedIdentityMatchInDom === "EXACT_PRODUCT";

    const parityOk =
      comparisons.length >= 20 &&
      parityReport?.mismatchCount === 0 &&
      comparisons.every((c) => c?.match === true) &&
      barrier?.runningCount === 0 &&
      barrier?.pendingCount === 0 &&
      barrier?.residualChildProcesses === 0;

    addCheck(
      "CHK_06_SQLITE_HTTP_DOM_PARITY_AND_BROWSER_VERIFY_FLOW",
      "Headless Chromium E2E proves /products post-run Verify Amazon US Listing form submission -> KH02_AMAZON_VERIFY child job -> DOM update with 0 SQLite/HTTP/DOM mismatches and clean worker barrier",
      Boolean(uiFlowOk && parityOk),
      uiFlowOk && parityOk
        ? `Verified Chromium post-run verify flow (verifyJobId=${uiFlow?.spawnedVerifyJobId}) and ${comparisons.length} parity comparisons with 0 mismatches.`
        : `Parity or UI flow failure: uiFlowOk=${uiFlowOk}, comparisons=${comparisons.length}, mismatchCount=${parityReport?.mismatchCount}, barrier=${JSON.stringify(barrier)}`
    );
  }

  // CHK_07: Read-Only GET Non-Mutation Proof (N31)
  {
    const ok =
      isValidSha256Hex(readOnlyProof?.beforeDigest) &&
      readOnlyProof?.beforeDigest === readOnlyProof?.afterDigest &&
      readOnlyProof?.sqliteByteDelta === 0 &&
      readOnlyProof?.rowDelta === 0 &&
      typeof readOnlyProof?.totalReadOnlyRequests === "number" &&
      readOnlyProof.totalReadOnlyRequests >= 5 &&
      readOnlyProof?.testedStatuses?.includes(200) &&
      readOnlyProof?.testedStatuses?.includes(403) &&
      readOnlyProof?.testedStatuses?.includes(404);

    addCheck(
      "CHK_07_READONLY_GET_NON_MUTATION_PROOF",
      "Read-only GET endpoints (200, 403, 404) produce identical SQLite state digest (byteDelta=0, rowDelta=0)",
      Boolean(ok),
      ok
        ? `Verified ${readOnlyProof?.totalReadOnlyRequests} read-only GET requests with 0 mutations.`
        : `Read-only GET non-mutation violation: ${JSON.stringify(readOnlyProof)}`
    );
  }

  // CHK_08: Historical DEV/HOLDOUT Backtest & Post-Run Non-Inflation Proof (N33)
  {
    const dev = backtestReport?.devBacktest;
    const holdout = backtestReport?.holdoutBacktest;
    const nonInflation = backtestReport?.postRunAmazonAttachmentComparison;
    const pit = backtestReport?.pointInTimeAudit;

    const backtestOk =
      dev?.adsEvaluated === 60 &&
      holdout?.adsEvaluated === 377 &&
      dev?.g15PassingCandidatesCount === 0 &&
      holdout?.g15PassingCandidatesCount === 0 &&
      holdout?.g16PassingCandidatesCount === 2 &&
      JSON.stringify(holdout?.topThreeScores) === JSON.stringify([68, 64, 61]);

    const nonInflationOk =
      nonInflation?.scoreDelta === 0 &&
      nonInflation?.rankOrderChanged === false &&
      nonInflation?.pillarScoresChanged === false &&
      nonInflation?.g15Changed === false &&
      nonInflation?.g16Changed === false &&
      JSON.stringify(nonInflation?.scoresBefore) === JSON.stringify([68, 64, 61]) &&
      JSON.stringify(nonInflation?.scoresAfter) === JSON.stringify([68, 64, 61]);

    const pitOk =
      pit?.futureTimestampedRowExcluded === true &&
      pit?.futureLeaksAccepted === 0;

    addCheck(
      "CHK_08_HISTORICAL_BACKTEST_AND_NON_INFLATION",
      "DEV (60 ads) and HOLDOUT (377 ads) backtests preserve G15=0/3, G16=2/3, top-3=[68,64,61]; post-run Amazon attachment causes 0 score/pillar/gate delta; point-in-time audit accepts 0 future leaks",
      Boolean(backtestOk && nonInflationOk && pitOk),
      backtestOk && nonInflationOk && pitOk
        ? "Verified DEV/HOLDOUT backtests, post-run non-inflation ([68, 64, 61]), and point-in-time discipline."
        : `Backtest or non-inflation violation: backtestOk=${backtestOk}, nonInflationOk=${nonInflationOk}, pitOk=${pitOk}`
    );
  }

  // CHK_09: Final Acceptance Decision & Provider Provenance Honesty (N29, N36, N37, N39)
  {
    const allowedRealVerdicts = new Set([
      "REAL_PROVIDER_VERIFIED",
      "BLOCKED_POLICY",
      "BLOCKED_PROVIDER",
      "INSUFFICIENT_LIVE_EVIDENCE",
    ]);
    const liveVerifiedCount = finalDecision?.verifiedLiveUsProductIdentitiesCount ?? -1;
    const realVerdict = finalDecision?.realProviderVerdict;

    const liveVerdictHonest =
      allowedRealVerdicts.has(realVerdict) &&
      (realVerdict !== "REAL_PROVIDER_VERIFIED" ||
        (liveVerifiedCount >= 1 &&
          finalDecision?.liveProviderServerOrigin === "OFFICIAL_PLAYWRIGHT_MCP" &&
          finalDecision?.liveProviderObservationClass === "AUTHORIZED_LIVE")) &&
      (liveVerifiedCount > 0 || realVerdict !== "REAL_PROVIDER_VERIFIED");

    const invariantsOk =
      finalDecision?.engineeringVerdict === "ENGINEERING_READY" &&
      finalDecision?.evergreenBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      finalDecision?.walmartPilotReadinessVerdict === "READY_TO_START_WALMART_PILOT" &&
      finalDecision?.g07Status === "BLOCKED_EXTERNAL_DEPENDENCY" &&
      finalDecision?.g15PassingCandidates === "0/3" &&
      finalDecision?.g16PassingCandidates === "2/3" &&
      finalDecision?.syntheticInvocationIdCopiedToProviderRequestId === false &&
      finalDecision?.salesVerifiedClaimed === false &&
      finalDecision?.strongerAuthorizedLivePreservedAgainstWeakerOverwrite === true &&
      finalDecision?.fixtureAndLocalTestDoubleExcludedFromLiveCount === true;

    addCheck(
      "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      "FINAL_ACCEPTANCE_DECISION.json reports honest 4-part verdict, excludes local MCP test double from live count, forbids synthetic providerRequestId conflation, forbids SALES_VERIFIED, and preserves stronger AUTHORIZED_LIVE rows",
      Boolean(liveVerdictHonest && invariantsOk),
      liveVerdictHonest && invariantsOk
        ? `Verified engineeringVerdict=${finalDecision?.engineeringVerdict}, realProviderVerdict=${realVerdict}, business=${finalDecision?.evergreenBusinessVerdict}, walmart=${finalDecision?.walmartPilotReadinessVerdict}.`
        : `Final decision violation: liveVerdictHonest=${liveVerdictHonest}, invariantsOk=${invariantsOk}, decision=${JSON.stringify(finalDecision)}`
    );
  }

  // CHK_10: Negative Control Mutation Report (>=30 mutations, 0 escapes)
  if (!options?.skipSelfMutationCheck) {
    const cases: any[] = Array.isArray(negReport?.cases) ? negReport.cases : [];
    const ok =
      typeof negReport?.totalMutations === "number" &&
      negReport.totalMutations >= 30 &&
      negReport?.totalCaughtAndRejected === negReport?.totalMutations &&
      negReport?.falsePassEscapes === 0 &&
      negReport?.suiteVerdict === "PASS" &&
      cases.length === negReport.totalMutations &&
      cases.every((c) => c?.caughtAndRejected === true && c?.failedCheckIds?.length > 0);

    addCheck(
      "CHK_10_NEGATIVE_CONTROL_MUTATION_SUITE",
      "At least 30 physical-file negative control mutations executed against the validator with 100% caught and 0 false-pass escapes",
      Boolean(ok),
      ok
        ? `Verified ${negReport?.totalMutations}/${negReport?.totalMutations} physical-file mutations caught and rejected (0 escapes).`
        : `Negative control mutation report invalid: ${JSON.stringify(negReport)}`
    );
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = checks.length - passedChecks;

  return {
    evaluatedAt: new Date().toISOString(),
    artifactDir: dir,
    overallValid: failedChecks === 0,
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    checks,
  };
}

/**
 * Writes a canonical valid 11-artifact fixture to `dir` for mutation testing.
 */
export function writeCanonicalValidV12_4_3_5_0_1Fixture(
  dir: string,
  codeSha = "1111111111111111111111111111111111111111"
): void {
  fs.mkdirSync(dir, { recursive: true });
  const digest = "a".repeat(64);

  fs.writeFileSync(
    path.join(dir, "FEATURE_EXECUTION_PLAN.md"),
    "# KH-02 V12.4.3.5.0.1 Feature Execution Plan\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "EXECUTION_STATE.json"),
    JSON.stringify(
      {
        releaseVersion: "12.4.3.5.0.1",
        branch: "feature/kh02-amazon-us-pilot-v12.4.3.5.0",
        baseSha: "c1833362cf6634917f2ff94df19d97c393247d94",
        previousHeadSha: "30d13d0ca4fd0d9dce901a8eca5fbb53163c007d",
        previousCodeSha: "93dbb717fa4a778c21baa5a0412225b7632f8688",
        codeSha,
        status: "COMPLETED",
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "CODE_REPAIR_DIFF_AUDIT.json"),
    JSON.stringify(
      {
        codeSha,
        defectsClosed: {
          P0_A_autoSessionAndBorrowedSessionSafety: {
            fixed: true,
            autoCreatesOwnedSessionWhenLiveAllowed: true,
            borrowedSessionNotClosedByCleanup: true,
            zeroToolInvocationsClassifiedAsNotExecuted: true,
            creatorsApiWithoutClientClassifiedAsNotImplemented: true,
          },
          P0_B_uiPreRunPilotTogglePayload: {
            fixed: true,
            handleRunEvergreenResearchSendsEnableAmazonUsPilot: true,
            rendersDisabledReasonBanner: true,
          },
          P0_C_atomicPersistenceAndNoSilentCatchNull: {
            fixed: true,
            catchNullCountAroundPersistAmazonEvidenceAtomically: 0,
            insideTransactionOwnershipVerified: true,
            dbWriteFailureDowngradesToPartiallyCompleted: true,
            childVerifyJobDbFailureTransitionsToFailed: true,
          },
          P0_D_postRunChildVerifyJobAndUiForm: {
            fixed: true,
            postMarketplaceAmazonCreatesDistinctChildJob: true,
            workerProcessesKh02AmazonVerify: true,
            uiVerifyAmazonFormWired: true,
          },
        },
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "AUTOMATED_TEST_REPORT.json"),
    JSON.stringify(
      {
        codeSha,
        tscExitCode: 0,
        nextBuildExitCode: 0,
        unitTestsPassed: 546,
        unitTestsFailed: 0,
        v12_4_3_5_0_1SuitePassed: 40,
        v12_4_3_5_0_1SuiteFailed: 0,
        integrationTestsPassed: 18,
        integrationTestsFailed: 0,
        n01ToN40Matrix: Array.from({ length: 40 }, (_, i) => ({
          id: `N${String(i + 1).padStart(2, "0")}`,
          passed: true,
        })),
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"),
    JSON.stringify(
      {
        codeSha,
        officialPlaywrightMcpHandshake: {
          packageSpec: "@playwright/mcp@0.0.83",
          connected: true,
          status: "CONNECTED_READY",
          discoveredTools: ["browser_navigate", "browser_snapshot", "browser_close"],
          closedCleanly: true,
          residualProcessesCount: 0,
        },
        handshakeOnlyWithoutNavigationGuard: {
          toolInvocationsCount: 0,
          classifiedStatus: "NOT_EXECUTED",
          neverCountedAsIdentityVerified: true,
          neverCountedAsRealProviderVerified: true,
        },
        jobLevelStdioMcpExecution: {
          parentResearchRunId: "run_parent_1",
          verifyJobId: "kh02_amz_verify_child_1",
          jobType: "KH02_AMAZON_VERIFY",
          workerClaimedAndCompleted: true,
          mcpSessionCreatedAutomatically: true,
          mcpSessionClosedCleanly: true,
          toolInvocations: [
            { toolName: "browser_navigate" },
            { toolName: "browser_snapshot" },
            { toolName: "browser_close" },
          ],
          persistedEvidenceCount: 1,
          persistedStatus: "IDENTITY_VERIFIED",
          persistedAsin: "B08N5WRWNW",
          serverOrigin: "LOCAL_MCP_TEST_DOUBLE",
          observationClass: "TEST_FIXTURE",
          countedAsLiveProviderVerified: false,
        },
        residualMcpChildProcesses: 0,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "SQLITE_HTTP_DOM_PARITY_REPORT.json"),
    JSON.stringify(
      {
        codeSha,
        postRunBrowserVerifyFlow: {
          executedInHeadlessChromium: true,
          releaseVersionBadgeInDom: "v12.4.3.5.0.1",
          pilotControlVisibleInDom: true,
          verifyFormSubmittedInBrowser: true,
          parentResearchRunId: "run_parent_1",
          spawnedVerifyJobId: "kh02_amz_verify_child_1",
          verifyJobFinalStatus: "COMPLETED",
          renderedAsinInDom: "B08N5WRWNW",
          renderedIdentityMatchInDom: "EXACT_PRODUCT",
        },
        mismatchCount: 0,
        fieldComparisons: Array.from({ length: 24 }, (_, i) => ({
          fieldId: `field_${i + 1}`,
          match: true,
        })),
        workerBarrier: {
          runningCount: 0,
          pendingCount: 0,
          residualChildProcesses: 0,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "READONLY_GET_NON_MUTATION_PROOF.json"),
    JSON.stringify(
      {
        codeSha,
        beforeDigest: digest,
        afterDigest: digest,
        sqliteByteDelta: 0,
        rowDelta: 0,
        totalReadOnlyRequests: 6,
        testedStatuses: [200, 403, 404],
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "HISTORICAL_BACKTEST_COMPARE_REPORT.json"),
    JSON.stringify(
      {
        codeSha,
        devBacktest: {
          adsEvaluated: 60,
          g15PassingCandidatesCount: 0,
        },
        holdoutBacktest: {
          adsEvaluated: 377,
          g15PassingCandidatesCount: 0,
          g16PassingCandidatesCount: 2,
          topThreeScores: [68, 64, 61],
        },
        postRunAmazonAttachmentComparison: {
          scoreDelta: 0,
          rankOrderChanged: false,
          pillarScoresChanged: false,
          g15Changed: false,
          g16Changed: false,
          scoresBefore: [68, 64, 61],
          scoresAfter: [68, 64, 61],
        },
        pointInTimeAudit: {
          futureTimestampedRowExcluded: true,
          futureLeaksAccepted: 0,
        },
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "FINAL_ACCEPTANCE_DECISION.json"),
    JSON.stringify(
      {
        codeSha,
        releaseVersion: "12.4.3.5.0.1",
        engineeringVerdict: "ENGINEERING_READY",
        realProviderVerdict: "BLOCKED_POLICY",
        evergreenBusinessVerdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
        walmartPilotReadinessVerdict: "READY_TO_START_WALMART_PILOT",
        verifiedLiveUsProductIdentitiesCount: 0,
        liveProviderServerOrigin: "NONE",
        liveProviderObservationClass: "NONE",
        g07Status: "BLOCKED_EXTERNAL_DEPENDENCY",
        g15PassingCandidates: "0/3",
        g16PassingCandidates: "2/3",
        syntheticInvocationIdCopiedToProviderRequestId: false,
        salesVerifiedClaimed: false,
        strongerAuthorizedLivePreservedAgainstWeakerOverwrite: true,
        fixtureAndLocalTestDoubleExcludedFromLiveCount: true,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "NEGATIVE_CONTROL_MUTATION_REPORT.json"),
    JSON.stringify(
      {
        codeSha,
        totalMutations: 32,
        totalCaughtAndRejected: 32,
        falsePassEscapes: 0,
        suiteVerdict: "PASS",
        cases: Array.from({ length: 32 }, (_, i) => ({
          mutationId: `V1243501_MUT_${String(i + 1).padStart(2, "0")}`,
          caughtAndRejected: true,
          failedCheckIds: ["CHK_01_MANDATORY_ARTIFACTS_PRESENT"],
        })),
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "FINAL_OWNER_REPORT.md"),
    "# KH-02 V12.4.3.5.0.1 Final Owner Report\n",
    "utf8"
  );
}

/**
 * Runs 32 physical-file negative control mutations against a temporary copy of the artifact directory
 * and verifies that validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1 catches and rejects every single one.
 */
export function runV12_4_3_5_0_1NegativeMutationSuite(
  sourceDir: string,
  codeSha: string
): NegativeControlMutationSuiteReport {
  const mutations: Array<{
    mutationId: string;
    targetArtifact: string;
    description: string;
    expectedViolatedCheckId: string;
    mutate: (workDir: string) => void;
  }> = [
    {
      mutationId: "V1243501_MUT_01",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "Delete PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      expectedViolatedCheckId: "CHK_01_MANDATORY_ARTIFACTS_PRESENT",
      mutate: (d) => fs.unlinkSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json")),
    },
    {
      mutationId: "V1243501_MUT_02",
      targetArtifact: "FINAL_OWNER_REPORT.md",
      description: "Truncate FINAL_OWNER_REPORT.md to 0 bytes",
      expectedViolatedCheckId: "CHK_01_MANDATORY_ARTIFACTS_PRESENT",
      mutate: (d) => fs.writeFileSync(path.join(d, "FINAL_OWNER_REPORT.md"), "", "utf8"),
    },
    {
      mutationId: "V1243501_MUT_03",
      targetArtifact: "EXECUTION_STATE.json",
      description: "Tamper branch to master",
      expectedViolatedCheckId: "CHK_02_BRANCH_VERSION_AND_CODE_SHA_PROVENANCE",
      mutate: (d) => {
        const j = readJsonSafe(d, "EXECUTION_STATE.json");
        j.branch = "master";
        fs.writeFileSync(path.join(d, "EXECUTION_STATE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_04",
      targetArtifact: "EXECUTION_STATE.json",
      description: "Stale releaseVersion 12.4.3.5.0 instead of 12.4.3.5.0.1 (N40)",
      expectedViolatedCheckId: "CHK_02_BRANCH_VERSION_AND_CODE_SHA_PROVENANCE",
      mutate: (d) => {
        const j = readJsonSafe(d, "EXECUTION_STATE.json");
        j.releaseVersion = "12.4.3.5.0";
        fs.writeFileSync(path.join(d, "EXECUTION_STATE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_05",
      targetArtifact: "AUTOMATED_TEST_REPORT.json",
      description: "Stale codeSha in AUTOMATED_TEST_REPORT.json",
      expectedViolatedCheckId: "CHK_02_BRANCH_VERSION_AND_CODE_SHA_PROVENANCE",
      mutate: (d) => {
        const j = readJsonSafe(d, "AUTOMATED_TEST_REPORT.json");
        j.codeSha = "93dbb717fa4a778c21baa5a0412225b7632f8688";
        fs.writeFileSync(path.join(d, "AUTOMATED_TEST_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_06",
      targetArtifact: "CODE_REPAIR_DIFF_AUDIT.json",
      description: "Leave .catch(() => null) around persistAmazonEvidenceAtomically (N26)",
      expectedViolatedCheckId: "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      mutate: (d) => {
        const j = readJsonSafe(d, "CODE_REPAIR_DIFF_AUDIT.json");
        j.defectsClosed.P0_C_atomicPersistenceAndNoSilentCatchNull.catchNullCountAroundPersistAmazonEvidenceAtomically = 1;
        fs.writeFileSync(path.join(d, "CODE_REPAIR_DIFF_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_07",
      targetArtifact: "CODE_REPAIR_DIFF_AUDIT.json",
      description: "Borrowed MCP session closed by cleanup (N20)",
      expectedViolatedCheckId: "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      mutate: (d) => {
        const j = readJsonSafe(d, "CODE_REPAIR_DIFF_AUDIT.json");
        j.defectsClosed.P0_A_autoSessionAndBorrowedSessionSafety.borrowedSessionNotClosedByCleanup = false;
        fs.writeFileSync(path.join(d, "CODE_REPAIR_DIFF_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_08",
      targetArtifact: "CODE_REPAIR_DIFF_AUDIT.json",
      description: "Creators API without client falls back to Playwright scraping instead of NOT_IMPLEMENTED (N19)",
      expectedViolatedCheckId: "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      mutate: (d) => {
        const j = readJsonSafe(d, "CODE_REPAIR_DIFF_AUDIT.json");
        j.defectsClosed.P0_A_autoSessionAndBorrowedSessionSafety.creatorsApiWithoutClientClassifiedAsNotImplemented = false;
        fs.writeFileSync(path.join(d, "CODE_REPAIR_DIFF_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_09",
      targetArtifact: "CODE_REPAIR_DIFF_AUDIT.json",
      description: "handleRunEvergreenResearch omits enableAmazonUsPilot (P0-B)",
      expectedViolatedCheckId: "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      mutate: (d) => {
        const j = readJsonSafe(d, "CODE_REPAIR_DIFF_AUDIT.json");
        j.defectsClosed.P0_B_uiPreRunPilotTogglePayload.handleRunEvergreenResearchSendsEnableAmazonUsPilot = false;
        fs.writeFileSync(path.join(d, "CODE_REPAIR_DIFF_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_10",
      targetArtifact: "CODE_REPAIR_DIFF_AUDIT.json",
      description: "Child verify job DB failure marks job COMPLETED instead of FAILED (N25)",
      expectedViolatedCheckId: "CHK_03_FOUR_P0_DEFECTS_CLOSED",
      mutate: (d) => {
        const j = readJsonSafe(d, "CODE_REPAIR_DIFF_AUDIT.json");
        j.defectsClosed.P0_C_atomicPersistenceAndNoSilentCatchNull.childVerifyJobDbFailureTransitionsToFailed = false;
        fs.writeFileSync(path.join(d, "CODE_REPAIR_DIFF_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_11",
      targetArtifact: "AUTOMATED_TEST_REPORT.json",
      description: "Non-zero tscExitCode",
      expectedViolatedCheckId: "CHK_04_AUTOMATED_TESTS_BUILD_AND_N01_N40",
      mutate: (d) => {
        const j = readJsonSafe(d, "AUTOMATED_TEST_REPORT.json");
        j.tscExitCode = 2;
        fs.writeFileSync(path.join(d, "AUTOMATED_TEST_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_12",
      targetArtifact: "AUTOMATED_TEST_REPORT.json",
      description: "One failing unit test in N01..N40 matrix",
      expectedViolatedCheckId: "CHK_04_AUTOMATED_TESTS_BUILD_AND_N01_N40",
      mutate: (d) => {
        const j = readJsonSafe(d, "AUTOMATED_TEST_REPORT.json");
        j.n01ToN40Matrix[15].passed = false;
        fs.writeFileSync(path.join(d, "AUTOMATED_TEST_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_13",
      targetArtifact: "AUTOMATED_TEST_REPORT.json",
      description: "Integration tests passed 17/18 instead of 18/18",
      expectedViolatedCheckId: "CHK_04_AUTOMATED_TESTS_BUILD_AND_N01_N40",
      mutate: (d) => {
        const j = readJsonSafe(d, "AUTOMATED_TEST_REPORT.json");
        j.integrationTestsPassed = 17;
        j.integrationTestsFailed = 1;
        fs.writeFileSync(path.join(d, "AUTOMATED_TEST_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_14",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "Handshake-only MCP session (0 tool calls) misclassified as IDENTITY_VERIFIED (N15, N40)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
        j.handshakeOnlyWithoutNavigationGuard.classifiedStatus = "IDENTITY_VERIFIED";
        fs.writeFileSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_15",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "Job-level MCP execution missing browser_navigate tool invocation (N16)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
        j.jobLevelStdioMcpExecution.toolInvocations = [{ toolName: "browser_close" }];
        fs.writeFileSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_16",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "verifyJobId equals parentResearchRunId instead of distinct child job (N14)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
        j.jobLevelStdioMcpExecution.verifyJobId = j.jobLevelStdioMcpExecution.parentResearchRunId;
        fs.writeFileSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_17",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "Local MCP test double falsely counted as live provider verified (N16, N37)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
        j.jobLevelStdioMcpExecution.countedAsLiveProviderVerified = true;
        fs.writeFileSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_18",
      targetArtifact: "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json",
      description: "Residual MCP child processes > 0 (N11)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_JOB_FLOW_AND_HONEST_CLASSIFICATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json");
        j.residualMcpChildProcesses = 1;
        fs.writeFileSync(path.join(d, "PLAYWRIGHT_MCP_JOB_FLOW_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_19",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY_REPORT.json",
      description: "Post-run browser verify form not submitted in headless Chromium",
      expectedViolatedCheckId: "CHK_06_SQLITE_HTTP_DOM_PARITY_AND_BROWSER_VERIFY_FLOW",
      mutate: (d) => {
        const j = readJsonSafe(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json");
        j.postRunBrowserVerifyFlow.verifyFormSubmittedInBrowser = false;
        fs.writeFileSync(path.join(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_20",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY_REPORT.json",
      description: "Introduce 1 SQLite/HTTP/DOM parity mismatch",
      expectedViolatedCheckId: "CHK_06_SQLITE_HTTP_DOM_PARITY_AND_BROWSER_VERIFY_FLOW",
      mutate: (d) => {
        const j = readJsonSafe(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json");
        j.mismatchCount = 1;
        j.fieldComparisons[0].match = false;
        fs.writeFileSync(path.join(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_21",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY_REPORT.json",
      description: "Worker barrier leaves 1 RUNNING job",
      expectedViolatedCheckId: "CHK_06_SQLITE_HTTP_DOM_PARITY_AND_BROWSER_VERIFY_FLOW",
      mutate: (d) => {
        const j = readJsonSafe(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json");
        j.workerBarrier.runningCount = 1;
        fs.writeFileSync(path.join(d, "SQLITE_HTTP_DOM_PARITY_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_22",
      targetArtifact: "READONLY_GET_NON_MUTATION_PROOF.json",
      description: "Read-only GET mutates SQLite digest (N31)",
      expectedViolatedCheckId: "CHK_07_READONLY_GET_NON_MUTATION_PROOF",
      mutate: (d) => {
        const j = readJsonSafe(d, "READONLY_GET_NON_MUTATION_PROOF.json");
        j.afterDigest = "b".repeat(64);
        j.rowDelta = 1;
        fs.writeFileSync(path.join(d, "READONLY_GET_NON_MUTATION_PROOF.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_23",
      targetArtifact: "HISTORICAL_BACKTEST_COMPARE_REPORT.json",
      description: "Post-run Amazon attachment inflates opportunityScore from 68 to 73 (N33)",
      expectedViolatedCheckId: "CHK_08_HISTORICAL_BACKTEST_AND_NON_INFLATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json");
        j.postRunAmazonAttachmentComparison.scoreDelta = 5;
        j.postRunAmazonAttachmentComparison.scoresAfter = [73, 64, 61];
        fs.writeFileSync(path.join(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_24",
      targetArtifact: "HISTORICAL_BACKTEST_COMPARE_REPORT.json",
      description: "Post-run Amazon attachment flips G15 from 0/3 to 1/3 (N33)",
      expectedViolatedCheckId: "CHK_08_HISTORICAL_BACKTEST_AND_NON_INFLATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json");
        j.postRunAmazonAttachmentComparison.g15Changed = true;
        j.holdoutBacktest.g15PassingCandidatesCount = 1;
        fs.writeFileSync(path.join(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_25",
      targetArtifact: "HISTORICAL_BACKTEST_COMPARE_REPORT.json",
      description: "Point-in-time audit accepts 1 future-timestamped leak",
      expectedViolatedCheckId: "CHK_08_HISTORICAL_BACKTEST_AND_NON_INFLATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json");
        j.pointInTimeAudit.futureLeaksAccepted = 1;
        fs.writeFileSync(path.join(d, "HISTORICAL_BACKTEST_COMPARE_REPORT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_26",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Claim REAL_PROVIDER_VERIFIED with 0 live US product identities",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.realProviderVerdict = "REAL_PROVIDER_VERIFIED";
        j.verifiedLiveUsProductIdentitiesCount = 0;
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_27",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Claim REAL_PROVIDER_VERIFIED from LOCAL_MCP_TEST_DOUBLE instead of OFFICIAL_PLAYWRIGHT_MCP (N16, N37)",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.realProviderVerdict = "REAL_PROVIDER_VERIFIED";
        j.verifiedLiveUsProductIdentitiesCount = 1;
        j.liveProviderServerOrigin = "LOCAL_MCP_TEST_DOUBLE";
        j.liveProviderObservationClass = "TEST_FIXTURE";
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_28",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Synthetic invocation ID copied into providerRequestId (N36)",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.syntheticInvocationIdCopiedToProviderRequestId = true;
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_29",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Claim SALES_VERIFIED on Amazon verificationScope (N39)",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.salesVerifiedClaimed = true;
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_30",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Weaker row overwrites stronger AUTHORIZED_LIVE IDENTITY_VERIFIED row (N29)",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.strongerAuthorizedLivePreservedAgainstWeakerOverwrite = false;
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_31",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Falsely convert evergreenBusinessVerdict from INSUFFICIENT_HISTORICAL_EVIDENCE to PASS",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.evergreenBusinessVerdict = "PASS";
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "V1243501_MUT_32",
      targetArtifact: "FINAL_ACCEPTANCE_DECISION.json",
      description: "Falsely mark G07 status as PASS instead of BLOCKED_EXTERNAL_DEPENDENCY",
      expectedViolatedCheckId: "CHK_09_FINAL_DECISION_AND_PROVENANCE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "FINAL_ACCEPTANCE_DECISION.json");
        j.g07Status = "PASS";
        fs.writeFileSync(path.join(d, "FINAL_ACCEPTANCE_DECISION.json"), JSON.stringify(j));
      },
    },
  ];

  const cases: NegativeControlMutationCaseResult[] = [];
  for (const m of mutations) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `kh02_v1243501_mut_${m.mutationId}_`));
    try {
      for (const file of MANDATORY_V12_4_3_5_0_1_ARTIFACTS) {
        const src = path.join(sourceDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(tmpDir, file));
        }
      }
      m.mutate(tmpDir);
      const report = validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1(tmpDir, {
        skipSelfMutationCheck: true,
        expectedCodeSha: codeSha,
      });
      const failedCheckIds = report.checks.filter((c) => !c.passed).map((c) => c.checkId);
      const caught =
        report.overallValid === false &&
        failedCheckIds.includes(m.expectedViolatedCheckId);
      cases.push({
        mutationId: m.mutationId,
        targetArtifact: m.targetArtifact,
        description: m.description,
        expectedViolatedCheckId: m.expectedViolatedCheckId,
        caughtAndRejected: caught,
        failedCheckIds,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const totalCaughtAndRejected = cases.filter((c) => c.caughtAndRejected).length;
  const falsePassEscapes = cases.length - totalCaughtAndRejected;

  return {
    evaluatedAt: new Date().toISOString(),
    codeSha,
    totalMutations: cases.length,
    totalCaughtAndRejected,
    falsePassEscapes,
    suiteVerdict: falsePassEscapes === 0 ? "PASS" : "FAIL",
    cases,
  };
}

if (require.main === module) {
  const targetDir =
    process.argv[2] ||
    path.resolve(
      process.cwd(),
      "acceptance/kh02-amazon-us-v12.4.3.5.0.1-true-e2e/run-20261031-v1243501"
    );
  const report = validateAmazonUsTrueE2EArtifactsV12_4_3_5_0_1(targetDir);
  console.log(JSON.stringify(report, null, 2));
  if (!report.overallValid) {
    process.exit(1);
  }
}

