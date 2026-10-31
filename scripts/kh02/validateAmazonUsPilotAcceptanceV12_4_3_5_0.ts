/**
 * SWAI KH-02 V12.4.3.5.0 — Independent Amazon US Pilot Acceptance Validator & Negative Control Suite
 *
 * Implements:
 * - validateAmazonUsPilotAcceptanceArtifacts(dir, options)
 * - writeCanonicalValidAmazonPilotFixture(dir, codeSha)
 * - runAmazonUsPilotNegativeMutationSuite(dir) (24 physical-file adversarial mutations AMZ_MUT_01..AMZ_MUT_24)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { computeDeterministicEvidenceHash } from "@/services/kh02/marketplace/marketplaceEvidenceTypes";

export const MANDATORY_AMAZON_PILOT_ARTIFACTS = [
  "BASELINE_AND_BRANCH_PROOF.json",
  "FUNCTION_MAP.md",
  "FEATURE_EXECUTION_PLAN.md",
  "FEATURE_ACCEPTANCE_MATRIX.json",
  "PROVIDER_POLICY_AND_ACCESS_DECISION.json",
  "PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json",
  "AMAZON_PROVIDER_OPERATION_LEDGER.json",
  "AMAZON_RAW_EVIDENCE_MANIFEST.json",
  "AMAZON_IDENTITY_AND_MATCH_LEDGER.json",
  "AMAZON_DEDUP_AND_REJECTION_LEDGER.json",
  "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json",
  "API_UI_SQLITE_CHROMIUM_PARITY.json",
  "READ_ONLY_HTTP_NONMUTATION_PROOF.json",
  "AMAZON_PROVIDER_GATE.json",
  "HISTORICAL_DEV_BACKTEST.json",
  "HISTORICAL_HOLDOUT_BACKTEST.json",
  "POINT_IN_TIME_AUDIT.json",
  "ASYNC_WORKER_BARRIER.json",
  "TEST_EXECUTION_REPORT.json",
  "BUILD_EXECUTION_REPORT.json",
  "CHROMIUM_EXECUTION_REPORT.json",
  "NEGATIVE_CONTROL_MUTATIONS.json",
  "SOURCE_SHA_PROVENANCE.json",
  "FINAL_FEATURE_ACCEPTANCE_REPORT.md",
] as const;

export interface ValidatorCheckResult {
  checkId: string;
  description: string;
  passed: boolean;
  details: string;
}

export interface AmazonPilotValidationReport {
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
 * Independently validates all 24 mandatory acceptance artifacts for KH-02 V12.4.3.5.0.
 */
export function validateAmazonUsPilotAcceptanceArtifacts(
  dir: string,
  options?: {
    skipSelfMutationCheck?: boolean;
    expectedCodeSha?: string;
  }
): AmazonPilotValidationReport {
  const checks: ValidatorCheckResult[] = [];
  const addCheck = (checkId: string, description: string, passed: boolean, details: string) => {
    checks.push({ checkId, description, passed, details });
  };

  // CHK_01: Mandatory artifacts present and non-empty
  {
    const missing: string[] = [];
    const requiredList = options?.skipSelfMutationCheck
      ? MANDATORY_AMAZON_PILOT_ARTIFACTS.filter((f) => f !== "NEGATIVE_CONTROL_MUTATIONS.json")
      : MANDATORY_AMAZON_PILOT_ARTIFACTS;
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
      "All 24 mandatory Amazon US pilot acceptance artifacts exist and are non-empty",
      missing.length === 0,
      missing.length === 0
        ? `Verified ${requiredList.length} artifacts present.`
        : `Missing or empty artifacts: ${missing.join(", ")}`
    );
  }

  const baseline = readJsonSafe(dir, "BASELINE_AND_BRANCH_PROOF.json");
  const matrix = readJsonSafe(dir, "FEATURE_ACCEPTANCE_MATRIX.json");
  const policyDoc = readJsonSafe(dir, "PROVIDER_POLICY_AND_ACCESS_DECISION.json");
  const mcpDoc = readJsonSafe(dir, "PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json");
  const opLedger = readJsonSafe(dir, "AMAZON_PROVIDER_OPERATION_LEDGER.json");
  const rawManifest = readJsonSafe(dir, "AMAZON_RAW_EVIDENCE_MANIFEST.json");
  const idLedger = readJsonSafe(dir, "AMAZON_IDENTITY_AND_MATCH_LEDGER.json");
  const dedupLedger = readJsonSafe(dir, "AMAZON_DEDUP_AND_REJECTION_LEDGER.json");
  const persistDoc = readJsonSafe(dir, "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json");
  const parityDoc = readJsonSafe(dir, "API_UI_SQLITE_CHROMIUM_PARITY.json");
  const readOnlyDoc = readJsonSafe(dir, "READ_ONLY_HTTP_NONMUTATION_PROOF.json");
  const gateDoc = readJsonSafe(dir, "AMAZON_PROVIDER_GATE.json");
  const devBacktest = readJsonSafe(dir, "HISTORICAL_DEV_BACKTEST.json");
  const holdoutBacktest = readJsonSafe(dir, "HISTORICAL_HOLDOUT_BACKTEST.json");
  const pitDoc = readJsonSafe(dir, "POINT_IN_TIME_AUDIT.json");
  const barrierDoc = readJsonSafe(dir, "ASYNC_WORKER_BARRIER.json");
  const testDoc = readJsonSafe(dir, "TEST_EXECUTION_REPORT.json");
  const buildDoc = readJsonSafe(dir, "BUILD_EXECUTION_REPORT.json");
  const chromiumDoc = readJsonSafe(dir, "CHROMIUM_EXECUTION_REPORT.json");
  const negDoc = readJsonSafe(dir, "NEGATIVE_CONTROL_MUTATIONS.json");
  const shaDoc = readJsonSafe(dir, "SOURCE_SHA_PROVENANCE.json");

  // CHK_02: Branch & Frozen CODE_SHA Provenance
  {
    const codeSha = shaDoc?.codeSha;
    const baseSha = shaDoc?.baseSha || baseline?.baseSha;
    const branch = shaDoc?.branch || baseline?.branch;
    const shaConsistent =
      isValidGitSha40(codeSha) &&
      isValidGitSha40(baseSha) &&
      branch === "feature/kh02-amazon-us-pilot-v12.4.3.5.0" &&
      (!options?.expectedCodeSha || codeSha === options.expectedCodeSha) &&
      testDoc?.codeSha === codeSha &&
      buildDoc?.codeSha === codeSha &&
      chromiumDoc?.codeSha === codeSha &&
      parityDoc?.codeSha === codeSha &&
      readOnlyDoc?.codeSha === codeSha &&
      gateDoc?.codeSha === codeSha &&
      barrierDoc?.codeSha === codeSha &&
      pitDoc?.codeSha === codeSha;

    addCheck(
      "CHK_02_BRANCH_AND_CODE_SHA_PROVENANCE",
      "Branch is feature/kh02-amazon-us-pilot-v12.4.3.5.0 and frozen 40-hex CODE_SHA matches across all execution artifacts",
      Boolean(shaConsistent),
      shaConsistent
        ? `Verified branch=${branch}, baseSha=${baseSha}, codeSha=${codeSha}`
        : `Branch or CODE_SHA mismatch: branch=${branch}, codeSha=${codeSha}, test=${testDoc?.codeSha}, build=${buildDoc?.codeSha}, chromium=${chromiumDoc?.codeSha}, parity=${parityDoc?.codeSha}, gate=${gateDoc?.codeSha}`
    );
  }

  // CHK_03: Acceptance Matrix A01..A30 complete and passing
  {
    const reqs: any[] = Array.isArray(matrix?.requirements) ? matrix.requirements : [];
    const expectedIds = Array.from({ length: 30 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`);
    const presentIds = new Set(reqs.map((r) => r?.id));
    const all30Present = expectedIds.every((id) => presentIds.has(id));
    const all30Passed =
      reqs.length === 30 &&
      reqs.every((r) => r?.passed === true && typeof r?.testId === "string" && r.testId.length > 0);
    addCheck(
      "CHK_03_ACCEPTANCE_MATRIX_A01_A30",
      "FEATURE_ACCEPTANCE_MATRIX.json contains all A01..A30 requirements with passed=true and non-empty testId",
      Boolean(all30Present && all30Passed),
      all30Present && all30Passed
        ? "All 30 requirements (A01..A30) verified passing."
        : `Matrix incomplete or failing: count=${reqs.length}, all30Present=${all30Present}, all30Passed=${all30Passed}`
    );
  }

  // CHK_04: Default Flags & Policy Guard (A01, A02)
  {
    const ok =
      policyDoc?.defaultFeatureEnabled === false &&
      policyDoc?.defaultLiveAllowed === false &&
      policyDoc?.unauthorizedLiveAttemptStatus === "BLOCKED_POLICY" &&
      policyDoc?.zeroNetworkCallsWhenFlagOff === true &&
      policyDoc?.userRequestCannotOverrideServerFlag === true;
    addCheck(
      "CHK_04_DEFAULT_FLAGS_AND_POLICY_GUARD",
      "Default flags KH02_AMAZON_US_ENABLED=false and KH02_AMAZON_US_LIVE_ALLOWED=false enforced; unauthorized live access returns BLOCKED_POLICY",
      Boolean(ok),
      ok
        ? "Default flags OFF and BLOCKED_POLICY guard verified."
        : `Policy guard violation in PROVIDER_POLICY_AND_ACCESS_DECISION.json: ${JSON.stringify(policyDoc)}`
    );
  }

  // CHK_05: Playwright MCP Handshake & Session Cleanup (A03, A12)
  {
    const ok =
      mcpDoc?.packageSpec === "@playwright/mcp@0.0.83" &&
      mcpDoc?.handshakeExecuted === true &&
      mcpDoc?.handshakeStatus === "CONNECTED_READY" &&
      Array.isArray(mcpDoc?.discoveredTools) &&
      mcpDoc.discoveredTools.includes("browser_navigate") &&
      mcpDoc?.sessionClosedCleanly === true &&
      mcpDoc?.residualProcessesCount === 0 &&
      mcpDoc?.unavailableClientClassification === "MCP_NOT_CONFIGURED";
    addCheck(
      "CHK_05_PLAYWRIGHT_MCP_SESSION_TRUTH",
      "Pinned @playwright/mcp@0.0.83 stdio handshake verified, tools discovered, and session closed with 0 residual processes",
      Boolean(ok),
      ok
        ? `MCP handshake verified (${mcpDoc?.discoveredTools?.length} tools), residualProcesses=0.`
        : `MCP handshake or cleanup invalid: ${JSON.stringify(mcpDoc)}`
    );
  }

  // CHK_06: Provider Operation Ledger Budget & Upstream Request ID Honesty (A08, A10, A11, A17)
  {
    const ops: any[] = Array.isArray(opLedger?.operations) ? opLedger.operations : [];
    const budgetOk =
      opLedger?.maxConcurrencyObserved === 1 &&
      opLedger?.maxOperationsPerRunAllowed === 4 &&
      opLedger?.maxAttemptsPerOperationAllowed === 2 &&
      opLedger?.fifthOperationBlockedByCap === true &&
      opLedger?.rollingWindowRateGateVerified === true;
    const idIntegrityOk =
      ops.length >= 3 &&
      ops.every((op) => {
        if (!op?.providerInvocationRef || typeof op.providerInvocationRef !== "string") return false;
        if (op.providerRequestIdOrigin === "ABSENT" && op.providerRequestId !== null) return false;
        if (
          op.providerRequestId !== null &&
          op.providerRequestId === op.providerInvocationRef
        ) {
          return false;
        }
        return op.attemptCount <= 2;
      });
    addCheck(
      "CHK_06_OPERATION_LEDGER_BUDGET_AND_ID_SEPARATION",
      "Protective budget (concurrency=1, <=4 ops/run, <=2 attempts/op) and strict separation of providerInvocationRef vs upstream providerRequestId",
      Boolean(budgetOk && idIntegrityOk),
      budgetOk && idIntegrityOk
        ? `Verified ${ops.length} operations within budget and strict ID separation.`
        : `Operation ledger violation: budgetOk=${budgetOk}, idIntegrityOk=${idIntegrityOk}`
    );
  }

  // CHK_07: Raw Evidence Manifest Hash Recomputation, Price Nullability & Sanitization (A18, A22, A24)
  {
    const records: any[] = Array.isArray(rawManifest?.evidenceRecords)
      ? rawManifest.evidenceRecords
      : [];
    const hashesValid =
      records.length >= 3 &&
      records.every((r) => {
        if (!isValidSha256Hex(r?.rawEvidenceHash) || !isValidSha256Hex(r?.extractedFieldsHash)) {
          return false;
        }
        if (r?.extractedCanonicalPayload) {
          const recomputed = computeDeterministicEvidenceHash(r.extractedCanonicalPayload);
          if (recomputed !== r.extractedFieldsHash) return false;
        }
        return true;
      });
    const priceAndSanitizationOk =
      rawManifest?.absentPriceStoredAsNullNotZero === true &&
      rawManifest?.reviewCountAndBsrExcludedFromSalesAndScore === true &&
      rawManifest?.promptInjectionAndScriptTagsStripped === true;
    addCheck(
      "CHK_07_RAW_EVIDENCE_HASH_AND_SANITIZATION",
      "Deterministic SHA-256 hashes match canonical extracted payloads; absent price is null (not 0); HTML/JSON-LD prompt injection stripped",
      Boolean(hashesValid && priceAndSanitizationOk),
      hashesValid && priceAndSanitizationOk
        ? `Verified ${records.length} evidence hashes, price nullability, and sanitization.`
        : `Raw manifest violation: hashesValid=${hashesValid}, priceAndSanitizationOk=${priceAndSanitizationOk}`
    );
  }

  // CHK_08: Identity & Match Ledger (A05, A06, A09)
  {
    const ok =
      idLedger?.exactMatchRequiresBeyondBrandCorroboration === true &&
      idLedger?.brandOnlyMatchExcludedFromExactProduct === true &&
      idLedger?.variationChildAndParentAsinPreserved === true &&
      idLedger?.canonicalDeduplicationVerified === true &&
      Array.isArray(idLedger?.records) &&
      idLedger.records.length >= 3 &&
      idLedger.records.every(
        (r: any) =>
          !(r.identityMatch === "EXACT_PRODUCT" && r.brandOnlyCorroboration === true)
      );
    addCheck(
      "CHK_08_IDENTITY_AND_VARIATION_LEDGER",
      "Exact product match requires corroboration beyond brand name; variation child/parent ASIN preserved and deduplicated",
      Boolean(ok),
      ok
        ? "Identity corroboration and variation ASIN preservation verified."
        : `Identity ledger violation: ${JSON.stringify(idLedger)}`
    );
  }

  // CHK_09: Deduplication & Rejection Ledger (A04, A05, A07, A25)
  {
    const rejected: any[] = Array.isArray(dedupLedger?.rejectedRecords)
      ? dedupLedger.rejectedRecords
      : [];
    const ok =
      rejected.length >= 6 &&
      dedupLedger?.rejectedCountedAsVerified === 0 &&
      dedupLedger?.ssrfAndNonAmazonHostsRejected === true &&
      dedupLedger?.asinDiscrepancyRejected === true &&
      dedupLedger?.categorySearchAndSponsoredRejected === true &&
      rejected.every(
        (r) =>
          Array.isArray(r?.rejectionReasons) &&
          r.rejectionReasons.length > 0 &&
          typeof r?.observedAt === "string" &&
          r.observedAt.length > 0 &&
          typeof r?.researchRunId === "string" &&
          r.researchRunId.length > 0 &&
          r?.countedInPositiveTotals === false
      );
    addCheck(
      "CHK_09_DEDUP_AND_REJECTION_LEDGER",
      "Unsafe/SSRF/wrong-host/category/sponsored/conflicting-ASIN inputs rejected, preserved with lineage, and excluded from positive counts",
      Boolean(ok),
      ok
        ? `Verified ${rejected.length} rejected records preserved with lineage and 0 counted as verified.`
        : `Rejection ledger violation: count=${rejected.length}, rejectedCountedAsVerified=${dedupLedger?.rejectedCountedAsVerified}`
    );
  }

  // CHK_10: SQLite Persistence Idempotency, Workspace Isolation & Legacy Run Compatibility (A13, A14, A15)
  {
    const ok =
      persistDoc?.compositeKeyIdempotencyVerified === true &&
      persistDoc?.duplicateRowsOnRetry === 0 &&
      persistDoc?.workspaceIsolationVerified === true &&
      persistDoc?.crossWorkspaceLeakCount === 0 &&
      persistDoc?.legacyRunWithoutMarketplaceEvidenceReadable === true &&
      persistDoc?.legacyUiUnchangedWhenEmpty === true;
    addCheck(
      "CHK_10_SQLITE_PERSISTENCE_IDEMPOTENCY_AND_ISOLATION",
      "SQLite composite key prevents duplicate ASIN rows on retry; Workspace A and B are isolated; legacy runs without marketplaceEvidence remain readable",
      Boolean(ok),
      ok
        ? "SQLite idempotency, workspace isolation, and legacy compatibility verified."
        : `Persistence proof violation: ${JSON.stringify(persistDoc)}`
    );
  }

  // CHK_11: 3-Way SQLite <-> HTTP GET <-> Chromium DOM Parity (A20)
  {
    const comps: any[] = Array.isArray(parityDoc?.fieldComparisons)
      ? parityDoc.fieldComparisons
      : [];
    const allMatch =
      comps.length >= 8 &&
      comps.every(
        (c) =>
          c?.matched === true &&
          JSON.stringify(c.sqliteValue) === JSON.stringify(c.httpGetValue) &&
          JSON.stringify(c.sqliteValue) === JSON.stringify(c.chromiumDomValue)
      );
    const ok =
      parityDoc?.reconciled === true &&
      parityDoc?.mismatchCount === 0 &&
      allMatch;
    addCheck(
      "CHK_11_THREE_WAY_SQLITE_HTTP_CHROMIUM_PARITY",
      "Persisted Amazon evidence matches byte-for-byte across SQLite, HTTP GET endpoints, and Chromium DOM attributes",
      Boolean(ok),
      ok
        ? `Verified ${comps.length} 3-way field comparisons with 0 mismatches.`
        : `3-way parity mismatch: reconciled=${parityDoc?.reconciled}, mismatchCount=${parityDoc?.mismatchCount}, allMatch=${allMatch}`
    );
  }

  // CHK_12: Read-Only HTTP Non-Mutation Proof (A19)
  {
    const ok =
      readOnlyDoc?.passed === true &&
      readOnlyDoc?.mutationDetected === false &&
      typeof readOnlyDoc?.preSnapshotDigest === "string" &&
      readOnlyDoc.preSnapshotDigest.length === 64 &&
      readOnlyDoc?.preSnapshotDigest === readOnlyDoc?.postSnapshotDigest &&
      JSON.stringify(readOnlyDoc?.preTableRowCounts) ===
        JSON.stringify(readOnlyDoc?.postTableRowCounts) &&
      typeof readOnlyDoc?.requestsTestedCount === "number" &&
      readOnlyDoc.requestsTestedCount >= 5 &&
      readOnlyDoc?.testedStatusesIncluded?.includes(200) &&
      readOnlyDoc?.testedStatusesIncluded?.includes(403) &&
      readOnlyDoc?.testedStatusesIncluded?.includes(404);
    addCheck(
      "CHK_12_READ_ONLY_HTTP_NONMUTATION",
      "HTTP GET endpoints perform zero database writes across 200, 403, and 404 responses",
      Boolean(ok),
      ok
        ? `Verified ${readOnlyDoc?.requestsTestedCount} GET requests with identical pre/post DB digest.`
        : `Read-only HTTP non-mutation failed: ${JSON.stringify(readOnlyDoc)}`
    );
  }

  // CHK_13: Amazon Provider Gate Honesty & Non-Inflation of G15/G16 (A16, A21, A23, A26)
  {
    const evalObj = gateDoc?.evaluation;
    const counts = evalObj?.counts;
    const isAuthorizedPolicy =
      evalObj?.policyStatus === "AUTHORIZED_CREATORS_API" ||
      evalObj?.policyStatus === "AUTHORIZED_USER_LIMITED_URL";
    const liveCount = counts?.verifiedLiveUsProductIdentitiesCount ?? 0;
    const liveVerdictHonest =
      evalObj?.realProviderVerdict === "REAL_PROVIDER_VERIFIED"
        ? isAuthorizedPolicy &&
          liveCount >= 3 &&
          counts?.authorizedLiveRows >= 3 &&
          evalObj?.overallPilotStatus === "FEATURE_ACCEPTED"
        : evalObj?.overallPilotStatus !== "FEATURE_ACCEPTED";
    const nonInflationOk =
      evalObj?.g15DemandUnchanged === true &&
      evalObj?.g16MerchantGateUnchanged === true &&
      gateDoc?.opportunityScoreWeightsUnchanged === true &&
      gateDoc?.fixturesRejectedByLiveGate === true &&
      gateDoc?.disabledProviderNotCountedAsLive === true;
    const ok =
      evalObj?.engineeringVerdict === "ENGINEERING_READY" &&
      liveVerdictHonest &&
      nonInflationOk;
    addCheck(
      "CHK_13_AMAZON_PROVIDER_GATE_HONESTY",
      "AMAZON_PROVIDER_GATE.json separates ENGINEERING_READY from REAL_PROVIDER_VERIFIED, blocks fixture promotion, and leaves G15/G16 unchanged",
      Boolean(ok),
      ok
        ? `Gate honest: engineering=${evalObj?.engineeringVerdict}, realProvider=${evalObj?.realProviderVerdict}, overall=${evalObj?.overallPilotStatus}`
        : `Amazon provider gate dishonesty detected: ${JSON.stringify(gateDoc)}`
    );
  }

  // CHK_14: Historical DEV/HOLDOUT & Point-in-Time Audit (A27)
  {
    const devOk =
      devBacktest?.split === "DEV" &&
      devBacktest?.futureLeakageDetected === false &&
      devBacktest?.futureLeakageCount === 0 &&
      devBacktest?.demandCoverageStatus === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      devBacktest?.verdict === "INSUFFICIENT_HISTORICAL_EVIDENCE";
    const holdoutOk =
      holdoutBacktest?.split === "HOLDOUT" &&
      holdoutBacktest?.futureLeakageDetected === false &&
      holdoutBacktest?.futureLeakageCount === 0 &&
      holdoutBacktest?.demandCoverageStatus === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      holdoutBacktest?.verdict === "INSUFFICIENT_HISTORICAL_EVIDENCE";
    const pitOk =
      pitDoc?.pointInTimeVerdict === "PASS" &&
      pitDoc?.postCutoffAmazonLeakageRejected === true &&
      pitDoc?.negativeTimeTravelControlPassed === true &&
      pitDoc?.missingHistoricalAmazonClassifiedHonestly === "NOT_AVAILABLE_AT_ASOF";
    addCheck(
      "CHK_14_POINT_IN_TIME_AND_BACKTEST_INTEGRITY",
      "Historical DEV/HOLDOUT backtests enforce strict point-in-time cutoffs, reject post-cutoff Amazon observations, and preserve honest INSUFFICIENT_HISTORICAL_EVIDENCE demand status",
      Boolean(devOk && holdoutOk && pitOk),
      devOk && holdoutOk && pitOk
        ? "DEV/HOLDOUT point-in-time backtest and post-cutoff Amazon guard verified."
        : `Backtest/PIT violation: devOk=${devOk}, holdoutOk=${holdoutOk}, pitOk=${pitOk}`
    );
  }

  // CHK_15: Async Worker Barrier & Cancellation Cleanup (A12)
  {
    const ok =
      barrierDoc?.barrierSatisfied === true &&
      barrierDoc?.zeroRunningJobs === true &&
      barrierDoc?.jobsFailed === 0 &&
      barrierDoc?.jobsTimedOut === 0 &&
      barrierDoc?.staleWorkerWriteBlocked === true &&
      barrierDoc?.abortClosesMcpSessionImmediately === true;
    addCheck(
      "CHK_15_ASYNC_WORKER_BARRIER",
      "Async worker barrier satisfied with zero running/failed jobs, abort cleanup verified, and stale worker writes blocked",
      Boolean(ok),
      ok
        ? "Async worker barrier and stale-worker write guard verified."
        : `Async worker barrier violation: ${JSON.stringify(barrierDoc)}`
    );
  }

  // CHK_16: Test, Build & Chromium Execution Proof (A28, A29)
  {
    const testsOk =
      testDoc?.status === "PASS" &&
      testDoc?.failedTestsCount === 0 &&
      testDoc?.skippedTestsCount === 0 &&
      typeof testDoc?.uniqueExecutedTestsCount === "number" &&
      testDoc.uniqueExecutedTestsCount >= 490 &&
      typeof testDoc?.integrationTestsCount === "number" &&
      testDoc.integrationTestsCount >= 18;
    const buildOk =
      buildDoc?.buildStatus === "BUILD_PASS" && buildDoc?.exitCode === 0;
    const chromOk =
      chromiumDoc?.chromiumStatus === "PASS" &&
      chromiumDoc?.zeroConsoleErrors === true &&
      chromiumDoc?.zeroPageErrors === true &&
      chromiumDoc?.existingTabsFiltersAndDrawerUnregressed === true;
    addCheck(
      "CHK_16_TEST_BUILD_CHROMIUM_EXECUTION",
      "Full unit+integration suites (>=490 unique tests, >=18 integration, 0 failed/skipped), fresh Next build, and headless Chromium pass on CODE_SHA",
      Boolean(testsOk && buildOk && chromOk),
      testsOk && buildOk && chromOk
        ? `Tests=${testDoc?.uniqueExecutedTestsCount} unique (${testDoc?.integrationTestsCount} integration), Build=BUILD_PASS, Chromium=PASS.`
        : `Execution report failure: testsOk=${testsOk}, buildOk=${buildOk}, chromOk=${chromOk}`
    );
  }

  // CHK_17: Negative Control Mutation Suite (>=20 mutations caught) (A30)
  if (!options?.skipSelfMutationCheck) {
    const ok =
      negDoc?.suiteVerdict === "PASS" &&
      typeof negDoc?.totalMutations === "number" &&
      negDoc.totalMutations >= 20 &&
      negDoc?.totalCaughtAndRejected === negDoc?.totalMutations &&
      negDoc?.falsePassEscapes === 0 &&
      Array.isArray(negDoc?.cases) &&
      negDoc.cases.length === negDoc.totalMutations &&
      negDoc.cases.every((c: any) => c?.caughtAndRejected === true);
    addCheck(
      "CHK_17_NEGATIVE_CONTROL_MUTATION_SUITE",
      "Independent validator catches and rejects >=20 adversarial false-PASS mutations with 0 escapes",
      Boolean(ok),
      ok
        ? `Verified ${negDoc?.totalCaughtAndRejected}/${negDoc?.totalMutations} adversarial mutations caught and rejected.`
        : `Negative control mutation suite invalid: ${JSON.stringify(negDoc)}`
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
 * Writes a canonical valid 24-artifact baseline fixture into `dir` for unit testing
 * the validator and running the 24 physical-file negative control mutations.
 */
export function writeCanonicalValidAmazonPilotFixture(
  dir: string,
  codeSha: string = "a".repeat(40)
): void {
  fs.mkdirSync(dir, { recursive: true });
  const baseSha = "c1833362cf6634917f2ff94df19d97c393247d94";
  const nowIso = "2026-10-31T16:00:00.000Z";

  const canonicalExtractedPayload = {
    asin: "B08N5WRWNW",
    parentAsin: "B08N5WRWN0",
    variationAsin: "B08N5WRWNW",
    canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
    productTitle: "UAHPET Wireless Cat Water Fountain Stainless Steel",
    brand: "UAHPET",
    merchant: "UAHPET Official",
    seller: "UAHPET Direct",
    currency: "USD",
    price: 49.99,
    availability: "In Stock",
    verifiedDeliveryMarket: "US",
    modelNumber: "UAH-WF-01",
    sku: "UAH-WF-01",
    gtin: null,
  };
  const extractedFieldsHash =
    computeDeterministicEvidenceHash(canonicalExtractedPayload) || "b".repeat(64);
  const rawEvidenceHash = "c".repeat(64);

  const writeJson = (name: string, data: unknown) => {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), "utf8");
  };

  writeJson("BASELINE_AND_BRANCH_PROOF.json", {
    version: "12.4.3.5.0",
    branch: "feature/kh02-amazon-us-pilot-v12.4.3.5.0",
    baseSha,
    codeSha,
  });

  fs.writeFileSync(
    path.join(dir, "FUNCTION_MAP.md"),
    "# Function Map\n- `validateAmazonUsProductUrl`\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "FEATURE_EXECUTION_PLAN.md"),
    "# Feature Execution Plan\n- Phase 0..5\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "FINAL_FEATURE_ACCEPTANCE_REPORT.md"),
    "# Final Feature Acceptance Report\n- Status: ENGINEERING_COMPLETE_EXTERNAL_BLOCKED\n",
    "utf8"
  );

  writeJson("FEATURE_ACCEPTANCE_MATRIX.json", {
    version: "12.4.3.5.0",
    requirements: Array.from({ length: 30 }, (_, i) => {
      const id = `A${String(i + 1).padStart(2, "0")}`;
      return {
        id,
        title: `Requirement ${id}`,
        testId: `tests/unit/kh02/v12_4_3_5_0_AmazonUsPilotAcceptance.test.ts::${id}`,
        passed: true,
      };
    }),
  });

  writeJson("PROVIDER_POLICY_AND_ACCESS_DECISION.json", {
    version: "12.4.3.5.0",
    defaultFeatureEnabled: false,
    defaultLiveAllowed: false,
    unauthorizedLiveAttemptStatus: "BLOCKED_POLICY",
    zeroNetworkCallsWhenFlagOff: true,
    userRequestCannotOverrideServerFlag: true,
  });

  writeJson("PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json", {
    version: "12.4.3.5.0",
    packageSpec: "@playwright/mcp@0.0.83",
    handshakeExecuted: true,
    handshakeStatus: "CONNECTED_READY",
    discoveredTools: ["browser_navigate", "browser_snapshot", "browser_close"],
    sessionClosedCleanly: true,
    residualProcessesCount: 0,
    unavailableClientClassification: "MCP_NOT_CONFIGURED",
  });

  writeJson("AMAZON_PROVIDER_OPERATION_LEDGER.json", {
    version: "12.4.3.5.0",
    maxConcurrencyObserved: 1,
    maxOperationsPerRunAllowed: 4,
    maxAttemptsPerOperationAllowed: 2,
    fifthOperationBlockedByCap: true,
    rollingWindowRateGateVerified: true,
    operations: [
      {
        operationId: "amz_op_1",
        providerInvocationRef: "amz_inv_run1_cand1_01",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        attemptCount: 1,
        status: "IDENTITY_VERIFIED",
      },
      {
        operationId: "amz_op_2",
        providerInvocationRef: "amz_inv_run1_cand2_02",
        providerRequestId: "amz-upstream-req-99",
        providerRequestIdOrigin: "UPSTREAM",
        attemptCount: 1,
        status: "IDENTITY_VERIFIED",
      },
      {
        operationId: "amz_op_3",
        providerInvocationRef: "amz_inv_run1_cand3_03",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        attemptCount: 1,
        status: "BLOCKED_POLICY",
      },
    ],
  });

  writeJson("AMAZON_RAW_EVIDENCE_MANIFEST.json", {
    version: "12.4.3.5.0",
    absentPriceStoredAsNullNotZero: true,
    reviewCountAndBsrExcludedFromSalesAndScore: true,
    promptInjectionAndScriptTagsStripped: true,
    evidenceRecords: [
      {
        id: "amz_ev_1",
        asin: "B08N5WRWNW",
        rawEvidenceHash,
        extractedFieldsHash,
        extractedCanonicalPayload: canonicalExtractedPayload,
      },
      {
        id: "amz_ev_2",
        asin: "B09V3KXJPB",
        rawEvidenceHash,
        extractedFieldsHash,
        extractedCanonicalPayload: canonicalExtractedPayload,
      },
      {
        id: "amz_ev_3",
        asin: "B07FZ8S74R",
        rawEvidenceHash,
        extractedFieldsHash,
        extractedCanonicalPayload: canonicalExtractedPayload,
      },
    ],
  });

  writeJson("AMAZON_IDENTITY_AND_MATCH_LEDGER.json", {
    version: "12.4.3.5.0",
    exactMatchRequiresBeyondBrandCorroboration: true,
    brandOnlyMatchExcludedFromExactProduct: true,
    variationChildAndParentAsinPreserved: true,
    canonicalDeduplicationVerified: true,
    records: [
      {
        candidateId: "cand_1",
        asin: "B08N5WRWNW",
        parentAsin: "B08N5WRWN0",
        variationAsin: "B08N5WRWNW",
        identityMatch: "EXACT_PRODUCT",
        brandOnlyCorroboration: false,
      },
      {
        candidateId: "cand_2",
        asin: "B09V3KXJPB",
        parentAsin: null,
        variationAsin: null,
        identityMatch: "PROBABLE_PRODUCT",
        brandOnlyCorroboration: false,
      },
      {
        candidateId: "cand_3",
        asin: "B07FZ8S74R",
        parentAsin: null,
        variationAsin: null,
        identityMatch: "BRAND_ONLY",
        brandOnlyCorroboration: true,
      },
    ],
  });

  writeJson("AMAZON_DEDUP_AND_REJECTION_LEDGER.json", {
    version: "12.4.3.5.0",
    rejectedCountedAsVerified: 0,
    ssrfAndNonAmazonHostsRejected: true,
    asinDiscrepancyRejected: true,
    categorySearchAndSponsoredRejected: true,
    rejectedRecords: [
      {
        sourceUrl: "http://127.0.0.1/dp/B08N5WRWNW",
        rejectionReasons: ["SSRF_OR_PRIVATE_HOST_REJECTED"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
      {
        sourceUrl: "https://www.amazon.co.uk/dp/B08N5WRWNW",
        rejectionReasons: ["NON_US_AMAZON_MARKETPLACE_REJECTED"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
      {
        sourceUrl: "https://www.amazon.com/s?k=pet+fountain",
        rejectionReasons: ["NON_PRODUCT_SEARCH_OR_CATEGORY_URL"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
      {
        sourceUrl: "https://www.amazon.com/sspa/click?ie=UTF8",
        rejectionReasons: ["SPONSORED_REDIRECT_URL_REJECTED"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        rejectionReasons: ["ASIN_DISCREPANCY_REJECTED"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
      {
        sourceUrl: "https://amzn.to/3xyz123",
        rejectionReasons: ["SHORTENER_DOMAIN_REJECTED"],
        observedAt: nowIso,
        researchRunId: "run_1",
        countedInPositiveTotals: false,
      },
    ],
  });

  writeJson("PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json", {
    version: "12.4.3.5.0",
    compositeKeyIdempotencyVerified: true,
    duplicateRowsOnRetry: 0,
    workspaceIsolationVerified: true,
    crossWorkspaceLeakCount: 0,
    legacyRunWithoutMarketplaceEvidenceReadable: true,
    legacyUiUnchangedWhenEmpty: true,
  });

  writeJson("API_UI_SQLITE_CHROMIUM_PARITY.json", {
    version: "12.4.3.5.0",
    codeSha,
    reconciled: true,
    mismatchCount: 0,
    fieldComparisons: [
      {
        candidateId: "cand_1",
        field: "asin",
        sqliteValue: "B08N5WRWNW",
        httpGetValue: "B08N5WRWNW",
        chromiumDomValue: "B08N5WRWNW",
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "canonicalAmazonUrl",
        sqliteValue: "https://www.amazon.com/dp/B08N5WRWNW",
        httpGetValue: "https://www.amazon.com/dp/B08N5WRWNW",
        chromiumDomValue: "https://www.amazon.com/dp/B08N5WRWNW",
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "identityMatch",
        sqliteValue: "EXACT_PRODUCT",
        httpGetValue: "EXACT_PRODUCT",
        chromiumDomValue: "EXACT_PRODUCT",
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "status",
        sqliteValue: "IDENTITY_VERIFIED",
        httpGetValue: "IDENTITY_VERIFIED",
        chromiumDomValue: "IDENTITY_VERIFIED",
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "observedAt",
        sqliteValue: nowIso,
        httpGetValue: nowIso,
        chromiumDomValue: nowIso,
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "observationClass",
        sqliteValue: "IMPORTED_BY_USER",
        httpGetValue: "IMPORTED_BY_USER",
        chromiumDomValue: "IMPORTED_BY_USER",
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "rawEvidenceHash",
        sqliteValue: rawEvidenceHash,
        httpGetValue: rawEvidenceHash,
        chromiumDomValue: rawEvidenceHash,
        matched: true,
      },
      {
        candidateId: "cand_1",
        field: "extractedFieldsHash",
        sqliteValue: extractedFieldsHash,
        httpGetValue: extractedFieldsHash,
        chromiumDomValue: extractedFieldsHash,
        matched: true,
      },
    ],
  });

  writeJson("READ_ONLY_HTTP_NONMUTATION_PROOF.json", {
    version: "12.4.3.5.0",
    codeSha,
    passed: true,
    mutationDetected: false,
    preSnapshotDigest: "d".repeat(64),
    postSnapshotDigest: "d".repeat(64),
    preTableRowCounts: { syncJob: 10, researchEvidence: 3, researchProduct: 6 },
    postTableRowCounts: { syncJob: 10, researchEvidence: 3, researchProduct: 6 },
    requestsTestedCount: 6,
    testedStatusesIncluded: [200, 403, 404],
  });

  writeJson("AMAZON_PROVIDER_GATE.json", {
    version: "12.4.3.5.0",
    codeSha,
    opportunityScoreWeightsUnchanged: true,
    fixturesRejectedByLiveGate: true,
    disabledProviderNotCountedAsLive: true,
    evaluation: {
      evaluatedAt: nowIso,
      researchRunId: "run_1",
      workspaceId: "ws_1",
      provider: "AMAZON_US",
      engineeringVerdict: "ENGINEERING_READY",
      realProviderVerdict: "BLOCKED_POLICY",
      overallPilotStatus: "ENGINEERING_COMPLETE_EXTERNAL_BLOCKED",
      policyStatus: "DISABLED_BY_DEFAULT",
      counts: {
        totalEvidenceRows: 3,
        sameRunWorkspaceVerifiedRows: 3,
        authorizedLiveRows: 0,
        fixtureOrCachedRowsExcludedFromLive: 3,
        identityExactMatchCount: 2,
        identityProbableMatchCount: 1,
        brandOnlyMatchCount: 0,
        rejectedCount: 0,
        verifiedLiveUsProductIdentitiesCount: 0,
        requiredLiveUsProductIdentitiesTarget: 3,
      },
      g15DemandUnchanged: true,
      g16MerchantGateUnchanged: true,
      reasons: [],
      blockers: ["BLOCKED_POLICY: Live Amazon US access is disabled by default."],
    },
  });

  writeJson("HISTORICAL_DEV_BACKTEST.json", {
    version: "12.4.3.5.0",
    codeSha,
    split: "DEV",
    futureLeakageDetected: false,
    futureLeakageCount: 0,
    demandCoverageStatus: "INSUFFICIENT_HISTORICAL_EVIDENCE",
    verdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
  });

  writeJson("HISTORICAL_HOLDOUT_BACKTEST.json", {
    version: "12.4.3.5.0",
    codeSha,
    split: "HOLDOUT",
    futureLeakageDetected: false,
    futureLeakageCount: 0,
    demandCoverageStatus: "INSUFFICIENT_HISTORICAL_EVIDENCE",
    verdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
  });

  writeJson("POINT_IN_TIME_AUDIT.json", {
    version: "12.4.3.5.0",
    codeSha,
    pointInTimeVerdict: "PASS",
    postCutoffAmazonLeakageRejected: true,
    negativeTimeTravelControlPassed: true,
    missingHistoricalAmazonClassifiedHonestly: "NOT_AVAILABLE_AT_ASOF",
  });

  writeJson("ASYNC_WORKER_BARRIER.json", {
    version: "12.4.3.5.0",
    codeSha,
    barrierSatisfied: true,
    zeroRunningJobs: true,
    jobsScheduled: 6,
    jobsCompleted: 6,
    jobsFailed: 0,
    jobsTimedOut: 0,
    staleWorkerWriteBlocked: true,
    abortClosesMcpSessionImmediately: true,
  });

  writeJson("TEST_EXECUTION_REPORT.json", {
    version: "12.4.3.5.0",
    codeSha,
    status: "PASS",
    uniqueExecutedTestsCount: 510,
    integrationTestsCount: 18,
    failedTestsCount: 0,
    skippedTestsCount: 0,
  });

  writeJson("BUILD_EXECUTION_REPORT.json", {
    version: "12.4.3.5.0",
    codeSha,
    buildStatus: "BUILD_PASS",
    exitCode: 0,
  });

  writeJson("CHROMIUM_EXECUTION_REPORT.json", {
    version: "12.4.3.5.0",
    codeSha,
    chromiumStatus: "PASS",
    zeroConsoleErrors: true,
    zeroPageErrors: true,
    existingTabsFiltersAndDrawerUnregressed: true,
  });

  writeJson("SOURCE_SHA_PROVENANCE.json", {
    version: "12.4.3.5.0",
    branch: "feature/kh02-amazon-us-pilot-v12.4.3.5.0",
    baseSha,
    codeSha,
  });

  writeJson("NEGATIVE_CONTROL_MUTATIONS.json", {
    evaluatedAt: nowIso,
    totalMutations: 24,
    totalCaughtAndRejected: 24,
    falsePassEscapes: 0,
    suiteVerdict: "PASS",
    cases: Array.from({ length: 24 }, (_, idx) => ({
      mutationId: `AMZ_MUT_${String(idx + 1).padStart(2, "0")}`,
      targetArtifact: "AMAZON_PROVIDER_GATE.json",
      description: "Adversarial mutation caught",
      expectedViolatedCheckId: "CHK_13_AMAZON_PROVIDER_GATE_HONESTY",
      caughtAndRejected: true,
      failedCheckIds: ["CHK_13_AMAZON_PROVIDER_GATE_HONESTY"],
    })),
  });
}

/**
 * Executes 24 physical-file negative control mutations (AMZ_MUT_01..AMZ_MUT_24)
 * against a copy of `sourceDir`, proving the validator catches and rejects every single one.
 */
export function runAmazonUsPilotNegativeMutationSuite(
  sourceDir: string
): NegativeControlMutationSuiteReport {
  const mutations: Array<{
    mutationId: string;
    targetArtifact: string;
    description: string;
    expectedViolatedCheckId: string;
    mutate: (dir: string) => void;
  }> = [
    {
      mutationId: "AMZ_MUT_01_MISSING_MANDATORY_ARTIFACT",
      targetArtifact: "AMAZON_PROVIDER_GATE.json",
      description: "Deletes mandatory artifact AMAZON_PROVIDER_GATE.json from disk",
      expectedViolatedCheckId: "CHK_01_MANDATORY_ARTIFACTS_PRESENT",
      mutate: (d) => fs.unlinkSync(path.join(d, "AMAZON_PROVIDER_GATE.json")),
    },
    {
      mutationId: "AMZ_MUT_02_STALE_CODE_SHA_IN_PARITY",
      targetArtifact: "API_UI_SQLITE_CHROMIUM_PARITY.json",
      description: "Mutates codeSha in API_UI_SQLITE_CHROMIUM_PARITY.json to a stale commit SHA",
      expectedViolatedCheckId: "CHK_02_BRANCH_AND_CODE_SHA_PROVENANCE",
      mutate: (d) => {
        const j = readJsonSafe(d, "API_UI_SQLITE_CHROMIUM_PARITY.json");
        j.codeSha = "0".repeat(40);
        fs.writeFileSync(path.join(d, "API_UI_SQLITE_CHROMIUM_PARITY.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_03_WRONG_BRANCH_NAME",
      targetArtifact: "SOURCE_SHA_PROVENANCE.json",
      description: "Mutates branch in SOURCE_SHA_PROVENANCE.json to master",
      expectedViolatedCheckId: "CHK_02_BRANCH_AND_CODE_SHA_PROVENANCE",
      mutate: (d) => {
        const j = readJsonSafe(d, "SOURCE_SHA_PROVENANCE.json");
        j.branch = "master";
        fs.writeFileSync(path.join(d, "SOURCE_SHA_PROVENANCE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_04_FAILING_ACCEPTANCE_MATRIX_ITEM",
      targetArtifact: "FEATURE_ACCEPTANCE_MATRIX.json",
      description: "Marks requirement A16 as passed=false in FEATURE_ACCEPTANCE_MATRIX.json",
      expectedViolatedCheckId: "CHK_03_ACCEPTANCE_MATRIX_A01_A30",
      mutate: (d) => {
        const j = readJsonSafe(d, "FEATURE_ACCEPTANCE_MATRIX.json");
        j.requirements[15].passed = false;
        fs.writeFileSync(path.join(d, "FEATURE_ACCEPTANCE_MATRIX.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_05_DEFAULT_FLAG_ENABLED_TRUE",
      targetArtifact: "PROVIDER_POLICY_AND_ACCESS_DECISION.json",
      description: "Mutates defaultFeatureEnabled to true (violating default-OFF contract)",
      expectedViolatedCheckId: "CHK_04_DEFAULT_FLAGS_AND_POLICY_GUARD",
      mutate: (d) => {
        const j = readJsonSafe(d, "PROVIDER_POLICY_AND_ACCESS_DECISION.json");
        j.defaultFeatureEnabled = true;
        fs.writeFileSync(
          path.join(d, "PROVIDER_POLICY_AND_ACCESS_DECISION.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_06_MCP_RESIDUAL_PROCESS_LEAK",
      targetArtifact: "PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json",
      description: "Mutates residualProcessesCount to 1 (unclosed MCP child process leak)",
      expectedViolatedCheckId: "CHK_05_PLAYWRIGHT_MCP_SESSION_TRUTH",
      mutate: (d) => {
        const j = readJsonSafe(d, "PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json");
        j.residualProcessesCount = 1;
        fs.writeFileSync(
          path.join(d, "PLAYWRIGHT_MCP_HANDSHAKE_AND_SESSION.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_07_CONCURRENCY_EXCEEDS_ONE",
      targetArtifact: "AMAZON_PROVIDER_OPERATION_LEDGER.json",
      description: "Mutates maxConcurrencyObserved to 2 (violating single-flight concurrency=1)",
      expectedViolatedCheckId: "CHK_06_OPERATION_LEDGER_BUDGET_AND_ID_SEPARATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_PROVIDER_OPERATION_LEDGER.json");
        j.maxConcurrencyObserved = 2;
        fs.writeFileSync(
          path.join(d, "AMAZON_PROVIDER_OPERATION_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_08_FABRICATED_UPSTREAM_REQUEST_ID",
      targetArtifact: "AMAZON_PROVIDER_OPERATION_LEDGER.json",
      description: "Copies local providerInvocationRef into providerRequestId when upstream ID is absent",
      expectedViolatedCheckId: "CHK_06_OPERATION_LEDGER_BUDGET_AND_ID_SEPARATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_PROVIDER_OPERATION_LEDGER.json");
        j.operations[0].providerRequestId = j.operations[0].providerInvocationRef;
        fs.writeFileSync(
          path.join(d, "AMAZON_PROVIDER_OPERATION_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_09_TAMPERED_EXTRACTED_FIELDS_HASH",
      targetArtifact: "AMAZON_RAW_EVIDENCE_MANIFEST.json",
      description: "Tamper with extractedCanonicalPayload.price without updating extractedFieldsHash",
      expectedViolatedCheckId: "CHK_07_RAW_EVIDENCE_HASH_AND_SANITIZATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_RAW_EVIDENCE_MANIFEST.json");
        j.evidenceRecords[0].extractedCanonicalPayload.price = 999.99;
        fs.writeFileSync(path.join(d, "AMAZON_RAW_EVIDENCE_MANIFEST.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_10_ABSENT_PRICE_COERCED_TO_ZERO",
      targetArtifact: "AMAZON_RAW_EVIDENCE_MANIFEST.json",
      description: "Sets absentPriceStoredAsNullNotZero to false",
      expectedViolatedCheckId: "CHK_07_RAW_EVIDENCE_HASH_AND_SANITIZATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_RAW_EVIDENCE_MANIFEST.json");
        j.absentPriceStoredAsNullNotZero = false;
        fs.writeFileSync(path.join(d, "AMAZON_RAW_EVIDENCE_MANIFEST.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_11_BRAND_ONLY_COUNTED_AS_EXACT_MATCH",
      targetArtifact: "AMAZON_IDENTITY_AND_MATCH_LEDGER.json",
      description: "Marks a brandOnlyCorroboration=true record as EXACT_PRODUCT",
      expectedViolatedCheckId: "CHK_08_IDENTITY_AND_VARIATION_LEDGER",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_IDENTITY_AND_MATCH_LEDGER.json");
        j.records[2].identityMatch = "EXACT_PRODUCT";
        fs.writeFileSync(
          path.join(d, "AMAZON_IDENTITY_AND_MATCH_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_12_VARIATION_ASIN_COLLAPSED",
      targetArtifact: "AMAZON_IDENTITY_AND_MATCH_LEDGER.json",
      description: "Sets variationChildAndParentAsinPreserved to false",
      expectedViolatedCheckId: "CHK_08_IDENTITY_AND_VARIATION_LEDGER",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_IDENTITY_AND_MATCH_LEDGER.json");
        j.variationChildAndParentAsinPreserved = false;
        fs.writeFileSync(
          path.join(d, "AMAZON_IDENTITY_AND_MATCH_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_13_REJECTED_URL_COUNTED_IN_POSITIVE_TOTALS",
      targetArtifact: "AMAZON_DEDUP_AND_REJECTION_LEDGER.json",
      description: "Mutates rejectedCountedAsVerified to 1",
      expectedViolatedCheckId: "CHK_09_DEDUP_AND_REJECTION_LEDGER",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_DEDUP_AND_REJECTION_LEDGER.json");
        j.rejectedCountedAsVerified = 1;
        fs.writeFileSync(
          path.join(d, "AMAZON_DEDUP_AND_REJECTION_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_14_SSRF_OR_ASIN_DISCREPANCY_UNCHECKED",
      targetArtifact: "AMAZON_DEDUP_AND_REJECTION_LEDGER.json",
      description: "Sets asinDiscrepancyRejected to false",
      expectedViolatedCheckId: "CHK_09_DEDUP_AND_REJECTION_LEDGER",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_DEDUP_AND_REJECTION_LEDGER.json");
        j.asinDiscrepancyRejected = false;
        fs.writeFileSync(
          path.join(d, "AMAZON_DEDUP_AND_REJECTION_LEDGER.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_15_DUPLICATE_ROWS_ON_SQLITE_RETRY",
      targetArtifact: "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json",
      description: "Mutates duplicateRowsOnRetry to 2",
      expectedViolatedCheckId: "CHK_10_SQLITE_PERSISTENCE_IDEMPOTENCY_AND_ISOLATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json");
        j.duplicateRowsOnRetry = 2;
        fs.writeFileSync(
          path.join(d, "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_16_CROSS_WORKSPACE_LEAKAGE",
      targetArtifact: "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json",
      description: "Mutates crossWorkspaceLeakCount to 1 (Workspace B sees Workspace A evidence)",
      expectedViolatedCheckId: "CHK_10_SQLITE_PERSISTENCE_IDEMPOTENCY_AND_ISOLATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json");
        j.crossWorkspaceLeakCount = 1;
        fs.writeFileSync(
          path.join(d, "PERSISTED_MARKETPLACE_EVIDENCE_PROOF.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_17_CHROMIUM_DOM_ASIN_MISMATCH",
      targetArtifact: "API_UI_SQLITE_CHROMIUM_PARITY.json",
      description: "Mutates Chromium DOM ASIN so it diverges from SQLite and HTTP GET",
      expectedViolatedCheckId: "CHK_11_THREE_WAY_SQLITE_HTTP_CHROMIUM_PARITY",
      mutate: (d) => {
        const j = readJsonSafe(d, "API_UI_SQLITE_CHROMIUM_PARITY.json");
        j.fieldComparisons[0].chromiumDomValue = "B00000FAKE";
        fs.writeFileSync(
          path.join(d, "API_UI_SQLITE_CHROMIUM_PARITY.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_18_READ_ONLY_GET_MUTATES_DB_DIGEST",
      targetArtifact: "READ_ONLY_HTTP_NONMUTATION_PROOF.json",
      description: "Mutates postSnapshotDigest to differ from preSnapshotDigest after GET calls",
      expectedViolatedCheckId: "CHK_12_READ_ONLY_HTTP_NONMUTATION",
      mutate: (d) => {
        const j = readJsonSafe(d, "READ_ONLY_HTTP_NONMUTATION_PROOF.json");
        j.postSnapshotDigest = "f".repeat(64);
        fs.writeFileSync(
          path.join(d, "READ_ONLY_HTTP_NONMUTATION_PROOF.json"),
          JSON.stringify(j)
        );
      },
    },
    {
      mutationId: "AMZ_MUT_19_FALSE_PASS_FEATURE_ACCEPTED_WHEN_POLICY_BLOCKED",
      targetArtifact: "AMAZON_PROVIDER_GATE.json",
      description: "Relabels overallPilotStatus as FEATURE_ACCEPTED while realProviderVerdict is BLOCKED_POLICY",
      expectedViolatedCheckId: "CHK_13_AMAZON_PROVIDER_GATE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_PROVIDER_GATE.json");
        j.evaluation.overallPilotStatus = "FEATURE_ACCEPTED";
        fs.writeFileSync(path.join(d, "AMAZON_PROVIDER_GATE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_20_FIXTURE_PROMOTED_TO_REAL_PROVIDER_VERIFIED",
      targetArtifact: "AMAZON_PROVIDER_GATE.json",
      description: "Relabels realProviderVerdict as REAL_PROVIDER_VERIFIED with 0 authorizedLiveRows",
      expectedViolatedCheckId: "CHK_13_AMAZON_PROVIDER_GATE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_PROVIDER_GATE.json");
        j.evaluation.realProviderVerdict = "REAL_PROVIDER_VERIFIED";
        j.evaluation.overallPilotStatus = "FEATURE_ACCEPTED";
        fs.writeFileSync(path.join(d, "AMAZON_PROVIDER_GATE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_21_G15_OR_G16_INFLATED_BY_AMAZON_LISTING",
      targetArtifact: "AMAZON_PROVIDER_GATE.json",
      description: "Mutates g15DemandUnchanged to false (allowing Amazon listing to satisfy 60d demand)",
      expectedViolatedCheckId: "CHK_13_AMAZON_PROVIDER_GATE_HONESTY",
      mutate: (d) => {
        const j = readJsonSafe(d, "AMAZON_PROVIDER_GATE.json");
        j.evaluation.g15DemandUnchanged = false;
        fs.writeFileSync(path.join(d, "AMAZON_PROVIDER_GATE.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_22_POST_CUTOFF_AMAZON_TIME_TRAVEL_LEAK",
      targetArtifact: "POINT_IN_TIME_AUDIT.json",
      description: "Mutates postCutoffAmazonLeakageRejected to false in POINT_IN_TIME_AUDIT.json",
      expectedViolatedCheckId: "CHK_14_POINT_IN_TIME_AND_BACKTEST_INTEGRITY",
      mutate: (d) => {
        const j = readJsonSafe(d, "POINT_IN_TIME_AUDIT.json");
        j.postCutoffAmazonLeakageRejected = false;
        fs.writeFileSync(path.join(d, "POINT_IN_TIME_AUDIT.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_23_STALE_WORKER_WRITE_ALLOWED",
      targetArtifact: "ASYNC_WORKER_BARRIER.json",
      description: "Mutates staleWorkerWriteBlocked to false in ASYNC_WORKER_BARRIER.json",
      expectedViolatedCheckId: "CHK_15_ASYNC_WORKER_BARRIER",
      mutate: (d) => {
        const j = readJsonSafe(d, "ASYNC_WORKER_BARRIER.json");
        j.staleWorkerWriteBlocked = false;
        fs.writeFileSync(path.join(d, "ASYNC_WORKER_BARRIER.json"), JSON.stringify(j));
      },
    },
    {
      mutationId: "AMZ_MUT_24_SKIPPED_OR_FAILED_TEST_IGNORED",
      targetArtifact: "TEST_EXECUTION_REPORT.json",
      description: "Injects skippedTestsCount=1 in TEST_EXECUTION_REPORT.json while claiming status=PASS",
      expectedViolatedCheckId: "CHK_16_TEST_BUILD_CHROMIUM_EXECUTION",
      mutate: (d) => {
        const j = readJsonSafe(d, "TEST_EXECUTION_REPORT.json");
        j.skippedTestsCount = 1;
        fs.writeFileSync(path.join(d, "TEST_EXECUTION_REPORT.json"), JSON.stringify(j));
      },
    },
  ];

  const cases: NegativeControlMutationCaseResult[] = [];

  for (const m of mutations) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `amz-mut-${m.mutationId}-`));
    try {
      for (const file of fs.readdirSync(sourceDir)) {
        const srcFile = path.join(sourceDir, file);
        if (fs.statSync(srcFile).isFile()) {
          fs.copyFileSync(srcFile, path.join(tmpDir, file));
        }
      }
      m.mutate(tmpDir);
      const res = validateAmazonUsPilotAcceptanceArtifacts(tmpDir, {
        skipSelfMutationCheck: true,
      });
      const failedCheckIds = res.checks.filter((c) => !c.passed).map((c) => c.checkId);
      const caughtAndRejected =
        !res.overallValid && failedCheckIds.includes(m.expectedViolatedCheckId);
      cases.push({
        mutationId: m.mutationId,
        targetArtifact: m.targetArtifact,
        description: m.description,
        expectedViolatedCheckId: m.expectedViolatedCheckId,
        caughtAndRejected,
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
    totalMutations: cases.length,
    totalCaughtAndRejected,
    falsePassEscapes,
    suiteVerdict: falsePassEscapes === 0 ? "PASS" : "FAIL",
    cases,
  };
}
