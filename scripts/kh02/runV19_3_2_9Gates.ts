/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * Fail-Closed Deterministic Bounded Async DAG Test & Schema-Validated Gate Runner
 *
 * Implements V19.3.2.9 requirements:
 * - Real async DAG scheduling with bounded concurrency (max 2 child processes)
 * - Strict resource safety check before each wave and every 5s during gate execution:
 *   fail closed on statfs error, min 1 GiB disk, min 150 MB RAM, Linux cgroup v1/v2 + MemAvailable support
 * - Timeout race closure: timedOut flag forces status = "ABORTED_FAIL" and pass = false even if child traps SIGTERM and exits 0
 * - ByteTailRingBuffer (64 KiB cap) + credential redaction (sanitizeCiLog) + incremental SHA-256 verified against flushed disk file
 * - Strict two-way CI_PASS <=> (ciProviderVerified && providerVerified) invariant in validateGateOutput for E10/E11
 * - Gate E12 (Workflow Contract Validator) & Gate E13 (Dedicated V19.3.2.9 Adversarial Unit Suite)
 * - Separate wallClockDurationMs and sumGateDurationsMs in atomic gates_summary.json
 * - Authoritative log directory (reports/kh02/v19_3_2_9/logs)
 */

import { spawn, execSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import {
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  CANONICAL_REQUIRED_JOBS,
} from "../../src/services/kh02/release/githubActionsCiEvidence";

export interface GateDefinition {
  id: string;
  name: string;
  command: string;
  logFile: string;
  timeoutMs: number;
  maxLogBytes?: number;
  isVitest?: boolean;
}

export interface GateResult {
  gateId: string;
  name: string;
  command: string;
  exitCode: number;
  pass: boolean;
  durationMs: number;
  logFile: string;
  logSha256: string;
  logSizeBytes: number;
  startedAt: string;
  completedAt: string;
  testMetrics?: {
    filesTotal: number;
    filesPassed: number;
    filesFailed: number;
    testsTotal: number;
    testsPassed: number;
    testsFailed: number;
    testsSkipped: number;
  };
  parsedArtifact?: Record<string, unknown>;
  businessDataStatus?: "SUFFICIENT" | "INSUFFICIENT_EVIDENCE" | "NOT_APPLICABLE";
  error?: string;
  status:
    | "PASS"
    | "FAIL"
    | "SKIPPED_DEPENDENCY"
    | "ABORTED"
    | "ABORTED_FAIL"
    | "RESOURCE_GUARD"
    | "ENGINEERING_FAIL"
    | "TRUNCATED_FAIL";
}

export const CANONICAL_LOG_DIR = path.resolve(process.cwd(), "reports/kh02/v19_3_2_9/logs");
export const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MiB cap
export const DEFAULT_TAIL_BUFFER_BYTES = 64 * 1024; // 64 KiB byte-bounded tail buffer
export const MIN_FREE_DISK_BYTES = 1024 * 1024 * 1024; // 1 GiB minimum
export const MIN_FREE_RAM_BYTES = 150 * 1024 * 1024; // 150 MiB minimum
export const MAX_CONCURRENT_GATES = 2; // Strict concurrency bound

export const GATES: Record<string, GateDefinition> = {
  E1: {
    id: "E1",
    name: "TypeScript Compilation & Typecheck",
    command: "npx tsc --noEmit",
    logFile: "e1_typecheck.log",
    timeoutMs: 60000,
    isVitest: false,
  },
  E2: {
    id: "E2",
    name: "Git Diff Whitespace & Conflict Check",
    command: "git diff --check HEAD~1 HEAD",
    logFile: "e2_diff_check.log",
    timeoutMs: 15000,
    isVitest: false,
  },
  E12: {
    id: "E12",
    name: "GitHub Actions Workflow Contract Verification (Gate E12)",
    command: "npx tsx scripts/kh02/verifyWorkflowContractV19_3_2_9.ts",
    logFile: "e12_workflow_contract.log",
    timeoutMs: 30000,
    isVitest: false,
  },
  E13: {
    id: "E13",
    name: "Dedicated V19.3.2.9 Real GitHub CI & Required-Jobs Adversarial Suite (Gate E13)",
    command:
      "npx vitest run tests/unit/kh02/v12_4_3_7_19_3_2_9_RealGithubCiAndRequiredJobsProof.test.ts",
    logFile: "e13_v19_3_2_9_unit.log",
    timeoutMs: 60000,
    isVitest: true,
  },
  E3: {
    id: "E3",
    name: "Targeted V19.3.2.x CI Proof & Adversarial Runner Suites",
    command:
      "npx vitest run tests/unit/kh02/v12_4_3_7_19_3_2_9_RealGithubCiAndRequiredJobsProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_8_GithubApiRunWorkflowJobsBinding.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_7_MutableRegistryAndRunnerTruth.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_6_CiTrustBoundaryAndFailClosedRunner.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_5_CiTrustBoundaryClosure.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_4_CiHmacTrustBoundary.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_3_TrustedCiProofAndObservableExecution.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_2_MandatoryBusinessScopeAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_1_FinalAliasTrustAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_DurableAliasAuthorization.test.ts",
    logFile: "e3_targeted_suites.log",
    timeoutMs: 120000,
    isVitest: true,
  },
  E4: {
    id: "E4",
    name: "KH-02 Full Unit Test Suite",
    command: "npm run kh02:test:unit -- --maxWorkers=4",
    logFile: "e4_unit_tests.log",
    timeoutMs: 300000,
    isVitest: true,
  },
  E5: {
    id: "E5",
    name: "KH-02 Full Integration Test Suite",
    command: "npx vitest run tests/integration/kh02 --no-file-parallelism",
    logFile: "e5_integration_tests.log",
    timeoutMs: 300000,
    isVitest: true,
  },
  E6: {
    id: "E6",
    name: "KH-01 Baseline Verification Suite",
    command: "npm run kh01:verify",
    logFile: "e6_kh01_verify.log",
    timeoutMs: 60000,
    isVitest: true,
  },
  E7: {
    id: "E7",
    name: "Security Negative Suites",
    command:
      "npx vitest run tests/unit/kh02ProductMetadataSecurity.test.ts tests/unit/kh02/v12_4_3_7_17_NetworkSsrfRedirect.test.ts tests/unit/kh02/v12_4_3_7_18_SocketPeerTlsTrust.test.ts tests/unit/kh02/v12_4_3_7_18_1_SocketTrustNoTestBypass.test.ts",
    logFile: "e7_security_negative.log",
    timeoutMs: 60000,
    isVitest: true,
  },
  E8: {
    id: "E8",
    name: "Historical Demand Backtest (Dev & Holdout)",
    command: "npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts",
    logFile: "e8_backtest.log",
    timeoutMs: 90000,
    isVitest: false,
  },
  E9: {
    id: "E9",
    name: "Candidate Database Readback (Gate E9)",
    command: "npx tsx scripts/kh02/runCandidateDbReadback.ts",
    logFile: "e9_db_readback.log",
    timeoutMs: 30000,
    isVitest: false,
  },
  E10: {
    id: "E10",
    name: "Remote CI Proof Diagnostic (Gate E10)",
    command: "npx tsx scripts/kh02/runRemoteCiProofDiagnostic.ts",
    logFile: "e10_remote_ci.log",
    timeoutMs: 30000,
    isVitest: false,
  },
  E11: {
    id: "E11",
    name: "Read-Only GitHub REST Three-Endpoint & Discovery Smoke (Gate E11)",
    command: "npx tsx scripts/kh02/runRemoteCiProofDiagnostic.ts --probe-public",
    logFile: "e11_github_rest_smoke.log",
    timeoutMs: 30000,
    isVitest: false,
  },
};

/**
 * Redacts credentials, tokens, and verifier secrets from log text before disk write or memory retention.
 */
export function sanitizeCiLog(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/(Authorization\s*:\s*(?:Bearer|token)\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{16,255})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(github_pat_[A-Za-z0-9_]{16,255})\b/g, "[REDACTED_GITHUB_PAT]")
    .replace(
      /((?:GITHUB_TOKEN|GH_TOKEN|KH02_CI_VERIFIER_SECRET)\s*=\s*)[^\s"']+/gi,
      "$1[REDACTED_SECRET]"
    );
}

/**
 * Byte-bounded ring buffer for retaining the tail of log streams up to a strict byte cap (default 64 KiB).
 * Protects memory even when logs contain multi-megabyte single lines without newlines.
 */
export class ByteTailRingBuffer {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly maxBytes: number;

  constructor(maxBytes: number = DEFAULT_TAIL_BUFFER_BYTES) {
    this.maxBytes = Math.max(1024, maxBytes);
  }

  append(chunk: string | Buffer): void {
    const incoming = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
    if (incoming.length === 0) return;

    if (incoming.length >= this.maxBytes) {
      this.buffer = Buffer.from(incoming.subarray(incoming.length - this.maxBytes));
      return;
    }

    const totalLength = this.buffer.length + incoming.length;
    if (totalLength <= this.maxBytes) {
      this.buffer = Buffer.concat([this.buffer, incoming], totalLength);
    } else {
      const excess = totalLength - this.maxBytes;
      this.buffer = Buffer.concat([this.buffer.subarray(excess), incoming], this.maxBytes);
    }
  }

  getByteLength(): number {
    return this.buffer.length;
  }

  getTail(): string {
    return this.buffer.toString("utf-8");
  }

  toString(): string {
    return this.getTail();
  }
}

export { ByteTailRingBuffer as TailRingBuffer };

export function getAvailableMemoryBytes(): number {
  if (process.platform === "linux") {
    const candidates: number[] = [];
    // cgroup v2 check
    try {
      if (
        fs.existsSync("/sys/fs/cgroup/memory.max") &&
        fs.existsSync("/sys/fs/cgroup/memory.current")
      ) {
        const maxRaw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf-8").trim();
        const curRaw = fs.readFileSync("/sys/fs/cgroup/memory.current", "utf-8").trim();
        if (maxRaw !== "max") {
          const maxBytes = parseInt(maxRaw, 10);
          const curBytes = parseInt(curRaw, 10);
          if (Number.isFinite(maxBytes) && Number.isFinite(curBytes) && maxBytes > 0) {
            candidates.push(Math.max(0, maxBytes - curBytes));
          }
        }
      }
    } catch (_) {}

    // cgroup v1 check
    try {
      if (
        fs.existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes") &&
        fs.existsSync("/sys/fs/cgroup/memory/memory.usage_in_bytes")
      ) {
        const limitBytes = parseInt(
          fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf-8").trim(),
          10
        );
        const usageBytes = parseInt(
          fs.readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf-8").trim(),
          10
        );
        // Ignore unlimited sentinel (> 1 PiB)
        if (
          Number.isFinite(limitBytes) &&
          Number.isFinite(usageBytes) &&
          limitBytes > 0 &&
          limitBytes < 1024 * 1024 * 1024 * 1024 * 1024
        ) {
          candidates.push(Math.max(0, limitBytes - usageBytes));
        }
      }
    } catch (_) {}

    // /proc/meminfo MemAvailable check
    try {
      if (fs.existsSync("/proc/meminfo")) {
        const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
        const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
        if (match) {
          const kb = parseInt(match[1], 10);
          if (Number.isFinite(kb) && kb > 0) {
            candidates.push(kb * 1024);
          }
        }
      }
    } catch (_) {}

    if (candidates.length > 0) {
      return Math.min(...candidates);
    }
  }

  if (process.platform === "darwin") {
    try {
      const output = execSync("vm_stat", { encoding: "utf-8", timeout: 2000 });
      let pagesFree = 0;
      let pagesInactive = 0;
      let pageSize = 16384;

      const lines = output.split("\n");
      for (const line of lines) {
        if (line.includes("page size of")) {
          const match = line.match(/page size of (\d+) bytes/);
          if (match) pageSize = parseInt(match[1], 10);
        } else if (line.startsWith("Pages free:")) {
          const match = line.match(/Pages free:\s+(\d+)\./);
          if (match) pagesFree = parseInt(match[1], 10);
        } else if (line.startsWith("Pages inactive:")) {
          const match = line.match(/Pages inactive:\s+(\d+)\./);
          if (match) pagesInactive = parseInt(match[1], 10);
        }
      }

      if (pagesFree > 0 || pagesInactive > 0) {
        return (pagesFree + pagesInactive) * pageSize;
      }
    } catch (_) {}
  }

  return os.freemem();
}

export async function checkResourceSafety(
  dir: string = process.cwd(),
  minDiskBytes: number = MIN_FREE_DISK_BYTES,
  minRamBytes: number = MIN_FREE_RAM_BYTES
): Promise<{ safe: boolean; freeDiskBytes: number; freeRamBytes: number; error?: string }> {
  let freeDiskBytes = 0;
  try {
    const statfs = await fs.promises.statfs(dir);
    freeDiskBytes = statfs.bavail * statfs.bsize;
    if (isNaN(freeDiskBytes) || freeDiskBytes <= 0) {
      return {
        safe: false,
        freeDiskBytes: 0,
        freeRamBytes: 0,
        error: `SAFE_CHECK_FAILED: statfs returned invalid disk byte capacity (${freeDiskBytes}).`,
      };
    }
  } catch (err: any) {
    return {
      safe: false,
      freeDiskBytes: 0,
      freeRamBytes: 0,
      error: `SAFE_CHECK_FAILED: statfs check failed with error: ${err?.message}`,
    };
  }

  const freeRamBytes = getAvailableMemoryBytes();

  if (freeDiskBytes < minDiskBytes) {
    return {
      safe: false,
      freeDiskBytes,
      freeRamBytes,
      error: `SAFE_CHECK_FAILED: Available disk (${(freeDiskBytes / (1024 * 1024)).toFixed(
        1
      )} MB) is below safe minimum (${(minDiskBytes / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  if (freeRamBytes < minRamBytes) {
    return {
      safe: false,
      freeDiskBytes,
      freeRamBytes,
      error: `SAFE_CHECK_FAILED: Available memory (${(freeRamBytes / (1024 * 1024)).toFixed(
        1
      )} MB) is below safe minimum (${(minRamBytes / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  return { safe: true, freeDiskBytes, freeRamBytes };
}

export function parseVitestSummary(tailText: string): GateResult["testMetrics"] | null {
  const clean = tailText.replace(/\x1b\[[0-9;]*m/g, "");
  const testsMatches = [...clean.matchAll(/^\s*Tests\s+([^\n\r]+)/gm)];
  if (testsMatches.length === 0) return null;

  const summaryLine = testsMatches[testsMatches.length - 1][1];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;

  const passedMatch = summaryLine.match(/(\d+)\s+passed/);
  if (passedMatch) passed = parseInt(passedMatch[1], 10);

  const failedMatch = summaryLine.match(/(\d+)\s+failed/);
  if (failedMatch) failed = parseInt(failedMatch[1], 10);

  const skippedMatch = summaryLine.match(/(\d+)\s+skipped/);
  if (skippedMatch) skipped = parseInt(skippedMatch[1], 10);

  const totalMatch = summaryLine.match(/(\d+)\s+total/) || summaryLine.match(/\((\d+)\)/);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  if (total === 0 && (passed > 0 || failed > 0 || skipped > 0)) {
    total = passed + failed + skipped;
  }

  let filesTotal = 0;
  let filesPassed = 0;
  let filesFailed = 0;

  const filesMatches = [...clean.matchAll(/^\s*Test Files\s+([^\n\r]+)/gm)];
  if (filesMatches.length > 0) {
    const fLine = filesMatches[filesMatches.length - 1][1];
    const fPass = fLine.match(/(\d+)\s+passed/);
    if (fPass) filesPassed = parseInt(fPass[1], 10);

    const fFail = fLine.match(/(\d+)\s+failed/);
    if (fFail) filesFailed = parseInt(fFail[1], 10);

    const fTot = fLine.match(/(\d+)\s+total/) || fLine.match(/\((\d+)\)/);
    if (fTot) filesTotal = parseInt(fTot[1], 10);

    if (filesTotal === 0 && (filesPassed > 0 || filesFailed > 0)) {
      filesTotal = filesPassed + filesFailed;
    }
  }

  return {
    filesTotal,
    filesPassed,
    filesFailed,
    testsTotal: total,
    testsPassed: passed,
    testsFailed: failed,
    testsSkipped: skipped,
  };
}

/**
 * Extracts balanced top-level JSON objects from a text stream and returns the last valid parsed object.
 * Strictly ignores prose fragments that are not valid JSON objects.
 */
export function extractLastJsonObject(text: string): Record<string, any> | null {
  if (!text || typeof text !== "string") return null;
  const candidates: Record<string, any>[] = [];

  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        startIdx = i;
      }
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIdx !== -1) {
          const slice = text.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(slice);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              candidates.push(parsed);
            }
          } catch (_) {}
          startIdx = -1;
        }
      }
    }
  }

  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/**
 * Validates gate execution outputs fail-closed with strict schema + SHA checks for E8, E9, E10, E11, E12.
 * Rejects exit 0 with empty or truncated logs, prose-only banners, missing schema fields, or SHA mismatches.
 */
export function validateGateOutput(
  gate: GateDefinition,
  exitCode: number,
  tailText: string,
  logSizeBytes: number,
  maxLogBytes: number = DEFAULT_MAX_LOG_BYTES,
  expectedSha?: string
): {
  pass: boolean;
  status: GateResult["status"];
  metrics?: GateResult["testMetrics"];
  parsedArtifact?: Record<string, unknown>;
  businessDataStatus?: GateResult["businessDataStatus"];
  error?: string;
} {
  if (logSizeBytes > maxLogBytes) {
    return {
      pass: false,
      status: "TRUNCATED_FAIL",
      error: `Log output size (${logSizeBytes} bytes) exceeded maximum cap (${maxLogBytes} bytes).`,
    };
  }

  // 1. Vitest gates (E3, E4, E5, E6, E7, E13)
  if (gate.isVitest) {
    const metrics = parseVitestSummary(tailText);

    if (!metrics) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Vitest gate exited with code ${exitCode} but summary metrics could not be parsed from tail log.`,
      };
    }

    if (metrics.testsTotal === 0 || metrics.filesTotal === 0) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        metrics,
        error: `Vitest gate reported 0 total tests or files executed. Vacuous pass is rejected.`,
      };
    }

    if (metrics.testsPassed + metrics.testsFailed + metrics.testsSkipped !== metrics.testsTotal) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        metrics,
        error: `Vitest summary count inconsistency: passed(${metrics.testsPassed}) + failed(${metrics.testsFailed}) + skipped(${metrics.testsSkipped}) !== total(${metrics.testsTotal}).`,
      };
    }

    if (metrics.testsFailed > 0 || metrics.filesFailed > 0 || exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        metrics,
        error: `Vitest tests failed: ${metrics.testsFailed} tests / ${metrics.filesFailed} files failed (exit code: ${exitCode}).`,
      };
    }

    return {
      pass: true,
      status: "PASS",
      metrics,
    };
  }

  // 2. Strict JSON Schema + SHA validation for Gate E8 (Historical Demand Backtest)
  if (gate.id === "E8") {
    if (exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        error: `Backtest command exited with non-zero code ${exitCode}.`,
      };
    }

    const parsed = extractLastJsonObject(tailText);
    if (!parsed) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error:
          "Gate E8 completed with exit code 0 but did not emit a valid machine-readable JSON summary object (prose-only banner rejected).",
      };
    }

    const sha = String(parsed.testedCodeSha || parsed.evaluatedCodeSha || "").trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E8 JSON is missing a valid 40-char hex testedCodeSha/evaluatedCodeSha (got '${sha}').`,
      };
    }

    if (expectedSha && sha.toLowerCase() !== expectedSha.toLowerCase()) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E8 SHA mismatch: backtest evaluated '${sha}', expected '${expectedSha}'.`,
      };
    }

    if (parsed.policyScenarioVerdict !== "PASS") {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E8 policyScenarioVerdict is '${parsed.policyScenarioVerdict}' (expected 'PASS').`,
      };
    }

    if (parsed.pointInTimeIntegrityVerdict !== "PASS" || parsed.zeroFutureLeakageVerified !== true) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E8 point-in-time integrity check failed (pointInTimeIntegrityVerdict='${parsed.pointInTimeIntegrityVerdict}', zeroFutureLeakageVerified=${parsed.zeroFutureLeakageVerified}).`,
      };
    }

    const allowedVerdicts = ["INSUFFICIENT_EVIDENCE", "INSUFFICIENT_HISTORICAL_EVIDENCE", "PASS", "FAIL"];
    if (
      !allowedVerdicts.includes(String(parsed.historicalDevVerdict)) ||
      !allowedVerdicts.includes(String(parsed.historicalHoldoutVerdict)) ||
      !allowedVerdicts.includes(String(parsed.overallHistoricalBacktestVerdict))
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error:
          "Gate E8 JSON is missing valid historicalDevVerdict, historicalHoldoutVerdict, or overallHistoricalBacktestVerdict.",
      };
    }

    const businessDataStatus: GateResult["businessDataStatus"] =
      parsed.historicalDevVerdict === "PASS" && parsed.historicalHoldoutVerdict === "PASS"
        ? "SUFFICIENT"
        : "INSUFFICIENT_EVIDENCE";

    return {
      pass: true,
      status: "PASS",
      parsedArtifact: parsed,
      businessDataStatus,
    };
  }

  // 3. Strict JSON Schema + SHA validation for Gate E9 (Candidate Database Readback)
  if (gate.id === "E9") {
    if (exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        error: `Candidate DB readback command exited with non-zero code ${exitCode}.`,
      };
    }

    const parsed = extractLastJsonObject(tailText);
    if (!parsed) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: "Gate E9 completed with exit code 0 but did not emit a valid JSON object.",
      };
    }

    if (parsed.dbConnected !== true || parsed.dbReadbackExecuted !== true) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E9 JSON failed DB connection assertion (dbConnected=${parsed.dbConnected}, dbReadbackExecuted=${parsed.dbReadbackExecuted}).`,
      };
    }

    if (
      typeof parsed.candidateId !== "string" ||
      !parsed.candidateId.trim() ||
      typeof parsed.canonicalProductId !== "string" ||
      !parsed.canonicalProductId.trim()
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: "Gate E9 JSON is missing required candidateId or canonicalProductId.",
      };
    }

    const numericFields = ["rawRecordCount", "businessAttributableCount", "verifiedOfficialCsvRows"];
    for (const field of numericFields) {
      if (typeof parsed[field] !== "number" || !Number.isInteger(parsed[field]) || parsed[field] < 0) {
        return {
          pass: false,
          status: "ENGINEERING_FAIL",
          error: `Gate E9 JSON field '${field}' is missing or not a non-negative integer.`,
        };
      }
    }

    if (
      !["INSUFFICIENT_EVIDENCE", "PASS", "FAIL"].includes(String(parsed.g15Verdict)) ||
      !["INSUFFICIENT_EVIDENCE", "PASS", "FAIL"].includes(String(parsed.g16Verdict))
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: "Gate E9 JSON is missing valid g15Verdict or g16Verdict.",
      };
    }

    if (
      parsed.verifiedOfficialCsvRows === 0 &&
      (parsed.g15Verdict === "PASS" || parsed.g16Verdict === "PASS")
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: "Gate E9 falsely claimed G15/G16 PASS while verifiedOfficialCsvRows === 0.",
      };
    }

    if (parsed.testedCodeSha !== undefined) {
      if (typeof parsed.testedCodeSha !== "string" || !/^[0-9a-f]{40}$/i.test(parsed.testedCodeSha)) {
        return {
          pass: false,
          status: "ENGINEERING_FAIL",
          error: `Gate E9 JSON has malformed testedCodeSha '${parsed.testedCodeSha}'.`,
        };
      }
      if (expectedSha && parsed.testedCodeSha.toLowerCase() !== expectedSha.toLowerCase()) {
        return {
          pass: false,
          status: "ENGINEERING_FAIL",
          error: `Gate E9 SHA mismatch: got '${parsed.testedCodeSha}', expected '${expectedSha}'.`,
        };
      }
    }

    return {
      pass: true,
      status: "PASS",
      parsedArtifact: parsed,
      businessDataStatus:
        parsed.g15Verdict === "PASS" && parsed.g16Verdict === "PASS"
          ? "SUFFICIENT"
          : "INSUFFICIENT_EVIDENCE",
    };
  }

  // 4. Strict JSON Schema + Two-Way CI_PASS Invariant for Gate E10 & E11 (Remote CI Proof Diagnostic)
  if (gate.id === "E10" || gate.id === "E11") {
    if (exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        error: `Remote CI diagnostic command (${gate.id}) exited with non-zero code ${exitCode}.`,
      };
    }

    const parsed = extractLastJsonObject(tailText);
    if (!parsed) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} completed with exit code 0 but did not emit a valid JSON object.`,
      };
    }

    if (parsed.diagnosticExecuted !== true) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} JSON missing diagnosticExecuted === true.`,
      };
    }

    if (parsed.repository !== CANONICAL_REPOSITORY || parsed.branch !== LOCKED_BRANCH) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} JSON repository/branch mismatch (got repo='${parsed.repository}', branch='${parsed.branch}').`,
      };
    }

    if (typeof parsed.testedCodeSha !== "string" || !/^[0-9a-f]{40}$/i.test(parsed.testedCodeSha)) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} JSON is missing a valid 40-char hex testedCodeSha (got '${parsed.testedCodeSha}').`,
      };
    }

    if (expectedSha && parsed.testedCodeSha.toLowerCase() !== expectedSha.toLowerCase()) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} SHA mismatch: got '${parsed.testedCodeSha}', expected '${expectedSha}'.`,
      };
    }

    const allowedCiStatuses = [
      "CI_PASS",
      "CI_FAIL",
      "CI_NOT_RUN",
      "CI_NOT_CONFIGURED",
      "CI_UNVERIFIED",
    ];
    if (
      !allowedCiStatuses.includes(String(parsed.status)) ||
      typeof parsed.ciProviderVerified !== "boolean"
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} JSON is missing valid status or boolean ciProviderVerified.`,
      };
    }

    // Two-way consistency invariant:
    // (a) Any non-CI_PASS status MUST have ciProviderVerified === false && providerVerified !== true
    if (
      parsed.status !== "CI_PASS" &&
      (parsed.ciProviderVerified === true || parsed.providerVerified === true)
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} reported status='${parsed.status}' but falsely claimed ciProviderVerified=true.`,
      };
    }

    // (b) status === "CI_PASS" MUST have ciProviderVerified === true && providerVerified === true
    if (
      parsed.status === "CI_PASS" &&
      (parsed.ciProviderVerified !== true || parsed.providerVerified !== true)
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate ${gate.id} reported status='CI_PASS' while ciProviderVerified=${parsed.ciProviderVerified}, providerVerified=${parsed.providerVerified}. Contradictory CI_PASS claim rejected.`,
      };
    }

    return {
      pass: true,
      status: "PASS",
      parsedArtifact: parsed,
    };
  }

  // 5. Strict JSON Schema + SHA validation for Gate E12 (Workflow Contract Validator)
  if (gate.id === "E12") {
    if (exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        error: `Workflow contract validator (E12) exited with non-zero code ${exitCode}.`,
      };
    }

    const parsed = extractLastJsonObject(tailText);
    if (!parsed) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: "Gate E12 completed with exit code 0 but did not emit a valid JSON object.",
      };
    }

    if (
      parsed.workflowFileExists !== true ||
      parsed.workflowPath !== ".github/workflows/kh02-ci.yml"
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E12 failed workflow file existence/path check (exists=${parsed.workflowFileExists}, path='${parsed.workflowPath}').`,
      };
    }

    if (typeof parsed.testedCodeSha !== "string" || !/^[0-9a-f]{40}$/i.test(parsed.testedCodeSha)) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E12 JSON is missing a valid 40-char hex testedCodeSha (got '${parsed.testedCodeSha}').`,
      };
    }

    if (expectedSha && parsed.testedCodeSha.toLowerCase() !== expectedSha.toLowerCase()) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E12 SHA mismatch: got '${parsed.testedCodeSha}', expected '${expectedSha}'.`,
      };
    }

    if (
      parsed.permissionsValid !== true ||
      parsed.actionsShaPinned !== true ||
      parsed.continueOnErrorAbsent !== true ||
      parsed.publicVisibilityGuardPresent !== true ||
      parsed.triggersValid !== true ||
      parsed.verdict !== "PASS"
    ) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E12 contract checks did not all pass (verdict=${parsed.verdict}, permissions=${parsed.permissionsValid}, shaPinned=${parsed.actionsShaPinned}, noContinueOnError=${parsed.continueOnErrorAbsent}, publicGuard=${parsed.publicVisibilityGuardPresent}, triggers=${parsed.triggersValid}).`,
      };
    }

    const configuredJobs = Array.isArray(parsed.requiredJobsConfigured)
      ? parsed.requiredJobsConfigured
      : [];
    const missingCanonical = CANONICAL_REQUIRED_JOBS.filter((j) => !configuredJobs.includes(j));
    if (missingCanonical.length > 0) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Gate E12 workflow is missing canonical required jobs: ${missingCanonical.join(", ")}.`,
      };
    }

    return {
      pass: true,
      status: "PASS",
      parsedArtifact: parsed,
    };
  }

  // 6. General commands (E1, E2)
  if (exitCode !== 0) {
    return {
      pass: false,
      status: "FAIL",
      error: `Command exited with non-zero code ${exitCode}.`,
    };
  }

  return {
    pass: true,
    status: "PASS",
  };
}

export function verifyWorktreeIntegrity(
  expectedHeadSha: string,
  expectedTreeSha?: string
): { clean: boolean; headSha: string; treeSha: string; error?: string } {
  try {
    const headSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const treeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();

    if (headSha !== expectedHeadSha) {
      return {
        clean: false,
        headSha,
        treeSha,
        error: `HEAD_MUTATED: Expected HEAD SHA '${expectedHeadSha}', observed '${headSha}'.`,
      };
    }

    if (expectedTreeSha && treeSha !== expectedTreeSha) {
      return {
        clean: false,
        headSha,
        treeSha,
        error: `TREE_MUTATED: Expected Tree SHA '${expectedTreeSha}', observed '${treeSha}'.`,
      };
    }

    const porcelain = execSync("git status --porcelain=v1", { encoding: "utf-8" }).trim();
    if (porcelain) {
      const dirtyLines = porcelain.split("\n").filter((l) => {
        const line = l.trim();
        if (!line) return false;
        // Only allow the active runner's report directory during gate execution
        if (line.includes("reports/kh02/v19_3_2_9/")) return false;
        return true;
      });

      if (dirtyLines.length > 0) {
        return {
          clean: false,
          headSha,
          treeSha,
          error: `WORKTREE_DIRTY: Uncommitted modifications detected during run: ${dirtyLines.join(", ")}`,
        };
      }
    }

    return { clean: true, headSha, treeSha };
  } catch (err: any) {
    return { clean: false, headSha: "", treeSha: "", error: `GIT_CHECK_FAILED: ${err?.message}` };
  }
}

async function computeFileSha256Stream(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
}

export async function runSingleGate(
  gate: GateDefinition,
  expectedSha?: string,
  options: { logDir?: string; resourceSampleIntervalMs?: number } = {}
): Promise<GateResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const targetLogDir = options.logDir || CANONICAL_LOG_DIR;
  const logFilePath = path.join(targetLogDir, gate.logFile);

  fs.mkdirSync(targetLogDir, { recursive: true });

  const ringBuffer = new ByteTailRingBuffer(DEFAULT_TAIL_BUFFER_BYTES);
  const logStream = fs.createWriteStream(logFilePath, { flags: "w" });
  const incrementalHash = crypto.createHash("sha256");
  const maxLogBytes = gate.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
  let actualSizeBytes = 0;
  let timedOut = false;
  let truncatedOverflow = false;
  let resourceAborted = false;
  let resourceAbortReason = "";

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    CI: "1",
    NODE_ENV: gate.id === "E9" ? "development" : "test",
    VITEST_MAX_WORKERS: gate.id === "E5" ? "1" : "4",
  };

  console.log(`[GATE START] ${gate.id}: ${gate.name}`);

  return new Promise<GateResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(gate.command, {
        shell: true,
        env: childEnv,
        detached: process.platform !== "win32",
      });
    } catch (err: any) {
      logStream.end();
      return resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: -1,
        pass: false,
        durationMs: Date.now() - startTime,
        logFile: gate.logFile,
        logSha256: "",
        logSizeBytes: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        error: `Failed to spawn process: ${err.message}`,
        status: "FAIL",
      });
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.warn(`[GATE TIMEOUT] ${gate.id} timed out after ${gate.timeoutMs}ms.`);
      if (child.pid) killProcessGroup(child.pid);
    }, gate.timeoutMs);

    const sampleIntervalMs = options.resourceSampleIntervalMs || 5000;
    const resourceHandle = setInterval(async () => {
      try {
        const check = await checkResourceSafety();
        if (!check.safe) {
          resourceAborted = true;
          resourceAbortReason = check.error || "Resource safety threshold breached during gate execution.";
          if (child.pid) killProcessGroup(child.pid);
        }
      } catch (_) {}
    }, sampleIntervalMs);

    const onData = (data: Buffer) => {
      const sanitizedText = sanitizeCiLog(data.toString("utf-8"));
      const sanitizedBuf = Buffer.from(sanitizedText, "utf-8");
      actualSizeBytes += sanitizedBuf.length;
      if (actualSizeBytes > maxLogBytes) {
        truncatedOverflow = true;
        if (child.pid) killProcessGroup(child.pid);
      } else {
        incrementalHash.update(sanitizedBuf);
        logStream.write(sanitizedBuf);
        ringBuffer.append(sanitizedBuf);
      }
    };

    if (child.stdout) child.stdout.on("data", onData);
    if (child.stderr) child.stderr.on("data", onData);

    child.on("close", async (code, signal) => {
      clearTimeout(timeoutHandle);
      clearInterval(resourceHandle);

      await new Promise<void>((resFlush) => {
        logStream.end(() => resFlush());
      });

      const durationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();
      const incrementalSha256 = incrementalHash.digest("hex");

      let diskSizeBytes = 0;
      let diskSha256 = "";
      let logFlushMismatchError: string | null = null;
      try {
        if (fs.existsSync(logFilePath)) {
          const stat = fs.statSync(logFilePath);
          diskSizeBytes = stat.size;
          diskSha256 = await computeFileSha256Stream(logFilePath);
          if (!truncatedOverflow && (diskSizeBytes !== actualSizeBytes || diskSha256 !== incrementalSha256)) {
            logFlushMismatchError = `Log integrity mismatch after stream flush: diskSize(${diskSizeBytes}) !== written(${actualSizeBytes}) or diskSha256(${diskSha256}) !== incrementalSha256(${incrementalSha256}).`;
          }
        }
      } catch (err: any) {
        logFlushMismatchError = `Failed to verify flushed log file: ${err?.message}`;
      }

      const effectiveExit = code !== null ? code : signal ? 128 : -1;

      // 1. Timeout race check MUST take precedence over exit code 0 or valid-looking output
      if (timedOut) {
        console.log(
          `[GATE END] ${gate.id} -> ABORTED_FAIL (timeout after ${gate.timeoutMs}ms, exit ${effectiveExit})`
        );
        return resolve({
          gateId: gate.id,
          name: gate.name,
          command: gate.command,
          exitCode: effectiveExit,
          pass: false,
          durationMs,
          logFile: gate.logFile,
          logSha256: diskSha256 || incrementalSha256,
          logSizeBytes: actualSizeBytes,
          startedAt,
          completedAt,
          error: `GATE_TIMEOUT_ABORTED: Gate ${gate.id} exceeded timeout of ${gate.timeoutMs}ms (child exit code ${effectiveExit}).`,
          status: "ABORTED_FAIL",
        });
      }

      // 2. Resource abort check
      if (resourceAborted) {
        return resolve({
          gateId: gate.id,
          name: gate.name,
          command: gate.command,
          exitCode: effectiveExit,
          pass: false,
          durationMs,
          logFile: gate.logFile,
          logSha256: diskSha256 || incrementalSha256,
          logSizeBytes: actualSizeBytes,
          startedAt,
          completedAt,
          error: resourceAbortReason,
          status: "RESOURCE_GUARD",
        });
      }

      // 3. Log flush integrity check
      if (logFlushMismatchError) {
        return resolve({
          gateId: gate.id,
          name: gate.name,
          command: gate.command,
          exitCode: effectiveExit,
          pass: false,
          durationMs,
          logFile: gate.logFile,
          logSha256: diskSha256 || incrementalSha256,
          logSizeBytes: actualSizeBytes,
          startedAt,
          completedAt,
          error: logFlushMismatchError,
          status: "ENGINEERING_FAIL",
        });
      }

      const tailText = ringBuffer.getTail();
      const validation = validateGateOutput(
        gate,
        effectiveExit,
        tailText,
        actualSizeBytes,
        maxLogBytes,
        expectedSha
      );

      console.log(
        `[GATE END] ${gate.id} -> ${validation.status} (exit ${effectiveExit}, ${durationMs}ms, ${actualSizeBytes} bytes)`
      );

      return resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: effectiveExit,
        pass: validation.pass,
        durationMs,
        logFile: gate.logFile,
        logSha256: diskSha256 || incrementalSha256,
        logSizeBytes: actualSizeBytes,
        startedAt,
        completedAt,
        testMetrics: validation.metrics,
        parsedArtifact: validation.parsedArtifact,
        businessDataStatus: validation.businessDataStatus,
        error: validation.error,
        status: validation.status,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      clearInterval(resourceHandle);
      logStream.end();
      resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: -1,
        pass: false,
        durationMs: Date.now() - startTime,
        logFile: gate.logFile,
        logSha256: "",
        logSizeBytes: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        error: `Child process encountered runtime error: ${err.message}`,
        status: "FAIL",
      });
    });
  });
}

function killProcessGroup(pid: number) {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch (_) {}
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (_) {}
    }, 2000);
  } catch (_) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {}
  }
}

export async function runAllGates(): Promise<{
  allPassed: boolean;
  results: GateResult[];
  summary: Record<string, any>;
}> {
  const runnerStartMs = Date.now();
  console.log("=== KH-02 V12.4.3.7.19.3.2.9 ASYNC DAG GATE RUNNER START ===");

  const headSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  const treeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();
  const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();

  const resourcePreflight = await checkResourceSafety();
  if (!resourcePreflight.safe) {
    throw new Error(`PREFLIGHT_ABORT: Resource check failed: ${resourcePreflight.error}`);
  }

  const worktreePreflight = verifyWorktreeIntegrity(headSha, treeSha);
  if (!worktreePreflight.clean) {
    throw new Error(`PREFLIGHT_ABORT: Worktree check failed: ${worktreePreflight.error}`);
  }

  const results: Record<string, GateResult> = {};

  // Wave 1: Fast deterministic preflight (E1 Typecheck, E2 Git Diff, E12 Workflow Contract, bound <= 2)
  console.log("\n--- WAVE 1: Fast Preflight & Workflow Contract (E1, E2, E12) ---");
  const wave1A = await Promise.all([runSingleGate(GATES.E1, headSha), runSingleGate(GATES.E2, headSha)]);
  wave1A.forEach((r) => (results[r.gateId] = r));
  if (!wave1A.every((r) => r.pass)) {
    console.error("Wave 1A preflight gates failed. Halting DAG execution.");
    return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
  }

  const wave1B = await Promise.all([runSingleGate(GATES.E12, headSha), runSingleGate(GATES.E13, headSha)]);
  wave1B.forEach((r) => (results[r.gateId] = r));
  if (!wave1B.every((r) => r.pass)) {
    console.error("Wave 1B workflow contract / V19.3.2.9 suite failed. Halting DAG execution.");
    return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
  }

  // Wave 2: Targeted CI Proof & Runner Matrix (E3)
  console.log("\n--- WAVE 2: Targeted CI Proof Matrix (E3) ---");
  const wave2 = await runSingleGate(GATES.E3, headSha);
  results[wave2.gateId] = wave2;
  try {
    execSync("git checkout -- reports/kh02/v19_3_2_7/", { stdio: "ignore" });
    execSync("git clean -f reports/kh02/v19_3_2_7/", { stdio: "ignore" });
  } catch (_) {}

  if (!wave2.pass) {
    console.error("Wave 2 targeted CI proof gate failed. Halting DAG execution.");
    return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
  }

  // Wave 3: Independent Units & Security Suites (E4, E6, E7, E10, E11) bounded to max 2 concurrency
  console.log("\n--- WAVE 3: Parallel Unit & Security Suites (E4, E6, E7, E10, E11) ---");
  const wave3Gates = [GATES.E4, GATES.E6, GATES.E7, GATES.E10, GATES.E11];
  for (let i = 0; i < wave3Gates.length; i += MAX_CONCURRENT_GATES) {
    const waveCheck = await checkResourceSafety();
    if (!waveCheck.safe) {
      throw new Error(`WAVE3_RESOURCE_ABORT: ${waveCheck.error}`);
    }
    const batch = wave3Gates.slice(i, i + MAX_CONCURRENT_GATES);
    const batchResults = await Promise.all(batch.map((g) => runSingleGate(g, headSha)));
    batchResults.forEach((r) => (results[r.gateId] = r));
    if (!batchResults.every((r) => r.pass)) {
      try {
        execSync("git checkout -- acceptance/ reports/kh02/v19_3_2_7/", { stdio: "ignore" });
        execSync("git clean -f reports/kh02/v19_3_2_7/", { stdio: "ignore" });
      } catch (_) {}
      console.error(`Wave 3 batch failed. Halting further DAG execution.`);
      return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
    }
  }

  // Wave 4: Serialized Database Pipeline (E5 Integration -> E8 Backtest -> E9 DB Readback)
  console.log("\n--- WAVE 4: Serialized Database Pipeline (E5 -> E8 -> E9) ---");
  const wave4Gates = [GATES.E5, GATES.E8, GATES.E9];
  for (const g of wave4Gates) {
    const waveCheck = await checkResourceSafety();
    if (!waveCheck.safe) {
      throw new Error(`WAVE4_RESOURCE_ABORT: ${waveCheck.error}`);
    }
    const r = await runSingleGate(g, headSha);
    results[r.gateId] = r;
    if (!r.pass) {
      try {
        execSync("git checkout -- acceptance/ reports/kh02/v19_3_2_7/", { stdio: "ignore" });
        execSync("git clean -f reports/kh02/v19_3_2_7/", { stdio: "ignore" });
      } catch (_) {}
      console.error(`Gate ${g.id} failed in serialized pipeline. Halting execution.`);
      return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
    }
  }

  // Restore any legacy paths touched by older suites (E5 writes data/google_trends_imports/*.csv, E8 writes acceptance/*.json, v19_3_2_7 test writes reports/kh02/v19_3_2_7/)
  try {
    execSync("git checkout -- acceptance/ reports/kh02/v19_3_2_7/", { stdio: "ignore" });
    execSync("git clean -f reports/kh02/v19_3_2_7/ data/google_trends_imports/", { stdio: "ignore" });
  } catch (_) {}

  // Post-execution worktree check (strictly rejects any dirty path outside reports/kh02/v19_3_2_9/)
  const worktreePost = verifyWorktreeIntegrity(headSha, treeSha);
  if (!worktreePost.clean) {
    console.error(`Post-execution worktree integrity check failed: ${worktreePost.error}`);
    results["WORKTREE"] = {
      gateId: "WORKTREE",
      name: "Worktree Immutability Check",
      command: "git status --porcelain=v1",
      exitCode: 1,
      pass: false,
      durationMs: 0,
      logFile: "",
      logSha256: "",
      logSizeBytes: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: worktreePost.error,
      status: "ENGINEERING_FAIL",
    };
  }

  return finalizeSummary(results, headSha, treeSha, branch, resourcePreflight, runnerStartMs);
}

function finalizeSummary(
  results: Record<string, GateResult>,
  headSha: string,
  treeSha: string,
  branch: string,
  resourcePreflight: { safe: boolean; freeDiskBytes: number; freeRamBytes: number },
  runnerStartMs: number
): {
  allPassed: boolean;
  results: GateResult[];
  summary: Record<string, any>;
} {
  const resultList = Object.values(results);
  const totalExpectedGates = Object.keys(GATES).length;
  const allPassed = resultList.length === totalExpectedGates && resultList.every((r) => r.pass);
  const sumGateDurationsMs = resultList.reduce((acc, r) => acc + r.durationMs, 0);
  const wallClockDurationMs = Date.now() - runnerStartMs;

  const summary = {
    version: "12.4.3.7.19.3.2.9",
    commitSha: headSha,
    treeSha,
    branch,
    allPassed,
    completedGates: resultList.filter((r) => r.pass).length,
    totalGates: totalExpectedGates,
    wallClockDurationMs,
    sumGateDurationsMs,
    totalDurationMs: sumGateDurationsMs,
    maxConcurrency: MAX_CONCURRENT_GATES,
    resourcePreflight,
    generatedAt: new Date().toISOString(),
    results: resultList,
  };

  const summaryPath = path.join(CANONICAL_LOG_DIR, "gates_summary.json");
  const tmpSummaryPath = `${summaryPath}.tmp.${process.pid}`;
  fs.mkdirSync(CANONICAL_LOG_DIR, { recursive: true });
  fs.writeFileSync(tmpSummaryPath, JSON.stringify(summary, null, 2) + "\n");
  fs.renameSync(tmpSummaryPath, summaryPath);

  console.log(`\n=== GATES SUMMARY SAVED TO: ${summaryPath} ===`);
  console.log(
    `All Passed: ${allPassed} (${summary.completedGates}/${totalExpectedGates} gates passed, wallClock=${wallClockDurationMs}ms, sumGates=${sumGateDurationsMs}ms)`
  );

  return { allPassed, results: resultList, summary };
}

if (require.main === module || process.argv[1]?.endsWith("runV19_3_2_9Gates.ts")) {
  runAllGates()
    .then(({ allPassed }) => {
      process.exit(allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error("FATAL RUNNER EXCEPTION:", err);
      process.exit(1);
    });
}
