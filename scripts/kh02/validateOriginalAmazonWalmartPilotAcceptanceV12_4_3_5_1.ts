/**
 * SWAI KH-02 V12.4.3.5.1 — Independent Validator & 36-Case Physical-File Negative Mutation Suite
 * for the Original Amazon US (Playwright MCP) + Walmart US (Free Jina Reader REST) Pilot Acceptance Package
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const REQUIRED_ORIGINAL_PILOT_ARTIFACTS_00_TO_28 = [
  "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
  "01_ORIGINAL_PILOT_CONTRACT_AND_SCOPE.json",
  "02_AMAZON_PLAYWRIGHT_MCP_PACKAGE_AND_CLI_AUDIT.json",
  "03_AMAZON_PLAYWRIGHT_MCP_HANDSHAKE_AND_TOOLS.json",
  "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
  "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
  "06_AMAZON_WORKER_DB_API_DOM_3WAY_PARITY.json",
  "07_AMAZON_LIVE_PILOT_EXECUTION_TRUTH.json",
  "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json",
  "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json",
  "10_WALMART_WORKER_DB_API_DOM_3WAY_PARITY.json",
  "11_WALMART_LIVE_JINA_PILOT_EXECUTION_TRUTH.json",
  "12_NON_INFLATION_AMAZON_WALMART_ON_VS_OFF.json",
  "13_READ_ONLY_GET_DB_DIGEST_PROOF.json",
  "14_UI_PRODUCT_FINDER_HEADLESS_CHROMIUM_AUDIT.json",
  "15_TARGETED_AMAZON_WALMART_TEST_MATRIX.json",
  "16_FULL_REPOSITORY_REGRESSION_INVENTORY.json",
  "17_UNIT_AND_INTEGRATION_SHARD_RESULTS.json",
  "18_ALL_E2E_EXECUTION_RECEIPTS.json",
  "19_REAL_DEV_BACKTEST_SUMMARY.json",
  "20_REAL_HOLDOUT_BACKTEST_SUMMARY.json",
  "21_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
  "22_NEGATIVE_MUTATION_SUITE_30PLUS_CASES.json",
  "23_INDEPENDENT_VALIDATOR_REPORT.json",
  "24_OWNED_PROCESS_RAM_DISK_LEDGER.json",
  "25_FILE_MANIFEST_SHA256.json",
  "26_FINAL_RELEASE_VERDICT.json",
  "27_COMMIT_PUSH_REMOTE_SHA_VERIFICATION.json",
  "28_FINAL_OWNER_REPORT_VI.md",
] as const;

export interface OriginalPilotValidationFailure {
  code: string;
  file: string;
  message: string;
}

export interface OriginalPilotValidationResult {
  overallVerdict: "PASS" | "FAIL";
  artifactDir: string;
  validatedAt: string;
  expectedCodeSha: string | null;
  checksExecuted: number;
  checksPassed: number;
  checksFailed: number;
  failureCodes: string[];
  failureDetails: OriginalPilotValidationFailure[];
}

export function sha256FileSync(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readJsonSafe(
  artifactDir: string,
  fileName: string,
  failures: OriginalPilotValidationFailure[]
): any | null {
  const fullPath = path.join(artifactDir, fileName);
  if (!fs.existsSync(fullPath)) {
    failures.push({
      code: "MISSING_REQUIRED_ARTIFACT",
      file: fileName,
      message: `Required artifact '${fileName}' does not exist in '${artifactDir}'.`,
    });
    return null;
  }
  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (err: any) {
    failures.push({
      code: "MALFORMED_ARTIFACT_JSON",
      file: fileName,
      message: `Failed to parse JSON in '${fileName}': ${err?.message || String(err)}`,
    });
    return null;
  }
}

export interface ValidateOriginalPilotOptions {
  expectedCodeSha?: string;
  skipPostValidationFiles?: boolean;
  skipManifestSelfCheck?: boolean;
}

export function validateOriginalAmazonWalmartPilotArtifacts(
  artifactDir: string,
  options: ValidateOriginalPilotOptions = {}
): OriginalPilotValidationResult {
  const failures: OriginalPilotValidationFailure[] = [];
  let checksExecuted = 0;

  const check = (
    condition: boolean,
    code: string,
    file: string,
    message: string
  ) => {
    checksExecuted += 1;
    if (!condition) {
      failures.push({ code, file, message });
    }
  };

  const filesToCheck = options.skipPostValidationFiles
    ? REQUIRED_ORIGINAL_PILOT_ARTIFACTS_00_TO_28.slice(0, 22)
    : REQUIRED_ORIGINAL_PILOT_ARTIFACTS_00_TO_28;

  for (const fname of filesToCheck) {
    const fpath = path.join(artifactDir, fname);
    check(
      fs.existsSync(fpath) && fs.statSync(fpath).size > 0,
      "MISSING_REQUIRED_ARTIFACT",
      fname,
      `Required artifact file '${fname}' is missing or empty.`
    );
  }

  const a00 = readJsonSafe(artifactDir, "00_GIT_BRANCH_CODE_SHA_PRECHECK.json", failures);
  const a01 = readJsonSafe(artifactDir, "01_ORIGINAL_PILOT_CONTRACT_AND_SCOPE.json", failures);
  const a02 = readJsonSafe(artifactDir, "02_AMAZON_PLAYWRIGHT_MCP_PACKAGE_AND_CLI_AUDIT.json", failures);
  const a03 = readJsonSafe(artifactDir, "03_AMAZON_PLAYWRIGHT_MCP_HANDSHAKE_AND_TOOLS.json", failures);
  const a04 = readJsonSafe(artifactDir, "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json", failures);
  const a05 = readJsonSafe(artifactDir, "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json", failures);
  const a06 = readJsonSafe(artifactDir, "06_AMAZON_WORKER_DB_API_DOM_3WAY_PARITY.json", failures);
  const a07 = readJsonSafe(artifactDir, "07_AMAZON_LIVE_PILOT_EXECUTION_TRUTH.json", failures);
  const a08 = readJsonSafe(artifactDir, "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json", failures);
  const a09 = readJsonSafe(artifactDir, "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json", failures);
  const a10 = readJsonSafe(artifactDir, "10_WALMART_WORKER_DB_API_DOM_3WAY_PARITY.json", failures);
  const a11 = readJsonSafe(artifactDir, "11_WALMART_LIVE_JINA_PILOT_EXECUTION_TRUTH.json", failures);
  const a12 = readJsonSafe(artifactDir, "12_NON_INFLATION_AMAZON_WALMART_ON_VS_OFF.json", failures);
  const a13 = readJsonSafe(artifactDir, "13_READ_ONLY_GET_DB_DIGEST_PROOF.json", failures);
  const a14 = readJsonSafe(artifactDir, "14_UI_PRODUCT_FINDER_HEADLESS_CHROMIUM_AUDIT.json", failures);
  const a15 = readJsonSafe(artifactDir, "15_TARGETED_AMAZON_WALMART_TEST_MATRIX.json", failures);
  const a16 = readJsonSafe(artifactDir, "16_FULL_REPOSITORY_REGRESSION_INVENTORY.json", failures);
  const a17 = readJsonSafe(artifactDir, "17_UNIT_AND_INTEGRATION_SHARD_RESULTS.json", failures);
  const a18 = readJsonSafe(artifactDir, "18_ALL_E2E_EXECUTION_RECEIPTS.json", failures);
  const a19 = readJsonSafe(artifactDir, "19_REAL_DEV_BACKTEST_SUMMARY.json", failures);
  const a20 = readJsonSafe(artifactDir, "20_REAL_HOLDOUT_BACKTEST_SUMMARY.json", failures);
  const a21 = readJsonSafe(artifactDir, "21_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json", failures);

  const canonicalCodeSha =
    options.expectedCodeSha ||
    (typeof a00?.codeSha === "string" ? a00.codeSha : null);

  // 00: Branch & CODE_SHA Precheck
  if (a00) {
    check(
      a00.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      "BRANCH_MISMATCH",
      "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
      `Expected branch 'feature/kh02-walmart-us-jina-reader-v12.4.3.5.1', got '${a00.branch}'.`
    );
    check(
      typeof a00.codeSha === "string" &&
        /^[0-9a-f]{40}$/i.test(a00.codeSha) &&
        typeof a00.baseQaSha === "string" &&
        /^[0-9a-f]{40}$/i.test(a00.baseQaSha) &&
        a00.ancestryVerified === true &&
        (!canonicalCodeSha || a00.codeSha === canonicalCodeSha),
      "CODE_SHA_MISMATCH",
      "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
      "Invalid or mismatched codeSha / baseQaSha / ancestryVerified in 00_GIT_BRANCH_CODE_SHA_PRECHECK.json."
    );
  }

  // 01: Original Pilot Contract & Scope
  if (a01) {
    check(
      a01.codeSha === canonicalCodeSha &&
        a01.amazonPilot?.routeId === "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT" &&
        a01.amazonPilot?.pinnedPackage === "@playwright/mcp@0.0.83" &&
        a01.amazonPilot?.requiresPaidApi === false &&
        a01.amazonPilot?.creatorsApiIndependent === true &&
        a01.walmartPilot?.routeId === "JINA_READER_REST_NO_KEY" &&
        a01.walmartPilot?.requiresApiKey === false,
      "ORIGINAL_PILOT_CONTRACT_VIOLATION",
      "01_ORIGINAL_PILOT_CONTRACT_AND_SCOPE.json",
      "01_ORIGINAL_PILOT_CONTRACT_AND_SCOPE.json must declare both original free pilot routes and match codeSha."
    );
  }

  // 02: Amazon Playwright MCP Package & CLI Audit
  if (a02) {
    check(
      a02.codeSha === canonicalCodeSha &&
        a02.pinnedPackage === "@playwright/mcp@0.0.83" &&
        a02.packageVersion === "0.0.83" &&
        Array.isArray(a02.cliArgs) &&
        a02.cliArgs.includes("--headless") &&
        a02.cliArgs.includes("--isolated") &&
        a02.usesPersonalProfileOrCookies === false &&
        a02.usesStealthEvasionOrProxy === false,
      "AMAZON_MCP_CLI_CONTRACT_VIOLATION",
      "02_AMAZON_PLAYWRIGHT_MCP_PACKAGE_AND_CLI_AUDIT.json",
      "Amazon Playwright MCP package must be @playwright/mcp@0.0.83 with --headless --isolated and zero cookies/proxies/stealth."
    );
  }

  // 03: Amazon Playwright MCP Handshake & Tools
  if (a03) {
    const tools: string[] = Array.isArray(a03.discoveredTools) ? a03.discoveredTools : [];
    check(
      a03.codeSha === canonicalCodeSha &&
        a03.handshakeConnected === true &&
        a03.transportMode === "REAL_STDIO_MCP" &&
        a03.serverOrigin === "PINNED_PLAYWRIGHT_MCP" &&
        typeof a03.ownedChildPid === "number" &&
        a03.ownedChildPid > 0 &&
        tools.includes("browser_navigate") &&
        tools.includes("browser_snapshot") &&
        tools.includes("browser_close") &&
        a03.closedCleanly === true &&
        a03.orphanProcessesAfterClose === 0,
      "AMAZON_MCP_HANDSHAKE_INVALID",
      "03_AMAZON_PLAYWRIGHT_MCP_HANDSHAKE_AND_TOOLS.json",
      "Amazon Playwright MCP handshake must connect via REAL_STDIO_MCP, discover required tools, record ownedChildPid, and close cleanly with 0 orphans."
    );
  }

  // 04: Amazon Policy, Budget & URL Guards
  if (a04) {
    check(
      a04.codeSha === canonicalCodeSha &&
        a04.defaultPolicy?.featureEnabled === false &&
        a04.defaultPolicy?.liveAllowed === false &&
        a04.liveWithoutRouteAuthBlocked === true &&
        a04.localMcpPilotWorksWhenCreatorsCredentialsAbsent === true &&
        a04.unattestedSearchMarkedAs === "SEARCH_BLOCKED_POLICY" &&
        a04.unattestedSearchNeverMarkedCredentialsRequired === true &&
        a04.budgetCaps?.maxOperationsPerRun === 4 &&
        a04.budgetCaps?.maxAttemptsPerOperation === 2 &&
        a04.budgetCaps?.maxConcurrency === 1 &&
        a04.budgetCaps?.fifthOperationRejected === true &&
        a04.urlGuards?.acceptsCanonicalDpUrl === true &&
        a04.urlGuards?.rejectsNonUsDomain === true &&
        a04.urlGuards?.rejectsShorteners === true &&
        a04.urlGuards?.validatesSearchUrlSeparately === true,
      "AMAZON_POLICY_OR_BUDGET_VIOLATION",
      "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
      "Amazon policy, budget caps (<=4 ops/run, <=2 attempts/op, concurrency=1), and URL guards failed validation."
    );
  }

  // 05: Amazon Identity, Parser & Sponsored Filter Audit
  if (a05) {
    check(
      a05.codeSha === canonicalCodeSha &&
        a05.sponsoredSearchCardRejected === true &&
        a05.nonAsinTenCharTokensRejected === true &&
        a05.brandOnlyNeverPromotedToExact === true &&
        a05.accessoryOrRefillNeverPromotedToExact === true &&
        a05.variationChildrenKeptDistinct === true &&
        a05.missingPriceRemainsNull === true &&
        a05.unobservedDeliveryZipRemainsNull === true &&
        a05.unobservedHttpStatusOrigin === "UNOBSERVED_NULL" &&
        a05.conflictingAsinRejectedFailClosed === true &&
        a05.handshakeOnlyZeroToolCallsMarkedNotExecuted === true &&
        a05.fixtureOrTestDoubleNeverProducesAuthorizedLive === true,
      "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
      "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
      "Amazon identity, sponsored filter, null-price, unobserved ZIP, or anti-fake provenance check failed."
    );
  }

  // 06: Amazon Worker, DB, API & DOM 3-Way Parity
  if (a06) {
    check(
      a06.codeSha === canonicalCodeSha &&
        a06.parityPassed === true &&
        Array.isArray(a06.mismatches) &&
        a06.mismatches.length === 0 &&
        a06.dbRow?.asin === "B08N5WRWNW" &&
        a06.apiSummary?.asin === "B08N5WRWNW" &&
        a06.domBeforeReload?.asin === "B08N5WRWNW" &&
        a06.domAfterReload?.asin === "B08N5WRWNW" &&
        a06.domBeforeReload?.rawEvidenceHash === a06.dbRow?.rawEvidenceHash &&
        a06.domAfterReload?.rawEvidenceHash === a06.dbRow?.rawEvidenceHash &&
        a06.domAfterReload?.observationClass === "TEST_FIXTURE" &&
        a06.claimedAsLiveAmazonConfirmation === false,
      "AMAZON_3WAY_PARITY_DRIFT",
      "06_AMAZON_WORKER_DB_API_DOM_3WAY_PARITY.json",
      "Amazon 3-way SQLite <-> API GET <-> Chromium DOM parity (before and after reload) failed."
    );
  }

  // 07: Amazon Live Pilot Execution Truth
  if (a07) {
    const validPageStatuses = [
      "PUBLIC_PAGE_OBSERVED",
      "BLOCKED_CAPTCHA_OR_BOT_WALL",
      "FAILED",
    ];
    check(
      a07.codeSha === canonicalCodeSha &&
        a07.probeExecuted === true &&
        a07.routeId === "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT" &&
        a07.transportHandshakeStatus === "SUCCEEDED" &&
        a07.actualBrowserToolExecutionStatus === "SUCCEEDED" &&
        validPageStatuses.includes(a07.realAmazonPageObservationStatus) &&
        a07.creatorsApiAvailabilityStatus === "NOT_REQUIRED_FOR_LOCAL_MCP_PILOT" &&
        typeof a07.operationsAttempted === "number" &&
        a07.operationsAttempted >= 1 &&
        a07.operationsAttempted <= 4 &&
        a07.mcpSessionClosedCleanly === true &&
        a07.fabricatedLiveSuccess === false &&
        (a07.realAmazonPageObservationStatus === "PUBLIC_PAGE_OBSERVED" ||
          a07.verifiedLiveProductCount === 0),
      "AMAZON_LIVE_PILOT_TRUTH_VIOLATION",
      "07_AMAZON_LIVE_PILOT_EXECUTION_TRUTH.json",
      "Amazon live pilot execution truth failed validation or fabricated live product verification."
    );
  }

  // 08: Walmart Jina Protocol, Headers & Budget Audit
  if (a08) {
    check(
      a08.codeSha === canonicalCodeSha &&
        a08.defaultPolicy?.featureEnabled === false &&
        a08.defaultPolicy?.liveAllowed === false &&
        a08.defaultPolicy?.requiresApiKey === false &&
        a08.clientOverrideBlockedWhenServerDisabled === true &&
        a08.urlValidation?.searchUrlPrefix ===
          "https://r.jina.ai/https://www.walmart.com/search?q=" &&
        a08.urlValidation?.pdpUrlPrefix ===
          "https://r.jina.ai/https://www.walmart.com/ip/" &&
        a08.urlValidation?.rejectsSJinaAi === true &&
        a08.urlValidation?.rejectsNonWalmartHost === true &&
        a08.urlValidation?.rejectsNonNumericItemId === true &&
        a08.headersAudit?.exactHeaders?.Accept === "application/json" &&
        a08.headersAudit?.exactHeaders?.["X-Cache-Tolerance"] === "0" &&
        a08.headersAudit?.exactHeaders?.["X-Respond-With"] === "html" &&
        a08.headersAudit?.exactHeaders?.["X-Timeout"] === "25" &&
        a08.headersAudit?.forbiddenHeadersAbsent === true &&
        a08.budgetCaps?.maxLogicalOperationsPerRun === 4 &&
        a08.budgetCaps?.fifthOperationRejectedWith === "BUDGET_EXHAUSTED" &&
        a08.budgetCaps?.maxAttemptsPerOperation === 2 &&
        a08.budgetCaps?.maxRequestsPerMinuteAcrossWorkers === 6 &&
        a08.budgetCaps?.maxConcurrentOperationsPerProviderGroup === 1,
      "WALMART_PROTOCOL_OR_BUDGET_VIOLATION",
      "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json",
      "Walmart Jina Reader REST protocol, 4-header contract, URL guards, or budget caps failed validation."
    );
  }

  // 09: Walmart __NEXT_DATA__ Parser & Identity Audit
  if (a09) {
    check(
      a09.codeSha === canonicalCodeSha &&
        a09.botWallAndInnerErrorAudit?.outer200WithBotWallStatus === "BLOCKED_PROVIDER" &&
        a09.botWallAndInnerErrorAudit?.stopsImmediatelyOnFirstBotWall === true &&
        a09.botWallAndInnerErrorAudit?.falseSuccessCount === 0 &&
        a09.upcStringPreservation?.sonyItemId === "16504921979" &&
        a09.upcStringPreservation?.sonyUpc === "027242930698" &&
        a09.upcStringPreservation?.leadingZeroPreserved === true &&
        a09.nullablePriceAudit?.missingPriceValue === null &&
        a09.nullablePriceAudit?.coercedToZero === false &&
        a09.accessoryGuardAudit?.matchedAsMainProduct === false &&
        a09.titleOnlyMatchAudit?.grantedExact === false,
      "WALMART_PARSER_OR_IDENTITY_VIOLATION",
      "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json",
      "Walmart __NEXT_DATA__ parser, bot-wall stop, leading-zero UPC string preservation, or identity guard failed."
    );
  }

  // 10: Walmart Worker, DB, API & DOM 3-Way Parity
  if (a10) {
    check(
      a10.codeSha === canonicalCodeSha &&
        a10.reloadParity?.parityPassed === true &&
        Array.isArray(a10.reloadParity?.mismatches) &&
        a10.reloadParity.mismatches.length === 0 &&
        a10.domBeforeReload?.itemId === "674275778" &&
        a10.domAfterReload?.itemId === "674275778" &&
        a10.domAfterReload?.upc === "856957004000" &&
        a10.domAfterReload?.evidenceOrigin === "TEST_FIXTURE" &&
        a10.claimedAsLiveWalmartProductConfirmation === false,
      "WALMART_3WAY_PARITY_DRIFT",
      "10_WALMART_WORKER_DB_API_DOM_3WAY_PARITY.json",
      "Walmart 3-way SQLite <-> API GET <-> Chromium DOM parity (before and after reload) failed."
    );
  }

  // 11: Walmart Live Jina Pilot Execution Truth
  if (a11) {
    check(
      a11.codeSha === canonicalCodeSha &&
        a11.probeExecutionStatus === "DID_RUN" &&
        a11.freeReaderMode === true &&
        a11.apiKeyUsed === false &&
        typeof a11.logicalOperationsUsed === "number" &&
        a11.logicalOperationsUsed >= 1 &&
        a11.logicalOperationsUsed <= 4 &&
        a11.fixtureRowsLabeledAsRealJinaCount === 0 &&
        a11.fabricatedLiveSuccess === false &&
        (a11.liveProviderStatus === "SUCCEEDED" || a11.verifiedLiveProductCount === 0),
      "WALMART_LIVE_PILOT_TRUTH_VIOLATION",
      "11_WALMART_LIVE_JINA_PILOT_EXECUTION_TRUTH.json",
      "Walmart live Jina Reader REST probe truth failed validation or fabricated live product verification."
    );
  }

  // 12: Non-Inflation Amazon + Walmart ON vs OFF
  if (a12) {
    check(
      a12.codeSha === canonicalCodeSha &&
        a12.nonInflationVerified === true &&
        typeof a12.comparedCandidatesCount === "number" &&
        a12.comparedCandidatesCount >= 3 &&
        a12.scoreDeltaAbsMax === 0 &&
        a12.confidenceDeltaAbsMax === 0 &&
        a12.rankingChanged === false &&
        a12.gateChanges === 0 &&
        a12.g15PromotedCount === 0 &&
        a12.g16PromotedCount === 0 &&
        a12.amazonNonInflation?.scoreDeltaAbsMax === 0 &&
        a12.amazonNonInflation?.rankChanged === false,
      "SCORE_OR_GATE_INFLATION_DETECTED",
      "12_NON_INFLATION_AMAZON_WALMART_ON_VS_OFF.json",
      "Marketplace evidence must have zero inflation on Opportunity Score, 4 pillars, ranking, G15, or G16 across >=3 candidates."
    );
  }

  // 13: Read-Only GET DB Digest Proof
  if (a13) {
    check(
      a13.codeSha === canonicalCodeSha &&
        a13.readOnlyVerified === true &&
        a13.amazonGetRoute?.dbMutationsCount === 0 &&
        a13.amazonGetRoute?.digestBefore === a13.amazonGetRoute?.digestAfter &&
        a13.walmartGetRoute?.dbMutationsCount === 0 &&
        a13.walmartGetRoute?.digestBefore === a13.walmartGetRoute?.digestAfter,
      "GET_ROUTE_MUTATED_DATABASE",
      "13_READ_ONLY_GET_DB_DIGEST_PROOF.json",
      "GET /api/v1/kh02/marketplace/amazon and /walmart must perform 0 DB writes and preserve exact DB digest."
    );
  }

  // 14: UI Product Finder Headless Chromium Audit
  if (a14) {
    check(
      a14.codeSha === canonicalCodeSha &&
        a14.realChromiumVerified === true &&
        a14.walmartDisabledReasonRenderedKeyRequired === false &&
        a14.amazonCardRenderedBeforeAndAfterReload === true &&
        a14.walmartCardRenderedBeforeAndAfterReload === true &&
        a14.nonInflationDisclaimerPresentInPage === true,
      "UI_CHROMIUM_AUDIT_FAILED",
      "14_UI_PRODUCT_FINDER_HEADLESS_CHROMIUM_AUDIT.json",
      "Headless Chromium Product Finder UI audit failed."
    );
  }

  // 15: Targeted Amazon + Walmart Test Matrix (A01..A22, W01..W22, S01..S20)
  if (a15) {
    check(
      a15.codeSha === canonicalCodeSha &&
        a15.allPassed === true &&
        typeof a15.totalSuites === "number" &&
        a15.totalSuites >= 7 &&
        typeof a15.totalTests === "number" &&
        a15.totalTests >= 220 &&
        a15.failedTests === 0 &&
        a15.matrixCoverage?.amazonA01toA22Complete === true &&
        a15.matrixCoverage?.walmartW01toW22Complete === true &&
        a15.matrixCoverage?.systemS01toS20Complete === true,
      "TARGETED_MATRIX_INCOMPLETE_OR_FAILED",
      "15_TARGETED_AMAZON_WALMART_TEST_MATRIX.json",
      "Targeted Amazon + Walmart test matrix (A01..A22, W01..W22, S01..S20) must pass 100%."
    );
  }

  // 16 & 17: Full Repository Regression Inventory & Shards
  if (a16) {
    check(
      a16.sourceSha === canonicalCodeSha &&
        a16.inventoryComplete === true &&
        a16.targetedOnly === false &&
        typeof a16.totalDiscoveredTestFiles === "number" &&
        a16.totalDiscoveredTestFiles >= 153 &&
        a16.executedTestFilesCount === a16.totalDiscoveredTestFiles &&
        a16.failedTestCases === 0 &&
        a16.requiredActiveSuiteFailedTestCases === 0 &&
        a16.newRegressionTestCases === 0,
      "FULL_REGRESSION_INCOMPLETE_OR_FAILED",
      "16_FULL_REPOSITORY_REGRESSION_INVENTORY.json",
      "Full repository regression must execute all discovered test files with 0 failed test cases."
    );
  }
  if (a17) {
    check(
      a17.sourceSha === canonicalCodeSha &&
        Array.isArray(a17.shards) &&
        a17.shards.length >= 5 &&
        a17.failedTestCases === 0,
      "SHARD_RESULTS_INVALID",
      "17_UNIT_AND_INTEGRATION_SHARD_RESULTS.json",
      "Unit and integration shard results must match codeSha and have 0 failed test cases."
    );
  }

  // 18: All 12 E2E Execution Receipts
  if (a18) {
    check(
      a18.sourceSha === canonicalCodeSha &&
        a18.totalSpecs === 12 &&
        a18.passedSpecsCount === 12 &&
        a18.failedSpecsCount === 0 &&
        a18.skippedWithoutAttemptCount === 0 &&
        a18.failedE2ETestCases === 0,
      "E2E_SPECS_INCOMPLETE_OR_FAILED",
      "18_ALL_E2E_EXECUTION_RECEIPTS.json",
      "All 12 E2E specs must execute and pass with 0 failures and 0 skipped specs."
    );
  }

  // 19, 20, 21: Real DEV/HOLDOUT Backtest & Point-in-Time No-Lookahead Audit
  if (a19) {
    check(
      a19.codeSha === canonicalCodeSha &&
        a19.split === "DEV" &&
        a19.backtestEngineExecuted === "PASS" &&
        a19.pointInTimeIntegrityVerdict === "PASS" &&
        a19.postCutoffRowsIncludedCount === 0,
      "DEV_BACKTEST_INTEGRITY_FAILED",
      "19_REAL_DEV_BACKTEST_SUMMARY.json",
      "DEV historical backtest must execute and pass point-in-time integrity with 0 post-cutoff rows."
    );
  }
  if (a20) {
    check(
      a20.codeSha === canonicalCodeSha &&
        a20.split === "HOLDOUT" &&
        a20.backtestEngineExecuted === "PASS" &&
        a20.pointInTimeIntegrityVerdict === "PASS" &&
        a20.postCutoffRowsIncludedCount === 0,
      "HOLDOUT_BACKTEST_INTEGRITY_FAILED",
      "20_REAL_HOLDOUT_BACKTEST_SUMMARY.json",
      "HOLDOUT historical backtest must execute and pass point-in-time integrity with 0 post-cutoff rows."
    );
  }
  if (a21) {
    check(
      a21.codeSha === canonicalCodeSha &&
        a21.pointInTimeIntegrityVerdict === "PASS" &&
        a21.amazonPostCutoffExcludedCount >= 1 &&
        a21.walmartPostCutoffExcludedCount >= 1 &&
        a21.postCutoffIncludedInReplayCount === 0 &&
        a21.fixtureRowsIncludedInLiveReplayCount === 0 &&
        a21.semanticHashAcceptedAsRawProductSchemaProofCount === 0,
      "POINT_IN_TIME_LOOKAHEAD_LEAK",
      "21_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
      "Point-in-time replay must exclude post-cutoff and fixture rows and never accept semantic contentHash as raw schema proof."
    );
  }

  if (!options.skipPostValidationFiles) {
    const a22 = readJsonSafe(artifactDir, "22_NEGATIVE_MUTATION_SUITE_30PLUS_CASES.json", failures);
    const a23 = readJsonSafe(artifactDir, "23_INDEPENDENT_VALIDATOR_REPORT.json", failures);
    const a24 = readJsonSafe(artifactDir, "24_OWNED_PROCESS_RAM_DISK_LEDGER.json", failures);
    const a25 = readJsonSafe(artifactDir, "25_FILE_MANIFEST_SHA256.json", failures);
    const a26 = readJsonSafe(artifactDir, "26_FINAL_RELEASE_VERDICT.json", failures);
    const a27 = readJsonSafe(artifactDir, "27_COMMIT_PUSH_REMOTE_SHA_VERIFICATION.json", failures);

    if (a22) {
      check(
        a22.codeSha === canonicalCodeSha &&
          typeof a22.totalMutationsExecuted === "number" &&
          a22.totalMutationsExecuted >= 30 &&
          a22.caughtMutationsCount === a22.totalMutationsExecuted &&
          a22.falsePassesCount === 0,
        "NEGATIVE_MUTATION_SUITE_FAILED",
        "22_NEGATIVE_MUTATION_SUITE_30PLUS_CASES.json",
        "Negative mutation suite must execute >=30 physical-file mutations with 0 false passes."
      );
    }

    if (a23 && !options.skipManifestSelfCheck) {
      check(
        a23.overallVerdict === "PASS" && a23.checksFailed === 0,
        "VALIDATOR_REPORT_NOT_PASS",
        "23_INDEPENDENT_VALIDATOR_REPORT.json",
        "23_INDEPENDENT_VALIDATOR_REPORT.json must report PASS with 0 failed checks."
      );
    }

    if (a24) {
      check(
        a24.codeSha === canonicalCodeSha &&
          typeof a24.minFreeDiskGiB === "number" &&
          a24.minFreeDiskGiB >= 15 &&
          typeof a24.peakConcurrentHeavyProcesses === "number" &&
          a24.peakConcurrentHeavyProcesses <= 2 &&
          a24.ownedOrphanCount === 0,
        "PROCESS_RAM_DISK_GUARD_VIOLATION",
        "24_OWNED_PROCESS_RAM_DISK_LEDGER.json",
        "Process/RAM/Disk ledger must confirm freeDisk >= 15 GiB, peakConcurrentHeavyProcesses <= 2, and ownedOrphanCount === 0."
      );
    }

    if (a26) {
      check(
        a26.codeSha === canonicalCodeSha &&
          a26.ENGINEERING_VERDICT === "PASS" &&
          a26.OVERALL_RELEASE_VERDICT !== "PASS",
        "FINAL_RELEASE_VERDICT_INVALID",
        "26_FINAL_RELEASE_VERDICT.json",
        "26_FINAL_RELEASE_VERDICT.json must match codeSha, have ENGINEERING_VERDICT=PASS, and truthfully separate live provider/business blockers."
      );
    }

    if (a27) {
      check(
        typeof a27.codeSha === "string" &&
          a27.codeSha === canonicalCodeSha &&
          a27.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
        "COMMIT_PUSH_VERIFICATION_INVALID",
        "27_COMMIT_PUSH_REMOTE_SHA_VERIFICATION.json",
        "27_COMMIT_PUSH_REMOTE_SHA_VERIFICATION.json must record branch and codeSha."
      );
    }

    if (a25 && !options.skipManifestSelfCheck) {
      const entries: Array<{ file: string; sha256: string; bytes: number }> = Array.isArray(
        a25.files
      )
        ? a25.files
        : [];
      check(
        entries.length >= 25,
        "MANIFEST_INCOMPLETE",
        "25_FILE_MANIFEST_SHA256.json",
        "25_FILE_MANIFEST_SHA256.json must list all acceptance files."
      );
      for (const item of entries) {
        if (
          item.file === "25_FILE_MANIFEST_SHA256.json" ||
          item.file === "27_COMMIT_PUSH_REMOTE_SHA_VERIFICATION.json" ||
          item.file === "28_FINAL_OWNER_REPORT_VI.md"
        ) {
          continue;
        }
        const p = path.join(artifactDir, item.file);
        if (!fs.existsSync(p)) {
          failures.push({
            code: "MANIFEST_FILE_MISSING",
            file: item.file,
            message: `Manifest entry '${item.file}' is missing on disk.`,
          });
          continue;
        }
        const actualSha = sha256FileSync(p);
        check(
          actualSha === item.sha256,
          "MANIFEST_SHA256_MISMATCH",
          item.file,
          `SHA-256 mismatch for '${item.file}': manifest=${item.sha256}, actual=${actualSha}.`
        );
      }
    }
  }

  const checksFailed = failures.length;
  const checksPassed = Math.max(0, checksExecuted - checksFailed);
  return {
    overallVerdict: checksFailed === 0 ? "PASS" : "FAIL",
    artifactDir,
    validatedAt: new Date().toISOString(),
    expectedCodeSha: canonicalCodeSha,
    checksExecuted,
    checksPassed,
    checksFailed,
    failureCodes: Array.from(new Set(failures.map((f) => f.code))),
    failureDetails: failures,
  };
}

export interface NegativeMutationCaseResult {
  mutationId: string;
  targetFile: string;
  description: string;
  expectedFailureCode: string;
  validatorVerdictAfterMutation: "PASS" | "FAIL";
  observedFailureCodes: string[];
  caught: boolean;
}

export function runOriginalPilotPhysicalNegativeMutationSuite36(
  sourceArtifactDir: string,
  expectedCodeSha: string
): {
  codeSha: string;
  executedAt: string;
  totalMutationsExecuted: number;
  caughtMutationsCount: number;
  falsePassesCount: number;
  suiteVerdict: "PASS" | "FAIL";
  cases: NegativeMutationCaseResult[];
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-orig-pilot-mut36-"));
  try {
    for (const entry of fs.readdirSync(sourceArtifactDir)) {
      const srcPath = path.join(sourceArtifactDir, entry);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, path.join(tmpDir, entry));
      }
    }

    const mutations: Array<{
      id: string;
      file: string;
      description: string;
      expectedCode: string;
      mutate: (json: any) => void;
    }> = [
      {
        id: "ORIG_MUT_01",
        file: "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
        description: "Tamper branch name away from feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
        expectedCode: "BRANCH_MISMATCH",
        mutate: (d) => {
          d.branch = "feature/wrong-new-branch";
        },
      },
      {
        id: "ORIG_MUT_02",
        file: "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
        description: "Tamper codeSha to mismatched SHA",
        expectedCode: "CODE_SHA_MISMATCH",
        mutate: (d) => {
          d.codeSha = "0".repeat(40);
        },
      },
      {
        id: "ORIG_MUT_03",
        file: "01_ORIGINAL_PILOT_CONTRACT_AND_SCOPE.json",
        description: "Claim Amazon pilot requires paid API",
        expectedCode: "ORIGINAL_PILOT_CONTRACT_VIOLATION",
        mutate: (d) => {
          d.amazonPilot.requiresPaidApi = true;
        },
      },
      {
        id: "ORIG_MUT_04",
        file: "02_AMAZON_PLAYWRIGHT_MCP_PACKAGE_AND_CLI_AUDIT.json",
        description: "Change pinned Playwright MCP package version",
        expectedCode: "AMAZON_MCP_CLI_CONTRACT_VIOLATION",
        mutate: (d) => {
          d.pinnedPackage = "@playwright/mcp@0.0.1";
        },
      },
      {
        id: "ORIG_MUT_05",
        file: "02_AMAZON_PLAYWRIGHT_MCP_PACKAGE_AND_CLI_AUDIT.json",
        description: "Enable personal browser cookies in Amazon MCP audit",
        expectedCode: "AMAZON_MCP_CLI_CONTRACT_VIOLATION",
        mutate: (d) => {
          d.usesPersonalProfileOrCookies = true;
        },
      },
      {
        id: "ORIG_MUT_06",
        file: "03_AMAZON_PLAYWRIGHT_MCP_HANDSHAKE_AND_TOOLS.json",
        description: "Remove browser_snapshot from discovered MCP tools",
        expectedCode: "AMAZON_MCP_HANDSHAKE_INVALID",
        mutate: (d) => {
          d.discoveredTools = ["browser_navigate"];
        },
      },
      {
        id: "ORIG_MUT_07",
        file: "03_AMAZON_PLAYWRIGHT_MCP_HANDSHAKE_AND_TOOLS.json",
        description: "Leave orphan process after MCP session close",
        expectedCode: "AMAZON_MCP_HANDSHAKE_INVALID",
        mutate: (d) => {
          d.orphanProcessesAfterClose = 1;
        },
      },
      {
        id: "ORIG_MUT_08",
        file: "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
        description: "Set default Amazon featureEnabled=true",
        expectedCode: "AMAZON_POLICY_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.defaultPolicy.featureEnabled = true;
        },
      },
      {
        id: "ORIG_MUT_09",
        file: "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
        description: "Mislabel unattested local MCP search as CREDENTIALS_REQUIRED",
        expectedCode: "AMAZON_POLICY_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.unattestedSearchMarkedAs = "CREDENTIALS_REQUIRED";
        },
      },
      {
        id: "ORIG_MUT_10",
        file: "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
        description: "Allow 5th Amazon operation in a single run",
        expectedCode: "AMAZON_POLICY_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.budgetCaps.fifthOperationRejected = false;
        },
      },
      {
        id: "ORIG_MUT_11",
        file: "04_AMAZON_POLICY_BUDGET_AND_URL_GUARDS.json",
        description: "Accept non-US Amazon domain (.co.uk)",
        expectedCode: "AMAZON_POLICY_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.urlGuards.rejectsNonUsDomain = false;
        },
      },
      {
        id: "ORIG_MUT_12",
        file: "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
        description: "Accept sponsored Amazon search card as organic match",
        expectedCode: "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
        mutate: (d) => {
          d.sponsoredSearchCardRejected = false;
        },
      },
      {
        id: "ORIG_MUT_13",
        file: "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
        description: "Promote brand-only Amazon listing to EXACT_PRODUCT",
        expectedCode: "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
        mutate: (d) => {
          d.brandOnlyNeverPromotedToExact = false;
        },
      },
      {
        id: "ORIG_MUT_14",
        file: "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
        description: "Coerce missing Amazon price to $0.00",
        expectedCode: "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
        mutate: (d) => {
          d.missingPriceRemainsNull = false;
        },
      },
      {
        id: "ORIG_MUT_15",
        file: "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
        description: "Fabricate US delivery ZIP 10001 when unobserved",
        expectedCode: "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
        mutate: (d) => {
          d.unobservedDeliveryZipRemainsNull = false;
        },
      },
      {
        id: "ORIG_MUT_16",
        file: "05_AMAZON_IDENTITY_PARSER_AND_SPONSORED_FILTER_AUDIT.json",
        description: "Allow TEST_FIXTURE session to produce AUTHORIZED_LIVE",
        expectedCode: "AMAZON_IDENTITY_OR_PARSER_VIOLATION",
        mutate: (d) => {
          d.fixtureOrTestDoubleNeverProducesAuthorizedLive = false;
        },
      },
      {
        id: "ORIG_MUT_17",
        file: "06_AMAZON_WORKER_DB_API_DOM_3WAY_PARITY.json",
        description: "Introduce Amazon DOM reload ASIN drift",
        expectedCode: "AMAZON_3WAY_PARITY_DRIFT",
        mutate: (d) => {
          d.domAfterReload.asin = "B00DRIFT99";
        },
      },
      {
        id: "ORIG_MUT_18",
        file: "06_AMAZON_WORKER_DB_API_DOM_3WAY_PARITY.json",
        description: "Claim fixture Chromium parity run is live Amazon confirmation",
        expectedCode: "AMAZON_3WAY_PARITY_DRIFT",
        mutate: (d) => {
          d.claimedAsLiveAmazonConfirmation = true;
        },
      },
      {
        id: "ORIG_MUT_19",
        file: "07_AMAZON_LIVE_PILOT_EXECUTION_TRUTH.json",
        description: "Fabricate verifiedLiveProductCount > 0 when Amazon page was blocked by CAPTCHA",
        expectedCode: "AMAZON_LIVE_PILOT_TRUTH_VIOLATION",
        mutate: (d) => {
          d.realAmazonPageObservationStatus = "BLOCKED_CAPTCHA_OR_BOT_WALL";
          d.verifiedLiveProductCount = 2;
        },
      },
      {
        id: "ORIG_MUT_20",
        file: "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json",
        description: "Remove X-Respond-With: html from Walmart Jina headers",
        expectedCode: "WALMART_PROTOCOL_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          delete d.headersAudit.exactHeaders["X-Respond-With"];
        },
      },
      {
        id: "ORIG_MUT_21",
        file: "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json",
        description: "Allow Authorization/Cookie header in free Walmart Jina mode",
        expectedCode: "WALMART_PROTOCOL_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.headersAudit.forbiddenHeadersAbsent = false;
        },
      },
      {
        id: "ORIG_MUT_22",
        file: "08_WALMART_JINA_PROTOCOL_HEADERS_AND_BUDGET_AUDIT.json",
        description: "Increase Walmart maxLogicalOperationsPerRun above 4",
        expectedCode: "WALMART_PROTOCOL_OR_BUDGET_VIOLATION",
        mutate: (d) => {
          d.budgetCaps.maxLogicalOperationsPerRun = 10;
        },
      },
      {
        id: "ORIG_MUT_23",
        file: "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json",
        description: "Misclassify HTTP 200 Walmart PerimeterX bot wall as SUCCEEDED",
        expectedCode: "WALMART_PARSER_OR_IDENTITY_VIOLATION",
        mutate: (d) => {
          d.botWallAndInnerErrorAudit.outer200WithBotWallStatus = "SUCCEEDED";
        },
      },
      {
        id: "ORIG_MUT_24",
        file: "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json",
        description: "Strip leading zero from Sony UPC 027242930698 -> 27242930698",
        expectedCode: "WALMART_PARSER_OR_IDENTITY_VIOLATION",
        mutate: (d) => {
          d.upcStringPreservation.sonyUpc = "27242930698";
          d.upcStringPreservation.leadingZeroPreserved = false;
        },
      },
      {
        id: "ORIG_MUT_25",
        file: "09_WALMART_NEXT_DATA_PARSER_AND_IDENTITY_AUDIT.json",
        description: "Allow Walmart accessory refill to match main candidate as FOUND",
        expectedCode: "WALMART_PARSER_OR_IDENTITY_VIOLATION",
        mutate: (d) => {
          d.accessoryGuardAudit.matchedAsMainProduct = true;
        },
      },
      {
        id: "ORIG_MUT_26",
        file: "10_WALMART_WORKER_DB_API_DOM_3WAY_PARITY.json",
        description: "Introduce Walmart DOM reload itemId drift",
        expectedCode: "WALMART_3WAY_PARITY_DRIFT",
        mutate: (d) => {
          d.reloadParity.parityPassed = false;
          d.reloadParity.mismatches = ["DOM_RELOAD_DRIFT"];
        },
      },
      {
        id: "ORIG_MUT_27",
        file: "11_WALMART_LIVE_JINA_PILOT_EXECUTION_TRUTH.json",
        description: "Relabel TEST_FIXTURE row as REAL_JINA_READER in live Walmart probe",
        expectedCode: "WALMART_LIVE_PILOT_TRUTH_VIOLATION",
        mutate: (d) => {
          d.fixtureRowsLabeledAsRealJinaCount = 1;
        },
      },
      {
        id: "ORIG_MUT_28",
        file: "12_NON_INFLATION_AMAZON_WALMART_ON_VS_OFF.json",
        description: "Inflate Opportunity Score by +2.5 when Amazon/Walmart evidence is enabled",
        expectedCode: "SCORE_OR_GATE_INFLATION_DETECTED",
        mutate: (d) => {
          d.scoreDeltaAbsMax = 2.5;
        },
      },
      {
        id: "ORIG_MUT_29",
        file: "12_NON_INFLATION_AMAZON_WALMART_ON_VS_OFF.json",
        description: "Promote G15 60-day demand gate from marketplace listing existence",
        expectedCode: "SCORE_OR_GATE_INFLATION_DETECTED",
        mutate: (d) => {
          d.g15PromotedCount = 1;
        },
      },
      {
        id: "ORIG_MUT_30",
        file: "13_READ_ONLY_GET_DB_DIGEST_PROOF.json",
        description: "Mutate SQLite database during GET /api/v1/kh02/marketplace/amazon",
        expectedCode: "GET_ROUTE_MUTATED_DATABASE",
        mutate: (d) => {
          d.amazonGetRoute.dbMutationsCount = 1;
        },
      },
      {
        id: "ORIG_MUT_31",
        file: "14_UI_PRODUCT_FINDER_HEADLESS_CHROMIUM_AUDIT.json",
        description: "Render 'Key Required' for free Walmart Jina Reader pilot in UI",
        expectedCode: "UI_CHROMIUM_AUDIT_FAILED",
        mutate: (d) => {
          d.walmartDisabledReasonRenderedKeyRequired = true;
        },
      },
      {
        id: "ORIG_MUT_32",
        file: "16_FULL_REPOSITORY_REGRESSION_INVENTORY.json",
        description: "Mark regression inventory as targetedOnly=true instead of full repo",
        expectedCode: "FULL_REGRESSION_INCOMPLETE_OR_FAILED",
        mutate: (d) => {
          d.targetedOnly = true;
        },
      },
      {
        id: "ORIG_MUT_33",
        file: "18_ALL_E2E_EXECUTION_RECEIPTS.json",
        description: "Skip 1 of the 12 E2E specs without execution",
        expectedCode: "E2E_SPECS_INCOMPLETE_OR_FAILED",
        mutate: (d) => {
          d.skippedWithoutAttemptCount = 1;
        },
      },
      {
        id: "ORIG_MUT_34",
        file: "19_REAL_DEV_BACKTEST_SUMMARY.json",
        description: "Include post-cutoff future row in DEV historical replay",
        expectedCode: "DEV_BACKTEST_INTEGRITY_FAILED",
        mutate: (d) => {
          d.postCutoffRowsIncludedCount = 1;
        },
      },
      {
        id: "ORIG_MUT_35",
        file: "20_REAL_HOLDOUT_BACKTEST_SUMMARY.json",
        description: "Include post-cutoff future row in HOLDOUT historical replay",
        expectedCode: "HOLDOUT_BACKTEST_INTEGRITY_FAILED",
        mutate: (d) => {
          d.postCutoffRowsIncludedCount = 1;
        },
      },
      {
        id: "ORIG_MUT_36",
        file: "21_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
        description: "Accept LandingPageSnapshot semantic contentHash as raw schema.org Product proof",
        expectedCode: "POINT_IN_TIME_LOOKAHEAD_LEAK",
        mutate: (d) => {
          d.semanticHashAcceptedAsRawProductSchemaProofCount = 1;
        },
      },
    ];

    const results: NegativeMutationCaseResult[] = [];
    for (const m of mutations) {
      const targetPath = path.join(tmpDir, m.file);
      const originalRaw = fs.readFileSync(targetPath, "utf8");
      try {
        const parsed = JSON.parse(originalRaw);
        m.mutate(parsed);
        fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf8");

        const val = validateOriginalAmazonWalmartPilotArtifacts(tmpDir, {
          expectedCodeSha,
          skipPostValidationFiles: true,
        });
        const caught =
          val.overallVerdict === "FAIL" && val.failureCodes.includes(m.expectedCode);
        results.push({
          mutationId: m.id,
          targetFile: m.file,
          description: m.description,
          expectedFailureCode: m.expectedCode,
          validatorVerdictAfterMutation: val.overallVerdict,
          observedFailureCodes: val.failureCodes,
          caught,
        });
      } finally {
        fs.writeFileSync(targetPath, originalRaw, "utf8");
      }
    }

    const caughtMutationsCount = results.filter((r) => r.caught).length;
    const falsePassesCount = results.length - caughtMutationsCount;

    return {
      codeSha: expectedCodeSha,
      executedAt: new Date().toISOString(),
      totalMutationsExecuted: results.length,
      caughtMutationsCount,
      falsePassesCount,
      suiteVerdict: falsePassesCount === 0 ? "PASS" : "FAIL",
      cases: results,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

