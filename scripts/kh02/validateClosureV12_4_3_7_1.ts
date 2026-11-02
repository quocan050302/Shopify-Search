/**
 * SWAI KH-02 V12.4.3.7.1 — Independent Fail-Closed Validator & Physical Negative Mutation Suite
 *
 * Verifies:
 * 1. All 34 required V12.4.3.7.1 acceptance artifacts (00..31 + AUDIT_CALL_GRAPH.md + SHA256_MANIFEST.json)
 *    exist, are non-empty, and share identical CODE_SHA.
 * 2. Physical source code invariants in:
 *    - src/services/kh02/marketplace/amazonUsMcpTransport.ts (UI ZIP + USD flow, NO internal fetch('/portal-migration/hz/glow/address-change...'))
 *    - src/services/kh02/marketplace/amazonUsIdentity.ts (standalone reference manifest + fixture downgrade guard)
 *    - src/services/kh02/identity/productCandidateDiscovery.ts
 *    - src/services/kh02/evergreenResearchOrchestrator.ts
 *    - src/app/api/v1/kh02/research/route.ts
 * 3. P0-A: Amazon US Location (ZIP 95829) & USD Commercial Context via Rendered UI Controls (08, 10, 11, 12).
 * 4. P0-B: Standalone Reference / Fixture / Live Evidence Integrity (02).
 * 5. P0-C: Real Network HTTP Server Process -> Separate Worker OS Process (serverPID != workerPID != acceptancePID)
 *    with sourceMode="LIVE_ONLY" for primary strict live gate -> DB -> Real HTTP GET -> Headless Chromium UI reload (03, 04, 14, 15, 16).
 * 6. 50-case V12.4.3.7.1 Test Matrix + Targeted Suites + Full Repository Regression + 12 E2E Specs + DEV/HOLDOUT Replay.
 * 7. Physical-file Negative Mutation Suite (8 isolated source mutations + 48 artifact validator mutations = 56 total mutations >= 54 required).
 */

import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { computeV12_4_3_7_2ReleaseVerdicts } from "./acceptanceTruth";

export const REQUIRED_V12_4_3_7_1_ARTIFACTS = [
  "00_BRANCH_REMOTE_CODE_SHA_AND_TREE.json",
  "01_RUNTIME_MCP_AND_ENV_PRECHECK.json",
  "02_STANDALONE_REFERENCE_PROVENANCE_AND_RAW_BUNDLE_STATUS.json",
  "03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
  "04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER.json",
  "05_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
  "06_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
  "07_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
  "08_AMAZON_UI_LOCATION_AND_CURRENCY_PREFLIGHT.json",
  "09_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json",
  "10_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
  "11_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
  "12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY_VERDICTS.json",
  "13_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
  "14_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json",
  "15_REAL_HTTP_GET_API_PARITY_REPORT.json",
  "16_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json",
  "17_SECONDARY_NICHE_NO_OVERLAP_PROOF.json",
  "18_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json",
  "19_NON_INFLATION_BEFORE_AFTER_PROOF.json",
  "20_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json",
  "21_POSITIVE_AND_NEGATIVE_TEST_MATRIX_RESULTS.json",
  "22_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json",
  "23_FULL_REPOSITORY_REGRESSION_RESULTS.json",
  "24_E2E_SPEC_EXECUTION_RECEIPTS.json",
  "25_HISTORICAL_DEV_REPLAY_2026_10_24.json",
  "26_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
  "27_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
  "28_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json",
  "29_INDEPENDENT_VALIDATOR_REPORT.json",
  "30_FINAL_RELEASE_VERDICT_TABLE.json",
  "31_FINAL_OWNER_REPORT_VI.md",
  "AUDIT_CALL_GRAPH.md",
  "SHA256_MANIFEST.json",
] as const;

export interface ValidatorCheckItemV12_4_3_7_1 {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  detail: string;
}

export interface ValidatorReportV12_4_3_7_1 {
  codeSha: string;
  evaluatedAt: string;
  artifactDir: string;
  overallVerdict: "PASS" | "FAIL";
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  failedCheckIds: string[];
  checks: ValidatorCheckItemV12_4_3_7_1[];
}

export function sha256FileSync(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readJsonSafe(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function validateClosureArtifactsV12_4_3_7_1(
  artifactDir: string,
  options?: {
    expectedCodeSha?: string;
    skipLateStageFiles?: boolean;
    repoRoot?: string;
  }
): ValidatorReportV12_4_3_7_1 {
  const repoRoot = options?.repoRoot || process.cwd();
  const checks: ValidatorCheckItemV12_4_3_7_1[] = [];
  const addCheck = (
    id: string,
    category: string,
    description: string,
    passed: boolean,
    detail: string
  ) => {
    checks.push({ id, category, description, passed: Boolean(passed), detail });
  };

  const lateStageSet = new Set<string>([
    "28_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json",
    "29_INDEPENDENT_VALIDATOR_REPORT.json",
    "31_FINAL_OWNER_REPORT_VI.md",
    "SHA256_MANIFEST.json",
  ]);

  // 1. Check presence and non-emptiness of all required artifacts
  for (const fileName of REQUIRED_V12_4_3_7_1_ARTIFACTS) {
    if (options?.skipLateStageFiles && lateStageSet.has(fileName)) {
      continue;
    }
    const fullPath = path.join(artifactDir, fileName);
    const exists = fs.existsSync(fullPath);
    const size = exists ? fs.statSync(fullPath).size : 0;
    addCheck(
      `FILE_EXISTS_${fileName}`,
      "ARTIFACT_PRESENCE",
      `Artifact ${fileName} exists and is non-empty`,
      exists && size > 10,
      exists ? `size=${size} bytes` : "MISSING"
    );
  }

  const a00 = readJsonSafe(path.join(artifactDir, "00_BRANCH_REMOTE_CODE_SHA_AND_TREE.json"));
  const a01 = readJsonSafe(path.join(artifactDir, "01_RUNTIME_MCP_AND_ENV_PRECHECK.json"));
  const a02 = readJsonSafe(path.join(artifactDir, "02_STANDALONE_REFERENCE_PROVENANCE_AND_RAW_BUNDLE_STATUS.json"));
  const a03 = readJsonSafe(path.join(artifactDir, "03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json"));
  const a04 = readJsonSafe(path.join(artifactDir, "04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER.json"));
  const a05 = readJsonSafe(path.join(artifactDir, "05_LIVE_META_COLLECTION_AND_OBSERVATIONS.json"));
  const a06 = readJsonSafe(path.join(artifactDir, "06_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json"));
  const a07 = readJsonSafe(path.join(artifactDir, "07_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json"));
  const a08 = readJsonSafe(path.join(artifactDir, "08_AMAZON_UI_LOCATION_AND_CURRENCY_PREFLIGHT.json"));
  const a09 = readJsonSafe(path.join(artifactDir, "09_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json"));
  const a10 = readJsonSafe(path.join(artifactDir, "10_AMAZON_LIVE_MCP_OPERATION_LEDGER.json"));
  const a11 = readJsonSafe(path.join(artifactDir, "11_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json"));
  const a12 = readJsonSafe(path.join(artifactDir, "12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY_VERDICTS.json"));
  const a13 = readJsonSafe(path.join(artifactDir, "13_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json"));
  const a14 = readJsonSafe(path.join(artifactDir, "14_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json"));
  const a15 = readJsonSafe(path.join(artifactDir, "15_REAL_HTTP_GET_API_PARITY_REPORT.json"));
  const a16 = readJsonSafe(path.join(artifactDir, "16_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json"));
  const a17 = readJsonSafe(path.join(artifactDir, "17_SECONDARY_NICHE_NO_OVERLAP_PROOF.json"));
  const a18 = readJsonSafe(path.join(artifactDir, "18_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json"));
  const a19 = readJsonSafe(path.join(artifactDir, "19_NON_INFLATION_BEFORE_AFTER_PROOF.json"));
  const a20 = readJsonSafe(path.join(artifactDir, "20_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json"));
  const a21 = readJsonSafe(path.join(artifactDir, "21_POSITIVE_AND_NEGATIVE_TEST_MATRIX_RESULTS.json"));
  const a22 = readJsonSafe(path.join(artifactDir, "22_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json"));
  const a23 = readJsonSafe(path.join(artifactDir, "23_FULL_REPOSITORY_REGRESSION_RESULTS.json"));
  const a24 = readJsonSafe(path.join(artifactDir, "24_E2E_SPEC_EXECUTION_RECEIPTS.json"));
  const a25 = readJsonSafe(path.join(artifactDir, "25_HISTORICAL_DEV_REPLAY_2026_10_24.json"));
  const a26 = readJsonSafe(path.join(artifactDir, "26_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json"));
  const a27 = readJsonSafe(path.join(artifactDir, "27_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json"));
  const a30 = readJsonSafe(path.join(artifactDir, "30_FINAL_RELEASE_VERDICT_TABLE.json"));

  const expectedSha = options?.expectedCodeSha || a00?.codeSha || "";

  // 2. Branch & SHA Precheck (00)
  addCheck(
    "PRECHECK_BRANCH_EXACT",
    "GIT_HYGIENE",
    "Branch is strictly feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
    a00?.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
    `branch=${a00?.branch}`
  );
  addCheck(
    "PRECHECK_SHA_40HEX",
    "GIT_HYGIENE",
    "codeSha is a valid 40-char hex SHA and matches expectedCodeSha",
    typeof a00?.codeSha === "string" &&
      /^[0-9a-f]{40}$/.test(a00.codeSha) &&
      a00.codeSha === expectedSha,
    `codeSha=${a00?.codeSha}, expected=${expectedSha}`
  );
  addCheck(
    "PRECHECK_ANCESTRY_VERIFIED",
    "GIT_HYGIENE",
    "Branch ancestry from origin/QA and V12.4.3.7 baseline SHA is verified",
    a00?.ancestryVerified === true,
    `ancestryVerified=${a00?.ancestryVerified}`
  );

  // Check SHA parity across all JSON artifacts (01..27, 30)
  const jsonArtifactsForSha: Array<[string, any]> = [
    ["01", a01],
    ["02", a02],
    ["03", a03],
    ["04", a04],
    ["05", a05],
    ["06", a06],
    ["07", a07],
    ["08", a08],
    ["09", a09],
    ["10", a10],
    ["11", a11],
    ["12", a12],
    ["13", a13],
    ["14", a14],
    ["15", a15],
    ["16", a16],
    ["17", a17],
    ["18", a18],
    ["19", a19],
    ["20", a20],
    ["21", a21],
    ["22", a22],
    ["23", a23],
    ["24", a24],
    ["25", a25],
    ["26", a26],
    ["27", a27],
    ["30", a30],
  ];
  for (const [id, obj] of jsonArtifactsForSha) {
    const shaVal = obj?.codeSha || obj?.sourceSha;
    addCheck(
      `SHA_PARITY_${id}`,
      "SHA_PARITY",
      `Artifact ${id} carries matching codeSha/sourceSha`,
      Boolean(expectedSha && shaVal === expectedSha),
      `observed=${shaVal}, expected=${expectedSha}`
    );
  }

  // 3. Physical Source Code Invariant Checks
  const transportSourcePath = path.join(
    repoRoot,
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts"
  );
  const identitySourcePath = path.join(
    repoRoot,
    "src/services/kh02/marketplace/amazonUsIdentity.ts"
  );
  const discoverySourcePath = path.join(
    repoRoot,
    "src/services/kh02/identity/productCandidateDiscovery.ts"
  );
  const orchestratorSourcePath = path.join(
    repoRoot,
    "src/services/kh02/evergreenResearchOrchestrator.ts"
  );
  const researchRouteSourcePath = path.join(
    repoRoot,
    "src/app/api/v1/kh02/research/route.ts"
  );

  const transportSourceText = fs.existsSync(transportSourcePath)
    ? fs.readFileSync(transportSourcePath, "utf8")
    : "";
  const identitySourceText = fs.existsSync(identitySourcePath)
    ? fs.readFileSync(identitySourcePath, "utf8")
    : "";
  const discoverySourceText = fs.existsSync(discoverySourcePath)
    ? fs.readFileSync(discoverySourcePath, "utf8")
    : "";
  const orchestratorSourceText = fs.existsSync(orchestratorSourcePath)
    ? fs.readFileSync(orchestratorSourcePath, "utf8")
    : "";
  const researchRouteSourceText = fs.existsSync(researchRouteSourcePath)
    ? fs.readFileSync(researchRouteSourcePath, "utf8")
    : "";

  const hasForbiddenGlowInternalFetch =
    /\/portal-migration\/hz\/glow\/address-change/.test(transportSourceText);
  const hasUiLocationEnsurerFn =
    /export\s+async\s+function\s+ensureAmazonUsDeliveryContextViaUi\s*\(/.test(
      transportSourceText
    );
  const hasUiCommercialReaderFn =
    /export\s+async\s+function\s+readAmazonCommercialContextFromRenderedUi\s*\(/.test(
      transportSourceText
    );
  const hasReferenceDowngradeGuard =
    /EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE/.test(identitySourceText);
  const hasMathRandomInDiscovery = /Math\.random\s*\(/.test(discoverySourceText);
  const hasNormalizeSourceObservationFn =
    /export\s+function\s+normalizeSourceObservation\s*\(/.test(discoverySourceText);
  const hasForbiddenCandidatesSliceFallback =
    /amazonTargetSelection\.selectedCandidates\.length\s*>\s*0\s*\?\s*amazonTargetSelection\.selectedCandidates\s*:\s*candidates\.slice\(0,\s*3\)/.test(
      orchestratorSourceText
    );
  const hasForbiddenAmazonPolicyOverrideGuard =
    /FORBIDDEN_AMAZON_POLICY_OVERRIDE/.test(researchRouteSourceText);

  addCheck(
    "SOURCE_NO_INTERNAL_GLOW_FETCH",
    "SOURCE_INVARIANTS",
    "amazonUsMcpTransport.ts contains zero internal fetch('/portal-migration/hz/glow/address-change...') calls",
    transportSourceText.length > 100 && !hasForbiddenGlowInternalFetch,
    `hasForbiddenGlowFetch=${hasForbiddenGlowInternalFetch}`
  );
  addCheck(
    "SOURCE_HAS_UI_DELIVERY_AND_COMMERCIAL_FUNCTIONS",
    "SOURCE_INVARIANTS",
    "amazonUsMcpTransport.ts exports ensureAmazonUsDeliveryContextViaUi and readAmazonCommercialContextFromRenderedUi",
    hasUiLocationEnsurerFn && hasUiCommercialReaderFn,
    `hasUiEnsurer=${hasUiLocationEnsurerFn}, hasCommercialReader=${hasUiCommercialReaderFn}`
  );
  addCheck(
    "SOURCE_HAS_REFERENCE_DOWNGRADE_GUARD",
    "SOURCE_INVARIANTS",
    "amazonUsIdentity.ts downgrades external reference/fixture inputs from AUTHORIZED_LIVE with EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE",
    identitySourceText.length > 100 && hasReferenceDowngradeGuard,
    `hasReferenceDowngradeGuard=${hasReferenceDowngradeGuard}`
  );
  addCheck(
    "SOURCE_NO_MATH_RANDOM_IN_DISCOVERY",
    "SOURCE_INVARIANTS",
    "productCandidateDiscovery.ts contains zero Math.random() calls and exports normalizeSourceObservation",
    discoverySourceText.length > 100 &&
      !hasMathRandomInDiscovery &&
      hasNormalizeSourceObservationFn,
    `hasMathRandom=${hasMathRandomInDiscovery}, hasNormalizeFn=${hasNormalizeSourceObservationFn}`
  );
  addCheck(
    "SOURCE_NO_CANDIDATES_SLICE_0_3_FALLBACK",
    "SOURCE_INVARIANTS",
    "evergreenResearchOrchestrator.ts does not fall back to candidates.slice(0, 3) when dynamic Amazon target selection returns 0",
    orchestratorSourceText.length > 100 && !hasForbiddenCandidatesSliceFallback,
    `hasForbiddenFallback=${hasForbiddenCandidatesSliceFallback}`
  );
  addCheck(
    "SOURCE_HAS_FORBIDDEN_AMAZON_POLICY_OVERRIDE_GUARD",
    "SOURCE_INVARIANTS",
    "research/route.ts enforces FORBIDDEN_AMAZON_POLICY_OVERRIDE on POST /api/v1/kh02/research",
    researchRouteSourceText.length > 100 && hasForbiddenAmazonPolicyOverrideGuard,
    `hasGuard=${hasForbiddenAmazonPolicyOverrideGuard}`
  );

  // 4. Runtime Precheck & Standalone Reference Provenance (01, 02)
  addCheck(
    "ARTIFACT01_RUNTIME_AND_MCP_PRECHECK",
    "RUNTIME_PRECHECK",
    "Runtime precheck confirms Playwright MCP @0.0.83, Python Meta collector venv, and >= 15 GiB free disk",
    a01?.playwrightMcpPackage === "@playwright/mcp@0.0.83" &&
      a01?.playwrightMcpHandshakePassed === true &&
      a01?.metaCollectorVenvAvailable === true &&
      typeof a01?.freeDiskGiB === "number" &&
      a01.freeDiskGiB >= 15,
    `mcpHandshake=${a01?.playwrightMcpHandshakePassed}, metaVenv=${a01?.metaCollectorVenvAvailable}, diskGiB=${a01?.freeDiskGiB}`
  );
  addCheck(
    "ARTIFACT02_STANDALONE_REFERENCE_PROVENANCE",
    "STANDALONE_CONTRACT",
    "Standalone Amazon reference provenance strictly records USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT, SUMMARY_AND_SCRIPT_ONLY, referenceRawHashVerified=false, and observationClass=TEST_FIXTURE",
    a02?.manifest?.referenceOrigin === "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT" &&
      a02?.manifest?.referenceAvailability === "SUMMARY_AND_SCRIPT_ONLY" &&
      a02?.manifest?.referenceRawHashVerified === false &&
      a02?.manifest?.referenceReplayStatus === "NOT_EXECUTED" &&
      a02?.manifest?.standaloneReferenceStatus === "USER_REPORTED_SEARCH_TO_PDP_PASS" &&
      a02?.manifest?.standaloneAppIntegrationStatus === "NOT_TESTED_BY_REFERENCE" &&
      a02?.parserVerification?.observationClass === "TEST_FIXTURE" &&
      a02?.parserVerification?.fixtureSource === "USER_REPORTED_REFERENCE_FIELDS" &&
      a02?.parserVerification?.asin === "B0D3XGHTJ5" &&
      a02?.parserVerification?.observedCanonicalUrl ===
        "https://www.amazon.com/clp/B0D3XGHTJ5" &&
      a02?.downgradeNegativeTestPassed === true,
    `origin=${a02?.manifest?.referenceOrigin}, rawHashVerified=${a02?.manifest?.referenceRawHashVerified}, obsClass=${a02?.parserVerification?.observationClass}`
  );

  // 5. Real Network HTTP Server Process + Separate Worker Process + Job Fencing Ledger (03, 04)
  addCheck(
    "ARTIFACT03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF",
    "REAL_NETWORK_WORKER_E2E",
    "Real HTTP server process and separate worker OS process have distinct positive PIDs (serverPID != workerPID != acceptancePID) and executionMode === REAL_NETWORK_WORKER_E2E",
    a03?.executionMode === "REAL_NETWORK_WORKER_E2E" &&
      typeof a03?.acceptanceProcessPid === "number" &&
      a03.acceptanceProcessPid > 0 &&
      typeof a03?.serverProcessPid === "number" &&
      a03.serverProcessPid > 0 &&
      typeof a03?.workerProcessPid === "number" &&
      a03.workerProcessPid > 0 &&
      a03.serverProcessPid !== a03.workerProcessPid &&
      a03.serverProcessPid !== a03.acceptanceProcessPid &&
      a03.workerProcessPid !== a03.acceptanceProcessPid &&
      a03?.directRouteImportUsedForPrimaryAcceptance === false &&
      a03?.inProcessExecuteResearchJobUsedForPrimaryAcceptance === false &&
      a03?.processesTerminatedCleanly === true,
    `mode=${a03?.executionMode}, serverPID=${a03?.serverProcessPid}, workerPID=${a03?.workerProcessPid}, acceptancePID=${a03?.acceptanceProcessPid}`
  );
  addCheck(
    "ARTIFACT04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER",
    "REAL_NETWORK_WORKER_E2E",
    "Real network HTTP POST /api/v1/kh02/research (sourceMode=LIVE_ONLY, 0 pre-seeded cache fallback rows in primary workspace) returned 202 and separate worker process claimed and completed job with valid fencing",
    a04?.httpMethod === "POST" &&
      typeof a04?.requestUrl === "string" &&
      a04.requestUrl.startsWith("http://127.0.0.1:") &&
      a04?.postHttpStatus === 202 &&
      a04?.requestSourceMode === "LIVE_ONLY" &&
      a04?.primaryWorkspacePreSeededAdRowCount === 0 &&
      typeof a04?.researchRunId === "string" &&
      a04.researchRunId.length > 5 &&
      a04?.workerClaimed === true &&
      typeof a04?.workerId === "string" &&
      a04.workerId.includes(String(a03?.workerProcessPid || "")) &&
      Boolean(a04?.claimToken) &&
      Boolean(a04?.fencingToken) &&
      a04?.fencingGeneration >= 1 &&
      (a04?.finalJobStatus === "COMPLETED" ||
        a04?.finalJobStatus === "PARTIALLY_COMPLETED"),
    `status=${a04?.postHttpStatus}, sourceMode=${a04?.requestSourceMode}, workerId=${a04?.workerId}, finalStatus=${a04?.finalJobStatus}`
  );

  // 6. Live Meta Collection, Candidate Discovery & Family Deduplication (05, 06, 07)
  addCheck(
    "ARTIFACT05_LIVE_META_COLLECTION_AND_OBSERVATIONS",
    "REAL_PIPELINE",
    "Live Meta upstream collection attempted with sourceMode=LIVE_ONLY for strict gate, separating LIVE_PROVIDER from CACHED_SOURCE with 0 synthetic/cache promotions",
    a05?.liveAttempted === true &&
      typeof a05?.subqueriesExecutedCount === "number" &&
      a05.subqueriesExecutedCount >= 1 &&
      a05?.syntheticPromotedToLiveCount === 0 &&
      a05?.cachePromotedToLiveCount === 0 &&
      (a05?.metaCollectionVerdict === "PASS" ||
        a05?.metaCollectionVerdict === "DEGRADED_OR_ZERO_LIVE" ||
        a05?.metaCollectionVerdict === "BLOCKED_UPSTREAM"),
    `verdict=${a05?.metaCollectionVerdict}, liveObs=${a05?.liveProviderObservationsCount}`
  );
  addCheck(
    "ARTIFACT06_CANDIDATE_DISCOVERY_FUNNEL",
    "REAL_PIPELINE",
    "Candidate discovery funnel separates relevant physical products from non-product/irrelevant items",
    a06?.relevantPhysicalCandidatesCount >= 3 &&
      a06?.nonProductPromotedToShortlistCount === 0 &&
      a06?.irrelevantPromotedToShortlistCount === 0,
    `relevantPhysical=${a06?.relevantPhysicalCandidatesCount}, nonProductPromoted=${a06?.nonProductPromotedToShortlistCount}`
  );
  addCheck(
    "ARTIFACT07_FAMILY_DEDUPLICATION_AND_SHORTLIST",
    "REAL_PIPELINE",
    "Product family deduplication produces 3 distinct families in Top 3 shortlist with order independence and zero shortfall padding",
    a07?.shortlistCount === 3 &&
      a07?.distinctFamiliesInShortlistCount === 3 &&
      a07?.reversedOrderIdentical === true &&
      a07?.shortfallPaddingDetected === false &&
      a07?.provisionalPromotedToEvergreenWinnersCount === 0,
    `shortlist=${a07?.shortlistCount}, distinctFamilies=${a07?.distinctFamiliesInShortlistCount}`
  );

  // 7. Amazon UI Location & Currency Preflight + Live MCP Search -> Observed Href PDP + Two-Tier Identity (08, 09, 10, 11, 12, 13)
  addCheck(
    "ARTIFACT08_AMAZON_UI_LOCATION_AND_CURRENCY_PREFLIGHT",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon UI location & currency preflight uses normal rendered UI controls (zero internal glow fetch) and records truthful before/after location, ZIP, and currency",
    a08?.internalGlowFetchUsed === false &&
      typeof a08?.initialDeliveryHeaderText === "string" &&
      typeof a08?.finalDeliveryHeaderText === "string" &&
      Array.isArray(a08?.stepsExecuted) &&
      a08.stepsExecuted.includes("WAIT_SEARCH_BOX_READY") &&
      (a08?.status === "US_ZIP_VERIFIED" ||
        a08?.status === "ALREADY_US_ZIP" ||
        a08?.status === "US_NOT_CONFIRMED" ||
        a08?.status === "CAPTCHA_BLOCKED" ||
        a08?.status === "AUTHENTICATION_REQUIRED"),
    `status=${a08?.status}, zip=${a08?.observedDeliveryPostalCode}, currency=${a08?.observedDisplayedCurrencyCode}`
  );
  addCheck(
    "ARTIFACT09_AMAZON_TARGET_SELECTION_AND_SEARCH_PLAN",
    "AMAZON_LIVE_COMMERCIAL",
    "Dynamic Amazon target selection selects up to 2 eligible shortlist candidates and derives bounded search intents without candidates.slice(0,3) fallback",
    a09?.targetSelectionLedger?.selectedCount >= 1 &&
      a09?.targetSelectionLedger?.selectedCount <= 2 &&
      a09?.usedForbiddenSliceFallback === false &&
      Array.isArray(a09?.searchIntentPlans) &&
      a09.searchIntentPlans.length >= 1,
    `selectedCount=${a09?.targetSelectionLedger?.selectedCount}, plans=${a09?.searchIntentPlans?.length}`
  );
  addCheck(
    "ARTIFACT10_AMAZON_LIVE_MCP_OPERATION_LEDGER",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon live MCP operation ledger stays within <= 4 logical ops/run and records real UI commercial preflight",
    typeof a10?.operationsAttempted === "number" &&
      a10.operationsAttempted >= 1 &&
      a10.operationsAttempted <= 4 &&
      a10?.homeAndLocationReadbackRecorded === true &&
      a10?.fabricatedLiveSuccess === false,
    `ops=${a10?.operationsAttempted}/4, homeReadback=${a10?.homeAndLocationReadbackRecorded}`
  );
  addCheck(
    "ARTIFACT11_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon search snapshot enforces <= 5 non-sponsored cards cap, preserves observedSearchHref, and marks unvisited cards DISCOVERED_NOT_VERIFIED",
    a11?.maxCardsPerSearchCap === 5 &&
      a11?.sponsoredCardsSelectedCount === 0 &&
      a11?.unvisitedCardsPromotedToVerifiedCount === 0 &&
      (a11?.observedHrefSelectedCount >= 1 || a11?.searchBlockedOrEmpty === true),
    `observedHrefSelected=${a11?.observedHrefSelectedCount}, unvisitedPromoted=${a11?.unvisitedCardsPromotedToVerifiedCount}`
  );
  addCheck(
    "ARTIFACT12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon PDP extraction records commercial context (ZIP, currency, price, seller, availability) and Two-Tier Identity verdicts without false promotions",
    Array.isArray(a12?.evaluatedCandidates) &&
      a12.evaluatedCandidates.length >= 1 &&
      a12?.falseExactProductPromotionCount === 0 &&
      a12?.searchBrandCopiedFromCandidateCount === 0 &&
      a12?.zipBorrowedFromHomepageWhenPdpMissing === false &&
      a12?.usdInferredFromBareDollarSymbolAlone === false,
    `evaluated=${a12?.evaluatedCandidates?.length}, falseExact=${a12?.falseExactProductPromotionCount}`
  );
  addCheck(
    "ARTIFACT13_AMAZON_MCP_SAME_SESSION_LIFECYCLE",
    "AMAZON_LIVE_COMMERCIAL",
    "Same-session REAL_STDIO_MCP lifecycle proves all live ops match sessionId and owned child PID terminated cleanly",
    a13?.transportMode === "REAL_STDIO_MCP" &&
      a13?.serverOrigin === "PINNED_PLAYWRIGHT_MCP" &&
      a13?.allLiveOpsMatchSessionId === true &&
      a13?.mcpSessionClosedCleanly === true &&
      a13?.ownedChildPidTerminated === true &&
      a13?.closedAfterLastToolCompleted === true,
    `sessionId=${a13?.sessionId}, closedCleanly=${a13?.mcpSessionClosedCleanly}, pidTerminated=${a13?.ownedChildPidTerminated}`
  );

  // 8. DB Persistence, Real HTTP GET API Parity & Product Finder UI Chromium Reload Parity (14, 15, 16)
  addCheck(
    "ARTIFACT14_DB_PERSISTENCE_SNAPSHOT",
    "DB_API_UI_PARITY",
    "SyncJob snapshot and ResearchEvidence rows persist atomically and idempotently in SQLite",
    a14?.syncJobPersisted === true &&
      a14?.idempotentRePersistVerified === true &&
      typeof a14?.persistedShortlistCount === "number" &&
      a14.persistedShortlistCount === 3,
    `syncJob=${a14?.syncJobPersisted}, shortlist=${a14?.persistedShortlistCount}, evidenceRows=${a14?.researchEvidenceRowCount}`
  );
  addCheck(
    "ARTIFACT15_REAL_HTTP_GET_API_PARITY",
    "DB_API_UI_PARITY",
    "Real network HTTP GET /leaderboard, GET /research, GET /research/runs/[runId], and GET /marketplace/amazon match SQLite DB snapshot",
    a15?.transportMode === "REAL_NETWORK_HTTP_FETCH" &&
      a15?.parityPassed === true &&
      a15?.leaderboardHttpStatus === 200 &&
      a15?.researchHttpStatus === 200 &&
      a15?.runByIdHttpStatus === 200 &&
      a15?.amazonRouteHttpStatus === 200 &&
      Array.isArray(a15?.mismatches) &&
      a15.mismatches.length === 0,
    `transport=${a15?.transportMode}, parityPassed=${a15?.parityPassed}, mismatches=${a15?.mismatches?.length}`
  );
  addCheck(
    "ARTIFACT16_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY",
    "DB_API_UI_PARITY",
    "Headless Chromium renders Product Finder UI cards and Amazon evidence identically before and after page.reload()",
    a16?.parityPassed === true &&
      a16?.cardsBeforeReloadCount === 3 &&
      a16?.cardsAfterReloadCount === 3 &&
      a16?.provisionalRenderedAsVerifiedEvergreenCount === 0 &&
      Array.isArray(a16?.mismatches) &&
      a16.mismatches.length === 0,
    `parityPassed=${a16?.parityPassed}, cardsBefore=${a16?.cardsBeforeReloadCount}, cardsAfter=${a16?.cardsAfterReloadCount}`
  );

  // 9. Secondary Niche No-Overlap, Walmart Pause, Non-Inflation & Isolation (17, 18, 19, 20)
  addCheck(
    "ARTIFACT17_SECONDARY_NICHE_NO_OVERLAP",
    "SECONDARY_NICHE",
    "Secondary niche ('Home Organization') produces 3 distinct home organization candidates with 0 overlap against 'Pet Gadgets'",
    a17?.primaryNiche === "Pet Gadgets" &&
      a17?.secondaryNiche === "Home Organization" &&
      a17?.secondaryShortlistCount === 3 &&
      a17?.crossNicheOverlapCount === 0 &&
      a17?.parityPassed === true,
    `secondaryShortlist=${a17?.secondaryShortlistCount}, overlap=${a17?.crossNicheOverlapCount}`
  );
  addCheck(
    "ARTIFACT18_WALMART_PAUSED_STATUS",
    "WALMART_PAUSE",
    "Walmart US remains paused (PAUSED_EXTERNAL / PAUSED_BLOCKED_PROVIDER) with 0 live HTTP requests and preserved 2026-11-02 CAPTCHA receipt",
    a18?.policy?.featureEnabled === false &&
      a18?.policy?.liveAllowed === false &&
      a18?.policy?.operationalStatus === "PAUSED_EXTERNAL" &&
      a18?.currentRunLiveWalmartHttpRequests === 0 &&
      a18?.priorLiveBlockerReference?.responseBytes === 16845 &&
      a18?.priorLiveBlockerReference?.responseSha256 ===
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4",
    `liveHttp=${a18?.currentRunLiveWalmartHttpRequests}, status=${a18?.policy?.operationalStatus}`
  );
  addCheck(
    "ARTIFACT19_NON_INFLATION_PROOF",
    "NON_INFLATION",
    "Amazon and Walmart corroboration produce 0 score delta, 0 rank change, and 0 G07/G15/G16 promotion",
    a19?.nonInflationVerified === true &&
      a19?.scoreDeltaAbsMax === 0 &&
      a19?.rankingChanged === false &&
      a19?.g07PromotedCount === 0 &&
      a19?.g15PromotedCount === 0 &&
      a19?.g16PromotedCount === 0,
    `nonInflationVerified=${a19?.nonInflationVerified}, scoreDelta=${a19?.scoreDeltaAbsMax}`
  );
  addCheck(
    "ARTIFACT20_READ_ONLY_GET_AND_WORKSPACE_ISOLATION",
    "SECURITY_ISOLATION",
    "Real HTTP GET endpoints mutate 0 rows, reject cross-workspace access (403/404/empty), and POST rejects client policy overrides (400)",
    a20?.readOnlyVerified === true &&
      a20?.crossWorkspaceDenied === true &&
      a20?.walmartPolicyOverrideRejected400 === true &&
      a20?.amazonPolicyOverrideRejected400 === true,
    `readOnly=${a20?.readOnlyVerified}, crossWs=${a20?.crossWorkspaceDenied}, amzOverride400=${a20?.amazonPolicyOverrideRejected400}`
  );

  // 10. Test Matrix, Targeted Suites, Full Regression & E2E (21, 22, 23, 24)
  addCheck(
    "ARTIFACT21_POSITIVE_AND_NEGATIVE_TEST_MATRIX",
    "TEST_MATRIX",
    "All 50 V12.4.3.7.1 test matrix cases (Groups A..D) executed and passed",
    a21?.allPassed === true &&
      a21?.failedCasesCount === 0 &&
      a21?.totalCasesCount >= 50,
    `passed=${a21?.passedCasesCount}/${a21?.totalCasesCount}`
  );
  addCheck(
    "ARTIFACT22_TARGETED_SUITES_PASSED",
    "TEST_MATRIX",
    "Targeted V12.4.3.7.1 + V12.4.3.7 + V12.4.3.6 + V12.4.3.5.1 unit/integration suites passed with 0 failures",
    a22?.allPassed === true && a22?.failedTests === 0 && a22?.passedTests >= 350,
    `suites=${a22?.passedSuites}/${a22?.totalSuites}, tests=${a22?.passedTests}/${a22?.totalTests}`
  );
  addCheck(
    "ARTIFACT23_FULL_REPOSITORY_REGRESSION",
    "TEST_MATRIX",
    "100% of discovered repository test files (>= 157 files) executed with 0 failures",
    a23?.inventoryComplete === true &&
      a23?.excludedOrDeferredFilesCount === 0 &&
      a23?.failedTestCases === 0 &&
      a23?.executedTestFilesCount >= 157 &&
      a23?.passedTestCases >= 1940,
    `files=${a23?.executedTestFilesCount}/${a23?.totalDiscoveredTestFiles}, tests=${a23?.passedTestCases}/${a23?.totalExecutedTestCases}`
  );
  addCheck(
    "ARTIFACT24_ALL_12_E2E_SPECS_PASSED",
    "TEST_MATRIX",
    "All 12 E2E specs (34 test cases) executed and passed with 0 skips",
    a24?.totalSpecs === 12 &&
      a24?.passedSpecsCount === 12 &&
      a24?.failedSpecsCount === 0 &&
      a24?.skippedWithoutAttemptCount === 0 &&
      a24?.passedE2ETestCases >= 34,
    `specs=${a24?.passedSpecsCount}/${a24?.totalSpecs}, cases=${a24?.passedE2ETestCases}/${a24?.totalE2ETestCases}`
  );

  // 11. Historical DEV (2026-10-24) & HOLDOUT (2026-10-30) Replay + Point-in-Time Audit (25, 26, 27)
  addCheck(
    "ARTIFACT25_DEV_HISTORICAL_REPLAY_2026_10_24",
    "HISTORICAL_BACKTEST",
    "DEV historical replay (2026-10-24) executed with pointInTimeIntegrityVerdict = PASS and 0 post-cutoff rows",
    a25?.split === "DEV" &&
      a25?.backtestEngineExecuted === "PASS" &&
      a25?.pointInTimeIntegrityVerdict === "PASS" &&
      a25?.postCutoffRowsIncludedCount === 0 &&
      a25?.historicalDevBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE",
    `obs=${a25?.historicalObservationCount}, shortlist=${a25?.shortlistCount}, verdict=${a25?.historicalDevBusinessVerdict}`
  );
  addCheck(
    "ARTIFACT26_HOLDOUT_HISTORICAL_REPLAY_2026_10_30",
    "HISTORICAL_BACKTEST",
    "HOLDOUT historical replay (2026-10-30) executed with pointInTimeIntegrityVerdict = PASS and 0 post-cutoff rows",
    a26?.split === "HOLDOUT" &&
      a26?.backtestEngineExecuted === "PASS" &&
      a26?.pointInTimeIntegrityVerdict === "PASS" &&
      a26?.postCutoffRowsIncludedCount === 0 &&
      a26?.shortlistCount === 3 &&
      a26?.verifiedIdentityCount === 0 &&
      a26?.historicalHoldoutBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE",
    `obs=${a26?.historicalObservationCount}, shortlist=${a26?.shortlistCount}, verdict=${a26?.historicalHoldoutBusinessVerdict}`
  );
  addCheck(
    "ARTIFACT27_POINT_IN_TIME_NO_LOOKAHEAD",
    "HISTORICAL_BACKTEST",
    "Point-in-time no-lookahead audit rejects post-cutoff and fixture records across Ads, ResearchProduct, Amazon, and Walmart",
    a27?.pointInTimeIntegrityVerdict === "PASS" &&
      a27?.postCutoffIncludedInReplayCount === 0 &&
      a27?.fixtureRowsIncludedInLiveReplayCount === 0 &&
      a27?.semanticHashAcceptedAsRawProductSchemaProofCount === 0 &&
      a27?.amazonPostCutoffExcludedCount >= 1 &&
      a27?.walmartPostCutoffExcludedCount >= 1,
    `pitVerdict=${a27?.pointInTimeIntegrityVerdict}, postCutoffIncluded=${a27?.postCutoffIncludedInReplayCount}`
  );

  // 12. Final Release Verdict Table (30) — Section 12 Exact Contract & Independent Recomputation
  const vTable = a30?.verdictTable || a30;
  let recomputedVerdictMatch = true;
  if (a30?.verdictsByGate) {
    const recomputed = computeV12_4_3_7_2ReleaseVerdicts({
      expectedCodeSha: expectedSha,
      artifact00BranchAndSha: a00,
      artifact01RuntimePrecheck: a01,
      artifact02StandaloneReference: a02,
      artifact03ServerWorkerProof: a03,
      artifact04HttpPostAndFencing: a04,
      artifact05LiveMeta: a05,
      artifact06DiscoveryFunnel: a06,
      artifact07FamilyDedup: a07,
      artifact08AmazonUiPreflight: a08,
      artifact09AmazonTargetPlan: a09,
      artifact10AmazonMcpLedger: a10,
      artifact11AmazonSearchCards: a11,
      artifact12AmazonPdpVerdicts: a12,
      artifact13AmazonMcpSession: a13,
      artifact14DbPersistence: a14,
      artifact15RealHttpGetParity: a15,
      artifact16UiDomReloadParity: a16,
      artifact17SecondaryNiche: a17,
      artifact18WalmartPaused: a18,
      artifact19NonInflation: a19,
      artifact20ReadOnlyIsolation: a20,
      artifact21TestMatrix: a21,
      artifact22TargetedSuites: a22,
      artifact23FullRegression: a23,
      artifact24E2EReceipts: a24,
      artifact25DevReplay: a25,
      artifact26HoldoutReplay: a26,
      artifact27PointInTimeAudit: a27,
    });
    for (const [gateId, gateStatus] of Object.entries(recomputed.verdictTable)) {
      if (vTable?.[gateId] && vTable[gateId] !== gateStatus) {
        recomputedVerdictMatch = false;
      }
    }
  }
  addCheck(
    "ARTIFACT30_SECTION12_VERDICT_TABLE",
    "RELEASE_VERDICT",
    "Final release verdict table matches Section 12 fail-closed separation of engineering vs live/business verdicts and independent recomputation",
    recomputedVerdictMatch &&
      vTable?.CODE_AND_ENGINEERING_GATES === "PASS" &&
      vTable?.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY === "PASS" &&
      vTable?.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E === "PASS" &&
      (vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "PASS" ||
        vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "DEGRADED_OR_ZERO_LIVE" ||
        vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "BLOCKED_UPSTREAM") &&
      vTable?.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION === "PASS" &&
      (vTable?.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "PASS" ||
        vTable?.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_UI_US_DELIVERY_ZIP_95829 === "PASS" ||
        vTable?.AMAZON_UI_US_DELIVERY_ZIP_95829 === "NOT_CONFIRMED_ON_LIVE_DOM" ||
        vTable?.AMAZON_UI_US_DELIVERY_ZIP_95829 === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "PASS" ||
        vTable?.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "OBSERVED_NON_USD_OR_PARTIAL" ||
        vTable?.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PASS" ||
        vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PARTIAL" ||
        vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PASS" ||
        vTable?.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PARTIAL") &&
      (vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "PASS" ||
        vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION ===
          "PARTIAL_CATEGORY_OR_FAMILY_ONLY" ||
        vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "UNVERIFIED") &&
      vTable?.WALMART_US_LIVE_OPERATIONAL_STATUS === "PAUSED_BLOCKED_PROVIDER" &&
      vTable?.DB_API_UI_RELOAD_PARITY === "PASS" &&
      vTable?.SECONDARY_NICHE_DYNAMIC_SEPARATION === "PASS" &&
      vTable?.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY === "PASS" &&
      vTable?.HISTORICAL_BUSINESS_EVIDENCE === "INSUFFICIENT_EVIDENCE" &&
      vTable?.G07_PAID_MEDIA_PERSISTENCE === "BLOCKED" &&
      vTable?.G15_LONGITUDINAL_DEMAND_60D === "INSUFFICIENT_EVIDENCE" &&
      vTable?.G16_INDEPENDENT_MERCHANT_PROOF === "INSUFFICIENT_EVIDENCE" &&
      vTable?.FULL_KH02_BUSINESS_ACCEPTANCE === "INSUFFICIENT_EVIDENCE" &&
      vTable?.OVERALL_RELEASE_STATUS ===
        "ENGINEERING_AND_COMMERCIAL_FOUNDATION_READY_WITH_TRUTHFUL_LIVE_AND_EXTERNAL_GATES",
    JSON.stringify({
      recomputedVerdictMatch,
      ENG: vTable?.CODE_AND_ENGINEERING_GATES,
      REF: vTable?.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY,
      NET_WKR: vTable?.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E,
      ZIP: vTable?.AMAZON_UI_US_DELIVERY_ZIP_95829,
      USD: vTable?.AMAZON_UI_USD_COMMERCIAL_EXTRACTION,
      BIZ: vTable?.FULL_KH02_BUSINESS_ACCEPTANCE,
    })
  );

  // 13. Late-stage files check when skipLateStageFiles is false
  if (!options?.skipLateStageFiles) {
    const a28 = readJsonSafe(
      path.join(artifactDir, "28_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json")
    );
    addCheck(
      "ARTIFACT28_PHYSICAL_MUTATIONS_ALL_CAUGHT",
      "MUTATION_SUITE",
      "Physical negative mutation suite executed >= 54 mutations with 0 false passes",
      a28?.falsePassesCount === 0 &&
        a28?.totalMutationsExecuted >= 54 &&
        a28?.caughtMutationsCount === a28?.totalMutationsExecuted &&
        a28?.sourceTreeRestoredClean === true,
      `caught=${a28?.caughtMutationsCount}/${a28?.totalMutationsExecuted}, falsePasses=${a28?.falsePassesCount}`
    );

    const manifest = readJsonSafe(path.join(artifactDir, "SHA256_MANIFEST.json"));
    addCheck(
      "SHA256_MANIFEST_VALID",
      "MANIFEST",
      "SHA256_MANIFEST.json lists >= 33 artifacts with valid 64-char hex digests",
      Array.isArray(manifest?.files) &&
        manifest.files.length >= 33 &&
        manifest.files.every(
          (f: any) => typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256)
        ),
      `filesCount=${manifest?.files?.length}`
    );
  }

  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = checks.length - passedChecks;
  const failedCheckIds = checks.filter((c) => !c.passed).map((c) => c.id);

  return {
    codeSha: expectedSha,
    evaluatedAt: new Date().toISOString(),
    artifactDir,
    overallVerdict: failedChecks === 0 ? "PASS" : "FAIL",
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    failedCheckIds,
    checks,
  };
}

export interface PhysicalMutationCaseResultV12_4_3_7_1 {
  mutationId: string;
  targetType: "SOURCE_CODE_TEMP_COPY" | "ARTIFACT_FILE_TEMP_COPY";
  targetFile: string;
  description: string;
  caught: boolean;
  failedCheckIds: string[];
  detail: string;
}

/**
 * Runs 8 physical source-file mutations (in an isolated temp copy of the repo root)
 * + 48 physical artifact mutations (in an isolated temp copy of the artifact directory)
 * = 56 physical mutations total (>= 54 required), verifying that every single mutation is caught
 * (`caught === true`, `falsePassesCount === 0`) and the working tree remains 100% clean.
 */
export function runPhysicalNegativeMutationSuiteV12_4_3_7_1(
  artifactDir: string,
  codeSha: string,
  repoRoot: string = process.cwd()
): {
  codeSha: string;
  evaluatedAt: string;
  totalMutationsExecuted: number;
  sourceMutationsExecuted: number;
  artifactMutationsExecuted: number;
  caughtMutationsCount: number;
  falsePassesCount: number;
  sourceTreeRestoredClean: boolean;
  gitDiffBeforeAfterByteCount: number;
  mutations: PhysicalMutationCaseResultV12_4_3_7_1[];
} {
  const results: PhysicalMutationCaseResultV12_4_3_7_1[] = [];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v12-4-3-7-1-mut-"));
  const tempArtDir = path.join(tempRoot, "artifacts");
  const tempRepoRoot = path.join(tempRoot, "repo");
  fs.mkdirSync(tempArtDir, { recursive: true });
  fs.mkdirSync(path.join(tempRepoRoot, "src/services/kh02/marketplace"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tempRepoRoot, "src/services/kh02/identity"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tempRepoRoot, "src/app/api/v1/kh02/research"), {
    recursive: true,
  });

  for (const f of fs.readdirSync(artifactDir)) {
    const src = path.join(artifactDir, f);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(tempArtDir, f));
    }
  }

  const relSourceFiles = [
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "src/services/kh02/marketplace/amazonUsIdentity.ts",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "src/services/kh02/evergreenResearchOrchestrator.ts",
    "src/app/api/v1/kh02/research/route.ts",
  ];
  const origSourceByRel = new Map<string, string>();
  for (const rel of relSourceFiles) {
    const absOrig = path.join(repoRoot, rel);
    const absTemp = path.join(tempRepoRoot, rel);
    const content = fs.readFileSync(absOrig, "utf8");
    origSourceByRel.set(rel, content);
    fs.writeFileSync(absTemp, content, "utf8");
  }

  const runSourceMutation = (
    mutationId: string,
    relFile: string,
    description: string,
    mutateFn: (src: string) => string
  ) => {
    const absTemp = path.join(tempRepoRoot, relFile);
    const orig = origSourceByRel.get(relFile)!;
    try {
      fs.writeFileSync(absTemp, mutateFn(orig), "utf8");
      const rep = validateClosureArtifactsV12_4_3_7_1(tempArtDir, {
        expectedCodeSha: codeSha,
        skipLateStageFiles: true,
        repoRoot: tempRepoRoot,
      });
      const caught = rep.overallVerdict === "FAIL" && rep.failedChecks > 0;
      results.push({
        mutationId,
        targetType: "SOURCE_CODE_TEMP_COPY",
        targetFile: relFile,
        description,
        caught,
        failedCheckIds: rep.failedCheckIds,
        detail: caught ? `Caught by ${rep.failedCheckIds.join(", ")}` : "FALSE_PASS",
      });
    } finally {
      fs.writeFileSync(absTemp, orig, "utf8");
    }
  };

  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_01",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Reintroduce forbidden internal fetch('/portal-migration/hz/glow/address-change...') in amazonUsMcpTransport.ts",
    (src) => `${src}\nconst _badGlow = "/portal-migration/hz/glow/address-change";\n`
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_02",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported ensureAmazonUsDeliveryContextViaUi from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export async function ensureAmazonUsDeliveryContextViaUi(",
        "async function _hiddenEnsureAmazonUsDeliveryContextViaUi("
      )
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_03",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported readAmazonCommercialContextFromRenderedUi from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export async function readAmazonCommercialContextFromRenderedUi(",
        "async function _hiddenReadAmazonCommercialContextFromRenderedUi("
      )
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_04",
    "src/services/kh02/marketplace/amazonUsIdentity.ts",
    "Remove EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE guard from amazonUsIdentity.ts",
    (src) =>
      src.replace(
        /EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE/g,
        "REMOVED_GUARD"
      )
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_05",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Reintroduce Math.random() synthetic ad ID generation in productCandidateDiscovery.ts",
    (src) => `${src}\nconst _badId = "ad_" + Math.random().toString(36);\n`
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_06",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Remove exported normalizeSourceObservation from productCandidateDiscovery.ts",
    (src) =>
      src.replace(
        "export function normalizeSourceObservation(",
        "function _hiddenNormalizeSourceObservation("
      )
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_07",
    "src/services/kh02/evergreenResearchOrchestrator.ts",
    "Reintroduce forbidden candidates.slice(0, 3) fallback in evergreenResearchOrchestrator.ts",
    (src) =>
      `${src}\nconst _fallback = amazonTargetSelection.selectedCandidates.length > 0 ? amazonTargetSelection.selectedCandidates : candidates.slice(0, 3);\n`
  );
  runSourceMutation(
    "V12_4_3_7_1_SRC_MUT_08",
    "src/app/api/v1/kh02/research/route.ts",
    "Remove FORBIDDEN_AMAZON_POLICY_OVERRIDE guard from POST /api/v1/kh02/research",
    (src) => src.replace(/FORBIDDEN_AMAZON_POLICY_OVERRIDE/g, "ALLOWED_OVERRIDE")
  );

  const runArtifactMutation = (
    mutationId: string,
    targetFile: string,
    description: string,
    mutateJsonFn: (data: any) => void
  ) => {
    const filePath = path.join(tempArtDir, targetFile);
    const originalRaw = fs.readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(originalRaw);
      mutateJsonFn(parsed);
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
      const rep = validateClosureArtifactsV12_4_3_7_1(tempArtDir, {
        expectedCodeSha: codeSha,
        skipLateStageFiles: true,
        repoRoot: tempRepoRoot,
      });
      const caught = rep.overallVerdict === "FAIL" && rep.failedChecks > 0;
      results.push({
        mutationId,
        targetType: "ARTIFACT_FILE_TEMP_COPY",
        targetFile,
        description,
        caught,
        failedCheckIds: rep.failedCheckIds,
        detail: caught ? `Caught by ${rep.failedCheckIds.join(", ")}` : "FALSE_PASS",
      });
    } finally {
      fs.writeFileSync(filePath, originalRaw, "utf8");
    }
  };

  const artifactMutations: Array<[string, string, (d: any) => void]> = [
    [
      "00_BRANCH_REMOTE_CODE_SHA_AND_TREE.json",
      "Mutate branch to master",
      (d) => {
        d.branch = "master";
      },
    ],
    [
      "00_BRANCH_REMOTE_CODE_SHA_AND_TREE.json",
      "Mutate codeSha to wrong SHA",
      (d) => {
        d.codeSha = "0000000000000000000000000000000000000000";
      },
    ],
    [
      "00_BRANCH_REMOTE_CODE_SHA_AND_TREE.json",
      "Set ancestryVerified = false",
      (d) => {
        d.ancestryVerified = false;
      },
    ],
    [
      "01_RUNTIME_MCP_AND_ENV_PRECHECK.json",
      "Set playwrightMcpHandshakePassed = false",
      (d) => {
        d.playwrightMcpHandshakePassed = false;
      },
    ],
    [
      "01_RUNTIME_MCP_AND_ENV_PRECHECK.json",
      "Set freeDiskGiB = 8 (below 15 GiB floor)",
      (d) => {
        d.freeDiskGiB = 8;
      },
    ],
    [
      "02_STANDALONE_REFERENCE_PROVENANCE_AND_RAW_BUNDLE_STATUS.json",
      "Falsely claim referenceRawHashVerified = true",
      (d) => {
        d.manifest.referenceRawHashVerified = true;
      },
    ],
    [
      "02_STANDALONE_REFERENCE_PROVENANCE_AND_RAW_BUNDLE_STATUS.json",
      "Falsely promote parserVerification.observationClass to AUTHORIZED_LIVE",
      (d) => {
        d.parserVerification.observationClass = "AUTHORIZED_LIVE";
      },
    ],
    [
      "03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "Set serverProcessPid === workerProcessPid (same PID violation)",
      (d) => {
        d.workerProcessPid = d.serverProcessPid;
      },
    ],
    [
      "03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "Set directRouteImportUsedForPrimaryAcceptance = true",
      (d) => {
        d.directRouteImportUsedForPrimaryAcceptance = true;
      },
    ],
    [
      "03_REAL_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "Set processesTerminatedCleanly = false",
      (d) => {
        d.processesTerminatedCleanly = false;
      },
    ],
    [
      "04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER.json",
      "Set requestSourceMode = LIVE_WITH_CACHE_FALLBACK for strict live gate",
      (d) => {
        d.requestSourceMode = "LIVE_WITH_CACHE_FALLBACK";
      },
    ],
    [
      "04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER.json",
      "Set primaryWorkspacePreSeededAdRowCount = 9 (pre-seeded cache fallback violation)",
      (d) => {
        d.primaryWorkspacePreSeededAdRowCount = 9;
      },
    ],
    [
      "04_REAL_HTTP_POST_AND_JOB_FENCING_LEDGER.json",
      "Set postHttpStatus = 500",
      (d) => {
        d.postHttpStatus = 500;
      },
    ],
    [
      "05_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
      "Set syntheticPromotedToLiveCount = 1",
      (d) => {
        d.syntheticPromotedToLiveCount = 1;
      },
    ],
    [
      "05_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
      "Set cachePromotedToLiveCount = 2",
      (d) => {
        d.cachePromotedToLiveCount = 2;
      },
    ],
    [
      "06_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
      "Set nonProductPromotedToShortlistCount = 1",
      (d) => {
        d.nonProductPromotedToShortlistCount = 1;
      },
    ],
    [
      "06_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
      "Set irrelevantPromotedToShortlistCount = 1",
      (d) => {
        d.irrelevantPromotedToShortlistCount = 1;
      },
    ],
    [
      "07_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
      "Set distinctFamiliesInShortlistCount = 1",
      (d) => {
        d.distinctFamiliesInShortlistCount = 1;
      },
    ],
    [
      "07_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
      "Set shortfallPaddingDetected = true",
      (d) => {
        d.shortfallPaddingDetected = true;
      },
    ],
    [
      "08_AMAZON_UI_LOCATION_AND_CURRENCY_PREFLIGHT.json",
      "Set internalGlowFetchUsed = true",
      (d) => {
        d.internalGlowFetchUsed = true;
      },
    ],
    [
      "08_AMAZON_UI_LOCATION_AND_CURRENCY_PREFLIGHT.json",
      "Remove WAIT_SEARCH_BOX_READY from stepsExecuted",
      (d) => {
        d.stepsExecuted = [];
      },
    ],
    [
      "09_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json",
      "Set usedForbiddenSliceFallback = true",
      (d) => {
        d.usedForbiddenSliceFallback = true;
      },
    ],
    [
      "10_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
      "Set operationsAttempted = 6 (exceeding 4-op budget cap)",
      (d) => {
        d.operationsAttempted = 6;
      },
    ],
    [
      "10_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
      "Set fabricatedLiveSuccess = true",
      (d) => {
        d.fabricatedLiveSuccess = true;
      },
    ],
    [
      "11_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
      "Set sponsoredCardsSelectedCount = 1",
      (d) => {
        d.sponsoredCardsSelectedCount = 1;
      },
    ],
    [
      "11_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
      "Set unvisitedCardsPromotedToVerifiedCount = 1",
      (d) => {
        d.unvisitedCardsPromotedToVerifiedCount = 1;
      },
    ],
    [
      "12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY_VERDICTS.json",
      "Set falseExactProductPromotionCount = 1",
      (d) => {
        d.falseExactProductPromotionCount = 1;
      },
    ],
    [
      "12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY_VERDICTS.json",
      "Set zipBorrowedFromHomepageWhenPdpMissing = true",
      (d) => {
        d.zipBorrowedFromHomepageWhenPdpMissing = true;
      },
    ],
    [
      "12_AMAZON_PDP_COMMERCIAL_AND_TWO_TIER_IDENTITY_VERDICTS.json",
      "Set usdInferredFromBareDollarSymbolAlone = true",
      (d) => {
        d.usdInferredFromBareDollarSymbolAlone = true;
      },
    ],
    [
      "13_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set mcpSessionClosedCleanly = false",
      (d) => {
        d.mcpSessionClosedCleanly = false;
      },
    ],
    [
      "13_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set ownedChildPidTerminated = false",
      (d) => {
        d.ownedChildPidTerminated = false;
      },
    ],
    [
      "14_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json",
      "Set syncJobPersisted = false",
      (d) => {
        d.syncJobPersisted = false;
      },
    ],
    [
      "15_REAL_HTTP_GET_API_PARITY_REPORT.json",
      "Set transportMode = IN_PROCESS_ROUTE_CALL",
      (d) => {
        d.transportMode = "IN_PROCESS_ROUTE_CALL";
      },
    ],
    [
      "15_REAL_HTTP_GET_API_PARITY_REPORT.json",
      "Set parityPassed = false",
      (d) => {
        d.parityPassed = false;
      },
    ],
    [
      "16_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json",
      "Inject DOM reload mismatch",
      (d) => {
        d.mismatches = ["Reload card count mismatch"];
      },
    ],
    [
      "17_SECONDARY_NICHE_NO_OVERLAP_PROOF.json",
      "Set crossNicheOverlapCount = 1",
      (d) => {
        d.crossNicheOverlapCount = 1;
      },
    ],
    [
      "18_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json",
      "Set currentRunLiveWalmartHttpRequests = 1",
      (d) => {
        d.currentRunLiveWalmartHttpRequests = 1;
      },
    ],
    [
      "19_NON_INFLATION_BEFORE_AFTER_PROOF.json",
      "Set scoreDeltaAbsMax = 4.2",
      (d) => {
        d.scoreDeltaAbsMax = 4.2;
      },
    ],
    [
      "20_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json",
      "Set crossWorkspaceDenied = false",
      (d) => {
        d.crossWorkspaceDenied = false;
      },
    ],
    [
      "21_POSITIVE_AND_NEGATIVE_TEST_MATRIX_RESULTS.json",
      "Set failedCasesCount = 1",
      (d) => {
        d.failedCasesCount = 1;
      },
    ],
    [
      "22_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json",
      "Set failedTests = 1",
      (d) => {
        d.failedTests = 1;
      },
    ],
    [
      "23_FULL_REPOSITORY_REGRESSION_RESULTS.json",
      "Set excludedOrDeferredFilesCount = 1",
      (d) => {
        d.excludedOrDeferredFilesCount = 1;
      },
    ],
    [
      "24_E2E_SPEC_EXECUTION_RECEIPTS.json",
      "Set skippedWithoutAttemptCount = 1",
      (d) => {
        d.skippedWithoutAttemptCount = 1;
      },
    ],
    [
      "25_HISTORICAL_DEV_REPLAY_2026_10_24.json",
      "Set DEV postCutoffRowsIncludedCount = 1",
      (d) => {
        d.postCutoffRowsIncludedCount = 1;
      },
    ],
    [
      "26_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
      "Fabricate HOLDOUT verifiedIdentityCount = 3",
      (d) => {
        d.verifiedIdentityCount = 3;
      },
    ],
    [
      "27_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
      "Set semanticHashAcceptedAsRawProductSchemaProofCount = 1",
      (d) => {
        d.semanticHashAcceptedAsRawProductSchemaProofCount = 1;
      },
    ],
    [
      "30_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate FULL_KH02_BUSINESS_ACCEPTANCE = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
        d.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
      },
    ],
    [
      "30_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate WALMART_US_LIVE_OPERATIONAL_STATUS = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.WALMART_US_LIVE_OPERATIONAL_STATUS = "PASS";
        d.WALMART_US_LIVE_OPERATIONAL_STATUS = "PASS";
      },
    ],
  ];

  artifactMutations.forEach(([file, desc, fn], idx) => {
    runArtifactMutation(
      `V12_4_3_7_1_ART_MUT_${String(idx + 1).padStart(2, "0")}`,
      file,
      desc,
      fn
    );
  });

  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}

  let gitDiffBytes = 0;
  try {
    const diffOut = execSync(
      "git diff -- src/services/kh02/marketplace/amazonUsMcpTransport.ts src/services/kh02/marketplace/amazonUsIdentity.ts src/services/kh02/identity/productCandidateDiscovery.ts src/services/kh02/evergreenResearchOrchestrator.ts src/app/api/v1/kh02/research/route.ts",
      {
        cwd: repoRoot,
        encoding: "utf8",
      }
    );
    gitDiffBytes = Buffer.byteLength(diffOut, "utf8");
  } catch {}

  const caughtMutationsCount = results.filter((r) => r.caught).length;
  const falsePassesCount = results.length - caughtMutationsCount;

  return {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    totalMutationsExecuted: results.length,
    sourceMutationsExecuted: results.filter(
      (r) => r.targetType === "SOURCE_CODE_TEMP_COPY"
    ).length,
    artifactMutationsExecuted: results.filter(
      (r) => r.targetType === "ARTIFACT_FILE_TEMP_COPY"
    ).length,
    caughtMutationsCount,
    falsePassesCount,
    sourceTreeRestoredClean: gitDiffBytes === 0,
    gitDiffBeforeAfterByteCount: gitDiffBytes,
    mutations: results,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const mutateCheck = args.includes("--mutate-check");
  const positional = args.filter((a) => !a.startsWith("--"));
  const targetDir = positional[0]
    ? path.resolve(process.cwd(), positional[0])
    : "";
  if (!targetDir || !fs.existsSync(targetDir)) {
    console.error(
      "Usage: npx tsx scripts/kh02/validateClosureV12_4_3_7_1.ts <artifactDir> [--mutate-check]"
    );
    process.exit(1);
  }
  const rep = validateClosureArtifactsV12_4_3_7_1(targetDir);
  console.log(JSON.stringify(rep, null, 2));
  if (rep.overallVerdict !== "PASS") {
    process.exit(1);
  }
  if (mutateCheck) {
    const mutRep = runPhysicalNegativeMutationSuiteV12_4_3_7_1(
      targetDir,
      rep.codeSha
    );
    console.log(
      `[Mutation Check] Caught ${mutRep.caughtMutationsCount}/${mutRep.totalMutationsExecuted}, falsePasses=${mutRep.falsePassesCount}`
    );
    if (mutRep.falsePassesCount > 0 || mutRep.totalMutationsExecuted < 54) {
      process.exit(1);
    }
  }
}

