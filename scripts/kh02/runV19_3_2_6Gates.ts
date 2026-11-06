/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.6
 * Fail-Closed Deterministic Bounded Async DAG Test & Validation Gate Runner
 *
 * Implements Workstream B requirements:
 * - Real async DAG scheduling with bounded concurrency (max 2 child processes)
 * - Strict resource safety check before each wave: fail closed on statfs error, min 1 GiB disk, min 150 MB RAM
 * - Process group tracking with detached processes, SIGTERM and SIGKILL bounds
 * - True streaming logs with bounded tail ring buffer (32 KiB) for Vitest summary parsing
 * - Maximum log byte cap enforcement with fail-closed TRUNCATED_FAIL
 * - Vitest summary metric validation: non-empty metrics, testsTotal > 0, testsFailed === 0 (exit 0 alone is rejected)
 * - Dynamic runtime Git HEAD and working-tree mutation detection (ENGINEERING_FAIL on drift)
 * - Strict SQLite isolation: E5, E9, E10 serialized on Stream B
 * - Single authoritative log directory (reports/kh02/v19_3_2_6/logs)
 * - Atomic gates_summary.json emission
 */

import { spawn, execSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

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
  error?: string;
  status: "PASS" | "FAIL" | "SKIPPED_DEPENDENCY" | "ABORTED" | "RESOURCE_GUARD" | "ENGINEERING_FAIL" | "TRUNCATED_FAIL";
}

export const CANONICAL_LOG_DIR = path.resolve(process.cwd(), "reports/kh02/v19_3_2_6/logs");
export const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MiB cap
export const MIN_FREE_DISK_GB = 1.0;
export const MIN_FREE_RAM_MB = 150.0;
export const TAIL_RING_BUFFER_BYTES = 32 * 1024; // 32 KiB tail buffer

export const GATES: Record<string, GateDefinition> = {
  E1: {
    id: "E1",
    name: "TypeScript Compilation & Typecheck",
    command: "npx tsc --noEmit",
    logFile: "e1_typecheck.log",
    timeoutMs: 120000,
    isVitest: false,
  },
  E2: {
    id: "E2",
    name: "Git Diff Whitespace & Conflict Check",
    command: "git diff --check HEAD~1 HEAD",
    logFile: "e2_diff_check.log",
    timeoutMs: 30000,
    isVitest: false,
  },
  E3: {
    id: "E3",
    name: "Targeted V19.3.2.x CI Proof & Adversarial Runner Suites",
    command:
      "npx vitest run tests/unit/kh02/v12_4_3_7_19_3_2_6_CiTrustBoundaryAndFailClosedRunner.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_5_CiTrustBoundaryClosure.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_4_CiHmacTrustBoundary.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_3_TrustedCiProofAndObservableExecution.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_2_MandatoryBusinessScopeAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_1_FinalAliasTrustAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_DurableAliasAuthorization.test.ts",
    logFile: "e3_targeted_suites.log",
    timeoutMs: 180000,
    isVitest: true,
  },
  E4: {
    id: "E4",
    name: "KH-02 Full Unit Test Suite",
    command: "npm run kh02:test:unit -- --maxWorkers=4",
    logFile: "e4_unit_tests.log",
    timeoutMs: 600000,
    isVitest: true,
  },
  E5: {
    id: "E5",
    name: "KH-02 Full Integration Test Suite",
    command: "npm run kh02:test:integration -- --fileParallelism=false",
    logFile: "e5_integration_tests.log",
    timeoutMs: 300000,
    isVitest: true,
  },
  E6: {
    id: "E6",
    name: "KH-01 Baseline Verification Suite",
    command: "npm run kh01:verify",
    logFile: "e6_kh01_verify.log",
    timeoutMs: 120000,
    isVitest: true,
  },
  E7: {
    id: "E7",
    name: "Security Negative Suites",
    command:
      "npx vitest run tests/unit/kh02ProductMetadataSecurity.test.ts tests/unit/kh02/v12_4_3_7_17_NetworkSsrfRedirect.test.ts tests/unit/kh02/v12_4_3_7_18_SocketPeerTlsTrust.test.ts tests/unit/kh02/v12_4_3_7_18_1_SocketTrustNoTestBypass.test.ts",
    logFile: "e7_security_negative.log",
    timeoutMs: 120000,
    isVitest: true,
  },
  E8: {
    id: "E8",
    name: "Historical Demand Backtest (Dev & Holdout)",
    command: "npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts",
    logFile: "e8_backtest.log",
    timeoutMs: 180000,
    isVitest: false,
  },
  E9: {
    id: "E9",
    name: "Candidate Database Readback (Gate E9)",
    command: "npx tsx scripts/kh02/runCandidateDbReadback.ts",
    logFile: "e9_db_readback.log",
    timeoutMs: 60000,
    isVitest: false,
  },
  E10: {
    id: "E10",
    name: "Remote CI Proof Diagnostic (Gate E10)",
    command: "npx tsx scripts/kh02/runRemoteCiProofDiagnostic.ts",
    logFile: "e10_remote_ci.log",
    timeoutMs: 60000,
    isVitest: false,
  },
};

export const DAG_STRUCTURE = {
  wave1: ["E1", "E2"], // Parallel pre-checks
  wave2: ["E3"],       // Targeted CI security suites
  wave3: {
    streamA: ["E4"],   // Unit tests (CPU-bound)
    streamB: ["E6", "E7", "E10"], // Independent non-DB suites running concurrent with E4
    serializedDb: ["E5", "E8", "E9"], // Strict SQLite serialization
  },
};

export function getAvailableMemoryBytes(): number {
  if (process.platform === "darwin") {
    try {
      const vmStat = execSync("vm_stat", { encoding: "utf-8" });
      const freeMatch = vmStat.match(/Pages free:\s+(\d+)\./);
      const inactiveMatch = vmStat.match(/Pages inactive:\s+(\d+)\./);
      if (freeMatch && inactiveMatch) {
        const freePages = parseInt(freeMatch[1], 10);
        const inactivePages = parseInt(inactiveMatch[1], 10);
        return (freePages + inactivePages) * 16384;
      }
    } catch (_) {}
  }
  return os.freemem();
}

/**
 * Fail-closed resource safety checker.
 * If statfs throws an exception, safely catches and returns safe: false with STATFS_ERROR.
 */
export function checkResourceSafety(
  statfsProvider?: () => { bavail: bigint | number; bsize: bigint | number },
  freememProvider?: () => number
): { safe: boolean; freeDiskGb: number; freeMemMb: number; reason?: string } {
  try {
    let freeBytes = 0;
    if (statfsProvider) {
      const stat = statfsProvider();
      freeBytes = Number(stat.bavail) * Number(stat.bsize);
    } else {
      const stat = fs.statfsSync(process.cwd());
      freeBytes = Number(stat.bavail) * stat.bsize;
    }

    const freeDiskGb = freeBytes / (1024 * 1024 * 1024);
    const freeMemBytes = freememProvider ? freememProvider() : getAvailableMemoryBytes();
    const freeMemMb = freeMemBytes / (1024 * 1024);

    if (freeDiskGb < MIN_FREE_DISK_GB) {
      return {
        safe: false,
        freeDiskGb,
        freeMemMb,
        reason: `INSUFFICIENT_DISK: Available disk (${freeDiskGb.toFixed(2)} GB) is below minimum required (${MIN_FREE_DISK_GB} GB)`,
      };
    }

    if (freeMemMb < MIN_FREE_RAM_MB) {
      return {
        safe: false,
        freeDiskGb,
        freeMemMb,
        reason: `INSUFFICIENT_RAM: Available memory (${freeMemMb.toFixed(2)} MB) is below minimum safety reserve (${MIN_FREE_RAM_MB} MB)`,
      };
    }

    return { safe: true, freeDiskGb, freeMemMb };
  } catch (err: any) {
    return {
      safe: false,
      freeDiskGb: 0,
      freeMemMb: 0,
      reason: `STATFS_ERROR: Failed to query filesystem resources: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Ring buffer maintaining the last N bytes of streaming text.
 */
export class TailRingBuffer {
  private buffer: Buffer;
  private size: number;
  private capacity: number;
  private writePos: number;

  constructor(capacity: number = TAIL_RING_BUFFER_BYTES) {
    this.capacity = capacity;
    this.buffer = Buffer.alloc(capacity);
    this.size = 0;
    this.writePos = 0;
  }

  append(chunk: Buffer | string): void {
    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
    if (chunkBuf.length >= this.capacity) {
      chunkBuf.copy(this.buffer, 0, chunkBuf.length - this.capacity);
      this.size = this.capacity;
      this.writePos = 0;
      return;
    }

    for (let i = 0; i < chunkBuf.length; i++) {
      this.buffer[this.writePos] = chunkBuf[i];
      this.writePos = (this.writePos + 1) % this.capacity;
      if (this.size < this.capacity) {
        this.size++;
      }
    }
  }

  toString(): string {
    if (this.size < this.capacity) {
      return this.buffer.toString("utf-8", 0, this.size);
    }
    const part1 = this.buffer.toString("utf-8", this.writePos, this.capacity);
    const part2 = this.buffer.toString("utf-8", 0, this.writePos);
    return part1 + part2;
  }
}

/**
 * Parses Vitest summary line from string.
 */
export function parseVitestSummary(logContent: string): {
  filesTotal: number;
  filesPassed: number;
  filesFailed: number;
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
} | undefined {
  const cleanLog = logContent.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

  const testFileRegex = /Test Files\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+passed\s*\((\d+)\)|(\d+)\s+passed)/i;
  const testsRegex = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+passed\s*(?:\|\s*(\d+)\s+skipped)?\s*\((\d+)\)|(\d+)\s+passed(?:\s*\((\d+)\))?)/i;

  const testMatch = cleanLog.match(testsRegex);
  if (!testMatch) {
    return undefined;
  }

  let testsFailed = 0;
  let testsPassed = 0;
  let testsSkipped = 0;
  let testsTotal = 0;

  if (testMatch[1]) {
    testsFailed = parseInt(testMatch[1], 10);
  }
  if (testMatch[2]) {
    testsPassed = parseInt(testMatch[2], 10);
  } else if (testMatch[5]) {
    testsPassed = parseInt(testMatch[5], 10);
  }
  if (testMatch[3]) {
    testsSkipped = parseInt(testMatch[3], 10);
  }
  if (testMatch[4]) {
    testsTotal = parseInt(testMatch[4], 10);
  } else if (testMatch[6]) {
    testsTotal = parseInt(testMatch[6], 10);
  } else {
    testsTotal = testsFailed + testsPassed + testsSkipped;
  }

  let filesFailed = 0;
  let filesPassed = 0;
  let filesTotal = 0;

  const fileMatch = cleanLog.match(testFileRegex);
  if (fileMatch) {
    if (fileMatch[1]) filesFailed = parseInt(fileMatch[1], 10);
    if (fileMatch[2]) filesPassed = parseInt(fileMatch[2], 10);
    else if (fileMatch[4]) filesPassed = parseInt(fileMatch[4], 10);
    if (fileMatch[3]) filesTotal = parseInt(fileMatch[3], 10);
    else filesTotal = filesFailed + filesPassed;
  }

  return {
    filesTotal,
    filesPassed,
    filesFailed,
    testsTotal,
    testsPassed,
    testsFailed,
    testsSkipped,
  };
}

/**
 * Validates gate execution outputs fail-closed.
 * Rejects exit 0 with empty or truncated logs, mismatched counts, or unverified Vitest summaries.
 */
export function validateGateOutput(
  gate: GateDefinition,
  exitCode: number,
  tailText: string,
  logSizeBytes: number,
  maxLogBytes: number = DEFAULT_MAX_LOG_BYTES
): {
  pass: boolean;
  status: GateResult["status"];
  metrics?: GateResult["testMetrics"];
  error?: string;
} {
  if (logSizeBytes > maxLogBytes) {
    return {
      pass: false,
      status: "TRUNCATED_FAIL",
      error: `Log output size (${logSizeBytes} bytes) exceeded maximum cap (${maxLogBytes} bytes).`,
    };
  }

  if (gate.isVitest) {
    const metrics = parseVitestSummary(tailText);

    if (!metrics) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        error: `Vitest gate exited with code ${exitCode} but summary metrics could not be parsed from tail log.`,
      };
    }

    if (metrics.testsTotal === 0) {
      return {
        pass: false,
        status: "ENGINEERING_FAIL",
        metrics,
        error: `Vitest gate reported 0 total tests executed. Vacuous pass is rejected.`,
      };
    }

    if (metrics.testsFailed > 0 || exitCode !== 0) {
      return {
        pass: false,
        status: "FAIL",
        metrics,
        error: `Vitest tests failed: ${metrics.testsFailed} failed out of ${metrics.testsTotal} total (exit code: ${exitCode}).`,
      };
    }

    return {
      pass: true,
      status: "PASS",
      metrics,
    };
  }

  // Non-vitest commands
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

/**
 * Verifies Git working tree and HEAD integrity.
 */
export function verifyWorktreeIntegrity(
  expectedHeadSha: string,
  expectedTreeSha: string
): { valid: boolean; reason?: string; currentHead: string; currentTree: string } {
  try {
    const currentHead = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    const currentTree = execSync("git rev-parse HEAD^{tree}", { encoding: "utf-8" }).trim();

    if (currentHead !== expectedHeadSha) {
      return {
        valid: false,
        reason: `HEAD_MUTATED: Expected HEAD ${expectedHeadSha}, but found ${currentHead}`,
        currentHead,
        currentTree,
      };
    }

    if (currentTree !== expectedTreeSha) {
      return {
        valid: false,
        reason: `TREE_MUTATED: Expected Tree ${expectedTreeSha}, but found ${currentTree}`,
        currentHead,
        currentTree,
      };
    }

    const dirtyCheck = execSync("git status --porcelain=v1", { encoding: "utf-8" }).trim();
    // Reports, backtest acceptance artifacts, and test fixture imports do not invalidate the code tree
    const codeModifications = dirtyCheck
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.includes("reports/kh02/") &&
          !line.includes("acceptance/") &&
          !line.includes("data/google_trends_imports/")
      );

    if (codeModifications.length > 0) {
      return {
        valid: false,
        reason: `WORKING_TREE_MUTATED: Untracked or modified code files detected during test execution: ${codeModifications.join(", ")}`,
        currentHead,
        currentTree,
      };
    }

    return { valid: true, currentHead, currentTree };
  } catch (err: any) {
    return {
      valid: false,
      reason: `GIT_INSPECTION_FAILED: ${err?.message || String(err)}`,
      currentHead: "UNKNOWN",
      currentTree: "UNKNOWN",
    };
  }
}

/**
 * Runs a single gate asynchronously with detached process group, streaming log, tail buffer, and byte cap.
 */
export async function runSingleGate(gate: GateDefinition): Promise<GateResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  fs.mkdirSync(CANONICAL_LOG_DIR, { recursive: true });
  const logFilePath = path.join(CANONICAL_LOG_DIR, gate.logFile);
  const logStream = fs.createWriteStream(logFilePath, { flags: "w", encoding: "utf-8" });

  const maxLogBytes = gate.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
  let logSizeBytes = 0;
  let truncated = false;
  const tailBuffer = new TailRingBuffer(TAIL_RING_BUFFER_BYTES);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    CI: "1",
    NODE_ENV: "test",
    VITEST_MAX_WORKERS: "4",
  };

  console.log(`[GATE START] ${gate.id}: ${gate.name}`);
  console.log(`  Command: ${gate.command}`);
  console.log(`  Log: ${logFilePath}`);

  return new Promise<GateResult>((resolve) => {
    let child: ChildProcess | null = null;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.error(`[GATE TIMEOUT] ${gate.id} exceeded limit of ${gate.timeoutMs}ms.`);
      if (child && child.pid) {
        killProcessGroup(child.pid);
      }
    }, gate.timeoutMs);

    try {
      child = spawn(gate.command, [], {
        shell: true,
        detached: true, // Creates a separate process group
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      logStream.end();
      return resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: -1,
        pass: false,
        durationMs: Date.now() - startTime,
        logFile: gate.logFile,
        logSha256: crypto.createHash("sha256").digest("hex"),
        logSizeBytes: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        error: `Failed to spawn gate process: ${err?.message || err}`,
        status: "FAIL",
      });
    }

    if (!child) {
      clearTimeout(timeoutHandle);
      logStream.end();
      return resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: -1,
        pass: false,
        durationMs: Date.now() - startTime,
        logFile: gate.logFile,
        logSha256: crypto.createHash("sha256").digest("hex"),
        logSizeBytes: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        error: "Child process could not be initialized.",
        status: "FAIL",
      });
    }

    const onChunk = (chunk: Buffer) => {
      if (truncated) return;
      logSizeBytes += chunk.length;
      if (logSizeBytes > maxLogBytes) {
        truncated = true;
        console.error(`[GATE LOG OVERFLOW] ${gate.id} exceeded log cap (${maxLogBytes} bytes). Terminating.`);
        if (child && child.pid) {
          killProcessGroup(child.pid);
        }
        return;
      }
      logStream.write(chunk);
      tailBuffer.append(chunk);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      logStream.end();

      const durationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();

      let logSha256 = "";
      let actualSizeBytes = 0;
      try {
        const fileBuf = fs.readFileSync(logFilePath);
        actualSizeBytes = fileBuf.length;
        logSha256 = crypto.createHash("sha256").update(fileBuf).digest("hex");
      } catch (_) {}

      const tailText = tailBuffer.toString();

      if (timedOut) {
        return resolve({
          gateId: gate.id,
          name: gate.name,
          command: gate.command,
          exitCode: -1,
          pass: false,
          durationMs,
          logFile: gate.logFile,
          logSha256,
          logSizeBytes: actualSizeBytes,
          startedAt,
          completedAt,
          error: `Process timed out after ${gate.timeoutMs}ms (signal: ${signal})`,
          status: "ABORTED",
        });
      }

      if (truncated) {
        return resolve({
          gateId: gate.id,
          name: gate.name,
          command: gate.command,
          exitCode: -1,
          pass: false,
          durationMs,
          logFile: gate.logFile,
          logSha256,
          logSizeBytes: actualSizeBytes,
          startedAt,
          completedAt,
          error: `Log output exceeded ${maxLogBytes} bytes. Fail-closed TRUNCATED_FAIL triggered.`,
          status: "TRUNCATED_FAIL",
        });
      }

      const effectiveExit = code !== null ? code : -1;
      const validation = validateGateOutput(gate, effectiveExit, tailText, actualSizeBytes, maxLogBytes);

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
        logSha256,
        logSizeBytes: actualSizeBytes,
        startedAt,
        completedAt,
        testMetrics: validation.metrics,
        error: validation.error,
        status: validation.status,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
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
  try {
    process.kill(-pid, "SIGTERM");
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (_) {}
    }, 2000).unref();
  } catch (_) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {}
  }
}

export function createSkippedGateResult(gate: GateDefinition, reason: string): GateResult {
  const ts = new Date().toISOString();
  return {
    gateId: gate.id,
    name: gate.name,
    command: gate.command,
    exitCode: -1,
    pass: false,
    durationMs: 0,
    logFile: gate.logFile,
    logSha256: crypto.createHash("sha256").digest("hex"),
    logSizeBytes: 0,
    startedAt: ts,
    completedAt: ts,
    error: `Skipped: ${reason}`,
    status: "SKIPPED_DEPENDENCY",
  };
}

/**
 * Main DAG gate orchestrator.
 */
export async function runAllGates(): Promise<{
  allPassed: boolean;
  totalDurationMs: number;
  results: GateResult[];
  commitSha: string;
  treeSha: string;
  branch: string;
}> {
  const suiteStartTime = Date.now();
  console.log("=== KH-02 V19.3.2.6 FAIL-CLOSED DETERMINISTIC BOUNDED ASYNC GATES ===");

  const commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  const treeSha = execSync("git rev-parse HEAD^{tree}", { encoding: "utf-8" }).trim();
  const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();

  console.log(`Repository HEAD: ${commitSha}`);
  console.log(`Repository Tree: ${treeSha}`);
  console.log(`Current Branch:  ${branch}`);

  const resultMap = new Map<string, GateResult>();

  // --------------------------------------------------------------------------
  // WAVE 1 RESOURCE SAFETY & PRE-CHECKS (E1, E2 in parallel)
  // --------------------------------------------------------------------------
  const safety1 = checkResourceSafety();
  if (!safety1.safe) {
    console.error(`!!! WAVE 1 RESOURCE GUARD FAILED: ${safety1.reason}`);
    for (const id of Object.keys(GATES)) {
      resultMap.set(id, createSkippedGateResult(GATES[id], safety1.reason!));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  console.log(`Resource safety OK: ${safety1.freeDiskGb.toFixed(2)} GB disk, ${safety1.freeMemMb.toFixed(2)} MB RAM`);
  console.log("\n--- WAVE 1: Executing E1 & E2 concurrently ---");

  const [e1Result, e2Result] = await Promise.all([runSingleGate(GATES.E1), runSingleGate(GATES.E2)]);
  resultMap.set("E1", e1Result);
  resultMap.set("E2", e2Result);

  if (!e1Result.pass || !e2Result.pass) {
    console.error("!!! WAVE 1 FAILURE: E1 or E2 failed. Fast fail-closed cancellation triggered.");
    for (const id of ["E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10"]) {
      resultMap.set(id, createSkippedGateResult(GATES[id], "Pre-check gate E1 or E2 failed."));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  // --------------------------------------------------------------------------
  // WAVE 2 RESOURCE SAFETY & TARGETED CI ADVERSARIAL GATE (E3)
  // --------------------------------------------------------------------------
  const safety2 = checkResourceSafety();
  if (!safety2.safe) {
    console.error(`!!! WAVE 2 RESOURCE GUARD FAILED: ${safety2.reason}`);
    for (const id of ["E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10"]) {
      resultMap.set(id, createSkippedGateResult(GATES[id], safety2.reason!));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  console.log("\n--- WAVE 2: Executing E3 Targeted CI Trust Boundary Suite ---");
  const e3Result = await runSingleGate(GATES.E3);
  resultMap.set("E3", e3Result);

  if (!e3Result.pass) {
    console.error("!!! WAVE 2 FAILURE: Targeted CI trust boundary suite (E3) failed.");
    for (const id of ["E4", "E5", "E6", "E7", "E8", "E9", "E10"]) {
      resultMap.set(id, createSkippedGateResult(GATES[id], "Security trust boundary gate E3 failed."));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  // --------------------------------------------------------------------------
  // WAVE 3 RESOURCE SAFETY & PARALLEL EXECUTION (Max 2 child processes)
  // Concurrently: E4 (Unit) and [E6 (KH01) -> E7 (Security) -> E10 (Remote CI)]
  // Followed by Serialized DB Pipeline: E5 (Integration) -> E8 (Backtest) -> E9 (DB Readback)
  // --------------------------------------------------------------------------
  const safety3 = checkResourceSafety();
  if (!safety3.safe) {
    console.error(`!!! WAVE 3 RESOURCE GUARD FAILED: ${safety3.reason}`);
    for (const id of ["E4", "E5", "E6", "E7", "E8", "E9", "E10"]) {
      resultMap.set(id, createSkippedGateResult(GATES[id], safety3.reason!));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  console.log("\n--- WAVE 3: Executing E4 concurrently with non-DB gates (E6, E7, E10) (concurrency 2) ---");

  const runUnitStream = async () => {
    const e4 = await runSingleGate(GATES.E4);
    resultMap.set("E4", e4);
  };

  const runNonDbStream = async () => {
    const e6 = await runSingleGate(GATES.E6);
    resultMap.set("E6", e6);

    const e7 = await runSingleGate(GATES.E7);
    resultMap.set("E7", e7);

    const e10 = await runSingleGate(GATES.E10);
    resultMap.set("E10", e10);
  };

  await Promise.all([runUnitStream(), runNonDbStream()]);

  const e4Pass = resultMap.get("E4")?.pass;
  if (!e4Pass) {
    console.error("!!! E4 unit test suite failed. Skipping DB pipeline.");
    for (const id of ["E5", "E8", "E9"]) {
      resultMap.set(id, createSkippedGateResult(GATES[id], "E4 unit test suite failed."));
    }
    return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
  }

  console.log("\n--- Executing Serialized Database Pipeline (E5 -> E8 -> E9) ---");
  const e5 = await runSingleGate(GATES.E5);
  resultMap.set("E5", e5);

  const e8 = await runSingleGate(GATES.E8);
  resultMap.set("E8", e8);

  const e9 = await runSingleGate(GATES.E9);
  resultMap.set("E9", e9);

  // Check post-execution Git tree non-mutation
  const worktreeCheck = verifyWorktreeIntegrity(commitSha, treeSha);
  if (!worktreeCheck.valid) {
    console.error(`!!! CRITICAL WORKTREE MUTATION: ${worktreeCheck.reason}`);
    // Demote passing gates to ENGINEERING_FAIL if tree was mutated
    for (const [id, r] of resultMap.entries()) {
      if (r.pass) {
        resultMap.set(id, {
          ...r,
          pass: false,
          status: "ENGINEERING_FAIL",
          error: worktreeCheck.reason,
        });
      }
    }
  }

  return finishSummary(resultMap, suiteStartTime, commitSha, treeSha, branch);
}

function finishSummary(
  resultMap: Map<string, GateResult>,
  suiteStartTime: number,
  commitSha: string,
  treeSha: string,
  branch: string
) {
  const totalDurationMs = Date.now() - suiteStartTime;
  const orderedIds = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10"];
  const orderedResults = orderedIds.map((id) => resultMap.get(id)!);

  const allPassed = orderedResults.every((r) => r && r.pass);

  const summary = {
    version: "12.4.3.7.19.3.2.6",
    commitSha,
    treeSha,
    branch,
    allPassed,
    completedGates: orderedResults.filter((r) => r && r.status === "PASS").length,
    totalGates: orderedIds.length,
    totalDurationMs,
    generatedAt: new Date().toISOString(),
    results: orderedResults,
  };

  fs.mkdirSync(CANONICAL_LOG_DIR, { recursive: true });
  const summaryPath = path.join(CANONICAL_LOG_DIR, "gates_summary.json");
  const tmpPath = `${summaryPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, summaryPath);

  console.log("\n=== ALL GATES FINISHED ===");
  console.log(`Status: ${allPassed ? "ALL PASSED" : "FAILED"}`);
  console.log(`Total Wall-Time: ${(totalDurationMs / 1000).toFixed(2)}s`);
  console.log(`Completed ${summary.completedGates} of ${summary.totalGates} gates.`);

  return {
    allPassed,
    totalDurationMs,
    results: orderedResults,
    commitSha,
    treeSha,
    branch,
  };
}

if (require.main === module || process.argv[1]?.endsWith("runV19_3_2_6Gates.ts")) {
  runAllGates()
    .then((res) => {
      process.exit(res.allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error("Runner fatal exception:", err);
      process.exit(1);
    });
}
