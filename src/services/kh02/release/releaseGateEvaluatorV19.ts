/**
 * SWAI KH-02 — V12.4.3.7.19
 * Real Derived Release Gate Evaluator (Workstream E)
 *
 * Replaces hardcoded constant booleans with a deterministic, evidence-derived
 * evaluator ingesting actual test results, run artifacts, and environment state.
 *
 * Distinct Fourfold Verdicts:
 * 1. ENGINEERING: PASS / FAIL / INCOMPLETE
 * 2. STAGING: CONTRACT_READY / EXECUTED_PASS / NOT_RUN / FAIL
 * 3. BUSINESS: SUFFICIENT / INSUFFICIENT / BLOCKED
 * 4. CI: PASS / FAIL / NOT_RUN / NOT_CONFIGURED
 */

import { verifyCiAttestationToken } from "./githubActionsCiEvidence";

export interface ReleaseEvidenceInput {
  version: string;
  branch: string;
  baselineSha: string;
  testedCodeSha: string;
  testedTreeSha?: string;
  reportGeneratedAt: string;
  testCommand: string;
  exitCode: number;
  realTotal: number;
  realPassed: number;
  realFailed: number;
  realSkipped: number;
  commandLogLocation?: string;
  commandLogDigest?: string;
  runMode: "OFFLINE_CONTRACT_CHECK" | "STAGING_RUNTIME_SHADOW";
  environmentId?: string;
  environmentFingerprint?: string;
  operationCounters?: {
    totalAttempts: number;
    successes: number;
    failures: number;
    blockedCalls: number;
  };
  providerSourceCounters?: {
    googleTrendsCsvCount: number;
    userManualCount: number;
    providerApiCount: number;
    notRunNoAuthorizedProviderCount: number;
  };
  evidenceProofCounters?: {
    rawRowsVerified: number;
    liveOriginProofs: number;
    fixtureOnlyCount: number;
  };
  fullSuiteCoverage?: {
    unitPassed: boolean;
    integrationPassed: boolean;
    backtestPassed: boolean;
    kh01VerifyPassed: boolean;
  };
  ciStatus?: {
    configured: boolean;
    runStatus?: "SUCCESS" | "FAILURE" | "PENDING" | "NOT_RUN";
    workflowName?: string;
    runId?: string;
    commitSha?: string;
    verifiedProof?: {
      verified: boolean;
      attestation?: any;
    };
  };
  backtestResults?: {
    devHistoricalPassed: boolean;
    holdoutHistoricalPassed: boolean;
    policyReplayPassed: boolean;
  };
  stagingRuntime?: {
    endpointUrl?: string;
    isProductionDenylisted?: boolean;
    executed?: boolean;
    isolatedNamespaceVerified?: boolean;
    zeroProductionMutations?: boolean;
    readinessStatus?: "CONTRACT_READY" | "EXECUTED_PASS" | "EXECUTED_FAIL" | "NOT_RUN";
    notRunReason?: string;
  };
  businessG06Status?: "TRANSPORT_READY_NOT_VERIFIED" | "BLOCKED" | "VERIFIED" | string;
  businessG07Status?: "BLOCKED" | "VERIFIED" | string;
  callerSuppliedStaticPass?: boolean;
}

export type EngineeringVerdict = "ENGINEERING_PASS" | "ENGINEERING_FAIL" | "ENGINEERING_INCOMPLETE";
export type StagingVerdict = "STAGING_SHADOW_CONTRACT_READY" | "STAGING_RUNTIME_NOT_RUN" | "STAGING_SHADOW_EXECUTED_PASS" | "STAGING_SHADOW_EXECUTED_FAIL";
export type BusinessVerdict = "BUSINESS_EVIDENCE_SUFFICIENT" | "INSUFFICIENT_EVIDENCE" | "BLOCKED";
export type CiVerdict = "CI_PASS" | "CI_FAIL" | "CI_NOT_RUN" | "CI_NOT_CONFIGURED";

export interface ReleaseGateVerdict {
  engineeringStatus: EngineeringVerdict;
  stagingStatus: StagingVerdict;
  businessStatus: BusinessVerdict;
  ciStatus: CiVerdict;
  overallReleaseAllowed: boolean;
  reasons: string[];
  blockerList: string[];
  evaluatedAt: string;
  evaluatorVersion: string;
}

const PRODUCTION_HOST_PATTERNS = [
  /api\.shopify\.com/i,
  /shopifysearch\.com/i,
  /production/i,
  /live-api/i,
];

/**
 * Sanitizes strings to prevent credential or secret leakage in reports.
 */
export function sanitizeReleaseLog(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/(?:(?:api[_-]?key|signing[_-]?key|key|token|secret|password)[=:]\s*|bearer\s+)([a-zA-Z0-9_\-\.]{8,})/gi, "REDACTED_SECRET")
    .replace(/\b[a-f0-9]{32,64}\b/gi, (match) => {
      // Retain 64-hex SHA-256 digests, but redact 32-hex API keys
      if (match.length === 64) return match;
      return "REDACTED_HEX_KEY";
    });
}

/**
 * Pure, deterministic release gate evaluator.
 */
export function evaluateReleaseEvidence(
  input: ReleaseEvidenceInput,
  options: {
    expectedBranch?: string;
    expectedTestedSha?: string;
    minLiveOriginProofsForBusiness?: number;
  } = {}
): ReleaseGateVerdict {
  const evaluatedAt = new Date().toISOString();
  const reasons: string[] = [];
  const blockerList: string[] = [];

  let engineeringStatus: EngineeringVerdict = "ENGINEERING_PASS";
  let stagingStatus: StagingVerdict = "STAGING_RUNTIME_NOT_RUN";
  let businessStatus: BusinessVerdict = "INSUFFICIENT_EVIDENCE";
  let ciStatus: CiVerdict = "CI_NOT_CONFIGURED";

  // 1. Check for caller-supplied static assertions without actual run logs (Defect P1-C)
  if (input.callerSuppliedStaticPass === true) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push("Caller-supplied static PASS assertions rejected: release gate requires derived evidence from actual test execution.");
    blockerList.push("STATIC_PASS_ASSERTION_REJECTED");
  }

  // 2. Check exit code
  if (input.exitCode !== 0) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push(`Test command failed with exitCode ${input.exitCode}.`);
    blockerList.push("TEST_COMMAND_NON_ZERO_EXIT");
  }

  // 3. Check test counts integrity
  if (input.realTotal === 0) {
    engineeringStatus = "ENGINEERING_INCOMPLETE";
    reasons.push("Zero tests executed: test suite is empty or unexecuted.");
    blockerList.push("ZERO_TESTS_EXECUTED");
  }

  if (input.realFailed > 0) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push(`Test execution recorded ${input.realFailed} failing test(s).`);
    blockerList.push("TEST_FAILURES_PRESENT");
  }

  const computedTotal = input.realPassed + input.realFailed + input.realSkipped;
  if (input.realTotal !== computedTotal) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push(`Test count mismatch: declared total (${input.realTotal}) != passed+failed+skipped (${computedTotal}).`);
    blockerList.push("TEST_COUNT_MISMATCH");
  }

  // 4. Check suite coverage
  if (!input.fullSuiteCoverage) {
    if (engineeringStatus !== "ENGINEERING_FAIL") {
      engineeringStatus = "ENGINEERING_INCOMPLETE";
    }
    reasons.push("Mandatory suite coverage missing: fullSuiteCoverage input is strictly required for ENGINEERING_PASS.");
    blockerList.push("MISSING_SUITE_COVERAGE");
  } else {
    const { unitPassed, integrationPassed, backtestPassed, kh01VerifyPassed } = input.fullSuiteCoverage;
    if (!unitPassed || !integrationPassed || !backtestPassed || !kh01VerifyPassed) {
      if (engineeringStatus !== "ENGINEERING_FAIL") {
        engineeringStatus = "ENGINEERING_INCOMPLETE";
      }
      reasons.push(`Mandatory suite coverage incomplete: unit=${unitPassed}, integration=${integrationPassed}, backtest=${backtestPassed}, kh01=${kh01VerifyPassed}.`);
      blockerList.push("INCOMPLETE_SUITE_COVERAGE");
    }
  }

  // 5. Stale SHA check
  if (options.expectedTestedSha && input.testedCodeSha !== options.expectedTestedSha) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push(`Stale testedCodeSha '${input.testedCodeSha}': does not match expected baseline '${options.expectedTestedSha}'.`);
    blockerList.push("STALE_TESTED_SHA");
  }

  if (options.expectedBranch && input.branch !== options.expectedBranch) {
    engineeringStatus = "ENGINEERING_FAIL";
    reasons.push(`Branch mismatch: on '${input.branch}', expected locked branch '${options.expectedBranch}'.`);
    blockerList.push("BRANCH_MISMATCH");
  }

  // 6. Staging Shadow Evaluation
  if (input.runMode === "OFFLINE_CONTRACT_CHECK") {
    stagingStatus = "STAGING_SHADOW_CONTRACT_READY";
    reasons.push("Staging evaluated in OFFLINE_CONTRACT_CHECK mode: contracts and safety validated on isolated DB; no staging deployment executed.");
  } else if (input.runMode === "STAGING_RUNTIME_SHADOW") {
    const stg = input.stagingRuntime;
    if (!stg || !stg.endpointUrl || stg.executed === false) {
      stagingStatus = "STAGING_RUNTIME_NOT_RUN";
      reasons.push(`Staging shadow runtime not executed: ${stg?.notRunReason || "No staging environment URL configured."}`);
    } else {
      // Validate staging safety guards
      let isUnsafe = false;
      for (const pat of PRODUCTION_HOST_PATTERNS) {
        if (pat.test(stg.endpointUrl)) {
          isUnsafe = true;
          break;
        }
      }
      if (isUnsafe || stg.isProductionDenylisted === false) {
        stagingStatus = "STAGING_SHADOW_EXECUTED_FAIL";
        reasons.push(`Staging safety violation: target endpoint '${stg.endpointUrl}' matched production host or lacks production denylist.`);
        blockerList.push("PRODUCTION_ENDPOINT_TARGETED");
      } else if (!stg.isolatedNamespaceVerified || !stg.zeroProductionMutations) {
        stagingStatus = "STAGING_SHADOW_EXECUTED_FAIL";
        reasons.push("Staging shadow isolation violated: namespace verification or zero-production-mutations check failed.");
        blockerList.push("STAGING_ISOLATION_FAILED");
      } else if (stg.readinessStatus === "EXECUTED_PASS") {
        stagingStatus = "STAGING_SHADOW_EXECUTED_PASS";
        reasons.push("Staging shadow executed successfully with verified tenant isolation and zero production mutations.");
      } else {
        stagingStatus = "STAGING_SHADOW_EXECUTED_FAIL";
        reasons.push("Staging shadow runtime executed with failures.");
        blockerList.push("STAGING_EXECUTION_FAILED");
      }
    }
  }

  // 7. Business Evidence Readiness
  const liveProofs = input.evidenceProofCounters?.liveOriginProofs ?? 0;
  const fixtureCount = input.evidenceProofCounters?.fixtureOnlyCount ?? 0;
  const minRequired = options.minLiveOriginProofsForBusiness ?? 3;

  if (input.businessG06Status === "BLOCKED" || input.businessG07Status === "BLOCKED") {
    businessStatus = "BLOCKED";
    reasons.push("Business evidence blocked by upstream gate G06 or G07.");
    blockerList.push("UPSTREAM_BUSINESS_GATE_BLOCKED");
  } else if (liveProofs === 0) {
    businessStatus = "INSUFFICIENT_EVIDENCE";
    reasons.push("Business evidence G06/G07/G15/G16 is INSUFFICIENT_EVIDENCE: zero live external provider proofs recorded (all data is fixture, CSV, or unverified).");
  } else if (liveProofs < minRequired) {
    businessStatus = "INSUFFICIENT_EVIDENCE";
    reasons.push(`Business evidence has ${liveProofs} live proof(s), but minimum ${minRequired} required for Evergreen verification.`);
  } else if (
    !input.backtestResults ||
    !input.backtestResults.policyReplayPassed ||
    !input.backtestResults.devHistoricalPassed ||
    !input.backtestResults.holdoutHistoricalPassed
  ) {
    businessStatus = "INSUFFICIENT_EVIDENCE";
    reasons.push("Historical backtest results missing or DEV/HOLDOUT checks failed to confirm longitudinal demand.");
  } else {
    businessStatus = "BUSINESS_EVIDENCE_SUFFICIENT";
    reasons.push("Business evidence confirmed with genuine live provider proofs across longitudinal history.");
  }

  // 8. CI Evaluation
  if (!input.ciStatus || input.ciStatus.configured === false) {
    ciStatus = "CI_NOT_CONFIGURED";
    reasons.push("Remote CI workflow is not configured or not observable from local environment.");
  } else if (input.ciStatus.runStatus === "NOT_RUN") {
    ciStatus = "CI_NOT_RUN";
    reasons.push("Remote CI workflow configured but not run for tested commit.");
  } else if (input.ciStatus.runStatus === "SUCCESS") {
    const proof = input.ciStatus.verifiedProof;
    const att = proof?.attestation || (proof as any)?.evidence || proof;
    const tokenCheck = att ? verifyCiAttestationToken(att) : { valid: false };
    const isAuthenticVerifier =
      proof?.verified === true &&
      att &&
      tokenCheck.valid === true &&
      tokenCheck.isUnitTestMock !== true &&
      att.provider === "github-actions" &&
      att.source === "GITHUB_API" &&
      att.isUnitTestMock !== true &&
      att.verifier === "SWAI_TRUSTED_GITHUB_VERIFIER_V1" &&
      att.status === "completed" &&
      att.conclusion === "success" &&
      (att.event === "push" || att.event === "workflow_dispatch") &&
      typeof att.responseDigest === "string" &&
      att.responseDigest.length === 64 &&
      (!input.testedCodeSha || (att.headSha && att.headSha === input.testedCodeSha) || (att.commitSha && att.commitSha === input.testedCodeSha));

    if (isAuthenticVerifier) {
      ciStatus = "CI_PASS";
      reasons.push("Remote CI workflow run succeeded with verified provider attestation.");
    } else {
      ciStatus = "CI_NOT_RUN";
      reasons.push("Caller-asserted CI SUCCESS rejected: unverified CI claim without authentic provider attestation (CI_CLAIM_UNVERIFIED).");
      blockerList.push("CI_CLAIM_UNVERIFIED");
    }
  } else if (input.ciStatus.runStatus === "FAILURE") {
    ciStatus = "CI_FAIL";
    reasons.push("Remote CI workflow run failed.");
    blockerList.push("CI_WORKFLOW_FAILED");
  } else {
    ciStatus = "CI_NOT_RUN";
  }

  // Overall release is allowed strictly when ALL independent gates pass (Workstream D & Defect P0-D fix)
  const overallReleaseAllowed =
    engineeringStatus === "ENGINEERING_PASS" &&
    stagingStatus === "STAGING_SHADOW_EXECUTED_PASS" &&
    businessStatus === "BUSINESS_EVIDENCE_SUFFICIENT" &&
    ciStatus === "CI_PASS";

  return {
    engineeringStatus,
    stagingStatus,
    businessStatus,
    ciStatus,
    overallReleaseAllowed,
    reasons,
    blockerList,
    evaluatedAt,
    evaluatorVersion: "12.4.3.7.19.1",
  };
}
