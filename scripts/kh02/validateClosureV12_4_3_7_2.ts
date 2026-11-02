/**
 * SWAI KH-02 V12.4.3.7.3 — Independent Raw-Evidence Fail-Closed Validator & 98-Case Physical Negative Mutation Suite
 *
 * Implements P2:
 * 1. Verifies all 28 required V12.4.3.7.3 acceptance artifacts (00..27) exist, are non-empty,
 *    and share identical CODE_SHA (with 27 recording testedCodeSha and finalEvidenceCommitSha).
 * 2. Recomputes E2E totals directly from 04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json.receipts
 *    via validatePerSpecE2EReceipts().
 * 3. Recomputes Meta live query/observation/ad/candidate counts from
 *    09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json,
 *    10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json, and
 *    11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json via reconcileLiveMetaLineageCounts().
 * 4. Verifies Amazon MCP smoke operation ledger (12), 6-phase raw observation chronology (13),
 *    and session lifecycle PID exit (14) satisfy:
 *    phase1 <= phase2 <= phase3 <= phase4 <= phase5 <= lastToolCompletedAt <= closeStartedAt <= closeFinishedAt,
 *    matching sessionId, and valid non-phony rawSnapshotHash.
 * 5. Verifies 16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json has explicit domCandidateIdsBeforeReload
 *    and domCandidateIdsAfterReload arrays equal to DB and API IDs.
 * 6. Verifies 22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json has
 *    completedAt <= 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json.evaluatedAt,
 *    caughtMutationsCount === totalMutationsExecuted (>= 98), falsePassesCount === 0,
 *    and zero "Mutations:pending" strings in 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json.
 * 7. Recomputes every gate verdict via computeV12_4_3_7_2ReleaseVerdicts and requires exact
 *    gate-by-gate equality with 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json.
 */

import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  computeV12_4_3_7_2ReleaseVerdicts,
  validatePerSpecE2EReceipts,
  reconcileLiveMetaLineageCounts,
} from "./acceptanceTruth";
import {
  isValidAmazonRawSnapshotHash,
  validateAmazonUiContextProofConsistency,
} from "../../src/services/kh02/marketplace/amazonUsMcpTransport";

export const REQUIRED_V12_4_3_7_3_ARTIFACTS = [
  "00_GIT_BRANCH_CODE_SHA_AND_TREE.json",
  "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
  "02_CALL_GRAPH_AND_FUNCTION_CHANGE_INVENTORY.md",
  "03_FIX_VERIFICATION_AND_SOURCE_DIFF.json",
  "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
  "05_TARGETED_UNIT_INTEGRATION_RESULTS.json",
  "06_FULL_REPOSITORY_REGRESSION_SHARDS.json",
  "07_TYPESCRIPT_NEXT_PRODUCTION_BUILD_RECEIPTS.json",
  "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
  "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
  "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
  "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
  "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
  "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
  "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
  "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
  "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
  "17_WALMART_PAUSED_EXTERNAL_GATE.json",
  "18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST.json",
  "19_HOLDOUT_2026_10_30_POINT_IN_TIME_BACKTEST.json",
  "20_HISTORICAL_PROVIDER_VACUITY_AND_NO_LOOKAHEAD.json",
  "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
  "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json",
  "23_INDEPENDENT_RAW_EVIDENCE_VALIDATOR_REPORT.json",
  "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
  "25_SHA256_ARTIFACT_MANIFEST.json",
  "26_OWNER_REPORT_VI.md",
  "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json",
] as const;

export const REQUIRED_V12_4_3_7_2_ARTIFACTS = REQUIRED_V12_4_3_7_3_ARTIFACTS;

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
    skipManifestCheck?: boolean;
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
    "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json",
    "23_INDEPENDENT_RAW_EVIDENCE_VALIDATOR_REPORT.json",
    "25_SHA256_ARTIFACT_MANIFEST.json",
    "26_OWNER_REPORT_VI.md",
    "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json",
  ]);

  // 1. Check presence and non-emptiness of all 28 required V12.4.3.7.3 artifacts
  for (const fileName of REQUIRED_V12_4_3_7_3_ARTIFACTS) {
    if (options?.skipLateStageFiles && lateStageSet.has(fileName)) {
      continue;
    }
    if (
      options?.skipManifestCheck &&
      (fileName === "23_INDEPENDENT_RAW_EVIDENCE_VALIDATOR_REPORT.json" ||
        fileName === "25_SHA256_ARTIFACT_MANIFEST.json")
    ) {
      continue;
    }
    if (
      options?.skipCommitPushProof &&
      fileName === "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json"
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

  const a00 = readJsonSafe(path.join(artifactDir, "00_GIT_BRANCH_CODE_SHA_AND_TREE.json"));
  const a01 = readJsonSafe(path.join(artifactDir, "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json"));
  const a03 = readJsonSafe(path.join(artifactDir, "03_FIX_VERIFICATION_AND_SOURCE_DIFF.json"));
  const a04 = readJsonSafe(path.join(artifactDir, "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json"));
  const a05 = readJsonSafe(path.join(artifactDir, "05_TARGETED_UNIT_INTEGRATION_RESULTS.json"));
  const a06 = readJsonSafe(path.join(artifactDir, "06_FULL_REPOSITORY_REGRESSION_SHARDS.json"));
  const a07 = readJsonSafe(path.join(artifactDir, "07_TYPESCRIPT_NEXT_PRODUCTION_BUILD_RECEIPTS.json"));
  const a08 = readJsonSafe(path.join(artifactDir, "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json"));
  const a09 = readJsonSafe(path.join(artifactDir, "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json"));
  const a10 = readJsonSafe(path.join(artifactDir, "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json"));
  const a11 = readJsonSafe(path.join(artifactDir, "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json"));
  const a12 = readJsonSafe(path.join(artifactDir, "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json"));
  const a13 = readJsonSafe(path.join(artifactDir, "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json"));
  const a14 = readJsonSafe(path.join(artifactDir, "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json"));
  const a15 = readJsonSafe(path.join(artifactDir, "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json"));
  const a16 = readJsonSafe(path.join(artifactDir, "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json"));
  const a17 = readJsonSafe(path.join(artifactDir, "17_WALMART_PAUSED_EXTERNAL_GATE.json"));
  const a18 = readJsonSafe(path.join(artifactDir, "18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST.json"));
  const a19 = readJsonSafe(path.join(artifactDir, "19_HOLDOUT_2026_10_30_POINT_IN_TIME_BACKTEST.json"));
  const a20 = readJsonSafe(path.join(artifactDir, "20_HISTORICAL_PROVIDER_VACUITY_AND_NO_LOOKAHEAD.json"));
  const a21 = readJsonSafe(path.join(artifactDir, "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json"));
  const a22 = readJsonSafe(path.join(artifactDir, "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json"));
  const a24 = readJsonSafe(path.join(artifactDir, "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json"));

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
    "Branch ancestry from origin/QA and prior V12.4.3.7.2 baseline SHA is verified",
    a00?.ancestryVerified === true,
    `ancestryVerified=${a00?.ancestryVerified}`
  );

  // Check SHA parity across all JSON artifacts (00, 01, 03..21, 24)
  const jsonArtifactsForSha: Array<[string, any]> = [
    ["00", a00],
    ["01", a01],
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
    ["24", a24],
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
  const persistenceSourcePath = path.join(
    repoRoot,
    "src/services/kh02/persistence/kh02PersistenceService.ts"
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
  const persistenceSourceText = fs.existsSync(persistenceSourcePath)
    ? fs.readFileSync(persistenceSourcePath, "utf8")
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
  const hasValidSnapshotHashFn =
    /export\s+function\s+isValidAmazonRawSnapshotHash\s*\(/.test(
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
  const hasBrowserDomArrayFailClosedGuard =
    /!Array\.isArray\(browserEvidence\.displayedCandidateIds\)/.test(
      persistenceSourceText
    );
  const hasForbiddenAmazonPolicyOverrideGuard =
    /FORBIDDEN_AMAZON_POLICY_OVERRIDE/.test(researchRouteSourceText);
  const hasCentralVerdictComputerFn =
    /export\s+function\s+computeV12_4_3_7_2ReleaseVerdicts\s*\(/.test(
      acceptanceTruthSourceText
    );
  const hasPerSpecE2EValidatorFn =
    /export\s+function\s+validatePerSpecE2EReceipts\s*\(/.test(
      acceptanceTruthSourceText
    );
  const hasMetaReconcilerFn =
    /export\s+function\s+reconcileLiveMetaLineageCounts\s*\(/.test(
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
    "amazonUsMcpTransport.ts exports ensureAmazonUsDeliveryContextViaUi, readAmazonCommercialContextFromRenderedUi, buildAmazonUiPhaseContextProof, and isValidAmazonRawSnapshotHash",
    hasUiLocationEnsurerFn &&
      hasUiCommercialReaderFn &&
      hasUiPhaseProofBuilderFn &&
      hasValidSnapshotHashFn,
    `hasUiEnsurer=${hasUiLocationEnsurerFn}, hasCommercialReader=${hasUiCommercialReaderFn}, hasPhaseProof=${hasUiPhaseProofBuilderFn}, hasValidHashFn=${hasValidSnapshotHashFn}`
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
    "SOURCE_HAS_BROWSER_DOM_ARRAY_FAIL_CLOSED_GUARD",
    "SOURCE_INVARIANTS",
    "kh02PersistenceService.ts enforces !Array.isArray(browserEvidence.displayedCandidateIds) fail-closed guard",
    persistenceSourceText.length > 100 && hasBrowserDomArrayFailClosedGuard,
    `hasBrowserDomArrayGuard=${hasBrowserDomArrayFailClosedGuard}`
  );
  addCheck(
    "SOURCE_HAS_FORBIDDEN_AMAZON_POLICY_OVERRIDE_GUARD",
    "SOURCE_INVARIANTS",
    "research/route.ts enforces FORBIDDEN_AMAZON_POLICY_OVERRIDE on POST /api/v1/kh02/research",
    researchRouteSourceText.length > 100 && hasForbiddenAmazonPolicyOverrideGuard,
    `hasGuard=${hasForbiddenAmazonPolicyOverrideGuard}`
  );
  addCheck(
    "SOURCE_HAS_CENTRAL_VERDICT_E2E_AND_META_RECONCILER",
    "SOURCE_INVARIANTS",
    "acceptanceTruth.ts exports computeV12_4_3_7_2ReleaseVerdicts, validatePerSpecE2EReceipts, and reconcileLiveMetaLineageCounts",
    acceptanceTruthSourceText.length > 100 &&
      hasCentralVerdictComputerFn &&
      hasPerSpecE2EValidatorFn &&
      hasMetaReconcilerFn,
    `verdictFn=${hasCentralVerdictComputerFn}, e2eFn=${hasPerSpecE2EValidatorFn}, metaFn=${hasMetaReconcilerFn}`
  );

  // 4. Runtime Precheck & Standalone Reference Provenance (01, 03)
  const sr = a01?.standaloneReference || a03?.standaloneReference;
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
    "ARTIFACT01_STANDALONE_REFERENCE_PROVENANCE",
    "STANDALONE_CONTRACT",
    "Standalone Amazon reference provenance strictly records USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT, SUMMARY_AND_SCRIPT_ONLY, referenceRawHashVerified=false, and observationClass=TEST_FIXTURE",
    sr?.manifest?.referenceOrigin === "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT" &&
      sr?.manifest?.referenceAvailability === "SUMMARY_AND_SCRIPT_ONLY" &&
      sr?.manifest?.referenceRawHashVerified === false &&
      sr?.manifest?.referenceReplayStatus === "NOT_EXECUTED" &&
      sr?.manifest?.standaloneReferenceStatus === "USER_REPORTED_SEARCH_TO_PDP_PASS" &&
      sr?.manifest?.standaloneAppIntegrationStatus === "NOT_TESTED_BY_REFERENCE" &&
      sr?.parserVerification?.observationClass === "TEST_FIXTURE" &&
      sr?.parserVerification?.fixtureSource === "USER_REPORTED_REFERENCE_FIELDS" &&
      sr?.parserVerification?.asin === "B0D3XGHTJ5" &&
      sr?.parserVerification?.observedCanonicalUrl ===
        "https://www.amazon.com/clp/B0D3XGHTJ5" &&
      sr?.downgradeNegativeTestPassed === true,
    `origin=${sr?.manifest?.referenceOrigin}, rawHashVerified=${sr?.manifest?.referenceRawHashVerified}, obsClass=${sr?.parserVerification?.observationClass}`
  );

  // 5. E2E Per-Spec Receipts (04), Targeted Unit/Integration (05), Full Regression Shards (06), TypeScript & Build (07)
  const e2eValidation = validatePerSpecE2EReceipts(a04, expectedSha);
  addCheck(
    "ARTIFACT04_ALL_12_E2E_SPEC_RECEIPTS_RECOMPUTED",
    "TEST_MATRIX",
    "All 12 canonical E2E specs have individual per-spec receipts in 04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json matching summary totals and CODE_SHA",
    e2eValidation.valid === true &&
      e2eValidation.computedPassedSpecs === 12 &&
      e2eValidation.computedPassedCases >= 34 &&
      e2eValidation.computedFailedCases === 0,
    `valid=${e2eValidation.valid}, specs=${e2eValidation.computedPassedSpecs}/${e2eValidation.computedTotalSpecs}, cases=${e2eValidation.computedPassedCases}/${e2eValidation.computedTotalCases}, reasons=${e2eValidation.reasons.join(";")}`
  );

  addCheck(
    "ARTIFACT05_TARGETED_UNIT_INTEGRATION_RESULTS",
    "TEST_MATRIX",
    "Targeted V12.4.3.7.3 (42 A01..A42 tests) + V12.4.3.7.2 + prior KH-02 suites executed and passed with 0 failures",
    a05?.allPassed === true &&
      a05?.failedCasesCount === 0 &&
      a05?.totalCasesCount >= 120 &&
      a05?.targetedSuitesFailedTests === 0 &&
      a05?.targetedSuitesPassedTests >= 400,
    `matrixPassed=${a05?.passedCasesCount}/${a05?.totalCasesCount}, targetedTests=${a05?.targetedSuitesPassedTests}/${a05?.targetedSuitesTotalTests}`
  );

  addCheck(
    "ARTIFACT06_FULL_REPOSITORY_REGRESSION_SHARDS",
    "TEST_MATRIX",
    "100% of discovered repository test files (>= 158 files) executed across bounded shards with 0 failures and 0 exclusions",
    a06?.inventoryComplete === true &&
      a06?.excludedOrDeferredFilesCount === 0 &&
      a06?.failedTestCases === 0 &&
      a06?.executedTestFilesCount >= 158 &&
      a06?.executedTestFilesCount === a06?.totalDiscoveredTestFiles &&
      a06?.passedTestCases >= 1980 &&
      a06?.passedTestCases === a06?.totalExecutedTestCases,
    `files=${a06?.executedTestFilesCount}/${a06?.totalDiscoveredTestFiles}, tests=${a06?.passedTestCases}/${a06?.totalExecutedTestCases}`
  );

  addCheck(
    "ARTIFACT07_TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD_RECEIPTS",
    "BUILD_GATES",
    "npx tsc --noEmit and npm run build both succeeded with exitCode === 0 on CODE_SHA",
    a07?.tscOk === true &&
      a07?.tscExitCode === 0 &&
      a07?.buildOk === true &&
      a07?.buildExitCode === 0,
    `tscExit=${a07?.tscExitCode}, buildExit=${a07?.buildExitCode}`
  );

  // 6. Real Network HTTP Server + Separate Worker Process + Job Fencing (08)
  const procProof = a08?.serverWorkerProcess || a08;
  const jobProof = a08?.httpPostJobFencing || a08;
  addCheck(
    "ARTIFACT08_REAL_HTTP_SERVER_WORKER_PID_AND_JOB_FENCING",
    "REAL_NETWORK_WORKER_E2E",
    "Real HTTP server process and separate worker OS process have distinct positive PIDs and HTTP POST 202 LIVE_ONLY job claimed/completed with monotonic fencing",
    procProof?.executionMode === "REAL_NETWORK_WORKER_E2E" &&
      typeof procProof?.acceptanceProcessPid === "number" &&
      procProof.acceptanceProcessPid > 0 &&
      typeof procProof?.serverProcessPid === "number" &&
      procProof.serverProcessPid > 0 &&
      typeof procProof?.workerProcessPid === "number" &&
      procProof.workerProcessPid > 0 &&
      procProof.serverProcessPid !== procProof.workerProcessPid &&
      procProof.serverProcessPid !== procProof.acceptanceProcessPid &&
      procProof.workerProcessPid !== procProof.acceptanceProcessPid &&
      procProof?.directRouteImportUsedForPrimaryAcceptance === false &&
      procProof?.inProcessExecuteResearchJobUsedForPrimaryAcceptance === false &&
      procProof?.processesTerminatedCleanly === true &&
      jobProof?.httpMethod === "POST" &&
      typeof jobProof?.requestUrl === "string" &&
      jobProof.requestUrl.startsWith("http://127.0.0.1:") &&
      jobProof?.postHttpStatus === 202 &&
      jobProof?.requestSourceMode === "LIVE_ONLY" &&
      jobProof?.primaryWorkspacePreSeededAdRowCount === 0 &&
      jobProof?.workerClaimed === true &&
      typeof jobProof?.workerId === "string" &&
      jobProof.workerId.includes(String(procProof?.workerProcessPid || "")) &&
      Boolean(jobProof?.claimToken) &&
      Boolean(jobProof?.fencingToken) &&
      typeof jobProof?.fencingGeneration === "number" &&
      jobProof.fencingGeneration >= 1 &&
      typeof jobProof?.httpPollCount === "number" &&
      jobProof.httpPollCount >= 1 &&
      (jobProof?.finalJobStatus === "COMPLETED" ||
        jobProof?.finalJobStatus === "PARTIALLY_COMPLETED"),
    `serverPID=${procProof?.serverProcessPid}, workerPID=${procProof?.workerProcessPid}, postStatus=${jobProof?.postHttpStatus}, finalStatus=${jobProof?.finalJobStatus}`
  );

  // 7. Live-Only Meta Query Outcome Ledger (09), Lineage (10), & Strict-Live Top 3 (11)
  const metaRecon = reconcileLiveMetaLineageCounts(a09);
  addCheck(
    "ARTIFACT09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER_RECONCILED",
    "META_PROVENANCE",
    "Live-Only Meta query outcome ledger reconciles completed queries, observations, persisted ads, and candidate lineage with 0 contradictions",
    metaRecon.valid === true &&
      a09?.sourceMode === "LIVE_ONLY" &&
      a09?.primaryWorkspacePreSeededAdRowCount === 0 &&
      metaRecon.realCompletedQueriesCount >= 1 &&
      metaRecon.validatedLiveObservationsCount >= 1 &&
      metaRecon.persistedLiveAdsCount >= 1 &&
      metaRecon.lineagePassedCount >= 3 &&
      metaRecon.lineageRejectedCount === 0,
    `valid=${metaRecon.valid}, queries=${metaRecon.realCompletedQueriesCount}, obs=${metaRecon.validatedLiveObservationsCount}, ads=${metaRecon.persistedLiveAdsCount}, lineagePassed=${metaRecon.lineagePassedCount}, contradictions=${metaRecon.contradictions.join(";")}`
  );

  addCheck(
    "ARTIFACT10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE",
    "META_PROVENANCE",
    "Meta observation -> persisted Ad -> candidate lineage verifies runId, workspaceId, queryId, providerRequestId, and externalAdId with 0 cross-workspace or synthetic promotions",
    a10?.sourceMode === "LIVE_ONLY" &&
      a10?.syntheticPromotedToLiveCount === 0 &&
      a10?.cachePromotedToLiveCount === 0 &&
      a10?.crossWorkspaceAdLinkedCount === 0 &&
      a10?.missingPersistedAdInDbCount === 0 &&
      a10?.unexecutedQueryObservationCount === 0 &&
      Array.isArray(a10?.candidateLineageChains) &&
      a10?.lineageRejectedCount === 0 &&
      a10?.lineageVerifiedCandidatesCount >= 3,
    `verifiedCandidates=${a10?.lineageVerifiedCandidatesCount}, rejected=${a10?.lineageRejectedCount}`
  );

  addCheck(
    "ARTIFACT11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS",
    "REAL_PIPELINE",
    "Strict-live Top 3 shortlist has 3 distinct product families with order independence, 0 shortfall padding, and corroborated fallback explicitly separated",
    a11?.shortlistCount === 3 &&
      a11?.distinctFamiliesInShortlistCount === 3 &&
      a11?.reversedOrderIdentical === true &&
      a11?.shortfallPaddingDetected === false &&
      a11?.provisionalPromotedToEvergreenWinnersCount === 0 &&
      a11?.nonProductPromotedToShortlistCount === 0 &&
      a11?.irrelevantPromotedToShortlistCount === 0 &&
      a11?.corroboratedRunSeparation?.promotedToStrictLiveOnlyGate === false,
    `shortlist=${a11?.shortlistCount}, distinctFamilies=${a11?.distinctFamiliesInShortlistCount}`
  );

  // 8. Amazon MCP Smoke Ledger (12), 6-Phase Raw Observation Chronology (13), Session Lifecycle (14), & Equivalence Matrix (15)
  const uiProofCheck = a13
    ? validateAmazonUiContextProofConsistency(a13)
    : { valid: false, contradictions: ["MISSING_ARTIFACT_13"] };

  addCheck(
    "ARTIFACT12_AMAZON_MCP_SMOKE_OPERATION_LEDGER",
    "AMAZON_LIVE_COMMERCIAL",
    "Dynamic Amazon target selection selects <= 2 targets without slice(0,3) fallback, <= 4 logical ops, and <= 5 non-sponsored search cards",
    a12?.usedForbiddenSliceFallback === false &&
      a12?.targetSelectionLedger?.selectedCount >= 1 &&
      a12?.targetSelectionLedger?.selectedCount <= 2 &&
      a12?.maxCardsPerSearchCap === 5 &&
      a12?.sponsoredCardsSelectedCount === 0 &&
      a12?.unvisitedCardsPromotedToVerifiedCount === 0 &&
      typeof a12?.operationsAttempted === "number" &&
      a12.operationsAttempted >= 1 &&
      a12.operationsAttempted <= 4 &&
      a12?.fabricatedLiveSuccess === false,
    `selected=${a12?.targetSelectionLedger?.selectedCount}, ops=${a12?.operationsAttempted}/4, observedHrefSelected=${a12?.observedHrefSelectedCount}`
  );

  addCheck(
    "ARTIFACT13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon 6-phase raw observation chronology satisfies phase1 <= phase2 <= phase3 <= phase4 <= phase5 <= lastToolCompletedAt <= closeStartedAt <= closeFinishedAt on same sessionId with valid rawSnapshotHash",
    a13?.internalGlowFetchUsed === false &&
      Boolean(a13?.phase1_initial_home) &&
      Boolean(a13?.phase2_zip_dialog_action) &&
      Boolean(a13?.phase3_home_readback) &&
      Boolean(a13?.phase4_search_readback) &&
      Boolean(a13?.phase5_pdp_readback) &&
      Boolean(a13?.phase6_post_session_close) &&
      a13?.phase4_search_readback?.status !== "INCOMPLETE" &&
      a13?.phase5_pdp_readback?.status !== "INCOMPLETE" &&
      isValidAmazonRawSnapshotHash(a13?.phase1_initial_home?.rawSnapshotHash) &&
      isValidAmazonRawSnapshotHash(a13?.phase3_home_readback?.rawSnapshotHash) &&
      isValidAmazonRawSnapshotHash(a13?.phase4_search_readback?.rawSnapshotHash) &&
      isValidAmazonRawSnapshotHash(a13?.phase5_pdp_readback?.rawSnapshotHash) &&
      Array.isArray(a13?.contradictionsDetected) &&
      a13.contradictionsDetected.length === 0 &&
      uiProofCheck.valid === true &&
      a13?.workspaceId === a12?.workspaceId &&
      a13?.researchRunId === a12?.researchRunId &&
      a13?.workspaceId === a15?.workspaceId &&
      a13?.researchRunId === a15?.researchRunId,
    `valid=${uiProofCheck.valid}, contradictions=${JSON.stringify(
      uiProofCheck.contradictions
    )}, p4Obs=${a13?.phase4_search_readback?.observedAt}, p5Obs=${a13?.phase5_pdp_readback?.observedAt}, closeFin=${a14?.closeFinishedAt}`
  );

  const closeStartMs = Date.parse(String(a14?.closeStartedAt || ""));
  const closeFinishMs = Date.parse(String(a14?.closeFinishedAt || ""));
  const lastToolMs = Date.parse(String(a14?.lastToolCompletedAt || ""));
  addCheck(
    "ARTIFACT14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT",
    "AMAZON_LIVE_COMMERCIAL",
    "Same-session REAL_STDIO_MCP lifecycle proves lastToolCompletedAt <= closeStartedAt <= closeFinishedAt and owned child PID terminated cleanly",
    a14?.transportMode === "REAL_STDIO_MCP" &&
      a14?.serverOrigin === "PINNED_PLAYWRIGHT_MCP" &&
      typeof a14?.sessionId === "string" &&
      a14.sessionId.length > 0 &&
      a14?.sessionId === a13?.sessionId &&
      a14?.allLiveOpsMatchSessionId === true &&
      a14?.mcpSessionClosedCleanly === true &&
      a14?.ownedChildPidTerminated === true &&
      a14?.closedAfterLastToolCompleted === true &&
      Number.isFinite(lastToolMs) &&
      Number.isFinite(closeStartMs) &&
      Number.isFinite(closeFinishMs) &&
      lastToolMs <= closeStartMs &&
      closeStartMs <= closeFinishMs,
    `sessionId=${a14?.sessionId}, lastTool=${a14?.lastToolCompletedAt}, closeStart=${a14?.closeStartedAt}, closeFinish=${a14?.closeFinishedAt}`
  );

  addCheck(
    "ARTIFACT15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX",
    "AMAZON_LIVE_COMMERCIAL",
    "Amazon PDP extraction records commercial context and Two-Tier Identity verdicts without borrowing homepage ZIP or inferring USD from bare $",
    Array.isArray(a15?.evaluatedCandidates) &&
      a15.evaluatedCandidates.length >= 1 &&
      a15.evaluatedCandidates.every(
        (c: any) =>
          typeof c?.operationId === "string" &&
          c.operationId.length > 0 &&
          typeof c?.observedAt === "string" &&
          c.observedAt.length > 0
      ) &&
      a15?.falseExactProductPromotionCount === 0 &&
      a15?.searchBrandCopiedFromCandidateCount === 0 &&
      a15?.zipBorrowedFromHomepageWhenPdpMissing === false &&
      a15?.usdInferredFromBareDollarSymbolAlone === false,
    `evaluated=${a15?.evaluatedCandidates?.length}, falseExact=${a15?.falseExactProductPromotionCount}`
  );

  // 9. DB -> HTTP GET -> Headless Chromium DOM Reload Parity & Secondary Niche (16) + Walmart Pause (17)
  const domBefore = a16?.uiDomReloadParity?.domCandidateIdsBeforeReload;
  const domAfter = a16?.uiDomReloadParity?.domCandidateIdsAfterReload;
  const dbIds = a16?.httpGetParity?.shortlistIdsInDb;
  const apiIds = a16?.httpGetParity?.shortlistIdsInLeaderboardApi;
  const secNiche = a16?.secondaryNiche;
  addCheck(
    "ARTIFACT16_DB_API_UI_CHROMIUM_RELOAD_PARITY_AND_SECONDARY_NICHE",
    "DB_API_UI_PARITY",
    "SQLite DB, Real Network HTTP GET, and Headless Chromium DOM before/after page.reload() have explicit matching 3-item candidate arrays without dbIds fallback, plus secondary niche separation",
    a16?.dbPersistence?.syncJobPersisted === true &&
      a16?.dbPersistence?.idempotentRePersistVerified === true &&
      a16?.dbPersistence?.persistedShortlistCount === 3 &&
      a16?.httpGetParity?.transportMode === "REAL_NETWORK_HTTP_FETCH" &&
      a16?.httpGetParity?.parityPassed === true &&
      ((a16?.httpGetParity as any)?.returnedCachedOrFixtureAsLiveCount ?? 0) === 0 &&
      Array.isArray(a16?.httpGetParity?.mismatches) &&
      a16.httpGetParity.mismatches.length === 0 &&
      a16?.uiDomReloadParity?.parityPassed === true &&
      a16?.uiDomReloadParity?.cardsBeforeReloadCount === 3 &&
      a16?.uiDomReloadParity?.cardsAfterReloadCount === 3 &&
      a16?.uiDomReloadParity?.provisionalRenderedAsVerifiedEvergreenCount === 0 &&
      Array.isArray(domBefore) &&
      Array.isArray(domAfter) &&
      Array.isArray(dbIds) &&
      Array.isArray(apiIds) &&
      dbIds.length === 3 &&
      JSON.stringify(dbIds) === JSON.stringify(apiIds) &&
      JSON.stringify(dbIds) === JSON.stringify(domBefore) &&
      JSON.stringify(dbIds) === JSON.stringify(domAfter) &&
      a16?.readOnlyAndIsolation?.readOnlyVerified === true &&
      a16?.readOnlyAndIsolation?.crossWorkspaceDenied === true &&
      a16?.readOnlyAndIsolation?.walmartPolicyOverrideRejected400 === true &&
      a16?.readOnlyAndIsolation?.amazonPolicyOverrideRejected400 === true &&
      secNiche?.primaryNiche === "Pet Gadgets" &&
      secNiche?.secondaryNiche === "Home Organization" &&
      secNiche?.secondaryShortlistCount === 3 &&
      secNiche?.crossNicheOverlapCount === 0 &&
      secNiche?.parityPassed === true,
    `httpParity=${a16?.httpGetParity?.parityPassed}, domBefore=${JSON.stringify(
      domBefore
    )}, domAfter=${JSON.stringify(domAfter)}, secNicheOverlap=${secNiche?.crossNicheOverlapCount}`
  );

  addCheck(
    "ARTIFACT17_WALMART_PAUSED_EXTERNAL_GATE_AND_NON_INFLATION",
    "WALMART_AND_NON_INFLATION",
    "Walmart US remains paused with 0 live HTTP requests and preserved CAPTCHA receipt; Amazon & Walmart produce 0 score/rank/gate inflation",
    a17?.walmartPaused?.policy?.featureEnabled === false &&
      a17?.walmartPaused?.policy?.liveAllowed === false &&
      a17?.walmartPaused?.policy?.operationalStatus === "PAUSED_EXTERNAL" &&
      a17?.walmartPaused?.currentRunLiveWalmartHttpRequests === 0 &&
      a17?.walmartPaused?.priorLiveBlockerReference?.responseBytes === 16845 &&
      a17?.walmartPaused?.priorLiveBlockerReference?.responseSha256 ===
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4" &&
      a17?.nonInflation?.nonInflationVerified === true &&
      a17?.nonInflation?.scoreDeltaAbsMax === 0 &&
      a17?.nonInflation?.rankingChanged === false &&
      a17?.nonInflation?.g07PromotedCount === 0 &&
      a17?.nonInflation?.g15PromotedCount === 0 &&
      a17?.nonInflation?.g16PromotedCount === 0,
    `wmtLiveHttp=${a17?.walmartPaused?.currentRunLiveWalmartHttpRequests}, scoreDelta=${a17?.nonInflation?.scoreDeltaAbsMax}`
  );

  // 10. Historical DEV (18), HOLDOUT (19), & Vacuity / No-Lookahead Audit (20)
  addCheck(
    "ARTIFACT18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST",
    "HISTORICAL_BACKTEST",
    "DEV historical replay (2026-10-24T00:00:00.000Z) executed with pointInTimeIntegrityVerdict = PASS, 0 post-cutoff rows, and truthful INSUFFICIENT_HISTORICAL_EVIDENCE business verdict",
    a18?.split === "DEV" &&
      a18?.asOfCutoffIso === "2026-10-24T00:00:00.000Z" &&
      a18?.backtestEngineExecuted === "PASS" &&
      a18?.pointInTimeIntegrityVerdict === "PASS" &&
      a18?.postCutoffRowsIncludedCount === 0 &&
      a18?.historicalDevBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      a18?.historicalProviderParityVerdict === "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    `obs=${a18?.historicalObservationCount}, shortlist=${a18?.shortlistCount}, biz=${a18?.historicalDevBusinessVerdict}`
  );

  addCheck(
    "ARTIFACT19_HOLDOUT_2026_10_30_POINT_IN_TIME_BACKTEST",
    "HISTORICAL_BACKTEST",
    "HOLDOUT historical replay (2026-10-30T12:00:00.000Z) executed with pointInTimeIntegrityVerdict = PASS, 0 post-cutoff rows, and truthful INSUFFICIENT_HISTORICAL_EVIDENCE business verdict",
    a19?.split === "HOLDOUT" &&
      a19?.asOfCutoffIso === "2026-10-30T12:00:00.000Z" &&
      a19?.backtestEngineExecuted === "PASS" &&
      a19?.pointInTimeIntegrityVerdict === "PASS" &&
      a19?.postCutoffRowsIncludedCount === 0 &&
      a19?.shortlistCount === 3 &&
      a19?.verifiedIdentityCount === 0 &&
      a19?.historicalHoldoutBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE" &&
      a19?.historicalProviderParityVerdict === "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    `obs=${a19?.historicalObservationCount}, shortlist=${a19?.shortlistCount}, biz=${a19?.historicalHoldoutBusinessVerdict}`
  );

  addCheck(
    "ARTIFACT20_HISTORICAL_PROVIDER_VACUITY_AND_NO_LOOKAHEAD",
    "HISTORICAL_BACKTEST",
    "Point-in-time no-lookahead audit rejects post-cutoff and fixture records across Ads, ResearchProduct, Amazon, and Walmart",
    a20?.pointInTimeIntegrityVerdict === "PASS" &&
      a20?.postCutoffIncludedInReplayCount === 0 &&
      a20?.fixtureRowsIncludedInLiveReplayCount === 0 &&
      a20?.semanticHashAcceptedAsRawProductSchemaProofCount === 0 &&
      a20?.amazonPostCutoffExcludedCount >= 1 &&
      a20?.walmartPostCutoffExcludedCount >= 1,
    `pitVerdict=${a20?.pointInTimeIntegrityVerdict}, postCutoffIncluded=${a20?.postCutoffIncludedInReplayCount}`
  );

  // 11. Resource, RAM, Disk, Heavy Concurrency & PID Final (21)
  addCheck(
    "ARTIFACT21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL",
    "RESOURCE_HYGIENE",
    "Process, disk & RAM reconciliation confirms >= 15 GiB free disk, maxConcurrentHeavyObserved <= 2, and 0 unreconciled owned Node/MCP child PIDs",
    typeof a21?.minFreeDiskGiB === "number" &&
      a21.minFreeDiskGiB >= 15 &&
      a21?.unreconciledOwnedNodePidsCount === 0 &&
      a21?.unreconciledPlaywrightMcpPidsCount === 0 &&
      a21?.orphanedOwnedProcessCount === 0 &&
      typeof a21?.maxConcurrentHeavyObserved === "number" &&
      a21.maxConcurrentHeavyObserved <= 2,
    `minFreeDiskGiB=${a21?.minFreeDiskGiB}, orphans=${a21?.orphanedOwnedProcessCount}, maxHeavy=${a21?.maxConcurrentHeavyObserved}`
  );

  // 12. Independent Gate-by-Gate Verdict Recomputation (24)
  const mutationInputForRecompute = options?.skipLateStageFiles
    ? {
        codeSha: expectedSha,
        completedAt: a24?.evaluatedAt || new Date().toISOString(),
        totalMutationsExecuted: 98,
        caughtMutationsCount: 98,
        falsePassesCount: 0,
        sourceTreeRestoredClean: true,
      }
    : a22;

  const recomputedBundle = computeV12_4_3_7_2ReleaseVerdicts({
    expectedCodeSha: expectedSha,
    measuredAt: a24?.evaluatedAt,
    artifact00BranchAndSha: a00,
    artifact01RuntimePrecheck: a01,
    artifact02StandaloneReference: sr,
    artifact03ServerWorkerProof: procProof,
    artifact04HttpPostAndFencing: jobProof,
    artifact05LiveMeta: a09,
    artifact06DiscoveryFunnel: a11,
    artifact07FamilyDedup: a11,
    artifact08AmazonUiPreflight: a13,
    artifact09AmazonTargetPlan: a12,
    artifact10AmazonMcpLedger: a12,
    artifact11AmazonSearchCards: a12,
    artifact12AmazonPdpVerdicts: a15,
    artifact13AmazonMcpSession: a14,
    artifact14DbPersistence: a16?.dbPersistence,
    artifact15RealHttpGetParity: a16?.httpGetParity,
    artifact16UiDomReloadParity: a16?.uiDomReloadParity,
    artifact17SecondaryNiche: secNiche,
    artifact18WalmartPaused: a17?.walmartPaused,
    artifact19NonInflation: a17?.nonInflation,
    artifact20ReadOnlyIsolation: a16?.readOnlyAndIsolation,
    artifact21TestMatrix: a05,
    artifact22TargetedSuites: {
      codeSha: a05?.codeSha,
      allPassed: a05?.allPassed === true && a05?.targetedSuitesFailedTests === 0,
      failedTests: a05?.targetedSuitesFailedTests ?? 1,
      passedTests: a05?.targetedSuitesPassedTests ?? 0,
      totalTests: a05?.targetedSuitesTotalTests ?? 0,
    },
    artifact23FullRegression: a06,
    artifact24E2EReceipts: a04,
    artifact25DevReplay: a18,
    artifact26HoldoutReplay: a19,
    artifact27PointInTimeAudit: a20,
    buildAndTscReceipt: a07,
    resourceHygieneReceipt: a21,
    mutationSuite: mutationInputForRecompute,
  });

  const recomputedVerdictMismatches: string[] = [];
  const reportedTable24 = a24?.verdictTable || {};
  const raw24String = JSON.stringify(a24 || {});
  const hasMutationsPendingPlaceholder = raw24String.includes("Mutations:pending");

  for (const [gateId, expectedStatus] of Object.entries(
    recomputedBundle.verdictTable
  )) {
    if (reportedTable24[gateId] !== expectedStatus) {
      recomputedVerdictMismatches.push(
        `24.${gateId}: reported=${reportedTable24[gateId]} vs recomputed=${expectedStatus}`
      );
    }
  }

  const vt = recomputedBundle.verdictTable;
  const mandatoryEngineeringAndTruthGatesOk =
    !hasMutationsPendingPlaceholder &&
    recomputedVerdictMismatches.length === 0 &&
    vt.CODE_AND_ENGINEERING_GATES === "PASS" &&
    vt.ENGINEERING_AND_TRUTH_ACCEPTANCE === "PASS" &&
    vt.ALL_12_CANONICAL_E2E_SPECS === "PASS" &&
    vt.TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD === "PASS" &&
    vt.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY === "PASS" &&
    vt.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E === "PASS" &&
    (vt.META_LIVE_CURRENT_RUN_COLLECTION === "PASS" ||
      vt.META_LIVE_CURRENT_RUN_COLLECTION === "DEGRADED_OR_ZERO_LIVE" ||
      vt.META_LIVE_CURRENT_RUN_COLLECTION === "BLOCKED_UPSTREAM") &&
    vt.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION === "PASS" &&
    (vt.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "PASS" ||
      vt.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "BLOCKED_ACCESS_CHALLENGE") &&
    vt.AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY === "PASS" &&
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
    vt.HISTORICAL_PROVIDER_PARITY_TRUTH === "VACUOUS_OR_UNPROVEN" &&
    vt.HISTORICAL_BUSINESS_EVIDENCE === "INSUFFICIENT_EVIDENCE" &&
    vt.G07_PAID_MEDIA_PERSISTENCE === "BLOCKED" &&
    vt.G15_LONGITUDINAL_DEMAND_60D === "INSUFFICIENT_EVIDENCE" &&
    vt.G16_INDEPENDENT_MERCHANT_PROOF === "INSUFFICIENT_EVIDENCE" &&
    vt.FULL_KH02_BUSINESS_ACCEPTANCE === "INSUFFICIENT_EVIDENCE";

  addCheck(
    "ARTIFACT24_INDEPENDENT_VERDICT_RECOMPUTATION_EXACT_MATCH",
    "RELEASE_VERDICT",
    "Independent verdict recomputation matches 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json across all gates with zero false PASS and zero Mutations:pending placeholders",
    mandatoryEngineeringAndTruthGatesOk,
    recomputedVerdictMismatches.length === 0 && !hasMutationsPendingPlaceholder
      ? `All ${Object.keys(recomputedBundle.verdictTable).length} gates matched recomputation`
      : `Mismatches: ${recomputedVerdictMismatches.join("; ")}; hasMutationsPending=${hasMutationsPendingPlaceholder}`
  );

  // 13. Late-stage files check when skipLateStageFiles is false
  if (!options?.skipLateStageFiles) {
    const mutCompletedMs = Date.parse(String(a22?.completedAt || a22?.evaluatedAt || ""));
    const verdictEvalMs = Date.parse(String(a24?.evaluatedAt || ""));
    addCheck(
      "ARTIFACT22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT_AND_CHRONOLOGY",
      "MUTATION_SUITE",
      "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json completed BEFORE 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json.evaluatedAt and caught >= 98 mutations with 0 false passes",
      a22?.codeSha === expectedSha &&
        a22?.falsePassesCount === 0 &&
        a22?.totalMutationsExecuted >= 98 &&
        a22?.caughtMutationsCount === a22?.totalMutationsExecuted &&
        a22?.sourceTreeRestoredClean === true &&
        Number.isFinite(mutCompletedMs) &&
        Number.isFinite(verdictEvalMs) &&
        mutCompletedMs <= verdictEvalMs,
      `caught=${a22?.caughtMutationsCount}/${a22?.totalMutationsExecuted}, falsePasses=${a22?.falsePassesCount}, mutCompleted=${a22?.completedAt}, verdictEval=${a24?.evaluatedAt}`
    );

    if (!options?.skipManifestCheck) {
      const manifest = readJsonSafe(
        path.join(artifactDir, "25_SHA256_ARTIFACT_MANIFEST.json")
      );
      const manifestFiles: any[] = Array.isArray(manifest?.files) ? manifest.files : [];
      const allDigestsMatchDisk =
        manifestFiles.length === 27 &&
        manifestFiles.every((f: any) => {
          if (
            typeof f?.fileName !== "string" ||
            typeof f?.sha256 !== "string" ||
            !/^[0-9a-f]{64}$/.test(f.sha256)
          ) {
            return false;
          }
          const abs = path.join(artifactDir, f.fileName);
          return fs.existsSync(abs) && sha256FileSync(abs) === f.sha256;
        });
      addCheck(
        "ARTIFACT25_SHA256_ARTIFACT_MANIFEST_VALID",
        "MANIFEST",
        "25_SHA256_ARTIFACT_MANIFEST.json lists all 27 other artifacts with exact on-disk 64-char hex SHA-256 digests",
        manifest?.codeSha === expectedSha && allDigestsMatchDisk,
        `filesCount=${manifestFiles.length}, allDigestsMatchDisk=${allDigestsMatchDisk}`
      );
    }

    if (!options?.skipCommitPushProof) {
      const a27 = readJsonSafe(
        path.join(artifactDir, "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json")
      );
      addCheck(
        "ARTIFACT27_COMMIT_PUSH_REMOTE_HEAD_PROOF_VALID",
        "GIT_HYGIENE",
        "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json records verified testedCodeSha and target branch",
        a27?.branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" &&
          (a27?.codeSha === expectedSha || a27?.testedCodeSha === expectedSha),
        `branch=${a27?.branch}, testedCodeSha=${a27?.testedCodeSha || a27?.codeSha}`
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
 * Executes 8 physical source-file mutations + 42 mandatory V12.4.3.7.3 negative scenarios (A01..A42) +
 * 48 baseline artifact mutations = 98 physical mutations in an isolated temporary copy,
 * proving `caught === total`, `falsePassesCount === 0`, and `sourceTreeRestoredClean === true`.
 */
export function runExpandedPhysicalNegativeMutationSuiteV12_4_3_7_2(
  artifactDir: string,
  codeSha: string,
  repoRoot: string = process.cwd()
): {
  codeSha: string;
  startedAt: string;
  completedAt: string;
  evaluatedAt: string;
  totalMutationsExecuted: number;
  sourceMutationsExecuted: number;
  artifactMutationsExecuted: number;
  mandatoryV12_4_3_7_3ScenariosExecuted: number;
  mandatoryV12_4_3_7_2ScenariosExecuted: number;
  caughtMutationsCount: number;
  falsePassesCount: number;
  sourceTreeRestoredClean: boolean;
  gitDiffBeforeAfterByteCount: number;
  mutations: PhysicalMutationCaseResultV12_4_3_7_2[];
} {
  const startedAt = new Date().toISOString();
  const results: PhysicalMutationCaseResultV12_4_3_7_2[] = [];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v12-4-3-7-3-mut-"));
  const tempArtDir = path.join(tempRoot, "artifacts");
  const tempRepoRoot = path.join(tempRoot, "repo");
  fs.mkdirSync(tempArtDir, { recursive: true });
  fs.mkdirSync(path.join(tempRepoRoot, "src/services/kh02/marketplace"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tempRepoRoot, "src/services/kh02/identity"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tempRepoRoot, "src/services/kh02/persistence"), {
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
    "src/services/kh02/persistence/kh02PersistenceService.ts",
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
    "V12_4_3_7_3_SRC_MUT_01",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Reintroduce forbidden internal fetch('/portal-migration/hz/glow/address-change...') in amazonUsMcpTransport.ts",
    (src) => `${src}\nconst _badGlow = "/portal-migration/hz/glow/address-change";\n`
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_02",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported isValidAmazonRawSnapshotHash from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export function isValidAmazonRawSnapshotHash(",
        "function _hiddenIsValidAmazonRawSnapshotHash("
      )
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_03",
    "src/services/kh02/marketplace/amazonUsMcpTransport.ts",
    "Remove exported buildAmazonUiPhaseContextProof from amazonUsMcpTransport.ts",
    (src) =>
      src.replace(
        "export function buildAmazonUiPhaseContextProof(",
        "function _hiddenBuildAmazonUiPhaseContextProof("
      )
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_04",
    "src/services/kh02/marketplace/amazonUsIdentity.ts",
    "Remove EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE guard from amazonUsIdentity.ts",
    (src) =>
      src.replace(
        /EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE/g,
        "REMOVED_GUARD"
      )
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_05",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Reintroduce Math.random() synthetic ad ID generation in productCandidateDiscovery.ts",
    (src) => `${src}\nconst _badId = "ad_" + Math.random().toString(36);\n`
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_06",
    "src/services/kh02/persistence/kh02PersistenceService.ts",
    "Remove !Array.isArray(browserEvidence.displayedCandidateIds) fail-closed guard from kh02PersistenceService.ts",
    (src) =>
      src.replace(
        "!Array.isArray(browserEvidence.displayedCandidateIds)",
        "false /* guard removed */"
      )
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_07",
    "src/services/kh02/evergreenResearchOrchestrator.ts",
    "Reintroduce forbidden candidates.slice(0, 3) fallback in evergreenResearchOrchestrator.ts",
    (src) =>
      `${src}\nconst _fallback = amazonTargetSelection.selectedCandidates.length > 0 ? amazonTargetSelection.selectedCandidates : candidates.slice(0, 3);\n`
  );
  runSourceMutation(
    "V12_4_3_7_3_SRC_MUT_08",
    "scripts/kh02/acceptanceTruth.ts",
    "Remove exported validatePerSpecE2EReceipts from acceptanceTruth.ts",
    (src) =>
      src.replace(
        "export function validatePerSpecE2EReceipts(",
        "function _hiddenValidatePerSpecE2EReceipts("
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

  // All 42 Mandatory V12.4.3.7.3 Negative Scenarios (A01..A42 from Section 6)
  const mandatory42Scenarios: Array<[number, string, string, (d: any) => void]> = [
    [
      1,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A01] 04_E2E_SPEC_INVENTORY missing receipts array -> FAIL",
      (d) => {
        delete d.receipts;
      },
    ],
    [
      2,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A02] 04_E2E_SPEC_INVENTORY has 11/12 spec rows -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts)) d.receipts = d.receipts.slice(0, 11);
      },
    ],
    [
      3,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A03] Duplicate specFile in E2E receipts -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts.length >= 2) {
          d.receipts[1].specFile = d.receipts[0].specFile;
        }
      },
    ],
    [
      4,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A04] One spec receipt has exitCode !== 0 while summary says 12/12 passed -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[0]) d.receipts[0].exitCode = 1;
      },
    ],
    [
      5,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A05] One spec receipt has classification = SKIPPED -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[1]) d.receipts[1].classification = "SKIPPED";
      },
    ],
    [
      6,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A06] One spec receipt has totalTests = 0 or failedTests > 0 -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[2]) {
          d.receipts[2].failedTests = 1;
        }
      },
    ],
    [
      7,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A07] Summary totalE2ETestCases !== sum(spec.totalTests) -> FAIL",
      (d) => {
        d.totalE2ETestCases = 999;
      },
    ],
    [
      8,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A08] One spec receipt has wrong sourceSha -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[3]) d.receipts[3].sourceSha = "deadbeef";
      },
    ],
    [
      9,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A09] One spec receipt has invalid timestamps startedAt > endedAt -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[4]) {
          d.receipts[4].startedAt = "2099-01-01T00:00:00.000Z";
        }
      },
    ],
    [
      10,
      "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
      "[A10] One spec receipt has ownedPidsReconciled = false -> FAIL",
      (d) => {
        if (Array.isArray(d.receipts) && d.receipts[5]) d.receipts[5].ownedPidsReconciled = false;
      },
    ],
    [
      11,
      "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
      "[A11] Missing/tampered INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION verdict -> FAIL",
      (d) => {
        if (d.verdictTable) d.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION = "INCOMPLETE";
      },
    ],
    [
      12,
      "07_TYPESCRIPT_NEXT_PRODUCTION_BUILD_RECEIPTS.json",
      "[A12] Missing/invalid typecheckAndBuild receipt -> FAIL",
      (d) => {
        d.tscOk = false;
        d.tscExitCode = 1;
      },
    ],
    [
      13,
      "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
      "[A13] Missing/invalid resourceAndOrphanGuard receipt -> FAIL",
      (d) => {
        d.diskGuardPassed = false;
        d.minFreeDiskGiB = 0;
      },
    ],
    [
      14,
      "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
      "[A14] 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX contains Mutations:pending placeholder -> FAIL",
      (d) => {
        d.pendingNote = "Mutations:pending";
      },
    ],
    [
      15,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A15] phase5_pdp_readback.observedAt > phase6_post_session_close.closeFinishedAt -> FAIL",
      (d) => {
        if (d.phase5_pdp_readback) d.phase5_pdp_readback.observedAt = "2099-12-31T23:59:59.000Z";
        if (d.phases?.phase5_pdp_readback) d.phases.phase5_pdp_readback.observedAt = "2099-12-31T23:59:59.000Z";
      },
    ],
    [
      16,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A16] phase4 observedAt equals final report synthesis timestamp evaluatedAt -> FAIL",
      (d) => {
        if (d.phase4_search_readback) d.phase4_search_readback.observedAt = d.evaluatedAt;
        if (d.phases?.phase4_search_readback) d.phases.phase4_search_readback.observedAt = d.evaluatedAt;
      },
    ],
    [
      17,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A17] phase5_pdp_readback.status = INCOMPLETE -> FAIL",
      (d) => {
        if (d.phase5_pdp_readback) d.phase5_pdp_readback.status = "INCOMPLETE";
        if (d.phases?.phase5_pdp_readback) d.phases.phase5_pdp_readback.status = "INCOMPLETE";
      },
    ],
    [
      18,
      "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
      "[A18] closeStartedAt < lastToolCompletedAt in Amazon MCP session -> FAIL",
      (d) => {
        d.lastToolCompletedAt = "2099-01-01T00:00:10.000Z";
        d.closeStartedAt = "2099-01-01T00:00:05.000Z";
      },
    ],
    [
      19,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A19] sessionId mismatch across Phase 1..6 -> FAIL",
      (d) => {
        if (d.phase4_search_readback) d.phase4_search_readback.sessionId = "amz-sess-mismatch";
        if (d.phases?.phase4_search_readback) d.phases.phase4_search_readback.sessionId = "amz-sess-mismatch";
      },
    ],
    [
      20,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A20] Missing or phony rawSnapshotHash on phase3 -> FAIL",
      (d) => {
        if (d.phase3_home_readback) d.phase3_home_readback.rawSnapshotHash = "todo_placeholder";
        if (d.phases?.phase3_home_readback) d.phases.phase3_home_readback.rawSnapshotHash = "todo_placeholder";
      },
    ],
    [
      21,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A21] finalEffectiveUsDeliveryVerified = false while finalZipVerdict = PASS -> FAIL",
      (d) => {
        d.finalEffectiveUsDeliveryVerified = false;
        d.finalZipVerdict = "PASS";
      },
    ],
    [
      22,
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "[A22] finalEffectiveCurrencyUsdVerified = false while finalUsdCommercialVerdict = PASS -> FAIL",
      (d) => {
        d.finalEffectiveCurrencyUsdVerified = false;
        d.finalUsdCommercialVerdict = "PASS";
      },
    ],
    [
      23,
      "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
      "[A23] Currency inferred from $ symbol only -> FAIL",
      (d) => {
        d.usdInferredFromBareDollarSymbolAlone = true;
      },
    ],
    [
      24,
      "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
      "[A24] Homepage ZIP 95829 borrowed onto PDP whose own header shows null ZIP -> FAIL",
      (d) => {
        d.zipBorrowedFromHomepageWhenPdpMissing = true;
      },
    ],
    [
      25,
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "[A25] domCandidateIdsBeforeReload or AfterReload missing -> FAIL (never fallback to dbIds)",
      (d) => {
        if (d.uiDomReloadParity) {
          delete d.uiDomReloadParity.domCandidateIdsBeforeReload;
          delete d.uiDomReloadParity.domCandidateIdsAfterReload;
        }
      },
    ],
    [
      26,
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "[A26] DOM candidate IDs after reload differ from before reload -> FAIL",
      (d) => {
        if (d.uiDomReloadParity) {
          d.uiDomReloadParity.domCandidateIdsAfterReload = ["cand_tampered_1"];
        }
      },
    ],
    [
      27,
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "[A27] GET API returns cached/fixture data while claiming live run parity -> FAIL",
      (d) => {
        if (d.httpGetParity) {
          d.httpGetParity.returnedCachedOrFixtureAsLiveCount = 1;
        }
      },
    ],
    [
      28,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A28] sourceMode !== LIVE_ONLY or pre-seeded rows > 0 -> FAIL",
      (d) => {
        d.sourceMode = "CACHE_FALLBACK";
      },
    ],
    [
      29,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A29] metaTelemetry is empty {} -> FAIL",
      (d) => {
        d.metaTelemetry = {};
      },
    ],
    [
      30,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A30] subqueriesExecutedCount > actual completed query receipts -> FAIL",
      (d) => {
        d.subqueriesExecutedCount = 99;
      },
    ],
    [
      31,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A31] Query receipt missing providerRequestId -> FAIL",
      (d) => {
        if (Array.isArray(d.metaTelemetry?.queryOutcomes) && d.metaTelemetry.queryOutcomes[0]) {
          d.metaTelemetry.queryOutcomes[0].providerRequestId = "";
        }
      },
    ],
    [
      32,
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "[A32] Cached/synthetic/cross-workspace ad promoted into live candidate -> FAIL",
      (d) => {
        d.crossWorkspaceAdLinkedCount = 1;
      },
    ],
    [
      33,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A33] validatedLiveObservationsCount !== candidateAssociatedLiveObservationsCount without rejected reason -> FAIL",
      (d) => {
        d.validatedLiveObservationsCount = 99;
        d.candidateAssociatedLiveObservationsCount = 1;
        d.lineageRejectedCount = 0;
      },
    ],
    [
      34,
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "[A34] lineagePassedCount < 3 while claiming strict-live Top 3 PASS -> FAIL",
      (d) => {
        d.lineagePassedCount = 2;
      },
    ],
    [
      35,
      "18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST.json",
      "[A35] Post-cutoff row admitted into DEV replay -> FAIL",
      (d) => {
        d.postCutoffRowsIncludedCount = 1;
      },
    ],
    [
      36,
      "20_HISTORICAL_PROVIDER_VACUITY_AND_NO_LOOKAHEAD.json",
      "[A36] TEST_FIXTURE row admitted into historical replay -> FAIL",
      (d) => {
        d.fixtureRowsIncludedInLiveReplayCount = 1;
      },
    ],
    [
      37,
      "18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST.json",
      "[A37] Historical provider parity marked PASS when pre-cutoff Amazon/Walmart rows = 0 -> FAIL",
      (d) => {
        d.historicalProviderParityVerdict = "PASS";
      },
    ],
    [
      38,
      "17_WALMART_PAUSED_EXTERNAL_GATE.json",
      "[A38] Walmart live HTTP requests > 0 while gate status is PAUSED_EXTERNAL -> FAIL",
      (d) => {
        if (d.walmartPaused) d.walmartPaused.currentRunLiveWalmartHttpRequests = 1;
      },
    ],
    [
      39,
      "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
      "[A39] G07, G15, G16, or FULL_KH02_BUSINESS_ACCEPTANCE marked PASS without required proof -> FAIL",
      (d) => {
        if (d.verdictTable) d.verdictTable.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
      },
    ],
    [
      40,
      "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
      "[A40] Free disk < 15 GiB -> FAIL",
      (d) => {
        d.minFreeDiskGiB = 12.0;
      },
    ],
    [
      41,
      "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
      "[A41] Orphaned test-spawned process remains after run -> FAIL",
      (d) => {
        d.orphanedOwnedProcessCount = 1;
      },
    ],
    [
      42,
      "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
      "[A42] Concurrent heavy process count exceeds 2 -> FAIL",
      (d) => {
        d.maxConcurrentHeavyObserved = 3;
      },
    ],
  ];

  for (const [scenarioNum, file, desc, fn] of mandatory42Scenarios) {
    runArtifactMutation(
      `V12_4_3_7_3_NEG_SCENARIO_A${String(scenarioNum).padStart(2, "0")}`,
      file,
      desc,
      fn,
      scenarioNum
    );
  }

  // 48 Baseline Artifact Mutations
  const baseline48ArtifactMutations: Array<[string, string, (d: any) => void]> = [
    [
      "00_GIT_BRANCH_CODE_SHA_AND_TREE.json",
      "Mutate branch to master",
      (d) => {
        d.branch = "master";
      },
    ],
    [
      "00_GIT_BRANCH_CODE_SHA_AND_TREE.json",
      "Mutate codeSha to wrong SHA",
      (d) => {
        d.codeSha = "0000000000000000000000000000000000000000";
      },
    ],
    [
      "00_GIT_BRANCH_CODE_SHA_AND_TREE.json",
      "Set ancestryVerified = false",
      (d) => {
        d.ancestryVerified = false;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set playwrightMcpHandshakePassed = false",
      (d) => {
        d.playwrightMcpHandshakePassed = false;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set freeDiskGiB = 8 (below 15 GiB floor)",
      (d) => {
        d.freeDiskGiB = 8;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set metaCollectorVenvAvailable = false",
      (d) => {
        d.metaCollectorVenvAvailable = false;
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Mutate standaloneReference.manifest.referenceAvailability to FULL_RAW_BUNDLE",
      (d) => {
        if (d.standaloneReference?.manifest) {
          d.standaloneReference.manifest.referenceAvailability = "FULL_RAW_BUNDLE";
        }
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set standaloneReference.downgradeNegativeTestPassed = false",
      (d) => {
        if (d.standaloneReference) {
          d.standaloneReference.downgradeNegativeTestPassed = false;
        }
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set standaloneReference.parserVerification.observationClass = AUTHORIZED_LIVE",
      (d) => {
        if (d.standaloneReference?.parserVerification) {
          d.standaloneReference.parserVerification.observationClass = "AUTHORIZED_LIVE";
        }
      },
    ],
    [
      "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
      "Set standaloneReference.manifest.referenceRawHashVerified = true",
      (d) => {
        if (d.standaloneReference?.manifest) {
          d.standaloneReference.manifest.referenceRawHashVerified = true;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set inProcessExecuteResearchJobUsedForPrimaryAcceptance = true",
      (d) => {
        if (d.serverWorkerProcess) {
          d.serverWorkerProcess.inProcessExecuteResearchJobUsedForPrimaryAcceptance = true;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set processesTerminatedCleanly = false",
      (d) => {
        if (d.serverWorkerProcess) {
          d.serverWorkerProcess.processesTerminatedCleanly = false;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set serverProcessPid === workerProcessPid",
      (d) => {
        if (d.serverWorkerProcess) {
          d.serverWorkerProcess.workerProcessPid = d.serverWorkerProcess.serverProcessPid;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set requestSourceMode = LIVE_WITH_CACHE_FALLBACK for strict live gate",
      (d) => {
        if (d.httpPostJobFencing) {
          d.httpPostJobFencing.requestSourceMode = "LIVE_WITH_CACHE_FALLBACK";
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set primaryWorkspacePreSeededAdRowCount = 9",
      (d) => {
        if (d.httpPostJobFencing) {
          d.httpPostJobFencing.primaryWorkspacePreSeededAdRowCount = 9;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set postHttpStatus = 500",
      (d) => {
        if (d.httpPostJobFencing) {
          d.httpPostJobFencing.postHttpStatus = 500;
        }
      },
    ],
    [
      "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
      "Set httpPollCount = 0",
      (d) => {
        if (d.httpPostJobFencing) {
          d.httpPostJobFencing.httpPollCount = 0;
        }
      },
    ],
    [
      "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
      "Set primaryWorkspacePreSeededAdRowCount = 5",
      (d) => {
        d.primaryWorkspacePreSeededAdRowCount = 5;
      },
    ],
    [
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "Set sourceMode = CACHE_ONLY",
      (d) => {
        d.sourceMode = "CACHE_ONLY";
      },
    ],
    [
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "Set cachePromotedToLiveCount = 1",
      (d) => {
        d.cachePromotedToLiveCount = 1;
      },
    ],
    [
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "Set syntheticPromotedToLiveCount = 1",
      (d) => {
        d.syntheticPromotedToLiveCount = 1;
      },
    ],
    [
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "Set missingPersistedAdInDbCount = 1",
      (d) => {
        d.missingPersistedAdInDbCount = 1;
      },
    ],
    [
      "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
      "Set unexecutedQueryObservationCount = 1",
      (d) => {
        d.unexecutedQueryObservationCount = 1;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set nonProductPromotedToShortlistCount = 1",
      (d) => {
        d.nonProductPromotedToShortlistCount = 1;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set irrelevantPromotedToShortlistCount = 1",
      (d) => {
        d.irrelevantPromotedToShortlistCount = 1;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set distinctFamiliesInShortlistCount = 1",
      (d) => {
        d.distinctFamiliesInShortlistCount = 1;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set shortfallPaddingDetected = true",
      (d) => {
        d.shortfallPaddingDetected = true;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set reversedOrderIdentical = false",
      (d) => {
        d.reversedOrderIdentical = false;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set provisionalPromotedToEvergreenWinnersCount = 1",
      (d) => {
        d.provisionalPromotedToEvergreenWinnersCount = 1;
      },
    ],
    [
      "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
      "Set corroboratedRunSeparation.promotedToStrictLiveOnlyGate = true",
      (d) => {
        if (d.corroboratedRunSeparation) {
          d.corroboratedRunSeparation.promotedToStrictLiveOnlyGate = true;
        }
      },
    ],
    [
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "Inject workspaceId mismatch between artifact 13 and artifact 12",
      (d) => {
        d.workspaceId = "ws_mismatched_other";
      },
    ],
    [
      "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
      "Set internalGlowFetchUsed = true",
      (d) => {
        d.internalGlowFetchUsed = true;
      },
    ],
    [
      "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
      "Set usedForbiddenSliceFallback = true",
      (d) => {
        d.usedForbiddenSliceFallback = true;
      },
    ],
    [
      "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
      "Set operationsAttempted = 6 (exceeding 4-op budget cap)",
      (d) => {
        d.operationsAttempted = 6;
      },
    ],
    [
      "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
      "Set fabricatedLiveSuccess = true",
      (d) => {
        d.fabricatedLiveSuccess = true;
      },
    ],
    [
      "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
      "Set sponsoredCardsSelectedCount = 1",
      (d) => {
        d.sponsoredCardsSelectedCount = 1;
      },
    ],
    [
      "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
      "Set unvisitedCardsPromotedToVerifiedCount = 1",
      (d) => {
        d.unvisitedCardsPromotedToVerifiedCount = 1;
      },
    ],
    [
      "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
      "Set searchBrandCopiedFromCandidateCount = 1",
      (d) => {
        d.searchBrandCopiedFromCandidateCount = 1;
      },
    ],
    [
      "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
      "Set falseExactProductPromotionCount = 1",
      (d) => {
        d.falseExactProductPromotionCount = 1;
      },
    ],
    [
      "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
      "Set mcpSessionClosedCleanly = false",
      (d) => {
        d.mcpSessionClosedCleanly = false;
      },
    ],
    [
      "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
      "Set ownedChildPidTerminated = false",
      (d) => {
        d.ownedChildPidTerminated = false;
      },
    ],
    [
      "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
      "Set allLiveOpsMatchSessionId = false",
      (d) => {
        d.allLiveOpsMatchSessionId = false;
      },
    ],
    [
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "Set syncJobPersisted = false",
      (d) => {
        if (d.dbPersistence) d.dbPersistence.syncJobPersisted = false;
      },
    ],
    [
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "Set HTTP transportMode = IN_PROCESS_ROUTE_CALL",
      (d) => {
        if (d.httpGetParity) d.httpGetParity.transportMode = "IN_PROCESS_ROUTE_CALL";
      },
    ],
    [
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "Set UI DOM provisionalRenderedAsVerifiedEvergreenCount = 1",
      (d) => {
        if (d.uiDomReloadParity) {
          d.uiDomReloadParity.provisionalRenderedAsVerifiedEvergreenCount = 1;
        }
      },
    ],
    [
      "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
      "Set secondaryNiche.crossNicheOverlapCount = 1",
      (d) => {
        if (d.secondaryNiche) {
          d.secondaryNiche.crossNicheOverlapCount = 1;
        }
      },
    ],
    [
      "05_TARGETED_UNIT_INTEGRATION_RESULTS.json",
      "Set failedCasesCount = 1",
      (d) => {
        d.failedCasesCount = 1;
      },
    ],
    [
      "06_FULL_REPOSITORY_REGRESSION_SHARDS.json",
      "Set excludedOrDeferredFilesCount = 1",
      (d) => {
        d.excludedOrDeferredFilesCount = 1;
      },
    ],
  ];

  baseline48ArtifactMutations.forEach(([file, desc, fn], idx) => {
    runArtifactMutation(
      `V12_4_3_7_3_BASE_ART_MUT_${String(idx + 1).padStart(2, "0")}`,
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
      "git diff -- src/services/kh02/marketplace/amazonUsMcpTransport.ts src/services/kh02/marketplace/amazonUsIdentity.ts src/services/kh02/identity/productCandidateDiscovery.ts src/services/kh02/evergreenResearchOrchestrator.ts src/services/kh02/persistence/kh02PersistenceService.ts src/app/api/v1/kh02/research/route.ts scripts/kh02/acceptanceTruth.ts",
      {
        cwd: repoRoot,
        encoding: "utf8",
      }
    );
    gitDiffBytes = Buffer.byteLength(diffOut, "utf8");
  } catch {}

  const caughtMutationsCount = results.filter((r) => r.caught).length;
  const falsePassesCount = results.length - caughtMutationsCount;
  const completedAt = new Date().toISOString();

  return {
    codeSha,
    startedAt,
    completedAt,
    evaluatedAt: completedAt,
    totalMutationsExecuted: results.length,
    sourceMutationsExecuted: results.filter(
      (r) => r.targetType === "SOURCE_CODE_TEMP_COPY"
    ).length,
    artifactMutationsExecuted: results.filter(
      (r) => r.targetType === "ARTIFACT_FILE_TEMP_COPY"
    ).length,
    mandatoryV12_4_3_7_3ScenariosExecuted: mandatory42Scenarios.length,
    mandatoryV12_4_3_7_2ScenariosExecuted: mandatory42Scenarios.length,
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
      `[V12.4.3.7.3 Mutation Check] Caught ${mutRep.caughtMutationsCount}/${mutRep.totalMutationsExecuted}, falsePasses=${mutRep.falsePassesCount}`
    );
    if (mutRep.falsePassesCount > 0 || mutRep.totalMutationsExecuted < 98) {
      process.exit(1);
    }
  }
}
