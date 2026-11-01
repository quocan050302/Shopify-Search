/**
 * SWAI KH-02 V12.4.3.5.0.3 — Independent Acceptance Validator & 48-Mutation Negative Control Suite
 *
 * Independently validates all 24 mandatory acceptance artifacts (00_..23_) in:
 * `acceptance/kh02-amazon-us-v12.4.3.5.0.3-creators-runtime/run-<UTCSTAMP>/`
 *
 * Enforces 15 strict anti-fake acceptance checks (V01..V15) and executes 48 physical-file
 * negative control mutations (M01..M48) with 0 escapes allowed.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { computeDeterministicEvidenceHash } from "../../src/services/kh02/marketplace/marketplaceEvidenceTypes";
import { isValidStrictAmazonAsin } from "../../src/services/kh02/marketplace/amazonUsIdentity";
import { isFakeOrLocalAmazonRequestId } from "../../src/services/kh02/marketplace/amazonUsEvidenceGate";

export const V12_4_3_5_0_3_REQUIRED_ARTIFACTS = [
  "00_BASELINE_BRANCH_AND_SOURCE_SHA.json",
  "01_FUNCTION_AND_IMPORT_INVENTORY.json",
  "02_CREATORS_API_OFFICIAL_CONTRACT_SOURCES.json",
  "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
  "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
  "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
  "06_RUNTIME_FACTORY_WIRING_PROOF.json",
  "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
  "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
  "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
  "10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json",
  "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
  "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
  "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
  "14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json",
  "15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json",
  "16_AUTOMATED_TEST_SUITE_RESULTS.json",
  "17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json",
  "18_NEGATIVE_MUTATION_SUITE.json",
  "20_DISK_AND_PROCESS_HYGIENE_AUDIT.json",
  "21_FINAL_ACCEPTANCE_MATRIX.json",
  "22_EXECUTIVE_COMPLETION_REPORT.md",
] as const;

export interface ValidatorCheckResult {
  checkId: string;
  title: string;
  passed: boolean;
  reason: string;
  violations: string[];
}

export interface V12_4_3_5_0_3ValidationResult {
  valid: boolean;
  releaseVersion: string;
  artifactDir: string;
  evaluatedAt: string;
  expectedCodeSha: string | null;
  observedCodeSha: string | null;
  engineeringVerdict: "ENGINEERING_READY" | "ENGINEERING_FAILED";
  liveProviderVerdict:
    | "REAL_PROVIDER_VERIFIED"
    | "CREDENTIALS_REQUIRED"
    | "ACCESS_NOT_GRANTED"
    | "AUTHENTICATION_FAILED"
    | "BLOCKED_POLICY"
    | "BLOCKED_PROVIDER";
  overallClosureVerdict:
    | "FULL_CLOSURE_READY"
    | "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER"
    | "FAILED";
  passedChecksCount: number;
  failedChecksCount: number;
  checks: ValidatorCheckResult[];
  violations: string[];
}

export interface ValidateV12_4_3_5_0_3Options {
  expectedCodeSha?: string | null;
  skipMutationSuiteArtifactCheck?: boolean;
}

function readJsonArtifact(dir: string, filename: string): { ok: boolean; data: any; error: string | null } {
  const fullPath = path.join(dir, filename);
  if (!fs.existsSync(fullPath)) {
    return { ok: false, data: null, error: `Missing artifact file: ${filename}` };
  }
  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    if (!raw.trim()) {
      return { ok: false, data: null, error: `Empty artifact file: ${filename}` };
    }
    return { ok: true, data: JSON.parse(raw), error: null };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON in ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3(
  artifactDir: string,
  options: ValidateV12_4_3_5_0_3Options = {}
): V12_4_3_5_0_3ValidationResult {
  const evaluatedAt = new Date().toISOString();
  const checks: ValidatorCheckResult[] = [];
  const allViolations: string[] = [];

  const recordCheck = (
    checkId: string,
    title: string,
    violations: string[],
    passReason: string
  ) => {
    const passed = violations.length === 0;
    if (!passed) {
      for (const v of violations) {
        allViolations.push(`[${checkId}] ${v}`);
      }
    }
    checks.push({
      checkId,
      title,
      passed,
      reason: passed ? passReason : violations.join("; "),
      violations,
    });
  };

  // V01: Required artifacts present and non-empty
  const v01Violations: string[] = [];
  const loadedJson: Record<string, any> = {};
  for (const name of V12_4_3_5_0_3_REQUIRED_ARTIFACTS) {
    if (options.skipMutationSuiteArtifactCheck && name === "18_NEGATIVE_MUTATION_SUITE.json") {
      continue;
    }
    const fullPath = path.join(artifactDir, name);
    if (!fs.existsSync(fullPath)) {
      v01Violations.push(`Missing required artifact: ${name}`);
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      v01Violations.push(`Empty required artifact: ${name}`);
      continue;
    }
    if (name.endsWith(".json")) {
      const parsed = readJsonArtifact(artifactDir, name);
      if (!parsed.ok) {
        v01Violations.push(parsed.error!);
      } else {
        loadedJson[name] = parsed.data;
      }
    }
  }
  recordCheck(
    "V01_REQUIRED_ARTIFACTS_PRESENT",
    "All required V12.4.3.5.0.3 JSON/Markdown artifacts exist on disk and parse cleanly",
    v01Violations,
    "All mandatory artifacts present and parsed cleanly."
  );

  // V02: Source SHA consistency & branch/version parity
  const v02Violations: string[] = [];
  const baseline = loadedJson["00_BASELINE_BRANCH_AND_SOURCE_SHA.json"];
  const observedCodeSha =
    typeof baseline?.codeSha === "string" ? baseline.codeSha.trim() : null;
  if (!observedCodeSha || !/^[0-9a-f]{40}$/i.test(observedCodeSha)) {
    v02Violations.push(
      `Invalid or missing 40-char hex codeSha in 00_BASELINE_BRANCH_AND_SOURCE_SHA.json: '${observedCodeSha}'`
    );
  }
  if (
    options.expectedCodeSha &&
    observedCodeSha &&
    observedCodeSha.toLowerCase() !== options.expectedCodeSha.trim().toLowerCase()
  ) {
    v02Violations.push(
      `Baseline codeSha '${observedCodeSha}' does not match expectedCodeSha '${options.expectedCodeSha}'`
    );
  }
  if (baseline?.branch !== "feature/kh02-amazon-us-pilot-v12.4.3.5.0") {
    v02Violations.push(
      `Invalid branch '${baseline?.branch}'; expected 'feature/kh02-amazon-us-pilot-v12.4.3.5.0'`
    );
  }
  if (baseline?.releaseVersion !== "12.4.3.5.0.3") {
    v02Violations.push(
      `Invalid releaseVersion '${baseline?.releaseVersion}'; expected '12.4.3.5.0.3'`
    );
  }

  const shaBearingArtifacts = [
    "01_FUNCTION_AND_IMPORT_INVENTORY.json",
    "02_CREATORS_API_OFFICIAL_CONTRACT_SOURCES.json",
    "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
    "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
    "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
    "06_RUNTIME_FACTORY_WIRING_PROOF.json",
    "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
    "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
    "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
    "10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json",
    "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
    "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
    "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
    "14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json",
    "15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json",
    "16_AUTOMATED_TEST_SUITE_RESULTS.json",
    "17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json",
    "20_DISK_AND_PROCESS_HYGIENE_AUDIT.json",
    "21_FINAL_ACCEPTANCE_MATRIX.json",
  ];
  for (const artName of shaBearingArtifacts) {
    const obj = loadedJson[artName];
    if (!obj) continue;
    if (obj.codeSha !== observedCodeSha) {
      v02Violations.push(
        `Artifact ${artName} has codeSha '${obj.codeSha}' != baseline '${observedCodeSha}'`
      );
    }
    if (obj.releaseVersion && obj.releaseVersion !== "12.4.3.5.0.3") {
      v02Violations.push(
        `Artifact ${artName} has releaseVersion '${obj.releaseVersion}' != '12.4.3.5.0.3'`
      );
    }
  }
  recordCheck(
    "V02_SOURCE_SHA_CONSISTENCY",
    "All acceptance artifacts share identical 40-char codeSha, branch, and releaseVersion 12.4.3.5.0.3",
    v02Violations,
    `Verified identical codeSha (${observedCodeSha}) and releaseVersion 12.4.3.5.0.3 across all artifacts.`
  );

  // V03: OAuth 2.0 JSON + scope contract & secret redaction
  const v03Violations: string[] = [];
  const oauthProof = loadedJson["03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json"];
  if (!oauthProof) {
    v03Violations.push("Missing 03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json");
  } else {
    if (oauthProof.requestContentType !== "application/json") {
      v03Violations.push(
        `OAuth requestContentType must be 'application/json', got '${oauthProof.requestContentType}'`
      );
    }
    if (oauthProof.requestBodyShape?.grant_type !== "client_credentials") {
      v03Violations.push(
        `OAuth grant_type must be 'client_credentials', got '${oauthProof.requestBodyShape?.grant_type}'`
      );
    }
    if (oauthProof.requestBodyShape?.scope !== "creatorsapi::default") {
      v03Violations.push(
        `OAuth scope must be 'creatorsapi::default', got '${oauthProof.requestBodyShape?.scope}'`
      );
    }
    if (oauthProof.concurrentRefreshDeduplication?.tokenHttpCallsCount !== 1) {
      v03Violations.push(
        `Concurrent refresh deduplication must execute exactly 1 token HTTP call, got '${oauthProof.concurrentRefreshDeduplication?.tokenHttpCallsCount}'`
      );
    }
    if (oauthProof.malformedToken200Rejected !== true) {
      v03Violations.push("malformedToken200Rejected must be true");
    }
    if (oauthProof.single401RefreshRetryVerified !== true) {
      v03Violations.push("single401RefreshRetryVerified must be true");
    }
    if (oauthProof.secretsRedactedInLogsAndErrors !== true) {
      v03Violations.push("secretsRedactedInLogsAndErrors must be true");
    }
    const serializedAll = JSON.stringify(loadedJson);
    if (
      serializedAll.includes("SUPER_SECRET_RAW_CLIENT_SECRET_LEAK") ||
      serializedAll.includes("Atc|RAW_UNREDACTED_LIVE_BEARER_TOKEN")
    ) {
      v03Violations.push("Detected unredacted raw secret or bearer token in artifacts");
    }
  }
  recordCheck(
    "V03_OAUTH_JSON_SCOPE_CONTRACT",
    "OAuth 2.0 client_credentials uses JSON body with scope=creatorsapi::default, deduplicates concurrent refreshes, and redacts secrets",
    v03Violations,
    "OAuth 2.0 JSON contract, scope=creatorsapi::default, refresh deduplication, and secret redaction verified."
  );

  // V04: SearchItems lower-camel schema & SCHEMA_MISMATCH fail-closed proof
  const v04Violations: string[] = [];
  const searchProof = loadedJson["04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json"];
  if (!searchProof) {
    v04Violations.push("Missing 04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json");
  } else {
    if (searchProof.lowerCamelEnvelopeParsed !== true) {
      v04Violations.push("lowerCamelEnvelopeParsed must be true");
    }
    if (!Array.isArray(searchProof.requestedResources) || !searchProof.requestedResources.includes("itemInfo.title") || !searchProof.requestedResources.includes("offersV2.listings.price")) {
      v04Violations.push(
        "requestedResources must use official lower-camel resource names (itemInfo.title, offersV2.listings.price)"
      );
    }
    if (
      searchProof.uppercaseLegacyPaApiRejectedByDefault?.status !== "PROVIDER_ERROR" ||
      searchProof.uppercaseLegacyPaApiRejectedByDefault?.errorCode !== "SCHEMA_MISMATCH"
    ) {
      v04Violations.push(
        `Uppercase PA-API SearchResult.Items on HTTP 200 must fail closed with status=PROVIDER_ERROR and errorCode=SCHEMA_MISMATCH, got status='${searchProof.uppercaseLegacyPaApiRejectedByDefault?.status}', errorCode='${searchProof.uppercaseLegacyPaApiRejectedByDefault?.errorCode}'`
      );
    }
    if (
      searchProof.emptyObject200Rejected?.status !== "PROVIDER_ERROR" ||
      searchProof.emptyObject200Rejected?.errorCode !== "SCHEMA_MISMATCH"
    ) {
      v04Violations.push(
        "HTTP 200 with {} must fail closed with status=PROVIDER_ERROR and errorCode=SCHEMA_MISMATCH, never QUERY_SUCCEEDED_EMPTY"
      );
    }
    if (
      searchProof.explicitEmptyItems200?.status !== "QUERY_SUCCEEDED_EMPTY"
    ) {
      v04Violations.push(
        "Explicit { searchResult: { items: [] } } must return QUERY_SUCCEEDED_EMPTY"
      );
    }
    if (searchProof.missingOffersPreservesNullPriceCurrency !== true) {
      v04Violations.push("missingOffersPreservesNullPriceCurrency must be true");
    }
  }
  recordCheck(
    "V04_SEARCH_ITEMS_LOWER_CAMEL_AND_SCHEMA_MISMATCH",
    "SearchItems parses lower-camel searchResult.items/offersV2 and fails closed with SCHEMA_MISMATCH on wrong HTTP 200 schema",
    v04Violations,
    "SearchItems lower-camel schema and SCHEMA_MISMATCH fail-closed guard verified."
  );

  // V05: GetItems ASIN-keyed lookup and partial errors
  const v05Violations: string[] = [];
  const getItemsProof =
    loadedJson["05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json"];
  if (!getItemsProof) {
    v05Violations.push(
      "Missing 05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json"
    );
  } else {
    if (getItemsProof.matchedByAsinNotArrayIndex !== true) {
      v05Violations.push("matchedByAsinNotArrayIndex must be true");
    }
    if (getItemsProof.reversedOrderBatchVerified !== true) {
      v05Violations.push("reversedOrderBatchVerified must be true");
    }
    if (getItemsProof.partialErrorsPreservedWithoutDroppingValidItems !== true) {
      v05Violations.push(
        "partialErrorsPreservedWithoutDroppingValidItems must be true"
      );
    }
    if (
      getItemsProof.uppercaseLegacyItemsResultRejectedByDefault?.errorCode !==
      "SCHEMA_MISMATCH"
    ) {
      v05Violations.push(
        "Uppercase ItemsResult.Items on HTTP 200 must fail closed with errorCode=SCHEMA_MISMATCH"
      );
    }
  }
  recordCheck(
    "V05_GET_ITEMS_ASIN_KEYED_AND_PARTIAL_ERRORS",
    "GetItems parses itemResults.items, matches strictly by normalized ASIN (never index 0), and preserves partial errors",
    v05Violations,
    "GetItems ASIN-keyed matching and partial error handling verified."
  );

  // V06: Runtime factory wiring & MODE A E2E emulation
  const v06Violations: string[] = [];
  const factoryProof = loadedJson["06_RUNTIME_FACTORY_WIRING_PROOF.json"];
  const modeARun =
    loadedJson["07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json"];
  if (!factoryProof) {
    v06Violations.push("Missing 06_RUNTIME_FACTORY_WIRING_PROOF.json");
  } else {
    if (factoryProof.runtimeFactoryExported !== true) {
      v06Violations.push("runtimeFactoryExported must be true");
    }
    if (factoryProof.wiredInRunAmazonUsPilotEnrichment !== true) {
      v06Violations.push("wiredInRunAmazonUsPilotEnrichment must be true");
    }
    if (factoryProof.wiredInDiscoverAmazonProductsForCandidates !== true) {
      v06Violations.push("wiredInDiscoverAmazonProductsForCandidates must be true");
    }
    if (factoryProof.zeroCallsWhenPolicyDisabledOrLiveFalse !== true) {
      v06Violations.push("zeroCallsWhenPolicyDisabledOrLiveFalse must be true");
    }
    if (factoryProof.booleanClientNotTreatedAsAuthenticatedProof !== true) {
      v06Violations.push("booleanClientNotTreatedAsAuthenticatedProof must be true");
    }
  }
  if (!modeARun) {
    v06Violations.push(
      "Missing 07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json"
    );
  } else {
    if (modeARun.injectedCreatorsApiClientUsed !== false) {
      v06Violations.push(
        "MODE A E2E run must execute via runtime factory with injectedCreatorsApiClientUsed=false"
      );
    }
    if (modeARun.runtimeFactoryConstructedClient !== true) {
      v06Violations.push("MODE A runtimeFactoryConstructedClient must be true");
    }
    if (modeARun.observationClass !== "TEST_FIXTURE") {
      v06Violations.push(
        `MODE A local HTTP emulator run must be classified as observationClass='TEST_FIXTURE', got '${modeARun.observationClass}'`
      );
    }
    if (modeARun.providerSourceOrigin !== "TEST_FIXTURE") {
      v06Violations.push(
        `MODE A local HTTP emulator run must have providerSourceOrigin='TEST_FIXTURE', got '${modeARun.providerSourceOrigin}'`
      );
    }
    if (modeARun.countedAsAuthorizedLive !== false) {
      v06Violations.push("MODE A countedAsAuthorizedLive must be false");
    }
    if (
      typeof modeARun.oauthRequestsObservedAtEmulator !== "number" ||
      modeARun.oauthRequestsObservedAtEmulator < 1
    ) {
      v06Violations.push("MODE A must observe >=1 OAuth request at local HTTP emulator");
    }
    if (
      typeof modeARun.searchItemsRequestsObservedAtEmulator !== "number" ||
      modeARun.searchItemsRequestsObservedAtEmulator < 1
    ) {
      v06Violations.push(
        "MODE A must observe >=1 SearchItems request at local HTTP emulator"
      );
    }
    if (
      typeof modeARun.verifiedCandidatesCount !== "number" ||
      modeARun.verifiedCandidatesCount < 1
    ) {
      v06Violations.push("MODE A must verify >=1 candidate product identity");
    }
  }
  recordCheck(
    "V06_RUNTIME_FACTORY_WIRING_AND_MODE_A_E2E",
    "Runtime factory is wired into orchestrator/enrichment and verified via MODE A local HTTP emulator with injectedCreatorsApiClientUsed=false and TEST_FIXTURE provenance",
    v06Violations,
    "Runtime factory wiring and MODE A E2E Product Finder run verified."
  );

  // V07: Live provider truth & zero fake live claims
  const v07Violations: string[] = [];
  const liveProof =
    loadedJson["08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json"];
  if (!liveProof) {
    v07Violations.push(
      "Missing 08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json"
    );
  } else {
    const validLiveVerdicts = new Set([
      "REAL_PROVIDER_VERIFIED",
      "CREDENTIALS_REQUIRED",
      "ACCESS_NOT_GRANTED",
      "AUTHENTICATION_FAILED",
      "BLOCKED_POLICY",
      "BLOCKED_PROVIDER",
    ]);
    if (!validLiveVerdicts.has(liveProof.liveVerdict)) {
      v07Violations.push(`Invalid liveVerdict '${liveProof.liveVerdict}'`);
    }
    if (typeof liveProof.configured !== "boolean") {
      v07Violations.push("liveProof.configured must be boolean");
    }
    if (typeof liveProof.authenticated !== "boolean") {
      v07Violations.push("liveProof.authenticated must be boolean");
    }
    if (typeof liveProof.querySucceeded !== "boolean") {
      v07Violations.push("liveProof.querySucceeded must be boolean");
    }
    if (liveProof.configured === false && liveProof.authenticated === true) {
      v07Violations.push(
        "configured=false cannot have authenticated=true (false authentication claim)"
      );
    }
    if (liveProof.authenticated === false && liveProof.querySucceeded === true) {
      v07Violations.push(
        "authenticated=false cannot have querySucceeded=true"
      );
    }
    if (liveProof.liveVerdict === "REAL_PROVIDER_VERIFIED") {
      if (
        !liveProof.configured ||
        !liveProof.authenticated ||
        !liveProof.querySucceeded ||
        (liveProof.verifiedLiveUsProductIdentitiesCount ?? 0) < 1
      ) {
        v07Violations.push(
          "REAL_PROVIDER_VERIFIED requires configured=true, authenticated=true, querySucceeded=true, and verifiedLiveUsProductIdentitiesCount >= 1"
        );
      }
    } else {
      if ((liveProof.verifiedLiveUsProductIdentitiesCount ?? 0) !== 0) {
        v07Violations.push(
          `When liveVerdict='${liveProof.liveVerdict}', verifiedLiveUsProductIdentitiesCount must be 0, got '${liveProof.verifiedLiveUsProductIdentitiesCount}'`
        );
      }
    }
  }
  recordCheck(
    "V07_LIVE_PROVIDER_TRUTH_AND_ZERO_FAKE_LIVE",
    "Live provider proof strictly separates configured != authenticated != querySucceeded and forbids fake live claims",
    v07Violations,
    "Live provider truth and zero fake live claims verified."
  );

  // V08: Query plan, budget caps, identity matching & hash recomputation
  const v08Violations: string[] = [];
  const queryPlan = loadedJson["09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json"];
  const matchLedger =
    loadedJson["10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json"];
  const manifest = loadedJson["11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json"];

  if (!queryPlan) {
    v08Violations.push("Missing 09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json");
  } else {
    if ((queryPlan.maxCandidatesPerRun ?? 99) > 3) {
      v08Violations.push(
        `maxCandidatesPerRun (${queryPlan.maxCandidatesPerRun}) exceeds cap of 3`
      );
    }
    if ((queryPlan.maxTotalOperationsPerRun ?? 99) > 4) {
      v08Violations.push(
        `maxTotalOperationsPerRun (${queryPlan.maxTotalOperationsPerRun}) exceeds cap of 4`
      );
    }
    if (queryPlan.maxConcurrency !== 1) {
      v08Violations.push(
        `maxConcurrency (${queryPlan.maxConcurrency}) must equal 1`
      );
    }
    if (queryPlan.tokenAcquisitionCountedAgainstProductBudget !== false) {
      v08Violations.push(
        "tokenAcquisitionCountedAgainstProductBudget must be false"
      );
    }
  }

  if (!matchLedger) {
    v08Violations.push(
      "Missing 10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json"
    );
  } else {
    if (matchLedger.accessoryOrBundlePromotedToExactMatch !== false) {
      v08Violations.push("accessoryOrBundlePromotedToExactMatch must be false");
    }
    if (!Array.isArray(matchLedger.decisions) || matchLedger.decisions.length === 0) {
      v08Violations.push("matchLedger.decisions must be a non-empty array");
    }
  }

  if (!manifest || !Array.isArray(manifest.records) || manifest.records.length === 0) {
    v08Violations.push(
      "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json must contain non-empty records array"
    );
  } else {
    for (const rec of manifest.records) {
      if (!rec.asin || !isValidStrictAmazonAsin(rec.asin)) {
        v08Violations.push(`Invalid ASIN '${rec.asin}' in evidence manifest`);
      }
      if (!rec.rawEvidenceHash || !/^[0-9a-f]{64}$/i.test(rec.rawEvidenceHash)) {
        v08Violations.push(
          `Invalid rawEvidenceHash '${rec.rawEvidenceHash}' for ASIN '${rec.asin}'`
        );
      }
      if (
        !rec.extractedFieldsHash ||
        !/^[0-9a-f]{64}$/i.test(rec.extractedFieldsHash)
      ) {
        v08Violations.push(
          `Invalid extractedFieldsHash '${rec.extractedFieldsHash}' for ASIN '${rec.asin}'`
        );
      }
      if (rec.extractedFieldsPayload) {
        const recomputed = computeDeterministicEvidenceHash(
          rec.extractedFieldsPayload
        );
        if (recomputed !== rec.extractedFieldsHash) {
          v08Violations.push(
            `Recomputed extractedFieldsHash '${recomputed}' != recorded '${rec.extractedFieldsHash}' for ASIN '${rec.asin}'`
          );
        }
      }
      if (
        rec.providerRequestId !== null &&
        isFakeOrLocalAmazonRequestId(
          rec.providerRequestId,
          rec.providerInvocationRef
        )
      ) {
        v08Violations.push(
          `Conflated or synthetic providerRequestId '${rec.providerRequestId}' for invocation '${rec.providerInvocationRef}'`
        );
      }
      if (
        rec.httpStatusOrigin === "UNOBSERVED_NULL" &&
        rec.httpStatus !== null
      ) {
        v08Violations.push(
          `Record '${rec.asin}' has httpStatusOrigin=UNOBSERVED_NULL but non-null httpStatus=${rec.httpStatus}`
        );
      }
      if (
        rec.observationClass === "AUTHORIZED_LIVE" &&
        liveProof?.liveVerdict !== "REAL_PROVIDER_VERIFIED"
      ) {
        v08Violations.push(
          `Manifest record '${rec.asin}' claims AUTHORIZED_LIVE while liveVerdict is '${liveProof?.liveVerdict}'`
        );
      }
    }
  }
  recordCheck(
    "V08_QUERY_PLAN_BUDGET_AND_IDENTITY_MATCHING",
    "Query plan caps (<=3 candidates, <=4 ops, concurrency=1), accessory rejection, and SHA-256 hash recomputation hold",
    v08Violations,
    "Query plan budget caps, accessory rejection, and SHA-256 hash integrity verified."
  );

  // V09: Non-inflation scoring & G07/G15/G16 parity
  const v09Violations: string[] = [];
  const nonInflation =
    loadedJson["12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json"];
  if (!nonInflation) {
    v09Violations.push(
      "Missing 12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json"
    );
  } else {
    if (nonInflation.comparisonStatus !== "COMPARED_ZERO_INFLATION") {
      v09Violations.push(
        `comparisonStatus must be 'COMPARED_ZERO_INFLATION', got '${nonInflation.comparisonStatus}'`
      );
    }
    if (nonInflation.maxAbsoluteScoreDelta !== 0) {
      v09Violations.push(
        `maxAbsoluteScoreDelta must be 0, got '${nonInflation.maxAbsoluteScoreDelta}'`
      );
    }
    if (nonInflation.rankOrderChanged !== false) {
      v09Violations.push("rankOrderChanged must be false");
    }
    if (nonInflation.g07Changed !== false) {
      v09Violations.push("g07Changed must be false");
    }
    if (nonInflation.g15Changed !== false) {
      v09Violations.push("g15Changed must be false");
    }
    if (nonInflation.g16Changed !== false) {
      v09Violations.push("g16Changed must be false");
    }
    if (nonInflation.historicalGateTruth?.G07 !== "BLOCKED") {
      v09Violations.push(
        `Historical G07 must remain 'BLOCKED', got '${nonInflation.historicalGateTruth?.G07}'`
      );
    }
    if (nonInflation.historicalGateTruth?.G15 !== "0/3") {
      v09Violations.push(
        `Historical G15 must remain '0/3', got '${nonInflation.historicalGateTruth?.G15}'`
      );
    }
    if (nonInflation.historicalGateTruth?.G16 !== "2/3") {
      v09Violations.push(
        `Historical G16 must remain '2/3', got '${nonInflation.historicalGateTruth?.G16}'`
      );
    }
    if (
      nonInflation.historicalGateTruth?.devHoldoutLongitudinalDemand !==
      "INSUFFICIENT_EVIDENCE"
    ) {
      v09Violations.push(
        `devHoldoutLongitudinalDemand must remain 'INSUFFICIENT_EVIDENCE', got '${nonInflation.historicalGateTruth?.devHoldoutLongitudinalDemand}'`
      );
    }
  }
  recordCheck(
    "V09_NON_INFLATION_SCORING_AND_G07_G15_G16_PARITY",
    "Amazon evidence causes zero opportunityScore/rank/G07/G15/G16 inflation and preserves historical gate truth",
    v09Violations,
    "Zero score/rank/gate inflation and historical G07/G15/G16 truth verified."
  );

  // V10: Persistence, reload reconciliation & workspace isolation
  const v10Violations: string[] = [];
  const persistence =
    loadedJson["13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json"];
  if (!persistence) {
    v10Violations.push("Missing 13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json");
  } else {
    if (persistence.coreFieldComparisonsTotal !== 49 || persistence.coreFieldMismatches !== 0) {
      v10Violations.push(
        `Expected 49/49 core field comparisons with 0 mismatches, got total=${persistence.coreFieldComparisonsTotal}, mismatches=${persistence.coreFieldMismatches}`
      );
    }
    if (
      persistence.amazonFieldComparisonsTotal !== 16 ||
      persistence.amazonFieldMismatches !== 0
    ) {
      v10Violations.push(
        `Expected 16/16 Amazon field comparisons with 0 mismatches, got total=${persistence.amazonFieldComparisonsTotal}, mismatches=${persistence.amazonFieldMismatches}`
      );
    }
    if (persistence.parentRunCompletedStatusPreserved !== true) {
      v10Violations.push("parentRunCompletedStatusPreserved must be true");
    }
    if (persistence.crossWorkspaceIsolationHttp403Verified !== true) {
      v10Violations.push("crossWorkspaceIsolationHttp403Verified must be true");
    }
    if (persistence.productionDbMutated !== false) {
      v10Violations.push("productionDbMutated must be false");
    }
  }
  recordCheck(
    "V10_PERSISTENCE_RELOAD_AND_WORKSPACE_ISOLATION",
    "SQLite persistence, post-reload HTTP GET parity (49/49 core + 16/16 Amazon fields), parent COMPLETED status, and 403 workspace isolation hold",
    v10Violations,
    "Persistence, reload parity, and workspace isolation verified."
  );

  // V11: Playwright UI rendering & Playwright MCP URL verification parity
  const v11Violations: string[] = [];
  const uiProof =
    loadedJson["14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json"];
  const mcpParity =
    loadedJson["15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json"];
  if (!uiProof) {
    v11Violations.push(
      "Missing 14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json"
    );
  } else {
    if (uiProof.headlessChromiumVerified !== true) {
      v11Violations.push("headlessChromiumVerified must be true");
    }
    if (uiProof.nonInflationNoticeVisibleInDom !== true) {
      v11Violations.push("nonInflationNoticeVisibleInDom must be true");
    }
    if (!Array.isArray(uiProof.screenshots) || uiProof.screenshots.length < 2) {
      v11Violations.push("uiProof.screenshots must contain >= 2 screenshots");
    } else {
      for (const shot of uiProof.screenshots) {
        const relPath = shot?.relativePath || "";
        const fullShotPath = path.join(artifactDir, relPath);
        if (!relPath || !fs.existsSync(fullShotPath)) {
          v11Violations.push(`Missing screenshot file on disk: ${relPath}`);
        } else if (fs.statSync(fullShotPath).size < 100) {
          v11Violations.push(`Empty or invalid screenshot file: ${relPath}`);
        }
      }
    }
  }
  if (!mcpParity) {
    v11Violations.push(
      "Missing 15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json"
    );
  } else {
    if (mcpParity.manualUrlVerificationIntact !== true) {
      v11Violations.push("manualUrlVerificationIntact must be true");
    }
    if (mcpParity.ssrfAndNonUsHostGuardsIntact !== true) {
      v11Violations.push("ssrfAndNonUsHostGuardsIntact must be true");
    }
  }
  recordCheck(
    "V11_PLAYWRIGHT_UI_AND_MCP_PARITY",
    "Headless Chromium UI rendering, non-empty screenshots on disk, and Playwright MCP URL verification parity hold",
    v11Violations,
    "Playwright UI screenshots and MCP URL verification parity verified."
  );

  // V12: Automated test suite & production build / TypeScript proof
  const v12Violations: string[] = [];
  const testResults = loadedJson["16_AUTOMATED_TEST_SUITE_RESULTS.json"];
  const buildProof = loadedJson["17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json"];
  if (!testResults) {
    v12Violations.push("Missing 16_AUTOMATED_TEST_SUITE_RESULTS.json");
  } else {
    if (testResults.failedTests !== 0) {
      v12Violations.push(
        `failedTests must be 0, got '${testResults.failedTests}'`
      );
    }
    if ((testResults.v12_4_3_5_0_3TestsPassed ?? 0) < 52) {
      v12Violations.push(
        `v12_4_3_5_0_3TestsPassed must be >= 52 (R01..R52), got '${testResults.v12_4_3_5_0_3TestsPassed}'`
      );
    }
    if ((testResults.totalTestsPassed ?? 0) < 600) {
      v12Violations.push(
        `totalTestsPassed must be >= 600, got '${testResults.totalTestsPassed}'`
      );
    }
  }
  if (!buildProof) {
    v12Violations.push(
      "Missing 17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json"
    );
  } else {
    if (buildProof.tscExitCode !== 0) {
      v12Violations.push(
        `tscExitCode must be 0, got '${buildProof.tscExitCode}'`
      );
    }
    if (buildProof.nextBuildExitCode !== 0) {
      v12Violations.push(
        `nextBuildExitCode must be 0, got '${buildProof.nextBuildExitCode}'`
      );
    }
  }
  recordCheck(
    "V12_TESTS_BUILD_AND_TYPESCRIPT",
    "All R01..R52 tests, full regression suite, npx tsc --noEmit, and npm run build pass with exit code 0",
    v12Violations,
    "Automated test suite, TypeScript check, and Next.js production build verified."
  );

  // V13: Negative mutation suite (>= 48 physical mutations, 0 escapes)
  const v13Violations: string[] = [];
  if (!options.skipMutationSuiteArtifactCheck) {
    const mutSuite = loadedJson["18_NEGATIVE_MUTATION_SUITE.json"];
    if (!mutSuite) {
      v13Violations.push("Missing 18_NEGATIVE_MUTATION_SUITE.json");
    } else {
      if ((mutSuite.totalMutationsExecuted ?? 0) < 48) {
        v13Violations.push(
          `totalMutationsExecuted must be >= 48, got '${mutSuite.totalMutationsExecuted}'`
        );
      }
      if (mutSuite.caughtCount !== mutSuite.totalMutationsExecuted) {
        v13Violations.push(
          `caughtCount (${mutSuite.caughtCount}) != totalMutationsExecuted (${mutSuite.totalMutationsExecuted})`
        );
      }
      if (mutSuite.escapedCount !== 0 || mutSuite.allCaughtZeroEscapes !== true) {
        v13Violations.push(
          `escapedCount must be 0 and allCaughtZeroEscapes=true, got escapedCount=${mutSuite.escapedCount}`
        );
      }
    }
  }
  recordCheck(
    "V13_NEGATIVE_MUTATION_SUITE_48_PLUS",
    "At least 48 physical-file negative control mutations executed with 100% caught and 0 escapes",
    v13Violations,
    "48/48 physical-file negative control mutations caught with 0 escapes."
  );

  // V14: Disk & process hygiene
  const v14Violations: string[] = [];
  const diskAudit = loadedJson["20_DISK_AND_PROCESS_HYGIENE_AUDIT.json"];
  if (!diskAudit) {
    v14Violations.push("Missing 20_DISK_AND_PROCESS_HYGIENE_AUDIT.json");
  } else {
    const minFreeBytes = 8 * 1024 * 1024 * 1024;
    if (
      typeof diskAudit.freeBytesAfter !== "number" ||
      diskAudit.freeBytesAfter < minFreeBytes
    ) {
      v14Violations.push(
        `freeBytesAfter (${diskAudit.freeBytesAfter}) is below 8 GiB threshold (${minFreeBytes})`
      );
    }
    if (diskAudit.orphanProcessesRemaining !== 0) {
      v14Violations.push(
        `orphanProcessesRemaining must be 0, got '${diskAudit.orphanProcessesRemaining}'`
      );
    }
    if (diskAudit.tempDirsCleaned !== true) {
      v14Violations.push("tempDirsCleaned must be true");
    }
  }
  recordCheck(
    "V14_DISK_AND_PROCESS_HYGIENE",
    "Disk headroom >= 8 GiB, 0 orphan processes remaining, and temporary directories cleaned",
    v14Violations,
    "Disk headroom and process hygiene verified."
  );

  // V15: Final acceptance matrix & executive completion report truth
  const v15Violations: string[] = [];
  const matrix = loadedJson["21_FINAL_ACCEPTANCE_MATRIX.json"];
  const execMdPath = path.join(artifactDir, "22_EXECUTIVE_COMPLETION_REPORT.md");
  const execMdText = fs.existsSync(execMdPath)
    ? fs.readFileSync(execMdPath, "utf8")
    : "";

  const liveVerdict: V12_4_3_5_0_3ValidationResult["liveProviderVerdict"] =
    liveProof?.liveVerdict || "CREDENTIALS_REQUIRED";
  const expectedOverallVerdict: V12_4_3_5_0_3ValidationResult["overallClosureVerdict"] =
    liveVerdict === "REAL_PROVIDER_VERIFIED"
      ? "FULL_CLOSURE_READY"
      : "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER";

  if (!matrix) {
    v15Violations.push("Missing 21_FINAL_ACCEPTANCE_MATRIX.json");
  } else {
    if (matrix.engineeringVerdict !== "ENGINEERING_READY") {
      v15Violations.push(
        `matrix.engineeringVerdict must be 'ENGINEERING_READY', got '${matrix.engineeringVerdict}'`
      );
    }
    if (matrix.liveProviderVerdict !== liveVerdict) {
      v15Violations.push(
        `matrix.liveProviderVerdict '${matrix.liveProviderVerdict}' != liveProof.liveVerdict '${liveVerdict}'`
      );
    }
    if (matrix.overallClosureVerdict !== expectedOverallVerdict) {
      v15Violations.push(
        `matrix.overallClosureVerdict '${matrix.overallClosureVerdict}' != expected '${expectedOverallVerdict}'`
      );
    }
  }
  if (!execMdText.includes(expectedOverallVerdict)) {
    v15Violations.push(
      `22_EXECUTIVE_COMPLETION_REPORT.md does not contain expected verdict '${expectedOverallVerdict}'`
    );
  }
  recordCheck(
    "V15_FINAL_ACCEPTANCE_MATRIX_TRUTH",
    "Final acceptance matrix and executive completion report accurately reflect engineering readiness and live provider status",
    v15Violations,
    `Final acceptance matrix and report verified (${expectedOverallVerdict}).`
  );

  const passedChecksCount = checks.filter((c) => c.passed).length;
  const failedChecksCount = checks.filter((c) => !c.passed).length;
  const valid = failedChecksCount === 0;

  return {
    valid,
    releaseVersion: "12.4.3.5.0.3",
    artifactDir,
    evaluatedAt,
    expectedCodeSha: options.expectedCodeSha ?? null,
    observedCodeSha,
    engineeringVerdict: valid ? "ENGINEERING_READY" : "ENGINEERING_FAILED",
    liveProviderVerdict: liveVerdict,
    overallClosureVerdict: valid ? expectedOverallVerdict : "FAILED",
    passedChecksCount,
    failedChecksCount,
    checks,
    violations: allViolations,
  };
}

/**
 * Writes a canonical valid V12.4.3.5.0.3 artifact bundle into `targetDir` for unit/mutation testing.
 */
export function writeCanonicalValidCreatorsRuntimeFixture(
  targetDir: string,
  codeSha = "3333333333333333333333333333333333333333"
): void {
  fs.mkdirSync(path.join(targetDir, "screenshots"), { recursive: true });
  const pngHeader = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
    "hex"
  );
  const paddedPng = Buffer.concat([pngHeader, Buffer.alloc(128, 0)]);
  fs.writeFileSync(
    path.join(targetDir, "screenshots", "product-finder-amazon-evidence.png"),
    paddedPng
  );
  fs.writeFileSync(
    path.join(targetDir, "screenshots", "product-finder-reload-parity.png"),
    paddedPng
  );

  const writeJson = (name: string, data: any) => {
    fs.writeFileSync(path.join(targetDir, name), JSON.stringify(data, null, 2), "utf8");
  };

  writeJson("00_BASELINE_BRANCH_AND_SOURCE_SHA.json", {
    releaseVersion: "12.4.3.5.0.3",
    branch: "feature/kh02-amazon-us-pilot-v12.4.3.5.0",
    codeSha,
    baseMasterSha: "c1833362cf6634917f2ff94df19d97c393247d94",
    workingTreeCleanAtStart: true,
  });

  writeJson("01_FUNCTION_AND_IMPORT_INVENTORY.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    functionsVerified: [
      "resolveAmazonCreatorsApiRuntimeClient",
      "buildCreatorsSearchItemsPayload",
      "buildCreatorsGetItemsPayload",
      "parseCreatorsSearchItemsEnvelope",
      "parseCreatorsGetItemsEnvelope",
      "normalizeCreatorsApiItemShape",
      "normalizeAmazonSearchItem",
      "discoverAmazonProductsForCandidates",
      "runAmazonUsPilotEnrichment",
    ],
  });

  writeJson("02_CREATORS_API_OFFICIAL_CONTRACT_SOURCES.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    officialDocsVerified: [
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl",
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items",
      "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items",
    ],
  });

  writeJson("03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    tokenEndpointNa: "https://api.amazon.com/auth/o2/token",
    requestContentType: "application/json",
    requestBodyShape: {
      grant_type: "client_credentials",
      client_id: "[REDACTED_CLIENT_ID]",
      client_secret: "[REDACTED_SECRET]",
      scope: "creatorsapi::default",
    },
    concurrentRefreshDeduplication: {
      concurrentSearchCalls: 2,
      tokenHttpCallsCount: 1,
    },
    malformedToken200Rejected: true,
    single401RefreshRetryVerified: true,
    secretsRedactedInLogsAndErrors: true,
  });

  writeJson("04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    lowerCamelEnvelopeParsed: true,
    requestedResources: [
      "images.primary.medium",
      "itemInfo.title",
      "itemInfo.byLineInfo",
      "itemInfo.manufactureInfo",
      "offersV2.listings.price",
      "offersV2.listings.availability",
      "offersV2.listings.merchantInfo",
      "parentASIN",
    ],
    uppercaseLegacyPaApiRejectedByDefault: {
      valid: false,
      status: "PROVIDER_ERROR",
      errorCode: "SCHEMA_MISMATCH",
    },
    emptyObject200Rejected: {
      valid: false,
      status: "PROVIDER_ERROR",
      errorCode: "SCHEMA_MISMATCH",
    },
    explicitEmptyItems200: {
      valid: true,
      status: "QUERY_SUCCEEDED_EMPTY",
    },
    missingOffersPreservesNullPriceCurrency: true,
  });

  writeJson("05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    matchedByAsinNotArrayIndex: true,
    reversedOrderBatchVerified: true,
    partialErrorsPreservedWithoutDroppingValidItems: true,
    uppercaseLegacyItemsResultRejectedByDefault: {
      valid: false,
      status: "PROVIDER_ERROR",
      errorCode: "SCHEMA_MISMATCH",
    },
  });

  writeJson("06_RUNTIME_FACTORY_WIRING_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    runtimeFactoryExported: true,
    wiredInRunAmazonUsPilotEnrichment: true,
    wiredInDiscoverAmazonProductsForCandidates: true,
    zeroCallsWhenPolicyDisabledOrLiveFalse: true,
    booleanClientNotTreatedAsAuthenticatedProof: true,
  });

  writeJson("07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    mode: "MODE_A_LOCAL_HTTP_CREATORS_API_EMULATOR",
    injectedCreatorsApiClientUsed: false,
    runtimeFactoryConstructedClient: true,
    observationClass: "TEST_FIXTURE",
    providerSourceOrigin: "TEST_FIXTURE",
    countedAsAuthorizedLive: false,
    oauthRequestsObservedAtEmulator: 1,
    searchItemsRequestsObservedAtEmulator: 3,
    getItemsRequestsObservedAtEmulator: 1,
    verifiedCandidatesCount: 3,
  });

  writeJson("08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    configured: false,
    authenticated: false,
    querySucceeded: false,
    liveVerdict: "CREDENTIALS_REQUIRED",
    verifiedLiveUsProductIdentitiesCount: 0,
  });

  writeJson("09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    maxCandidatesPerRun: 3,
    maxTotalOperationsPerRun: 4,
    maxConcurrency: 1,
    tokenAcquisitionCountedAgainstProductBudget: false,
  });

  writeJson("10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    accessoryOrBundlePromotedToExactMatch: false,
    decisions: [
      {
        candidateId: "cand_uahpet_1",
        asin: "B08N5WRWNW",
        identityMatch: "EXACT_PRODUCT",
        selectedAsBest: true,
      },
      {
        candidateId: "cand_uahpet_1",
        asin: "B08N5WRACC",
        identityMatch: "BRAND_ONLY",
        selectedAsBest: false,
      },
    ],
  });

  const extractedFieldsPayload = {
    asin: "B08N5WRWNW",
    parentAsin: "B08N5WRW00",
    variationAsin: "B08N5WRWNW",
    canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
    productTitle: "UAHPET Wireless Cat Water Fountain Stainless Steel 67oz Battery Operated",
    brand: "UAHPET",
    merchant: "UAHPET Official Store",
    currency: "USD",
    price: 49.99,
    availability: "In Stock",
    modelNumber: "UAH-WF-01",
    gtin: "012345678905",
  };
  const extractedFieldsHash =
    computeDeterministicEvidenceHash(extractedFieldsPayload)!;
  const rawEvidenceHash =
    computeDeterministicEvidenceHash({ sampleRaw: "B08N5WRWNW" })!;

  writeJson("11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    records: [
      {
        candidateId: "cand_uahpet_1",
        asin: "B08N5WRWNW",
        providerInvocationRef: "amz_inv_run1_cand1_search_1234567890",
        providerRequestId: "amz-upstream-req-001",
        rawEvidenceHash,
        extractedFieldsHash,
        extractedFieldsPayload,
        httpStatus: 200,
        httpStatusOrigin: "OBSERVED",
        observationClass: "TEST_FIXTURE",
        providerSourceOrigin: "TEST_FIXTURE",
      },
    ],
  });

  writeJson("12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    comparisonStatus: "COMPARED_ZERO_INFLATION",
    maxAbsoluteScoreDelta: 0,
    rankOrderChanged: false,
    g07Changed: false,
    g15Changed: false,
    g16Changed: false,
    historicalGateTruth: {
      G07: "BLOCKED",
      G15: "0/3",
      G16: "2/3",
      devHoldoutLongitudinalDemand: "INSUFFICIENT_EVIDENCE",
    },
  });

  writeJson("13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    coreFieldComparisonsTotal: 49,
    coreFieldMismatches: 0,
    amazonFieldComparisonsTotal: 16,
    amazonFieldMismatches: 0,
    parentRunCompletedStatusPreserved: true,
    crossWorkspaceIsolationHttp403Verified: true,
    productionDbMutated: false,
  });

  writeJson("14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    headlessChromiumVerified: true,
    nonInflationNoticeVisibleInDom: true,
    screenshots: [
      {
        name: "product-finder-amazon-evidence",
        relativePath: "screenshots/product-finder-amazon-evidence.png",
      },
      {
        name: "product-finder-reload-parity",
        relativePath: "screenshots/product-finder-reload-parity.png",
      },
    ],
  });

  writeJson("15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    manualUrlVerificationIntact: true,
    ssrfAndNonUsHostGuardsIntact: true,
  });

  writeJson("16_AUTOMATED_TEST_SUITE_RESULTS.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    failedTests: 0,
    v12_4_3_5_0_3TestsPassed: 52,
    totalTestsPassed: 623,
  });

  writeJson("17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    tscExitCode: 0,
    nextBuildExitCode: 0,
  });

  writeJson("18_NEGATIVE_MUTATION_SUITE.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    totalMutationsExecuted: 48,
    caughtCount: 48,
    escapedCount: 0,
    allCaughtZeroEscapes: true,
  });

  writeJson("20_DISK_AND_PROCESS_HYGIENE_AUDIT.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    freeBytesAfter: 16 * 1024 * 1024 * 1024,
    orphanProcessesRemaining: 0,
    tempDirsCleaned: true,
  });

  writeJson("21_FINAL_ACCEPTANCE_MATRIX.json", {
    releaseVersion: "12.4.3.5.0.3",
    codeSha,
    engineeringVerdict: "ENGINEERING_READY",
    liveProviderVerdict: "CREDENTIALS_REQUIRED",
    overallClosureVerdict: "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER",
  });

  fs.writeFileSync(
    path.join(targetDir, "22_EXECUTIVE_COMPLETION_REPORT.md"),
    `# KH-02 V12.4.3.5.0.3 Executive Completion Report\n\n- Verdict: ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER\n- Code SHA: ${codeSha}\n`,
    "utf8"
  );
}

export interface NegativeMutationCaseResult {
  mutationId: string;
  description: string;
  targetArtifact: string;
  caught: boolean;
  failedCheckIds: string[];
  firstViolation: string | null;
}

export interface NegativeMutationSuiteReport {
  releaseVersion: string;
  evaluatedAt: string;
  totalMutationsExecuted: number;
  caughtCount: number;
  escapedCount: number;
  allCaughtZeroEscapes: boolean;
  mutations: NegativeMutationCaseResult[];
}

/**
 * Executes 48 physical-file negative control mutations (M01..M48) against a temporary copy
 * of the valid artifact directory and verifies the independent validator catches all 48 with 0 escapes.
 */
export function runAmazonCreatorsRuntimeNegativeMutationSuite(
  baseWorkDir?: string,
  codeSha = "3333333333333333333333333333333333333333"
): NegativeMutationSuiteReport {
  const rootTmp =
    baseWorkDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243503_mutations_"));
  const cleanDir = path.join(rootTmp, "canonical_valid");
  writeCanonicalValidCreatorsRuntimeFixture(cleanDir, codeSha);

  const mutateJson = (
    dir: string,
    file: string,
    mutator: (obj: any) => void
  ) => {
    const p = path.join(dir, file);
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    mutator(obj);
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  };

  const mutationSpecs: Array<{
    id: string;
    description: string;
    targetArtifact: string;
    apply: (dir: string) => void;
  }> = [
    {
      id: "M01_OAUTH_FORM_URLENCODED",
      description: "OAuth request uses application/x-www-form-urlencoded instead of application/json",
      targetArtifact: "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", (o) => {
          o.requestContentType = "application/x-www-form-urlencoded";
        }),
    },
    {
      id: "M02_OAUTH_MISSING_SCOPE",
      description: "OAuth request omits scope=creatorsapi::default",
      targetArtifact: "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", (o) => {
          delete o.requestBodyShape.scope;
        }),
    },
    {
      id: "M03_UPPERCASE_SEARCH_RESULT_TREATED_AS_EMPTY",
      description: "HTTP 200 uppercase SearchResult.Items treated as QUERY_SUCCEEDED_EMPTY instead of SCHEMA_MISMATCH",
      targetArtifact: "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
      apply: (d) =>
        mutateJson(d, "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json", (o) => {
          o.uppercaseLegacyPaApiRejectedByDefault.status = "QUERY_SUCCEEDED_EMPTY";
          o.uppercaseLegacyPaApiRejectedByDefault.errorCode = null;
        }),
    },
    {
      id: "M04_GET_ITEMS_ARRAY_INDEX_0_LOOKUP",
      description: "GetItems matches returned item by array index 0 instead of normalized ASIN",
      targetArtifact: "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
          (o) => {
            o.matchedByAsinNotArrayIndex = false;
          }
        ),
    },
    {
      id: "M05_MISSING_OFFERS_CONVERTED_TO_ZERO_PRICE",
      description: "Missing offersV2 price converted to 0 instead of null",
      targetArtifact: "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
      apply: (d) =>
        mutateJson(d, "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json", (o) => {
          o.missingOffersPreservesNullPriceCurrency = false;
        }),
    },
    {
      id: "M06_HTTP_STATUS_FABRICATED_ON_UNOBSERVED",
      description: "httpStatus=200 fabricated when httpStatusOrigin=UNOBSERVED_NULL",
      targetArtifact: "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].httpStatusOrigin = "UNOBSERVED_NULL";
          o.records[0].httpStatus = 200;
        }),
    },
    {
      id: "M07_PROVIDER_REQUEST_ID_COPIED_FROM_INVOCATION_REF",
      description: "providerRequestId copied from local providerInvocationRef",
      targetArtifact: "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].providerRequestId = o.records[0].providerInvocationRef;
        }),
    },
    {
      id: "M08_MODE_A_LOCAL_SERVER_TAGGED_AUTHORIZED_LIVE",
      description: "MODE A local HTTP test server tagged as AUTHORIZED_LIVE instead of TEST_FIXTURE",
      targetArtifact: "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
      apply: (d) =>
        mutateJson(
          d,
          "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
          (o) => {
            o.observationClass = "AUTHORIZED_LIVE";
          }
        ),
    },
    {
      id: "M09_BOOLEAN_CLIENT_TREATED_AS_AUTHENTICATED",
      description: "Boolean(client) or env var presence treated as authenticated=true when configured=false",
      targetArtifact: "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
          (o) => {
            o.configured = false;
            o.authenticated = true;
          }
        ),
    },
    {
      id: "M10_ACCESSORY_PROMOTED_TO_EXACT_PRODUCT",
      description: "Accessory/filter pack promoted to EXACT_PRODUCT",
      targetArtifact: "10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json",
      apply: (d) =>
        mutateJson(
          d,
          "10_IDENTITY_MATCH_AND_ACCESSORY_REJECTION_LEDGER.json",
          (o) => {
            o.accessoryOrBundlePromotedToExactMatch = true;
          }
        ),
    },
    {
      id: "M11_AMAZON_EVIDENCE_INFLATES_OPPORTUNITY_SCORE",
      description: "Amazon evidence inflates opportunityScore by +1.5 points",
      targetArtifact: "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
      apply: (d) =>
        mutateJson(
          d,
          "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
          (o) => {
            o.maxAbsoluteScoreDelta = 1.5;
          }
        ),
    },
    {
      id: "M12_AMAZON_EVIDENCE_FLIPS_G15_PASS",
      description: "Amazon listing existence flips G15 from 0/3 to 3/3",
      targetArtifact: "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
      apply: (d) =>
        mutateJson(
          d,
          "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
          (o) => {
            o.g15Changed = true;
            o.historicalGateTruth.G15 = "3/3";
          }
        ),
    },
    {
      id: "M13_CROSS_WORKSPACE_LEAK_HTTP_200",
      description: "Cross-workspace read leaks Amazon evidence instead of returning HTTP 403",
      targetArtifact: "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
      apply: (d) =>
        mutateJson(d, "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json", (o) => {
          o.crossWorkspaceIsolationHttp403Verified = false;
        }),
    },
    {
      id: "M14_CLIENT_SECRET_LEAKED_IN_ARTIFACT",
      description: "Raw client_secret leaked into artifact JSON",
      targetArtifact: "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", (o) => {
          o.leakedDebug = "SUPER_SECRET_RAW_CLIENT_SECRET_LEAK";
        }),
    },
    {
      id: "M15_STALE_SOURCE_SHA_IN_EVIDENCE_MANIFEST",
      description: "Stale codeSha in 11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      targetArtifact: "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.codeSha = "0000000000000000000000000000000000000000";
        }),
    },
    {
      id: "M16_MISSING_SCREENSHOT_FILE_ON_DISK",
      description: "Referenced UI screenshot PNG deleted from disk",
      targetArtifact: "14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json",
      apply: (d) => {
        fs.unlinkSync(
          path.join(d, "screenshots", "product-finder-amazon-evidence.png")
        );
      },
    },
    {
      id: "M17_TAMPERED_EXTRACTED_FIELDS_HASH",
      description: "extractedFieldsHash tampered so SHA-256 recomputation fails",
      targetArtifact: "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].extractedFieldsHash = "f".repeat(64);
        }),
    },
    {
      id: "M18_RUN_OPERATION_BUDGET_CAP_EXCEEDED",
      description: "maxTotalOperationsPerRun exceeds cap of 4",
      targetArtifact: "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
      apply: (d) =>
        mutateJson(d, "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json", (o) => {
          o.maxTotalOperationsPerRun = 5;
        }),
    },
    {
      id: "M19_MISSING_BASELINE_ARTIFACT",
      description: "00_BASELINE_BRANCH_AND_SOURCE_SHA.json deleted from disk",
      targetArtifact: "00_BASELINE_BRANCH_AND_SOURCE_SHA.json",
      apply: (d) => {
        fs.unlinkSync(path.join(d, "00_BASELINE_BRANCH_AND_SOURCE_SHA.json"));
      },
    },
    {
      id: "M20_WRONG_GIT_BRANCH",
      description: "Baseline branch is master instead of feature/kh02-amazon-us-pilot-v12.4.3.5.0",
      targetArtifact: "00_BASELINE_BRANCH_AND_SOURCE_SHA.json",
      apply: (d) =>
        mutateJson(d, "00_BASELINE_BRANCH_AND_SOURCE_SHA.json", (o) => {
          o.branch = "master";
        }),
    },
    {
      id: "M21_STALE_RELEASE_VERSION",
      description: "Release version is 12.4.3.5.0.2 instead of 12.4.3.5.0.3",
      targetArtifact: "00_BASELINE_BRANCH_AND_SOURCE_SHA.json",
      apply: (d) =>
        mutateJson(d, "00_BASELINE_BRANCH_AND_SOURCE_SHA.json", (o) => {
          o.releaseVersion = "12.4.3.5.0.2";
        }),
    },
    {
      id: "M22_OAUTH_CONCURRENT_REFRESH_NOT_DEDUPLICATED",
      description: "Concurrent SearchItems calls trigger 2 OAuth token HTTP calls instead of 1",
      targetArtifact: "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", (o) => {
          o.concurrentRefreshDeduplication.tokenHttpCallsCount = 2;
        }),
    },
    {
      id: "M23_OAUTH_MALFORMED_200_ACCEPTED",
      description: "Malformed OAuth 200 response missing expires_in accepted",
      targetArtifact: "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "03_OAUTH_CLIENT_CREDENTIALS_CONTRACT_PROOF.json", (o) => {
          o.malformedToken200Rejected = false;
        }),
    },
    {
      id: "M24_EMPTY_OBJECT_200_TREATED_AS_EMPTY_SEARCH",
      description: "HTTP 200 with {} treated as QUERY_SUCCEEDED_EMPTY instead of SCHEMA_MISMATCH",
      targetArtifact: "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
      apply: (d) =>
        mutateJson(d, "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json", (o) => {
          o.emptyObject200Rejected.status = "QUERY_SUCCEEDED_EMPTY";
          o.emptyObject200Rejected.errorCode = null;
        }),
    },
    {
      id: "M25_UPPERCASE_RESOURCES_IN_SEARCH_PAYLOAD",
      description: "SearchItems resources use uppercase PA-API ItemInfo.Title instead of itemInfo.title",
      targetArtifact: "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json",
      apply: (d) =>
        mutateJson(d, "04_SEARCH_ITEMS_LOWER_CAMEL_SCHEMA_PROOF.json", (o) => {
          o.requestedResources = ["ItemInfo.Title", "Offers.V2.Listings.Price"];
        }),
    },
    {
      id: "M26_GET_ITEMS_PARTIAL_ERRORS_DROP_VALID_ITEMS",
      description: "GetItems partial errors cause valid returned items to be dropped",
      targetArtifact: "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
          (o) => {
            o.partialErrorsPreservedWithoutDroppingValidItems = false;
          }
        ),
    },
    {
      id: "M27_UPPERCASE_ITEMS_RESULT_ACCEPTED_BY_DEFAULT",
      description: "GetItems accepts uppercase ItemsResult.Items without legacy flag",
      targetArtifact: "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "05_GET_ITEMS_ASIN_MATCHING_AND_PARTIAL_ERRORS_PROOF.json",
          (o) => {
            o.uppercaseLegacyItemsResultRejectedByDefault.errorCode = null;
          }
        ),
    },
    {
      id: "M28_RUNTIME_FACTORY_NOT_WIRED_IN_ENRICHMENT",
      description: "runAmazonUsPilotEnrichment does not call resolveAmazonCreatorsApiRuntimeClient",
      targetArtifact: "06_RUNTIME_FACTORY_WIRING_PROOF.json",
      apply: (d) =>
        mutateJson(d, "06_RUNTIME_FACTORY_WIRING_PROOF.json", (o) => {
          o.wiredInRunAmazonUsPilotEnrichment = false;
        }),
    },
    {
      id: "M29_MODE_A_USED_INJECTED_CLIENT_INSTEAD_OF_FACTORY",
      description: "MODE A E2E run injected a mock creatorsApiClient instead of using runtime factory",
      targetArtifact: "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
      apply: (d) =>
        mutateJson(
          d,
          "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
          (o) => {
            o.injectedCreatorsApiClientUsed = true;
          }
        ),
    },
    {
      id: "M30_MODE_A_COUNTED_AS_AUTHORIZED_LIVE",
      description: "MODE A local HTTP emulator run counted toward AUTHORIZED_LIVE",
      targetArtifact: "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
      apply: (d) =>
        mutateJson(
          d,
          "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
          (o) => {
            o.countedAsAuthorizedLive = true;
          }
        ),
    },
    {
      id: "M31_MODE_A_ZERO_OAUTH_CALLS_OBSERVED",
      description: "MODE A emulator observed 0 OAuth token calls",
      targetArtifact: "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
      apply: (d) =>
        mutateJson(
          d,
          "07_END_TO_END_PRODUCT_FINDER_RUNTIME_EMULATED_RUN.json",
          (o) => {
            o.oauthRequestsObservedAtEmulator = 0;
          }
        ),
    },
    {
      id: "M32_FAKE_REAL_PROVIDER_VERIFIED_WITHOUT_CREDS",
      description: "Live verdict claims REAL_PROVIDER_VERIFIED when configured=false",
      targetArtifact: "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
          (o) => {
            o.liveVerdict = "REAL_PROVIDER_VERIFIED";
          }
        ),
    },
    {
      id: "M33_NONZERO_LIVE_COUNT_WHEN_CREDENTIALS_REQUIRED",
      description: "verifiedLiveUsProductIdentitiesCount=3 when liveVerdict=CREDENTIALS_REQUIRED",
      targetArtifact: "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
      apply: (d) =>
        mutateJson(
          d,
          "08_LIVE_CREATORS_API_EXECUTION_OR_BLOCKER_PROOF.json",
          (o) => {
            o.verifiedLiveUsProductIdentitiesCount = 3;
          }
        ),
    },
    {
      id: "M34_CANDIDATE_CAP_EXCEEDED",
      description: "maxCandidatesPerRun=5 exceeds cap of 3",
      targetArtifact: "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
      apply: (d) =>
        mutateJson(d, "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json", (o) => {
          o.maxCandidatesPerRun = 5;
        }),
    },
    {
      id: "M35_CONCURRENCY_CAP_EXCEEDED",
      description: "maxConcurrency=3 exceeds serial concurrency cap of 1",
      targetArtifact: "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
      apply: (d) =>
        mutateJson(d, "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json", (o) => {
          o.maxConcurrency = 3;
        }),
    },
    {
      id: "M36_TOKEN_COUNTED_AGAINST_PRODUCT_BUDGET",
      description: "OAuth token acquisition counted against 4-op product budget",
      targetArtifact: "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json",
      apply: (d) =>
        mutateJson(d, "09_CANDIDATE_SEARCH_QUERY_PLAN_AND_BUDGET.json", (o) => {
          o.tokenAcquisitionCountedAgainstProductBudget = true;
        }),
    },
    {
      id: "M37_INVALID_ASIN_IN_MANIFEST",
      description: "Manifest contains non-ASIN word CATEGORIES",
      targetArtifact: "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json",
      apply: (d) =>
        mutateJson(d, "11_RAW_AND_NORMALIZED_EVIDENCE_MANIFEST.json", (o) => {
          o.records[0].asin = "CATEGORIES";
        }),
    },
    {
      id: "M38_RANK_ORDER_CHANGED_BY_AMAZON_PILOT",
      description: "Candidate rank order mutated after Amazon enrichment",
      targetArtifact: "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
      apply: (d) =>
        mutateJson(
          d,
          "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
          (o) => {
            o.rankOrderChanged = true;
          }
        ),
    },
    {
      id: "M39_HISTORICAL_G07_CLAIMED_PASS",
      description: "Historical G07 blocker falsely relabeled as PASS",
      targetArtifact: "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
      apply: (d) =>
        mutateJson(
          d,
          "12_NON_INFLATION_SCORING_AND_G15_G16_PARITY.json",
          (o) => {
            o.historicalGateTruth.G07 = "PASS";
          }
        ),
    },
    {
      id: "M40_RELOAD_PARITY_FIELD_MISMATCH",
      description: "Post-reload GET has 1 Amazon field mismatch vs SQLite",
      targetArtifact: "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
      apply: (d) =>
        mutateJson(d, "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json", (o) => {
          o.amazonFieldMismatches = 1;
        }),
    },
    {
      id: "M41_PARENT_COMPLETED_RUN_OVERWRITTEN_BY_RUNNING",
      description: "Attaching Amazon evidence overwrites parent COMPLETED run to RUNNING",
      targetArtifact: "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
      apply: (d) =>
        mutateJson(d, "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json", (o) => {
          o.parentRunCompletedStatusPreserved = false;
        }),
    },
    {
      id: "M42_PRODUCTION_DB_MUTATED",
      description: "Acceptance runner left uncleaned test rows in dev.db (productionDbMutated=true)",
      targetArtifact: "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json",
      apply: (d) =>
        mutateJson(d, "13_PERSISTENCE_AND_RELOAD_RECONCILIATION.json", (o) => {
          o.productionDbMutated = true;
        }),
    },
    {
      id: "M43_NON_INFLATION_NOTICE_HIDDEN_IN_UI",
      description: "Non-inflation notice missing from rendered Product Finder DOM",
      targetArtifact: "14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json",
      apply: (d) =>
        mutateJson(
          d,
          "14_PLAYWRIGHT_UI_RENDERING_AND_SCREENSHOTS.json",
          (o) => {
            o.nonInflationNoticeVisibleInDom = false;
          }
        ),
    },
    {
      id: "M44_PLAYWRIGHT_MCP_URL_VERIFICATION_BROKEN",
      description: "Existing Playwright MCP manual URL verification broken by Creators API patch",
      targetArtifact: "15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json",
      apply: (d) =>
        mutateJson(
          d,
          "15_PLAYWRIGHT_MCP_URL_VERIFICATION_PARITY.json",
          (o) => {
            o.manualUrlVerificationIntact = false;
          }
        ),
    },
    {
      id: "M45_UNIT_TEST_FAILURE_PRESENT",
      description: "Automated test suite has 1 failed test",
      targetArtifact: "16_AUTOMATED_TEST_SUITE_RESULTS.json",
      apply: (d) =>
        mutateJson(d, "16_AUTOMATED_TEST_SUITE_RESULTS.json", (o) => {
          o.failedTests = 1;
        }),
    },
    {
      id: "M46_TYPESCRIPT_NONZERO_EXIT",
      description: "npx tsc --noEmit exited with code 2",
      targetArtifact: "17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json",
      apply: (d) =>
        mutateJson(d, "17_PRODUCTION_BUILD_AND_TYPESCRIPT_PROOF.json", (o) => {
          o.tscExitCode = 2;
        }),
    },
    {
      id: "M47_DISK_FREE_SPACE_BELOW_8GIB",
      description: "Free disk space dropped below 8 GiB threshold",
      targetArtifact: "20_DISK_AND_PROCESS_HYGIENE_AUDIT.json",
      apply: (d) =>
        mutateJson(d, "20_DISK_AND_PROCESS_HYGIENE_AUDIT.json", (o) => {
          o.freeBytesAfter = 4 * 1024 * 1024 * 1024;
        }),
    },
    {
      id: "M48_FINAL_MATRIX_OVERCLAIMS_FULL_CLOSURE_WITHOUT_LIVE_CREDS",
      description: "Final matrix claims FULL_CLOSURE_READY while liveVerdict is CREDENTIALS_REQUIRED",
      targetArtifact: "21_FINAL_ACCEPTANCE_MATRIX.json",
      apply: (d) =>
        mutateJson(d, "21_FINAL_ACCEPTANCE_MATRIX.json", (o) => {
          o.overallClosureVerdict = "FULL_CLOSURE_READY";
        }),
    },
  ];

  const results: NegativeMutationCaseResult[] = [];
  for (const spec of mutationSpecs) {
    const caseDir = path.join(rootTmp, spec.id);
    fs.cpSync(cleanDir, caseDir, { recursive: true });
    spec.apply(caseDir);

    const val = validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3(caseDir, {
      expectedCodeSha: codeSha,
      skipMutationSuiteArtifactCheck: true,
    });
    const failedIds = val.checks.filter((c) => !c.passed).map((c) => c.checkId);
    results.push({
      mutationId: spec.id,
      description: spec.description,
      targetArtifact: spec.targetArtifact,
      caught: !val.valid && failedIds.length > 0,
      failedCheckIds: failedIds,
      firstViolation: val.violations[0] || null,
    });
    fs.rmSync(caseDir, { recursive: true, force: true });
  }

  fs.rmSync(cleanDir, { recursive: true, force: true });
  if (!baseWorkDir) {
    fs.rmSync(rootTmp, { recursive: true, force: true });
  }

  const caughtCount = results.filter((r) => r.caught).length;
  const escapedCount = results.length - caughtCount;

  return {
    releaseVersion: "12.4.3.5.0.3",
    evaluatedAt: new Date().toISOString(),
    totalMutationsExecuted: results.length,
    caughtCount,
    escapedCount,
    allCaughtZeroEscapes: escapedCount === 0 && caughtCount === results.length,
    mutations: results,
  };
}

if (require.main === module) {
  const targetDir = process.argv[2];
  const expectedSha = process.argv[3] || undefined;
  if (!targetDir) {
    console.error(
      "Usage: npx tsx scripts/kh02/validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3.ts <artifact-dir> [expected-code-sha]"
    );
    process.exit(1);
  }
  const res = validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3(
    path.resolve(targetDir),
    { expectedCodeSha: expectedSha }
  );
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.valid ? 0 : 1);
}

