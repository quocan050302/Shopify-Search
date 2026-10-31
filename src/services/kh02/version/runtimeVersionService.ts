/**
 * SWAI KH-02 V12.4.1 — Runtime Version & Build Parity Service (Section 3)
 *
 * Provides non-sensitive runtime build, compile-time frontend bundle SHA,
 * backend SHA, worker SHA, database fingerprint, and parity diagnostics
 * to guarantee server-worker-bundle alignment across local and staging runs.
 */

import { execSync } from "child_process";
import crypto from "crypto";
import path from "path";

export const SWAI_KH02_RELEASE_VERSION: string = "12.4.3.4.4";

export type KH02RuntimeParityStatus =
  | "MATCHED"
  | "VERSION_MISMATCH"
  | "WORKER_OFFLINE"
  | "UNKNOWN";

export interface KH02RuntimeIdentity {
  releaseVersion: string;
  frontendBuildSha: string | null;
  backendBuildSha: string | null;
  workerBuildSha: string | null;
  sourceRevisionSha?: string | null;
  buildRevisionSha?: string | null;
  backendBootSha?: string | null;
  workerBootSha?: string | null;
  databaseFingerprint?: string;

  backendStartedAt: string;
  workerStartedAt: string | null;

  appProcessId?: number;
  workerProcessId?: number;

  dbFingerprint?: string;
  workerDbFingerprint?: string | null;
  conflictingWorkersDetected?: boolean;
  diagnostics?: string[];

  runtimeStatus: KH02RuntimeParityStatus;

  // Backwards-compatible fields
  buildSha: string | null;
  buildTimestamp: string | null;
  appVersion: string;
  workerVersion: string | null;
  environment: string;
}

export type RuntimeVersionInfo = KH02RuntimeIdentity;

const PROCESS_STARTED_AT = new Date().toISOString();

function resolveGitCommitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

const PROCESS_BOOT_SHA: string | null =
  process.env.SWAI_BUILD_SHA ||
  process.env.GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_SWAI_FRONTEND_BUILD_SHA ||
  process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  resolveGitCommitSha();

export function getRuntimeBuildSha(): string | null {
  if (process.env.SWAI_BUILD_SHA) return process.env.SWAI_BUILD_SHA;
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  return PROCESS_BOOT_SHA || resolveGitCommitSha();
}

export function getCurrentRepoHeadSha(): string | null {
  return resolveGitCommitSha();
}

export function getCompileTimeFrontendSha(): string | null {
  const envSha =
    process.env.NEXT_PUBLIC_SWAI_FRONTEND_BUILD_SHA ||
    process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
    process.env.SWAI_BUILD_SHA;
  if (envSha && envSha !== "unknown") {
    return envSha;
  }
  return PROCESS_BOOT_SHA;
}

/**
 * Computes a non-sensitive 12-character SHA-256 fingerprint of the resolved SQLite database target.
 * Never exposes filesystem paths or credentials.
 */
export function getDatabaseFingerprint(rawUrl?: string): string {
  const url = rawUrl || process.env.DATABASE_URL || "file:./dev.db";
  let normalized = url.trim();
  if (normalized.startsWith("file:")) {
    const filePart = normalized.slice("file:".length).split("?")[0];
    const absPath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePart);
    normalized = absPath.replace(/\\/g, "/").toLowerCase();
  }
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

export function shasMatch(shaA: string | null | undefined, shaB: string | null | undefined): boolean {
  if (!shaA || !shaB) return false;
  const cleanA = shaA.trim().toLowerCase();
  const cleanB = shaB.trim().toLowerCase();
  if (cleanA === cleanB) return true;
  const minLen = Math.min(cleanA.length, cleanB.length);
  if (minLen >= 7) {
    return cleanA.slice(0, minLen) === cleanB.slice(0, minLen);
  }
  return false;
}

export interface WorkerRuntimeSnapshot {
  workerOnline: boolean;
  workerId?: string | null;
  workerVersion?: string | null;
  workerBuildSha?: string | null;
  workerStartedAt?: string | null;
  workerProcessId?: number | null;
  workerDbFingerprint?: string | null;
  conflictingWorkerIds?: string[];
}

export interface EvaluateRuntimeIdentityOptions {
  frontendBuildSha?: string | null;
  frontendVersion?: string | null;
  backendBuildSha?: string | null;
  worker?: WorkerRuntimeSnapshot | null;
  dbFingerprint?: string;
  includeProcessIds?: boolean;
}

export function evaluateKH02RuntimeIdentity(
  options: EvaluateRuntimeIdentityOptions = {}
): KH02RuntimeIdentity {
  const releaseVersion = SWAI_KH02_RELEASE_VERSION;
  const backendBuildSha =
    options.backendBuildSha !== undefined ? options.backendBuildSha : getRuntimeBuildSha();
  const frontendBuildSha =
    options.frontendBuildSha !== undefined
      ? options.frontendBuildSha
      : getCompileTimeFrontendSha();
  const dbFingerprint = options.dbFingerprint || getDatabaseFingerprint();
  const currentHeadSha = getCurrentRepoHeadSha();

  const worker = options.worker;
  const workerOnline = worker?.workerOnline ?? false;
  const workerBuildSha = worker?.workerBuildSha ?? null;
  const workerVersion = worker?.workerVersion ?? null;
  const workerStartedAt = worker?.workerStartedAt ?? null;
  const workerDbFingerprint = worker?.workerDbFingerprint ?? null;
  const conflictingWorkers = (worker?.conflictingWorkerIds?.length || 0) > 0;

  const diagnostics: string[] = [];
  let runtimeStatus: KH02RuntimeParityStatus = "MATCHED";

  if (!backendBuildSha && !frontendBuildSha) {
    runtimeStatus = "UNKNOWN";
    diagnostics.push("Build SHA could not be determined for frontend or backend.");
  }

  if (options.frontendVersion && options.frontendVersion !== releaseVersion) {
    runtimeStatus = "VERSION_MISMATCH";
    diagnostics.push(
      `Frontend release version (${options.frontendVersion}) does not match backend release version (${releaseVersion}).`
    );
  }

  if (frontendBuildSha && backendBuildSha && !shasMatch(frontendBuildSha, backendBuildSha)) {
    runtimeStatus = "VERSION_MISMATCH";
    diagnostics.push(
      `Frontend bundle SHA (${frontendBuildSha.slice(0, 7)}) does not match backend build SHA (${backendBuildSha.slice(0, 7)}).`
    );
  }

  if (currentHeadSha && backendBuildSha && !shasMatch(currentHeadSha, backendBuildSha)) {
    runtimeStatus = "VERSION_MISMATCH";
    diagnostics.push(
      `Backend process booted on stale SHA (${backendBuildSha.slice(0, 7)}) while repository HEAD is (${currentHeadSha.slice(0, 7)}).`
    );
  }

  if (worker !== undefined && worker !== null) {
    if (!workerOnline) {
      if (runtimeStatus !== "VERSION_MISMATCH") {
        runtimeStatus = "WORKER_OFFLINE";
      }
      diagnostics.push("KH-02 background worker is offline or its heartbeat is stale.");
    } else {
      if (workerVersion && workerVersion !== releaseVersion) {
        runtimeStatus = "VERSION_MISMATCH";
        diagnostics.push(
          `Worker release version (${workerVersion}) does not match backend release version (${releaseVersion}).`
        );
      }
      if (!workerBuildSha) {
        runtimeStatus = "VERSION_MISMATCH";
        diagnostics.push("Online worker did not report a build SHA (stale worker revision).");
      } else if (backendBuildSha && !shasMatch(backendBuildSha, workerBuildSha)) {
        runtimeStatus = "VERSION_MISMATCH";
        diagnostics.push(
          `Worker build SHA (${workerBuildSha.slice(0, 7)}) does not match backend build SHA (${backendBuildSha.slice(0, 7)}).`
        );
      }
      if (workerDbFingerprint && workerDbFingerprint !== dbFingerprint) {
        runtimeStatus = "VERSION_MISMATCH";
        diagnostics.push(
          `Worker database fingerprint (${workerDbFingerprint}) does not match backend database fingerprint (${dbFingerprint}).`
        );
      }
      if (conflictingWorkers) {
        runtimeStatus = "VERSION_MISMATCH";
        diagnostics.push(
          `Multiple conflicting active worker processes detected: ${worker?.conflictingWorkerIds?.join(", ")}.`
        );
      }
    }
  }

  if (diagnostics.length === 0 && runtimeStatus === "MATCHED") {
    diagnostics.push(
      `Frontend, backend, and worker runtime parity verified at V${releaseVersion} (${(backendBuildSha || "unknown").slice(0, 7)}).`
    );
  }

  const identity: KH02RuntimeIdentity = {
    releaseVersion,
    frontendBuildSha,
    backendBuildSha,
    workerBuildSha,
    sourceRevisionSha: currentHeadSha,
    buildRevisionSha: frontendBuildSha,
    backendBootSha: backendBuildSha,
    workerBootSha: workerBuildSha,
    databaseFingerprint: dbFingerprint,
    backendStartedAt: PROCESS_STARTED_AT,
    workerStartedAt,
    dbFingerprint,
    workerDbFingerprint,
    conflictingWorkersDetected: conflictingWorkers,
    diagnostics,
    runtimeStatus,
    // Backwards-compatible properties
    buildSha: backendBuildSha,
    buildTimestamp:
      process.env.BUILD_TIMESTAMP || process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || PROCESS_STARTED_AT,
    appVersion: releaseVersion,
    workerVersion: workerVersion || (workerOnline ? releaseVersion : null),
    environment: process.env.NODE_ENV || "development",
  };

  if (options.includeProcessIds !== false) {
    identity.appProcessId = process.pid;
    if (worker?.workerProcessId) {
      identity.workerProcessId = worker.workerProcessId;
    }
  }

  return identity;
}

export function getRuntimeVersionInfo(workerVersion?: string | null): RuntimeVersionInfo {
  const base = evaluateKH02RuntimeIdentity({
    worker: workerVersion
      ? {
          workerOnline: true,
          workerVersion,
          workerBuildSha: getRuntimeBuildSha(),
          workerStartedAt: PROCESS_STARTED_AT,
          workerDbFingerprint: getDatabaseFingerprint(),
        }
      : undefined,
  });
  if (workerVersion) {
    base.workerVersion = workerVersion;
  }
  return base;
}

