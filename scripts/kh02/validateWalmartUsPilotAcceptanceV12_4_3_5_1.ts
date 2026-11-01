/**
 * SWAI KH-02 V12.4.3.5.1 — Independent Acceptance Validator & 40-Case Physical-File Negative Mutation Suite
 *
 * Validates all acceptance artifacts (00..23) for Walmart US Product Discovery + PDP Evidence
 * via Jina Reader REST (No API Key), and executes 40 physical-file negative mutations (M01..M40)
 * against a temporary copy of the artifact directory on disk to prove the validator fails closed
 * with the exact expected failure code on every violation.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const REQUIRED_ARTIFACT_FILES_00_TO_23 = [
  "00_BRANCH_AND_BASELINE.json",
  "01_HOST_AND_ENVIRONMENT_HYGIENE.json",
  "02_PRIOR_WALMART_TEST_BASELINE.json",
  "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json",
  "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
  "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
  "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
  "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
  "08_UI_BROWSER_AND_RELOAD_PARITY.json",
  "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
  "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json",
  "11_DEV_BACKTEST_SUMMARY.json",
  "12_HOLDOUT_BACKTEST_SUMMARY.json",
  "13_POINT_IN_TIME_LEAK_AUDIT.json",
  "14_NEGATIVE_MUTATION_SUITE_40_CASES.json",
  "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
  "16_TEST_WAVE_RESULTS.json",
  "17_REQUIREMENT_TRACEABILITY_W01_W60.json",
  "18_INDEPENDENT_VALIDATOR_REPORT.json",
  "19_GIT_DELIVERY_AND_CLEAN_TREE_AUDIT.json",
  "20_EXECUTIVE_ACCEPTANCE_SUMMARY.md",
  "21_KNOWN_LIMITS_AND_RESIDUAL_RISKS.json",
  "22_FILE_MANIFEST_SHA256.json",
  "23_FINAL_RELEASE_VERDICT.json",
] as const;

export interface ValidationFailureDetail {
  code: string;
  file: string;
  message: string;
}

export interface WalmartAcceptanceValidationResult {
  overallVerdict: "PASS" | "FAIL";
  artifactDir: string;
  validatedAt: string;
  checksExecuted: number;
  checksPassed: number;
  checksFailed: number;
  failureCodes: string[];
  failureDetails: ValidationFailureDetail[];
}

export function sha256FileSync(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readJsonSafe(
  artifactDir: string,
  fileName: string,
  failures: ValidationFailureDetail[]
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

export interface ValidateWalmartAcceptanceOptions {
  skipManifestSelfCheck?: boolean;
  skipStage18to23Existence?: boolean;
}

/**
 * Independent validator that inspects physical files 00..23 in `artifactDir`.
 */
export function validateWalmartAcceptanceArtifacts(
  artifactDir: string,
  options: ValidateWalmartAcceptanceOptions = {}
): WalmartAcceptanceValidationResult {
  const failures: ValidationFailureDetail[] = [];
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

  // 1. Check required files existence
  const filesToCheck = options.skipStage18to23Existence
    ? REQUIRED_ARTIFACT_FILES_00_TO_23.slice(0, 18)
    : REQUIRED_ARTIFACT_FILES_00_TO_23;

  for (const fname of filesToCheck) {
    const fpath = path.join(artifactDir, fname);
    check(
      fs.existsSync(fpath) && fs.statSync(fpath).size > 0,
      "MISSING_REQUIRED_ARTIFACT",
      fname,
      `Required artifact file '${fname}' is missing or empty.`
    );
  }

  const a00 = readJsonSafe(artifactDir, "00_BRANCH_AND_BASELINE.json", failures);
  const a01 = readJsonSafe(artifactDir, "01_HOST_AND_ENVIRONMENT_HYGIENE.json", failures);
  const a02 = readJsonSafe(artifactDir, "02_PRIOR_WALMART_TEST_BASELINE.json", failures);
  const a03 = readJsonSafe(artifactDir, "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json", failures);
  const a04 = readJsonSafe(artifactDir, "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json", failures);
  const a05 = readJsonSafe(artifactDir, "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json", failures);
  const a06 = readJsonSafe(artifactDir, "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json", failures);
  const a07 = readJsonSafe(artifactDir, "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json", failures);
  const a08 = readJsonSafe(artifactDir, "08_UI_BROWSER_AND_RELOAD_PARITY.json", failures);
  const a09 = readJsonSafe(artifactDir, "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json", failures);
  const a10 = readJsonSafe(artifactDir, "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json", failures);
  const a11 = readJsonSafe(artifactDir, "11_DEV_BACKTEST_SUMMARY.json", failures);
  const a12 = readJsonSafe(artifactDir, "12_HOLDOUT_BACKTEST_SUMMARY.json", failures);
  const a13 = readJsonSafe(artifactDir, "13_POINT_IN_TIME_LEAK_AUDIT.json", failures);
  const a14 = readJsonSafe(artifactDir, "14_NEGATIVE_MUTATION_SUITE_40_CASES.json", failures);
  const a15 = readJsonSafe(artifactDir, "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json", failures);
  const a16 = readJsonSafe(artifactDir, "16_TEST_WAVE_RESULTS.json", failures);
  const a17 = readJsonSafe(artifactDir, "17_REQUIREMENT_TRACEABILITY_W01_W60.json", failures);

  // 00: Branch & Baseline checks (M01, M02)
  if (a00) {
    check(
      a00.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      "BRANCH_MISMATCH",
      "00_BRANCH_AND_BASELINE.json",
      `Expected branch 'feature/kh02-walmart-us-jina-reader-v12.4.3.5.1', got '${a00.branch}'.`
    );
    check(
      typeof a00.baseSha === "string" &&
        /^[0-9a-f]{40}$/i.test(a00.baseSha) &&
        typeof a00.codeSha === "string" &&
        /^[0-9a-f]{40}$/i.test(a00.codeSha) &&
        a00.ancestryVerified === true,
      "CODE_SHA_MISMATCH",
      "00_BRANCH_AND_BASELINE.json",
      "Invalid or unverified baseSha / codeSha / ancestryVerified in 00_BRANCH_AND_BASELINE.json."
    );
  }

  // 01: Host & Environment Hygiene
  if (a01) {
    check(
      typeof a01.freeDiskGiB === "number" &&
        a01.freeDiskGiB >= 15 &&
        a01.maxOuterHeavyTestProcesses <= 2,
      "HOST_HYGIENE_VIOLATION",
      "01_HOST_AND_ENVIRONMENT_HYGIENE.json",
      `Host disk free (${a01.freeDiskGiB} GiB) must be >= 15 GiB and maxOuterHeavyTestProcesses <= 2.`
    );
  }

  // 02: Prior Walmart Test Baseline (M37)
  if (a02) {
    check(
      a02.transplantedAsCurrentLiveVerification === false &&
        a02.referenceOnly === true &&
        Array.isArray(a02.identityAnchors) &&
        a02.identityAnchors.some(
          (x: any) => x.itemId === "16504921979" && x.upc === "027242930698"
        ),
      "HISTORICAL_BASELINE_TRANSPLANTED_AS_CURRENT_LIVE",
      "02_PRIOR_WALMART_TEST_BASELINE.json",
      "Historical 2026-10-30 baseline must be marked referenceOnly=true and transplantedAsCurrentLiveVerification=false, preserving leading-zero UPC '027242930698'."
    );
  }

  // 03: Architecture & Default Flags (M03, M04)
  if (a03) {
    check(
      a03.defaultPolicy?.featureEnabled === false &&
        a03.defaultPolicy?.KH02_WALMART_US_ENABLED === false,
      "DEFAULT_FLAG_NOT_DISABLED",
      "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json",
      "Default KH02_WALMART_US_ENABLED must be false."
    );
    check(
      a03.defaultPolicy?.liveAllowed === false &&
        a03.defaultPolicy?.KH02_WALMART_US_LIVE_ALLOWED === false,
      "DEFAULT_LIVE_FLAG_NOT_DISABLED",
      "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json",
      "Default KH02_WALMART_US_LIVE_ALLOWED must be false."
    );
  }

  // 04: Jina Reader Protocol, Headers, URLs & Budget Audit (M05..M15)
  if (a04) {
    check(
      a04.clientOverrideBlockedWhenServerDisabled === true,
      "CLIENT_OVERRIDE_PERMITTED_WHEN_DISABLED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Client request must not override server-disabled KH02_WALMART_US_ENABLED."
    );
    check(
      a04.urlValidation?.searchUrlPrefix ===
        "https://r.jina.ai/https://www.walmart.com/search?q=" &&
        a04.urlValidation?.rejectsSJinaAi === true &&
        a04.urlValidation?.rejectsNonWalmartHost === true,
      "INVALID_JINA_SEARCH_URL_ACCEPTED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Jina search URL validation must enforce https://r.jina.ai/https://www.walmart.com/search?q= and reject s.jina.ai or non-Walmart hosts."
    );
    check(
      a04.urlValidation?.pdpUrlPrefix ===
        "https://r.jina.ai/https://www.walmart.com/ip/" &&
        a04.urlValidation?.rejectsNonNumericItemId === true,
      "INVALID_WALMART_ITEM_ID_ACCEPTED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Walmart itemId validation must reject non-numeric itemIds and path/query injection."
    );
    check(
      a04.headersAudit?.exactHeaders?.Accept === "application/json" &&
        a04.headersAudit?.exactHeaders?.["X-Cache-Tolerance"] === "0" &&
        a04.headersAudit?.exactHeaders?.["X-Respond-With"] === "html" &&
        a04.headersAudit?.exactHeaders?.["X-Timeout"] === "25",
      "MANDATORY_JINA_HEADER_MISSING",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Mandatory Jina Reader headers (Accept, X-Cache-Tolerance: 0, X-Respond-With: html, X-Timeout: 25) must all be present."
    );
    check(
      a04.headersAudit?.forbiddenHeadersAbsent === true &&
        a04.headersAudit?.apiKeySent === false &&
        a04.headersAudit?.cookieSent === false &&
        a04.headersAudit?.proxyHeaderSent === false,
      "FORBIDDEN_AUTH_OR_PROXY_HEADER_PRESENT",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Forbidden Authorization, Cookie, or X-Proxy headers must never be sent."
    );
    check(
      typeof a04.budgetCaps?.maxLogicalOperationsPerRun === "number" &&
        a04.budgetCaps.maxLogicalOperationsPerRun <= 4 &&
        a04.budgetCaps.fifthOperationRejectedWith === "BUDGET_EXHAUSTED",
      "LOGICAL_OPERATION_CAP_EXCEEDED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Per-run logical operations cap must be <= 4 and reject operation #5 with BUDGET_EXHAUSTED."
    );
    check(
      typeof a04.budgetCaps?.maxAttemptsPerOperation === "number" &&
        a04.budgetCaps.maxAttemptsPerOperation <= 2 &&
        a04.budgetCaps.thirdAttemptRejectedWith === "BUDGET_EXHAUSTED",
      "OPERATION_ATTEMPT_CAP_EXCEEDED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Per-operation network attempts cap must be <= 2."
    );
    check(
      typeof a04.budgetCaps?.maxRequestsPerMinuteAcrossWorkers === "number" &&
        a04.budgetCaps.maxRequestsPerMinuteAcrossWorkers <= 6 &&
        a04.budgetCaps.seventhRequestWithinMinuteDeferred === true,
      "ROLLING_MINUTE_RATE_CAP_EXCEEDED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Rolling 60s request cap across workers must be <= 6."
    );
    check(
      a04.budgetCaps?.maxConcurrentOperationsPerProviderGroup === 1 &&
        a04.budgetCaps.peakConcurrentObserved <= 1,
      "CONCURRENCY_CAP_EXCEEDED",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Concurrency per provider worker group must be strictly 1."
    );
    check(
      a04.attemptGenerationFence?.staleAttempt1RejectedAfterAttempt2 === true,
      "STALE_ATTEMPT_GENERATION_OVERWRITE",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "Stale attempt #1 must be rejected by monotonic attemptGeneration fence when attempt #2 is active/committed."
    );
    check(
      a04.freePilotHaltOn401Or402?.haltsImmediately === true &&
        a04.freePilotHaltOn401Or402?.statusClassifiedAs ===
          "KEY_OR_PAYMENT_REQUIRED" &&
        a04.freePilotHaltOn401Or402?.asksUserForPaidKey === false,
      "FREE_PILOT_NOT_STOPPED_ON_401_402",
      "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
      "HTTP 401/402 must immediately halt the free pilot with KEY_OR_PAYMENT_REQUIRED without asking for paid keys."
    );
  }

  // 05: __NEXT_DATA__ Parser & Schema Compatibility Audit (M16..M24)
  if (a05) {
    check(
      a05.botWallAndInnerErrorAudit?.outer200WithBotWallStatus ===
        "BLOCKED_PROVIDER" &&
        a05.botWallAndInnerErrorAudit?.outer200WithInner429Status ===
          "RATE_LIMITED" &&
        a05.botWallAndInnerErrorAudit?.falseSuccessCount === 0,
      "BOT_WALL_OR_INNER_ERROR_FALSE_SUCCESS",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Outer HTTP 200 containing a bot wall or inner 403/429 must never be classified as SUCCEEDED."
    );
    check(
      a05.malformedNextDataAudit?.missingScriptStatus === "PARSE_ERROR" &&
        a05.malformedNextDataAudit?.corruptJsonStatus === "PARSE_ERROR" &&
        a05.malformedNextDataAudit?.classifiedAsNoMatch === false,
      "MALFORMED_NEXT_DATA_FALSE_NO_MATCH",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Missing or malformed __NEXT_DATA__ must be classified as PARSE_ERROR, never NO_MATCH_IN_SCOPE."
    );
    check(
      a05.emptySearchAudit?.queryStatus === "SUCCEEDED" &&
        a05.emptySearchAudit?.presence === "NO_MATCH_IN_SCOPE",
      "VALID_EMPTY_SEARCH_MISCLASSIFIED",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Valid empty search result must be classified as queryStatus=SUCCEEDED and presence=NO_MATCH_IN_SCOPE."
    );
    check(
      a05.deduplicationAudit?.dedupedByItemId === true &&
        Array.isArray(a05.deduplicationAudit?.preservedProvenance) &&
        a05.deduplicationAudit.preservedProvenance.includes("SPONSORED") &&
        a05.deduplicationAudit.preservedProvenance.includes("ORGANIC"),
      "DUPLICATE_ITEM_STACK_NOT_DEDUPED",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Duplicate listings across itemStacks must be deduplicated by usItemId while preserving SPONSORED and ORGANIC provenance."
    );
    check(
      typeof a05.upcStringPreservation?.sonyUpc === "string" &&
        a05.upcStringPreservation.sonyUpc === "027242930698" &&
        a05.upcStringPreservation.leadingZeroPreserved === true,
      "UPC_LEADING_ZERO_CORRUPTED",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "UPC must be preserved as an exact string including leading zeros ('027242930698')."
    );
    check(
      a05.nullablePriceAudit?.missingPriceValue === null &&
        a05.nullablePriceAudit?.coercedToZero === false,
      "NULL_PRICE_COERCED_TO_ZERO",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Missing price must remain null and never be coerced to 0 / $0.00."
    );
    check(
      a05.outOfStockAudit?.presence === "FOUND" &&
        a05.outOfStockAudit?.availability === "OUT_OF_STOCK",
      "OUT_OF_STOCK_PRESENCE_CORRUPTED",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Out-of-stock PDP must keep presence=FOUND with availability=OUT_OF_STOCK."
    );
    check(
      a05.locationContextAudit?.observedPostalCode === "95829" &&
        Array.isArray(a05.locationContextAudit?.observedStoreIds) &&
        a05.locationContextAudit.observedStoreIds.includes("3081") &&
        a05.locationContextAudit?.claimedAsNationwidePriceOrStock === false,
      "LOCATION_CLAIMED_AS_NATIONWIDE",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "Observed Walmart ZIP/store context must be recorded truthfully and never claimed as nationwide US price or inventory."
    );
    check(
      a05.pdpIdentityAudit?.mismatchedItemIdStatus === "PARSE_ERROR" &&
        a05.pdpIdentityAudit?.mismatchedItemIdAccepted === false,
      "PDP_ITEM_ID_MISMATCH_ACCEPTED",
      "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
      "PDP with usItemId contradicting requested itemId must fail closed as PARSE_ERROR."
    );
  }

  // 06: Product Identity & Matching Audit (M25..M28)
  if (a06) {
    check(
      a06.titleOnlyMatchAudit?.grantedExact === false &&
        a06.titleOnlyMatchAudit?.verifiedIdentity === false,
      "TITLE_ONLY_FALSE_EXACT_MATCH",
      "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
      "Title similarity alone must never grant EXACT match or verifiedIdentity=true."
    );
    check(
      a06.accessoryGuardAudit?.accessoryPresence === "NO_MATCH_IN_SCOPE" &&
        a06.accessoryGuardAudit?.accessoryMatchLevel === "UNCERTAIN" &&
        a06.accessoryGuardAudit?.matchedAsMainProduct === false,
      "ACCESSORY_MATCHED_AS_MAIN_PRODUCT",
      "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
      "Replacement parts/refills/accessories must not be matched as the main candidate product."
    );
    check(
      a06.variantAndConditionGuardAudit?.wrongModelGrantedExact === false &&
        a06.variantAndConditionGuardAudit?.wrongPackGrantedExact === false &&
        a06.variantAndConditionGuardAudit?.refurbishedGrantedExactForNew === false,
      "VARIANT_OR_CONDITION_FALSE_EXACT",
      "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
      "Wrong model, different pack size, or refurbished/used vs new must never be granted EXACT match."
    );
    check(
      a06.searchIntentAudit?.genericNicheAloneEmitted === false &&
        a06.searchIntentAudit?.adHypeStripped === true,
      "GENERIC_NICHE_SEARCH_INTENT_EMITTED",
      "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
      "Generic niche name alone must never be emitted as a candidate Walmart search query."
    );
  }

  // 07: Orchestrator, Worker, API & DB Parity (M29..M32)
  if (a07) {
    check(
      a07.workspaceIsolation?.crossWorkspaceWriteRejected === true &&
        a07.workspaceIsolation?.crossWorkspaceReadHttpStatus === 403,
      "WORKSPACE_ISOLATION_BREACH",
      "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
      "Cross-workspace reads and writes must be strictly rejected."
    );
    check(
      a07.workerFencing?.staleClaimTokenRejected === true &&
        a07.workerFencing?.staleFencingGenerationRejected === true,
      "STALE_WORKER_FENCE_WRITE_ALLOWED",
      "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
      "Stale worker claimToken or fencingGeneration must be rejected during atomic persistence."
    );
    check(
      a07.persistenceFailureHandling?.injectedFailureSurfaced === true &&
        a07.persistenceFailureHandling?.errorCode ===
          "WALMART_EVIDENCE_PERSISTENCE_FAILED" &&
        a07.persistenceFailureHandling?.silentSuccessWhenWriteFails === false,
      "SILENT_PERSISTENCE_FAILURE_SWALLOWED",
      "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
      "Persistence write failure must surface WALMART_EVIDENCE_PERSISTENCE_FAILED and never report silent success."
    );
    check(
      a07.getRouteReadOnlyAudit?.dbMutationsOnGet === 0 &&
        a07.getRouteReadOnlyAudit?.networkCallsOnGet === 0 &&
        a07.getRouteReadOnlyAudit?.rescoringOnGet === 0,
      "GET_ROUTE_NOT_READ_ONLY",
      "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
      "GET /api/v1/kh02/marketplace/walmart must be 100% read-only (0 DB writes, 0 network calls, 0 rescoring)."
    );
  }

  // 08: UI Browser & Reload Parity (M33, M34)
  if (a08) {
    check(
      a08.realChromiumVerified === true &&
        a08.reloadParity?.parityPassed === true &&
        Array.isArray(a08.reloadParity?.mismatches) &&
        a08.reloadParity.mismatches.length === 0,
      "UI_RELOAD_PARITY_DRIFT",
      "08_UI_BROWSER_AND_RELOAD_PARITY.json",
      "Headless Chromium UI and post-reload DOM parity must pass with 0 mismatches against DB and API."
    );
    check(
      a08.disabledStateAudit?.renderedDisabledReason ===
        "Server pilot disabled" &&
        a08.disabledStateAudit?.renderedKeyRequired === false,
      "DISABLED_STATE_CLAIMS_KEY_REQUIRED",
      "08_UI_BROWSER_AND_RELOAD_PARITY.json",
      "Disabled Walmart state must render 'Server pilot disabled', never 'Key Required'."
    );
  }

  // 09: Score & Gate Non-Inflation Audit (M35)
  if (a09) {
    check(
      a09.nonInflationVerified === true &&
        a09.scoreDeltaBetweenWalmartOnAndOff === 0 &&
        a09.verdictChangedCount === 0 &&
        a09.confidenceChangedCount === 0 &&
        a09.recommendable60dChangedCount === 0 &&
        a09.distinctSourcesIncrementedByWalmart === false &&
        a09.distinctSourceFamiliesIncrementedByWalmart === false,
      "SCORE_OR_VERDICT_INFLATION_DETECTED",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      "Walmart US evidence must have zero impact on totalScore, verdict, confidence, recommendable60d, distinctSources, or distinctSourceFamilies."
    );
  }

  // 10: Live Walmart Jina Pilot Evidence (M36)
  if (a10) {
    const validLiveStatuses = [
      "SUCCEEDED",
      "PARTIAL",
      "RATE_LIMITED",
      "BLOCKED_PROVIDER",
      "KEY_OR_PAYMENT_REQUIRED",
      "TIMED_OUT",
      "UNAVAILABLE",
      "PARSE_ERROR",
    ];
    check(
      validLiveStatuses.includes(a10.liveProbeOverallStatus) &&
        a10.fixtureRowsLabeledAsRealJinaCount === 0 &&
        a10.fabricatedLiveSuccess === false,
      "FIXTURE_CLAIMED_AS_REAL_JINA_LIVE",
      "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json",
      "Fixture rows must never be labeled REAL_JINA_READER and live probe status must be truthfully classified."
    );
  }

  // 11, 12, 13: DEV/HOLDOUT Backtest & Point-in-Time Leak Audit (M38)
  if (a11 && a12 && a13) {
    check(
      a11.status === "PASS" &&
        a12.status === "PASS" &&
        a13.zeroLeakCount === true &&
        a13.unfilteredFutureLeaksInEligibleSet === 0 &&
        a13.fixtureLeaksInEligibleSet === 0 &&
        a13.syntheticAudit?.futureLeaksRejectedCount >= 1 &&
        a13.syntheticAudit?.fixtureRecordsRejectedCount >= 1,
      "POINT_IN_TIME_FUTURE_LEAK_DETECTED",
      "13_POINT_IN_TIME_LEAK_AUDIT.json",
      "Point-in-time backtest leak audit must reject all post-T0 and TEST_FIXTURE Walmart records with zero leaks in eligible sets."
    );
  }

  // 14: Negative Mutation Suite 40 Cases
  if (a14) {
    check(
      typeof a14.totalMutationsExecuted === "number" &&
        a14.totalMutationsExecuted >= 40 &&
        a14.allMutationsCaught === true &&
        a14.falsePassCount === 0,
      "NEGATIVE_MUTATION_SUITE_INCOMPLETE",
      "14_NEGATIVE_MUTATION_SUITE_40_CASES.json",
      "Negative mutation suite must execute >= 40 physical-file mutations with 0 false passes."
    );
  }

  // 15: Performance Budget & Process Audit
  if (a15) {
    check(
      a15.orphanedProcessesAfterRun === 0 &&
        a15.budgetCompliance?.maxConcurrentObserved <= 1 &&
        a15.budgetCompliance?.maxOperationsPerRunObserved <= 4 &&
        a15.budgetCompliance?.maxRequestsPerMinuteObserved <= 6,
      "PERFORMANCE_OR_PROCESS_BUDGET_VIOLATION",
      "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
      "Performance and process hygiene audit must show 0 orphaned processes and full compliance with provider caps."
    );
  }

  // 16: Test Wave Results & SHA consistency (M02)
  if (a16 && a00) {
    check(
      a16.codeSha === a00.codeSha &&
        a16.allRequiredWavesPassed === true &&
        Array.isArray(a16.waves) &&
        a16.waves.length >= 6 &&
        a16.waves.every((w: any) => w.codeSha === a00.codeSha && w.passed === true),
      "CODE_SHA_MISMATCH",
      "16_TEST_WAVE_RESULTS.json",
      "Every test wave in 16_TEST_WAVE_RESULTS.json must pass and match 00_BRANCH_AND_BASELINE.json codeSha."
    );
  }

  // 17: Requirement Traceability W01..W60 (M39)
  if (a17) {
    const reqList = Array.isArray(a17.requirements) ? a17.requirements : [];
    const ids = new Set(reqList.map((r: any) => r.id));
    let all60PresentAndVerified = reqList.length === 60;
    for (let i = 1; i <= 60; i++) {
      const wid = `W${String(i).padStart(2, "0")}`;
      if (!ids.has(wid)) {
        all60PresentAndVerified = false;
      }
    }
    if (
      !reqList.every(
        (r: any) =>
          r.status === "VERIFIED" &&
          Array.isArray(r.codeFiles) &&
          r.codeFiles.length > 0 &&
          Array.isArray(r.testFiles) &&
          r.testFiles.length > 0
      )
    ) {
      all60PresentAndVerified = false;
    }
    check(
      all60PresentAndVerified,
      "TRACEABILITY_INCOMPLETE_OR_FAILED",
      "17_REQUIREMENT_TRACEABILITY_W01_W60.json",
      "All 60 requirements W01..W60 must be present and VERIFIED with concrete code and test evidence."
    );
  }

  // 22: File Manifest SHA-256 verification (M40)
  if (!options.skipManifestSelfCheck && !options.skipStage18to23Existence) {
    const a22 = readJsonSafe(artifactDir, "22_FILE_MANIFEST_SHA256.json", failures);
    if (a22) {
      const entries = Array.isArray(a22.files) ? a22.files : [];
      let manifestIntact = entries.length >= 22;
      for (const entry of entries) {
        if (entry.file === "22_FILE_MANIFEST_SHA256.json" || entry.file === "23_FINAL_RELEASE_VERDICT.json") {
          continue;
        }
        const fpath = path.join(artifactDir, entry.file);
        if (!fs.existsSync(fpath)) {
          manifestIntact = false;
          break;
        }
        const actualHash = sha256FileSync(fpath);
        if (actualHash !== entry.sha256) {
          manifestIntact = false;
          break;
        }
      }
      check(
        manifestIntact,
        "ARTIFACT_SHA256_MISMATCH",
        "22_FILE_MANIFEST_SHA256.json",
        "One or more artifact files in 22_FILE_MANIFEST_SHA256.json failed SHA-256 integrity verification."
      );
    }
  }

  const failureCodes = Array.from(new Set(failures.map((f) => f.code)));
  const checksFailed = failures.length;
  const checksPassed = Math.max(0, checksExecuted - checksFailed);

  return {
    overallVerdict: failures.length === 0 ? "PASS" : "FAIL",
    artifactDir,
    validatedAt: new Date().toISOString(),
    checksExecuted,
    checksPassed,
    checksFailed,
    failureCodes,
    failureDetails: failures,
  };
}

export interface NegativeMutationCaseResult {
  mutationId: string;
  targetFile: string;
  description: string;
  expectedFailureCode: string;
  observedVerdict: "PASS" | "FAIL";
  observedFailureCodes: string[];
  caughtExpectedCode: boolean;
  durationMs: number;
}

export interface NegativeMutationSuiteReport {
  suiteVersion: "12.4.3.5.1";
  executedAt: string;
  totalMutationsExecuted: number;
  mutationsCaughtCount: number;
  falsePassCount: number;
  allMutationsCaught: boolean;
  cases: NegativeMutationCaseResult[];
}

interface MutationSpec {
  mutationId: string;
  targetFile: string;
  description: string;
  expectedFailureCode: string;
  mutate: (doc: any) => void;
}

const FORTY_PHYSICAL_MUTATION_SPECS: MutationSpec[] = [
  {
    mutationId: "M01",
    targetFile: "00_BRANCH_AND_BASELINE.json",
    description: "Mutate branch name to feature/kh02-amazon-us-pilot-v12.4.3.5.0",
    expectedFailureCode: "BRANCH_MISMATCH",
    mutate: (d) => {
      d.branch = "feature/kh02-amazon-us-pilot-v12.4.3.5.0";
    },
  },
  {
    mutationId: "M02",
    targetFile: "00_BRANCH_AND_BASELINE.json",
    description: "Mutate codeSha so it mismatches wave results",
    expectedFailureCode: "CODE_SHA_MISMATCH",
    mutate: (d) => {
      d.codeSha = "0000000000000000000000000000000000000000";
    },
  },
  {
    mutationId: "M03",
    targetFile: "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json",
    description: "Mutate default KH02_WALMART_US_ENABLED flag to true",
    expectedFailureCode: "DEFAULT_FLAG_NOT_DISABLED",
    mutate: (d) => {
      d.defaultPolicy.featureEnabled = true;
      d.defaultPolicy.KH02_WALMART_US_ENABLED = true;
    },
  },
  {
    mutationId: "M04",
    targetFile: "03_WALMART_ARCHITECTURE_AND_CONTRACTS.json",
    description: "Mutate default KH02_WALMART_US_LIVE_ALLOWED flag to true",
    expectedFailureCode: "DEFAULT_LIVE_FLAG_NOT_DISABLED",
    mutate: (d) => {
      d.defaultPolicy.liveAllowed = true;
      d.defaultPolicy.KH02_WALMART_US_LIVE_ALLOWED = true;
    },
  },
  {
    mutationId: "M05",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Allow client enableWalmartUsPilot=true to override disabled server policy",
    expectedFailureCode: "CLIENT_OVERRIDE_PERMITTED_WHEN_DISABLED",
    mutate: (d) => {
      d.clientOverrideBlockedWhenServerDisabled = false;
    },
  },
  {
    mutationId: "M06",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Accept s.jina.ai search endpoint instead of r.jina.ai Reader REST",
    expectedFailureCode: "INVALID_JINA_SEARCH_URL_ACCEPTED",
    mutate: (d) => {
      d.urlValidation.rejectsSJinaAi = false;
    },
  },
  {
    mutationId: "M07",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Accept non-numeric Walmart itemId (123abc)",
    expectedFailureCode: "INVALID_WALMART_ITEM_ID_ACCEPTED",
    mutate: (d) => {
      d.urlValidation.rejectsNonNumericItemId = false;
    },
  },
  {
    mutationId: "M08",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Omit mandatory X-Respond-With: html header",
    expectedFailureCode: "MANDATORY_JINA_HEADER_MISSING",
    mutate: (d) => {
      delete d.headersAudit.exactHeaders["X-Respond-With"];
    },
  },
  {
    mutationId: "M09",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Inject forbidden Authorization / API key header into Jina request",
    expectedFailureCode: "FORBIDDEN_AUTH_OR_PROXY_HEADER_PRESENT",
    mutate: (d) => {
      d.headersAudit.apiKeySent = true;
      d.headersAudit.forbiddenHeadersAbsent = false;
    },
  },
  {
    mutationId: "M10",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Exceed per-run logical operation ceiling (allow 5 > 4 operations)",
    expectedFailureCode: "LOGICAL_OPERATION_CAP_EXCEEDED",
    mutate: (d) => {
      d.budgetCaps.maxLogicalOperationsPerRun = 5;
    },
  },
  {
    mutationId: "M11",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Exceed per-operation attempt ceiling (allow 3 > 2 attempts)",
    expectedFailureCode: "OPERATION_ATTEMPT_CAP_EXCEEDED",
    mutate: (d) => {
      d.budgetCaps.maxAttemptsPerOperation = 3;
    },
  },
  {
    mutationId: "M12",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Exceed rolling 60s rate limit across workers (allow 10 > 6 req/min)",
    expectedFailureCode: "ROLLING_MINUTE_RATE_CAP_EXCEEDED",
    mutate: (d) => {
      d.budgetCaps.maxRequestsPerMinuteAcrossWorkers = 10;
    },
  },
  {
    mutationId: "M13",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Exceed provider worker group concurrency ceiling (peakConcurrentObserved = 2)",
    expectedFailureCode: "CONCURRENCY_CAP_EXCEEDED",
    mutate: (d) => {
      d.budgetCaps.peakConcurrentObserved = 2;
    },
  },
  {
    mutationId: "M14",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Allow stale timed-out attempt #1 to overwrite attempt #2",
    expectedFailureCode: "STALE_ATTEMPT_GENERATION_OVERWRITE",
    mutate: (d) => {
      d.attemptGenerationFence.staleAttempt1RejectedAfterAttempt2 = false;
    },
  },
  {
    mutationId: "M15",
    targetFile: "04_JINA_READER_PROTOCOL_AND_BUDGET_AUDIT.json",
    description: "Fail to halt free pilot on HTTP 401/402 or ask user for paid API key",
    expectedFailureCode: "FREE_PILOT_NOT_STOPPED_ON_401_402",
    mutate: (d) => {
      d.freePilotHaltOn401Or402.asksUserForPaidKey = true;
    },
  },
  {
    mutationId: "M16",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Classify outer HTTP 200 containing 'Robot or human?' bot wall as SUCCEEDED",
    expectedFailureCode: "BOT_WALL_OR_INNER_ERROR_FALSE_SUCCESS",
    mutate: (d) => {
      d.botWallAndInnerErrorAudit.outer200WithBotWallStatus = "SUCCEEDED";
      d.botWallAndInnerErrorAudit.falseSuccessCount = 1;
    },
  },
  {
    mutationId: "M17",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Classify missing <script id=\"__NEXT_DATA__\"> as NO_MATCH_IN_SCOPE instead of PARSE_ERROR",
    expectedFailureCode: "MALFORMED_NEXT_DATA_FALSE_NO_MATCH",
    mutate: (d) => {
      d.malformedNextDataAudit.missingScriptStatus = "SUCCEEDED";
      d.malformedNextDataAudit.classifiedAsNoMatch = true;
    },
  },
  {
    mutationId: "M18",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Misclassify valid empty Walmart search result as PARSE_ERROR",
    expectedFailureCode: "VALID_EMPTY_SEARCH_MISCLASSIFIED",
    mutate: (d) => {
      d.emptySearchAudit.queryStatus = "PARSE_ERROR";
      d.emptySearchAudit.presence = "UNKNOWN";
    },
  },
  {
    mutationId: "M19",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Fail to deduplicate Sponsored + Organic duplicate usItemId in search itemStacks",
    expectedFailureCode: "DUPLICATE_ITEM_STACK_NOT_DEDUPED",
    mutate: (d) => {
      d.deduplicationAudit.dedupedByItemId = false;
    },
  },
  {
    mutationId: "M20",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Strip leading zero from Sony UPC '027242930698' -> '27242930698'",
    expectedFailureCode: "UPC_LEADING_ZERO_CORRUPTED",
    mutate: (d) => {
      d.upcStringPreservation.sonyUpc = "27242930698";
      d.upcStringPreservation.leadingZeroPreserved = false;
    },
  },
  {
    mutationId: "M21",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Coerce missing Walmart price to 0 ($0.00) instead of null",
    expectedFailureCode: "NULL_PRICE_COERCED_TO_ZERO",
    mutate: (d) => {
      d.nullablePriceAudit.missingPriceValue = 0;
      d.nullablePriceAudit.coercedToZero = true;
    },
  },
  {
    mutationId: "M22",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Misclassify out-of-stock Walmart PDP as NO_MATCH_IN_SCOPE instead of FOUND",
    expectedFailureCode: "OUT_OF_STOCK_PRESENCE_CORRUPTED",
    mutate: (d) => {
      d.outOfStockAudit.presence = "NO_MATCH_IN_SCOPE";
    },
  },
  {
    mutationId: "M23",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Claim observed ZIP 95829 / store 3081 price is nationwide US price/inventory",
    expectedFailureCode: "LOCATION_CLAIMED_AS_NATIONWIDE",
    mutate: (d) => {
      d.locationContextAudit.claimedAsNationwidePriceOrStock = true;
    },
  },
  {
    mutationId: "M24",
    targetFile: "05_NEXT_DATA_PARSER_AND_SCHEMA_COMPAT_AUDIT.json",
    description: "Accept PDP payload whose usItemId contradicts requested itemId",
    expectedFailureCode: "PDP_ITEM_ID_MISMATCH_ACCEPTED",
    mutate: (d) => {
      d.pdpIdentityAudit.mismatchedItemIdAccepted = true;
      d.pdpIdentityAudit.mismatchedItemIdStatus = "SUCCEEDED";
    },
  },
  {
    mutationId: "M25",
    targetFile: "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
    description: "Grant EXACT match from title similarity alone without GTIN/UPC or model",
    expectedFailureCode: "TITLE_ONLY_FALSE_EXACT_MATCH",
    mutate: (d) => {
      d.titleOnlyMatchAudit.grantedExact = true;
    },
  },
  {
    mutationId: "M26",
    targetFile: "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
    description: "Match replacement refill/accessory listing as main candidate product",
    expectedFailureCode: "ACCESSORY_MATCHED_AS_MAIN_PRODUCT",
    mutate: (d) => {
      d.accessoryGuardAudit.matchedAsMainProduct = true;
      d.accessoryGuardAudit.accessoryPresence = "FOUND";
    },
  },
  {
    mutationId: "M27",
    targetFile: "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
    description: "Grant EXACT match to wrong model / pack size / refurbished listing",
    expectedFailureCode: "VARIANT_OR_CONDITION_FALSE_EXACT",
    mutate: (d) => {
      d.variantAndConditionGuardAudit.wrongModelGrantedExact = true;
    },
  },
  {
    mutationId: "M28",
    targetFile: "06_PRODUCT_IDENTITY_AND_MATCHING_AUDIT.json",
    description: "Emit standalone generic niche ('Pet Gadgets') as candidate search intent",
    expectedFailureCode: "GENERIC_NICHE_SEARCH_INTENT_EMITTED",
    mutate: (d) => {
      d.searchIntentAudit.genericNicheAloneEmitted = true;
    },
  },
  {
    mutationId: "M29",
    targetFile: "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
    description: "Permit cross-workspace Walmart evidence write or read",
    expectedFailureCode: "WORKSPACE_ISOLATION_BREACH",
    mutate: (d) => {
      d.workspaceIsolation.crossWorkspaceWriteRejected = false;
    },
  },
  {
    mutationId: "M30",
    targetFile: "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
    description: "Permit stale worker claimToken / fencingGeneration to commit Walmart evidence",
    expectedFailureCode: "STALE_WORKER_FENCE_WRITE_ALLOWED",
    mutate: (d) => {
      d.workerFencing.staleClaimTokenRejected = false;
    },
  },
  {
    mutationId: "M31",
    targetFile: "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
    description: "Swallow SQLite transaction write failure and report silent SUCCEEDED",
    expectedFailureCode: "SILENT_PERSISTENCE_FAILURE_SWALLOWED",
    mutate: (d) => {
      d.persistenceFailureHandling.silentSuccessWhenWriteFails = true;
    },
  },
  {
    mutationId: "M32",
    targetFile: "07_ORCHESTRATOR_WORKER_API_DB_PARITY.json",
    description: "Allow GET /api/v1/kh02/marketplace/walmart to perform DB write or network call",
    expectedFailureCode: "GET_ROUTE_NOT_READ_ONLY",
    mutate: (d) => {
      d.getRouteReadOnlyAudit.networkCallsOnGet = 1;
    },
  },
  {
    mutationId: "M33",
    targetFile: "08_UI_BROWSER_AND_RELOAD_PARITY.json",
    description: "Introduce post-reload DOM drift on Walmart itemId / UPC / price in Chromium",
    expectedFailureCode: "UI_RELOAD_PARITY_DRIFT",
    mutate: (d) => {
      d.reloadParity.parityPassed = false;
      d.reloadParity.mismatches = ["DOM_RELOAD_DRIFT:candidate=cand_1,field=upc"];
    },
  },
  {
    mutationId: "M34",
    targetFile: "08_UI_BROWSER_AND_RELOAD_PARITY.json",
    description: "Render 'Key Required' instead of 'Server pilot disabled' when Walmart flag is OFF",
    expectedFailureCode: "DISABLED_STATE_CLAIMS_KEY_REQUIRED",
    mutate: (d) => {
      d.disabledStateAudit.renderedDisabledReason = "Key Required";
      d.disabledStateAudit.renderedKeyRequired = true;
    },
  },
  {
    mutationId: "M35",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Inflate candidate totalScore or distinctSources when Walmart evidence is FOUND",
    expectedFailureCode: "SCORE_OR_VERDICT_INFLATION_DETECTED",
    mutate: (d) => {
      d.scoreDeltaBetweenWalmartOnAndOff = 4.5;
      d.distinctSourcesIncrementedByWalmart = true;
    },
  },
  {
    mutationId: "M36",
    targetFile: "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json",
    description: "Label TEST_FIXTURE Walmart evidence as REAL_JINA_READER live verification",
    expectedFailureCode: "FIXTURE_CLAIMED_AS_REAL_JINA_LIVE",
    mutate: (d) => {
      d.fixtureRowsLabeledAsRealJinaCount = 1;
      d.fabricatedLiveSuccess = true;
    },
  },
  {
    mutationId: "M37",
    targetFile: "02_PRIOR_WALMART_TEST_BASELINE.json",
    description: "Transplant historical 2026-10-30 baseline report as today's live verification",
    expectedFailureCode: "HISTORICAL_BASELINE_TRANSPLANTED_AS_CURRENT_LIVE",
    mutate: (d) => {
      d.transplantedAsCurrentLiveVerification = true;
      d.referenceOnly = false;
    },
  },
  {
    mutationId: "M38",
    targetFile: "13_POINT_IN_TIME_LEAK_AUDIT.json",
    description: "Allow post-T0 future Walmart observation into historical backtest eligible set",
    expectedFailureCode: "POINT_IN_TIME_FUTURE_LEAK_DETECTED",
    mutate: (d) => {
      d.zeroLeakCount = false;
      d.unfilteredFutureLeaksInEligibleSet = 1;
    },
  },
  {
    mutationId: "M39",
    targetFile: "17_REQUIREMENT_TRACEABILITY_W01_W60.json",
    description: "Drop requirement W60 from traceability matrix",
    expectedFailureCode: "TRACEABILITY_INCOMPLETE_OR_FAILED",
    mutate: (d) => {
      d.requirements = d.requirements.slice(0, 59);
    },
  },
  {
    mutationId: "M40",
    targetFile: "22_FILE_MANIFEST_SHA256.json",
    description: "Tamper with SHA-256 digest of 00_BRANCH_AND_BASELINE.json in manifest",
    expectedFailureCode: "ARTIFACT_SHA256_MISMATCH",
    mutate: (d) => {
      if (Array.isArray(d.files) && d.files.length > 0) {
        d.files[0].sha256 =
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      }
    },
  },
];

/**
 * Copies `baseArtifactDir` to an isolated temporary directory on disk, executes all 40 physical-file
 * mutations (`M01..M40`) by writing the mutated file to disk and running `validateWalmartAcceptanceArtifacts`,
 * verifies each mutation fails with `expectedFailureCode`, and cleans up the temporary directory.
 */
export function runPhysicalNegativeMutationSuite40(
  baseArtifactDir: string
): NegativeMutationSuiteReport {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "kh02-wmt-v124351-mutations-")
  );

  try {
    // Copy all existing files from baseArtifactDir into tempRoot
    for (const entry of fs.readdirSync(baseArtifactDir)) {
      const srcPath = path.join(baseArtifactDir, entry);
      const dstPath = path.join(tempRoot, entry);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }

    // Ensure placeholder 18..23 exist in tempRoot if running during stage 14 generation
    const ensureTempManifest = () => {
      const filesList: Array<{ file: string; sha256: string; bytes: number }> = [];
      for (const fname of REQUIRED_ARTIFACT_FILES_00_TO_23) {
        if (fname === "22_FILE_MANIFEST_SHA256.json" || fname === "23_FINAL_RELEASE_VERDICT.json") {
          continue;
        }
        const fpath = path.join(tempRoot, fname);
        if (!fs.existsSync(fpath)) {
          fs.writeFileSync(fpath, JSON.stringify({ placeholder: true }, null, 2));
        }
        filesList.push({
          file: fname,
          sha256: sha256FileSync(fpath),
          bytes: fs.statSync(fpath).size,
        });
      }
      fs.writeFileSync(
        path.join(tempRoot, "22_FILE_MANIFEST_SHA256.json"),
        JSON.stringify({ files: filesList }, null, 2)
      );
      if (!fs.existsSync(path.join(tempRoot, "23_FINAL_RELEASE_VERDICT.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "23_FINAL_RELEASE_VERDICT.json"),
          JSON.stringify({ verdict: "PASS" }, null, 2)
        );
      }
    };

    ensureTempManifest();

    const cases: NegativeMutationCaseResult[] = [];

    for (const spec of FORTY_PHYSICAL_MUTATION_SPECS) {
      const startMs = Date.now();
      const targetPath = path.join(tempRoot, spec.targetFile);
      const originalBytes = fs.readFileSync(targetPath, "utf8");

      try {
        const parsed = JSON.parse(originalBytes);
        spec.mutate(parsed);
        // Physically write mutated file to disk
        fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), "utf8");

        const skipManifestCheck = spec.mutationId !== "M40";
        const valRes = validateWalmartAcceptanceArtifacts(tempRoot, {
          skipManifestSelfCheck: skipManifestCheck,
        });

        const caught =
          valRes.overallVerdict === "FAIL" &&
          valRes.failureCodes.includes(spec.expectedFailureCode);

        cases.push({
          mutationId: spec.mutationId,
          targetFile: spec.targetFile,
          description: spec.description,
          expectedFailureCode: spec.expectedFailureCode,
          observedVerdict: valRes.overallVerdict,
          observedFailureCodes: valRes.failureCodes,
          caughtExpectedCode: caught,
          durationMs: Math.max(1, Date.now() - startMs),
        });
      } finally {
        // Restore original physical file on disk before next mutation
        fs.writeFileSync(targetPath, originalBytes, "utf8");
      }
    }

    const mutationsCaughtCount = cases.filter((c) => c.caughtExpectedCode).length;
    const falsePassCount = cases.filter((c) => c.observedVerdict === "PASS").length;

    return {
      suiteVersion: "12.4.3.5.1",
      executedAt: new Date().toISOString(),
      totalMutationsExecuted: cases.length,
      mutationsCaughtCount,
      falsePassCount,
      allMutationsCaught:
        cases.length >= 40 &&
        mutationsCaughtCount === cases.length &&
        falsePassCount === 0,
      cases,
    };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

if (require.main === module) {
  const argDir = process.argv[2];
  if (!argDir) {
    console.error(
      "Usage: npx tsx scripts/kh02/validateWalmartUsPilotAcceptanceV12_4_3_5_1.ts <artifactDir>"
    );
    process.exit(2);
  }
  const resolvedDir = path.resolve(process.cwd(), argDir);
  const result = validateWalmartAcceptanceArtifacts(resolvedDir);
  console.log(JSON.stringify(result, null, 2));
  if (result.overallVerdict !== "PASS") {
    process.exit(1);
  }
}
