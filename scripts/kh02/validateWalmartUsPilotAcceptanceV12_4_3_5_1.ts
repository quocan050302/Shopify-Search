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
    if (a08.evidenceOrigin !== undefined) {
      check(
        a08.evidenceOrigin === "TEST_FIXTURE" &&
          a08.claimedAsLiveWalmartProductConfirmation === false,
        "UI_FIXTURE_CLAIMED_AS_LIVE_WALMART",
        "08_UI_BROWSER_AND_RELOAD_PARITY.json",
        "Wave D Chromium UI parity uses deterministic TEST_FIXTURE data and must never be claimed as a live Walmart product confirmation."
      );
    }
  }

  // 09: Score & Gate Non-Inflation Audit (M35, M41, M42, M43, M44, M45)
  if (a09) {
    const candidateDiffs: any[] = Array.isArray(a09.perCandidateDiffs)
      ? a09.perCandidateDiffs
      : Array.isArray(a09.diffs)
      ? a09.diffs
      : [];
    const idsOff: string[] = Array.isArray(a09.candidateIdsOff)
      ? a09.candidateIdsOff
      : [];
    const idsOn: string[] = Array.isArray(a09.candidateIdsOn)
      ? a09.candidateIdsOn
      : [];

    check(
      typeof a09.comparedCandidatesCount === "number" &&
        a09.comparedCandidatesCount >= 3 &&
        candidateDiffs.length >= 3 &&
        a09.comparedCandidatesCount === candidateDiffs.length,
      "VACUOUS_NON_INFLATION_AUDIT",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      `Non-inflation audit must compare >= 3 real/cached/controlled product candidates (got comparedCandidatesCount=${a09.comparedCandidatesCount}, diffs.length=${candidateDiffs.length}).`
    );

    const exactIdMatch =
      a09.candidateSetMatch === true &&
      idsOff.length >= 3 &&
      idsOff.length === idsOn.length &&
      idsOff.every((id, idx) => id === idsOn[idx]);
    check(
      exactIdMatch,
      "CANDIDATE_SET_MISMATCH_ON_OFF",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      "Candidate IDs and ordering between Walmart OFF and Walmart ON runs must match 1-to-1."
    );

    check(
      a09.providerPathExercised === true &&
        typeof a09.walmartEvidenceRowsExercised === "number" &&
        a09.walmartEvidenceRowsExercised >= 1 &&
        Array.isArray(a09.evidenceOrigins) &&
        a09.evidenceOrigins.length >= 1,
      "WALMART_PROVIDER_PATH_NOT_EXERCISED",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      "Walmart ON run in non-inflation proof must actually exercise the Walmart provider path and produce >= 1 Walmart evidence row."
    );

    const anyPerCandidateScoreOrGateDrift = candidateDiffs.some(
      (d: any) =>
        Number(d.scoreDelta ?? 0) !== 0 ||
        Number(d.confidenceDelta ?? 0) !== 0 ||
        Number(d.rankDelta ?? 0) !== 0 ||
        Number(d.orderIndexDelta ?? 0) !== 0 ||
        d.tierOff !== d.tierOn ||
        d.recommendationOff !== d.recommendationOn ||
        d.demandStabilityStatusOff !== d.demandStabilityStatusOn ||
        d.evergreenEligibleOff !== d.evergreenEligibleOn
    );

    check(
      a09.nonInflationVerified === true &&
        a09.scoreDeltaBetweenWalmartOnAndOff === 0 &&
        Number(a09.scoreDeltaAbsMax ?? 0) === 0 &&
        a09.rankingChanged === false &&
        Number(a09.gateChanges ?? 0) === 0 &&
        a09.verdictChangedCount === 0 &&
        a09.confidenceChangedCount === 0 &&
        a09.recommendable60dChangedCount === 0 &&
        a09.distinctSourcesIncrementedByWalmart === false &&
        a09.distinctSourceFamiliesIncrementedByWalmart === false &&
        !anyPerCandidateScoreOrGateDrift,
      "SCORE_OR_VERDICT_INFLATION_DETECTED",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      "Walmart US evidence must have zero impact on per-candidate or aggregate totalScore, verdict, confidence, ranking, recommendable60d, distinctSources, or distinctSourceFamilies."
    );

    const anyG15OrG16Promoted =
      Number(a09.g15PromotedCount ?? 0) > 0 ||
      Number(a09.g16PromotedCount ?? 0) > 0 ||
      candidateDiffs.some(
        (d: any) =>
          (d.g15StatusOff && d.g15StatusOn && d.g15StatusOff !== d.g15StatusOn) ||
          (d.g16StatusOff && d.g16StatusOn && d.g16StatusOff !== d.g16StatusOn)
      );
    check(
      !anyG15OrG16Promoted,
      "G15_OR_G16_PROMOTED_BY_WALMART",
      "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
      "Walmart US marketplace evidence must never promote G15 (>=60d evergreen demand) or G16 (live-verified merchant product proof)."
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
    const liveStatus = a10.liveProviderStatus || a10.liveProbeOverallStatus;
    check(
      validLiveStatuses.includes(liveStatus) &&
        a10.probeExecutionStatus === "DID_RUN" &&
        a10.classificationIntegrityStatus === "PASS" &&
        a10.fixtureRowsLabeledAsRealJinaCount === 0 &&
        a10.fabricatedLiveSuccess === false,
      "FIXTURE_CLAIMED_AS_REAL_JINA_LIVE",
      "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json",
      "Fixture rows must never be labeled REAL_JINA_READER and live probe status must be truthfully classified with probeExecutionStatus=DID_RUN and classificationIntegrityStatus=PASS."
    );
    if (liveStatus !== "SUCCEEDED" && liveStatus !== "PARTIAL") {
      check(
        Number(a10.verifiedLiveProductCount ?? 0) === 0 &&
          a10.liveBusinessAcceptanceStatus !== "PASS",
        "LIVE_BLOCKED_CLAIMED_AS_LIVE_SUCCESS",
        "10_LIVE_WALMART_JINA_PILOT_EVIDENCE.json",
        "When live Walmart provider is BLOCKED_PROVIDER or non-succeeded, verifiedLiveProductCount must be 0 and liveBusinessAcceptanceStatus must not be PASS."
      );
    }
  }

  // 11, 12, 13: Real DEV/HOLDOUT Backtest & Point-in-Time Leak Audit (M38, M46, M47)
  if (a11 && a12 && a13) {
    check(
      a11.backtestEngineExecuted === "PASS" &&
        a12.backtestEngineExecuted === "PASS" &&
        a11.pointInTimeIntegrityVerdict === "PASS" &&
        a12.pointInTimeIntegrityVerdict === "PASS" &&
        typeof a11.historicalObservationCount === "number" &&
        a11.historicalObservationCount > 0 &&
        typeof a12.historicalObservationCount === "number" &&
        a12.historicalObservationCount > 0 &&
        typeof a11.reconstructedCandidateCount === "number" &&
        a11.reconstructedCandidateCount > 0 &&
        typeof a12.reconstructedCandidateCount === "number" &&
        a12.reconstructedCandidateCount > 0 &&
        typeof a11.policyScenariosExecuted === "number" &&
        a11.policyScenariosExecuted >= 8 &&
        typeof a12.policyScenariosExecuted === "number" &&
        a12.policyScenariosExecuted >= 8,
      "CONSTANT_OR_UNEXECUTED_BACKTEST_SUMMARY",
      "11_DEV_BACKTEST_SUMMARY.json",
      "DEV and HOLDOUT backtest summaries must come from real execution of runBacktestV12_4_3_4_2 with non-zero historical observations, reconstructed candidates, and policy scenarios."
    );

    check(
      a13.syntheticAudit?.testClass === "SYNTHETIC_UNIT_ANTI_LEAKAGE_TEST" &&
        a13.syntheticAudit?.claimedAsFullHistoricalReplay === false,
      "SYNTHETIC_LEAK_TEST_MISLABELED_AS_FULL_BACKTEST",
      "13_POINT_IN_TIME_LEAK_AUDIT.json",
      "Synthetic 4-row point-in-time leak check must be explicitly labeled SYNTHETIC_UNIT_ANTI_LEAKAGE_TEST and never claimed as a full historical replay."
    );

    check(
      a11.futureLeakageDetected === false &&
        a12.futureLeakageDetected === false &&
        a11.walmartPointInTimeAudit?.leakagePrevented === true &&
        a12.walmartPointInTimeAudit?.leakagePrevented === true &&
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

  // 15: Performance Budget & Process Audit (M54, M55)
  if (a15) {
    check(
      a15.orphanedProcessesAfterRun === 0,
      "OWNED_ORPHAN_PROCESSES_DETECTED",
      "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
      "Runner-owned orphaned processes after run must be 0."
    );
    check(
      a15.orphanedProcessesAfterRun === 0 &&
        a15.budgetCompliance?.maxConcurrentObserved <= 1 &&
        a15.budgetCompliance?.maxOperationsPerRunObserved <= 4 &&
        a15.budgetCompliance?.maxRequestsPerMinuteObserved <= 6,
      "PERFORMANCE_OR_PROCESS_BUDGET_VIOLATION",
      "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
      "Performance and process hygiene audit must show 0 orphaned processes and full compliance with provider caps."
    );
    if (a15.budgetCompliance?.rawRequestsPerMinuteObserved !== undefined) {
      check(
        a15.budgetCompliance.rawRequestsPerMinuteObserved <= 6 &&
          a15.budgetCompliance.withinCapCompliance === true,
        "RAW_RATE_CAP_OVERRUN_DETECTED",
        "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
        "Raw rolling-minute request count must not exceed 6/min and withinCapCompliance must be true."
      );
    }
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

  // Section 10 Measured Gate Ledger, Full Regression, Owned Process & Dynamic Diagnostics Checks (M49..M59)
  const gateLedgerPath = path.join(artifactDir, "02_GATE_EXECUTION_LEDGER.json");
  if (fs.existsSync(gateLedgerPath)) {
    const gateLedger = readJsonSafe(
      artifactDir,
      "02_GATE_EXECUTION_LEDGER.json",
      failures
    );
    if (gateLedger && a00) {
      const reqIds: string[] = Array.isArray(gateLedger.requiredGateIds)
        ? gateLedger.requiredGateIds
        : [];
      const gates: any[] = Array.isArray(gateLedger.gates)
        ? gateLedger.gates
        : [];
      const gateIdSet = new Set(gates.map((g) => g?.id));
      const allRequiredPresent =
        reqIds.length >= 6 &&
        reqIds.every((id) => {
          const found = gates.find((g) => g?.id === id);
          return (
            gateIdSet.has(id) &&
            found &&
            found.executionStatus !== "NOT_RUN" &&
            found.executionStatus !== "CANCELLED"
          );
        });
      check(
        allRequiredPresent && gateLedger.completion?.complete === true,
        "REQUIRED_WAVE_MISSING_OR_INCOMPLETE",
        "02_GATE_EXECUTION_LEDGER.json",
        "All required gates must be present and executed in 02_GATE_EXECUTION_LEDGER.json."
      );

      const allGatesPassed = gates
        .filter((g) => g?.required !== false)
        .every(
          (g) =>
            g.executionStatus === "PASS" &&
            (g.exitCode === undefined || g.exitCode === null || g.exitCode === 0)
        );
      check(
        allGatesPassed &&
          gateLedger.completion?.passed === true &&
          gateLedger.allRequiredWavesPassed === true,
        "WAVE_FAILURE_CONTRADICTS_SUMMARY",
        "02_GATE_EXECUTION_LEDGER.json",
        "Every required gate in 02_GATE_EXECUTION_LEDGER.json must have executionStatus=PASS and exitCode=0 when allRequiredWavesPassed=true."
      );

      const allGateShasMatch =
        gateLedger.sourceSha === a00.codeSha &&
        gates.every((g) => g?.sourceSha === a00.codeSha);
      check(
        allGateShasMatch,
        "GATE_LEDGER_SOURCE_SHA_MISMATCH",
        "02_GATE_EXECUTION_LEDGER.json",
        "Every gate in 02_GATE_EXECUTION_LEDGER.json must match 00_BRANCH_AND_BASELINE.json codeSha."
      );
    }
  }

  const fullRegPath = path.join(
    artifactDir,
    "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json"
  );
  if (fs.existsSync(fullRegPath)) {
    const fullReg = readJsonSafe(
      artifactDir,
      "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
      failures
    );
    if (fullReg) {
      check(
        fullReg.targetedOnly === false &&
          fullReg.inventoryComplete === true &&
          typeof fullReg.totalDiscoveredTestFiles === "number" &&
          fullReg.totalDiscoveredTestFiles >= 150 &&
          typeof fullReg.executedTestFilesCount === "number" &&
          fullReg.executedTestFilesCount >= 130,
        "TARGETED_REGRESSION_CLAIMED_AS_FULL",
        "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
        "Full repository regression must discover >=150 test files, execute >=130 test files, and have targetedOnly=false."
      );

      check(
        Number(fullReg.requiredActiveSuiteFailedTestCases ?? 1) === 0 &&
          Number(fullReg.newRegressionTestCases ?? 1) === 0,
        "ACTIVE_REGRESSION_FAILURE_UNRESOLVED",
        "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
        "Active required unit and integration test suites must have 0 failed test cases and 0 new regressions."
      );

      check(
        fullReg.zeroLegacyFailExemptionEnforced !== false &&
          Number(fullReg.failedTestCases ?? 1) === 0 &&
          Number(fullReg.baselineKnownPolicySupersededTestCases ?? 1) === 0,
        "LEGACY_FAIL_EXEMPTION_REENABLED",
        "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
        "Workstream A requires 0 failedTestCases and 0 baselineKnownPolicySupersededTestCases (no legacy fail-exemption)."
      );
    }
  }

  const legacy17Path = path.join(
    artifactDir,
    "03_LEGACY_17_ASSERTION_COMPARISON.json"
  );
  if (fs.existsSync(legacy17Path)) {
    const legacy17 = readJsonSafe(
      artifactDir,
      "03_LEGACY_17_ASSERTION_COMPARISON.json",
      failures
    );
    if (legacy17) {
      check(
        Array.isArray(legacy17.assertions) &&
          legacy17.assertions.length === 17 &&
          legacy17.qaBaselineFailedCount === 17 &&
          (legacy17.currentBranchFailedCount ??
            legacy17.currentHeadFailedCount) === 0 &&
          legacy17.all17RepairedAndPassing === true,
        "BASELINE_DIFF_PROOF_MISSING_17_ASSERTIONS",
        "03_LEGACY_17_ASSERTION_COMPARISON.json",
        "03_LEGACY_17_ASSERTION_COMPARISON.json must document all 17 baseline failing assertions on origin/QA and prove 0 failures on current branch."
      );
    }
  }

  const e2eReceiptsPath = path.join(
    artifactDir,
    "06_ALL_12_E2E_EXECUTION_RECEIPTS.json"
  );
  if (fs.existsSync(e2eReceiptsPath)) {
    const e2eReceipts = readJsonSafe(
      artifactDir,
      "06_ALL_12_E2E_EXECUTION_RECEIPTS.json",
      failures
    );
    if (e2eReceipts && a00) {
      check(
        e2eReceipts.totalSpecs === 12 &&
          Array.isArray(e2eReceipts.receipts) &&
          e2eReceipts.receipts.length === 12 &&
          e2eReceipts.skippedWithoutAttemptCount === 0 &&
          e2eReceipts.failedSpecsCount === 0 &&
          e2eReceipts.receipts.every(
            (r: any) => r.classification === "PASS" && r.exitCode === 0
          ),
        "E2E_SPEC_SKIPPED_OR_UNCOUNTED",
        "06_ALL_12_E2E_EXECUTION_RECEIPTS.json",
        "All 12 E2E specs (6 in tests/integration + 6 in tests/e2e) must be executed and accounted for with 0 skipped and 0 failed."
      );
      check(
        e2eReceipts.sourceSha === a00.codeSha &&
          Array.isArray(e2eReceipts.receipts) &&
          e2eReceipts.receipts.every((r: any) => r.sourceSha === a00.codeSha),
        "TESTED_SHA_DRIFT_IN_E2E_RECEIPTS",
        "06_ALL_12_E2E_EXECUTION_RECEIPTS.json",
        "Every E2E execution receipt in 06_ALL_12_E2E_EXECUTION_RECEIPTS.json must match 00_BRANCH_AND_BASELINE.json codeSha."
      );
    }
  }

  if (a11) {
    if (a11.nicheCoverageStatus !== undefined) {
      check(
        Number(a11.shortlistCount ?? 0) >= 3 ||
          a11.nicheCoverageStatus === "INSUFFICIENT_NICHE_COVERAGE",
        "DEV_INSUFFICIENT_NICHE_COVERAGE_MISLABELED_SUFFICIENT",
        "11_DEV_BACKTEST_SUMMARY.json",
        "When DEV shortlist has < 3 niche-matched products, nicheCoverageStatus must be INSUFFICIENT_NICHE_COVERAGE."
      );
    }
    if (a11.joinedMetadataLeakageAudit !== undefined) {
      check(
        a11.joinedMetadataLeakageAudit?.leakagePrevented === true,
        "POST_CUTOFF_JOINED_METADATA_OR_NICHE_LEAK",
        "11_DEV_BACKTEST_SUMMARY.json",
        "Joined product metadata lookahead guard must have leakagePrevented=true in 11_DEV_BACKTEST_SUMMARY.json."
      );
    }
  }

  const nicheFunnelPath = path.join(
    artifactDir,
    "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json"
  );
  if (fs.existsSync(nicheFunnelPath)) {
    const nicheFunnel = readJsonSafe(
      artifactDir,
      "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
      failures
    );
    if (nicheFunnel) {
      const holdoutTop3: any[] = Array.isArray(nicheFunnel.holdoutTop3)
        ? nicheFunnel.holdoutTop3
        : [];
      const devTop3: any[] = Array.isArray(nicheFunnel.devTop3)
        ? nicheFunnel.devTop3
        : [];
      check(
        nicheFunnel.crossNicheFalsePositivesInDevTop3 === 0 &&
          nicheFunnel.crossNicheFalsePositivesInHoldoutTop3 === 0 &&
          holdoutTop3.length === 3 &&
          holdoutTop3.every(
            (p) => p.nicheMatched === true && p.matchStatus === "MATCH"
          ) &&
          devTop3.every(
            (p) => p.nicheMatched === true && p.matchStatus === "MATCH"
          ),
        "CROSS_NICHE_FALSE_POSITIVE_IN_TOP3",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "Zero cross-niche false positives are permitted in DEV or HOLDOUT Top-3 shortlists."
      );
      check(
        nicheFunnel.paddedWithMismatchOrUncertainCount === 0 &&
          Number(nicheFunnel.devShortlistCount ?? 0) ===
            Number(nicheFunnel.devNicheMatchedCount ?? 0) &&
          Number(nicheFunnel.holdoutShortlistCount ?? 0) ===
            Number(nicheFunnel.holdoutNicheMatchedCount ?? 0),
        "SHORTLIST_PADDED_WITH_MISMATCH_OR_UNCERTAIN",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "Shortlists with < 3 niche-matched candidates must never be padded with MISMATCH or UNCERTAIN products."
      );
      check(
        nicheFunnel.crossNicheInputVerification?.drivenByInputNiche === true &&
          Number(
            nicheFunnel.crossNicheInputVerification?.kitchenGadgetsMatchedCount ?? 0
          ) >= 2 &&
          Number(
            nicheFunnel.crossNicheInputVerification?.kitchenGadgetsRejectedPetCount ?? 0
          ) >= 1,
        "NICHE_PARAMETER_IGNORED_HARDCODED_PET_GADGETS",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "Niche replay evaluator must dynamically respect input niche (e.g. 'Kitchen Gadgets') rather than hardcoding 'Pet Gadgets'."
      );

      const allShortlisted = [...devTop3, ...holdoutTop3];
      const anyAdOnlyPromotedToVerified =
        Number(nicheFunnel.urlPathOnlyPromotedToVerifiedCount ?? 0) > 0 ||
        allShortlisted.some(
          (p) =>
            p.identityStatus === "VERIFIED" &&
            (p.verificationEvidenceStatus === "AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF" ||
              !Array.isArray(p.independentMerchantProofRefs) ||
              p.independentMerchantProofRefs.length === 0)
        );
      check(
        !anyAdOnlyPromotedToVerified,
        "HISTORICAL_IDENTITY_URL_PATH_ONLY_PROMOTED_TO_VERIFIED",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "Historical replay must never promote a URL-path-only (/products/<slug>) ad-observed candidate to identityStatus='VERIFIED' without independent point-in-time merchant proof."
      );

      const anyFunnelPromotedToVerified =
        Number(nicheFunnel.funnelPromotedToVerifiedCount ?? 0) > 0 ||
        allShortlisted.some(
          (p) =>
            (p.isCheckoutChampFunnel === true ||
              String(p.storeDomain || "").toLowerCase() === "cc.uprootclean.com" ||
              String(p.canonicalProductUrl || "").toLowerCase().includes("/main/phr")) &&
            (p.identityStatus === "VERIFIED" ||
              p.verificationEvidenceStatus === "VERIFIED_MERCHANT_JSONLD")
        );
      check(
        !anyFunnelPromotedToVerified,
        "CHECKOUT_CHAMP_FUNNEL_PROMOTED_TO_VERIFIED",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "CheckoutChamp / funnel URLs (e.g. cc.uprootclean.com/main/phr) must be classified as PROBABLE + FUNNEL_UNVERIFIED and never promoted to VERIFIED."
      );

      if (nicheFunnel.holdoutIdentityCoverageStatus !== undefined) {
        check(
          Number(nicheFunnel.holdoutVerifiedIdentityCount ?? 0) >= 3 ||
            nicheFunnel.holdoutIdentityCoverageStatus === "INSUFFICIENT_VERIFIED_IDENTITY",
          "HISTORICAL_IDENTITY_COVERAGE_MISLABELED_SUFFICIENT",
          "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
          "When HOLDOUT shortlist has < 3 independently verified product identities, holdoutIdentityCoverageStatus must be INSUFFICIENT_VERIFIED_IDENTITY."
        );
      }

      const anyDiscoveryMislabeledAsVerified =
        Number(nicheFunnel.discoveryRefsCopiedToIndependentProofCount ?? 0) > 0 ||
        allShortlisted.some(
          (p) =>
            p.identityStatus !== "VERIFIED" &&
            (String(p.reason || "").startsWith("Verified '") ||
              (Array.isArray(p.independentMerchantProofRefs) &&
                p.independentMerchantProofRefs.some((r: any) =>
                  /^(discovery_ad|ad_obs):/i.test(String(r))
                )))
        );
      check(
        !anyDiscoveryMislabeledAsVerified,
        "DISCOVERY_CANDIDATE_MISLABELED_AS_VERIFIED_IN_REASON_OR_REFS",
        "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
        "Discovery-only candidates (identityStatus !== 'VERIFIED') must not use 'Verified <niche> product' reason strings or copy discovery_ad:/ad_obs: pointers into independentMerchantProofRefs."
      );
    }
  }

  const g16Sec8Path = path.join(
    artifactDir,
    "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json"
  );
  if (fs.existsSync(g16Sec8Path)) {
    const g16Sec8 = readJsonSafe(
      artifactDir,
      "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
      failures
    );
    if (g16Sec8) {
      check(
        g16Sec8.snapshotFreshness === "HISTORICAL_SNAPSHOT_RE_EVALUATED" &&
          g16Sec8.claimedAsCurrentLiveRunVerification === false &&
          (Number(g16Sec8.verifiedLiveMerchantsCount ?? 0) >= 3 ||
            g16Sec8.verdict !== "PASS"),
        "HISTORICAL_SNAPSHOT_CONFLATED_WITH_CURRENT_LIVE_G16",
        "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
        "Historical stored run G16 proof must be labeled HISTORICAL_SNAPSHOT_RE_EVALUATED and never claimed as current live run verification."
      );

      if (g16Sec8.g16SyntheticHydrationUsed !== undefined) {
        check(
          g16Sec8.g16SyntheticHydrationUsed === false &&
            Number(g16Sec8.fabricatedHydrationObservationsUsedCount ?? 0) === 0 &&
            Number(g16Sec8.syntheticJsonldProofRefsUsedCount ?? 0) === 0,
          "SYNTHETIC_G16_HYDRATION_OR_FABRICATED_OBSERVATION_USED",
          "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
          "G16 evaluation must never use synthetic runtime hydration (obs_<runId>_<candId>, req_<runId>, or jsonld:<domain>)."
        );
      }

      if (g16Sec8.verifiedFromPersistedEvidenceCount !== undefined) {
        const persistedCount = Number(g16Sec8.verifiedFromPersistedEvidenceCount ?? 0);
        const prevClaimed = Number(g16Sec8.previousSnapshotClaimedVerifiedCount ?? 0);
        check(
          Number(g16Sec8.verifiedLiveMerchantsCount ?? 0) === persistedCount &&
            (persistedCount > 0 ||
              prevClaimed === 0 ||
              (g16Sec8.reconstructionStatus ===
                "HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE" &&
                g16Sec8.verdict === "INSUFFICIENT_EVIDENCE")),
          "UNRECONSTRUCTABLE_SNAPSHOT_G16_CLAIMED_AS_PERSISTED_VERIFIED",
          "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
          "When persisted DB evidence has 0 verified live merchants for a stored snapshot that claimed 2/3, G16 must report verifiedLiveMerchantsCount=0, reconstructionStatus=HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE, and verdict=INSUFFICIENT_EVIDENCE."
        );
      }

      if (g16Sec8.crossWorkspaceProofsAcceptedCount !== undefined) {
        check(
          Number(g16Sec8.crossWorkspaceProofsAcceptedCount ?? 0) === 0,
          "CROSS_WORKSPACE_MERCHANT_PROOF_ACCEPTED_IN_G16",
          "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
          "Cross-workspace LandingPageSnapshot or ResearchEvidence rows must never be accepted as persisted G16 merchant proof."
        );
      }

      if (
        g16Sec8.unverifiedLiveOriginObservationsCount !== undefined &&
        Array.isArray(g16Sec8.candidates)
      ) {
        const candUnverifiedSum = g16Sec8.candidates.reduce(
          (acc: number, c: any) =>
            acc + Number(c?.unverifiedPersistedOriginCount ?? 0),
          0
        );
        const candLiveObsSum = g16Sec8.candidates.reduce(
          (acc: number, c: any) => acc + Number(c?.liveObservationsCount ?? 0),
          0
        );
        check(
          Number(g16Sec8.unverifiedLiveOriginObservationsCount ?? 0) ===
            candUnverifiedSum &&
            (candLiveObsSum > 0 ||
              Number(g16Sec8.verifiedFromPersistedEvidenceCount ?? 0) === 0),
          "G16_PERSISTED_ORIGIN_CONTRADICTION",
          "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
          "When candidates have 0 verified live observations and non-zero unverifiedPersistedOriginCount, verifiedFromPersistedEvidenceCount must be 0 and unverifiedLiveOriginObservationsCount must match."
        );
      }
    }
  }

  // Section 9 Schema & Origin Live Proof Hardening Checks (M81..M88)
  const prismaContractPath = path.join(
    artifactDir,
    "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json"
  );
  if (fs.existsSync(prismaContractPath)) {
    const prismaContract = readJsonSafe(
      artifactDir,
      "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json",
      failures
    );
    if (prismaContract) {
      check(
        prismaContract.imaginaryColumnsRemoved === true &&
          Number(prismaContract.imaginaryColumnsUsedCount ?? 0) === 0 &&
          Array.isArray(prismaContract.removedImaginaryFieldAccesses) &&
          prismaContract.removedImaginaryFieldAccesses.length >= 10,
        "IMAGINARY_PRISMA_COLUMNS_USED",
        "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json",
        "All imaginary Prisma column accesses (ev.evidenceType, lp.productTitle, lp.canonicalUrl, lp.capturedAt, os.offerUrl, prod.workspaceId, prod.storeDomain, etc.) must be removed with imaginaryColumnsUsedCount=0."
      );
    }
  }

  const landingSchemaAuditPath = path.join(
    artifactDir,
    "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json"
  );
  if (fs.existsSync(landingSchemaAuditPath)) {
    const landingSchemaAudit = readJsonSafe(
      artifactDir,
      "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
      failures
    );
    if (landingSchemaAudit) {
      check(
        Number(landingSchemaAudit.hashOrTitleOnlyPromotedCount ?? 1) === 0,
        "HASH_OR_TITLE_ONLY_SNAPSHOT_PROMOTED_TO_JSONLD",
        "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
        "LandingPageSnapshot rows with only pageTitle/url/contentHash and no parseable @type:Product JSON-LD in rawExcerpt must never be promoted to schemaVerified=true / VERIFIED."
      );
      check(
        landingSchemaAudit.bareBooleanBypassRejected === true,
        "BARE_BOOLEAN_SCHEMA_BYPASS_ALLOWED",
        "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
        "Bare caller-supplied boolean flags (schemaVerified:true, hasJsonLdProduct:true) without raw source payload and matching SHA-256 must be rejected."
      );
      if (landingSchemaAudit.rawSourceHashTamperedNonFixtureCount !== undefined) {
        check(
          Number(landingSchemaAudit.rawSourceHashTamperedNonFixtureCount ?? 1) ===
            0 &&
            Number(
              landingSchemaAudit.semanticContentHashNotRawProofCount ?? 0
            ) >= 1,
          "LANDING_SNAPSHOT_SEMANTIC_HASH_MISCLASSIFIED_AS_RAW_TAMPERED",
          "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
          "Non-fixture LandingPageSnapshot rows with commercial semantic contentHash and CRO observationsJson must be classified as SEMANTIC_CONTENT_HASH_NOT_RAW_PROOF, never RAW_SOURCE_HASH_TAMPERED."
        );
      }
      if (landingSchemaAudit.semanticDigestAcceptedAsRawProofCount !== undefined) {
        check(
          Number(landingSchemaAudit.semanticDigestAcceptedAsRawProofCount ?? 1) ===
            0,
          "SEMANTIC_DIGEST_ACCEPTED_AS_RAW_SCHEMA_PROOF",
          "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
          "Commercial semantic digest (COMMERCIAL_SEMANTIC_DIGEST_SHA256) must never be accepted as a raw product schema proof."
        );
      }
    }
  }

  const rawSchemaReadbackProofPath = path.join(
    artifactDir,
    "04_raw_product_schema_capture_to_readback_proof.json"
  );
  if (fs.existsSync(rawSchemaReadbackProofPath)) {
    const rawSchemaReadbackProof = readJsonSafe(
      artifactDir,
      "04_raw_product_schema_capture_to_readback_proof.json",
      failures
    );
    if (rawSchemaReadbackProof) {
      check(
        rawSchemaReadbackProof.captureToReadbackVerified === true &&
          rawSchemaReadbackProof.hashDomainSeparated === true &&
          rawSchemaReadbackProof.persistedProofValidationStatus ===
            "CONTENT_VALIDATED_WITH_SOURCE" &&
          rawSchemaReadbackProof.landingSnapshotSemanticStatus ===
            "SEMANTIC_CONTENT_HASH_NOT_RAW_PROOF",
        "RAW_PRODUCT_SCHEMA_CAPTURE_READBACK_FAILED",
        "04_raw_product_schema_capture_to_readback_proof.json",
        "Raw Product JSON-LD capture-to-readback proof must succeed with CONTENT_VALIDATED_WITH_SOURCE while LandingPageSnapshot semantic hash remains SEMANTIC_CONTENT_HASH_NOT_RAW_PROOF."
      );
      check(
        rawSchemaReadbackProof.oversizePayloadRejected === true &&
          rawSchemaReadbackProof.midJsonTruncatedPayloadRejected === true &&
          Number(rawSchemaReadbackProof.oversizeOrTruncatedAcceptedCount ?? 1) ===
            0,
        "OVERSIZE_OR_TRUNCATED_SCHEMA_PAYLOAD_ACCEPTED",
        "04_raw_product_schema_capture_to_readback_proof.json",
        "Oversize (>32KB) or mid-JSON truncated schema payloads must be rejected cleanly with oversizeOrTruncatedAcceptedCount=0."
      );
    }
  }

  const g16DynamicMatrixPath = path.join(
    artifactDir,
    "07_g16_dynamic_diagnostic_reason_matrix.json"
  );
  if (fs.existsSync(g16DynamicMatrixPath)) {
    const g16DynamicMatrix = readJsonSafe(
      artifactDir,
      "07_g16_dynamic_diagnostic_reason_matrix.json",
      failures
    );
    if (g16DynamicMatrix) {
      check(
        g16DynamicMatrix.allPermutationsPassed === true &&
          g16DynamicMatrix.liveG16ReasonMatchesBuilder === true &&
          Number(
            g16DynamicMatrix.hardcodedReasonContradictionCount ?? 1
          ) === 0,
        "G16_DIAGNOSTIC_REASON_CONTRADICTS_CANDIDATE_COUNTS",
        "07_g16_dynamic_diagnostic_reason_matrix.json",
        "G16 diagnostic reason must be dynamically generated from actual candidate statuses with hardcodedReasonContradictionCount=0."
      );
      check(
        g16DynamicMatrix.nonFunnelPermutationFreeOfFalseFunnelClaim === true &&
          Number(g16DynamicMatrix.falseFunnelClaimCount ?? 1) === 0,
        "G16_DIAGNOSTIC_REASON_FALSE_FUNNEL_CLAIM",
        "07_g16_dynamic_diagnostic_reason_matrix.json",
        "G16 diagnostic reason must never claim a CheckoutChamp funnel when isCheckoutChampFunnel=false across all candidates."
      );
    }
  }

  if (fs.existsSync(g16Sec8Path)) {
    const g16Sec10 = readJsonSafe(
      artifactDir,
      "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
      failures
    );
    if (g16Sec10 && Array.isArray(g16Sec10.candidates)) {
      const invalidSchemaStatusCandidate = g16Sec10.candidates.find(
        (c: any) =>
          c?.productSchemaProofStatus === "VERIFIED" &&
          (!Array.isArray(c?.persistedProofRowIds) ||
            c.persistedProofRowIds.length === 0)
      );
      check(
        !invalidSchemaStatusCandidate,
        "G16_CANDIDATE_SCHEMA_STATUS_WITHOUT_PROOF_ROW",
        "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
        "No G16 candidate may have productSchemaProofStatus='VERIFIED' with empty persistedProofRowIds."
      );

      const invalidOriginStatusCandidate = g16Sec10.candidates.find(
        (c: any) =>
          c?.originProofStatus === "VERIFIED" &&
          (!Array.isArray(c?.authenticLiveObservationIds) ||
            c.authenticLiveObservationIds.length === 0)
      );
      check(
        !invalidOriginStatusCandidate,
        "G16_CANDIDATE_ORIGIN_STATUS_WITHOUT_LIVE_OBSERVATION",
        "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
        "No G16 candidate may have originProofStatus='VERIFIED' with empty authenticLiveObservationIds."
      );
    }
  }

  const g16OriginAuditPath = path.join(
    artifactDir,
    "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json"
  );
  if (fs.existsSync(g16OriginAuditPath)) {
    const g16OriginAudit = readJsonSafe(
      artifactDir,
      "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json",
      failures
    );
    if (g16OriginAudit) {
      check(
        Number(g16OriginAudit.unverifiedObservationsRebrandedAsLiveCount ?? 1) ===
          0,
        "UNVERIFIED_DB_OBSERVATION_REBRANDED_AS_LIVE_PROVIDER",
        "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json",
        "Persisted AdObservation + DiscoveryRunAd rows without verified upstream live provider origin must never be rebranded as LIVE_PROVIDER."
      );
      check(
        Number(
          g16OriginAudit.existingIngestOutcomeAcceptedAsLiveCount ?? 1
        ) === 0 &&
          Number(
            g16OriginAudit.updatedIngestOutcomeWithoutFreshEnvelopeAcceptedCount ??
              1
          ) === 0 &&
          Number(
            g16OriginAudit.manualOrUserObservedAcceptedAsLiveCount ?? 1
          ) === 0 &&
          Number(
            g16OriginAudit.deterministicFallbackAcceptedAsLiveCount ?? 1
          ) === 0,
        "NON_LIVE_INGEST_OR_FALLBACK_ACCEPTED_IN_G16",
        "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json",
        "DiscoveryRunAd.ingestOutcome=EXISTING/UPDATED (without fresh capture envelope), MANUAL_ENTRY/USER_OBSERVED, or DETERMINISTIC_FALLBACK must never be accepted as live G16 observations."
      );
    }
  }

  const g16MatrixReceiptsPath = path.join(
    artifactDir,
    "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json"
  );
  if (fs.existsSync(g16MatrixReceiptsPath)) {
    const g16MatrixReceipts = readJsonSafe(
      artifactDir,
      "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json",
      failures
    );
    if (g16MatrixReceipts) {
      check(
        g16MatrixReceipts.passed === true &&
          Number(g16MatrixReceipts.totalMatrixCases ?? 0) === 39 &&
          Number(g16MatrixReceipts.passedMatrixCases ?? 0) === 39 &&
          Number(g16MatrixReceipts.failedMatrixCases ?? 1) === 0 &&
          Number(g16MatrixReceipts.merchantSchemaNegativeCount ?? 0) === 17 &&
          Number(g16MatrixReceipts.liveOriginNegativeCount ?? 0) === 16 &&
          Number(g16MatrixReceipts.positiveContractCount ?? 0) === 6 &&
          Array.isArray(g16MatrixReceipts.cases) &&
          g16MatrixReceipts.cases.length === 39 &&
          g16MatrixReceipts.cases.every((c: any) => c.passed === true),
        "G16_SCHEMA_ORIGIN_MATRIX_INCOMPLETE_OR_FAILED",
        "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json",
        "All 39 G16 schema and origin matrix cases (M01..M17, L01..L16, P01..P06) must be present and pass."
      );
    }
  }

  const procLedgerSec8Path = path.join(
    artifactDir,
    "17_DISK_RAM_OWNED_PROCESS_LEDGER.json"
  );
  if (fs.existsSync(procLedgerSec8Path)) {
    const procLedgerSec8 = readJsonSafe(
      artifactDir,
      "17_DISK_RAM_OWNED_PROCESS_LEDGER.json",
      failures
    );
    if (procLedgerSec8) {
      check(
        procLedgerSec8.orphanedOwnedProcessesAfterRun === 0 &&
          Array.isArray(procLedgerSec8.orphanedOwnedPids) &&
          procLedgerSec8.orphanedOwnedPids.length === 0 &&
          Number(procLedgerSec8.observedPeakConcurrentHeavy ?? 0) <= 2,
        "ORPHANED_PROCESSES_IN_BOUNDED_DAG",
        "17_DISK_RAM_OWNED_PROCESS_LEDGER.json",
        "Bounded async DAG ledger must show 0 orphaned owned processes and observedPeakConcurrentHeavy <= 2."
      );
    }
  }

  const multiVerdictSec8Path = path.join(
    artifactDir,
    "19_FINAL_MULTI_VERDICT_SUMMARY.json"
  );
  if (fs.existsSync(multiVerdictSec8Path)) {
    const mv = readJsonSafe(
      artifactDir,
      "19_FINAL_MULTI_VERDICT_SUMMARY.json",
      failures
    );
    if (mv) {
      const hasBlockers =
        mv.liveWalmartProviderVerdict !== "LIVE_VERIFIED" ||
        mv.liveAmazonProviderVerdict !== "LIVE_VERIFIED" ||
        mv.kh02BusinessVerdict !== "PASS" ||
        mv.historicalG15Verdict !== "PASS";
      check(
        mv.verdictMatrix?.ENGINEERING_TESTS === "PASS" &&
          mv.verdictMatrix?.BROAD_REGRESSION === "PASS" &&
          mv.verdictMatrix?.REQUIRED_E2E_COVERAGE === "PASS" &&
          mv.verdictMatrix?.HISTORICAL_REPLAY_INTEGRITY === "PASS" &&
          mv.verdictMatrix?.NICHE_RELEVANCE === "PASS" &&
          (!hasBlockers ||
            (mv.verdictMatrix?.FINAL_RELEASE ===
              "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS" &&
              mv.verdictMatrix?.FINAL_RELEASE !== "FULL_ACCEPTANCE" &&
              mv.overallVerdict !== "FULL_ACCEPTANCE")),
        "FINAL_RELEASE_FALSE_FULL_ACCEPTANCE",
        "19_FINAL_MULTI_VERDICT_SUMMARY.json",
        "19_FINAL_MULTI_VERDICT_SUMMARY.json must report FINAL_RELEASE='ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS' (never FULL_ACCEPTANCE) when external provider or 60d G15 blockers exist."
      );

      if (mv.verdictMatrix?.HISTORICAL_PRODUCT_IDENTITY_TRUTH !== undefined) {
        check(
          mv.verdictMatrix.HISTORICAL_PRODUCT_IDENTITY_TRUTH === "PASS" &&
            mv.historicalProductIdentityTruthVerdict === "PASS" &&
            (Number(mv.historicalIdentitySummary?.holdoutVerifiedIdentityCount ?? 0) >= 3 ||
              mv.verdictMatrix.HISTORICAL_VERIFIED_IDENTITY_COVERAGE ===
                "INSUFFICIENT_VERIFIED_IDENTITY"),
          "HISTORICAL_IDENTITY_TRUTH_VERDICT_FALSE_PASS",
          "19_FINAL_MULTI_VERDICT_SUMMARY.json",
          "19_FINAL_MULTI_VERDICT_SUMMARY.json must enforce HISTORICAL_PRODUCT_IDENTITY_TRUTH='PASS' and HISTORICAL_VERIFIED_IDENTITY_COVERAGE='INSUFFICIENT_VERIFIED_IDENTITY' when < 3 HOLDOUT candidates have independent merchant proof."
        );
      }

      if (
        mv.verdictMatrix?.PERSISTED_SCHEMA_TRUTH_ENFORCEMENT !== undefined ||
        mv.verdictMatrix?.LIVE_OBSERVATION_ORIGIN_ENFORCEMENT !== undefined
      ) {
        check(
          mv.verdictMatrix?.PERSISTED_SCHEMA_TRUTH_ENFORCEMENT === "PASS" &&
            mv.verdictMatrix?.LIVE_OBSERVATION_ORIGIN_ENFORCEMENT === "PASS",
          "SCHEMA_OR_ORIGIN_ENFORCEMENT_VERDICT_FAILED",
          "19_FINAL_MULTI_VERDICT_SUMMARY.json",
          "19_FINAL_MULTI_VERDICT_SUMMARY.json must have PERSISTED_SCHEMA_TRUTH_ENFORCEMENT='PASS' and LIVE_OBSERVATION_ORIGIN_ENFORCEMENT='PASS'."
        );
      }
    }
  }

  const ownedProcPath = path.join(
    artifactDir,
    "06_DISK_RAM_OWNED_PROCESSES_AUDIT.json"
  );
  if (fs.existsSync(ownedProcPath)) {
    const ownedProc = readJsonSafe(
      artifactDir,
      "06_DISK_RAM_OWNED_PROCESSES_AUDIT.json",
      failures
    );
    if (ownedProc) {
      check(
        ownedProc.orphanedOwnedProcessesAfterRun === 0 &&
          Array.isArray(ownedProc.orphanedOwnedPids) &&
          ownedProc.orphanedOwnedPids.length === 0,
        "OWNED_ORPHAN_PROCESSES_DETECTED",
        "06_DISK_RAM_OWNED_PROCESSES_AUDIT.json",
        "06_DISK_RAM_OWNED_PROCESSES_AUDIT.json must show 0 runner-owned orphaned processes after run."
      );
    }
  }

  const liveDiagPath = path.join(
    artifactDir,
    "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json"
  );
  if (fs.existsSync(liveDiagPath)) {
    const liveDiag = readJsonSafe(
      artifactDir,
      "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json",
      failures
    );
    if (liveDiag) {
      const amz = liveDiag.providers?.amazonUs;
      if (amz && amz.configured === false) {
        check(
          amz.liveVerdict !== "LIVE_VERIFIED" && amz.querySucceeded === false,
          "AMAZON_STATE_MISMATCH_FALSE_LIVE",
          "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json",
          "When Amazon Creators API is not configured, liveVerdict must not be LIVE_VERIFIED."
        );
      }
      const g07 = liveDiag.providers?.tiktokUsG07;
      if (g07 && g07.configured === false) {
        check(
          g07.verdict !== "PASS" && liveDiag.gates?.g07?.verdict !== "PASS",
          "G07_STATE_MISMATCH_FALSE_PASS",
          "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json",
          "When TikTok US ad provider is not configured, G07 verdict must not be PASS."
        );
      }
    }
  }

  const g15DiagPath = path.join(
    artifactDir,
    "08_G15_60D_DEMAND_COVERAGE_BY_PRODUCT.json"
  );
  if (fs.existsSync(g15DiagPath)) {
    const g15Diag = readJsonSafe(
      artifactDir,
      "08_G15_60D_DEMAND_COVERAGE_BY_PRODUCT.json",
      failures
    );
    if (g15Diag) {
      if (Number(g15Diag.qualifiedProductsCount ?? 0) < 3) {
        check(
          g15Diag.verdict === "INSUFFICIENT_EVIDENCE",
          "G15_FALSE_PASS_WITHOUT_60D_HISTORY",
          "08_G15_60D_DEMAND_COVERAGE_BY_PRODUCT.json",
          "G15 verdict must be INSUFFICIENT_EVIDENCE when fewer than 3 products have >=60 days of authoritative longitudinal demand."
        );
      }
    }
  }

  const g16DiagPath = path.join(
    artifactDir,
    "09_G16_MERCHANT_LIVE_PROOF_BY_CANDIDATE.json"
  );
  if (fs.existsSync(g16DiagPath)) {
    const g16Diag = readJsonSafe(
      artifactDir,
      "09_G16_MERCHANT_LIVE_PROOF_BY_CANDIDATE.json",
      failures
    );
    if (g16Diag) {
      if (Number(g16Diag.verifiedLiveMerchantsCount ?? 0) < 3) {
        check(
          g16Diag.verdict !== "PASS",
          "G16_FALSE_PASS_WITHOUT_3_OF_3_LIVE_MERCHANTS",
          "09_G16_MERCHANT_LIVE_PROOF_BY_CANDIDATE.json",
          "G16 verdict must not be PASS when verifiedLiveMerchantsCount < 3."
        );
      }
    }
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

  // 23: Final Release Multi-Verdict Separation (M48)
  if (!options.skipStage18to23Existence && fs.existsSync(path.join(artifactDir, "23_FINAL_RELEASE_VERDICT.json"))) {
    const a23 = readJsonSafe(artifactDir, "23_FINAL_RELEASE_VERDICT.json", failures);
    if (a23) {
      const hasExternalOrBusinessBlockers =
        a23.liveWalmartProviderVerdict !== "LIVE_VERIFIED" ||
        a23.liveAmazonProviderVerdict !== "LIVE_VERIFIED" ||
        a23.kh02BusinessVerdict !== "PASS" ||
        a23.historicalG15Verdict !== "PASS" ||
        a23.historicalEvidenceVerdict !== "PASS";

      check(
        a23.engineeringVerdict === "PASS" &&
          typeof a23.liveWalmartProviderVerdict === "string" &&
          typeof a23.liveAmazonProviderVerdict === "string" &&
          typeof a23.kh02BusinessVerdict === "string" &&
          typeof a23.historicalEvidenceVerdict === "string" &&
          typeof a23.deliveryVerdict === "string" &&
          (!hasExternalOrBusinessBlockers ||
            (a23.overallVerdict !== "PASS" &&
              a23.overallVerdict !== "FULL_ACCEPTANCE" &&
              a23.overallVerdict === "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS")),
        "OVERALL_VERDICT_FALSE_PASS_WITH_EXTERNAL_BLOCKERS",
        "23_FINAL_RELEASE_VERDICT.json",
        "23_FINAL_RELEASE_VERDICT.json must separate engineeringVerdict, liveWalmartProviderVerdict, kh02BusinessVerdict, historicalEvidenceVerdict, and deliveryVerdict, and must never report overallVerdict='PASS' or 'FULL_ACCEPTANCE' when live Walmart is BLOCKED_PROVIDER or historical 60d G15 is INSUFFICIENT_EVIDENCE."
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
  {
    mutationId: "M41",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Attempt vacuous non-inflation pass with comparedCandidatesCount = 0",
    expectedFailureCode: "VACUOUS_NON_INFLATION_AUDIT",
    mutate: (d) => {
      d.comparedCandidatesCount = 0;
      d.perCandidateDiffs = [];
      d.diffs = [];
      d.nonInflationVerified = true;
    },
  },
  {
    mutationId: "M42",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Compare mismatched candidate sets between Walmart OFF and Walmart ON",
    expectedFailureCode: "CANDIDATE_SET_MISMATCH_ON_OFF",
    mutate: (d) => {
      d.candidateSetMatch = false;
      if (Array.isArray(d.candidateIdsOn) && d.candidateIdsOn.length > 0) {
        d.candidateIdsOn[0] = "cand_tampered_different_id";
      }
    },
  },
  {
    mutationId: "M43",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Claim non-inflation pass when Walmart provider path was never exercised",
    expectedFailureCode: "WALMART_PROVIDER_PATH_NOT_EXERCISED",
    mutate: (d) => {
      d.providerPathExercised = false;
      d.walmartEvidenceRowsExercised = 0;
    },
  },
  {
    mutationId: "M44",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Hide per-candidate +5/-5 score drift behind net-zero aggregate scoreDelta",
    expectedFailureCode: "SCORE_OR_VERDICT_INFLATION_DETECTED",
    mutate: (d) => {
      d.scoreDeltaBetweenWalmartOnAndOff = 0;
      if (Array.isArray(d.perCandidateDiffs) && d.perCandidateDiffs.length >= 2) {
        d.perCandidateDiffs[0].scoreDelta = 5;
        d.perCandidateDiffs[1].scoreDelta = -5;
      }
    },
  },
  {
    mutationId: "M45",
    targetFile: "09_SCORE_AND_GATE_NON_INFLATION_AUDIT.json",
    description: "Promote G15 >=60d evergreen demand or G16 live merchant proof using Walmart listing",
    expectedFailureCode: "G15_OR_G16_PROMOTED_BY_WALMART",
    mutate: (d) => {
      d.g15PromotedCount = 1;
      if (Array.isArray(d.perCandidateDiffs) && d.perCandidateDiffs.length > 0) {
        d.perCandidateDiffs[0].g15StatusOff = "INSUFFICIENT_EVIDENCE";
        d.perCandidateDiffs[0].g15StatusOn = "PASS";
      }
    },
  },
  {
    mutationId: "M46",
    targetFile: "11_DEV_BACKTEST_SUMMARY.json",
    description: "Replace real DEV backtest replay output with constant status:PASS stub",
    expectedFailureCode: "CONSTANT_OR_UNEXECUTED_BACKTEST_SUMMARY",
    mutate: (d) => {
      d.backtestEngineExecuted = "FAIL";
      d.historicalObservationCount = 0;
      d.reconstructedCandidateCount = 0;
    },
  },
  {
    mutationId: "M47",
    targetFile: "13_POINT_IN_TIME_LEAK_AUDIT.json",
    description: "Mislabel synthetic 4-row unit anti-leakage check as full historical replay",
    expectedFailureCode: "SYNTHETIC_LEAK_TEST_MISLABELED_AS_FULL_BACKTEST",
    mutate: (d) => {
      if (d.syntheticAudit) {
        d.syntheticAudit.claimedAsFullHistoricalReplay = true;
      }
    },
  },
  {
    mutationId: "M48",
    targetFile: "23_FINAL_RELEASE_VERDICT.json",
    description: "Claim overallVerdict='PASS' while live Walmart is BLOCKED_PROVIDER and G15 is INSUFFICIENT_EVIDENCE",
    expectedFailureCode: "OVERALL_VERDICT_FALSE_PASS_WITH_EXTERNAL_BLOCKERS",
    mutate: (d) => {
      d.overallVerdict = "PASS";
    },
  },
  {
    mutationId: "M49",
    targetFile: "02_GATE_EXECUTION_LEDGER.json",
    description: "Drop a required gate from 02_GATE_EXECUTION_LEDGER.json while claiming complete=true",
    expectedFailureCode: "REQUIRED_WAVE_MISSING_OR_INCOMPLETE",
    mutate: (d) => {
      if (Array.isArray(d.gates) && d.gates.length > 0) {
        d.gates = d.gates.slice(0, d.gates.length - 1);
      }
    },
  },
  {
    mutationId: "M50",
    targetFile: "02_GATE_EXECUTION_LEDGER.json",
    description: "Mark a required wave executionStatus='FAIL' (exitCode=1) while keeping allRequiredWavesPassed=true",
    expectedFailureCode: "WAVE_FAILURE_CONTRADICTS_SUMMARY",
    mutate: (d) => {
      if (Array.isArray(d.gates) && d.gates.length > 0) {
        d.gates[0].executionStatus = "FAIL";
        d.gates[0].exitCode = 1;
      }
    },
  },
  {
    mutationId: "M51",
    targetFile: "02_GATE_EXECUTION_LEDGER.json",
    description: "Tamper with gate sourceSha so it mismatches 00_BRANCH_AND_BASELINE.json codeSha",
    expectedFailureCode: "GATE_LEDGER_SOURCE_SHA_MISMATCH",
    mutate: (d) => {
      if (Array.isArray(d.gates) && d.gates.length > 0) {
        d.gates[0].sourceSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      }
    },
  },
  {
    mutationId: "M52",
    targetFile: "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
    description: "Claim targeted-only 4-file suite as full repository regression",
    expectedFailureCode: "TARGETED_REGRESSION_CLAIMED_AS_FULL",
    mutate: (d) => {
      d.targetedOnly = true;
      d.executedTestFilesCount = 4;
    },
  },
  {
    mutationId: "M53",
    targetFile: "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
    description: "Introduce unresolved active regression failure while claiming PASS",
    expectedFailureCode: "ACTIVE_REGRESSION_FAILURE_UNRESOLVED",
    mutate: (d) => {
      d.requiredActiveSuiteFailedTestCases = 2;
      d.newRegressionTestCases = 2;
    },
  },
  {
    mutationId: "M54",
    targetFile: "06_DISK_RAM_OWNED_PROCESSES_AUDIT.json",
    description: "Report non-zero runner-owned orphaned process count after barrier",
    expectedFailureCode: "OWNED_ORPHAN_PROCESSES_DETECTED",
    mutate: (d) => {
      d.orphanedOwnedProcessesAfterRun = 1;
      d.orphanedOwnedPids = [999999];
    },
  },
  {
    mutationId: "M55",
    targetFile: "15_PERFORMANCE_BUDGET_AND_PROCESS_AUDIT.json",
    description: "Exceed raw 6 req/min rolling window rate cap (rawRequestsPerMinuteObserved = 9)",
    expectedFailureCode: "RAW_RATE_CAP_OVERRUN_DETECTED",
    mutate: (d) => {
      if (d.budgetCompliance) {
        d.budgetCompliance.rawRequestsPerMinuteObserved = 9;
        d.budgetCompliance.withinCapCompliance = false;
      }
    },
  },
  {
    mutationId: "M56",
    targetFile: "08_G15_60D_DEMAND_COVERAGE_BY_PRODUCT.json",
    description: "Claim G15 verdict='PASS' when qualifiedProductsCount < 3 (0/60 days covered)",
    expectedFailureCode: "G15_FALSE_PASS_WITHOUT_60D_HISTORY",
    mutate: (d) => {
      d.qualifiedProductsCount = 0;
      d.verdict = "PASS";
    },
  },
  {
    mutationId: "M57",
    targetFile: "09_G16_MERCHANT_LIVE_PROOF_BY_CANDIDATE.json",
    description: "Claim G16 verdict='PASS' when only 2/3 shortlisted candidates have live-verified merchants",
    expectedFailureCode: "G16_FALSE_PASS_WITHOUT_3_OF_3_LIVE_MERCHANTS",
    mutate: (d) => {
      d.verifiedLiveMerchantsCount = 2;
      d.verdict = "PASS";
    },
  },
  {
    mutationId: "M58",
    targetFile: "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json",
    description: "Claim Amazon Creators API liveVerdict='LIVE_VERIFIED' when configured=false",
    expectedFailureCode: "AMAZON_STATE_MISMATCH_FALSE_LIVE",
    mutate: (d) => {
      if (d.providers?.amazonUs) {
        d.providers.amazonUs.configured = false;
        d.providers.amazonUs.liveVerdict = "LIVE_VERIFIED";
      }
    },
  },
  {
    mutationId: "M59",
    targetFile: "07_LIVE_PROVIDER_DIAGNOSTICS_AMAZON_WALMART_G07.json",
    description: "Claim G07 TikTok US verdict='PASS' when TikTok provider is unconfigured",
    expectedFailureCode: "G07_STATE_MISMATCH_FALSE_PASS",
    mutate: (d) => {
      if (d.providers?.tiktokUsG07) {
        d.providers.tiktokUsG07.configured = false;
        d.providers.tiktokUsG07.verdict = "PASS";
      }
    },
  },
  {
    mutationId: "M60",
    targetFile: "08_UI_BROWSER_AND_RELOAD_PARITY.json",
    description: "Mislabel Wave D Chromium UI parity TEST_FIXTURE as live Walmart product confirmation",
    expectedFailureCode: "UI_FIXTURE_CLAIMED_AS_LIVE_WALMART",
    mutate: (d) => {
      d.evidenceOrigin = "REAL_JINA_READER";
      d.claimedAsLiveWalmartProductConfirmation = true;
    },
  },
  {
    mutationId: "M61",
    targetFile: "03_FULL_REGRESSION_INVENTORY_AND_RESULTS.json",
    description: "Re-enable legacy fail-exemption on the 8 pre-V12.4 unit test files (baselineKnownPolicySupersededTestCases = 17)",
    expectedFailureCode: "LEGACY_FAIL_EXEMPTION_REENABLED",
    mutate: (d) => {
      d.zeroLegacyFailExemptionEnforced = false;
      d.failedTestCases = 17;
      d.baselineKnownPolicySupersededTestCases = 17;
    },
  },
  {
    mutationId: "M62",
    targetFile: "06_ALL_12_E2E_EXECUTION_RECEIPTS.json",
    description: "Omit or skip one of the 12 required E2E specs without execution receipt",
    expectedFailureCode: "E2E_SPEC_SKIPPED_OR_UNCOUNTED",
    mutate: (d) => {
      d.skippedWithoutAttemptCount = 1;
      if (Array.isArray(d.receipts) && d.receipts.length > 0) {
        d.receipts = d.receipts.slice(0, 11);
      }
    },
  },
  {
    mutationId: "M63",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Inject cross-niche product ('Car Fender Panel Dent Edge Repair Tools') into Pet Gadgets HOLDOUT Top-3 shortlist",
    expectedFailureCode: "CROSS_NICHE_FALSE_POSITIVE_IN_TOP3",
    mutate: (d) => {
      d.crossNicheFalsePositivesInHoldoutTop3 = 1;
      if (Array.isArray(d.holdoutTop3) && d.holdoutTop3.length > 0) {
        d.holdoutTop3[0].title = "Car Fender Panel Dent Edge Repair Tools";
        d.holdoutTop3[0].nicheMatched = false;
        d.holdoutTop3[0].matchStatus = "MISMATCH";
      }
    },
  },
  {
    mutationId: "M64",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Pad < 3 niche-matched DEV shortlist with MISMATCH or UNCERTAIN candidates ('Auto Detailing Putty Gel')",
    expectedFailureCode: "SHORTLIST_PADDED_WITH_MISMATCH_OR_UNCERTAIN",
    mutate: (d) => {
      d.paddedWithMismatchOrUncertainCount = 2;
      d.devShortlistCount = 2;
      d.devNicheMatchedCount = 0;
    },
  },
  {
    mutationId: "M65",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Hardcode 'Pet Gadgets' so cross-niche input ('Kitchen Gadgets') is ignored",
    expectedFailureCode: "NICHE_PARAMETER_IGNORED_HARDCODED_PET_GADGETS",
    mutate: (d) => {
      if (d.crossNicheInputVerification) {
        d.crossNicheInputVerification.drivenByInputNiche = false;
        d.crossNicheInputVerification.kitchenGadgetsMatchedCount = 0;
      }
    },
  },
  {
    mutationId: "M66",
    targetFile: "19_FINAL_MULTI_VERDICT_SUMMARY.json",
    description: "Claim FINAL_RELEASE='FULL_ACCEPTANCE' in 9-verdict matrix while Walmart is BLOCKED_PROVIDER and G15 is INSUFFICIENT_EVIDENCE",
    expectedFailureCode: "FINAL_RELEASE_FALSE_FULL_ACCEPTANCE",
    mutate: (d) => {
      if (d.verdictMatrix) {
        d.verdictMatrix.FINAL_RELEASE = "FULL_ACCEPTANCE";
      }
      d.overallVerdict = "FULL_ACCEPTANCE";
    },
  },
  {
    mutationId: "M67",
    targetFile: "11_DEV_BACKTEST_SUMMARY.json",
    description: "Allow post-cutoff joined ResearchProduct metadata to leak into point-in-time DEV replay",
    expectedFailureCode: "POST_CUTOFF_JOINED_METADATA_OR_NICHE_LEAK",
    mutate: (d) => {
      if (!d.joinedMetadataLeakageAudit) d.joinedMetadataLeakageAudit = {};
      d.joinedMetadataLeakageAudit.leakagePrevented = false;
    },
  },
  {
    mutationId: "M68",
    targetFile: "06_ALL_12_E2E_EXECUTION_RECEIPTS.json",
    description: "Alter sourceSha in an E2E execution receipt so it drifts from TESTED_SOURCE_SHA",
    expectedFailureCode: "TESTED_SHA_DRIFT_IN_E2E_RECEIPTS",
    mutate: (d) => {
      d.sourceSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    },
  },
  {
    mutationId: "M69",
    targetFile: "17_DISK_RAM_OWNED_PROCESS_LEDGER.json",
    description: "Report orphanedOwnedProcessesAfterRun > 0 in bounded async DAG ledger",
    expectedFailureCode: "ORPHANED_PROCESSES_IN_BOUNDED_DAG",
    mutate: (d) => {
      d.orphanedOwnedProcessesAfterRun = 2;
      d.orphanedOwnedPids = [888881, 888882];
    },
  },
  {
    mutationId: "M70",
    targetFile: "03_LEGACY_17_ASSERTION_COMPARISON.json",
    description: "Omit baseline failing assertions from 17-assertion differential proof",
    expectedFailureCode: "BASELINE_DIFF_PROOF_MISSING_17_ASSERTIONS",
    mutate: (d) => {
      d.qaBaselineFailedCount = 12;
      d.all17RepairedAndPassing = false;
    },
  },
  {
    mutationId: "M71",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Conflate historical stored snapshot G16 evaluation (2/3) with current live run verification",
    expectedFailureCode: "HISTORICAL_SNAPSHOT_CONFLATED_WITH_CURRENT_LIVE_G16",
    mutate: (d) => {
      d.claimedAsCurrentLiveRunVerification = true;
      d.snapshotFreshness = "CURRENT_LIVE_RUN";
    },
  },
  {
    mutationId: "M72",
    targetFile: "11_DEV_BACKTEST_SUMMARY.json",
    description: "Mislabel DEV window with 0 niche-matched products as SUFFICIENT_NICHE_COVERAGE",
    expectedFailureCode: "DEV_INSUFFICIENT_NICHE_COVERAGE_MISLABELED_SUFFICIENT",
    mutate: (d) => {
      d.shortlistCount = 0;
      d.nicheCoverageStatus = "SUFFICIENT_NICHE_COVERAGE";
    },
  },
  {
    mutationId: "M73",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Promote URL-path-only (/products/<slug>) ad-only candidate to identityStatus='VERIFIED' without independent merchant proof",
    expectedFailureCode: "HISTORICAL_IDENTITY_URL_PATH_ONLY_PROMOTED_TO_VERIFIED",
    mutate: (d) => {
      d.urlPathOnlyPromotedToVerifiedCount = 1;
      if (Array.isArray(d.holdoutTop3) && d.holdoutTop3.length > 0) {
        d.holdoutTop3[0].identityStatus = "VERIFIED";
        d.holdoutTop3[0].verificationEvidenceStatus =
          "AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF";
        d.holdoutTop3[0].independentMerchantProofRefs = [];
      }
    },
  },
  {
    mutationId: "M74",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Promote CheckoutChamp funnel cc.uprootclean.com/main/phr to identityStatus='VERIFIED'",
    expectedFailureCode: "CHECKOUT_CHAMP_FUNNEL_PROMOTED_TO_VERIFIED",
    mutate: (d) => {
      d.funnelPromotedToVerifiedCount = 1;
      if (Array.isArray(d.holdoutTop3) && d.holdoutTop3.length > 0) {
        d.holdoutTop3[0].storeDomain = "cc.uprootclean.com";
        d.holdoutTop3[0].canonicalProductUrl =
          "https://cc.uprootclean.com/main/phr";
        d.holdoutTop3[0].isCheckoutChampFunnel = true;
        d.holdoutTop3[0].identityStatus = "VERIFIED";
      }
    },
  },
  {
    mutationId: "M75",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Mislabel HOLDOUT shortlist with 0 verified identities as SUFFICIENT_VERIFIED_IDENTITY",
    expectedFailureCode: "HISTORICAL_IDENTITY_COVERAGE_MISLABELED_SUFFICIENT",
    mutate: (d) => {
      d.holdoutVerifiedIdentityCount = 0;
      d.holdoutIdentityCoverageStatus = "SUFFICIENT_VERIFIED_IDENTITY";
    },
  },
  {
    mutationId: "M76",
    targetFile: "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json",
    description: "Label discovery-only candidate reason as 'Verified Pet Gadgets product' or copy discovery_ad: ref into independentMerchantProofRefs",
    expectedFailureCode: "DISCOVERY_CANDIDATE_MISLABELED_AS_VERIFIED_IN_REASON_OR_REFS",
    mutate: (d) => {
      d.discoveryRefsCopiedToIndependentProofCount = 1;
      if (Array.isArray(d.holdoutTop3) && d.holdoutTop3.length > 0) {
        d.holdoutTop3[0].identityStatus = "PROBABLE";
        d.holdoutTop3[0].reason =
          "Verified 'Pet Gadgets' product with 12 historical ad observations";
        d.holdoutTop3[0].independentMerchantProofRefs = [
          "discovery_ad:ad_1021",
        ];
      }
    },
  },
  {
    mutationId: "M77",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Re-enable synthetic runtime G16 hydration (obs_<runId>_<candId>, req_<runId>, or jsonld:<domain>)",
    expectedFailureCode: "SYNTHETIC_G16_HYDRATION_OR_FABRICATED_OBSERVATION_USED",
    mutate: (d) => {
      d.g16SyntheticHydrationUsed = true;
      d.fabricatedHydrationObservationsUsedCount = 2;
      d.syntheticJsonldProofRefsUsedCount = 2;
    },
  },
  {
    mutationId: "M78",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Claim verifiedLiveMerchantsCount=2 (PARTIAL_2_OF_3) when verifiedFromPersistedEvidenceCount=0",
    expectedFailureCode: "UNRECONSTRUCTABLE_SNAPSHOT_G16_CLAIMED_AS_PERSISTED_VERIFIED",
    mutate: (d) => {
      d.previousSnapshotClaimedVerifiedCount = 2;
      d.verifiedFromPersistedEvidenceCount = 0;
      d.verifiedLiveMerchantsCount = 2;
      d.verdict = "PARTIAL_2_OF_3";
    },
  },
  {
    mutationId: "M79",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Accept cross-workspace LandingPageSnapshot as persisted G16 merchant proof",
    expectedFailureCode: "CROSS_WORKSPACE_MERCHANT_PROOF_ACCEPTED_IN_G16",
    mutate: (d) => {
      d.crossWorkspaceProofsAcceptedCount = 1;
    },
  },
  {
    mutationId: "M80",
    targetFile: "19_FINAL_MULTI_VERDICT_SUMMARY.json",
    description: "Claim HISTORICAL_VERIFIED_IDENTITY_COVERAGE='SUFFICIENT_VERIFIED_IDENTITY' when holdoutVerifiedIdentityCount=0",
    expectedFailureCode: "HISTORICAL_IDENTITY_TRUTH_VERDICT_FALSE_PASS",
    mutate: (d) => {
      if (!d.historicalIdentitySummary) d.historicalIdentitySummary = {};
      d.historicalIdentitySummary.holdoutVerifiedIdentityCount = 0;
      if (!d.verdictMatrix) d.verdictMatrix = {};
      d.verdictMatrix.HISTORICAL_PRODUCT_IDENTITY_TRUTH = "PASS";
      d.verdictMatrix.HISTORICAL_VERIFIED_IDENTITY_COVERAGE =
        "SUFFICIENT_VERIFIED_IDENTITY";
    },
  },
  {
    mutationId: "M81",
    targetFile: "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json",
    description: "Reintroduce imaginary Prisma column accesses (lp.productTitle, lp.canonicalUrl, lp.capturedAt, prod.workspaceId)",
    expectedFailureCode: "IMAGINARY_PRISMA_COLUMNS_USED",
    mutate: (d) => {
      d.imaginaryColumnsRemoved = false;
      d.imaginaryColumnsUsedCount = 4;
    },
  },
  {
    mutationId: "M82",
    targetFile: "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
    description: "Promote LandingPageSnapshot with pageTitle/url/contentHash only (no parseable Product JSON-LD in rawExcerpt) to VERIFIED",
    expectedFailureCode: "HASH_OR_TITLE_ONLY_SNAPSHOT_PROMOTED_TO_JSONLD",
    mutate: (d) => {
      d.hashOrTitleOnlyPromotedCount = 1;
    },
  },
  {
    mutationId: "M83",
    targetFile: "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
    description: "Allow bare caller-supplied boolean flags (schemaVerified:true, hasJsonLdProduct:true) without raw source + SHA-256",
    expectedFailureCode: "BARE_BOOLEAN_SCHEMA_BYPASS_ALLOWED",
    mutate: (d) => {
      d.bareBooleanBypassRejected = false;
    },
  },
  {
    mutationId: "M84",
    targetFile: "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json",
    description: "Rebrand unverified persisted AdObservation + DiscoveryRunAd rows as provenance='LIVE_PROVIDER'",
    expectedFailureCode: "UNVERIFIED_DB_OBSERVATION_REBRANDED_AS_LIVE_PROVIDER",
    mutate: (d) => {
      d.unverifiedObservationsRebrandedAsLiveCount = 2;
    },
  },
  {
    mutationId: "M85",
    targetFile: "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json",
    description: "Accept DiscoveryRunAd.ingestOutcome=EXISTING or DETERMINISTIC_FALLBACK as live G16 observation",
    expectedFailureCode: "NON_LIVE_INGEST_OR_FALLBACK_ACCEPTED_IN_G16",
    mutate: (d) => {
      d.existingIngestOutcomeAcceptedAsLiveCount = 1;
      d.deterministicFallbackAcceptedAsLiveCount = 1;
    },
  },
  {
    mutationId: "M86",
    targetFile: "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json",
    description: "Drop a case from the 39-case G16 schema and origin matrix (M01..M17, L01..L16, P01..P06)",
    expectedFailureCode: "G16_SCHEMA_ORIGIN_MATRIX_INCOMPLETE_OR_FAILED",
    mutate: (d) => {
      d.passedMatrixCases = 38;
      d.failedMatrixCases = 1;
      d.passed = false;
    },
  },
  {
    mutationId: "M87",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Claim verifiedFromPersistedEvidenceCount=2 when candidates have 0 live observations and non-zero unverifiedPersistedOriginCount",
    expectedFailureCode: "G16_PERSISTED_ORIGIN_CONTRADICTION",
    mutate: (d) => {
      d.verifiedFromPersistedEvidenceCount = 2;
      d.unverifiedLiveOriginObservationsCount = 0;
      d.candidates = [
        {
          candidateId: "cand_1",
          liveObservationsCount: 0,
          unverifiedPersistedOriginCount: 1,
        },
      ];
    },
  },
  {
    mutationId: "M88",
    targetFile: "19_FINAL_MULTI_VERDICT_SUMMARY.json",
    description: "Mark PERSISTED_SCHEMA_TRUTH_ENFORCEMENT or LIVE_OBSERVATION_ORIGIN_ENFORCEMENT as FAIL in verdictMatrix",
    expectedFailureCode: "SCHEMA_OR_ORIGIN_ENFORCEMENT_VERDICT_FAILED",
    mutate: (d) => {
      if (!d.verdictMatrix) d.verdictMatrix = {};
      d.verdictMatrix.PERSISTED_SCHEMA_TRUTH_ENFORCEMENT = "FAIL";
    },
  },
  {
    mutationId: "M89",
    targetFile: "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
    description: "Misclassify non-fixture LandingPageSnapshot row with commercial semantic contentHash as RAW_SOURCE_HASH_TAMPERED",
    expectedFailureCode: "LANDING_SNAPSHOT_SEMANTIC_HASH_MISCLASSIFIED_AS_RAW_TAMPERED",
    mutate: (d) => {
      d.rawSourceHashTamperedNonFixtureCount = 3;
      d.semanticContentHashNotRawProofCount = 0;
    },
  },
  {
    mutationId: "M90",
    targetFile: "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json",
    description: "Accept commercial semantic digest (COMMERCIAL_SEMANTIC_DIGEST_SHA256) as raw product schema proof",
    expectedFailureCode: "SEMANTIC_DIGEST_ACCEPTED_AS_RAW_SCHEMA_PROOF",
    mutate: (d) => {
      d.semanticDigestAcceptedAsRawProofCount = 1;
    },
  },
  {
    mutationId: "M91",
    targetFile: "04_raw_product_schema_capture_to_readback_proof.json",
    description: "Break raw Product JSON-LD capture-to-readback E2E proof or hash domain separation",
    expectedFailureCode: "RAW_PRODUCT_SCHEMA_CAPTURE_READBACK_FAILED",
    mutate: (d) => {
      d.captureToReadbackVerified = false;
      d.hashDomainSeparated = false;
    },
  },
  {
    mutationId: "M92",
    targetFile: "04_raw_product_schema_capture_to_readback_proof.json",
    description: "Accept oversize (>32KB) or mid-JSON truncated schema payload as valid product proof",
    expectedFailureCode: "OVERSIZE_OR_TRUNCATED_SCHEMA_PAYLOAD_ACCEPTED",
    mutate: (d) => {
      d.oversizePayloadRejected = false;
      d.oversizeOrTruncatedAcceptedCount = 1;
    },
  },
  {
    mutationId: "M93",
    targetFile: "07_g16_dynamic_diagnostic_reason_matrix.json",
    description: "Hardcoded G16 diagnostic reason contradicts actual candidate counts or builder output",
    expectedFailureCode: "G16_DIAGNOSTIC_REASON_CONTRADICTS_CANDIDATE_COUNTS",
    mutate: (d) => {
      d.liveG16ReasonMatchesBuilder = false;
      d.hardcodedReasonContradictionCount = 1;
    },
  },
  {
    mutationId: "M94",
    targetFile: "07_g16_dynamic_diagnostic_reason_matrix.json",
    description: "G16 diagnostic reason falsely claims CheckoutChamp funnel when isCheckoutChampFunnel=false across all candidates",
    expectedFailureCode: "G16_DIAGNOSTIC_REASON_FALSE_FUNNEL_CLAIM",
    mutate: (d) => {
      d.nonFunnelPermutationFreeOfFalseFunnelClaim = false;
      d.falseFunnelClaimCount = 1;
    },
  },
  {
    mutationId: "M95",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Set candidate productSchemaProofStatus='VERIFIED' without persistedProofRowIds",
    expectedFailureCode: "G16_CANDIDATE_SCHEMA_STATUS_WITHOUT_PROOF_ROW",
    mutate: (d) => {
      d.candidates = [
        {
          candidateId: "cand_schema_fake",
          productSchemaProofStatus: "VERIFIED",
          persistedProofRowIds: [],
          originProofStatus: "UNVERIFIED",
          authenticLiveObservationIds: [],
          liveObservationsCount: 0,
          unverifiedPersistedOriginCount: 0,
        },
      ];
    },
  },
  {
    mutationId: "M96",
    targetFile: "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json",
    description: "Set candidate originProofStatus='VERIFIED' without authenticLiveObservationIds",
    expectedFailureCode: "G16_CANDIDATE_ORIGIN_STATUS_WITHOUT_LIVE_OBSERVATION",
    mutate: (d) => {
      d.candidates = [
        {
          candidateId: "cand_origin_fake",
          productSchemaProofStatus: "UNVERIFIED",
          persistedProofRowIds: [],
          originProofStatus: "VERIFIED",
          authenticLiveObservationIds: [],
          liveObservationsCount: 0,
          unverifiedPersistedOriginCount: 0,
        },
      ];
    },
  },
];

/**
 * Copies `baseArtifactDir` to an isolated temporary directory on disk, executes all 48 physical-file
 * mutations (`M01..M48`) by writing the mutated file to disk and running `validateWalmartAcceptanceArtifacts`,
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
          JSON.stringify(
            {
              engineeringVerdict: "PASS",
              liveWalmartProviderVerdict: "BLOCKED_PROVIDER",
              liveAmazonProviderVerdict: "CREDENTIALS_REQUIRED",
              kh02BusinessVerdict: "INSUFFICIENT_EVIDENCE",
              historicalEvidenceVerdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
              historicalG07Verdict: "BLOCKED",
              historicalG15Verdict: "INSUFFICIENT_EVIDENCE",
              historicalG16Verdict: "PARTIAL_2_OF_3",
              deliveryVerdict: "READY_FOR_REVIEW",
              overallVerdict: "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS",
            },
            null,
            2
          )
        );
      }

      let codeShaFallback = "0000000000000000000000000000000000000000";
      try {
        const a00Raw = JSON.parse(
          fs.readFileSync(path.join(tempRoot, "00_BRANCH_AND_BASELINE.json"), "utf8")
        );
        codeShaFallback = String(a00Raw.codeSha || codeShaFallback);
      } catch {}

      if (!fs.existsSync(path.join(tempRoot, "03_LEGACY_17_ASSERTION_COMPARISON.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "03_LEGACY_17_ASSERTION_COMPARISON.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              qaBaselineSha: "fbe51a06ab8354c886d0415a9599f977c83caabc",
              qaBaselineFailedCount: 17,
              currentHeadFailedCount: 0,
              all17RepairedAndPassing: true,
              assertions: Array.from({ length: 17 }, (_, i) => ({
                index: i + 1,
                qaStatus: "failed",
                headStatus: "passed",
              })),
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "06_ALL_12_E2E_EXECUTION_RECEIPTS.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "06_ALL_12_E2E_EXECUTION_RECEIPTS.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              totalSpecs: 12,
              skippedWithoutAttemptCount: 0,
              failedSpecsCount: 0,
              receipts: Array.from({ length: 12 }, (_, i) => ({
                specIndex: i + 1,
                sourceSha: codeShaFallback,
                classification: "PASS",
                exitCode: 0,
              })),
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "11_NICHE_RELEVANCE_CANDIDATE_FUNNEL_AND_TOP3.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              niche: "Pet Gadgets",
              devShortlistCount: 0,
              devNicheMatchedCount: 0,
              devVerifiedIdentityCount: 0,
              devIdentityCoverageStatus: "INSUFFICIENT_VERIFIED_IDENTITY",
              holdoutShortlistCount: 3,
              holdoutNicheMatchedCount: 3,
              holdoutVerifiedIdentityCount: 0,
              holdoutFunnelProbableCount: 1,
              holdoutIdentityCoverageStatus: "INSUFFICIENT_VERIFIED_IDENTITY",
              urlPathOnlyPromotedToVerifiedCount: 0,
              funnelPromotedToVerifiedCount: 0,
              discoveryRefsCopiedToIndependentProofCount: 0,
              paddedWithMismatchOrUncertainCount: 0,
              crossNicheFalsePositivesInDevTop3: 0,
              crossNicheFalsePositivesInHoldoutTop3: 0,
              devTop3: [],
              holdoutTop3: [
                { candidateId: "c1", title: "The #1 Pet Hair/Lint/Dust Cleaner", nicheMatched: true, matchStatus: "MATCH", identityStatus: "PROBABLE", verificationEvidenceStatus: "FUNNEL_UNVERIFIED", isCheckoutChampFunnel: true, independentMerchantProofRefs: [] },
                { candidateId: "c2", title: "Automatic Dog Feeder for Easy Daily Meals", nicheMatched: true, matchStatus: "MATCH", identityStatus: "PROBABLE", verificationEvidenceStatus: "AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF", isCheckoutChampFunnel: false, independentMerchantProofRefs: [] },
                { candidateId: "c3", title: "The #1 Vet-Recommended Cat Fountain", nicheMatched: true, matchStatus: "MATCH", identityStatus: "PROBABLE", verificationEvidenceStatus: "AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF", isCheckoutChampFunnel: false, independentMerchantProofRefs: [] },
              ],
              crossNicheInputVerification: {
                drivenByInputNiche: true,
                kitchenGadgetsMatchedCount: 2,
                kitchenGadgetsRejectedPetCount: 2,
              },
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "15_G16_TOP3_MERCHANT_PROOF_BY_CANDIDATE.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              snapshotFreshness: "HISTORICAL_SNAPSHOT_RE_EVALUATED",
              reconstructionStatus: "HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE",
              claimedAsCurrentLiveRunVerification: false,
              g16SyntheticHydrationUsed: false,
              fabricatedHydrationObservationsUsedCount: 0,
              syntheticJsonldProofRefsUsedCount: 0,
              crossWorkspaceProofsAcceptedCount: 0,
              previousSnapshotClaimedVerifiedCount: 2,
              verifiedFromPersistedEvidenceCount: 0,
              newLiveVerifiedDuringThisRun: 0,
              verifiedLiveMerchantsCount: 0,
              verdict: "INSUFFICIENT_EVIDENCE",
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "17_DISK_RAM_OWNED_PROCESS_LEDGER.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "17_DISK_RAM_OWNED_PROCESS_LEDGER.json"),
          JSON.stringify(
            {
              codeSha: codeShaFallback,
              orphanedOwnedProcessesAfterRun: 0,
              orphanedOwnedPids: [],
              observedPeakConcurrentHeavy: 2,
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "19_FINAL_MULTI_VERDICT_SUMMARY.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "19_FINAL_MULTI_VERDICT_SUMMARY.json"),
          JSON.stringify(
            {
              codeSha: codeShaFallback,
              engineeringVerdict: "PASS",
              historicalProductIdentityTruthVerdict: "PASS",
              liveWalmartProviderVerdict: "BLOCKED_PROVIDER",
              liveAmazonProviderVerdict: "CREDENTIALS_REQUIRED",
              kh02BusinessVerdict: "INSUFFICIENT_EVIDENCE",
              historicalG15Verdict: "INSUFFICIENT_EVIDENCE",
              overallVerdict: "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS",
              historicalIdentitySummary: {
                holdoutVerifiedIdentityCount: 0,
                holdoutIdentityCoverageStatus: "INSUFFICIENT_VERIFIED_IDENTITY",
              },
              verdictMatrix: {
                ENGINEERING_TESTS: "PASS",
                BROAD_REGRESSION: "PASS",
                REQUIRED_E2E_COVERAGE: "PASS",
                HISTORICAL_REPLAY_INTEGRITY: "PASS",
                NICHE_RELEVANCE: "PASS",
                HISTORICAL_PRODUCT_IDENTITY_TRUTH: "PASS",
                HISTORICAL_VERIFIED_IDENTITY_COVERAGE: "INSUFFICIENT_VERIFIED_IDENTITY",
                LIVE_PROVIDERS: {
                  WALMART_US: "BLOCKED_PROVIDER",
                  AMAZON_US: "CREDENTIALS_REQUIRED",
                  TIKTOK_US_G07: "BLOCKED",
                },
                HISTORICAL_DEMAND_G15: "INSUFFICIENT_EVIDENCE",
                MERCHANT_TOP3_G16: "INSUFFICIENT_EVIDENCE",
                PERSISTED_PRODUCT_SCHEMA_PROOF: "INSUFFICIENT_EVIDENCE",
                PERSISTED_LIVE_ORIGIN_PROOF: "INSUFFICIENT_EVIDENCE",
                PERSISTED_SCHEMA_TRUTH_ENFORCEMENT: "PASS",
                LIVE_OBSERVATION_ORIGIN_ENFORCEMENT: "PASS",
                FINAL_RELEASE: "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS",
              },
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "02_PRISMA_FIELD_CONTRACT_AND_REAL_SOURCE_MAP.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              imaginaryColumnsRemoved: true,
              imaginaryColumnsUsedCount: 0,
              removedImaginaryFieldAccesses: [
                "ev.evidenceType",
                "lp.productTitle",
                "lp.canonicalUrl",
                "lp.capturedAt",
                "os.offerUrl",
                "os.priceText",
                "os.priceAmount",
                "os.capturedAt",
                "prod.workspaceId",
                "prod.storeDomain",
              ],
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "03_LANDING_SNAPSHOT_REAL_PRODUCT_SCHEMA_PROOF_AUDIT.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              hashOrTitleOnlyPromotedCount: 0,
              bareBooleanBypassRejected: true,
              rawSourceHashTamperedNonFixtureCount: 0,
              semanticContentHashNotRawProofCount: 3,
              semanticDigestAcceptedAsRawProofCount: 0,
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "04_raw_product_schema_capture_to_readback_proof.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "04_raw_product_schema_capture_to_readback_proof.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              captureToReadbackVerified: true,
              hashDomainSeparated: true,
              persistedProofValidationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
              landingSnapshotSemanticStatus: "SEMANTIC_CONTENT_HASH_NOT_RAW_PROOF",
              oversizePayloadRejected: true,
              midJsonTruncatedPayloadRejected: true,
              oversizeOrTruncatedAcceptedCount: 0,
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "07_g16_dynamic_diagnostic_reason_matrix.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "07_g16_dynamic_diagnostic_reason_matrix.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              allPermutationsPassed: true,
              liveG16ReasonMatchesBuilder: true,
              hardcodedReasonContradictionCount: 0,
              nonFunnelPermutationFreeOfFalseFunnelClaim: true,
              falseFunnelClaimCount: 0,
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "04_G16_IMMUTABLE_ORIGIN_OBSERVATION_PROVENANCE.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              unverifiedObservationsRebrandedAsLiveCount: 0,
              existingIngestOutcomeAcceptedAsLiveCount: 0,
              updatedIngestOutcomeWithoutFreshEnvelopeAcceptedCount: 0,
              manualOrUserObservedAcceptedAsLiveCount: 0,
              deterministicFallbackAcceptedAsLiveCount: 0,
            },
            null,
            2
          )
        );
      }

      if (!fs.existsSync(path.join(tempRoot, "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json"))) {
        fs.writeFileSync(
          path.join(tempRoot, "06_G16_NEGATIVE_AND_POSITIVE_TEST_RECEIPTS.json"),
          JSON.stringify(
            {
              sourceSha: codeShaFallback,
              passed: true,
              totalMatrixCases: 39,
              passedMatrixCases: 39,
              failedMatrixCases: 0,
              merchantSchemaNegativeCount: 17,
              liveOriginNegativeCount: 16,
              positiveContractCount: 6,
              cases: Array.from({ length: 39 }, (_, i) => ({
                caseId: `C${i + 1}`,
                passed: true,
              })),
            },
            null,
            2
          )
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

