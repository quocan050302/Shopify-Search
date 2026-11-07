/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * Deterministic GitHub Actions Workflow Contract Validator (Gate E12)
 *
 * Verifies `.github/workflows/kh02-ci.yml` against all security, least-privilege,
 * SHA-pinned action, cost-safety, and 6-required-jobs invariants.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import {
  CANONICAL_WORKFLOW_PATHS,
  CANONICAL_REQUIRED_JOBS,
  LOCKED_BRANCH,
} from "../../src/services/kh02/release/githubActionsCiEvidence";

export interface ParsedWorkflowJob {
  jobId: string;
  name: string | null;
  ifCondition: string | null;
  runsOn: string | null;
  timeoutMinutes: number | null;
  continueOnError: boolean;
  needs: string[];
  usesList: string[];
  runCommands: string[];
}

export interface WorkflowContractVerificationResult {
  gateId: "E12";
  workflowFileExists: boolean;
  workflowPath: string;
  workflowFileSha256: string | null;
  testedCodeSha: string;
  testedTreeSha: string;
  permissionsValid: boolean;
  actionsShaPinned: boolean;
  continueOnErrorAbsent: boolean;
  publicVisibilityGuardPresent: boolean;
  triggersValid: boolean;
  concurrencyBounded: boolean;
  requiredJobsConfigured: string[];
  missingRequiredJobs: string[];
  jobDetails: Record<
    string,
    {
      present: boolean;
      nameMatchesId: boolean;
      publicGuard: boolean;
      runsOnValid: boolean;
      timeoutValid: boolean;
      expectedCommandPresent: boolean;
      needs: string[];
    }
  >;
  errors: string[];
  verdict: "PASS" | "FAIL";
  evaluatedAt: string;
}

const EXPECTED_JOB_COMMANDS: Record<string, string[]> = {
  typecheck: ["npx tsc --noEmit"],
  "kh02-unit": ["npm run kh02:test:unit"],
  "kh02-integration": ["npx vitest run tests/integration/kh02 --no-file-parallelism"],
  "kh01-regression": ["npm run kh01:verify"],
  "security-negative": [
    "tests/unit/kh02ProductMetadataSecurity.test.ts",
    "tests/unit/kh02/v12_4_3_7_17_NetworkSsrfRedirect.test.ts",
    "tests/unit/kh02/v12_4_3_7_18_SocketPeerTlsTrust.test.ts",
    "tests/unit/kh02/v12_4_3_7_18_1_SocketTrustNoTestBypass.test.ts",
    "tests/unit/kh02/v12_4_3_7_19_3_2_8_GithubApiRunWorkflowJobsBinding.test.ts",
    "tests/unit/kh02/v12_4_3_7_19_3_2_9_RealGithubCiAndRequiredJobsProof.test.ts",
  ],
  "backtest-policy": [
    "npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts",
    "npx tsx scripts/kh02/runCandidateDbReadback.ts",
  ],
};

function stripQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseWorkflowYamlJobs(yamlText: string): {
  topLevelPermissions: Record<string, string>;
  hasPushTrigger: boolean;
  pushBranches: string[];
  pushPathsIgnore: string[];
  hasWorkflowDispatch: boolean;
  hasPullRequestTarget: boolean;
  globalContinueOnError: boolean;
  jobs: Record<string, ParsedWorkflowJob>;
  allUses: string[];
} {
  const lines = yamlText.replace(/\r\n/g, "\n").split("\n");
  const topLevelPermissions: Record<string, string> = {};
  let hasPushTrigger = false;
  const pushBranches: string[] = [];
  const pushPathsIgnore: string[] = [];
  let hasWorkflowDispatch = false;
  let hasPullRequestTarget = false;
  let globalContinueOnError = false;
  const jobs: Record<string, ParsedWorkflowJob> = {};
  const allUses: string[] = [];

  let currentTopSection: string | null = null;
  let inOnPush = false;
  let inOnPushSub: "branches" | "paths-ignore" | null = null;
  let currentJobId: string | null = null;
  let inJobNeeds = false;
  let inJobSteps = false;
  let inRunBlock = false;
  let runBlockIndent = 0;
  let currentRunLines: string[] = [];

  const flushRunBlock = () => {
    if (inRunBlock && currentJobId && jobs[currentJobId]) {
      jobs[currentJobId].runCommands.push(currentRunLines.join("\n").trim());
    }
    inRunBlock = false;
    currentRunLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      if (inRunBlock) {
        currentRunLines.push("");
      }
      continue;
    }

    const indent = rawLine.search(/\S/);

    if (inRunBlock) {
      if (indent >= runBlockIndent) {
        currentRunLines.push(trimmed);
        continue;
      } else {
        flushRunBlock();
      }
    }

    // Check continue-on-error anywhere in file
    if (/^continue-on-error\s*:\s*true\b/i.test(trimmed) || /^-\s*continue-on-error\s*:\s*true\b/i.test(trimmed)) {
      globalContinueOnError = true;
      if (currentJobId && jobs[currentJobId]) {
        jobs[currentJobId].continueOnError = true;
      }
    }

    // Check uses anywhere in file
    const usesMatch = trimmed.match(/^(?:-\s*)?uses\s*:\s*(.+)$/);
    if (usesMatch) {
      const usesValue = stripQuotes(usesMatch[1].replace(/\s+#.*$/, ""));
      allUses.push(usesValue);
      if (currentJobId && jobs[currentJobId]) {
        jobs[currentJobId].usesList.push(usesValue);
      }
    }

    // Top-level keys (indent === 0)
    if (indent === 0) {
      const topMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:(.*)$/);
      if (topMatch) {
        currentTopSection = topMatch[1];
        inOnPush = false;
        inOnPushSub = null;
        currentJobId = null;
        inJobNeeds = false;
        inJobSteps = false;
        continue;
      }
    }

    if (currentTopSection === "permissions" && indent === 2) {
      const permMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
      if (permMatch) {
        topLevelPermissions[permMatch[1]] = stripQuotes(permMatch[2]);
      }
    }

    if (currentTopSection === "on") {
      if (indent === 2) {
        inOnPushSub = null;
        if (trimmed.startsWith("push:")) {
          hasPushTrigger = true;
          inOnPush = true;
        } else if (trimmed.startsWith("workflow_dispatch:")) {
          hasWorkflowDispatch = true;
          inOnPush = false;
        } else if (trimmed.startsWith("pull_request_target:")) {
          hasPullRequestTarget = true;
          inOnPush = false;
        } else {
          inOnPush = false;
        }
      } else if (inOnPush && indent === 4) {
        if (trimmed.startsWith("branches:")) {
          inOnPushSub = "branches";
        } else if (trimmed.startsWith("paths-ignore:")) {
          inOnPushSub = "paths-ignore";
        } else {
          inOnPushSub = null;
        }
      } else if (inOnPush && inOnPushSub && indent >= 6) {
        const itemMatch = trimmed.match(/^-\s*(.+)$/);
        if (itemMatch) {
          const val = stripQuotes(itemMatch[1]);
          if (inOnPushSub === "branches") pushBranches.push(val);
          if (inOnPushSub === "paths-ignore") pushPathsIgnore.push(val);
        }
      }
    }

    if (currentTopSection === "jobs") {
      if (indent === 2) {
        const jobMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*$/);
        if (jobMatch) {
          currentJobId = jobMatch[1];
          jobs[currentJobId] = {
            jobId: currentJobId,
            name: null,
            ifCondition: null,
            runsOn: null,
            timeoutMinutes: null,
            continueOnError: false,
            needs: [],
            usesList: [],
            runCommands: [],
          };
          inJobNeeds = false;
          inJobSteps = false;
          continue;
        }
      }

      if (currentJobId && jobs[currentJobId]) {
        const job = jobs[currentJobId];
        if (indent === 4) {
          inJobNeeds = false;
          if (trimmed.startsWith("steps:")) {
            inJobSteps = true;
            continue;
          }
          inJobSteps = false;

          const kvMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
          if (kvMatch) {
            const key = kvMatch[1];
            const val = stripQuotes(kvMatch[2]);
            if (key === "name") {
              job.name = val;
            } else if (key === "if") {
              job.ifCondition = val;
            } else if (key === "runs-on") {
              job.runsOn = val;
            } else if (key === "timeout-minutes") {
              job.timeoutMinutes = parseInt(val, 10);
            } else if (key === "needs") {
              if (!val) {
                inJobNeeds = true;
              } else if (val.startsWith("[") && val.endsWith("]")) {
                const items = val
                  .slice(1, -1)
                  .split(",")
                  .map((s) => stripQuotes(s))
                  .filter(Boolean);
                job.needs.push(...items);
              } else {
                job.needs.push(val);
              }
            }
          }
        } else if (inJobNeeds && indent >= 6) {
          const needMatch = trimmed.match(/^-\s*(.+)$/);
          if (needMatch) {
            job.needs.push(stripQuotes(needMatch[1]));
          }
        } else if (inJobSteps && indent >= 6) {
          const runMatch = trimmed.match(/^(?:-\s*)?run\s*:\s*(.*)$/);
          if (runMatch) {
            const rhs = runMatch[1].trim();
            if (rhs === "|" || rhs === ">") {
              inRunBlock = true;
              runBlockIndent = indent + 2;
              currentRunLines = [];
            } else if (rhs) {
              job.runCommands.push(stripQuotes(rhs));
            }
          }
        }
      }
    }
  }

  flushRunBlock();

  return {
    topLevelPermissions,
    hasPushTrigger,
    pushBranches,
    pushPathsIgnore,
    hasWorkflowDispatch,
    hasPullRequestTarget,
    globalContinueOnError,
    jobs,
    allUses,
  };
}

export function verifyWorkflowContract(
  options: {
    workflowFilePath?: string;
    yamlContent?: string;
    expectedSha?: string;
  } = {}
): WorkflowContractVerificationResult {
  const evaluatedAt = new Date().toISOString();
  const canonicalRelPath = CANONICAL_WORKFLOW_PATHS[0];
  const fsPath = options.workflowFilePath || path.resolve(process.cwd(), canonicalRelPath);

  let testedCodeSha = options.expectedSha || "";
  let testedTreeSha = "0000000000000000000000000000000000000000";
  if (!testedCodeSha) {
    try {
      testedCodeSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    } catch (_) {
      testedCodeSha = "0000000000000000000000000000000000000000";
    }
  }
  try {
    testedTreeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();
  } catch (_) {}

  const errors: string[] = [];
  let yamlText = options.yamlContent;
  let workflowFileExists = false;
  let workflowFileSha256: string | null = null;

  if (typeof yamlText === "string") {
    workflowFileExists = true;
    workflowFileSha256 = crypto.createHash("sha256").update(yamlText, "utf-8").digest("hex");
  } else if (fs.existsSync(fsPath)) {
    workflowFileExists = true;
    yamlText = fs.readFileSync(fsPath, "utf-8");
    workflowFileSha256 = crypto.createHash("sha256").update(yamlText, "utf-8").digest("hex");
  } else {
    errors.push(`Canonical workflow file '${canonicalRelPath}' does not exist on disk.`);
    return {
      gateId: "E12",
      workflowFileExists: false,
      workflowPath: canonicalRelPath,
      workflowFileSha256: null,
      testedCodeSha,
      testedTreeSha,
      permissionsValid: false,
      actionsShaPinned: false,
      continueOnErrorAbsent: false,
      publicVisibilityGuardPresent: false,
      triggersValid: false,
      concurrencyBounded: false,
      requiredJobsConfigured: [],
      missingRequiredJobs: [...CANONICAL_REQUIRED_JOBS],
      jobDetails: {},
      errors,
      verdict: "FAIL",
      evaluatedAt,
    };
  }

  const parsed = parseWorkflowYamlJobs(yamlText);

  // 1. Check least-privilege permissions
  const permKeys = Object.keys(parsed.topLevelPermissions);
  const permissionsValid =
    parsed.topLevelPermissions["contents"] === "read" &&
    parsed.topLevelPermissions["actions"] === "read" &&
    permKeys.every((k) => parsed.topLevelPermissions[k] === "read");
  if (!permissionsValid) {
    errors.push(
      `Invalid top-level permissions: expected contents=read, actions=read with no write permissions, got ${JSON.stringify(
        parsed.topLevelPermissions
      )}.`
    );
  }

  // 2. Check SHA-pinned actions
  const shaPinRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+@[0-9a-f]{40}$/;
  const actionsShaPinned =
    parsed.allUses.length > 0 && parsed.allUses.every((u) => shaPinRegex.test(u));
  if (!actionsShaPinned) {
    const unpinned = parsed.allUses.filter((u) => !shaPinRegex.test(u));
    errors.push(
      `All workflow actions must be pinned to a full 40-char commit SHA. Invalid/unpinned actions: ${JSON.stringify(
        unpinned
      )}.`
    );
  }

  // 3. Check continue-on-error absence
  const continueOnErrorAbsent = !parsed.globalContinueOnError;
  if (!continueOnErrorAbsent) {
    errors.push("Workflow contains forbidden 'continue-on-error: true' which masks failing steps/jobs.");
  }

  // 4. Check triggers
  const triggersValid =
    parsed.hasPushTrigger &&
    parsed.pushBranches.includes(LOCKED_BRANCH) &&
    parsed.pushPathsIgnore.includes("reports/kh02/**") &&
    parsed.hasWorkflowDispatch &&
    !parsed.hasPullRequestTarget;
  if (!triggersValid) {
    errors.push(
      `Workflow triggers invalid: hasPush=${parsed.hasPushTrigger}, branches=${JSON.stringify(
        parsed.pushBranches
      )}, pathsIgnore=${JSON.stringify(parsed.pushPathsIgnore)}, hasWorkflowDispatch=${
        parsed.hasWorkflowDispatch
      }, hasPullRequestTarget=${parsed.hasPullRequestTarget}.`
    );
  }

  // 5. Check required jobs & job-level properties
  const requiredJobsConfigured: string[] = [];
  const missingRequiredJobs: string[] = [];
  const jobDetails: WorkflowContractVerificationResult["jobDetails"] = {};
  let allJobsHavePublicGuard = true;

  for (const reqJobId of CANONICAL_REQUIRED_JOBS) {
    const job = parsed.jobs[reqJobId];
    if (!job) {
      missingRequiredJobs.push(reqJobId);
      allJobsHavePublicGuard = false;
      jobDetails[reqJobId] = {
        present: false,
        nameMatchesId: false,
        publicGuard: false,
        runsOnValid: false,
        timeoutValid: false,
        expectedCommandPresent: false,
        needs: [],
      };
      errors.push(`Missing canonical required job '${reqJobId}'.`);
      continue;
    }

    const nameMatchesId = (job.name || job.jobId) === reqJobId;
    const publicGuard =
      typeof job.ifCondition === "string" &&
      job.ifCondition.includes("github.repository_visibility == 'public'");
    if (!publicGuard) {
      allJobsHavePublicGuard = false;
      errors.push(`Job '${reqJobId}' is missing cost-safety guard "if: github.repository_visibility == 'public'".`);
    }
    const runsOnValid = job.runsOn === "ubuntu-24.04" || job.runsOn === "ubuntu-latest";
    if (!runsOnValid) {
      errors.push(`Job '${reqJobId}' uses unsupported runner '${job.runsOn}'.`);
    }
    const timeoutValid =
      typeof job.timeoutMinutes === "number" && job.timeoutMinutes > 0 && job.timeoutMinutes <= 15;
    if (!timeoutValid) {
      errors.push(`Job '${reqJobId}' has invalid timeout-minutes (${job.timeoutMinutes}); must be 1..15.`);
    }

    const combinedRuns = job.runCommands.join("\n");
    const expectedSubstrings = EXPECTED_JOB_COMMANDS[reqJobId] || [];
    const expectedCommandPresent =
      expectedSubstrings.every((sub) => combinedRuns.includes(sub)) &&
      combinedRuns.includes("npm ci") &&
      combinedRuns.includes("prisma generate");

    if (!expectedCommandPresent) {
      errors.push(
        `Job '${reqJobId}' is missing required execution commands (expected npm ci, prisma generate, and ${JSON.stringify(
          expectedSubstrings
        )}).`
      );
    }

    if (!nameMatchesId) {
      errors.push(`Job '${reqJobId}' name '${job.name}' does not match canonical required job ID '${reqJobId}'.`);
    }

    jobDetails[reqJobId] = {
      present: true,
      nameMatchesId,
      publicGuard,
      runsOnValid,
      timeoutValid,
      expectedCommandPresent,
      needs: job.needs,
    };

    if (nameMatchesId && publicGuard && runsOnValid && timeoutValid && expectedCommandPresent && !job.continueOnError) {
      requiredJobsConfigured.push(reqJobId);
    } else {
      missingRequiredJobs.push(reqJobId);
    }
  }

  // Also ensure any extra jobs (if any) have the public visibility guard
  for (const [jId, jObj] of Object.entries(parsed.jobs)) {
    if (!jObj.ifCondition || !jObj.ifCondition.includes("github.repository_visibility == 'public'")) {
      allJobsHavePublicGuard = false;
      if (!CANONICAL_REQUIRED_JOBS.includes(jId as any)) {
        errors.push(`Job '${jId}' is missing public visibility guard.`);
      }
    }
  }

  // Check wave concurrency bound (<= 2 root jobs without needs)
  const rootJobs = Object.values(parsed.jobs).filter((j) => j.needs.length === 0);
  const concurrencyBounded = rootJobs.length > 0 && rootJobs.length <= 2;
  if (!concurrencyBounded) {
    errors.push(`Expected 1..2 root jobs for bounded wave concurrency (<= 2), found ${rootJobs.length}.`);
  }

  const verdict =
    workflowFileExists &&
    permissionsValid &&
    actionsShaPinned &&
    continueOnErrorAbsent &&
    allJobsHavePublicGuard &&
    triggersValid &&
    concurrencyBounded &&
    missingRequiredJobs.length === 0 &&
    errors.length === 0
      ? "PASS"
      : "FAIL";

  return {
    gateId: "E12",
    workflowFileExists,
    workflowPath: canonicalRelPath,
    workflowFileSha256,
    testedCodeSha,
    testedTreeSha,
    permissionsValid,
    actionsShaPinned,
    continueOnErrorAbsent,
    publicVisibilityGuardPresent: allJobsHavePublicGuard,
    triggersValid,
    concurrencyBounded,
    requiredJobsConfigured,
    missingRequiredJobs,
    jobDetails,
    errors,
    verdict,
    evaluatedAt,
  };
}

function main() {
  const result = verifyWorkflowContract();
  console.log("=== WORKFLOW CONTRACT VALIDATION (GATE E12) ===");
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict !== "PASS") {
    console.error(`WORKFLOW CONTRACT VALIDATION FAILED: ${result.errors.join(" | ")}`);
    process.exit(1);
  }
  console.log("STATUS: PASS");
  process.exit(0);
}

if (require.main === module) {
  main();
}
