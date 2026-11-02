/**
 * SWAI KH-02 V12.4.3.7.2 — Independent Fail-Closed Validator & Expanded 92-Case Physical Negative Mutation Suite
 *
 * Verifies:
 * 1. All 31 required V12.4.3.7.2 acceptance artifacts (00..29 + CALL_GRAPH_AND_FIELD_PROVENANCE.md)
 *    exist, are non-empty, and share identical CODE_SHA.
 * 2. Physical source code invariants in:
 *    - src/services/kh02/marketplace/amazonUsMcpTransport.ts (6-phase UI context proof, zero internal glow fetch)
 *    - src/services/kh02/marketplace/amazonUsIdentity.ts (standalone reference manifest + fixture downgrade guard)
 *    - src/services/kh02/identity/productCandidateDiscovery.ts (verifyLiveMetaObservationProvenance + verifyCandidateLiveLineageChain, zero Math.random)
 *    - src/services/kh02/evergreenResearchOrchestrator.ts (no synthesized requestStarted=true, no candidates.slice(0,3) fallback)
 *    - src/app/api/v1/kh02/research/route.ts (FORBIDDEN_AMAZON_POLICY_OVERRIDE)
 *    - scripts/kh02/acceptanceTruth.ts (computeV12_4_3_7_2ReleaseVerdicts)
 * 3. Independent gate-by-gate verdict recomputation via computeV12_4_3_7_2ReleaseVerdicts matching
 *    24_INDEPENDENT_VERDICT_RECOMPUTATION.json and 25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json.
 * 4. Expanded Physical-file Negative Mutation Suite: 56 baseline mutations + 36 mandatory V12.4.3.7.2
 *    negative scenarios ([1]..[36] from Section 8.D) = 92 physical mutations (0 false passes).
 */

import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { computeV12_4_3_7_2ReleaseVerdicts } from "./acceptanceTruth";
import { validateAmazonUiContextProofConsistency } from "../../src/services/kh02/marketplace/amazonUsMcpTransport";

export const REQUIRED_V12_4_3_7_2_ARTIFACTS = [
  "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
  "01_RUNTIME_DISK_RAM_MCP_VENV_PRECHECK.json",
  "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json",
  "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
  "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
  "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
  "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
  "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
  "08_CORROBORATED_RUN_SHORTLIST_IF_APPLICABLE.json",
  "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
  "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
  "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json",
  "12_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
  "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
  "14_SECONDARY_NICHE_HOME_ORGANIZATION_PROOF.json",
  "15_WALMART_PAUSED_AND_NON_INFLATION_PROOF.json",
  "16_TARGETED_V12_4_3_7_2_TEST_MATRIX_RESULTS.json",
  "17_FULL_REPOSITORY_REGRESSION_SHARD_RECEIPTS.json",
  "18_ALL_12_E2E_SPEC_RECEIPTS.json",
  "19_FRESH_TYPESCRIPT_AND_NEXT_BUILD_RECEIPTS.json",
  "20_HISTORICAL_DEV_REPLAY_2026_10_24.json",
  "21_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
  "22_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
  "23_EXPANDED_NEGATIVE_MUTATION_SUITE_RESULTS.json",
  "24_INDEPENDENT_VERDICT_RECOMPUTATION.json",
  "25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json",
  "26_PROCESS_PID_DISK_RAM_RECONCILIATION.json",
  "27_SHA256_MANIFEST.json",
  "28_FINAL_OWNER_REPORT_VI.md",
  "29_COMMIT_PUSH_REMOTE_HEAD_PROOF.json",
  "CALL_GRAPH_AND_FIELD_PROVENANCE.md",
] as const;

export interface ValidatorCheckItemV12_4_3_7_2 {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  detail: string;
}

export interface ValidatorReportV12_4_3_7_2 {
  codeSha: string;
  evaluatedAt: string;
  artifactDir: string;
  overallVerdict: "PASS" | "FAIL";
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  failedCheckIds: string[];
  recomputedVerdictsMatch: boolean;
  recomputedVerdictMismatches: string[];
  checks: ValidatorCheckItemV12_4_3_7_2[];
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

export function validateClosureArtifactsV12_4_3_7_2(
  artifactDir: string,
  options?: {
    expectedCodeSha?: string;
    skipLateStageFiles?: boolean;
    skipCommitPushProof?: boolean;
    repoRoot?: string;
  }
): ValidatorReportV12_4_3_7_2 {
  const repoRoot = options?.repoRoot || process.cwd();
  const checks: ValidatorCheckItemV12_4_3_7_2[] = [];
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
    "23_EXPANDED_NEGATIVE_MUTATION_SUITE_RESULTS.json",
    "27_SHA256_MANIFEST.json",
    "28_FINAL_OWNER_REPORT_VI.md",
    "29_COMMIT_PUSH_REMOTE_HEAD_PROOF.json",
  ]);

  // 1. Check presence and non-emptiness of all required artifacts
  for (const fileName of REQUIRED_V12_4_3_7_2_ARTIFACTS) {
    if (options?.skipLateStageFiles && lateStageSet.has(fileName)) {
      continue;
    }
    if (
      options?.skipCommitPushProof &&
      fileName === "29_COMMIT_PUSH_REMOTE_HEAD_PROOF.json"
    ) {
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

  const a00 = readJsonSafe(path.join(artifactDir, "00_GIT_BRANCH_CODE_SHA_PRECHECK.json"));
  const a01 = readJsonSafe(path.join(artifactDir, "01_RUNTIME_DISK_RAM_MCP_VENV_PRECHECK.json"));
  const a02 = readJsonSafe(path.join(artifactDir, "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json"));
  const a03 = readJsonSafe(path.join(artifactDir, "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json"));
  const a04 = readJsonSafe(path.join(artifactDir, "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json"));
  const a05 = readJsonSafe(path.join(artifactDir, "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json"));
  const a06 = readJsonSafe(path.join(artifactDir, "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json"));
  const a07 = readJsonSafe(path.join(artifactDir, "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json"));
  const a08 = readJsonSafe(path.join(artifactDir, "08_CORROBORATED_RUN_SHORTLIST_IF_APPLICABLE.json"));
  const a09 = readJsonSafe(path.join(artifactDir, "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json"));
  const a10 = readJsonSafe(path.join(artifactDir, "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json"));
  const a11 = readJsonSafe(path.join(artifactDir, "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json"));
  const a12 = readJsonSafe(path.join(artifactDir, "12_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json"));
  const a13 = readJsonSafe(path.join(artifactDir, "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json"));
  const a14 = readJsonSafe(path.join(artifactDir, "14_SECONDARY_NICHE_HOME_ORGANIZATION_PROOF.json"));
  const a15 = readJsonSafe(path.join(artifactDir, "15_WALMART_PAUSED_AND_NON_INFLATION_PROOF.json"));
  const a16 = readJsonSafe(path.join(artifactDir, "16_TARGETED_V12_4_3_7_2_TEST_MATRIX_RESULTS.json"));
  const a17 = readJsonSafe(path.join(artifactDir, "17_FULL_REPOSITORY_REGRESSION_SHARD_RECEIPTS.json"));
  const a18 = readJsonSafe(path.join(artifactDir, "18_ALL_12_E2E_SPEC_RECEIPTS.json"));
  const a19 = readJsonSafe(path.join(artifactDir, "19_FRESH_TYPESCRIPT_AND_NEXT_BUILD_RECEIPTS.json"));
  const a20 = readJsonSafe(path.join(artifactDir, "20_HISTORICAL_DEV_REPLAY_2026_10_24.json"));
  const a21 = readJsonSafe(path.join(artifactDir, "21_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json"));
  const a22 = readJsonSafe(path.join(artifactDir, "22_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json"));
  const a24 = readJsonSafe(path.join(artifactDir, "24_INDEPENDENT_VERDICT_RECOMPUTATION.json"));
  const a25 = readJsonSafe(path.join(artifactDir, "25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json"));
  const a26 = readJsonSafe(path.join(artifactDir, "26_PROCESS_PID_DISK_RAM_RECONCILIATION.json"));

  const expectedSha = options?.expectedCodeSha || a00?.codeSha || "";

  // 2. Git Branch & SHA Precheck (00)
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
    "Branch ancestry from origin/QA and prior V12.4.3.7.1 baseline SHA is verified",
    a00?.ancestryVerified === true,
    `ancestryVerified=${a00?.ancestryVerified}`
  );

  // Check SHA parity across all JSON artifacts (00..22, 24..26)
  const jsonArtifactsForSha: Array<[string, any]> = [
    ["00", a00],
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
    ["24", a24],
    ["25", a25],
    ["26", a26],
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
  const acceptanceTruthSourcePath = path.join(
    repoRoot,
    "scripts/kh02/acceptanceTruth.ts"
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
  const acceptanceTruthSourceText = fs.existsSync(acceptanceTruthSourcePath)
    ? fs.readFileSync(acceptanceTruthSourcePath, "utf8")
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
  const hasUiPhaseProofBuilderFn =
    /export\s+function\s+buildAmazonUiPhaseContextProof\s*\(/.test(
      transportSourceText
    );
  const hasReferenceDowngradeGuard =
    /EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE/.test(identitySourceText);
  const hasMathRandomInDiscovery = /Math\.random\s*\(/.test(discoverySourceText);
  const hasNormalizeSourceObservationFn =
    /export\s+function\s+normalizeSourceObservation\s*\(/.test(discoverySourceText);
  const hasVerifyLiveMetaObsFn =
    /export\s+function\s+verifyLiveMetaObservationProvenance\s*\(/.test(
      discoverySourceText
    );
  const hasForbiddenCandidatesSliceFallback =
    /amazonTargetSelection\.selectedCandidates\.length\s*>\s*0\s*\?\s*amazonTargetSelection\.selectedCandidates\s*:\s*candidates\.slice\(0,\s*3\)/.test(
      orchestratorSourceText
    );
  const hasForbiddenAmazonPolicyOverrideGuard =
    /FORBIDDEN_AMAZON_POLICY_OVERRIDE/.test(researchRouteSourceText);
  const hasCentralVerdictComputerFn =
    /export\s+function\s+computeV12_4_3_7_2ReleaseVerdicts\s*\(/.test(
      acceptanceTruthSourceText
    );

  addCheck(
    "SOURCE_NO_INTERNAL_GLOW_FETCH",
    "SOURCE_INVARIANTS",
    "amazonUsMcpTransport.ts contains zero internal fetch('/portal-migration/hz/glow/address-change...') calls",
    transportSourceText.length > 100 && !hasForbiddenGlowInternalFetch,
    `hasForbiddenGlowFetch=${hasForbiddenGlowInternalFetch}`
  );
  addCheck(
    "SOURCE_HAS_UI_DELIVERY_COMMERCIAL_AND_PHASE_PROOF_FUNCTIONS",
    "SOURCE_INVARIANTS",
    "amazonUsMcpTransport.ts exports ensureAmazonUsDeliveryContextViaUi, readAmazonCommercialContextFromRenderedUi, and buildAmazonUiPhaseContextProof",
    hasUiLocationEnsurerFn && hasUiCommercialReaderFn && hasUiPhaseProofBuilderFn,
    `hasUiEnsurer=${hasUiLocationEnsurerFn}, hasCommercialReader=${hasUiCommercialReaderFn}, hasPhaseProof=${hasUiPhaseProofBuilderFn}`
  );
  addCheck(
    "SOURCE_HAS_REFERENCE_DOWNGRADE_GUARD",
    "SOURCE_INVARIANTS",
    "amazonUsIdentity.ts downgrades external reference/fixture inputs from AUTHORIZED_LIVE with EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE",
    identitySourceText.length > 100 && hasReferenceDowngradeGuard,
    `hasReferenceDowngradeGuard=${hasReferenceDowngradeGuard}`
  );
  addCheck(
    "SOURCE_NO_MATH_RANDOM_AND_HAS_PROVENANCE_VERIFIER",
    "SOURCE_INVARIANTS",
    "productCandidateDiscovery.ts contains zero Math.random() calls and exports normalizeSourceObservation + verifyLiveMetaObservationProvenance",
    discoverySourceText.length > 100 &&
      !hasMathRandomInDiscovery &&
      hasNormalizeSourceObservationFn &&
      hasVerifyLiveMetaObsFn,
    `hasMathRandom=${hasMathRandomInDiscovery}, hasNormalizeFn=${hasNormalizeSourceObservationFn}, hasVerifyLiveMetaObs=${hasVerifyLiveMetaObsFn}`
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
  addCheck(
    "SOURCE_HAS_CENTRAL_VERDICT_COMPUTER",
    "SOURCE_INVARIANTS",
    "acceptanceTruth.ts exports computeV12_4_3_7_2ReleaseVerdicts",
    acceptanceTruthSourceText.length > 100 && hasCentralVerdictComputerFn,
    `hasCentralVerdictComputerFn=${hasCentralVerdictComputerFn}`
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
    "ARTIFACT04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER",
    "REAL_NETWORK_WORKER_E2E",
    "Real network HTTP POST /api/v1/kh02/research (sourceMode=LIVE_ONLY, 0 pre-seeded cache fallback rows in primary workspace) returned 202 and separate worker process claimed and completed job with valid fencing and >= 1 HTTP poll receipt",
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
      typeof a04?.fencingGeneration === "number" &&
      a04.fencingGeneration >= 1 &&
      typeof a04?.httpPollCount === "number" &&
      a04.httpPollCount >= 1 &&
      Array.isArray(a04?.httpPollReceipts) &&
      a04.httpPollReceipts.length >= 1 &&
      (a04?.finalJobStatus === "COMPLETED" ||
        a04?.finalJobStatus === "PARTIALLY_COMPLETED"),
    `status=${a04?.postHttpStatus}, sourceMode=${a04?.requestSourceMode}, workerId=${a04?.workerId}, finalStatus=${a04?.finalJobStatus}, polls=${a04?.httpPollCount}`
  );

  // 6. Live-Only Meta Query Execution Ledger + Observation->Ad->Candidate Lineage + Shortlist (05, 06, 07, 08)
  const metaQueryList = Array.isArray(a05?.subqueryExecutions)
    ? a05.subqueryExecutions
    : Array.isArray(a05?.metaTelemetry?.queryOutcomes)
    ? a05.metaTelemetry.queryOutcomes
    : [];
  const metaExecutedQueries = metaQueryList.filter(
    (q: any) =>
      q &&
      q.requestStarted === true &&
      q.requestCompleted === true &&
      Number(q.actualApiCalls || 0) > 0 &&
      typeof q.queryId === "string" &&
      q.queryId.length > 0 &&
      typeof q.providerRequestId === "string" &&
      q.providerRequestId.length > 0
  );
  const metaTelemetryKeys =
    a05?.metaTelemetry && typeof a05.metaTelemetry === "object"
      ? Object.keys(a05.metaTelemetry)
      : [];

  addCheck(
    "ARTIFACT05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER",
    "META_PROVENANCE",
    "Live-Only Meta query execution ledger contains non-empty metaTelemetry and authentic subquery execution receipts with zero synthetic/cache promotions",
    a05?.sourceMode === "LIVE_ONLY" &&
      a05?.primaryWorkspacePreSeededAdRowCount === 0 &&
      metaTelemetryKeys.length > 0 &&
      typeof a05?.subqueriesExecutedCount === "number" &&
      a05.subqueriesExecutedCount === metaExecutedQueries.length &&
      a05?.syntheticPromotedToLiveCount === 0 &&
      a05?.cachePromotedToLiveCount === 0 &&
      (a05?.metaCollectionVerdict !== "PASS" ||
        (metaExecutedQueries.length >= 1 &&
          Number(a05?.liveProviderObservationsCount || 0) >= 1 &&
          Number(a05?.persistedAdRecordsCount || 0) >= 1 &&
          Number(a05?.strictLiveShortlistCount || 0) >= 3 &&
          Number(a05?.lineageRejectedCount || 0) === 0)),
    `verdict=${a05?.metaCollectionVerdict}, executedQueries=${metaExecutedQueries.length}, liveObs=${a05?.liveProviderObservationsCount}, lineageRejected=${a05?.lineageRejectedCount}`
  );

  addCheck(
    "ARTIFACT06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE",
    "META_PROVENANCE",
    "Meta observation -> persisted Ad -> candidate lineage verifies runId, workspaceId, queryId, providerRequestId, and externalAdId without cross-workspace or synthetic promotion",
    a06?.sourceMode === "LIVE_ONLY" &&
      a06?.syntheticPromotedToLiveCount === 0 &&
      a06?.cachePromotedToLiveCount === 0 &&
      a06?.crossWorkspaceAdLinkedCount === 0 &&
      a06?.missingPersistedAdInDbCount === 0 &&
      a06?.unexecutedQueryObservationCount === 0 &&
      Array.isArray(a06?.candidateLineageChains) &&
      (a05?.metaCollectionVerdict !== "PASS" ||
        (a06?.lineageRejectedCount === 0 &&
          a06?.lineageVerifiedCandidatesCount >= 3)),
    `verifiedCandidates=${a06?.lineageVerifiedCandidatesCount}, rejectedLinks=${a06?.lineageRejectedCount}`
  );

  addCheck(
    "ARTIFACT07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION",
    "REAL_PIPELINE",
    "Product family deduplication produces 3 distinct families in Top 3 shortlist with order independence and zero shortfall padding",
    a07?.shortlistCount === 3 &&
      a07?.distinctFamiliesInShortlistCount === 3 &&
      a07?.reversedOrderIdentical === true &&
      a07?.shortfallPaddingDetected === false &&
      a07?.provisionalPromotedToEvergreenWinnersCount === 0 &&
      a07?.nonProductPromotedToShortlistCount === 0 &&
      a07?.irrelevantPromotedToShortlistCount === 0,
    `shortlist=${a07?.shortlistCount}, distinctFamilies=${a07?.distinctFamiliesInShortlistCount}`
  );

  addCheck(
    "ARTIFACT08_CORROBORATED_RUN_SEPARATION",
    "META_PROVENANCE",
    "Corroborated run (LIVE_WITH_CACHE_FALLBACK, if applicable) is explicitly separated from strict LIVE_ONLY gate",
    typeof a08?.usedCorroboratedFallbackRun === "boolean" &&
      a08?.promotedToStrictLiveOnlyGate === false &&
      typeof a08?.shortlistCount === "number" &&
      a08.shortlistCount === 3,
    `usedCorroboratedFallback=${a08?.usedCorroboratedFallbackRun}, promotedToStrictLive=${a08?.promotedToStrictLiveOnlyGate}`
  );

  // 7. Amazon UI 6-Phase Context Proof + Search Cards + PDP Verdicts + Same-Session Lifecycle (09, 10, 11, 12)
  const uiProofCheck = a09
    ? validateAmazonUiContextProofConsistency(a09)
    : { valid: false, contradictions: ["MISSING_ARTIFACT_09"] };

  addCheck(
    "ARTIFACT09_AMAZON_UI_6_PHASE_CONTEXT_CONSISTENCY",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon UI location & currency context proof records all 6 phases on the same session/workspace/run with zero internal contradictions and zero internal glow fetch",
    a09?.internalGlowFetchUsed === false &&
      Boolean(a09?.phase1_initial_home) &&
      Boolean(a09?.phase2_zip_dialog_action) &&
      Boolean(a09?.phase3_home_readback) &&
      Boolean(a09?.phase4_search_readback) &&
      Boolean(a09?.phase5_pdp_readback) &&
      Boolean(a09?.phase6_post_session_close) &&
      Array.isArray(a09?.contradictionsDetected) &&
      a09.contradictionsDetected.length === 0 &&
      uiProofCheck.valid === true &&
      a09?.workspaceId === a10?.workspaceId &&
      a09?.researchRunId === a10?.researchRunId &&
      a09?.workspaceId === a11?.workspaceId &&
      a09?.researchRunId === a11?.researchRunId,
    `valid=${uiProofCheck.valid}, contradictions=${JSON.stringify(
      uiProofCheck.contradictions
    )}, zipVerdict=${a09?.finalZipVerdict}, usdVerdict=${a09?.finalUsdCommercialVerdict}`
  );

  addCheck(
    "ARTIFACT10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS",
    "AMAZON_LIVE_COMMERCIAL",
    "Dynamic Amazon target selection selects <= 2 targets without slice(0,3) fallback and search cards enforce <= 5 non-sponsored cap",
    a10?.usedForbiddenSliceFallback === false &&
      a10?.targetSelectionLedger?.selectedCount >= 1 &&
      a10?.targetSelectionLedger?.selectedCount <= 2 &&
      a10?.maxCardsPerSearchCap === 5 &&
      a10?.sponsoredCardsSelectedCount === 0 &&
      a10?.unvisitedCardsPromotedToVerifiedCount === 0 &&
      typeof a10?.operationsAttempted === "number" &&
      a10.operationsAttempted >= 1 &&
      a10.operationsAttempted <= 4 &&
      a10?.fabricatedLiveSuccess === false,
    `selected=${a10?.targetSelectionLedger?.selectedCount}, ops=${a10?.operationsAttempted}/4, observedHrefSelected=${a10?.observedHrefSelectedCount}`
  );

  addCheck(
    "ARTIFACT11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon PDP extraction records commercial context and Two-Tier Identity verdicts without borrowing homepage ZIP or inferring USD from bare $",
    Array.isArray(a11?.evaluatedCandidates) &&
      a11.evaluatedCandidates.length >= 1 &&
      a11?.falseExactProductPromotionCount === 0 &&
      a11?.searchBrandCopiedFromCandidateCount === 0 &&
      a11?.zipBorrowedFromHomepageWhenPdpMissing === false &&
      a11?.usdInferredFromBareDollarSymbolAlone === false,
    `evaluated=${a11?.evaluatedCandidates?.length}, falseExact=${a11?.falseExactProductPromotionCount}`
  );

  addCheck(
    "ARTIFACT12_AMAZON_MCP_SAME_SESSION_LIFECYCLE",
    "AMAZON_LIVE_COMMERCIAL",
    "Same-session REAL_STDIO_MCP lifecycle proves all live ops match sessionId and owned child PID terminated cleanly after last tool call",
    a12?.transportMode === "REAL_STDIO_MCP" &&
      a12?.serverOrigin === "PINNED_PLAYWRIGHT_MCP" &&
      typeof a12?.sessionId === "string" &&
      a12.sessionId.length > 0 &&
      a12?.allLiveOpsMatchSessionId === true &&
      a12?.mcpSessionClosedCleanly === true &&
      a12?.ownedChildPidTerminated === true &&
      a12?.closedAfterLastToolCompleted === true,
    `sessionId=${a12?.sessionId}, closedCleanly=${a12?.mcpSessionClosedCleanly}, pidTerminated=${a12?.ownedChildPidTerminated}`
  );

  // 8. DB -> HTTP GET -> Headless Chromium DOM Reload Parity + Secondary Niche + Walmart Pause & Non-Inflation (13, 14, 15)
  addCheck(
    "ARTIFACT13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY",
    "DB_API_UI_PARITY",
    "SQLite DB, Real Network HTTP GET endpoints, and Headless Chromium DOM before/after page.reload() match with 0 mismatches and enforce read-only GET + workspace isolation",
    a13?.dbPersistence?.syncJobPersisted === true &&
      a13?.dbPersistence?.idempotentRePersistVerified === true &&
      a13?.dbPersistence?.persistedShortlistCount === 3 &&
      a13?.httpGetParity?.transportMode === "REAL_NETWORK_HTTP_FETCH" &&
      a13?.httpGetParity?.parityPassed === true &&
      Array.isArray(a13?.httpGetParity?.mismatches) &&
      a13.httpGetParity.mismatches.length === 0 &&
      a13?.uiDomReloadParity?.parityPassed === true &&
      a13?.uiDomReloadParity?.cardsBeforeReloadCount === 3 &&
      a13?.uiDomReloadParity?.cardsAfterReloadCount === 3 &&
      a13?.uiDomReloadParity?.provisionalRenderedAsVerifiedEvergreenCount === 0 &&
      Array.isArray(a13?.uiDomReloadParity?.mismatches) &&
      a13.uiDomReloadParity.mismatches.length === 0 &&
      JSON.stringify(a13?.httpGetParity?.shortlistIdsInDb) ===
        JSON.stringify(a13?.httpGetParity?.shortlistIdsInLeaderboardApi) &&
      JSON.stringify(a13?.httpGetParity?.shortlistIdsInDb) ===
        JSON.stringify(a13?.uiDomReloadParity?.domCandidateIdsAfterReload) &&
      a13?.readOnlyAndIsolation?.readOnlyVerified === true &&
      a13?.readOnlyAndIsolation?.crossWorkspaceDenied === true &&
      a13?.readOnlyAndIsolation?.walmartPolicyOverrideRejected400 === true &&
      a13?.readOnlyAndIsolation?.amazonPolicyOverrideRejected400 === true,
    `httpParity=${a13?.httpGetParity?.parityPassed}, domParity=${a13?.uiDomReloadParity?.parityPassed}, readOnly=${a13?.readOnlyAndIsolation?.readOnlyVerified}`
  );

  addCheck(
    "ARTIFACT14_SECONDARY_NICHE_HOME_ORGANIZATION_PROOF",
    "SECONDARY_NICHE",
    "Secondary niche ('Home Organization') produces 3 distinct home organization candidates with 0 overlap against 'Pet Gadgets'",
    a14?.primaryNiche === "Pet Gadgets" &&
      a14?.secondaryNiche === "Home Organization" &&
      a14?.secondaryShortlistCount === 3 &&
      a14?.crossNicheOverlapCount === 0 &&
      a14?.parityPassed === true,
    `secondaryShortlist=${a14?.secondaryShortlistCount}, overlap=${a14?.crossNicheOverlapCount}`
  );

  addCheck(
    "ARTIFACT15_WALMART_PAUSED_AND_NON_INFLATION_PROOF",
    "WALMART_AND_NON_INFLATION",
    "Walmart US remains paused with 0 live HTTP requests and preserved 2026-11-02 CAPTCHA receipt; Amazon & Walmart produce 0 score/rank/gate inflation",
    a15?.walmartPaused?.policy?.featureEnabled === false &&
      a15?.walmartPaused?.policy?.liveAllowed === false &&
      a15?.walmartPaused?.policy?.operationalStatus === "PAUSED_EXTERNAL" &&
      a15?.walmartPaused?.currentRunLiveWalmartHttpRequests === 0 &&
      a15?.walmartPaused?.priorLiveBlockerReference?.responseBytes === 16845 &&
      a15?.walmartPaused?.priorLiveBlockerReference?.responseSha256 ===
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4" &&
      a15?.nonInflation?.nonInflationVerified === true &&
      a15?.nonInflation?.scoreDeltaAbsMax === 0 &&
      a15?.nonInflation?.rankingChanged === false &&
      a15?.nonInflation?.g07PromotedCount === 0 &&
      a15?.nonInflation?.g15PromotedCount === 0 &&
      a15?.nonInflation?.g16PromotedCount === 0,
    `wmtLiveHttp=${a15?.walmartPaused?.currentRunLiveWalmartHttpRequests}, scoreDelta=${a15?.nonInflation?.scoreDeltaAbsMax}`
  );

  // 9. Targeted Matrix, Full Regression Shards, 12 E2E Specs, Fresh TypeScript & Next Build (16, 17, 18, 19)
  addCheck(
    "ARTIFACT16_TARGETED_V12_4_3_7_2_TEST_MATRIX",
    "TEST_MATRIX",
    "Targeted V12.4.3.7.2 + V12.4.3.7.1 + prior KH-02 suites executed and passed with 0 failures",
    a16?.allPassed === true &&
      a16?.failedCasesCount === 0 &&
      a16?.totalCasesCount >= 86 &&
      a16?.targetedSuitesFailedTests === 0,
    `matrixPassed=${a16?.passedCasesCount}/${a16?.totalCasesCount}, targetedTests=${a16?.targetedSuitesPassedTests}/${a16?.targetedSuitesTotalTests}`
  );

  addCheck(
    "ARTIFACT17_FULL_REPOSITORY_REGRESSION_SHARDS",
    "TEST_MATRIX",
    "100% of discovered repository test files (>= 158 files) executed across bounded shards with 0 failures and 0 exclusions",
    a17?.inventoryComplete === true &&
      a17?.excludedOrDeferredFilesCount === 0 &&
      a17?.failedTestCases === 0 &&
      a17?.executedTestFilesCount >= 158 &&
      a17?.passedTestCases >= 1970,
    `files=${a17?.executedTestFilesCount}/${a17?.totalDiscoveredTestFiles}, tests=${a17?.passedTestCases}/${a17?.totalExecutedTestCases}`
  );

  addCheck(
    "ARTIFACT18_ALL_12_E2E_SPECS_PASSED",
    "TEST_MATRIX",
    "All 12 E2E specs (>= 34 test cases) executed and passed with 0 skips",
    a18?.totalSpecs === 12 &&
      a18?.passedSpecsCount === 12 &&
      a18?.failedSpecsCount === 0 &&
      a18?.skippedWithoutAttemptCount === 0 &&
      a18?.passedE2ETestCases >= 34,
    `specs=${a18?.passedSpecsCount}/${a18?.totalSpecs}, cases=${a18?.passedE2ETestCases}/${a18?.totalE2ETestCases}`
  );

  addCheck(
    "ARTIFACT19_FRESH_TYPESCRIPT_AND_NEXT_BUILD_RECEIPTS",
    "BUILD_GATES",
    "npx tsc --noEmit and npm run build both succeeded with exitCode === 0 on CODE_SHA",
    a19?.tscOk === true &&
      a19?.tscExitCode === 0 &&
      a19?.buildOk === true &&
      a19?.buildExitCode === 0,
    `tscExit=${a19?.tscExitCode}, buildExit=${a19?.buildExitCode}`
  );

  // 10. Historical DEV (2026-10-24) & HOLDOUT (2026-10-30) Replay + Point-in-Time No-Lookahead (20, 21, 22)
  addCheck(
    "ARTIFACT20_HISTORICAL_DEV_REPLAY_2026_10_24",
    "HISTORICAL_BACKTEST",
    "DEV historical replay (2026-10-24T00:00:00.000Z) executed with pointInTimeIntegrityVerdict = PASS, 0 post-cutoff rows, and truthful INSUFFICIENT_HISTORICAL_EVIDENCE business verdict",
    a20?.split === "DEV" &&
      a20?.asOfCutoffIso === "2026-10-24T00:00:00.000Z" &&
      a20?.backtestEngineExecuted === "PASS" &&
      a20?.pointInTimeIntegrityVerdict === "PASS" &&
      a20?.postCutoffRowsIncludedCount === 0 &&
      a20?.historicalDevBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      a20?.historicalProviderParityVerdict === "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    `obs=${a20?.historicalObservationCount}, shortlist=${a20?.shortlistCount}, biz=${a20?.historicalDevBusinessVerdict}`
  );

  addCheck(
    "ARTIFACT21_HISTORICAL_HOLDOUT_REPLAY_2026_10_30",
    "HISTORICAL_BACKTEST",
    "HOLDOUT historical replay (2026-10-30T12:00:00.000Z) executed with pointInTimeIntegrityVerdict = PASS, 0 post-cutoff rows, and truthful INSUFFICIENT_HISTORICAL_EVIDENCE business verdict",
    a21?.split === "HOLDOUT" &&
      a21?.asOfCutoffIso === "2026-10-30T12:00:00.000Z" &&
      a21?.backtestEngineExecuted === "PASS" &&
      a21?.pointInTimeIntegrityVerdict === "PASS" &&
      a21?.postCutoffRowsIncludedCount === 0 &&
      a21?.shortlistCount === 3 &&
      a21?.verifiedIdentityCount === 0 &&
      a21?.historicalHoldoutBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      a21?.historicalProviderParityVerdict === "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    `obs=${a21?.historicalObservationCount}, shortlist=${a21?.shortlistCount}, biz=${a21?.historicalHoldoutBusinessVerdict}`
  );

  addCheck(
    "ARTIFACT22_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT",
    "HISTORICAL_BACKTEST",
    "Point-in-time no-lookahead audit rejects post-cutoff and fixture records across Ads, ResearchProduct, Amazon, and Walmart",
    a22?.pointInTimeIntegrityVerdict === "PASS" &&
      a22?.postCutoffIncludedInReplayCount === 0 &&
      a22?.fixtureRowsIncludedInLiveReplayCount === 0 &&
      a22?.semanticHashAcceptedAsRawProductSchemaProofCount === 0 &&
      a22?.amazonPostCutoffExcludedCount >= 1 &&
      a22?.walmartPostCutoffExcludedCount >= 1,
    `pitVerdict=${a22?.pointInTimeIntegrityVerdict}, postCutoffIncluded=${a22?.postCutoffIncludedInReplayCount}`
  );

  // 11. Process PID, Disk & RAM Reconciliation (26)
  addCheck(
    "ARTIFACT26_PROCESS_PID_DISK_RAM_RECONCILIATION",
    "RESOURCE_HYGIENE",
    "Process, disk & RAM reconciliation confirms >= 15 GiB free disk throughout run and 0 unreconciled owned Node/MCP child PIDs",
    typeof a26?.minFreeDiskGiB === "number" &&
      a26.minFreeDiskGiB >= 15 &&
      a26?.unreconciledOwnedNodePidsCount === 0 &&
      a26?.unreconciledPlaywrightMcpPidsCount === 0,
    `minFreeDiskGiB=${a26?.minFreeDiskGiB}, unreconciledNode=${a26?.unreconciledOwnedNodePidsCount}, unreconciledMcp=${a26?.unreconciledPlaywrightMcpPidsCount}`
  );

  // 12. Independent Gate-by-Gate Verdict Recomputation (24 & 25)
  const recomputedBundle = computeV12_4_3_7_2ReleaseVerdicts({
    expectedCodeSha: expectedSha,
    artifact00BranchAndSha: a00,
    artifact01RuntimePrecheck: a01,
    artifact02StandaloneReference: a02,
    artifact03ServerWorkerProof: a03,
    artifact04HttpPostAndFencing: a04,
    artifact05LiveMeta: a05,
    artifact06DiscoveryFunnel: a07,
    artifact07FamilyDedup: a07,
    artifact08AmazonUiPreflight: a09,
    artifact09AmazonTargetPlan: a10,
    artifact10AmazonMcpLedger: a10,
    artifact11AmazonSearchCards: a10,
    artifact12AmazonPdpVerdicts: a11,
    artifact13AmazonMcpSession: a12,
    artifact14DbPersistence: a13?.dbPersistence,
    artifact15RealHttpGetParity: a13?.httpGetParity,
    artifact16UiDomReloadParity: a13?.uiDomReloadParity,
    artifact17SecondaryNiche: a14,
    artifact18WalmartPaused: a15?.walmartPaused,
    artifact19NonInflation: a15?.nonInflation,
    artifact20ReadOnlyIsolation: a13?.readOnlyAndIsolation,
    artifact21TestMatrix: a16,
    artifact22TargetedSuites: {
      codeSha: a16?.codeSha,
      allPassed: a16?.allPassed === true && a16?.targetedSuitesFailedTests === 0,
      failedTests: a16?.targetedSuitesFailedTests ?? 1,
      passedTests: a16?.targetedSuitesPassedTests ?? 0,
    },
    artifact23FullRegression: a17,
    artifact24E2EReceipts: a18,
    artifact25DevReplay: a20,
    artifact26HoldoutReplay: a21,
    artifact27PointInTimeAudit: a22,
    buildAndTscReceipt: a19,
    resourceHygieneReceipt: a26,
  });

  const recomputedVerdictMismatches: string[] = [];
  const reportedTable24 = a24?.verdictTable || {};
  const reportedTable25 = a25?.verdictTable || {};

  for (const [gateId, expectedStatus] of Object.entries(
    recomputedBundle.verdictTable
  )) {
    if (reportedTable24[gateId] !== expectedStatus) {
      recomputedVerdictMismatches.push(
        `24.${gateId}: reported=${reportedTable24[gateId]} vs recomputed=${expectedStatus}`
      );
    }
    if (reportedTable25[gateId] !== expectedStatus) {
      recomputedVerdictMismatches.push(
        `25.${gateId}: reported=${reportedTable25[gateId]} vs recomputed=${expectedStatus}`
      );
    }
  }

  // Also verify engineering gates are PASS and business gates are fail-closed
  const vt = recomputedBundle.verdictTable;
  const mandatoryEngineeringAndTruthGatesOk =
    recomputedVerdictMismatches.length === 0 &&
    vt.CODE_AND_ENGINEERING_GATES === "PASS" &&
    vt.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY === "PASS" &&
    vt.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E === "PASS" &&
    (vt.META_LIVE_CURRENT_RUN_COLLECTION === "PASS" ||
      vt.META_LIVE_CURRENT_RUN_COLLECTION === "DEGRADED_OR_ZERO_LIVE" ||
      vt.META_LIVE_CURRENT_RUN_COLLECTION === "BLOCKED_UPSTREAM") &&
    vt.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION === "PASS" &&
    (vt.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "PASS" ||
      vt.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "BLOCKED_ACCESS_CHALLENGE") &&
    (vt.AMAZON_UI_US_DELIVERY_ZIP_95829 === "PASS" ||
      vt.AMAZON_UI_US_DELIVERY_ZIP_95829 === "NOT_CONFIRMED_ON_LIVE_DOM" ||
      vt.AMAZON_UI_US_DELIVERY_ZIP_95829 === "BLOCKED_ACCESS_CHALLENGE") &&
    (vt.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "PASS" ||
      vt.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "OBSERVED_NON_USD_OR_PARTIAL" ||
      vt.AMAZON_UI_USD_COMMERCIAL_EXTRACTION === "BLOCKED_ACCESS_CHALLENGE") &&
    (vt.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PASS" ||
      vt.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PARTIAL" ||
      vt.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "BLOCKED_ACCESS_CHALLENGE") &&
    (vt.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PASS" ||
      vt.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PARTIAL") &&
    (vt.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "PASS" ||
      vt.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION ===
        "PARTIAL_CATEGORY_OR_FAMILY_ONLY" ||
      vt.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "UNVERIFIED") &&
    vt.WALMART_US_LIVE_OPERATIONAL_STATUS === "PAUSED_BLOCKED_PROVIDER" &&
    vt.DB_API_UI_RELOAD_PARITY === "PASS" &&
    vt.SECONDARY_NICHE_DYNAMIC_SEPARATION === "PASS" &&
    vt.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY === "PASS" &&
    vt.HISTORICAL_BUSINESS_EVIDENCE === "INSUFFICIENT_EVIDENCE" &&
    vt.G07_PAID_MEDIA_PERSISTENCE === "BLOCKED" &&
    vt.G15_LONGITUDINAL_DEMAND_60D === "INSUFFICIENT_EVIDENCE" &&
    vt.G16_INDEPENDENT_MERCHANT_PROOF === "INSUFFICIENT_EVIDENCE" &&
    vt.FULL_KH02_BUSINESS_ACCEPTANCE === "INSUFFICIENT_EVIDENCE";

  addCheck(
    "ARTIFACT24_25_INDEPENDENT_VERDICT_RECOMPUTATION_EXACT_MATCH",
    "RELEASE_VERDICT",
    "Independent verdict recomputation matches 24_INDEPENDENT_VERDICT_RECOMPUTATION.json and 25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json across all gates with zero false PASS",
    mandatoryEngineeringAndTruthGatesOk,
    recomputedVerdictMismatches.length === 0
      ? `All ${Object.keys(recomputedBundle.verdictTable).length} gates matched recomputation`
      : `Mismatches: ${recomputedVerdictMismatches.join("; ")}`
  );

  // 13. Late-stage files check when skipLateStageFiles is false
  if (!options?.skipLateStageFiles) {
    const a23 = readJsonSafe(
      path.join(artifactDir, "23_EXPANDED_NEGATIVE_MUTATION_SUITE_RESULTS.json")
    );
    addCheck(
      "ARTIFACT23_EXPANDED_NEGATIVE_MUTATIONS_ALL_CAUGHT",
      "MUTATION_SUITE",
      "Expanded physical negative mutation suite executed >= 90 mutations (including all 36 V12.4.3.7.2 negative scenarios) with 0 false passes",
      a23?.falsePassesCount === 0 &&
        a23?.totalMutationsExecuted >= 90 &&
        a23?.caughtMutationsCount === a23?.totalMutationsExecuted &&
        a23?.sourceTreeRestoredClean === true,
      `caught=${a23?.caughtMutationsCount}/${a23?.totalMutationsExecuted}, falsePasses=${a23?.falsePassesCount}`
    );

    const manifest = readJsonSafe(path.join(artifactDir, "27_SHA256_MANIFEST.json"));
    addCheck(
      "ARTIFACT27_SHA256_MANIFEST_VALID",
      "MANIFEST",
      "27_SHA256_MANIFEST.json lists >= 29 artifacts with valid 64-char hex digests",
      Array.isArray(manifest?.files) &&
        manifest.files.length >= 29 &&
        manifest.files.every(
          (f: any) => typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256)
        ),
      `filesCount=${manifest?.files?.length}`
    );

    if (!options?.skipCommitPushProof) {
      const a29 = readJsonSafe(
        path.join(artifactDir, "29_COMMIT_PUSH_REMOTE_HEAD_PROOF.json")
      );
      addCheck(
        "ARTIFACT29_COMMIT_PUSH_REMOTE_HEAD_PROOF_VALID",
        "GIT_HYGIENE",
        "29_COMMIT_PUSH_REMOTE_HEAD_PROOF.json records verified CODE_SHA and target branch",
        a29?.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" &&
          a29?.codeSha === expectedSha,
        `branch=${a29?.branch}, codeSha=${a29?.codeSha}`
      );
    }
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
    recomputedVerdictsMatch: recomputedVerdictMismatches.length === 0,
    recomputedVerdictMismatches,
    checks,
  };
}

export interface PhysicalMutationCaseResultV12_4_3_7_2 {
  mutationId: string;
  scenarioNumber?: number;
  targetType: "SOURCE_CODE_TEMP_COPY" | "ARTIFACT_FILE_TEMP_COPY";
  targetFile: string;
  description: string;
  caught: boolean;
  failedCheckIds: string[];
  detail: string;
}

/**
 * Executes 8 physical source-file mutations + 48 baseline artifact mutations +
 * all 36 mandatory V12.4.3.7.2 negative scenarios ([1]..[36] from Section 8.D) = 92 physical mutations
 * in an isolated temporary copy, proving `caught === total`, `falsePassesCount === 0`,
 * and `sourceTreeRestoredClean === true`.
 */
export function runExpandedPhysicalNegativeMutationSuiteV12_4_3_7_2(
  artifactDir: string,
  codeSha: string,
  repoRoot: string = process.cwd()
): {
  codeSha: string;
  evaluatedAt: string;
  totalMutationsExecuted: number;
  sourceMutationsExecuted: number;
  artifactMutationsExecuted: number;
  mandatoryV12_4_3_7_2ScenariosExecuted: number;
  caughtMutationsCount: number;
  falsePassesCount: number;
  sourceTreeRestoredClean: boolean;
  gitDiffBeforeAfterByteCount: number;
  mutations: PhysicalMutationCaseResultV12_4_3_7_2[];
} {
  const results: PhysicalMutationCaseResultV12_4_3_7_2[] = [];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v12-4-3-7-2-mut-"));
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
  fs.mkdirSync(path.join(tempRepoRoot, "scripts/kh02"), {
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
    "scripts/kh02/acceptanceTruth.ts",
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
      const rep = validateClosureArtifactsV12_4_3_7_2(tempArtDir, {
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

  // 8 Physical Source-Code Temp-Copy Mutations
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_01",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Reintroduce forbidden internal fetch('/portal-migration/hz/glow/address-change...') in amazonUsMcpTransport.ts",
    (src) => `${src}\nconst _badGlow = "/portal-migration/hz/glow/address-change";\n`
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_02",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported ensureAmazonUsDeliveryContextViaUi from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export async function ensureAmazonUsDeliveryContextViaUi(",
        "async function _hiddenEnsureAmazonUsDeliveryContextViaUi("
      )
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_03",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported buildAmazonUiPhaseContextProof from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export function buildAmazonUiPhaseContextProof(",
        "function _hiddenBuildAmazonUiPhaseContextProof("
      )
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_04",
    "src/services/kh02/marketplace/amazonUsIdentity.ts",
    "Remove EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE guard from amazonUsIdentity.ts",
    (src) =>
      src.replace(
        /EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE/g,
        "REMOVED_GUARD"
      )
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_05",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Reintroduce Math.random() synthetic ad ID generation in productCandidateDiscovery.ts",
    (src) => `${src}\nconst _badId = "ad_" + Math.random().toString(36);\n`
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_06",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Remove exported verifyLiveMetaObservationProvenance from productCandidateDiscovery.ts",
    (src) =>
      src.replace(
        "export function verifyLiveMetaObservationProvenance(",
        "function _hiddenVerifyLiveMetaObservationProvenance("
      )
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_07",
    "src/services/kh02/evergreenResearchOrchestrator.ts",
    "Reintroduce forbidden candidates.slice(0, 3) fallback in evergreenResearchOrchestrator.ts",
    (src) =>
      `${src}\nconst _fallback = amazonTargetSelection.selectedCandidates.length > 0 ? amazonTargetSelection.selectedCandidates : candidates.slice(0, 3);\n`
  );
  runSourceMutation(
    "V12_4_3_7_2_SRC_MUT_08",
    "scripts/kh02/acceptanceTruth.ts",
    "Remove exported computeV12_4_3_7_2ReleaseVerdicts from acceptanceTruth.ts",
    (src) =>
      src.replace(
        "export function computeV12_4_3_7_2ReleaseVerdicts(",
        "function _hiddenComputeV12_4_3_7_2ReleaseVerdicts("
      )
  );

  const runArtifactMutation = (
    mutationId: string,
    targetFile: string,
    description: string,
    mutateJsonFn: (data: any) => void,
    scenarioNumber?: number
  ) => {
    const filePath = path.join(tempArtDir, targetFile);
    const originalRaw = fs.readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(originalRaw);
      mutateJsonFn(parsed);
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");
      const rep = validateClosureArtifactsV12_4_3_7_2(tempArtDir, {
        expectedCodeSha: codeSha,
        skipLateStageFiles: true,
        repoRoot: tempRepoRoot,
      });
      const caught = rep.overallVerdict === "FAIL" && rep.failedChecks > 0;
      results.push({
        mutationId,
        scenarioNumber,
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

  // All 36 Mandatory V12.4.3.7.2 Negative Scenarios ([1]..[36] from Section 8.D)
  const mandatory36NegativeScenarios: Array<
    [number, string, string, (d: any) => void]
  > = [
    // Category 1 — Acceptance Truth & Anti-Hardcode (1..8)
    [
      1,
      "24_INDEPENDENT_VERDICT_RECOMPUTATION.json",
      "[1] Hardcoded PASS in verdict table while underlying test artifact fails",
      (d) => {
        if (d.verdictTable) {
          d.verdictTable.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
        }
      },
    ],
    [
      2,
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "[2] Missing 05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json fields / wrong codeSha",
      (d) => {
        d.codeSha = "0000000000000000000000000000000000000000";
      },
    ],
    [
      3,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[3] Stale artifact with previous commit SHA mixed into current run folder",
      (d) => {
        d.codeSha = "abc78cb97b627c49849db389e6920e19c46c58ae";
      },
    ],
    [
      4,
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "[4] Default fallback subqueriesExecutedCount = 4 when subqueryExecutions is empty",
      (d) => {
        d.subqueryExecutions = [];
        if (d.metaTelemetry) d.metaTelemetry.queryOutcomes = [];
        d.subqueriesExecutedCount = 4;
      },
    ],
    [
      5,
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "[5] Default fallback sourceStatus = 'PASSED' when sourceStatuses.META_ADS is missing and verdict claims PASS",
      (d) => {
        d.metaTelemetry = {};
        d.sourceStatus = "PASSED";
      },
    ],
    [
      6,
      "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
      "[6] Default fallback finalJobStatus = 'COMPLETED' when DB job status is FAILED",
      (d) => {
        d.finalJobStatus = "FAILED";
      },
    ],
    [
      7,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[7] Default fallback searchBoxReady ?? true when search box was not ready",
      (d) => {
        if (d.phase1_initial_home) d.phase1_initial_home.searchBoxReady = false;
        d.searchBoxReady = true;
      },
    ],
    [
      8,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[8] Default fallback stepsExecuted = ['WAIT_SEARCH_BOX_READY'] when stepsExecuted was empty",
      (d) => {
        if (d.phase2_zip_dialog_action) d.phase2_zip_dialog_action.stepsExecuted = [];
        d.stepsExecuted = ["WAIT_SEARCH_BOX_READY"];
      },
    ],
    // Category 2 — Meta Live Provenance & Lineage (9..16)
    [
      9,
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "[9] Planned Meta query marked requestStarted = true without provider call",
      (d) => {
        d.subqueryExecutions = [
          {
            queryId: "q_planned_only",
            planned: true,
            attempted: false,
            requestStarted: true,
            requestCompleted: false,
            actualApiCalls: 0,
            providerRequestId: null,
          },
        ];
        d.subqueriesExecutedCount = 1;
      },
    ],
    [
      10,
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "[10] metaTelemetry: {} while metaCollectionVerdict === 'PASS'",
      (d) => {
        d.metaTelemetry = {};
      },
    ],
    [
      11,
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "[11] Cached observation with isCached=true or sourceType='CACHED_SOURCE' promoted to LIVE_PROVIDER",
      (d) => {
        d.cachePromotedToLiveCount = 1;
      },
    ],
    [
      12,
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "[12] Observation with synthetic/derived ad ID (ad_1, meta_sim_1, Math.random) promoted to LIVE_PROVIDER",
      (d) => {
        d.syntheticPromotedToLiveCount = 1;
      },
    ],
    [
      13,
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "[13] Observation from another workspace linked into wsStrictLive",
      (d) => {
        d.crossWorkspaceAdLinkedCount = 1;
      },
    ],
    [
      14,
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "[14] Candidate in strict live shortlist without persisted CompetitorAd row in DB",
      (d) => {
        d.missingPersistedAdInDbCount = 1;
      },
    ],
    [
      15,
      "08_CORROBORATED_RUN_SHORTLIST_IF_APPLICABLE.json",
      "[15] LIVE_WITH_CACHE_FALLBACK corroborated run counted as strict LIVE_ONLY pass",
      (d) => {
        d.promotedToStrictLiveOnlyGate = true;
      },
    ],
    [
      16,
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "[16] Observation with unexecuted queryId counted as current-run live observation",
      (d) => {
        d.unexecutedQueryObservationCount = 1;
      },
    ],
    // Category 3 — Amazon UI, Commercial & Identity Integrity (17..26)
    [
      17,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[17] Internal fetch('/portal-migration/hz/glow/address-change...') reintroduced in transport",
      (d) => {
        d.internalGlowFetchUsed = true;
      },
    ],
    [
      18,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[18] Top-level artifact09 claims dialogOpened=false while nested homeReadback claims dialogOpened=true",
      (d) => {
        d.dialogOpened = false;
        if (d.phase2_zip_dialog_action) {
          d.phase2_zip_dialog_action.dialogOpened = true;
        }
      },
    ],
    [
      19,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[19] Top-level artifact09 claims observedDeliveryPostalCode=null while final verdict claims AMAZON_UI_US_DELIVERY_ZIP_95829='PASS'",
      (d) => {
        d.observedDeliveryPostalCode = null;
        d.finalZipVerdict = "PASS";
      },
    ],
    [
      20,
      "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json",
      "[20] Homepage shows ZIP 95829, PDP shows Deliver to Vietnam -> PDP falsely inherits US ZIP",
      (d) => {
        d.zipBorrowedFromHomepageWhenPdpMissing = true;
      },
    ],
    [
      21,
      "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json",
      "[21] Bare '$49.99' without explicit USD DOM/meta proof -> falsely marked currency='USD'",
      (d) => {
        d.usdInferredFromBareDollarSymbolAlone = true;
      },
    ],
    [
      22,
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "[22] VND 1,297,853 on PDP -> falsely marked AMAZON_UI_USD_COMMERCIAL_EXTRACTION='PASS'",
      (d) => {
        if (d.phase5_pdp_readback) {
          d.phase5_pdp_readback.usdPdpConfirmedCount = 0;
          d.phase5_pdp_readback.observedCurrencies = ["VND"];
        }
        d.finalUsdCommercialVerdict = "PASS";
      },
    ],
    [
      23,
      "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
      "[23] Unvisited search card promoted to AMAZON_SEARCH_PDP_IDENTITY_VERIFIED",
      (d) => {
        d.unvisitedCardsPromotedToVerifiedCount = 1;
      },
    ],
    [
      24,
      "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json",
      "[24] PDP verified for category-similar product (different brand/model) -> falsely promoted to META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED",
      (d) => {
        d.falseExactProductPromotionCount = 1;
      },
    ],
    [
      25,
      "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json",
      "[25] Standalone reference B0D3XGHTJ5 loaded with observationClass='AUTHORIZED_LIVE'",
      (d) => {
        if (d.parserVerification) {
          d.parserVerification.observationClass = "AUTHORIZED_LIVE";
        }
      },
    ],
    [
      26,
      "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json",
      "[26] Missing raw FINAL_RESULT.json / operation-ledger.json while referenceRawHashVerified=true",
      (d) => {
        if (d.manifest) {
          d.manifest.referenceRawHashVerified = true;
        }
      },
    ],
    // Category 4 — Network, Worker, DB, API, UI & Niche Parity (27..32)
    [
      27,
      "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "[27] Primary acceptance run executed via direct route import or in-process executeResearchJob",
      (d) => {
        d.directRouteImportUsedForPrimaryAcceptance = true;
      },
    ],
    [
      28,
      "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "[28] serverProcessPid === workerProcessPid",
      (d) => {
        d.workerProcessPid = d.serverProcessPid;
      },
    ],
    [
      29,
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "[29] GET /api/v1/kh02/leaderboard mutates SQLite rows",
      (d) => {
        if (d.readOnlyAndIsolation) {
          d.readOnlyAndIsolation.readOnlyVerified = false;
        }
      },
    ],
    [
      30,
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "[30] Cross-workspace GET returns another workspace's evidence",
      (d) => {
        if (d.readOnlyAndIsolation) {
          d.readOnlyAndIsolation.crossWorkspaceDenied = false;
        }
      },
    ],
    [
      31,
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "[31] UI DOM after page.reload() differs from DB/API candidate IDs",
      (d) => {
        if (d.uiDomReloadParity) {
          d.uiDomReloadParity.domCandidateIdsAfterReload = ["cand_tampered_1"];
        }
      },
    ],
    [
      32,
      "14_SECONDARY_NICHE_HOME_ORGANIZATION_PROOF.json",
      "[32] 'Home Organization' shortlist overlaps 'Pet Gadgets' shortlist",
      (d) => {
        d.crossNicheOverlapCount = 1;
      },
    ],
    // Category 5 — Historical Replay, Business Gates & Resource Hygiene (33..36)
    [
      33,
      "20_HISTORICAL_DEV_REPLAY_2026_10_24.json",
      "[33] Post-cutoff record (observedAt > asOfTimestamp) included in DEV or HOLDOUT replay",
      (d) => {
        d.postCutoffRowsIncludedCount = 1;
      },
    ],
    [
      34,
      "22_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
      "[34] TEST_FIXTURE Amazon/Walmart row included in historical replay",
      (d) => {
        d.fixtureRowsIncludedInLiveReplayCount = 1;
      },
    ],
    [
      35,
      "15_WALMART_PAUSED_AND_NON_INFLATION_PROOF.json",
      "[35] Amazon/Walmart evidence changes opportunityScore or promotes G07/G15/G16",
      (d) => {
        if (d.nonInflation) {
          d.nonInflation.scoreDeltaAbsMax = 5.0;
          d.nonInflation.g16PromotedCount = 1;
        }
      },
    ],
    [
      36,
      "26_PROCESS_PID_DISK_RAM_RECONCILIATION.json",
      "[36] Unreconciled owned child PID or free disk < 15 GiB",
      (d) => {
        d.unreconciledPlaywrightMcpPidsCount = 1;
        d.minFreeDiskGiB = 10;
      },
    ],
  ];

  for (const [scenarioNum, file, desc, fn] of mandatory36NegativeScenarios) {
    runArtifactMutation(
      `V12_4_3_7_2_NEG_SCENARIO_${String(scenarioNum).padStart(2, "0")}`,
      file,
      desc,
      fn,
      scenarioNum
    );
  }

  // 48 Baseline Artifact Mutations
  const baseline48ArtifactMutations: Array<[string, string, (d: any) => void]> = [
    [
      "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
      "Mutate branch to master",
      (d) => {
        d.branch = "master";
      },
    ],
    [
      "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
      "Mutate codeSha to wrong SHA",
      (d) => {
        d.codeSha = "0000000000000000000000000000000000000000";
      },
    ],
    [
      "00_GIT_BRANCH_CODE_SHA_PRECHECK.json",
      "Set ancestryVerified = false",
      (d) => {
        d.ancestryVerified = false;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_MCP_VENV_PRECHECK.json",
      "Set playwrightMcpHandshakePassed = false",
      (d) => {
        d.playwrightMcpHandshakePassed = false;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_MCP_VENV_PRECHECK.json",
      "Set freeDiskGiB = 8 (below 15 GiB floor)",
      (d) => {
        d.freeDiskGiB = 8;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_MCP_VENV_PRECHECK.json",
      "Set metaCollectorVenvAvailable = false",
      (d) => {
        d.metaCollectorVenvAvailable = false;
      },
    ],
    [
      "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json",
      "Mutate referenceAvailability to FULL_RAW_BUNDLE",
      (d) => {
        d.manifest.referenceAvailability = "FULL_RAW_BUNDLE";
      },
    ],
    [
      "02_STANDALONE_AMAZON_REFERENCE_INTEGRITY.json",
      "Set downgradeNegativeTestPassed = false",
      (d) => {
        d.downgradeNegativeTestPassed = false;
      },
    ],
    [
      "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "Set inProcessExecuteResearchJobUsedForPrimaryAcceptance = true",
      (d) => {
        d.inProcessExecuteResearchJobUsedForPrimaryAcceptance = true;
      },
    ],
    [
      "03_HTTP_SERVER_AND_WORKER_PROCESS_PROOF.json",
      "Set processesTerminatedCleanly = false",
      (d) => {
        d.processesTerminatedCleanly = false;
      },
    ],
    [
      "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
      "Set requestSourceMode = LIVE_WITH_CACHE_FALLBACK for strict live gate",
      (d) => {
        d.requestSourceMode = "LIVE_WITH_CACHE_FALLBACK";
      },
    ],
    [
      "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
      "Set primaryWorkspacePreSeededAdRowCount = 9",
      (d) => {
        d.primaryWorkspacePreSeededAdRowCount = 9;
      },
    ],
    [
      "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
      "Set postHttpStatus = 500",
      (d) => {
        d.postHttpStatus = 500;
      },
    ],
    [
      "04_HTTP_POST_JOB_CLAIM_AND_FENCING_LEDGER.json",
      "Set httpPollCount = 0",
      (d) => {
        d.httpPollCount = 0;
        d.httpPollReceipts = [];
      },
    ],
    [
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "Set sourceMode = CACHE_ONLY",
      (d) => {
        d.sourceMode = "CACHE_ONLY";
      },
    ],
    [
      "05_LIVE_ONLY_META_QUERY_EXECUTION_LEDGER.json",
      "Set primaryWorkspacePreSeededAdRowCount = 5",
      (d) => {
        d.primaryWorkspacePreSeededAdRowCount = 5;
      },
    ],
    [
      "06_META_OBSERVATION_TO_AD_TO_CANDIDATE_LINEAGE.json",
      "Set sourceMode = CACHE_ONLY",
      (d) => {
        d.sourceMode = "CACHE_ONLY";
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set nonProductPromotedToShortlistCount = 1",
      (d) => {
        d.nonProductPromotedToShortlistCount = 1;
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set irrelevantPromotedToShortlistCount = 1",
      (d) => {
        d.irrelevantPromotedToShortlistCount = 1;
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set distinctFamiliesInShortlistCount = 1",
      (d) => {
        d.distinctFamiliesInShortlistCount = 1;
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set shortfallPaddingDetected = true",
      (d) => {
        d.shortfallPaddingDetected = true;
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set reversedOrderIdentical = false",
      (d) => {
        d.reversedOrderIdentical = false;
      },
    ],
    [
      "07_STRICT_LIVE_SHORTLIST_AND_FAMILY_DEDUPLICATION.json",
      "Set provisionalPromotedToEvergreenWinnersCount = 1",
      (d) => {
        d.provisionalPromotedToEvergreenWinnersCount = 1;
      },
    ],
    [
      "09_AMAZON_UI_LOCATION_CURRENCY_PHASE_CONTEXT.json",
      "Inject workspaceId mismatch between artifact 09 and artifact 10",
      (d) => {
        d.workspaceId = "ws_mismatched_other";
      },
    ],
    [
      "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
      "Set usedForbiddenSliceFallback = true",
      (d) => {
        d.usedForbiddenSliceFallback = true;
      },
    ],
    [
      "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
      "Set operationsAttempted = 6 (exceeding 4-op budget cap)",
      (d) => {
        d.operationsAttempted = 6;
      },
    ],
    [
      "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
      "Set fabricatedLiveSuccess = true",
      (d) => {
        d.fabricatedLiveSuccess = true;
      },
    ],
    [
      "10_AMAZON_TARGET_SELECTION_AND_SEARCH_CARDS.json",
      "Set sponsoredCardsSelectedCount = 1",
      (d) => {
        d.sponsoredCardsSelectedCount = 1;
      },
    ],
    [
      "11_AMAZON_OBSERVED_HREF_PDP_AND_TWO_TIER_VERDICTS.json",
      "Set searchBrandCopiedFromCandidateCount = 1",
      (d) => {
        d.searchBrandCopiedFromCandidateCount = 1;
      },
    ],
    [
      "12_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set mcpSessionClosedCleanly = false",
      (d) => {
        d.mcpSessionClosedCleanly = false;
      },
    ],
    [
      "12_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set ownedChildPidTerminated = false",
      (d) => {
        d.ownedChildPidTerminated = false;
      },
    ],
    [
      "12_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set allLiveOpsMatchSessionId = false",
      (d) => {
        d.allLiveOpsMatchSessionId = false;
      },
    ],
    [
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "Set syncJobPersisted = false",
      (d) => {
        if (d.dbPersistence) d.dbPersistence.syncJobPersisted = false;
      },
    ],
    [
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "Set HTTP transportMode = IN_PROCESS_ROUTE_CALL",
      (d) => {
        if (d.httpGetParity) d.httpGetParity.transportMode = "IN_PROCESS_ROUTE_CALL";
      },
    ],
    [
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "Set UI DOM provisionalRenderedAsVerifiedEvergreenCount = 1",
      (d) => {
        if (d.uiDomReloadParity) {
          d.uiDomReloadParity.provisionalRenderedAsVerifiedEvergreenCount = 1;
        }
      },
    ],
    [
      "13_DB_HTTP_GET_CHROMIUM_DOM_RELOAD_PARITY.json",
      "Set amazonPolicyOverrideRejected400 = false",
      (d) => {
        if (d.readOnlyAndIsolation) {
          d.readOnlyAndIsolation.amazonPolicyOverrideRejected400 = false;
        }
      },
    ],
    [
      "15_WALMART_PAUSED_AND_NON_INFLATION_PROOF.json",
      "Set currentRunLiveWalmartHttpRequests = 1",
      (d) => {
        if (d.walmartPaused) d.walmartPaused.currentRunLiveWalmartHttpRequests = 1;
      },
    ],
    [
      "16_TARGETED_V12_4_3_7_2_TEST_MATRIX_RESULTS.json",
      "Set failedCasesCount = 1",
      (d) => {
        d.failedCasesCount = 1;
      },
    ],
    [
      "17_FULL_REPOSITORY_REGRESSION_SHARD_RECEIPTS.json",
      "Set excludedOrDeferredFilesCount = 1",
      (d) => {
        d.excludedOrDeferredFilesCount = 1;
      },
    ],
    [
      "17_FULL_REPOSITORY_REGRESSION_SHARD_RECEIPTS.json",
      "Set failedTestCases = 1",
      (d) => {
        d.failedTestCases = 1;
      },
    ],
    [
      "18_ALL_12_E2E_SPEC_RECEIPTS.json",
      "Set skippedWithoutAttemptCount = 1",
      (d) => {
        d.skippedWithoutAttemptCount = 1;
      },
    ],
    [
      "19_FRESH_TYPESCRIPT_AND_NEXT_BUILD_RECEIPTS.json",
      "Set tscExitCode = 2",
      (d) => {
        d.tscExitCode = 2;
        d.tscOk = false;
      },
    ],
    [
      "19_FRESH_TYPESCRIPT_AND_NEXT_BUILD_RECEIPTS.json",
      "Set buildExitCode = 1",
      (d) => {
        d.buildExitCode = 1;
        d.buildOk = false;
      },
    ],
    [
      "21_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
      "Fabricate HOLDOUT verifiedIdentityCount = 3",
      (d) => {
        d.verifiedIdentityCount = 3;
      },
    ],
    [
      "21_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
      "Fabricate HOLDOUT historicalProviderParityVerdict = PASS",
      (d) => {
        d.historicalProviderParityVerdict = "PASS";
      },
    ],
    [
      "22_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
      "Set semanticHashAcceptedAsRawProductSchemaProofCount = 1",
      (d) => {
        d.semanticHashAcceptedAsRawProductSchemaProofCount = 1;
      },
    ],
    [
      "25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json",
      "Fabricate WALMART_US_LIVE_OPERATIONAL_STATUS = PASS",
      (d) => {
        if (d.verdictTable) {
          d.verdictTable.WALMART_US_LIVE_OPERATIONAL_STATUS = "PASS";
        }
      },
    ],
    [
      "25_FULL_ROUTE_SPECIFIC_BUSINESS_GATE_STATUS.json",
      "Fabricate G16_INDEPENDENT_MERCHANT_PROOF = PASS",
      (d) => {
        if (d.verdictTable) {
          d.verdictTable.G16_INDEPENDENT_MERCHANT_PROOF = "PASS";
        }
      },
    ],
  ];

  baseline48ArtifactMutations.forEach(([file, desc, fn], idx) => {
    runArtifactMutation(
      `V12_4_3_7_2_BASE_ART_MUT_${String(idx + 1).padStart(2, "0")}`,
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
      "git diff -- src/services/kh02/marketplace/amazonUsMcpTransport.ts src/services/kh02/marketplace/amazonUsIdentity.ts src/services/kh02/identity/productCandidateDiscovery.ts src/services/kh02/evergreenResearchOrchestrator.ts src/app/api/v1/kh02/research/route.ts scripts/kh02/acceptanceTruth.ts",
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
    mandatoryV12_4_3_7_2ScenariosExecuted: mandatory36NegativeScenarios.length,
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
  const skipCommitPushProof = args.includes("--skip-commit-push-proof");
  const positional = args.filter((a) => !a.startsWith("--"));
  const targetDir = positional[0]
    ? path.resolve(process.cwd(), positional[0])
    : "";
  if (!targetDir || !fs.existsSync(targetDir)) {
    console.error(
      "Usage: npx tsx scripts/kh02/validateClosureV12_4_3_7_2.ts <artifactDir> [--mutate-check] [--skip-commit-push-proof]"
    );
    process.exit(1);
  }
  const rep = validateClosureArtifactsV12_4_3_7_2(targetDir, {
    skipCommitPushProof,
  });
  console.log(JSON.stringify(rep, null, 2));
  if (rep.overallVerdict !== "PASS") {
    process.exit(1);
  }
  if (mutateCheck) {
    const mutRep = runExpandedPhysicalNegativeMutationSuiteV12_4_3_7_2(
      targetDir,
      rep.codeSha
    );
    console.log(
      `[V12.4.3.7.2 Mutation Check] Caught ${mutRep.caughtMutationsCount}/${mutRep.totalMutationsExecuted}, falsePasses=${mutRep.falsePassesCount}`
    );
    if (mutRep.falsePassesCount > 0 || mutRep.totalMutationsExecuted < 90) {
      process.exit(1);
    }
  }
}

