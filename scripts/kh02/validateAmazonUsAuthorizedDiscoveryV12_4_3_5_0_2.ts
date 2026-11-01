/**
 * SWAI KH-02 V12.4.3.5.0.2 — Independent Acceptance Validator & 45 Physical-File Negative Control Mutation Runner
 *
 * Validates all 22 required artifacts under `acceptance/kh02-amazon-us-v12.4.3.5.0.2-authorized-discovery/<run-id>/`
 * and executes 45 physical-file negative control mutations (N01..N45) to prove zero false-PASS escapes.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

export const MANDATORY_AMAZON_DISCOVERY_V12_4_3_5_0_2_ARTIFACTS = [
  "BASELINE_AND_BRANCH_PROOF.json",
  "FEATURE_EXECUTION_PLAN.md",
  "FEATURE_EXECUTION_STATE.json",
  "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json",
  "AMAZON_SEARCH_QUERY_PLAN.json",
  "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json",
  "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
  "AMAZON_MATCH_AND_IDENTITY_LEDGER.json",
  "MCP_RUNTIME_CLASSIFICATION.json",
  "SQLITE_HTTP_DOM_PARITY.json",
  "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
  "RAW_TEST_REPORT_MANIFEST.json",
  "FULL_REGRESSION_EXECUTION.json",
  "DEV_BACKTEST.json",
  "HOLDOUT_BACKTEST.json",
  "HISTORICAL_POINT_IN_TIME_AUDIT.json",
  "BEFORE_AFTER_NON_INFLATION_DIFF.json",
  "NEGATIVE_MUTATION_RESULTS.json",
  "RESOURCE_AND_ASYNC_EXECUTION.json",
  "ACCEPTANCE_MATRIX.json",
  "INDEPENDENT_ACCEPTANCE_VALIDATION.json",
  "FINAL_OWNER_REPORT.md",
] as const;

export interface ValidationCheckItem {
  checkId: string;
  description: string;
  passed: boolean;
  details: string;
}

export interface IndependentAcceptanceValidationResult {
  valid: boolean;
  evaluatedAt: string;
  artifactDir: string;
  expectedCodeSha: string | null;
  engineeringVerdict: "ENGINEERING_READY" | "ENGINEERING_FAILED";
  realProviderVerdict:
    | "REAL_PROVIDER_VERIFIED"
    | "BLOCKED_POLICY"
    | "BLOCKED_PROVIDER"
    | "CREDENTIALS_REQUIRED"
    | "INSUFFICIENT_EVIDENCE";
  overallClosureVerdict:
    | "FULL_LIVE_FEATURE_ACCEPTED"
    | "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER"
    | "ENGINEERING_FAILED";
  checksCount: number;
  passedChecksCount: number;
  failedChecksCount: number;
  checks: ValidationCheckItem[];
  failedReasons: string[];
}

function readJsonSafe(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2(
  artifactDir: string,
  options?: {
    expectedCodeSha?: string;
    skipSelfArtifactCheck?: boolean;
  }
): IndependentAcceptanceValidationResult {
  const evaluatedAt = new Date().toISOString();
  const checks: ValidationCheckItem[] = [];
  const addCheck = (
    checkId: string,
    description: string,
    passed: boolean,
    details: string
  ) => {
    checks.push({ checkId, description, passed, details });
  };

  // 1. Check required files exist and are non-empty
  const requiredList = options?.skipSelfArtifactCheck
    ? MANDATORY_AMAZON_DISCOVERY_V12_4_3_5_0_2_ARTIFACTS.filter(
        (f) =>
          f !== "INDEPENDENT_ACCEPTANCE_VALIDATION.json" &&
          f !== "FINAL_OWNER_REPORT.md" &&
          f !== "NEGATIVE_MUTATION_RESULTS.json"
      )
    : MANDATORY_AMAZON_DISCOVERY_V12_4_3_5_0_2_ARTIFACTS;

  const missingFiles: string[] = [];
  for (const f of requiredList) {
    const p = path.join(artifactDir, f);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      missingFiles.push(f);
    }
  }
  addCheck(
    "VAL_01_MANDATORY_ARTIFACTS_PRESENT",
    "All required V12.4.3.5.0.2 deliverable artifacts exist and are non-empty",
    missingFiles.length === 0,
    missingFiles.length === 0
      ? `Verified ${requiredList.length} artifacts present`
      : `Missing or empty artifacts: ${missingFiles.join(", ")}`
  );

  const baseline = readJsonSafe(
    path.join(artifactDir, "BASELINE_AND_BRANCH_PROOF.json")
  );
  const state = readJsonSafe(path.join(artifactDir, "FEATURE_EXECUTION_STATE.json"));
  const entitlement = readJsonSafe(
    path.join(artifactDir, "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json")
  );
  const queryPlan = readJsonSafe(
    path.join(artifactDir, "AMAZON_SEARCH_QUERY_PLAN.json")
  );
  const reqLedger = readJsonSafe(
    path.join(artifactDir, "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json")
  );
  const evManifest = readJsonSafe(
    path.join(artifactDir, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json")
  );
  const matchLedger = readJsonSafe(
    path.join(artifactDir, "AMAZON_MATCH_AND_IDENTITY_LEDGER.json")
  );
  const mcpClass = readJsonSafe(
    path.join(artifactDir, "MCP_RUNTIME_CLASSIFICATION.json")
  );
  const parity = readJsonSafe(path.join(artifactDir, "SQLITE_HTTP_DOM_PARITY.json"));
  const jobProof = readJsonSafe(
    path.join(artifactDir, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json")
  );
  const rawTestManifest = readJsonSafe(
    path.join(artifactDir, "RAW_TEST_REPORT_MANIFEST.json")
  );
  const fullReg = readJsonSafe(
    path.join(artifactDir, "FULL_REGRESSION_EXECUTION.json")
  );
  const devBt = readJsonSafe(path.join(artifactDir, "DEV_BACKTEST.json"));
  const holdoutBt = readJsonSafe(path.join(artifactDir, "HOLDOUT_BACKTEST.json"));
  const pitAudit = readJsonSafe(
    path.join(artifactDir, "HISTORICAL_POINT_IN_TIME_AUDIT.json")
  );
  const nonInflation = readJsonSafe(
    path.join(artifactDir, "BEFORE_AFTER_NON_INFLATION_DIFF.json")
  );
  const resourceExec = readJsonSafe(
    path.join(artifactDir, "RESOURCE_AND_ASYNC_EXECUTION.json")
  );
  const matrix = readJsonSafe(path.join(artifactDir, "ACCEPTANCE_MATRIX.json"));

  const expectedSha = options?.expectedCodeSha || baseline?.codeSha || null;

  // 2. Branch and CODE_SHA integrity (N01)
  const branchOk = Boolean(
    baseline &&
      baseline.branch === "feature/kh02-amazon-us-pilot-v12.4.3.5.0" &&
      typeof baseline.codeSha === "string" &&
      /^[0-9a-f]{40}$/.test(baseline.codeSha) &&
      (!expectedSha || baseline.codeSha === expectedSha) &&
      state?.codeSha === baseline.codeSha &&
      rawTestManifest?.codeSha === baseline.codeSha &&
      fullReg?.codeSha === baseline.codeSha
  );
  addCheck(
    "VAL_02_BRANCH_AND_CODE_SHA_LOCK",
    "Branch is feature/kh02-amazon-us-pilot-v12.4.3.5.0 and 40-hex CODE_SHA matches across all artifacts",
    branchOk,
    branchOk
      ? `Verified branch=${baseline?.branch} codeSha=${baseline?.codeSha}`
      : `Branch or CODE_SHA mismatch across baseline/state/test artifacts (baseline=${baseline?.codeSha}, expected=${expectedSha})`
  );

  // 3. Raw Test Report Manifest & Per-Test Verification (BUG T1 / N02, N03, N04, N05)
  const perTestCases: any[] = Array.isArray(rawTestManifest?.perTestResults)
    ? rawTestManifest.perTestResults
    : [];
  const seenTestIds = new Set<string>();
  let hasDuplicateTestId = false;
  let hasSkippedOrFailedCase = false;
  for (const tc of perTestCases) {
    const id = String(tc?.testId || "");
    if (!id || seenTestIds.has(id)) {
      hasDuplicateTestId = true;
    }
    seenTestIds.add(id);
    if (tc?.status !== "passed" || tc?.skipped === true) {
      hasSkippedOrFailedCase = true;
    }
  }
  const hasN01ToN40 = Array.from({ length: 40 }, (_, i) =>
    seenTestIds.has(`N${String(i + 1).padStart(2, "0")}`)
  ).every(Boolean);
  const hasD01ToD25 = Array.from({ length: 25 }, (_, i) =>
    seenTestIds.has(`D${String(i + 1).padStart(2, "0")}`)
  ).every(Boolean);
  const reporterSuites: any[] = Array.isArray(rawTestManifest?.suites)
    ? rawTestManifest.suites
    : [];
  const allSuitesValid =
    reporterSuites.length > 0 &&
    reporterSuites.every(
      (s) =>
        s.exitCode === 0 &&
        typeof s.reportSha256 === "string" &&
        /^[0-9a-f]{64}$/.test(s.reportSha256) &&
        s.failedTests === 0 &&
        s.passedTests > 0
    );

  const rawReporterOk = Boolean(
    allSuitesValid &&
      !hasDuplicateTestId &&
      !hasSkippedOrFailedCase &&
      hasN01ToN40 &&
      hasD01ToD25 &&
      rawTestManifest?.synthesizedFromGlobalCount === false
  );
  addCheck(
    "VAL_03_PER_TEST_RAW_REPORTER_TRUTH",
    "Per-test results N01..N40 and D01..D25 are parsed from raw Vitest reporters with zero skipped/failed/duplicate cases",
    rawReporterOk,
    rawReporterOk
      ? `Verified ${perTestCases.length} unique non-skipped passed test cases across ${reporterSuites.length} suites`
      : `Raw reporter check failed: suitesValid=${allSuitesValid}, dup=${hasDuplicateTestId}, skippedOrFailed=${hasSkippedOrFailedCase}, N01..N40=${hasN01ToN40}, D01..D25=${hasD01ToD25}`
  );

  // 4. Provider Entitlement, Policy & Live Gate Honesty (N06, N07, N08, N09, N10, N31, N38)
  const entitlementOk = Boolean(
    entitlement &&
      typeof entitlement.credentialsConfigured === "boolean" &&
      entitlement.registeredMarketplace === "www.amazon.com" &&
      Array.isArray(entitlement.officialDocsChecked) &&
      entitlement.officialDocsChecked.length >= 5 &&
      entitlement.secretsExposedInArtifact === false &&
      // N31: cannot claim authenticated/entitlementVerified when credentialsConfigured is false
      !(
        entitlement.credentialsConfigured === false &&
        (entitlement.authenticated === true ||
          entitlement.entitlementVerified === true)
      ) &&
      // N08: if lastAuthStatus === "AUTHENTICATION_FAILED" (401), authenticated must be false
      !(
        entitlement.lastAuthStatus === "AUTHENTICATION_FAILED" &&
        entitlement.authenticated === true
      )
  );

  const liveCalls: any[] = Array.isArray(reqLedger?.upstreamRequests)
    ? reqLedger.upstreamRequests
    : [];
  const liveGateHonest = Boolean(
    reqLedger &&
      // N06/N07: fixture or LOCAL_MCP_TEST_DOUBLE can never be labeled REAL_PROVIDER_VERIFIED
      !liveCalls.some(
        (c) =>
          (c.observationClass === "TEST_FIXTURE" ||
            c.providerSourceOrigin === "LOCAL_MCP_TEST_DOUBLE") &&
          c.countedAsRealProviderVerified === true
      ) &&
      // N10: cannot claim realProviderVerdict === "REAL_PROVIDER_VERIFIED" when liveCalls.length === 0
      !(
        reqLedger.realProviderVerdict === "REAL_PROVIDER_VERIFIED" &&
        liveCalls.filter(
          (c) =>
            c.observationClass === "AUTHORIZED_LIVE" &&
            c.providerSourceOrigin === "AUTHORIZED_CREATORS_API" &&
            c.httpStatus === 200
        ).length === 0
      ) &&
      // N09: CAPTCHA/login/403 must never be categorized as QUERY_SUCCEEDED_EMPTY
      !liveCalls.some(
        (c) =>
          (c.httpStatus === 403 ||
            c.outcomeCategory === "CAPTCHA_CHALLENGE" ||
            c.outcomeCategory === "LOGIN_WALL") &&
          c.status === "QUERY_SUCCEEDED_EMPTY"
      ) &&
      // N38: HTTP 200 with 0 items must be QUERY_SUCCEEDED_EMPTY, not BLOCKED_PROVIDER
      !liveCalls.some(
        (c) =>
          c.httpStatus === 200 &&
          c.returnedItemCount === 0 &&
          c.status === "BLOCKED_PROVIDER"
      )
  );
  addCheck(
    "VAL_04_ENTITLEMENT_AND_LIVE_GATE_TRUTH",
    "Provider entitlement, request ledger, and live gate verdict strictly separate configured vs authenticated vs live verified",
    entitlementOk && liveGateHonest,
    entitlementOk && liveGateHonest
      ? `Verified entitlement status=${entitlement?.status}, liveCalls=${liveCalls.length}, realProviderVerdict=${reqLedger?.realProviderVerdict}`
      : `Entitlement or live gate dishonesty detected (entitlementOk=${entitlementOk}, liveGateHonest=${liveGateHonest})`
  );

  // 5. Search Query Planner & Budget Integrity (A06, A07, N30)
  const queryPlanOk = Boolean(
    queryPlan &&
      queryPlan.maxCandidatesPerRun <= 3 &&
      queryPlan.maxTotalOperationsPerRun <= 4 &&
      queryPlan.maxConcurrency === 1 &&
      queryPlan.maxAttemptsPerOperation <= 2 &&
      queryPlan.unauthorizedBrowserSearchAttempted === false &&
      Array.isArray(queryPlan.candidateQueryPlans) &&
      queryPlan.candidateQueryPlans.length > 0 &&
      queryPlan.candidateQueryPlans.every(
        (p: any) =>
          !p.primaryIntent ||
          (typeof p.primaryIntent.normalizedKeywords === "string" &&
            p.primaryIntent.normalizedKeywords.toLowerCase() !== "pet gadgets" &&
            p.primaryIntent.normalizedKeywords.length >= 3)
      )
  );
  addCheck(
    "VAL_05_SEARCH_QUERY_PLAN_AND_BUDGET",
    "Candidate-specific search query planner enforces max 3 candidates, max 4 shared ops, concurrency=1, and zero generic/browser scraping",
    queryPlanOk,
    queryPlanOk
      ? `Verified ${queryPlan?.candidateQueryPlans?.length} candidate query plans within 3-candidate / 4-op cap`
      : "Invalid search query plan or budget cap violation"
  );

  // 6. Provenance, Hash, ASIN, Price & Identity Integrity (N11, N12, N13, N14, N21, N22, N23, N24, N25, N26)
  const manifestRecords: any[] = Array.isArray(evManifest?.records)
    ? evManifest.records
    : [];
  const matchRecords: any[] = Array.isArray(matchLedger?.decisions)
    ? matchLedger.decisions
    : [];
  const seenAsinToProductKey = new Map<string, string>();
  let conflictingAsinProduct = false;
  for (const r of manifestRecords) {
    if (r.asin && r.candidateId && r.status === "IDENTITY_VERIFIED") {
      const prev = seenAsinToProductKey.get(r.asin);
      if (prev && prev !== r.candidateId) {
        conflictingAsinProduct = true;
      }
      seenAsinToProductKey.set(r.asin, r.candidateId);
    }
  }

  const provenanceAndIdentityOk = Boolean(
    evManifest &&
      matchLedger &&
      manifestRecords.length > 0 &&
      !conflictingAsinProduct &&
      manifestRecords.every((r) => {
        // N11: providerRequestId must not equal local providerInvocationRef or start with local prefixes
        if (
          r.providerRequestId !== null &&
          (r.providerRequestId === r.providerInvocationRef ||
            /^(?:amz_inv_|mcp_inv_|local_inv_|synthetic_)/i.test(
              String(r.providerRequestId)
            ))
        ) {
          return false;
        }
        // N12: rawEvidenceHash must match expectedRawEvidenceHash when present
        if (
          r.expectedRawEvidenceHash &&
          r.rawEvidenceHash !== r.expectedRawEvidenceHash
        ) {
          return false;
        }
        // N13 / N14: runId and workspaceId must match active run/workspace
        if (
          r.researchRunId !== evManifest.researchRunId ||
          r.workspaceId !== evManifest.workspaceId
        ) {
          return false;
        }
        // N22: canonicalAmazonUrl must be https://www.amazon.com/dp/<ASIN>
        if (
          r.canonicalAmazonUrl &&
          !/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(
            String(r.canonicalAmazonUrl)
          )
        ) {
          return false;
        }
        // N23: invalid ASIN or variationAsin === parentAsin
        if (
          r.asin &&
          (!/^(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])$/.test(String(r.asin)) ||
            (r.variationAsin && r.parentAsin && r.variationAsin === r.parentAsin))
        ) {
          return false;
        }
        // N25: missing price converted to 0
        if (r.priceAbsentInSource === true && r.price === 0) {
          return false;
        }
        // N26: review/BSR treated as sales
        if (r.verificationScope === "SALES_VERIFIED") {
          return false;
        }
        return true;
      }) &&
      // N24: accessory mismatch or brand-only must never be EXACT_PRODUCT
      matchRecords.every(
        (m) =>
          !(
            (m.isAccessoryMismatch === true || m.isBrandOnly === true) &&
            m.identityMatch === "EXACT_PRODUCT"
          )
      )
  );
  addCheck(
    "VAL_06_PROVENANCE_IDENTITY_AND_HASH_INTEGRITY",
    "Evidence manifest and identity ledger enforce strict ASIN/URL/hash/workspace/run lineage, nullable price, and accessory/brand-only rejection",
    provenanceAndIdentityOk,
    provenanceAndIdentityOk
      ? `Verified ${manifestRecords.length} evidence records and ${matchRecords.length} match decisions`
      : "Provenance, hash, ASIN, price, or identity match violation detected"
  );

  // 7. MCP Runtime Classification & HTTP Status Origin (BUG T4 / N27, N28, N29)
  const mcpOk = Boolean(
    mcpClass &&
      mcpClass.unobservedHttpStatusDefaultedTo200 === false &&
      mcpClass.unobservedSnapshotTest?.httpStatus === null &&
      mcpClass.unobservedSnapshotTest?.httpStatusOrigin === "UNOBSERVED_NULL" &&
      mcpClass.toolErrorRejectionTest?.isErrorTreatedAsSuccess === false &&
      mcpClass.missingSnapshotRejectionTest?.verifiedWithoutBrowserSnapshot === false &&
      mcpClass.localTestDoubleSession?.serverOrigin === "LOCAL_MCP_TEST_DOUBLE" &&
      mcpClass.localTestDoubleSession?.countedAsLiveAmazonCom === false &&
      mcpClass.localTestDoubleSession?.closedCleanly === true
  );
  addCheck(
    "VAL_07_MCP_RUNTIME_AND_NULL_HTTP_STATUS",
    "MCP transport preserves httpStatus=null when unobserved (never 200), fails closed on isError/missing snapshot, and isolates LOCAL_MCP_TEST_DOUBLE",
    mcpOk,
    mcpOk
      ? "Verified unobserved HTTP status -> null (UNOBSERVED_NULL), isError rejected, and local MCP test double isolated"
      : "MCP runtime classification or HTTP status origin violation detected"
  );

  // 8. Genuine 3-Way SQLite-HTTP-DOM Parity vs DB_HTTP_ONLY (BUG T3 / N32)
  const threeWayRows: any[] = Array.isArray(parity?.threeWayComparisons)
    ? parity.threeWayComparisons
    : [];
  const parityOk = Boolean(
    parity &&
      threeWayRows.length >= 14 &&
      parity.borrowedDomFromSqliteCount === 0 &&
      parity.fallbackConstantDomCount === 0 &&
      parity.readOnlyGetDigestUnchanged === true &&
      threeWayRows.every(
        (r) =>
          r.comparisonScope === "SQLITE_HTTP_DOM_3WAY" &&
          r.domReadSource === "CHROMIUM_DOM_ATTRIBUTE_OR_TEXT" &&
          r.borrowedFromSqlite === false &&
          r.parityPassed === true &&
          String(r.sqliteValue ?? "") === String(r.httpValue ?? "") &&
          String(r.httpValue ?? "") === String(r.domValue ?? "")
      )
  );
  addCheck(
    "VAL_08_GENUINE_SQLITE_HTTP_DOM_PARITY",
    "All 3-way parity fields are independently read from Chromium DOM with zero SQLite borrowing or fallback constants",
    parityOk,
    parityOk
      ? `Verified ${threeWayRows.length} genuine 3-way SQLite-HTTP-DOM comparisons and read-only GET invariance`
      : "SQLite-HTTP-DOM parity violation or borrowed DOM value detected"
  );

  // 9. Job Ownership, Fencing, Transaction & Persistence Proof (N15, N16, N17, N18, N19, N20)
  const jobProofOk = Boolean(
    jobProof &&
      jobProof.parentAndChildJobIdsDistinct === true &&
      jobProof.parentRunIdMatchesAttachedRunId === true &&
      jobProof.swallowedSqliteFailureCount === 0 &&
      jobProof.midTransactionRollbackVerified === true &&
      jobProof.lostClaimFencingBlockedVerified === true &&
      jobProof.lostLeaseDuringAttachBlockedVerified === true &&
      jobProof.duplicateAsinConflictRejectedVerified === true &&
      jobProof.strongerLiveEvidencePreservedOverFixture === true
  );
  addCheck(
    "VAL_09_JOB_OWNERSHIP_FENCING_AND_PERSISTENCE",
    "Worker lease fencing, transaction rollback, error surfacing, and parent/child job isolation verified",
    jobProofOk,
    jobProofOk
      ? "Verified parent/child job isolation, fencing, transaction rollback, and zero swallowed DB errors"
      : "Job ownership, fencing, or persistence fault-injection check failed"
  );

  // 10. Point-in-Time Historical Replay & Dynamic Non-Inflation Delta (BUG T2 / N33, N34, N35, N36, N37)
  const pitAndDeltaOk = Boolean(
    devBt &&
      holdoutBt &&
      pitAudit &&
      nonInflation &&
      devBt.adsEvaluatedCount === 60 &&
      holdoutBt.adsEvaluatedCount === 377 &&
      pitAudit.postCutoffAmazonLeakCount === 0 &&
      pitAudit.futureObservationInjectedIntoCutoffCount === 0 &&
      pitAudit.sourceRecordMutatedAcrossReplay === false &&
      nonInflation.dynamicallyComputed === true &&
      nonInflation.hardcodedScoreArrayUsed === false &&
      nonInflation.comparisonStatus === "COMPARED_ZERO_INFLATION" &&
      nonInflation.maxAbsoluteScoreDelta === 0 &&
      nonInflation.rankOrderChanged === false &&
      nonInflation.g07Changed === false &&
      nonInflation.g15Changed === false &&
      nonInflation.g16Changed === false &&
      Array.isArray(nonInflation.perCandidateComparisons) &&
      nonInflation.perCandidateComparisons.length > 0 &&
      nonInflation.perCandidateComparisons.every(
        (c: any) =>
          c.scoreBefore === c.scoreAfter &&
          c.scoreDelta === 0 &&
          c.rankBefore === c.rankAfter &&
          c.g15Before === c.g15After &&
          c.g16Before === c.g16After
      )
  );
  addCheck(
    "VAL_10_POINT_IN_TIME_AND_DYNAMIC_NON_INFLATION",
    "DEV (60 ads) and HOLDOUT (377 ads) point-in-time replays and dynamic before/after non-inflation delta verified",
    pitAndDeltaOk,
    pitAndDeltaOk
      ? `Verified DEV=60, HOLDOUT=377, postCutoffLeaks=0, dynamic delta maxAbsoluteScoreDelta=0 across ${nonInflation?.perCandidateComparisons?.length} candidates`
      : "Point-in-time audit or dynamic before/after non-inflation check failed"
  );

  // 11. Full Regression, TypeScript, Build & Resource Guard (A26, A27, A33)
  const fullRegAndResourceOk = Boolean(
    fullReg &&
      fullReg.typecheckExitCode === 0 &&
      fullReg.nextBuildExitCode === 0 &&
      fullReg.totalSuitesFailed === 0 &&
      fullReg.totalTestsFailed === 0 &&
      fullReg.totalTestsPassed >= 500 &&
      resourceExec &&
      resourceExec.maxOuterConcurrencyConfigured <= 2 &&
      resourceExec.maxOuterConcurrencyObserved <= 2 &&
      resourceExec.diskFreeBytesBefore > 1_000_000_000 &&
      resourceExec.diskFreeBytesAfter > 1_000_000_000 &&
      resourceExec.productionDbMutated === false &&
      resourceExec.unownedProcessesKilled === 0 &&
      resourceExec.ownedTempDirsCleanedUp === true
  );
  addCheck(
    "VAL_11_FULL_REGRESSION_BUILD_AND_RESOURCE_GUARD",
    "TypeScript, Next.js build, full regression, bounded concurrency <=2, and disk/DB resource guards passed",
    fullRegAndResourceOk,
    fullRegAndResourceOk
      ? `Verified passedTests=${fullReg?.totalTestsPassed}, buildExit=0, maxConcurrency=${resourceExec?.maxOuterConcurrencyObserved}`
      : "Full regression, build, or resource guard check failed"
  );

  // 12. Acceptance Matrix A01..A40 & Negative Mutation Controls N01..N45 (N39, N40)
  const matrixGates: any[] = Array.isArray(matrix?.gates) ? matrix.gates : [];
  const hasA01ToA40 =
    matrixGates.length >= 40 &&
    Array.from({ length: 40 }, (_, i) => {
      const id = `A${String(i + 1).padStart(2, "0")}`;
      const g = matrixGates.find((x) => x.gateId === id);
      if (!g) return false;
      // A05 and A38 are live-provider/dual gates: engineering check must pass, live provider status reported honestly
      return g.engineeringPassed === true;
    }).every(Boolean);

  let negControlsOk = true;
  if (!options?.skipSelfArtifactCheck) {
    const negRes = readJsonSafe(
      path.join(artifactDir, "NEGATIVE_MUTATION_RESULTS.json")
    );
    const mutations: any[] = Array.isArray(negRes?.mutations)
      ? negRes.mutations
      : [];
    negControlsOk = Boolean(
      negRes &&
        negRes.totalMutationsExecuted >= 45 &&
        negRes.escapedCount === 0 &&
        mutations.length >= 45 &&
        mutations.every(
          (m) =>
            m.physicallyExecuted === true &&
            m.validatorRejected === true &&
            typeof m.caughtByCheckId === "string" &&
            m.caughtByCheckId.length > 0
        )
    );
  }
  addCheck(
    "VAL_12_ACCEPTANCE_MATRIX_AND_NEGATIVE_CONTROLS",
    "Acceptance matrix A01..A40 and physical negative mutations N01..N45 verified with 0 escapes",
    hasA01ToA40 && negControlsOk,
    hasA01ToA40 && negControlsOk
      ? "Verified A01..A40 engineering gates and 45/45 negative mutations caught"
      : `Matrix or negative controls failed (hasA01ToA40=${hasA01ToA40}, negControlsOk=${negControlsOk})`
  );

  // 13. Final Owner Report Verdict Consistency (BUG T5 / N40)
  let ownerReportConsistent = true;
  if (!options?.skipSelfArtifactCheck) {
    const reportPath = path.join(artifactDir, "FINAL_OWNER_REPORT.md");
    const reportText = fs.existsSync(reportPath)
      ? fs.readFileSync(reportPath, "utf8")
      : "";
    const priorFailed = checks.some((c) => !c.passed);
    if (priorFailed && /Engineering Verdict:\s*\*\*ENGINEERING_READY\*\*/i.test(reportText)) {
      ownerReportConsistent = false;
    }
    if (
      reqLedger?.realProviderVerdict !== "REAL_PROVIDER_VERIFIED" &&
      /FULL_LIVE_FEATURE_DONE|Amazon Live Verdict:\s*\*\*REAL_PROVIDER_VERIFIED\*\*/i.test(
        reportText
      )
    ) {
      ownerReportConsistent = false;
    }
  }
  addCheck(
    "VAL_13_VERDICT_ORDER_AND_OWNER_REPORT_CONSISTENCY",
    "Final owner report and closure verdicts match independent validator and real provider status without false live claims",
    ownerReportConsistent,
    ownerReportConsistent
      ? "Verified final owner report matches independent validation and provider state"
      : "Owner report claims READY/LIVE_PASS despite failed check or blocked live provider"
  );

  const passedChecksCount = checks.filter((c) => c.passed).length;
  const failedChecksCount = checks.length - passedChecksCount;
  const valid = failedChecksCount === 0;
  const engineeringVerdict = valid ? "ENGINEERING_READY" : "ENGINEERING_FAILED";
  const realProviderVerdict =
    reqLedger?.realProviderVerdict || "CREDENTIALS_REQUIRED";

  let overallClosureVerdict: IndependentAcceptanceValidationResult["overallClosureVerdict"] =
    "ENGINEERING_FAILED";
  if (!valid) {
    overallClosureVerdict = "ENGINEERING_FAILED";
  } else if (realProviderVerdict === "REAL_PROVIDER_VERIFIED") {
    overallClosureVerdict = "FULL_LIVE_FEATURE_ACCEPTED";
  } else {
    overallClosureVerdict = "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER";
  }

  return {
    valid,
    evaluatedAt,
    artifactDir,
    expectedCodeSha: expectedSha,
    engineeringVerdict,
    realProviderVerdict,
    overallClosureVerdict,
    checksCount: checks.length,
    passedChecksCount,
    failedChecksCount,
    checks,
    failedReasons: checks
      .filter((c) => !c.passed)
      .map((c) => `${c.checkId}: ${c.details}`),
  };
}

export function writeCanonicalValidAuthorizedDiscoveryFixture(
  targetDir: string,
  codeSha: string = "1111111111111111111111111111111111111111"
): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const writeJson = (name: string, data: unknown) => {
    fs.writeFileSync(path.join(targetDir, name), JSON.stringify(data, null, 2), "utf8");
  };

  writeJson("BASELINE_AND_BRANCH_PROOF.json", {
    branch: "feature/kh02-amazon-us-pilot-v12.4.3.5.0",
    baseMasterSha: "c1833362cf6634917f2ff94df19d97c393247d94",
    initialHeadSha: "5f32a0cf242f2d2de92489c4ee27a96b5d62ae7f",
    codeSha,
    workingTreeClean: true,
  });

  fs.writeFileSync(
    path.join(targetDir, "FEATURE_EXECUTION_PLAN.md"),
    "# KH-02 V12.4.3.5.0.2 Execution Plan\n\nAuthorized Amazon US Discovery + Anti-Fake Acceptance Closure.\n",
    "utf8"
  );

  writeJson("FEATURE_EXECUTION_STATE.json", {
    releaseVersion: "12.4.3.5.0.2",
    codeSha,
    status: "COMPLETED",
  });

  writeJson("PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json", {
    status: "CREDENTIALS_REQUIRED",
    credentialsConfigured: false,
    authenticated: false,
    entitlementVerified: false,
    lastAuthStatus: "CREDENTIALS_REQUIRED",
    registeredMarketplace: "www.amazon.com",
    officialDocsChecked: [
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction",
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items",
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference",
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk",
      "https://affiliate-program.amazon.com/help/operating/policies",
    ],
    secretsExposedInArtifact: false,
  });

  writeJson("AMAZON_SEARCH_QUERY_PLAN.json", {
    maxCandidatesPerRun: 3,
    maxTotalOperationsPerRun: 4,
    maxConcurrency: 1,
    maxAttemptsPerOperation: 2,
    unauthorizedBrowserSearchAttempted: false,
    candidateQueryPlans: [
      {
        candidateId: "cand_uahpet_1",
        primaryIntent: {
          normalizedKeywords: "UAHPET Wireless Cat Water Fountain UAH-WF-01",
        },
      },
    ],
  });

  writeJson("AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json", {
    realProviderVerdict: "BLOCKED_POLICY",
    liveCallsAttempted: 0,
    upstreamRequests: [],
  });

  writeJson("AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", {
    workspaceId: "ws_test_1",
    researchRunId: "run_test_1",
    records: [
      {
        candidateId: "cand_uahpet_1",
        workspaceId: "ws_test_1",
        researchRunId: "run_test_1",
        asin: "B08N5WRWNW",
        parentAsin: "B08N5WRW00",
        variationAsin: "B08N5WRWNW",
        canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        providerInvocationRef: "amz_inv_run_test_1_cand_uahpet_1",
        providerRequestId: null,
        rawEvidenceHash: "a".repeat(64),
        expectedRawEvidenceHash: "a".repeat(64),
        extractedFieldsHash: "b".repeat(64),
        price: 49.99,
        priceAbsentInSource: false,
        verificationScope: "IDENTITY_CORROBORATED",
        status: "IDENTITY_VERIFIED",
      },
    ],
  });

  writeJson("AMAZON_MATCH_AND_IDENTITY_LEDGER.json", {
    decisions: [
      {
        candidateId: "cand_uahpet_1",
        asin: "B08N5WRWNW",
        identityMatch: "EXACT_PRODUCT",
        status: "IDENTITY_VERIFIED",
        isAccessoryMismatch: false,
        isBrandOnly: false,
      },
    ],
  });

  writeJson("MCP_RUNTIME_CLASSIFICATION.json", {
    unobservedHttpStatusDefaultedTo200: false,
    unobservedSnapshotTest: {
      httpStatus: null,
      httpStatusOrigin: "UNOBSERVED_NULL",
    },
    toolErrorRejectionTest: {
      isErrorTreatedAsSuccess: false,
    },
    missingSnapshotRejectionTest: {
      verifiedWithoutBrowserSnapshot: false,
    },
    localTestDoubleSession: {
      serverOrigin: "LOCAL_MCP_TEST_DOUBLE",
      countedAsLiveAmazonCom: false,
      closedCleanly: true,
    },
  });

  const threeWayFields = [
    ["candidateId", "cand_uahpet_1"],
    ["researchRunId", "run_test_1"],
    ["asin", "B08N5WRWNW"],
    ["parentAsin", "B08N5WRW00"],
    ["variationAsin", "B08N5WRWNW"],
    ["canonicalAmazonUrl", "https://www.amazon.com/dp/B08N5WRWNW"],
    ["identityMatch", "EXACT_PRODUCT"],
    ["status", "IDENTITY_VERIFIED"],
    ["observationClass", "TEST_FIXTURE"],
    ["verificationScope", "IDENTITY_CORROBORATED"],
    ["brand", "UAHPET"],
    ["price", "49.99"],
    ["currency", "USD"],
    ["rawEvidenceHash", "a".repeat(64)],
  ];
  writeJson("SQLITE_HTTP_DOM_PARITY.json", {
    borrowedDomFromSqliteCount: 0,
    fallbackConstantDomCount: 0,
    readOnlyGetDigestUnchanged: true,
    threeWayComparisons: threeWayFields.map(([field, val]) => ({
      field,
      comparisonScope: "SQLITE_HTTP_DOM_3WAY",
      domReadSource: "CHROMIUM_DOM_ATTRIBUTE_OR_TEXT",
      borrowedFromSqlite: false,
      sqliteValue: val,
      httpValue: val,
      domValue: val,
      parityPassed: true,
    })),
  });

  writeJson("JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", {
    parentAndChildJobIdsDistinct: true,
    parentRunIdMatchesAttachedRunId: true,
    swallowedSqliteFailureCount: 0,
    midTransactionRollbackVerified: true,
    lostClaimFencingBlockedVerified: true,
    lostLeaseDuringAttachBlockedVerified: true,
    duplicateAsinConflictRejectedVerified: true,
    strongerLiveEvidencePreservedOverFixture: true,
  });

  const perTestResults = [
    ...Array.from({ length: 40 }, (_, i) => ({
      testId: `N${String(i + 1).padStart(2, "0")}`,
      status: "passed",
      skipped: false,
    })),
    ...Array.from({ length: 25 }, (_, i) => ({
      testId: `D${String(i + 1).padStart(2, "0")}`,
      status: "passed",
      skipped: false,
    })),
  ];
  writeJson("RAW_TEST_REPORT_MANIFEST.json", {
    codeSha,
    synthesizedFromGlobalCount: false,
    suites: [
      {
        suiteId: "unit_v12_4_3_5_0_2",
        exitCode: 0,
        passedTests: 65,
        failedTests: 0,
        reportSha256: sha256Hex("raw_report_payload"),
      },
    ],
    perTestResults,
  });

  writeJson("FULL_REGRESSION_EXECUTION.json", {
    codeSha,
    typecheckExitCode: 0,
    nextBuildExitCode: 0,
    totalSuitesFailed: 0,
    totalTestsFailed: 0,
    totalTestsPassed: 530,
  });

  writeJson("DEV_BACKTEST.json", {
    adsEvaluatedCount: 60,
    cutoffIso: "2026-03-10T23:59:59.000Z",
  });

  writeJson("HOLDOUT_BACKTEST.json", {
    adsEvaluatedCount: 377,
    cutoffIso: "2026-03-22T23:59:59.000Z",
  });

  writeJson("HISTORICAL_POINT_IN_TIME_AUDIT.json", {
    postCutoffAmazonLeakCount: 0,
    futureObservationInjectedIntoCutoffCount: 0,
    sourceRecordMutatedAcrossReplay: false,
  });

  writeJson("BEFORE_AFTER_NON_INFLATION_DIFF.json", {
    dynamicallyComputed: true,
    hardcodedScoreArrayUsed: false,
    comparisonStatus: "COMPARED_ZERO_INFLATION",
    maxAbsoluteScoreDelta: 0,
    rankOrderChanged: false,
    g07Changed: false,
    g15Changed: false,
    g16Changed: false,
    perCandidateComparisons: [
      {
        candidateId: "cand_uahpet_1",
        rankBefore: 1,
        rankAfter: 1,
        scoreBefore: 64.5,
        scoreAfter: 64.5,
        scoreDelta: 0,
        g15Before: false,
        g15After: false,
        g16Before: true,
        g16After: true,
      },
    ],
  });

  writeJson("RESOURCE_AND_ASYNC_EXECUTION.json", {
    maxOuterConcurrencyConfigured: 2,
    maxOuterConcurrencyObserved: 2,
    diskFreeBytesBefore: 15_000_000_000,
    diskFreeBytesAfter: 14_900_000_000,
    productionDbMutated: false,
    unownedProcessesKilled: 0,
    ownedTempDirsCleanedUp: true,
  });

  writeJson("ACCEPTANCE_MATRIX.json", {
    gates: Array.from({ length: 40 }, (_, i) => ({
      gateId: `A${String(i + 1).padStart(2, "0")}`,
      engineeringPassed: true,
    })),
  });

  writeJson("NEGATIVE_MUTATION_RESULTS.json", {
    totalMutationsExecuted: 45,
    escapedCount: 0,
    mutations: Array.from({ length: 45 }, (_, i) => ({
      mutationId: `N${String(i + 1).padStart(2, "0")}`,
      physicallyExecuted: true,
      validatorRejected: true,
      caughtByCheckId: "VAL_01",
    })),
  });

  fs.writeFileSync(
    path.join(targetDir, "FINAL_OWNER_REPORT.md"),
    "# Final Owner Report\n- Engineering Verdict: **ENGINEERING_READY**\n- Amazon Live Verdict: **BLOCKED_POLICY**\n",
    "utf8"
  );

  const val = validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2(targetDir, {
    expectedCodeSha: codeSha,
    skipSelfArtifactCheck: true,
  });
  writeJson("INDEPENDENT_ACCEPTANCE_VALIDATION.json", val);
}

export interface NegativeMutationCaseResult {
  mutationId: string;
  description: string;
  targetArtifact: string;
  physicallyExecuted: boolean;
  validatorRejected: boolean;
  caughtByCheckId: string | null;
  failedReasons: string[];
}

/**
 * Section 9: Executes 45 physical-file negative control mutations (N01..N45) in isolated temp directories
 * and verifies that validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2 catches and rejects every single one.
 */
export function runAmazonUsAuthorizedDiscoveryNegativeMutationSuite(
  baseTempDir: string,
  codeSha: string = "1111111111111111111111111111111111111111"
): {
  totalMutationsExecuted: number;
  caughtCount: number;
  escapedCount: number;
  allCaughtZeroEscapes: boolean;
  mutations: NegativeMutationCaseResult[];
} {
  const mutateJson = (dir: string, file: string, fn: (obj: any) => void) => {
    const p = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    fn(data);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  };

  const cases: Array<{
    mutationId: string;
    description: string;
    targetArtifact: string;
    apply: (dir: string) => void;
  }> = [
    {
      mutationId: "N01",
      description: "Branch or CODE_SHA mismatch between baseline and test manifest",
      targetArtifact: "BASELINE_AND_BRANCH_PROOF.json",
      apply: (d) =>
        mutateJson(d, "BASELINE_AND_BRANCH_PROOF.json", (o) => {
          o.codeSha = "deadbeef".repeat(5);
        }),
    },
    {
      mutationId: "N02",
      description: "Missing unit reporter in RAW_TEST_REPORT_MANIFEST.json",
      targetArtifact: "RAW_TEST_REPORT_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "RAW_TEST_REPORT_MANIFEST.json", (o) => {
          o.suites = [];
        }),
    },
    {
      mutationId: "N03",
      description: "Skipped N test in per-test reporter manifest",
      targetArtifact: "RAW_TEST_REPORT_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "RAW_TEST_REPORT_MANIFEST.json", (o) => {
          o.perTestResults[5].skipped = true;
          o.perTestResults[5].status = "skipped";
        }),
    },
    {
      mutationId: "N04",
      description: "Duplicate N test ID inflating per-test count",
      targetArtifact: "RAW_TEST_REPORT_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "RAW_TEST_REPORT_MANIFEST.json", (o) => {
          o.perTestResults[10].testId = "N01";
        }),
    },
    {
      mutationId: "N05",
      description: "One failed N test while global PASS is claimed",
      targetArtifact: "RAW_TEST_REPORT_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "RAW_TEST_REPORT_MANIFEST.json", (o) => {
          o.perTestResults[12].status = "failed";
        }),
    },
    {
      mutationId: "N06",
      description: "TEST_FIXTURE record labeled as REAL_PROVIDER_VERIFIED",
      targetArtifact: "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json", (o) => {
          o.upstreamRequests = [
            {
              observationClass: "TEST_FIXTURE",
              countedAsRealProviderVerified: true,
            },
          ];
        }),
    },
    {
      mutationId: "N07",
      description: "LOCAL_MCP_TEST_DOUBLE session labeled as live Amazon.com verification",
      targetArtifact: "MCP_RUNTIME_CLASSIFICATION.json",
      apply: (d) =>
        mutateJson(d, "MCP_RUNTIME_CLASSIFICATION.json", (o) => {
          o.localTestDoubleSession.countedAsLiveAmazonCom = true;
        }),
    },
    {
      mutationId: "N08",
      description: "API configured with HTTP 401 AUTHENTICATION_FAILED but authenticated=true claimed",
      targetArtifact: "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json", (o) => {
          o.credentialsConfigured = true;
          o.lastAuthStatus = "AUTHENTICATION_FAILED";
          o.authenticated = true;
        }),
    },
    {
      mutationId: "N09",
      description: "CAPTCHA / login / HTTP 403 categorized as QUERY_SUCCEEDED_EMPTY",
      targetArtifact: "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json", (o) => {
          o.upstreamRequests = [
            {
              httpStatus: 403,
              outcomeCategory: "CAPTCHA_CHALLENGE",
              status: "QUERY_SUCCEEDED_EMPTY",
            },
          ];
        }),
    },
    {
      mutationId: "N10",
      description: "Zero upstream provider queries but realProviderVerdict=REAL_PROVIDER_VERIFIED",
      targetArtifact: "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json", (o) => {
          o.realProviderVerdict = "REAL_PROVIDER_VERIFIED";
          o.upstreamRequests = [];
        }),
    },
    {
      mutationId: "N11",
      description: "Forged upstream providerRequestId copied from local providerInvocationRef",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].providerRequestId = o.records[0].providerInvocationRef;
        }),
    },
    {
      mutationId: "N12",
      description: "Mismatched rawEvidenceHash vs expectedRawEvidenceHash",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].rawEvidenceHash = "f".repeat(64);
        }),
    },
    {
      mutationId: "N13",
      description: "Stale previous-run observation attached to current researchRunId",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].researchRunId = "run_stale_previous_999";
        }),
    },
    {
      mutationId: "N14",
      description: "Workspace A evidence record contaminated with Workspace B ID",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].workspaceId = "ws_foreign_tenant_b";
        }),
    },
    {
      mutationId: "N15",
      description: "Parent and child verification job IDs conflated or runId mismatch",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.parentAndChildJobIdsDistinct = false;
        }),
    },
    {
      mutationId: "N16",
      description: "Failed SQLite insert swallowed while job reports COMPLETED",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.swallowedSqliteFailureCount = 1;
        }),
    },
    {
      mutationId: "N17",
      description: "Mid-transaction write failure not rolled back",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.midTransactionRollbackVerified = false;
        }),
    },
    {
      mutationId: "N18",
      description: "Lost claimToken / fencingGeneration allowed to persist",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.lostClaimFencingBlockedVerified = false;
        }),
    },
    {
      mutationId: "N19",
      description: "Lost lease during attachAmazonEvidenceToExistingResearchRun allowed to overwrite snapshot",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.lostLeaseDuringAttachBlockedVerified = false;
        }),
    },
    {
      mutationId: "N20",
      description: "Child double-submit / duplicate ASIN conflict not rejected",
      targetArtifact: "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json",
      apply: (d) =>
        mutateJson(d, "JOB_OWNERSHIP_AND_PERSISTENCE_PROOF.json", (o) => {
          o.duplicateAsinConflictRejectedVerified = false;
        }),
    },
    {
      mutationId: "N21",
      description: "Same ASIN assigned to two conflicting products as IDENTITY_VERIFIED",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records.push({
            ...o.records[0],
            candidateId: "cand_conflicting_other_2",
          });
        }),
    },
    {
      mutationId: "N22",
      description: "Non-US Amazon host or SSRF URL accepted in canonicalAmazonUrl",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].canonicalAmazonUrl = "https://www.amazon.co.uk/dp/B08N5WRWNW";
        }),
    },
    {
      mutationId: "N23",
      description: "Malformed ASIN or variationAsin identical to parentAsin",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].parentAsin = "B08N5WRWNW";
          o.records[0].variationAsin = "B08N5WRWNW";
        }),
    },
    {
      mutationId: "N24",
      description: "Replacement filter accessory treated as EXACT_PRODUCT match for main product",
      targetArtifact: "AMAZON_MATCH_AND_IDENTITY_LEDGER.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_MATCH_AND_IDENTITY_LEDGER.json", (o) => {
          o.decisions[0].isAccessoryMismatch = true;
          o.decisions[0].identityMatch = "EXACT_PRODUCT";
        }),
    },
    {
      mutationId: "N25",
      description: "Missing upstream price converted to 0 instead of null",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].priceAbsentInSource = true;
          o.records[0].price = 0;
        }),
    },
    {
      mutationId: "N26",
      description: "Review count or BSR treated as SALES_VERIFIED",
      targetArtifact: "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].verificationScope = "SALES_VERIFIED";
        }),
    },
    {
      mutationId: "N27",
      description: "Unobserved HTTP status defaulted to 200 in MCP transport",
      targetArtifact: "MCP_RUNTIME_CLASSIFICATION.json",
      apply: (d) =>
        mutateJson(d, "MCP_RUNTIME_CLASSIFICATION.json", (o) => {
          o.unobservedSnapshotTest.httpStatus = 200;
        }),
    },
    {
      mutationId: "N28",
      description: "MCP tool result isError=true treated as success",
      targetArtifact: "MCP_RUNTIME_CLASSIFICATION.json",
      apply: (d) =>
        mutateJson(d, "MCP_RUNTIME_CLASSIFICATION.json", (o) => {
          o.toolErrorRejectionTest.isErrorTreatedAsSuccess = true;
        }),
    },
    {
      mutationId: "N29",
      description: "browser_snapshot absent but session marked IDENTITY_VERIFIED",
      targetArtifact: "MCP_RUNTIME_CLASSIFICATION.json",
      apply: (d) =>
        mutateJson(d, "MCP_RUNTIME_CLASSIFICATION.json", (o) => {
          o.missingSnapshotRejectionTest.verifiedWithoutBrowserSnapshot = true;
        }),
    },
    {
      mutationId: "N30",
      description: "Unauthorized browser search scraping attempted on Amazon.com",
      targetArtifact: "AMAZON_SEARCH_QUERY_PLAN.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_SEARCH_QUERY_PLAN.json", (o) => {
          o.unauthorizedBrowserSearchAttempted = true;
        }),
    },
    {
      mutationId: "N31",
      description: "No credentials configured but entitlementVerified=true set",
      targetArtifact: "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "PROVIDER_ENTITLEMENT_AND_POLICY_AUDIT.json", (o) => {
          o.credentialsConfigured = false;
          o.entitlementVerified = true;
        }),
    },
    {
      mutationId: "N32",
      description: "Unobserved brand/price borrowed from SQLite counted as 3-way DOM parity",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY.json",
      apply: (d) =>
        mutateJson(d, "SQLITE_HTTP_DOM_PARITY.json", (o) => {
          o.borrowedDomFromSqliteCount = 1;
          o.threeWayComparisons[10].borrowedFromSqlite = true;
        }),
    },
    {
      mutationId: "N33",
      description: "Before/after non-inflation scores hardcoded instead of dynamically computed",
      targetArtifact: "BEFORE_AFTER_NON_INFLATION_DIFF.json",
      apply: (d) =>
        mutateJson(d, "BEFORE_AFTER_NON_INFLATION_DIFF.json", (o) => {
          o.hardcodedScoreArrayUsed = true;
        }),
    },
    {
      mutationId: "N34",
      description: "G15 or G16 gate status mutated after adding Amazon listing evidence",
      targetArtifact: "BEFORE_AFTER_NON_INFLATION_DIFF.json",
      apply: (d) =>
        mutateJson(d, "BEFORE_AFTER_NON_INFLATION_DIFF.json", (o) => {
          o.g15Changed = true;
          o.perCandidateComparisons[0].g15After = true;
        }),
    },
    {
      mutationId: "N35",
      description: "Post-cutoff Amazon observation leaked into historical backtest",
      targetArtifact: "HISTORICAL_POINT_IN_TIME_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "HISTORICAL_POINT_IN_TIME_AUDIT.json", (o) => {
          o.postCutoffAmazonLeakCount = 1;
        }),
    },
    {
      mutationId: "N36",
      description: "Historical source record mutated across as-of replay",
      targetArtifact: "HISTORICAL_POINT_IN_TIME_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "HISTORICAL_POINT_IN_TIME_AUDIT.json", (o) => {
          o.sourceRecordMutatedAcrossReplay = true;
        }),
    },
    {
      mutationId: "N37",
      description: "Future/current Amazon observation injected into older DEV cutoff",
      targetArtifact: "HISTORICAL_POINT_IN_TIME_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "HISTORICAL_POINT_IN_TIME_AUDIT.json", (o) => {
          o.futureObservationInjectedIntoCutoffCount = 2;
        }),
    },
    {
      mutationId: "N38",
      description: "Zero returned SearchItems results reported as BLOCKED_PROVIDER instead of QUERY_SUCCEEDED_EMPTY",
      targetArtifact: "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_REAL_PROVIDER_REQUEST_LEDGER.json", (o) => {
          o.upstreamRequests = [
            {
              httpStatus: 200,
              returnedItemCount: 0,
              status: "BLOCKED_PROVIDER",
            },
          ];
        }),
    },
    {
      mutationId: "N39",
      description: "Negative control deliberately not executed (physicallyExecuted=false) while report claims PASS",
      targetArtifact: "NEGATIVE_MUTATION_RESULTS.json",
      apply: (d) =>
        mutateJson(d, "NEGATIVE_MUTATION_RESULTS.json", (o) => {
          o.mutations[0].physicallyExecuted = false;
        }),
    },
    {
      mutationId: "N40",
      description: "FINAL_OWNER_REPORT.md claims ENGINEERING_READY despite failed engineering gate",
      targetArtifact: "FULL_REGRESSION_EXECUTION.json",
      apply: (d) => {
        mutateJson(d, "FULL_REGRESSION_EXECUTION.json", (o) => {
          o.nextBuildExitCode = 1;
        });
      },
    },
    {
      mutationId: "N41",
      description: "Generic niche 'Pet Gadgets' used as primary Amazon search intent",
      targetArtifact: "AMAZON_SEARCH_QUERY_PLAN.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_SEARCH_QUERY_PLAN.json", (o) => {
          o.candidateQueryPlans[0].primaryIntent.normalizedKeywords = "Pet Gadgets";
        }),
    },
    {
      mutationId: "N42",
      description: "Shared provider operation budget cap (>4 ops/run) exceeded",
      targetArtifact: "AMAZON_SEARCH_QUERY_PLAN.json",
      apply: (d) =>
        mutateJson(d, "AMAZON_SEARCH_QUERY_PLAN.json", (o) => {
          o.maxTotalOperationsPerRun = 10;
        }),
    },
    {
      mutationId: "N43",
      description: "DOM value mismatches HTTP/SQLite value in 3-way parity table",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY.json",
      apply: (d) =>
        mutateJson(d, "SQLITE_HTTP_DOM_PARITY.json", (o) => {
          o.threeWayComparisons[2].domValue = "B00000FAKE";
        }),
    },
    {
      mutationId: "N44",
      description: "GET read-only endpoint mutated database digest",
      targetArtifact: "SQLITE_HTTP_DOM_PARITY.json",
      apply: (d) =>
        mutateJson(d, "SQLITE_HTTP_DOM_PARITY.json", (o) => {
          o.readOnlyGetDigestUnchanged = false;
        }),
    },
    {
      mutationId: "N45",
      description: "Outer async test runner exceeded concurrency=2 or mutated production DB",
      targetArtifact: "RESOURCE_AND_ASYNC_EXECUTION.json",
      apply: (d) =>
        mutateJson(d, "RESOURCE_AND_ASYNC_EXECUTION.json", (o) => {
          o.maxOuterConcurrencyObserved = 5;
          o.productionDbMutated = true;
        }),
    },
  ];

  const results: NegativeMutationCaseResult[] = [];
  fs.mkdirSync(baseTempDir, { recursive: true });

  for (const c of cases) {
    const caseDir = path.join(baseTempDir, `mut_${c.mutationId}`);
    try {
      writeCanonicalValidAuthorizedDiscoveryFixture(caseDir, codeSha);
      c.apply(caseDir);
      const val = validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2(caseDir, {
        expectedCodeSha: codeSha,
      });
      const firstFailed = val.checks.find((chk) => !chk.passed);
      results.push({
        mutationId: c.mutationId,
        description: c.description,
        targetArtifact: c.targetArtifact,
        physicallyExecuted: true,
        validatorRejected: !val.valid,
        caughtByCheckId: firstFailed?.checkId || null,
        failedReasons: val.failedReasons,
      });
    } finally {
      fs.rmSync(caseDir, { recursive: true, force: true });
    }
  }

  const caughtCount = results.filter((r) => r.validatorRejected).length;
  const escapedCount = results.length - caughtCount;

  return {
    totalMutationsExecuted: results.length,
    caughtCount,
    escapedCount,
    allCaughtZeroEscapes: escapedCount === 0 && results.length === 45,
    mutations: results,
  };
}

