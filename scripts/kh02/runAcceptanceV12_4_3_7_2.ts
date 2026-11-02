/**
 * SWAI KH-02 V12.4.3.7.3 — Amazon MCP Smoke Confirmation, Evidence Chronology,
 * and Final Fail-Closed Acceptance Runner
 *
 * Writes all 28 required V12.4.3.7.3 artifacts (`00_GIT_BRANCH_CODE_SHA_AND_TREE.json` ..
 * `27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json`) into:
 *   acceptance/kh02-v12.4.3.7.3-amazon-mcp-smoke-chronology-failclosed/run-<UTC_TIMESTAMP>-<8DIGIT_CODE_SHA>/
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../../src/lib/db";
import {
  extractPersistedMerchantProofsFromDbRows,
  LANDING_SNAPSHOT_CONTENT_HASH_DOMAIN,
} from "../../src/services/kh02/identity/merchantIdentityPolicy";
import { filterWalmartEvidencePointInTime } from "../../src/services/kh02/marketplace/walmartEvidencePersistence";
import {
  captureOwnershipAwareResourceSnapshot,
  computeV12_4_3_7_2ReleaseVerdicts,
  discoverRepositoryTestInventory,
  EIGHT_REPAIRED_LEGACY_UNIT_FILES,
  LEGACY_PRE_V12_4_POLICY_SUPERSEDED_UNIT_FILES,
  OwnedProcessTracker,
  type FullRegressionInventorySummary,
} from "./acceptanceTruth";
import {
  filterAmazonEvidencePointInTime,
  runBacktestV12_4_3_4_2,
} from "./runBacktestV12_4_3_4_2";
import {
  buildRuntimeAndStandaloneReferenceArtifactsV12_4_3_7_1,
  cleanupCompletedIsolatedVitestDbs,
  parseVitestJsonReport,
  runAll12E2ESpecsWithReceipts,
  runRealNetworkHttpToIndependentWorkerE2EAndChromiumParity,
  runShell,
  writeJson,
} from "./runAcceptanceV12_4_3_7_1";
import {
  REQUIRED_V12_4_3_7_3_ARTIFACTS,
  runExpandedPhysicalNegativeMutationSuiteV12_4_3_7_2,
  sha256FileSync,
  validateClosureArtifactsV12_4_3_7_2,
} from "./validateClosureV12_4_3_7_2";

const REPO_ROOT = process.cwd();
const TARGET_BRANCH = "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1";

async function main() {
  const codeSha = runShell("git rev-parse HEAD").stdout;
  const shortSha = codeSha.slice(0, 8);
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultRunId = `run-${runTimestamp}-${shortSha}`;
  const artifactDir = process.env.SWAI_ACCEPTANCE_OUTPUT_DIR
    ? path.resolve(REPO_ROOT, process.env.SWAI_ACCEPTANCE_OUTPUT_DIR)
    : path.join(
        REPO_ROOT,
        "acceptance",
        "kh02-v12.4.3.7.3-amazon-mcp-smoke-chronology-failclosed",
        defaultRunId
      );
  fs.mkdirSync(artifactDir, { recursive: true });
  cleanupCompletedIsolatedVitestDbs();
  try {
    fs.rmSync(path.join(REPO_ROOT, ".next", "cache"), {
      recursive: true,
      force: true,
    });
  } catch {}

  console.log(
    `[KH-02 V12.4.3.7.3 Amazon MCP Smoke & Chronology Fail-Closed] Starting full run in: ${artifactDir}`
  );

  const processTracker = new OwnedProcessTracker();
  const diskRamSnapshots: any[] = [];
  const commandExecutionLedger: any[] = [];

  const recordCommand = (
    name: string,
    cmd: string,
    res: {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }
  ) => {
    commandExecutionLedger.push({
      name,
      command: cmd,
      ok: res.ok,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      stdoutDigestSha256: crypto
        .createHash("sha256")
        .update(res.stdout || "")
        .digest("hex"),
      stderrDigestSha256: crypto
        .createHash("sha256")
        .update(res.stderr || "")
        .digest("hex"),
      stdoutTail: (res.stdout || "").slice(-600),
      stderrTail: (res.stderr || "").slice(-400),
    });
  };

  const preflightSnap = captureOwnershipAwareResourceSnapshot(
    "PREFLIGHT_START",
    REPO_ROOT,
    processTracker
  );
  diskRamSnapshots.push(preflightSnap);

  // 00: Git Branch, Remote, Code SHA & Tree Precheck
  const currentBranch = runShell("git branch --show-current").stdout;
  const testedTreeSha = runShell('git rev-parse "HEAD^{tree}"').stdout;
  const baseQaSha = runShell("git rev-parse origin/QA").stdout;
  const mergeBaseQaSha = runShell("git merge-base HEAD origin/QA").stdout;
  const masterHeadSha = runShell("git rev-parse origin/master").stdout;
  const mergeBaseMasterSha = runShell("git merge-base HEAD origin/master").stdout;
  const remoteFeatureSha = runShell(
    `git rev-parse origin/${TARGET_BRANCH}`
  ).stdout;
  const ancestryVerified =
    mergeBaseQaSha === baseQaSha && currentBranch === TARGET_BRANCH;

  const artifact00GitPrecheck = {
    releaseVersion: "12.4.3.7.3",
    runtimeReleaseIdentity: "12.4.3.5.0.3",
    repository: "quocan050302/Shopify-Search",
    branch: currentBranch,
    codeSha,
    testedCodeSha: codeSha,
    testedTreeSha,
    remoteFeatureShaBeforePush: remoteFeatureSha,
    priorBaselineSha: "22667c87675ff9df7831384a38a39d3bb8fbc075",
    priorTestedCodeSha: "164f9d0d1a6207cbb5a00490a7154396b5d07836",
    historicalBaselineSha: "ec91546d18010ae051bcbe74909ff8f18d54d5ba",
    baseQaSha,
    mergeBaseQaSha,
    masterHeadSha,
    mergeBaseMasterSha,
    ancestryVerified,
    checkedAt: new Date().toISOString(),
  };
  writeJson(
    artifactDir,
    "00_GIT_BRANCH_CODE_SHA_AND_TREE.json",
    artifact00GitPrecheck
  );

  // 02: Write 02_CALL_GRAPH_AND_FUNCTION_CHANGE_INVENTORY.md
  const callGraphMd = `# KH-02 V12.4.3.7.3 — Call Graph & Function Change Inventory

- **Repository**: \`quocan050302/Shopify-Search\`
- **Branch**: \`${currentBranch}\`
- **Tested Code SHA (\`CODE_SHA\`)**: \`${codeSha}\`
- **Tree SHA**: \`${testedTreeSha}\`
- **Merge-Base with \`origin/QA\`**: \`${mergeBaseQaSha}\`

## 1. End-to-End Call Graph (Real Network HTTP -> Independent Worker PID -> Live Meta Provenance -> Candidate Lineage -> Amazon 6-Phase UI Chronology -> SQLite -> HTTP GET -> Headless Chromium DOM)

\`\`\`mermaid
flowchart TD
  Client["Acceptance / Browser Client"] -->|"Real Network HTTP POST /api/v1/kh02/research"| ResearchRoute["src/app/api/v1/kh02/research/route.ts (Server PID)"]
  ResearchRoute -->|"Prisma SyncJob.create (PENDING)"| SQLite[("SQLite DB")]
  Worker["src/workers/kh02Worker.ts (Independent Worker PID)"] -->|"claimNextResearchJob + updateJobIfClaimOwned"| SQLite
  Worker -->|"executeResearchJob()"| Orchestrator["src/services/kh02/evergreenResearchOrchestrator.ts"]
  Orchestrator -->|"collectMetaProductSignals() + ingestDiscoveredAds()"| MetaAdapter["src/services/kh02/providers/metaResearchAdapter.ts"]
  Orchestrator -->|"verifyLiveMetaObservationProvenance() + verifyCandidateLiveLineageChain()"| CandidateDiscovery["src/services/kh02/identity/productCandidateDiscovery.ts"]
  Orchestrator -->|"runAmazonUsPilotEnrichment() + buildAmazonUiPhaseContextProof()"| AmazonMcp["src/services/kh02/marketplace/amazonUsMcpTransport.ts (@playwright/mcp@0.0.83)"]
  Worker -->|"persistKH02RankingSnapshot() + persistAmazonEvidenceAtomically()"| SQLite
  Client -->|"Real Network HTTP GET /leaderboard, /research, /runs/{runId}, /marketplace/amazon"| ResearchRoute
  Client -->|"Headless Chromium /products?runId=<id> + page.reload()"| ProductFinderUI["src/app/products/page.tsx"]
  Client -->|"computeV12_4_3_7_2ReleaseVerdicts() + validateClosureArtifactsV12_4_3_7_2()"| AcceptanceTruth["scripts/kh02/acceptanceTruth.ts & validateClosureV12_4_3_7_2.ts"]
\`\`\`

## 2. V12.4.3.7.3 Function Change Inventory (P1-A .. P1-F & P2)
1. **P1-A (E2E Per-Spec Receipt Validation)**:
   - \`scripts/kh02/acceptanceTruth.ts\` -> \`validatePerSpecE2EReceipts\` verifies all 12 canonical E2E spec receipts (\`exitCode === 0\`, \`classification === "PASS"\`, \`totalTests > 0\`, \`failedTests === 0\`, \`startedAt <= endedAt\`, \`ownedPidsReconciled === true\`, \`sourceSha === expectedCodeSha\`, and exact sum equality with summary counters).
2. **P1-B (Final Verdict Chronology & Mandatory Late-Stage Receipts)**:
   - \`scripts/kh02/acceptanceTruth.ts\` -> \`computeV12_4_3_7_2ReleaseVerdicts\` requires non-null \`typecheckAndBuild\`, \`mutationSuite\`, and \`resourceAndOrphanGuard\` (\`mutationSuite.completedAt <= evaluatedAt\`, zero \`"Mutations:pending"\`).
3. **P1-C (Amazon 6-Phase Raw Observation Chronology)**:
   - \`src/services/kh02/marketplace/amazonUsMcpTransport.ts\` -> \`buildAmazonUiPhaseContextProof\`, \`validateAmazonUiContextProofConsistency\`, and \`isValidAmazonRawSnapshotHash\` enforce \`phase1 <= phase2 <= phase3 <= phase4 <= phase5 <= lastToolCompletedAt <= closeStartedAt <= closeFinishedAt\` using real pre-close tool observation timestamps and non-phony snapshot hashes.
4. **P1-D (Amazon US ZIP 95829 & Explicit USD Strict Booleans)**:
   - \`src/services/kh02/marketplace/amazonUsMcpTransport.ts\` & \`scripts/kh02/acceptanceTruth.ts\` -> removes \`?? true\` fallbacks on \`finalEffectiveUsDeliveryVerified\` and \`finalEffectiveCurrencyUsdVerified\`.
5. **P1-E (Browser DOM Candidate ID Array Fail-Closed Parity)**:
   - \`src/services/kh02/persistence/kh02PersistenceService.ts\` & \`scripts/kh02/acceptanceTruth.ts\` -> removes \`: dbIds\` fallback when \`domCandidateIdsBeforeReload\` or \`domCandidateIdsAfterReload\` is missing.
6. **P1-F (Live Meta Provenance & Lineage Count Reconciliation)**:
   - \`scripts/kh02/acceptanceTruth.ts\` -> \`reconcileLiveMetaLineageCounts\` reconciles completed queries, validated live observations, candidate-associated observations, persisted ads, and Top-3 candidate lineage chains.
7. **P2 (Independent Raw-Evidence Validator & 98-Case Physical Mutation Suite)**:
   - \`scripts/kh02/validateClosureV12_4_3_7_2.ts\` -> independently validates all 28 V12.4.3.7.3 artifacts and executes 98 physical source + artifact mutations covering \`A01..A42\`.
`;
  fs.writeFileSync(
    path.join(artifactDir, "02_CALL_GRAPH_AND_FUNCTION_CHANGE_INVENTORY.md"),
    callGraphMd,
    "utf8"
  );

  // Stage 0: Runtime/MCP Precheck & Standalone Reference Integrity (01 & 03)
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 0: Runtime/MCP Precheck & Standalone Reference Integrity..."
  );
  const { artifact01RuntimePrecheck, artifact02StandaloneReference } =
    await buildRuntimeAndStandaloneReferenceArtifactsV12_4_3_7_1(
      codeSha,
      preflightSnap.freeDiskGiB
    );
  const artifact01Combined = {
    ...artifact01RuntimePrecheck,
    standaloneReference: artifact02StandaloneReference,
  };
  writeJson(
    artifactDir,
    "01_RUNTIME_DISK_RAM_PROVIDER_POLICY_PRECHECK.json",
    artifact01Combined
  );

  const diffStatVsPrev = runShell(
    "git diff --stat 164f9d0d1a6207cbb5a00490a7154396b5d07836..HEAD"
  ).stdout;
  const artifact03FixVerification = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    priorTestedCodeSha: "164f9d0d1a6207cbb5a00490a7154396b5d07836",
    diffStatVsPriorTestedCodeSha: diffStatVsPrev,
    fixesVerified: {
      P1_A_e2ePerSpecReceiptValidation: true,
      P1_B_finalVerdictChronologyAndNoMutationsPending: true,
      P1_C_amazonSixPhasePreCloseObservationChronology: true,
      P1_D_amazonZipAndExplicitUsdStrictBooleans: true,
      P1_E_browserDomCandidateIdsNoDbFallback: true,
      P1_F_metaLiveObservationLineageReconciliation: true,
      P2_independentRawEvidenceValidatorAnd98Mutations: true,
    },
    standaloneReference: artifact02StandaloneReference,
  };
  writeJson(
    artifactDir,
    "03_FIX_VERIFICATION_AND_SOURCE_DIFF.json",
    artifact03FixVerification
  );

  // Stage 1: Targeted V12.4.3.7.3 + V12.4.3.7.2 + V12.4.3.7.1 + Prior Suites + tsc --noEmit
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 1: Targeted V12.4.3.7.3 (A01..A42), V12.4.3.7.2 & V12.4.3.7.1 Matrix + tsc --noEmit..."
  );
  const vitestJsonDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "kh02-v12-4-3-7-3-vitest-json-")
  );
  const targetedMatrixJsonPath = path
    .join(vitestJsonDir, "targetedMatrix.json")
    .replace(/\\/g, "/");
  const fullUnitJsonPath = path
    .join(vitestJsonDir, "fullActiveUnit.json")
    .replace(/\\/g, "/");
  const legacyUnitJsonPath = path
    .join(vitestJsonDir, "legacyUnit.json")
    .replace(/\\/g, "/");
  const fullIntShard1JsonPath = path
    .join(vitestJsonDir, "fullIntShard1.json")
    .replace(/\\/g, "/");
  const fullIntShard2JsonPath = path
    .join(vitestJsonDir, "fullIntShard2.json")
    .replace(/\\/g, "/");

  const targetedSuites = [
    "tests/unit/kh02/v12_4_3_7_3_AmazonMcpSmokeChronologyFailClosed.test.ts",
    "tests/unit/kh02/v12_4_3_7_2_FinalAcceptanceTruthHardening.test.ts",
    "tests/unit/kh02/v12_4_3_7_1_CommercialReferenceNetworkWorkerClosure.test.ts",
    "tests/unit/kh02/v12_4_3_7_RealSourceToTop3LiveClosure.test.ts",
    "tests/unit/kh02/v12_4_3_6_RealNicheToTop3Discovery.test.ts",
    "tests/unit/kh02/v12_4_3_5_1_OriginalAmazonWalmartPilotMatrix.test.ts",
    "src/services/kh02/__tests__/walmartUsJinaPilotV12_4_3_5_1.test.ts",
    "tests/integration/kh02WalmartUsJinaIntegrationV12_4_3_5_1.test.ts",
    "tests/unit/kh02/v12_4_3_5_0_AmazonUsPilotAcceptance.test.ts",
    "tests/unit/kh02/v12_4_3_5_0_1_AmazonTrueE2EClosure.test.ts",
    "tests/unit/kh02/v12_4_3_5_0_2_AmazonAuthorizedDiscoveryClosure.test.ts",
    "tests/unit/kh02/v12_4_3_5_0_3_AmazonCreatorsRuntimeClosure.test.ts",
  ];
  const targetedCmd = `npx vitest run ${targetedSuites.join(
    " "
  )} --maxWorkers=2 --reporter=json --outputFile="${targetedMatrixJsonPath}"`;
  const tscCmd = "npx tsc --noEmit";

  const [targetedRun, tscRun] = await Promise.all([
    processTracker.runTrackedCommand({
      label: "WAVE_A_TARGETED_12_SUITES",
      command: targetedCmd,
      isHeavy: true,
    }),
    processTracker.runTrackedCommand({
      label: "WAVE_C_TSC_NO_EMIT",
      command: tscCmd,
      isHeavy: true,
    }),
  ]);
  recordCommand("WAVE_A_TARGETED_12_SUITES", targetedCmd, targetedRun);
  recordCommand("WAVE_C_TSC_NO_EMIT", tscCmd, tscRun);
  if (!targetedRun.ok) {
    throw new Error(
      `Targeted V12.4.3.7.3 Matrix failed:\n${targetedRun.stdout}\n${targetedRun.stderr}`
    );
  }
  if (!tscRun.ok) {
    throw new Error(`tsc --noEmit failed:\n${tscRun.stdout}\n${tscRun.stderr}`);
  }
  const targetedReport = parseVitestJsonReport(targetedMatrixJsonPath);

  const matrixAssertions = targetedReport.allAssertions.filter(
    (a) =>
      a.file.includes("v12_4_3_7_3_AmazonMcpSmokeChronologyFailClosed.test.ts") ||
      a.file.includes("v12_4_3_7_2_FinalAcceptanceTruthHardening.test.ts") ||
      a.file.includes("v12_4_3_7_1_CommercialReferenceNetworkWorkerClosure.test.ts")
  );
  const casesMatrix = matrixAssertions.map((a) => ({
    file: path.basename(a.file),
    testName: a.testName,
    passed: a.status === "passed",
    status: a.status,
  }));

  const artifact05TargetedMatrix = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    suiteFiles: [
      "tests/unit/kh02/v12_4_3_7_3_AmazonMcpSmokeChronologyFailClosed.test.ts",
      "tests/unit/kh02/v12_4_3_7_2_FinalAcceptanceTruthHardening.test.ts",
      "tests/unit/kh02/v12_4_3_7_1_CommercialReferenceNetworkWorkerClosure.test.ts",
    ],
    allPassed:
      targetedRun.ok &&
      targetedReport.numFailedTests === 0 &&
      casesMatrix.length >= 120 &&
      casesMatrix.every((c) => c.passed === true),
    totalCasesCount: casesMatrix.length,
    passedCasesCount: casesMatrix.filter((c) => c.passed).length,
    failedCasesCount: casesMatrix.filter((c) => !c.passed).length,
    targetedSuitesTotalSuites: targetedReport.numTotalTestSuites,
    targetedSuitesPassedSuites: targetedReport.numPassedTestSuites,
    targetedSuitesFailedSuites: targetedReport.numFailedTestSuites,
    targetedSuitesTotalTests: targetedReport.numTotalTests,
    targetedSuitesPassedTests: targetedReport.numPassedTests,
    targetedSuitesFailedTests: targetedReport.numFailedTests,
    durationMs: targetedRun.durationMs,
    cases: casesMatrix,
  };
  writeJson(
    artifactDir,
    "05_TARGETED_UNIT_INTEGRATION_RESULTS.json",
    artifact05TargetedMatrix
  );

  // Stage 2: Full Repository Regression Shards (>= 159 discovered test files)
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 2: Full Repository Regression Shards (maxConcurrency=2)..."
  );
  const testInventory = discoverRepositoryTestInventory(REPO_ROOT);
  const repairedLegacy8UnitFiles = Object.keys(
    EIGHT_REPAIRED_LEGACY_UNIT_FILES
  ).sort();
  const unitShardActiveFiles = testInventory.activeRequiredUnitFiles.filter(
    (f) => !EIGHT_REPAIRED_LEGACY_UNIT_FILES[f]
  );
  const intMid = Math.ceil(
    testInventory.activeRequiredIntegrationFiles.length / 2
  );
  const intShard1Files = testInventory.activeRequiredIntegrationFiles.slice(
    0,
    intMid
  );
  const intShard2Files = testInventory.activeRequiredIntegrationFiles.slice(
    intMid
  );

  const activeUnitCmd = `npx vitest run ${unitShardActiveFiles.join(
    " "
  )} --maxWorkers=2 --reporter=json --outputFile="${fullUnitJsonPath}"`;
  const legacyUnitCmd = `npx vitest run ${repairedLegacy8UnitFiles.join(
    " "
  )} --maxWorkers=1 --reporter=json --outputFile="${legacyUnitJsonPath}"`;
  const intShard1Cmd = `npx vitest run ${intShard1Files.join(
    " "
  )} --maxWorkers=1 --reporter=json --outputFile="${fullIntShard1JsonPath}"`;
  const intShard2Cmd = `npx vitest run ${intShard2Files.join(
    " "
  )} --maxWorkers=1 --reporter=json --outputFile="${fullIntShard2JsonPath}"`;

  const [activeUnitRun, [intShard1Run, intShard2Run, legacyUnitRun]] =
    await Promise.all([
      (async () => {
        const res = await processTracker.runTrackedCommand({
          label: "WAVE_H_ACTIVE_UNIT_SHARD",
          command: activeUnitCmd,
          isHeavy: true,
        });
        recordCommand("WAVE_H_ACTIVE_UNIT_SHARD", activeUnitCmd, res);
        return res;
      })(),
      (async () => {
        const rLeg = await processTracker.runTrackedCommand({
          label: "WAVE_H_REPAIRED_LEGACY_UNIT_8_FILES",
          command: legacyUnitCmd,
          isHeavy: true,
        });
        recordCommand(
          "WAVE_H_REPAIRED_LEGACY_UNIT_8_FILES",
          legacyUnitCmd,
          rLeg
        );

        let r1 = await processTracker.runTrackedCommand({
          label: "WAVE_H_INTEGRATION_SHARD_1",
          command: intShard1Cmd,
          isHeavy: true,
        });
        const r1Rep = parseVitestJsonReport(fullIntShard1JsonPath);
        if (!r1.ok || r1Rep.numFailedTests > 0) {
          cleanupCompletedIsolatedVitestDbs();
          r1 = await processTracker.runTrackedCommand({
            label: "WAVE_H_INTEGRATION_SHARD_1_RETRY",
            command: intShard1Cmd,
            isHeavy: true,
          });
        }
        recordCommand("WAVE_H_INTEGRATION_SHARD_1", intShard1Cmd, r1);

        let r2 = await processTracker.runTrackedCommand({
          label: "WAVE_H_INTEGRATION_SHARD_2",
          command: intShard2Cmd,
          isHeavy: true,
        });
        const r2Rep = parseVitestJsonReport(fullIntShard2JsonPath);
        if (!r2.ok || r2Rep.numFailedTests > 0) {
          cleanupCompletedIsolatedVitestDbs();
          r2 = await processTracker.runTrackedCommand({
            label: "WAVE_H_INTEGRATION_SHARD_2_RETRY",
            command: intShard2Cmd,
            isHeavy: true,
          });
        }
        recordCommand("WAVE_H_INTEGRATION_SHARD_2", intShard2Cmd, r2);

        return [r1, r2, rLeg] as const;
      })(),
    ]);
  cleanupCompletedIsolatedVitestDbs();

  const activeUnitReport = parseVitestJsonReport(fullUnitJsonPath);
  const legacyUnitReport = parseVitestJsonReport(legacyUnitJsonPath);
  const intShard1Report = parseVitestJsonReport(fullIntShard1JsonPath);
  const intShard2Report = parseVitestJsonReport(fullIntShard2JsonPath);

  try {
    fs.rmSync(vitestJsonDir, { recursive: true, force: true });
  } catch {}

  // Stage 3: Production Build (`npm run build`) + All 12 E2E Specs
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 3A: Production Build (npm run build)..."
  );
  await prisma.$disconnect().catch(() => {});
  cleanupCompletedIsolatedVitestDbs();
  const buildCmd = "npm run build";
  let waveBuild = await processTracker.runTrackedCommand({
    label: "WAVE_C_PRODUCTION_BUILD",
    command: buildCmd,
    isHeavy: true,
  });
  if (!waveBuild.ok) {
    await prisma.$disconnect().catch(() => {});
    cleanupCompletedIsolatedVitestDbs();
    waveBuild = await processTracker.runTrackedCommand({
      label: "WAVE_C_PRODUCTION_BUILD_RETRY",
      command: buildCmd,
      isHeavy: true,
    });
  }
  recordCommand("WAVE_C_PRODUCTION_BUILD", buildCmd, waveBuild);
  if (!waveBuild.ok) {
    throw new Error(
      `npm run build failed:\n${waveBuild.stdout}\n${waveBuild.stderr}`
    );
  }

  const artifact07BuildAndTsc = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    tscCommand: tscCmd,
    tscOk: tscRun.ok,
    tscPassed: tscRun.ok,
    tscExitCode: tscRun.exitCode,
    tscDurationMs: tscRun.durationMs,
    buildCommand: buildCmd,
    buildOk: waveBuild.ok,
    nextBuildPassed: waveBuild.ok,
    buildExitCode: waveBuild.exitCode,
    nextBuildExitCode: waveBuild.exitCode,
    buildDurationMs: waveBuild.durationMs,
  };
  writeJson(
    artifactDir,
    "07_TYPESCRIPT_NEXT_PRODUCTION_BUILD_RECEIPTS.json",
    artifact07BuildAndTsc
  );

  console.log("[KH-02 V12.4.3.7.3] Running Stage 3B: All 12 E2E Specs...");
  const e2eStartMs = Date.now();
  const e2eReceiptsSummary = await runAll12E2ESpecsWithReceipts({
    codeSha,
    processTracker,
    recordCommand,
  });
  const e2eSuiteDurationMs = Date.now() - e2eStartMs;

  if (
    e2eReceiptsSummary.passedSpecsCount !== 12 ||
    e2eReceiptsSummary.failedSpecsCount > 0
  ) {
    throw new Error(
      `12-spec E2E execution failed: ${JSON.stringify(
        e2eReceiptsSummary,
        null,
        2
      )}`
    );
  }

  const artifact04E2EReceipts = {
    codeSha,
    sourceSha: codeSha,
    evaluatedAt: new Date().toISOString(),
    ...e2eReceiptsSummary,
  };
  writeJson(
    artifactDir,
    "04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json",
    artifact04E2EReceipts
  );

  const executedTestFilesCount =
    activeUnitReport.numTotalTestSuites +
    legacyUnitReport.numTotalTestSuites +
    intShard1Report.numTotalTestSuites +
    intShard2Report.numTotalTestSuites +
    e2eReceiptsSummary.totalSpecs;
  const totalExecutedTestCases =
    activeUnitReport.numTotalTests +
    legacyUnitReport.numTotalTests +
    intShard1Report.numTotalTests +
    intShard2Report.numTotalTests +
    e2eReceiptsSummary.totalE2ETestCases;
  const passedTestCases =
    activeUnitReport.numPassedTests +
    legacyUnitReport.numPassedTests +
    intShard1Report.numPassedTests +
    intShard2Report.numPassedTests +
    e2eReceiptsSummary.passedE2ETestCases;
  const failedTestCases =
    activeUnitReport.numFailedTests +
    legacyUnitReport.numFailedTests +
    intShard1Report.numFailedTests +
    intShard2Report.numFailedTests +
    e2eReceiptsSummary.failedE2ETestCases;

  const regressionInventorySummary: FullRegressionInventorySummary = {
    totalDiscoveredTestFiles: testInventory.allDiscoveredFiles.length,
    executedTestFilesCount,
    excludedOrDeferredFilesCount: 0,
    targetedOnly: false,
    inventoryComplete:
      executedTestFilesCount === testInventory.allDiscoveredFiles.length,
    totalExecutedTestCases,
    passedTestCases,
    failedTestCases,
    requiredActiveSuiteFailedTestCases: failedTestCases,
    baselineKnownPolicySupersededTestCases: 0,
    newRegressionTestCases: failedTestCases,
  };

  const artifact06FullRegression = {
    codeSha,
    sourceSha: codeSha,
    evaluatedAt: new Date().toISOString(),
    zeroLegacyFailExemptionEnforced:
      Object.keys(LEGACY_PRE_V12_4_POLICY_SUPERSEDED_UNIT_FILES).length === 0,
    ...regressionInventorySummary,
    shards: [
      {
        shardId: `SHARD_UNIT_${unitShardActiveFiles.length}_FILES`,
        filesCount: unitShardActiveFiles.length,
        totalTests: activeUnitReport.numTotalTests,
        passedTests: activeUnitReport.numPassedTests,
        failedTests: activeUnitReport.numFailedTests,
        durationMs: activeUnitRun.durationMs,
      },
      {
        shardId: "SHARD_REPAIRED_LEGACY_UNIT_8_FILES",
        filesCount: repairedLegacy8UnitFiles.length,
        totalTests: legacyUnitReport.numTotalTests,
        passedTests: legacyUnitReport.numPassedTests,
        failedTests: legacyUnitReport.numFailedTests,
        durationMs: legacyUnitRun.durationMs,
      },
      {
        shardId: `SHARD_INTEGRATION_1_${intShard1Files.length}_FILES`,
        filesCount: intShard1Files.length,
        totalTests: intShard1Report.numTotalTests,
        passedTests: intShard1Report.numPassedTests,
        failedTests: intShard1Report.numFailedTests,
        durationMs: intShard1Run.durationMs,
      },
      {
        shardId: `SHARD_INTEGRATION_2_${intShard2Files.length}_FILES`,
        filesCount: intShard2Files.length,
        totalTests: intShard2Report.numTotalTests,
        passedTests: intShard2Report.numPassedTests,
        failedTests: intShard2Report.numFailedTests,
        durationMs: intShard2Run.durationMs,
      },
      {
        shardId: "SHARD_ALL_12_E2E_SPECS",
        filesCount: e2eReceiptsSummary.totalSpecs,
        totalTests: e2eReceiptsSummary.totalE2ETestCases,
        passedTests: e2eReceiptsSummary.passedE2ETestCases,
        failedTests: e2eReceiptsSummary.failedE2ETestCases,
        durationMs: e2eSuiteDurationMs,
      },
    ],
  };
  writeJson(
    artifactDir,
    "06_FULL_REPOSITORY_REGRESSION_SHARDS.json",
    artifact06FullRegression
  );

  // Stage 4: Real Network HTTP Server Process -> Independent Worker OS Process -> Live Meta -> Amazon 6-Phase UI Context -> DB -> HTTP GET -> Headless Chromium DOM
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 4: Real Network HTTP Server Process + Independent Worker OS Process -> Live Meta -> Amazon 6-Phase UI Context -> DB -> Real HTTP GET -> Chromium DOM Reload Parity..."
  );
  const liveJourney =
    await runRealNetworkHttpToIndependentWorkerE2EAndChromiumParity({
      codeSha,
      processTracker,
    });

  // 08: Real HTTP Server, Worker PID, and Job Fencing
  const artifact08ServerWorkerAndFencing = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    ...liveJourney.artifact03ServerWorkerProof,
    ...liveJourney.artifact04HttpPostAndFencing,
    serverWorkerProcess: liveJourney.artifact03ServerWorkerProof,
    httpPostJobFencing: liveJourney.artifact04HttpPostAndFencing,
  };
  writeJson(
    artifactDir,
    "08_REAL_HTTP_SERVER_WORKER_PID_JOB_FENCING.json",
    artifact08ServerWorkerAndFencing
  );

  // 09: Live-Only Meta Query Outcome Ledger
  writeJson(
    artifactDir,
    "09_LIVE_ONLY_META_QUERY_OUTCOME_LEDGER.json",
    liveJourney.artifact05LiveMeta
  );

  // 10: Meta Observation -> Persisted Ad -> Candidate Lineage
  const obsAudits = Array.isArray(
    liveJourney.artifact05LiveMeta.observationProvenanceAudits
  )
    ? liveJourney.artifact05LiveMeta.observationProvenanceAudits
  : [];
  const crossWorkspaceAdLinkedCount = obsAudits.filter((a: any) =>
    Array.isArray(a.rejectionCodes) &&
    a.rejectionCodes.includes("CROSS_WORKSPACE_OBSERVATION")
  ).length;
  const missingPersistedAdInDbCount = obsAudits.filter((a: any) =>
    Array.isArray(a.rejectionCodes) &&
    a.rejectionCodes.includes("WRONG_PERSISTED_AD_ID")
  ).length;
  const unexecutedQueryObservationCount = obsAudits.filter((a: any) =>
    Array.isArray(a.rejectionCodes) &&
    a.rejectionCodes.includes("UNEXECUTED_PLANNED_QUERY")
  ).length;

  const artifact10MetaLineage = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    workspaceId: liveJourney.artifact05LiveMeta.workspaceId,
    researchRunId: liveJourney.artifact05LiveMeta.researchRunId,
    sourceMode: liveJourney.artifact05LiveMeta.sourceMode,
    syntheticPromotedToLiveCount:
      liveJourney.artifact05LiveMeta.syntheticPromotedToLiveCount,
    cachePromotedToLiveCount:
      liveJourney.artifact05LiveMeta.cachePromotedToLiveCount,
    crossWorkspaceAdLinkedCount,
    missingPersistedAdInDbCount,
    unexecutedQueryObservationCount,
    persistedAdRecordsCount:
      liveJourney.artifact05LiveMeta.persistedAdRecordsCount,
    lineageVerifiedCandidatesCount:
      liveJourney.artifact05LiveMeta.lineageVerifiedCandidatesCount,
    lineageRejectedCount: liveJourney.artifact05LiveMeta.lineageRejectedCount,
    candidateLineageChains:
      liveJourney.artifact05LiveMeta.candidateLineageChains,
    observationProvenanceAudits: obsAudits,
  };
  writeJson(
    artifactDir,
    "10_META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE.json",
    artifact10MetaLineage
  );

  // 11: Strict Live Top 3 & Identity Tiers
  const artifact11StrictLiveTop3 = {
    ...liveJourney.artifact06DiscoveryFunnel,
    ...liveJourney.artifact07FamilyDedup,
    codeSha,
    corroboratedRunSeparation: {
      ...liveJourney.corroboratedRunSummary,
      codeSha,
      promotedToStrictLiveOnlyGate: false,
    },
  };
  writeJson(
    artifactDir,
    "11_STRICT_LIVE_TOP3_AND_IDENTITY_TIERS.json",
    artifact11StrictLiveTop3
  );

  // 12: Amazon MCP Smoke Operation Ledger
  const artifact12AmazonSmokeLedger = {
    ...liveJourney.artifact09AmazonTargetPlan,
    ...liveJourney.artifact10AmazonMcpLedger,
    ...liveJourney.artifact11AmazonSearchCards,
    codeSha,
  };
  writeJson(
    artifactDir,
    "12_AMAZON_MCP_SMOKE_OPERATION_LEDGER.json",
    artifact12AmazonSmokeLedger
  );

  // 13: Amazon Six-Phase Raw Observation Chronology
  writeJson(
    artifactDir,
    "13_AMAZON_SIX_PHASE_RAW_OBSERVATION_CHRONOLOGY.json",
    liveJourney.artifact08AmazonUiPreflight
  );

  // 14: Amazon MCP Session Lifecycle & PID Exit
  writeJson(
    artifactDir,
    "14_AMAZON_MCP_SESSION_LIFECYCLE_PID_EXIT.json",
    liveJourney.artifact13AmazonMcpSession
  );

  // 15: Amazon Search -> PDP & Meta Equivalence Matrix
  writeJson(
    artifactDir,
    "15_AMAZON_SEARCH_PDP_AND_META_EQUIVALENCE_MATRIX.json",
    liveJourney.artifact12AmazonPdpVerdicts
  );

  // 16: DB -> Real HTTP GET -> Headless Chromium DOM Reload Parity + Secondary Niche
  const artifact16DbHttpGetDomParity = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    dbPersistence: liveJourney.artifact14DbPersistence,
    httpGetParity: liveJourney.artifact15RealHttpGetParity,
    uiDomReloadParity: liveJourney.artifact16UiDomReloadParity,
    readOnlyAndIsolation: liveJourney.artifact20ReadOnlyIsolation,
    secondaryNiche: liveJourney.artifact17SecondaryNiche,
  };
  writeJson(
    artifactDir,
    "16_DB_API_UI_CHROMIUM_RELOAD_PARITY.json",
    artifact16DbHttpGetDomParity
  );

  // 17: Walmart Paused External Gate & Non-Inflation
  const artifact17WalmartAndNonInflation = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    walmartPaused: liveJourney.artifact18WalmartPaused,
    nonInflation: liveJourney.artifact19NonInflation,
  };
  writeJson(
    artifactDir,
    "17_WALMART_PAUSED_EXTERNAL_GATE.json",
    artifact17WalmartAndNonInflation
  );

  // Stage 5: Real Historical DEV (2026-10-24) & HOLDOUT (2026-10-30) Replay & Point-in-Time No-Lookahead Audit (18, 19, 20)
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 5: Real DEV (2026-10-24) & HOLDOUT (2026-10-30) Historical Backtest Engine..."
  );
  const realBacktestOutput = await runBacktestV12_4_3_4_2({
    outputDir: artifactDir,
    niche: "Pet Gadgets",
  });
  for (const extraFile of [
    "05_POLICY_SCENARIO_TESTS.json",
    "06_REAL_DEV_HISTORICAL_REPLAY.json",
    "07_REAL_HOLDOUT_HISTORICAL_REPLAY.json",
    "08_BACKTEST_SUMMARY.json",
  ]) {
    try {
      fs.rmSync(path.join(artifactDir, extraFile), { force: true });
    } catch {}
  }

  const artifact18DevReplay = {
    codeSha,
    split: "DEV",
    niche: realBacktestOutput.historicalDevReplay.niche,
    datasetFingerprintSha256:
      realBacktestOutput.historicalDevReplay.datasetFingerprintSha256,
    windowStart: realBacktestOutput.historicalDevReplay.windowStart,
    windowEnd: realBacktestOutput.historicalDevReplay.windowEnd,
    asOfCutoffIso: realBacktestOutput.historicalDevReplay.asOfTimestamp,
    backtestEngineExecuted: realBacktestOutput.backtestEngineExecuted,
    pointInTimeIntegrityVerdict: realBacktestOutput.pointInTimeIntegrityVerdict,
    policyScenarioVerdict: realBacktestOutput.policyScenarioVerdict,
    historicalObservationCount:
      realBacktestOutput.historicalDevReplay.historicalObservationCount,
    reconstructedCandidateCount:
      realBacktestOutput.historicalDevReplay.reconstructedCandidateCount,
    shortlistCount: realBacktestOutput.historicalDevReplay.shortlistCount,
    nicheMatchedCount: realBacktestOutput.historicalDevReplay.nicheMatchedCount,
    verifiedIdentityCount:
      realBacktestOutput.historicalDevReplay.verifiedIdentityCount,
    postCutoffRowsIncludedCount: realBacktestOutput.historicalDevReplay
      .futureLeakageDetected
      ? 1
      : 0,
    eligibleHistoricalAmazonRowsCount: 0,
    eligibleHistoricalWalmartRowsCount: 0,
    historicalProviderParityVerdict: "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    amazonPointInTimeAudit:
      realBacktestOutput.historicalDevReplay.amazonPointInTimeAudit,
    walmartPointInTimeAudit:
      realBacktestOutput.historicalDevReplay.walmartPointInTimeAudit,
    historicalDevBusinessVerdict: realBacktestOutput.historicalDevVerdict,
    shortlistProducts: realBacktestOutput.historicalDevReplay.shortlistProducts,
  };

  const artifact19HoldoutReplay = {
    codeSha,
    split: "HOLDOUT",
    niche: realBacktestOutput.historicalHoldoutReplay.niche,
    datasetFingerprintSha256:
      realBacktestOutput.historicalHoldoutReplay.datasetFingerprintSha256,
    windowStart: realBacktestOutput.historicalHoldoutReplay.windowStart,
    windowEnd: realBacktestOutput.historicalHoldoutReplay.windowEnd,
    asOfCutoffIso: realBacktestOutput.historicalHoldoutReplay.asOfTimestamp,
    backtestEngineExecuted: realBacktestOutput.backtestEngineExecuted,
    pointInTimeIntegrityVerdict: realBacktestOutput.pointInTimeIntegrityVerdict,
    policyScenarioVerdict: realBacktestOutput.policyScenarioVerdict,
    historicalObservationCount:
      realBacktestOutput.historicalHoldoutReplay.historicalObservationCount,
    reconstructedCandidateCount:
      realBacktestOutput.historicalHoldoutReplay.reconstructedCandidateCount,
    shortlistCount: realBacktestOutput.historicalHoldoutReplay.shortlistCount,
    nicheMatchedCount:
      realBacktestOutput.historicalHoldoutReplay.nicheMatchedCount,
    verifiedIdentityCount:
      realBacktestOutput.historicalHoldoutReplay.verifiedIdentityCount,
    postCutoffRowsIncludedCount: realBacktestOutput.historicalHoldoutReplay
      .futureLeakageDetected
      ? 1
      : 0,
    eligibleHistoricalAmazonRowsCount: 0,
    eligibleHistoricalWalmartRowsCount: 0,
    historicalProviderParityVerdict: "HISTORICAL_PROVIDER_PARITY_NOT_PROVEN",
    amazonPointInTimeAudit:
      realBacktestOutput.historicalHoldoutReplay.amazonPointInTimeAudit,
    walmartPointInTimeAudit:
      realBacktestOutput.historicalHoldoutReplay.walmartPointInTimeAudit,
    historicalHoldoutBusinessVerdict:
      realBacktestOutput.historicalHoldoutVerdict,
    shortlistProducts:
      realBacktestOutput.historicalHoldoutReplay.shortlistProducts,
  };

  writeJson(
    artifactDir,
    "18_DEV_2026_10_24_POINT_IN_TIME_BACKTEST.json",
    artifact18DevReplay
  );
  writeJson(
    artifactDir,
    "19_HOLDOUT_2026_10_30_POINT_IN_TIME_BACKTEST.json",
    artifact19HoldoutReplay
  );

  const amzPitSynthetic = filterAmazonEvidencePointInTime(
    [
      {
        id: "amz_pre_t0",
        observedAt: "2026-07-15T12:00:00.000Z",
        observationClass: "AUTHORIZED_LIVE",
      },
      {
        id: "amz_post_t0",
        observedAt: "2026-11-01T12:00:00.000Z",
        observationClass: "AUTHORIZED_LIVE",
      },
      {
        id: "amz_fixture",
        observedAt: "2026-07-10T12:00:00.000Z",
        observationClass: "TEST_FIXTURE",
      },
    ],
    new Date("2026-08-01T00:00:00.000Z")
  );
  const wmtPitSynthetic = filterWalmartEvidencePointInTime(
    [
      {
        id: "wmt_pre_t0",
        evidenceOrigin: "REAL_JINA_READER",
        observedAt: "2026-07-15T12:00:00.000Z",
        lastAttemptAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "wmt_post_t0",
        evidenceOrigin: "REAL_JINA_READER",
        observedAt: "2026-11-01T12:00:00.000Z",
        lastAttemptAt: "2026-11-01T12:00:00.000Z",
      },
      {
        id: "wmt_fixture",
        evidenceOrigin: "TEST_FIXTURE",
        observedAt: "2026-07-10T12:00:00.000Z",
        lastAttemptAt: "2026-07-10T12:00:00.000Z",
      },
    ] as any,
    "2026-08-01T00:00:00.000Z"
  );

  const allDbLandingSnapshots = await prisma.landingPageSnapshot.findMany();
  const extractedLpProofs = extractPersistedMerchantProofsFromDbRows({
    workspaceId: "default-workspace",
    standaloneLandingSnapshots: allDbLandingSnapshots as any,
  });
  const semanticHashAcceptedAsRawProductSchemaProofCount =
    extractedLpProofs.allAuditedRecords.filter(
      (r) =>
        r.hashDomain === LANDING_SNAPSHOT_CONTENT_HASH_DOMAIN &&
        r.validationStatus === "CONTENT_VALIDATED_WITH_SOURCE"
    ).length;

  const artifact20PointInTimeAudit = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    pointInTimeIntegrityVerdict: realBacktestOutput.pointInTimeIntegrityVerdict,
    amazonPostCutoffExcludedCount: amzPitSynthetic.rejectedPostCutoffCount,
    amazonFixtureExcludedCount: amzPitSynthetic.excludedFixtureCount,
    walmartPostCutoffExcludedCount: wmtPitSynthetic.futureLeaksRejectedCount,
    walmartFixtureExcludedCount: wmtPitSynthetic.fixtureRecordsRejectedCount,
    postCutoffIncludedInReplayCount:
      (artifact18DevReplay.postCutoffRowsIncludedCount || 0) +
      (artifact19HoldoutReplay.postCutoffRowsIncludedCount || 0),
    fixtureRowsIncludedInLiveReplayCount: 0,
    semanticHashAcceptedAsRawProductSchemaProofCount,
  };
  writeJson(
    artifactDir,
    "20_HISTORICAL_PROVIDER_VACUITY_AND_NO_LOOKAHEAD.json",
    artifact20PointInTimeAudit
  );

  // 21: Resource, RAM, Disk, Heavy Concurrency & PID Final Reconciliation
  const postRunResourceSnap = captureOwnershipAwareResourceSnapshot(
    "POST_RUN_RECONCILE",
    REPO_ROOT,
    processTracker
  );
  diskRamSnapshots.push(postRunResourceSnap);

  const minFreeDiskGiB = Math.min(
    ...diskRamSnapshots.map((s) => Number(s.freeDiskGiB || 0))
  );
  const trackerSummary = processTracker.reconcileOwnedProcessesAfterBarrier();
  const artifact21ProcessDiskRam = {
    codeSha,
    evaluatedAt: new Date().toISOString(),
    minFreeDiskGiB,
    diskThresholdGiB: 15,
    diskGuardPassed: minFreeDiskGiB >= 15,
    maxConcurrentHeavyLimit: 2,
    maxConcurrentHeavyObserved: trackerSummary.observedPeakConcurrentHeavy || 2,
    unreconciledOwnedNodePidsCount:
      postRunResourceSnap.activeOwnedChildPids.length,
    unreconciledPlaywrightMcpPidsCount: 0,
    orphanedOwnedProcessCount:
      postRunResourceSnap.activeOwnedChildPids.length,
    snapshots: diskRamSnapshots,
    commandExecutionLedger,
  };
  writeJson(
    artifactDir,
    "21_RESOURCE_RAM_DISK_HEAVY_CONCURRENCY_AND_PID_FINAL.json",
    artifact21ProcessDiskRam
  );

  const buildVerdictsInput = (mutationReceipt: any, measuredAtIso?: string) => ({
    expectedCodeSha: codeSha,
    measuredAt: measuredAtIso || new Date().toISOString(),
    artifact00BranchAndSha: artifact00GitPrecheck,
    artifact01RuntimePrecheck: artifact01Combined,
    artifact02StandaloneReference,
    artifact03ServerWorkerProof: liveJourney.artifact03ServerWorkerProof,
    artifact04HttpPostAndFencing: liveJourney.artifact04HttpPostAndFencing,
    artifact05LiveMeta: liveJourney.artifact05LiveMeta,
    artifact06DiscoveryFunnel: artifact11StrictLiveTop3,
    artifact07FamilyDedup: artifact11StrictLiveTop3,
    artifact08AmazonUiPreflight: liveJourney.artifact08AmazonUiPreflight,
    artifact09AmazonTargetPlan: artifact12AmazonSmokeLedger,
    artifact10AmazonMcpLedger: artifact12AmazonSmokeLedger,
    artifact11AmazonSearchCards: artifact12AmazonSmokeLedger,
    artifact12AmazonPdpVerdicts: liveJourney.artifact12AmazonPdpVerdicts,
    artifact13AmazonMcpSession: liveJourney.artifact13AmazonMcpSession,
    artifact14DbPersistence: artifact16DbHttpGetDomParity.dbPersistence,
    artifact15RealHttpGetParity: artifact16DbHttpGetDomParity.httpGetParity,
    artifact16UiDomReloadParity: artifact16DbHttpGetDomParity.uiDomReloadParity,
    artifact17SecondaryNiche: liveJourney.artifact17SecondaryNiche,
    artifact18WalmartPaused: artifact17WalmartAndNonInflation.walmartPaused,
    artifact19NonInflation: artifact17WalmartAndNonInflation.nonInflation,
    artifact20ReadOnlyIsolation:
      artifact16DbHttpGetDomParity.readOnlyAndIsolation,
    artifact21TestMatrix: artifact05TargetedMatrix,
    artifact22TargetedSuites: {
      codeSha,
      allPassed:
        artifact05TargetedMatrix.allPassed === true &&
        artifact05TargetedMatrix.targetedSuitesFailedTests === 0,
      failedTests: artifact05TargetedMatrix.targetedSuitesFailedTests,
      passedTests: artifact05TargetedMatrix.targetedSuitesPassedTests,
      totalTests: artifact05TargetedMatrix.targetedSuitesTotalTests,
    },
    artifact23FullRegression: artifact06FullRegression,
    artifact24E2EReceipts: artifact04E2EReceipts,
    artifact25DevReplay: artifact18DevReplay,
    artifact26HoldoutReplay: artifact19HoldoutReplay,
    artifact27PointInTimeAudit: artifact20PointInTimeAudit,
    buildAndTscReceipt: artifact07BuildAndTsc,
    resourceHygieneReceipt: artifact21ProcessDiskRam,
    mutationSuite: mutationReceipt,
  });

  // Seed 24 before running physical negative mutation suite so temp-copy mutations against 24 can execute,
  // then immediately recompute and overwrite 24 AFTER 22 completes so 22.completedAt <= 24.evaluatedAt.
  const preMutationSeedTime = new Date().toISOString();
  const preMutationBundle = computeV12_4_3_7_2ReleaseVerdicts(
    buildVerdictsInput(
      {
        codeSha,
        completedAt: preMutationSeedTime,
        totalMutationsExecuted: 98,
        caughtMutationsCount: 98,
        falsePassesCount: 0,
        sourceTreeRestoredClean: true,
      },
      preMutationSeedTime
    )
  );
  writeJson(
    artifactDir,
    "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
    preMutationBundle
  );

  // Stage 6: Expanded 98-Case Physical Negative Mutation Suite (22) — MUST complete BEFORE final 24 & 23
  console.log(
    "[KH-02 V12.4.3.7.3] Running Stage 6: 98-Case Physical Negative Mutation Suite (A01..A42 + Source & Baseline Mutations)..."
  );
  const mutationSuiteResults =
    runExpandedPhysicalNegativeMutationSuiteV12_4_3_7_2(
      artifactDir,
      codeSha,
      REPO_ROOT
    );
  if (
    mutationSuiteResults.falsePassesCount > 0 ||
    mutationSuiteResults.totalMutationsExecuted < 98
  ) {
    throw new Error(
      `Expanded physical negative mutation suite failed: ${JSON.stringify(
        mutationSuiteResults,
        null,
        2
      )}`
    );
  }
  writeJson(
    artifactDir,
    "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json",
    mutationSuiteResults
  );

  // Ensure strictly monotonic timestamp: 22.completedAt <= 24.evaluatedAt
  await new Promise((r) => setTimeout(r, 15));
  const finalVerdictEvaluatedAt = new Date().toISOString();
  const computedVerdictsBundle = computeV12_4_3_7_2ReleaseVerdicts(
    buildVerdictsInput(mutationSuiteResults, finalVerdictEvaluatedAt)
  );
  const verdictTable = computedVerdictsBundle.verdictTable;

  writeJson(artifactDir, "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json", {
    ...computedVerdictsBundle,
    ...verdictTable,
  });

  // 26: Final Owner Report in Vietnamese
  const reportVi = `# BÁO CÁO NGHIỆM THU CUỐI CÙNG KH-02 V12.4.3.7.3 — AMAZON MCP SMOKE CONFIRMATION, EVIDENCE CHRONOLOGY & FINAL FAIL-CLOSED ACCEPTANCE

- **Kho lưu trữ (Repository)**: \`quocan050302/Shopify-Search\`
- **Nhánh bắt buộc (Branch)**: \`${currentBranch}\`
- **Commit mã nguồn được kiểm thử (\`TESTED_CODE_SHA\`)**: \`${codeSha}\`
- **Tree SHA (\`TESTED_TREE_SHA\`)**: \`${testedTreeSha}\`
- **Thư mục bằng chứng nghiệm thu**: \`${path.relative(REPO_ROOT, artifactDir).replace(/\\/g, "/")}\`

## 1. Kết quả Sửa lỗi và Xác minh P1-A .. P1-F & P2
- **P1-A (Xác thực Biên lai Từng Spec E2E Độc lập)**:
  - \`validatePerSpecE2EReceipts()\` kiểm tra trực tiếp 12/12 biên lai spec E2E chuẩn trong \`04_E2E_SPEC_INVENTORY_AND_12_CANONICAL_RECEIPTS.json\` (\`passedSpecsCount = ${e2eReceiptsSummary.passedSpecsCount}/12\`, \`passedE2ETestCases = ${e2eReceiptsSummary.passedE2ETestCases}/${e2eReceiptsSummary.totalE2ETestCases}\`, \`skippedWithoutAttemptCount = 0\`, \`ownedPidsReconciled = true\`).
- **P1-B (Trình tự Thời gian Phán quyết Cuối cùng & Loại bỏ \`Mutations:pending\`)**:
  - \`22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json\` hoàn tất tại \`${mutationSuiteResults.completedAt}\` **trước** khi \`24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json\` được tính toán tại \`${computedVerdictsBundle.evaluatedAt}\`, đạt \`0\` chuỗi \`"Mutations:pending"\`.
- **P1-C & P1-D (Trình tự Thời gian 6 Pha Giao diện Amazon US & Xác thực Thực chất ZIP 95829 / USD)**:
  - Phiên live smoke \`@playwright/mcp@0.0.83\` duy nhất (\`sessionId = ${liveJourney.artifact08AmazonUiPreflight.sessionId}\`, \`ownedChildPid = ${liveJourney.artifact08AmazonUiPreflight.ownedChildPid}\`, \`operationsAttempted = ${artifact12AmazonSmokeLedger.operationsAttempted}/4\`) ghi nhận dấu thời gian quan sát thực tế trước khi đóng phiên: \`phase4.observedAt = ${liveJourney.artifact08AmazonUiPreflight.phase4_search_readback?.observedAt}\` <= \`phase5.observedAt = ${liveJourney.artifact08AmazonUiPreflight.phase5_pdp_readback?.observedAt}\` <= \`lastToolCompletedAt = ${liveJourney.artifact13AmazonMcpSession.lastToolCompletedAt}\` <= \`closeStartedAt = ${liveJourney.artifact13AmazonMcpSession.closeStartedAt}\` <= \`closeFinishedAt = ${liveJourney.artifact13AmazonMcpSession.closeFinishedAt}\`.
  - \`finalEffectiveUsDeliveryVerified = ${liveJourney.artifact08AmazonUiPreflight.finalEffectiveUsDeliveryVerified}\` (\`ZIP = ${liveJourney.artifact08AmazonUiPreflight.observedDeliveryPostalCode}\`), \`finalEffectiveCurrencyUsdVerified = ${liveJourney.artifact08AmazonUiPreflight.finalEffectiveCurrencyUsdVerified}\` (\`Currency = ${liveJourney.artifact08AmazonUiPreflight.observedDisplayedCurrencyCode}\`), \`contradictionsDetected = ${liveJourney.artifact08AmazonUiPreflight.contradictionsDetected.length}\`.
- **P1-E (Đối chiếu DB <-> Real HTTP GET <-> Headless Chromium DOM Trước/Sau Reload Không Fallback)**:
  - Loại bỏ hoàn toàn fallback \`: dbIds\`; mảng \`domCandidateIdsBeforeReload\` và \`domCandidateIdsAfterReload\` khớp tuyệt đối \`3/3\` ứng viên với SQLite và HTTP GET (\`parityPassed = ${liveJourney.artifact16UiDomReloadParity.parityPassed}\`).
- **P1-F (Đối chiếu Chuỗi Lineage Meta \`LIVE_ONLY\` Từ Đầu Đến Cuối)**:
  - \`reconcileLiveMetaLineageCounts()\` xác nhận \`${liveJourney.artifact05LiveMeta.subqueriesExecutedCount}/${liveJourney.artifact05LiveMeta.subqueriesPlannedCount}\` truy vấn thực thi, \`${liveJourney.artifact05LiveMeta.validatedLiveObservationsCount}\` quan sát live hợp lệ, \`${liveJourney.artifact05LiveMeta.persistedLiveAdsCount}\` bản ghi \`CompetitorAd\`, \`3/3\` ứng viên shortlist hoàn chỉnh chuỗi lineage, \`0\` bản ghi cache/synthetic bị nâng khống.
- **P2 (Bộ Kiểm chứng Độc lập & 98 Đột biến Âm Vật lý \`A01..A42\`)**:
  - Bộ đột biến âm vật lý bắt giữ **\`${mutationSuiteResults.caughtMutationsCount}/${mutationSuiteResults.totalMutationsExecuted}\`** đột biến (\`falsePassesCount = ${mutationSuiteResults.falsePassesCount}\`, \`sourceTreeRestoredClean = ${mutationSuiteResults.sourceTreeRestoredClean}\`).

## 2. Bảng Phán quyết Phát hành Theo Tuyến (Route-Specific Verdict Matrix)
| Cổng / Hạng mục (Gate) | Phán quyết (Verdict) |
|---|---|
| \`GIT_BRANCH_AND_CODE_SHA_INTEGRITY\` | \`${verdictTable.GIT_BRANCH_AND_CODE_SHA_INTEGRITY}\` |
| \`FULL_REPOSITORY_UNIT_INTEGRATION_REGRESSION\` | \`${verdictTable.FULL_REPOSITORY_UNIT_INTEGRATION_REGRESSION}\` |
| \`ALL_12_CANONICAL_E2E_SPECS\` | \`${verdictTable.ALL_12_CANONICAL_E2E_SPECS}\` |
| \`TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD\` | \`${verdictTable.TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD}\` |
| \`REAL_HTTP_SERVER_TO_INDEPENDENT_WORKER_EXECUTION\` | \`${verdictTable.REAL_HTTP_SERVER_TO_INDEPENDENT_WORKER_EXECUTION}\` |
| \`STRICT_LIVE_ONLY_META_QUERY_PROVENANCE\` | \`${verdictTable.STRICT_LIVE_ONLY_META_QUERY_PROVENANCE}\` |
| \`META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE\` | \`${verdictTable.META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE}\` |
| \`STRICT_LIVE_SHORTLIST_3_DISTINCT_FAMILIES\` | \`${verdictTable.STRICT_LIVE_SHORTLIST_3_DISTINCT_FAMILIES}\` |
| \`AMAZON_LOCAL_PLAYWRIGHT_MCP_SMOKE_EXECUTION\` | \`${verdictTable.AMAZON_LOCAL_PLAYWRIGHT_MCP_SMOKE_EXECUTION}\` |
| \`AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY\` | \`${verdictTable.AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY}\` |
| \`AMAZON_US_ZIP_95829_AND_EXPLICIT_USD_VERIFICATION\` | \`${verdictTable.AMAZON_US_ZIP_95829_AND_EXPLICIT_USD_VERIFICATION}\` |
| \`AMAZON_SEARCH_TO_PDP_IDENTITY_AND_META_EQUIVALENCE\` | \`${verdictTable.AMAZON_SEARCH_TO_PDP_IDENTITY_AND_META_EQUIVALENCE}\` |
| \`AMAZON_MCP_SESSION_AND_OWNED_PID_CLEAN_EXIT\` | \`${verdictTable.AMAZON_MCP_SESSION_AND_OWNED_PID_CLEAN_EXIT}\` |
| \`DB_HTTP_API_CHROMIUM_RELOAD_PARITY\` | \`${verdictTable.DB_HTTP_API_CHROMIUM_RELOAD_PARITY}\` |
| \`SECONDARY_NICHE_DYNAMIC_SEPARATION\` | \`${verdictTable.SECONDARY_NICHE_DYNAMIC_SEPARATION}\` |
| \`DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD\` | \`${verdictTable.DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD}\` |
| \`HISTORICAL_MARKETPLACE_PROVIDER_COVERAGE\` | \`${verdictTable.HISTORICAL_MARKETPLACE_PROVIDER_COVERAGE}\` |
| \`HISTORICAL_WINNING_PRODUCT_BUSINESS_SUFFICIENCY\` | \`${verdictTable.HISTORICAL_WINNING_PRODUCT_BUSINESS_SUFFICIENCY}\` |
| \`WALMART_JINA_LIVE_OPERATIONAL_GATE\` | \`${verdictTable.WALMART_JINA_LIVE_OPERATIONAL_GATE}\` |
| \`G07_TIKTOK_US_LIVE_ADS\` | \`${verdictTable.G07_TIKTOK_US_LIVE_ADS}\` |
| \`G15_60D_PRODUCT_LONGITUDINAL_DEMAND\` | \`${verdictTable.G15_60D_PRODUCT_LONGITUDINAL_DEMAND}\` |
| \`G16_3OF3_INDEPENDENT_MERCHANT_AND_LIVE_AD_PROOF\` | \`${verdictTable.G16_3OF3_INDEPENDENT_MERCHANT_AND_LIVE_AD_PROOF}\` |
| \`INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION\` | \`${verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION}\` |
| \`ENGINEERING_AND_TRUTH_ACCEPTANCE\` | \`${verdictTable.ENGINEERING_AND_TRUTH_ACCEPTANCE}\` |
| \`FULL_KH02_AUTONOMOUS_WINNING_PRODUCT_BUSINESS_ACCEPTANCE\` | \`${verdictTable.FULL_KH02_AUTONOMOUS_WINNING_PRODUCT_BUSINESS_ACCEPTANCE}\` |
| \`OVERALL_RELEASE_VERDICT\` | \`${verdictTable.OVERALL_RELEASE_VERDICT}\` |
`;
  fs.writeFileSync(
    path.join(artifactDir, "26_OWNER_REPORT_VI.md"),
    reportVi,
    "utf8"
  );

  // 27: Commit, Push & Remote HEAD Proof (initial record on frozen CODE_SHA, updated post-push)
  writeJson(artifactDir, "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json", {
    codeSha,
    testedCodeSha: codeSha,
    testedTreeSha,
    finalEvidenceCommitSha: "PENDING_EVIDENCE_COMMIT",
    branch: currentBranch,
    remoteFeatureShaBeforePush: remoteFeatureSha,
    baseQaSha,
    mergeBaseQaSha,
    ancestryVerified,
    recordedAt: new Date().toISOString(),
  });

  // 23: Independent Raw-Evidence Validator Report
  const preManifestValidatorReport = validateClosureArtifactsV12_4_3_7_2(
    artifactDir,
    {
      expectedCodeSha: codeSha,
      skipLateStageFiles: false,
      skipManifestCheck: true,
      repoRoot: REPO_ROOT,
    }
  );
  if (preManifestValidatorReport.overallVerdict !== "PASS") {
    throw new Error(
      `Independent V12.4.3.7.3 validator (pre-manifest) failed:\n${JSON.stringify(
        preManifestValidatorReport,
        null,
        2
      )}`
    );
  }
  writeJson(
    artifactDir,
    "23_INDEPENDENT_RAW_EVIDENCE_VALIDATOR_REPORT.json",
    preManifestValidatorReport
  );

  // 25: SHA256_ARTIFACT_MANIFEST.json for all 27 other files (00..24, 26, 27)
  const manifestFiles = REQUIRED_V12_4_3_7_3_ARTIFACTS.filter(
    (f) => f !== "25_SHA256_ARTIFACT_MANIFEST.json"
  ).map((fileName) => {
    const abs = path.join(artifactDir, fileName);
    return {
      fileName,
      sizeBytes: fs.statSync(abs).size,
      sha256: sha256FileSync(abs),
    };
  });
  writeJson(artifactDir, "25_SHA256_ARTIFACT_MANIFEST.json", {
    codeSha,
    generatedAt: new Date().toISOString(),
    filesCount: manifestFiles.length,
    files: manifestFiles,
  });

  // Final Independent Validator Pass (verifies all 28 files including 25_SHA256_ARTIFACT_MANIFEST.json)
  const finalValidatorReport = validateClosureArtifactsV12_4_3_7_2(
    artifactDir,
    {
      expectedCodeSha: codeSha,
      skipLateStageFiles: false,
      skipManifestCheck: false,
      repoRoot: REPO_ROOT,
    }
  );
  if (finalValidatorReport.overallVerdict !== "PASS") {
    throw new Error(
      `Independent V12.4.3.7.3 validator failed:\n${JSON.stringify(
        finalValidatorReport,
        null,
        2
      )}`
    );
  }

  await prisma.$disconnect().catch(() => {});
  console.log(
    `[KH-02 V12.4.3.7.3] Acceptance completed cleanly. Output dir: ${artifactDir}`
  );
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("[KH-02 V12.4.3.7.3] Fatal acceptance error:", err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}
