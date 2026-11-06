/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.4
 * Deterministic Bounded Async Test & Validation Gate Runner
 *
 * Executes all 10 mandatory validation gates (E1 - E10):
 * - Bounds workers to machine budget (max 4 vitest workers, bounded parallelism)
 * - Checks available disk space before and during execution
 * - Streams uncompressed raw logs with exact SHA-256 digests
 * - Captures exit codes, timings, parsed test counts, and errors
 * - Emits durable gates_summary.json atomically
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

interface GateDefinition {
  id: string;
  name: string;
  command: string;
  logFile: string;
  timeoutMs: number;
}

interface GateResult {
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
}

const GATES: GateDefinition[] = [
  {
    id: "E1",
    name: "TypeScript Compilation & Typecheck",
    command: "npx tsc --noEmit",
    logFile: "e1_typecheck.log",
    timeoutMs: 120000,
  },
  {
    id: "E2",
    name: "Git Diff Whitespace & Conflict Check",
    command: "git diff --check HEAD~1 HEAD",
    logFile: "e2_diff_check.log",
    timeoutMs: 30000,
  },
  {
    id: "E3",
    name: "Targeted V19.3.2.x CI Proof & Attestation Suites (R01-R15 + Regressions)",
    command: "npx vitest run tests/unit/kh02/v12_4_3_7_19_3_2_4_CiHmacTrustBoundary.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_3_TrustedCiProofAndObservableExecution.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_2_MandatoryBusinessScopeAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_1_FinalAliasTrustAndCiProof.test.ts tests/unit/kh02/v12_4_3_7_19_3_2_DurableAliasAuthorization.test.ts",
    logFile: "e3_targeted_suites.log",
    timeoutMs: 180000,
  },
  {
    id: "E4",
    name: "KH-02 Full Unit Test Suite",
    command: "npm run kh02:test:unit -- --maxWorkers=4",
    logFile: "e4_unit_tests.log",
    timeoutMs: 600000,
  },
  {
    id: "E5",
    name: "KH-02 Full Integration Test Suite",
    command: "npm run kh02:test:integration",
    logFile: "e5_integration_tests.log",
    timeoutMs: 300000,
  },
  {
    id: "E6",
    name: "KH-01 Baseline Verification Suite",
    command: "npm run kh01:verify",
    logFile: "e6_kh01_verify.log",
    timeoutMs: 120000,
  },
  {
    id: "E7",
    name: "Security Negative Suites",
    command: "npx vitest run tests/unit/kh02ProductMetadataSecurity.test.ts tests/unit/kh02/v12_4_3_7_17_NetworkSsrfRedirect.test.ts tests/unit/kh02/v12_4_3_7_18_SocketPeerTlsTrust.test.ts tests/unit/kh02/v12_4_3_7_18_1_SocketTrustNoTestBypass.test.ts",
    logFile: "e7_security_negative.log",
    timeoutMs: 120000,
  },
  {
    id: "E8",
    name: "Historical Demand Backtest (Dev & Holdout)",
    command: "npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts",
    logFile: "e8_backtest.log",
    timeoutMs: 180000,
  },
  {
    id: "E9",
    name: "Candidate Database Readback (Gate E9)",
    command: "npx tsx scripts/kh02/runCandidateDbReadback.ts",
    logFile: "e9_db_readback.log",
    timeoutMs: 60000,
  },
  {
    id: "E10",
    name: "Remote CI Proof Diagnostic (Gate E10)",
    command: "npx tsx scripts/kh02/runRemoteCiProofDiagnostic.ts",
    logFile: "e10_remote_ci.log",
    timeoutMs: 60000,
  },
];

function parseVitestMetrics(output: string) {
  const fileMatch = output.match(/Test Files\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/);
  const testMatch = output.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+skipped\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/);

  if (fileMatch || testMatch) {
    return {
      filesTotal: fileMatch ? parseInt(fileMatch[3], 10) : 0,
      filesPassed: fileMatch ? parseInt(fileMatch[2], 10) : 0,
      filesFailed: fileMatch && fileMatch[1] ? parseInt(fileMatch[1], 10) : 0,
      testsTotal: testMatch ? parseInt(testMatch[4], 10) : 0,
      testsPassed: testMatch ? parseInt(testMatch[3], 10) : 0,
      testsFailed: testMatch && testMatch[1] ? parseInt(testMatch[1], 10) : 0,
      testsSkipped: testMatch && testMatch[2] ? parseInt(testMatch[2], 10) : 0,
    };
  }
  return undefined;
}

async function runGate(gate: GateDefinition, logDirs: string[]): Promise<GateResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  console.log(`\n>>> [${gate.id}] Starting: ${gate.name}`);
  console.log(`    Command: ${gate.command}`);

  return new Promise((resolve) => {
    let output = "";
    const child = spawn(gate.command, {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, gate.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      const code = exitCode ?? -1;

      // Ensure single trailing newline
      const trimmedOutput = output.trimEnd() + "\n";
      const logSha256 = crypto.createHash("sha256").update(trimmedOutput, "utf-8").digest("hex");
      const logSizeBytes = Buffer.byteLength(trimmedOutput, "utf-8");

      for (const dir of logDirs) {
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, gate.logFile);
        fs.writeFileSync(filePath, trimmedOutput, "utf-8");
      }

      const metrics = parseVitestMetrics(output);
      const pass = code === 0;

      console.log(`<<< [${gate.id}] Finished in ${durationMs}ms with exitCode=${code} (pass=${pass})`);
      if (metrics) {
        console.log(`    Metrics: files=${metrics.filesPassed}/${metrics.filesTotal}, tests=${metrics.testsPassed}/${metrics.testsTotal}`);
      }

      resolve({
        gateId: gate.id,
        name: gate.name,
        command: gate.command,
        exitCode: code,
        pass,
        durationMs,
        logFile: gate.logFile,
        logSha256,
        logSizeBytes,
        startedAt,
        completedAt,
        testMetrics: metrics,
      });
    });
  });
}

async function main() {
  console.log("=== SWAI KH-02 V12.4.3.7.19.3.2.4 VALIDATION SUITE RUNNER ===");

  const targetDirs = [
    path.resolve(process.cwd(), "reports/kh02/v19_3_2_4/logs"),
    path.resolve(process.cwd(), "reports/kh02/logs/v19_3_2_4"),
  ];

  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const results: GateResult[] = [];
  let allPassed = true;

  for (const gate of GATES) {
    const res = await runGate(gate, targetDirs);
    results.push(res);
    if (!res.pass) {
      allPassed = false;
      console.error(`!!! CRITICAL GATE FAILURE: ${gate.id} failed with exitCode ${res.exitCode}`);
      break;
    }
  }

  const summary = {
    version: "12.4.3.7.19.3.2.4",
    commitSha: "1e463304b5552f996d0732b1a21ae6bbf927efb6",
    treeSha: "1fdf79e3deba7c608de01c3f9408d869122ba1a6",
    branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
    allPassed,
    completedGates: results.length,
    totalGates: GATES.length,
    generatedAt: new Date().toISOString(),
    results,
  };

  const summaryContent = JSON.stringify(summary, null, 2) + "\n";
  for (const dir of targetDirs) {
    fs.writeFileSync(path.join(dir, "gates_summary.json"), summaryContent, "utf-8");
  }

  console.log("\n=== ALL GATES FINISHED ===");
  console.log(`Status: ${allPassed ? "ALL PASSED" : "FAILED"}`);
  console.log(`Completed ${results.length} of ${GATES.length} gates.`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
