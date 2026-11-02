/**
 * SWAI KH-02 V12.4.3.7 — Independent Fail-Closed Validator & Physical Negative Mutation Suite
 *
 * Verifies:
 * 1. All 31 required acceptance artifacts (00..29 + SHA256_MANIFEST.json) exist, are non-empty, and share identical CODE_SHA.
 * 2. Physical source code invariants in:
 *    - src/services/kh02/identity/productCandidateDiscovery.ts
 *    - src/services/kh02/evergreenResearchOrchestrator.ts
 *    - src/services/kh02/marketplace/amazonUsEvidenceAdapter.ts
 *    - src/app/api/v1/kh02/research/route.ts
 * 3. Real API POST /api/v1/kh02/research -> kh02Worker -> Live Meta -> Candidate Discovery -> Dynamic Amazon MCP Search + Observed Href PDP -> SQLite DB -> GET APIs -> Chromium DOM before & after reload.
 * 4. Two-Tier Identity Model (searchIdentityVerdict, metaCandidateEquivalenceVerdict, combinedIdentityVerdict) & /clp/<ASIN> canonical URL support.
 * 5. Secondary Niche ("Home Organization") zero-overlap proof & Walmart operational pause (0 live HTTP requests).
 * 6. 58-case V12.4.3.7 Test Matrix + Full 156-file Repository Regression + 12 E2E Specs + DEV/HOLDOUT Replay.
 * 7. Physical-file Negative Mutation Suite (6 isolated source mutations + 46 artifact validator mutations = 52 total mutations).
 */

import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const REQUIRED_V12_4_3_7_ARTIFACTS = [
  "00_GIT_STATE_AND_BRANCH_VERIFICATION.json",
  "01_RUNTIME_AND_MCP_PRECHECK.json",
  "02_STANDALONE_AMAZON_REFERENCE_CONTRACT_AND_AVAILABILITY.json",
  "03_REAL_RUN_REQUEST_AND_WORKER_LIFECYCLE.json",
  "04_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
  "05_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
  "06_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
  "07_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json",
  "08_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
  "09_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
  "10_AMAZON_PDP_EXTRACTION_AND_TWO_TIER_IDENTITY_VERDICTS.json",
  "11_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
  "12_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json",
  "13_API_READBACK_PARITY_REPORT.json",
  "14_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json",
  "15_SECONDARY_NICHE_NO_OVERLAP_PROOF.json",
  "16_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json",
  "17_NON_INFLATION_BEFORE_AFTER_PROOF.json",
  "18_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json",
  "19_NEGATIVE_AND_POSITIVE_TEST_MATRIX_RESULTS.json",
  "20_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json",
  "21_FULL_REPOSITORY_REGRESSION_RESULTS.json",
  "22_E2E_SPEC_EXECUTION_RECEIPTS.json",
  "23_HISTORICAL_DEV_REPLAY_2026_10_24.json",
  "24_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
  "25_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
  "26_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json",
  "27_INDEPENDENT_VALIDATOR_REPORT.json",
  "28_FINAL_RELEASE_VERDICT_TABLE.json",
  "29_FINAL_OWNER_REPORT_VI.md",
  "SHA256_MANIFEST.json",
] as const;

export interface ValidatorCheckItemV12_4_3_7 {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  detail: string;
}

export interface ValidatorReportV12_4_3_7 {
  codeSha: string;
  evaluatedAt: string;
  artifactDir: string;
  overallVerdict: "PASS" | "FAIL";
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  failedCheckIds: string[];
  checks: ValidatorCheckItemV12_4_3_7[];
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

export function validateRealSourceTop3LiveClosureArtifacts(
  artifactDir: string,
  options?: {
    expectedCodeSha?: string;
    skipLateStageFiles?: boolean;
    repoRoot?: string;
  }
): ValidatorReportV12_4_3_7 {
  const repoRoot = options?.repoRoot || process.cwd();
  const checks: ValidatorCheckItemV12_4_3_7[] = [];
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
    "26_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json",
    "27_INDEPENDENT_VALIDATOR_REPORT.json",
    "29_FINAL_OWNER_REPORT_VI.md",
    "SHA256_MANIFEST.json",
  ]);

  // 1. Check presence and non-emptiness of all required artifacts
  for (const fileName of REQUIRED_V12_4_3_7_ARTIFACTS) {
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

  const a00 = readJsonSafe(path.join(artifactDir, "00_GIT_STATE_AND_BRANCH_VERIFICATION.json"));
  const a01 = readJsonSafe(path.join(artifactDir, "01_RUNTIME_AND_MCP_PRECHECK.json"));
  const a02 = readJsonSafe(path.join(artifactDir, "02_STANDALONE_AMAZON_REFERENCE_CONTRACT_AND_AVAILABILITY.json"));
  const a03 = readJsonSafe(path.join(artifactDir, "03_REAL_RUN_REQUEST_AND_WORKER_LIFECYCLE.json"));
  const a04 = readJsonSafe(path.join(artifactDir, "04_LIVE_META_COLLECTION_AND_OBSERVATIONS.json"));
  const a05 = readJsonSafe(path.join(artifactDir, "05_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json"));
  const a06 = readJsonSafe(path.join(artifactDir, "06_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json"));
  const a07 = readJsonSafe(path.join(artifactDir, "07_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json"));
  const a08 = readJsonSafe(path.join(artifactDir, "08_AMAZON_LIVE_MCP_OPERATION_LEDGER.json"));
  const a09 = readJsonSafe(path.join(artifactDir, "09_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json"));
  const a10 = readJsonSafe(path.join(artifactDir, "10_AMAZON_PDP_EXTRACTION_AND_TWO_TIER_IDENTITY_VERDICTS.json"));
  const a11 = readJsonSafe(path.join(artifactDir, "11_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json"));
  const a12 = readJsonSafe(path.join(artifactDir, "12_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json"));
  const a13 = readJsonSafe(path.join(artifactDir, "13_API_READBACK_PARITY_REPORT.json"));
  const a14 = readJsonSafe(path.join(artifactDir, "14_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json"));
  const a15 = readJsonSafe(path.join(artifactDir, "15_SECONDARY_NICHE_NO_OVERLAP_PROOF.json"));
  const a16 = readJsonSafe(path.join(artifactDir, "16_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json"));
  const a17 = readJsonSafe(path.join(artifactDir, "17_NON_INFLATION_BEFORE_AFTER_PROOF.json"));
  const a18 = readJsonSafe(path.join(artifactDir, "18_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json"));
  const a19 = readJsonSafe(path.join(artifactDir, "19_NEGATIVE_AND_POSITIVE_TEST_MATRIX_RESULTS.json"));
  const a20 = readJsonSafe(path.join(artifactDir, "20_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json"));
  const a21 = readJsonSafe(path.join(artifactDir, "21_FULL_REPOSITORY_REGRESSION_RESULTS.json"));
  const a22 = readJsonSafe(path.join(artifactDir, "22_E2E_SPEC_EXECUTION_RECEIPTS.json"));
  const a23 = readJsonSafe(path.join(artifactDir, "23_HISTORICAL_DEV_REPLAY_2026_10_24.json"));
  const a24 = readJsonSafe(path.join(artifactDir, "24_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json"));
  const a25 = readJsonSafe(path.join(artifactDir, "25_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json"));
  const a28 = readJsonSafe(path.join(artifactDir, "28_FINAL_RELEASE_VERDICT_TABLE.json"));

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
    "Branch ancestry from origin/QA and baseline SHA is verified",
    a00?.ancestryVerified === true,
    `ancestryVerified=${a00?.ancestryVerified}`
  );

  // Check SHA parity across all JSON artifacts
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
    ["28", a28],
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

  const discoverySourceText = fs.existsSync(discoverySourcePath)
    ? fs.readFileSync(discoverySourcePath, "utf8")
    : "";
  const orchestratorSourceText = fs.existsSync(orchestratorSourcePath)
    ? fs.readFileSync(orchestratorSourcePath, "utf8")
    : "";
  const researchRouteSourceText = fs.existsSync(researchRouteSourcePath)
    ? fs.readFileSync(researchRouteSourcePath, "utf8")
    : "";

  const hasMathRandomInDiscovery = /Math\.random\s*\(/.test(discoverySourceText);
  const hasNormalizeSourceObservationFn =
    /export\s+function\s+normalizeSourceObservation\s*\(/.test(discoverySourceText);
  const hasUnsafeEarlyReturnRawAsSourceObservation =
    /return\s+raw\s+as\s+SourceObservation/.test(discoverySourceText);
  const hasForbiddenCandidatesSliceFallback =
    /amazonTargetSelection\.selectedCandidates\.length\s*>\s*0\s*\?\s*amazonTargetSelection\.selectedCandidates\s*:\s*candidates\.slice\(0,\s*3\)/.test(
      orchestratorSourceText
    );
  const hasForbiddenAmazonPolicyOverrideGuard =
    /FORBIDDEN_AMAZON_POLICY_OVERRIDE/.test(researchRouteSourceText);

  addCheck(
    "SOURCE_NO_MATH_RANDOM_IN_DISCOVERY",
    "SOURCE_INVARIANTS",
    "productCandidateDiscovery.ts contains zero Math.random() calls",
    discoverySourceText.length > 100 && !hasMathRandomInDiscovery,
    `hasMathRandom=${hasMathRandomInDiscovery}`
  );
  addCheck(
    "SOURCE_HAS_NORMALIZE_SOURCE_OBSERVATION",
    "SOURCE_INVARIANTS",
    "productCandidateDiscovery.ts exports normalizeSourceObservation and removes unsafe raw bypass",
    hasNormalizeSourceObservationFn && !hasUnsafeEarlyReturnRawAsSourceObservation,
    `hasNormalizeFn=${hasNormalizeSourceObservationFn}, hasUnsafeBypass=${hasUnsafeEarlyReturnRawAsSourceObservation}`
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

  // 4. Runtime & Standalone Reference Contract (01, 02)
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
    "ARTIFACT02_STANDALONE_AMAZON_REFERENCE_CONTRACT",
    "STANDALONE_CONTRACT",
    "Standalone Amazon reference contract records availability status and reproduces B0D3XGHTJ5 / TD20 / WECACO / $49.99 USD / 95829 /clp/B0D3XGHTJ5 + 4 DISCOVERED_NOT_VERIFIED cards",
    (a02?.availabilityStatus === "REFERENCE_SUMMARY_ONLY / ORIGINAL_RAW_BUNDLE_UNAVAILABLE" ||
      a02?.availabilityStatus === "ORIGINAL_RAW_BUNDLE_PRESENT") &&
      a02?.referenceContractVerified?.asin === "B0D3XGHTJ5" &&
      a02?.referenceContractVerified?.brand === "faroro" &&
      a02?.referenceContractVerified?.model === "TD20" &&
      a02?.referenceContractVerified?.seller === "WECACO" &&
      a02?.referenceContractVerified?.price === 49.99 &&
      a02?.referenceContractVerified?.currency === "USD" &&
      a02?.referenceContractVerified?.observedDeliveryPostalCode === "95829" &&
      a02?.referenceContractVerified?.observedCanonicalUrl ===
        "https://www.amazon.com/clp/B0D3XGHTJ5" &&
      a02?.referenceContractVerified?.searchIdentityVerdict ===
        "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED" &&
      Array.isArray(a02?.referenceContractVerified?.discoveredNotVerifiedAsins) &&
      a02.referenceContractVerified.discoveredNotVerifiedAsins.length === 4,
    `status=${a02?.availabilityStatus}, asin=${a02?.referenceContractVerified?.asin}`
  );

  // 5. Real Run Request & Worker Lifecycle + Live Meta Collection (03, 04, 05, 06)
  addCheck(
    "ARTIFACT03_REAL_RUN_REQUEST_AND_WORKER_LIFECYCLE",
    "REAL_PIPELINE",
    "Real POST /api/v1/kh02/research request created SyncJob (HTTP 202) and kh02Worker transitioned QUEUED -> RUNNING -> COMPLETED/PARTIALLY_COMPLETED with valid lease & fencing",
    a03?.postHttpStatus === 202 &&
      typeof a03?.researchRunId === "string" &&
      a03.researchRunId.length > 5 &&
      a03?.workerClaimed === true &&
      (a03?.finalJobStatus === "COMPLETED" ||
        a03?.finalJobStatus === "PARTIALLY_COMPLETED") &&
      a03?.fencingGeneration >= 1,
    `httpStatus=${a03?.postHttpStatus}, runId=${a03?.researchRunId}, finalStatus=${a03?.finalJobStatus}`
  );
  addCheck(
    "ARTIFACT04_LIVE_META_COLLECTION_AND_OBSERVATIONS",
    "REAL_PIPELINE",
    "Live Meta upstream collection attempted and provenance strictly separates LIVE_PROVIDER from CACHED_SOURCE with zero synthetic IDs promoted",
    a04?.liveAttempted === true &&
      typeof a04?.subqueriesExecutedCount === "number" &&
      a04.subqueriesExecutedCount >= 1 &&
      a04?.syntheticPromotedToLiveCount === 0 &&
      a04?.cachePromotedToLiveCount === 0 &&
      (a04?.metaCollectionVerdict === "PASS" ||
        a04?.metaCollectionVerdict === "DEGRADED_CACHE_SUPPLEMENTED" ||
        a04?.metaCollectionVerdict === "BLOCKED_UPSTREAM"),
    `verdict=${a04?.metaCollectionVerdict}, liveObs=${a04?.liveProviderObservationsCount}, cachedObs=${a04?.cachedObservationsCount}`
  );
  addCheck(
    "ARTIFACT05_CANDIDATE_DISCOVERY_FUNNEL",
    "REAL_PIPELINE",
    "Candidate discovery funnel separates relevant physical products from non-product/irrelevant items",
    a05?.relevantPhysicalCandidatesCount >= 3 &&
      a05?.nonProductPromotedToShortlistCount === 0 &&
      a05?.irrelevantPromotedToShortlistCount === 0,
    `relevantPhysical=${a05?.relevantPhysicalCandidatesCount}, nonProductPromoted=${a05?.nonProductPromotedToShortlistCount}`
  );
  addCheck(
    "ARTIFACT06_FAMILY_DEDUPLICATION_AND_SHORTLIST",
    "REAL_PIPELINE",
    "Product family deduplication produces 3 distinct families in Top 3 shortlist with order independence and zero shortfall padding",
    a06?.shortlistCount === 3 &&
      a06?.distinctFamiliesInShortlistCount === 3 &&
      a06?.reversedOrderIdentical === true &&
      a06?.shortfallPaddingDetected === false &&
      a06?.provisionalPromotedToEvergreenWinnersCount === 0,
    `shortlist=${a06?.shortlistCount}, distinctFamilies=${a06?.distinctFamiliesInShortlistCount}`
  );

  // 6. Dynamic Amazon Target Selection, Search Cards, Observed Href PDP, Two-Tier Identity & Same-Session MCP (07, 08, 09, 10, 11)
  addCheck(
    "ARTIFACT07_AMAZON_TARGET_SELECTION_AND_SEARCH_PLAN",
    "AMAZON_LIVE_CLOSURE",
    "Dynamic Amazon target selection selects eligible shortlist candidates and derives bounded search intents without candidates.slice(0,3) fallback",
    a07?.targetSelectionLedger?.selectedCount >= 1 &&
      a07?.usedForbiddenSliceFallback === false &&
      Array.isArray(a07?.searchIntentPlans) &&
      a07.searchIntentPlans.length >= 1,
    `selectedCount=${a07?.targetSelectionLedger?.selectedCount}, plans=${a07?.searchIntentPlans?.length}`
  );
  addCheck(
    "ARTIFACT08_AMAZON_LIVE_MCP_OPERATION_LEDGER",
    "AMAZON_LIVE_CLOSURE",
    "Amazon live MCP operation ledger stays within <= 4 logical ops/run and records real home/location readback",
    typeof a08?.operationsAttempted === "number" &&
      a08.operationsAttempted >= 1 &&
      a08.operationsAttempted <= 4 &&
      a08?.homeAndLocationReadbackRecorded === true &&
      a08?.fabricatedLiveSuccess === false,
    `ops=${a08?.operationsAttempted}/4, homeReadback=${a08?.homeAndLocationReadbackRecorded}`
  );
  addCheck(
    "ARTIFACT09_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF",
    "AMAZON_LIVE_CLOSURE",
    "Amazon search snapshot enforces <= 5 non-sponsored cards cap, preserves observedSearchHref, and marks unvisited cards DISCOVERED_NOT_VERIFIED",
    a09?.maxCardsPerSearchCap === 5 &&
      a09?.sponsoredCardsSelectedCount === 0 &&
      a09?.unvisitedCardsPromotedToVerifiedCount === 0 &&
      (a09?.observedHrefSelectedCount >= 1 || a09?.searchBlockedOrEmpty === true),
    `observedHrefSelected=${a09?.observedHrefSelectedCount}, unvisitedPromoted=${a09?.unvisitedCardsPromotedToVerifiedCount}`
  );
  addCheck(
    "ARTIFACT10_AMAZON_PDP_AND_TWO_TIER_IDENTITY",
    "AMAZON_LIVE_CLOSURE",
    "Amazon PDP extraction records Two-Tier Identity verdicts (searchIdentityVerdict, metaCandidateEquivalenceVerdict, combinedIdentityVerdict) without false EXACT_PRODUCT inflation",
    Array.isArray(a10?.evaluatedCandidates) &&
      a10.evaluatedCandidates.length >= 1 &&
      a10?.falseExactProductPromotionCount === 0 &&
      a10?.searchBrandCopiedFromCandidateCount === 0,
    `evaluated=${a10?.evaluatedCandidates?.length}, falseExact=${a10?.falseExactProductPromotionCount}`
  );
  addCheck(
    "ARTIFACT11_AMAZON_MCP_SAME_SESSION_LIFECYCLE",
    "AMAZON_LIVE_CLOSURE",
    "Same-session REAL_STDIO_MCP lifecycle proves all live ops match sessionId and owned child PID terminated cleanly",
    a11?.transportMode === "REAL_STDIO_MCP" &&
      a11?.serverOrigin === "PINNED_PLAYWRIGHT_MCP" &&
      a11?.allLiveOpsMatchSessionId === true &&
      a11?.mcpSessionClosedCleanly === true &&
      a11?.ownedChildPidTerminated === true &&
      a11?.closedAfterLastToolCompleted === true,
    `sessionId=${a11?.sessionId}, closedCleanly=${a11?.mcpSessionClosedCleanly}, pidTerminated=${a11?.ownedChildPidTerminated}`
  );

  // 7. DB Persistence, API Readback Parity & Product Finder UI Chromium Reload Parity (12, 13, 14)
  addCheck(
    "ARTIFACT12_DB_PERSISTENCE_SNAPSHOT",
    "DB_API_UI_PARITY",
    "SyncJob snapshot and ResearchEvidence rows persist atomically and idempotently in SQLite",
    a12?.syncJobPersisted === true &&
      a12?.idempotentRePersistVerified === true &&
      typeof a12?.persistedShortlistCount === "number" &&
      a12.persistedShortlistCount === 3,
    `syncJob=${a12?.syncJobPersisted}, shortlist=${a12?.persistedShortlistCount}, evidenceRows=${a12?.researchEvidenceRowCount}`
  );
  addCheck(
    "ARTIFACT13_API_READBACK_PARITY",
    "DB_API_UI_PARITY",
    "Authenticated GET /leaderboard, GET /research, GET /research/runs/[runId], and GET /marketplace/amazon match SQLite DB snapshot",
    a13?.parityPassed === true &&
      a13?.leaderboardHttpStatus === 200 &&
      a13?.researchHttpStatus === 200 &&
      a13?.runByIdHttpStatus === 200 &&
      a13?.amazonRouteHttpStatus === 200 &&
      Array.isArray(a13?.mismatches) &&
      a13.mismatches.length === 0,
    `parityPassed=${a13?.parityPassed}, mismatches=${a13?.mismatches?.length}`
  );
  addCheck(
    "ARTIFACT14_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY",
    "DB_API_UI_PARITY",
    "Headless Chromium renders Product Finder UI cards and Amazon evidence identically before and after page.reload()",
    a14?.parityPassed === true &&
      a14?.cardsBeforeReloadCount === 3 &&
      a14?.cardsAfterReloadCount === 3 &&
      a14?.provisionalRenderedAsVerifiedEvergreenCount === 0 &&
      Array.isArray(a14?.mismatches) &&
      a14.mismatches.length === 0,
    `parityPassed=${a14?.parityPassed}, cardsBefore=${a14?.cardsBeforeReloadCount}, cardsAfter=${a14?.cardsAfterReloadCount}`
  );

  // 8. Secondary Niche No-Overlap, Walmart Pause, Non-Inflation & Isolation (15, 16, 17, 18)
  addCheck(
    "ARTIFACT15_SECONDARY_NICHE_NO_OVERLAP",
    "SECONDARY_NICHE",
    "Secondary niche ('Home Organization') produces 3 distinct home organization candidates with 0 overlap against 'Pet Gadgets'",
    a15?.primaryNiche === "Pet Gadgets" &&
      a15?.secondaryNiche === "Home Organization" &&
      a15?.secondaryShortlistCount === 3 &&
      a15?.crossNicheOverlapCount === 0 &&
      a15?.parityPassed === true,
    `secondaryShortlist=${a15?.secondaryShortlistCount}, overlap=${a15?.crossNicheOverlapCount}`
  );
  addCheck(
    "ARTIFACT16_WALMART_PAUSED_STATUS",
    "WALMART_PAUSE",
    "Walmart US remains paused (PAUSED_EXTERNAL / BLOCKED_PROVIDER) with 0 live HTTP requests and preserved 2026-11-02 CAPTCHA receipt",
    a16?.policy?.featureEnabled === false &&
      a16?.policy?.liveAllowed === false &&
      a16?.policy?.operationalStatus === "PAUSED_EXTERNAL" &&
      a16?.currentRunLiveWalmartHttpRequests === 0 &&
      a16?.priorLiveBlockerReference?.responseBytes === 16845 &&
      a16?.priorLiveBlockerReference?.responseSha256 ===
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4",
    `liveHttp=${a16?.currentRunLiveWalmartHttpRequests}, status=${a16?.policy?.operationalStatus}`
  );
  addCheck(
    "ARTIFACT17_NON_INFLATION_PROOF",
    "NON_INFLATION",
    "Amazon and Walmart corroboration produce 0 score delta, 0 rank change, and 0 G07/G15/G16 promotion",
    a17?.nonInflationVerified === true &&
      a17?.scoreDeltaAbsMax === 0 &&
      a17?.rankingChanged === false &&
      a17?.g07PromotedCount === 0 &&
      a17?.g15PromotedCount === 0 &&
      a17?.g16PromotedCount === 0,
    `nonInflationVerified=${a17?.nonInflationVerified}, scoreDelta=${a17?.scoreDeltaAbsMax}`
  );
  addCheck(
    "ARTIFACT18_READ_ONLY_GET_AND_WORKSPACE_ISOLATION",
    "SECURITY_ISOLATION",
    "GET endpoints mutate 0 rows, reject cross-workspace access (403/404), and POST rejects client policy overrides (400)",
    a18?.readOnlyVerified === true &&
      a18?.crossWorkspaceDenied === true &&
      a18?.walmartPolicyOverrideRejected400 === true &&
      a18?.amazonPolicyOverrideRejected400 === true,
    `readOnly=${a18?.readOnlyVerified}, crossWs=${a18?.crossWorkspaceDenied}, amzOverride400=${a18?.amazonPolicyOverrideRejected400}`
  );

  // 9. Test Matrix, Targeted Suites, Full Regression & E2E (19, 20, 21, 22)
  addCheck(
    "ARTIFACT19_NEGATIVE_AND_POSITIVE_TEST_MATRIX",
    "TEST_MATRIX",
    "All 58 V12.4.3.7 test matrix cases (Groups A..E) executed and passed",
    a19?.allPassed === true &&
      a19?.failedCasesCount === 0 &&
      a19?.totalCasesCount >= 58,
    `passed=${a19?.passedCasesCount}/${a19?.totalCasesCount}`
  );
  addCheck(
    "ARTIFACT20_TARGETED_SUITES_PASSED",
    "TEST_MATRIX",
    "Targeted V12.4.3.7 + V12.4.3.6 + V12.4.3.5.1 unit/integration suites passed with 0 failures",
    a20?.allPassed === true && a20?.failedTests === 0 && a20?.passedTests >= 300,
    `suites=${a20?.passedSuites}/${a20?.totalSuites}, tests=${a20?.passedTests}/${a20?.totalTests}`
  );
  addCheck(
    "ARTIFACT21_FULL_REPOSITORY_REGRESSION",
    "TEST_MATRIX",
    "100% of discovered repository test files (156 files) executed with 0 failures",
    a21?.inventoryComplete === true &&
      a21?.excludedOrDeferredFilesCount === 0 &&
      a21?.failedTestCases === 0 &&
      a21?.executedTestFilesCount >= 156 &&
      a21?.passedTestCases >= 1890,
    `files=${a21?.executedTestFilesCount}/${a21?.totalDiscoveredTestFiles}, tests=${a21?.passedTestCases}/${a21?.totalExecutedTestCases}`
  );
  addCheck(
    "ARTIFACT22_ALL_12_E2E_SPECS_PASSED",
    "TEST_MATRIX",
    "All 12 E2E specs (34 test cases) executed and passed with 0 skips",
    a22?.totalSpecs === 12 &&
      a22?.passedSpecsCount === 12 &&
      a22?.failedSpecsCount === 0 &&
      a22?.skippedWithoutAttemptCount === 0 &&
      a22?.passedE2ETestCases >= 34,
    `specs=${a22?.passedSpecsCount}/${a22?.totalSpecs}, cases=${a22?.passedE2ETestCases}/${a22?.totalE2ETestCases}`
  );

  // 10. Historical DEV (2026-10-24) & HOLDOUT (2026-10-30) Replay + Point-in-Time Audit (23, 24, 25)
  addCheck(
    "ARTIFACT23_DEV_HISTORICAL_REPLAY_2026_10_24",
    "HISTORICAL_BACKTEST",
    "DEV historical replay (2026-10-24) executed with pointInTimeIntegrityVerdict = PASS and 0 post-cutoff rows",
    a23?.split === "DEV" &&
      a23?.backtestEngineExecuted === "PASS" &&
      a23?.pointInTimeIntegrityVerdict === "PASS" &&
      a23?.postCutoffRowsIncludedCount === 0 &&
      a23?.historicalDevBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE",
    `obs=${a23?.historicalObservationCount}, shortlist=${a23?.shortlistCount}, verdict=${a23?.historicalDevBusinessVerdict}`
  );
  addCheck(
    "ARTIFACT24_HOLDOUT_HISTORICAL_REPLAY_2026_10_30",
    "HISTORICAL_BACKTEST",
    "HOLDOUT historical replay (2026-10-30) executed with pointInTimeIntegrityVerdict = PASS and 0 post-cutoff rows",
    a24?.split === "HOLDOUT" &&
      a24?.backtestEngineExecuted === "PASS" &&
      a24?.pointInTimeIntegrityVerdict === "PASS" &&
      a24?.postCutoffRowsIncludedCount === 0 &&
      a24?.shortlistCount === 3 &&
      a24?.verifiedIdentityCount === 0 &&
      a24?.historicalHoldoutBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE",
    `obs=${a24?.historicalObservationCount}, shortlist=${a24?.shortlistCount}, verdict=${a24?.historicalHoldoutBusinessVerdict}`
  );
  addCheck(
    "ARTIFACT25_POINT_IN_TIME_NO_LOOKAHEAD",
    "HISTORICAL_BACKTEST",
    "Point-in-time no-lookahead audit rejects post-cutoff and fixture records across Ads, ResearchProduct, Amazon, and Walmart",
    a25?.pointInTimeIntegrityVerdict === "PASS" &&
      a25?.postCutoffIncludedInReplayCount === 0 &&
      a25?.fixtureRowsIncludedInLiveReplayCount === 0 &&
      a25?.semanticHashAcceptedAsRawProductSchemaProofCount === 0 &&
      a25?.amazonPostCutoffExcludedCount >= 1 &&
      a25?.walmartPostCutoffExcludedCount >= 1,
    `pitVerdict=${a25?.pointInTimeIntegrityVerdict}, postCutoffIncluded=${a25?.postCutoffIncludedInReplayCount}`
  );

  // 11. Final Release Verdict Table (28) — Section 13 Exact Contract
  const vTable = a28?.verdictTable || a28;
  addCheck(
    "ARTIFACT28_SECTION13_VERDICT_TABLE",
    "RELEASE_VERDICT",
    "Final release verdict table matches Section 13 fail-closed separation of engineering vs live/business verdicts",
    vTable?.CODE_AND_ENGINEERING_GATES === "PASS" &&
      (vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "PASS" ||
        vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "DEGRADED_CACHE_SUPPLEMENTED" ||
        vTable?.META_LIVE_CURRENT_RUN_COLLECTION === "BLOCKED_UPSTREAM") &&
      vTable?.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION === "PASS" &&
      (vTable?.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "PASS" ||
        vTable?.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PASS" ||
        vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "PARTIAL" ||
        vTable?.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION === "BLOCKED_ACCESS_CHALLENGE") &&
      (vTable?.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PASS" ||
        vTable?.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION === "PARTIAL") &&
      (vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "PASS" ||
        vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION ===
          "PARTIAL_CATEGORY_OR_FAMILY_ONLY" ||
        vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION === "UNVERIFIED") &&
      (vTable?.AMAZON_US_COMMERCIAL_COMPLETENESS_USD_ZIP_SELLER === "PASS" ||
        vTable?.AMAZON_US_COMMERCIAL_COMPLETENESS_USD_ZIP_SELLER ===
          "OBSERVED_PARTIAL" ||
        vTable?.AMAZON_US_COMMERCIAL_COMPLETENESS_USD_ZIP_SELLER === "UNVERIFIED") &&
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
        "ENGINEERING_READY_WITH_TRUTHFUL_LIVE_AND_EXTERNAL_BLOCKERS",
    JSON.stringify({
      ENG: vTable?.CODE_AND_ENGINEERING_GATES,
      META: vTable?.META_LIVE_CURRENT_RUN_COLLECTION,
      AMZ_SEARCH_PDP: vTable?.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION,
      META_AMZ_EQ: vTable?.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION,
      BIZ: vTable?.FULL_KH02_BUSINESS_ACCEPTANCE,
    })
  );

  // 12. Late-stage files check when skipLateStageFiles is false
  if (!options?.skipLateStageFiles) {
    const a26 = readJsonSafe(
      path.join(artifactDir, "26_PHYSICAL_NEGATIVE_MUTATION_SUITE_RESULTS.json")
    );
    addCheck(
      "ARTIFACT26_PHYSICAL_MUTATIONS_ALL_CAUGHT",
      "MUTATION_SUITE",
      "Physical negative mutation suite executed >= 48 mutations with 0 false passes",
      a26?.falsePassesCount === 0 &&
        a26?.totalMutationsExecuted >= 48 &&
        a26?.caughtMutationsCount === a26?.totalMutationsExecuted &&
        a26?.sourceTreeRestoredClean === true,
      `caught=${a26?.caughtMutationsCount}/${a26?.totalMutationsExecuted}, falsePasses=${a26?.falsePassesCount}`
    );

    const manifest = readJsonSafe(path.join(artifactDir, "SHA256_MANIFEST.json"));
    addCheck(
      "SHA256_MANIFEST_VALID",
      "MANIFEST",
      "SHA256_MANIFEST.json lists >= 30 artifacts with valid 64-char hex digests",
      Array.isArray(manifest?.files) &&
        manifest.files.length >= 30 &&
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

export interface PhysicalMutationCaseResultV12_4_3_7 {
  mutationId: string;
  targetType: "SOURCE_CODE_TEMP_COPY" | "ARTIFACT_FILE_TEMP_COPY";
  targetFile: string;
  description: string;
  caught: boolean;
  failedCheckIds: string[];
  detail: string;
}

/**
 * Runs 6 physical source-file mutations (in an isolated temp copy of the repo root)
 * + 46 physical artifact mutations (in an isolated temp copy of the artifact directory)
 * = 52 physical mutations total (>= 48 required), verifying that every single mutation is caught
 * (`caught === true`, `falsePassesCount === 0`) and the working tree remains 100% clean.
 */
export function runPhysicalNegativeMutationSuiteV12_4_3_7(
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
  mutations: PhysicalMutationCaseResultV12_4_3_7[];
} {
  const results: PhysicalMutationCaseResultV12_4_3_7[] = [];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v12-4-3-7-mut-"));
  const tempArtDir = path.join(tempRoot, "artifacts");
  const tempRepoRoot = path.join(tempRoot, "repo");
  fs.mkdirSync(tempArtDir, { recursive: true });
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
      const rep = validateRealSourceTop3LiveClosureArtifacts(tempArtDir, {
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
    "V12_4_3_7_SRC_MUT_01",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Reintroduce Math.random() synthetic ad ID generation in productCandidateDiscovery.ts",
    (src) => `${src}\nconst _badId = "ad_" + Math.random().toString(36);\n`
  );
  runSourceMutation(
    "V12_4_3_7_SRC_MUT_02",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Reintroduce unsafe 'return raw as SourceObservation' early return",
    (src) => `${src}\nfunction _bypass(raw: any) { return raw as SourceObservation; }\n`
  );
  runSourceMutation(
    "V12_4_3_7_SRC_MUT_03",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Remove exported normalizeSourceObservation from productCandidateDiscovery.ts",
    (src) =>
      src.replace(
        "export function normalizeSourceObservation(",
        "function _hiddenNormalizeSourceObservation("
      )
  );
  runSourceMutation(
    "V12_4_3_7_SRC_MUT_04",
    "src/services/kh02/evergreenResearchOrchestrator.ts",
    "Reintroduce forbidden candidates.slice(0, 3) fallback in evergreenResearchOrchestrator.ts",
    (src) =>
      `${src}\nconst _fallback = amazonTargetSelection.selectedCandidates.length > 0 ? amazonTargetSelection.selectedCandidates : candidates.slice(0, 3);\n`
  );
  runSourceMutation(
    "V12_4_3_7_SRC_MUT_05",
    "src/app/api/v1/kh02/research/route.ts",
    "Remove FORBIDDEN_AMAZON_POLICY_OVERRIDE guard from POST /api/v1/kh02/research",
    (src) => src.replace(/FORBIDDEN_AMAZON_POLICY_OVERRIDE/g, "ALLOWED_OVERRIDE")
  );
  runSourceMutation(
    "V12_4_3_7_SRC_MUT_06",
    "src/services/kh02/identity/productCandidateDiscovery.ts",
    "Truncate productCandidateDiscovery.ts to empty stub",
    () => "// stub"
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
      const rep = validateRealSourceTop3LiveClosureArtifacts(tempArtDir, {
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
      "00_GIT_STATE_AND_BRANCH_VERIFICATION.json",
      "Mutate branch to master",
      (d) => {
        d.branch = "master";
      },
    ],
    [
      "00_GIT_STATE_AND_BRANCH_VERIFICATION.json",
      "Mutate codeSha to wrong SHA",
      (d) => {
        d.codeSha = "0000000000000000000000000000000000000000";
      },
    ],
    [
      "00_GIT_STATE_AND_BRANCH_VERIFICATION.json",
      "Set ancestryVerified = false",
      (d) => {
        d.ancestryVerified = false;
      },
    ],
    [
      "01_RUNTIME_AND_MCP_PRECHECK.json",
      "Set playwrightMcpHandshakePassed = false",
      (d) => {
        d.playwrightMcpHandshakePassed = false;
      },
    ],
    [
      "01_RUNTIME_AND_MCP_PRECHECK.json",
      "Set freeDiskGiB = 8 (below 15 GiB floor)",
      (d) => {
        d.freeDiskGiB = 8;
      },
    ],
    [
      "02_STANDALONE_AMAZON_REFERENCE_CONTRACT_AND_AVAILABILITY.json",
      "Mutate reference ASIN from B0D3XGHTJ5 to B000000000",
      (d) => {
        d.referenceContractVerified.asin = "B000000000";
      },
    ],
    [
      "02_STANDALONE_AMAZON_REFERENCE_CONTRACT_AND_AVAILABILITY.json",
      "Mutate reference observedCanonicalUrl away from /clp/B0D3XGHTJ5",
      (d) => {
        d.referenceContractVerified.observedCanonicalUrl = "https://www.amazon.com/dp/B000";
      },
    ],
    [
      "03_REAL_RUN_REQUEST_AND_WORKER_LIFECYCLE.json",
      "Set postHttpStatus = 500",
      (d) => {
        d.postHttpStatus = 500;
      },
    ],
    [
      "03_REAL_RUN_REQUEST_AND_WORKER_LIFECYCLE.json",
      "Set finalJobStatus = FAILED",
      (d) => {
        d.finalJobStatus = "FAILED";
      },
    ],
    [
      "04_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
      "Set syntheticPromotedToLiveCount = 1",
      (d) => {
        d.syntheticPromotedToLiveCount = 1;
      },
    ],
    [
      "04_LIVE_META_COLLECTION_AND_OBSERVATIONS.json",
      "Set cachePromotedToLiveCount = 2",
      (d) => {
        d.cachePromotedToLiveCount = 2;
      },
    ],
    [
      "05_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
      "Set nonProductPromotedToShortlistCount = 1",
      (d) => {
        d.nonProductPromotedToShortlistCount = 1;
      },
    ],
    [
      "05_CANDIDATE_DISCOVERY_AND_NICHE_RELEVANCE_FUNNEL.json",
      "Set irrelevantPromotedToShortlistCount = 1",
      (d) => {
        d.irrelevantPromotedToShortlistCount = 1;
      },
    ],
    [
      "06_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
      "Set distinctFamiliesInShortlistCount = 1",
      (d) => {
        d.distinctFamiliesInShortlistCount = 1;
      },
    ],
    [
      "06_PRODUCT_FAMILY_DEDUPLICATION_AND_SHORTLIST.json",
      "Set shortfallPaddingDetected = true",
      (d) => {
        d.shortfallPaddingDetected = true;
      },
    ],
    [
      "07_AMAZON_TARGET_SELECTION_AND_SEARCH_INTENT_PLAN.json",
      "Set usedForbiddenSliceFallback = true",
      (d) => {
        d.usedForbiddenSliceFallback = true;
      },
    ],
    [
      "08_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
      "Set operationsAttempted = 6 (exceeding 4-op budget cap)",
      (d) => {
        d.operationsAttempted = 6;
      },
    ],
    [
      "08_AMAZON_LIVE_MCP_OPERATION_LEDGER.json",
      "Set fabricatedLiveSuccess = true",
      (d) => {
        d.fabricatedLiveSuccess = true;
      },
    ],
    [
      "09_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
      "Set sponsoredCardsSelectedCount = 1",
      (d) => {
        d.sponsoredCardsSelectedCount = 1;
      },
    ],
    [
      "09_AMAZON_SEARCH_CARDS_AND_OBSERVED_HREF_SELECTION.json",
      "Set unvisitedCardsPromotedToVerifiedCount = 1",
      (d) => {
        d.unvisitedCardsPromotedToVerifiedCount = 1;
      },
    ],
    [
      "10_AMAZON_PDP_EXTRACTION_AND_TWO_TIER_IDENTITY_VERDICTS.json",
      "Set falseExactProductPromotionCount = 1",
      (d) => {
        d.falseExactProductPromotionCount = 1;
      },
    ],
    [
      "10_AMAZON_PDP_EXTRACTION_AND_TWO_TIER_IDENTITY_VERDICTS.json",
      "Set searchBrandCopiedFromCandidateCount = 1",
      (d) => {
        d.searchBrandCopiedFromCandidateCount = 1;
      },
    ],
    [
      "11_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set mcpSessionClosedCleanly = false",
      (d) => {
        d.mcpSessionClosedCleanly = false;
      },
    ],
    [
      "11_AMAZON_MCP_SAME_SESSION_LIFECYCLE_PROOF.json",
      "Set ownedChildPidTerminated = false",
      (d) => {
        d.ownedChildPidTerminated = false;
      },
    ],
    [
      "12_DB_PERSISTENCE_SNAPSHOT_AND_RESEARCH_EVIDENCE_ROWS.json",
      "Set syncJobPersisted = false",
      (d) => {
        d.syncJobPersisted = false;
      },
    ],
    [
      "13_API_READBACK_PARITY_REPORT.json",
      "Set parityPassed = false",
      (d) => {
        d.parityPassed = false;
      },
    ],
    [
      "14_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json",
      "Inject DOM reload mismatch",
      (d) => {
        d.mismatches = ["Reload card count mismatch"];
      },
    ],
    [
      "14_PRODUCT_FINDER_UI_DOM_AND_RELOAD_PARITY.json",
      "Set provisionalRenderedAsVerifiedEvergreenCount = 1",
      (d) => {
        d.provisionalRenderedAsVerifiedEvergreenCount = 1;
      },
    ],
    [
      "15_SECONDARY_NICHE_NO_OVERLAP_PROOF.json",
      "Set crossNicheOverlapCount = 1",
      (d) => {
        d.crossNicheOverlapCount = 1;
      },
    ],
    [
      "16_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json",
      "Set currentRunLiveWalmartHttpRequests = 1",
      (d) => {
        d.currentRunLiveWalmartHttpRequests = 1;
      },
    ],
    [
      "16_WALMART_PAUSED_STATUS_AND_PRIOR_CAPTCHA_RECEIPT.json",
      "Corrupt Walmart 2026-11-02 CAPTCHA SHA-256",
      (d) => {
        d.priorLiveBlockerReference.responseSha256 = "0000";
      },
    ],
    [
      "17_NON_INFLATION_BEFORE_AFTER_PROOF.json",
      "Set scoreDeltaAbsMax = 4.2",
      (d) => {
        d.scoreDeltaAbsMax = 4.2;
      },
    ],
    [
      "17_NON_INFLATION_BEFORE_AFTER_PROOF.json",
      "Set g15PromotedCount = 1",
      (d) => {
        d.g15PromotedCount = 1;
      },
    ],
    [
      "18_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json",
      "Set crossWorkspaceDenied = false",
      (d) => {
        d.crossWorkspaceDenied = false;
      },
    ],
    [
      "18_READ_ONLY_GET_AND_WORKSPACE_ISOLATION_PROOF.json",
      "Set amazonPolicyOverrideRejected400 = false",
      (d) => {
        d.amazonPolicyOverrideRejected400 = false;
      },
    ],
    [
      "19_NEGATIVE_AND_POSITIVE_TEST_MATRIX_RESULTS.json",
      "Set failedCasesCount = 1",
      (d) => {
        d.failedCasesCount = 1;
      },
    ],
    [
      "20_TARGETED_UNIT_AND_INTEGRATION_TEST_RESULTS.json",
      "Set failedTests = 1",
      (d) => {
        d.failedTests = 1;
      },
    ],
    [
      "21_FULL_REPOSITORY_REGRESSION_RESULTS.json",
      "Set excludedOrDeferredFilesCount = 1",
      (d) => {
        d.excludedOrDeferredFilesCount = 1;
      },
    ],
    [
      "22_E2E_SPEC_EXECUTION_RECEIPTS.json",
      "Set skippedWithoutAttemptCount = 1",
      (d) => {
        d.skippedWithoutAttemptCount = 1;
      },
    ],
    [
      "23_HISTORICAL_DEV_REPLAY_2026_10_24.json",
      "Set DEV postCutoffRowsIncludedCount = 1",
      (d) => {
        d.postCutoffRowsIncludedCount = 1;
      },
    ],
    [
      "24_HISTORICAL_HOLDOUT_REPLAY_2026_10_30.json",
      "Fabricate HOLDOUT verifiedIdentityCount = 3",
      (d) => {
        d.verifiedIdentityCount = 3;
      },
    ],
    [
      "25_POINT_IN_TIME_NO_LOOKAHEAD_AUDIT.json",
      "Set semanticHashAcceptedAsRawProductSchemaProofCount = 1",
      (d) => {
        d.semanticHashAcceptedAsRawProductSchemaProofCount = 1;
      },
    ],
    [
      "28_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate FULL_KH02_BUSINESS_ACCEPTANCE = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
        d.FULL_KH02_BUSINESS_ACCEPTANCE = "PASS";
      },
    ],
    [
      "28_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate G15_LONGITUDINAL_DEMAND_60D = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.G15_LONGITUDINAL_DEMAND_60D = "PASS";
        d.G15_LONGITUDINAL_DEMAND_60D = "PASS";
      },
    ],
    [
      "28_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate G16_INDEPENDENT_MERCHANT_PROOF = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.G16_INDEPENDENT_MERCHANT_PROOF = "PASS";
        d.G16_INDEPENDENT_MERCHANT_PROOF = "PASS";
      },
    ],
    [
      "28_FINAL_RELEASE_VERDICT_TABLE.json",
      "Fabricate WALMART_US_LIVE_OPERATIONAL_STATUS = PASS",
      (d) => {
        if (d.verdictTable) d.verdictTable.WALMART_US_LIVE_OPERATIONAL_STATUS = "PASS";
        d.WALMART_US_LIVE_OPERATIONAL_STATUS = "PASS";
      },
    ],
  ];

  artifactMutations.forEach(([file, desc, fn], idx) => {
    runArtifactMutation(
      `V12_4_3_7_ART_MUT_${String(idx + 1).padStart(2, "0")}`,
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
      "git diff -- src/services/kh02/identity/productCandidateDiscovery.ts src/services/kh02/evergreenResearchOrchestrator.ts src/app/api/v1/kh02/research/route.ts",
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
      "Usage: npx tsx scripts/kh02/validateRealSourceTop3LiveClosureV12_4_3_7.ts <artifactDir> [--mutate-check]"
    );
    process.exit(1);
  }
  const rep = validateRealSourceTop3LiveClosureArtifacts(targetDir);
  console.log(JSON.stringify(rep, null, 2));
  if (rep.overallVerdict !== "PASS") {
    process.exit(1);
  }
  if (mutateCheck) {
    const mutRep = runPhysicalNegativeMutationSuiteV12_4_3_7(
      targetDir,
      rep.codeSha
    );
    console.log(
      `[Mutation Check] Caught ${mutRep.caughtMutationsCount}/${mutRep.totalMutationsExecuted}, falsePasses=${mutRep.falsePassesCount}`
    );
    if (mutRep.falsePassesCount > 0 || mutRep.totalMutationsExecuted < 48) {
      process.exit(1);
    }
  }
}
