/**
 * SWAI KH-02 — Runtime Version Diagnostics Service (Phase 1 / Section 4.3)
 *
 * Provides non-sensitive runtime build, git revision, and process diagnostics
 * to ensure server-worker-bundle parity across local and staging deployments.
 */

import { execSync } from "child_process";

export interface RuntimeVersionInfo {
  buildSha: string | null;
  buildTimestamp: string | null;
  appVersion: string;
  workerVersion: string | null;
  environment: string;
}

let cachedBuildSha: string | null = null;

export function getRuntimeBuildSha(): string | null {
  if (cachedBuildSha) return cachedBuildSha;
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  if (process.env.NEXT_PUBLIC_GIT_COMMIT_SHA) return process.env.NEXT_PUBLIC_GIT_COMMIT_SHA;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;

  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 2000 }).trim();
    cachedBuildSha = sha;
    return sha;
  } catch {
    return null;
  }
}

export function getRuntimeVersionInfo(workerVersion?: string | null): RuntimeVersionInfo {
  return {
    buildSha: getRuntimeBuildSha(),
    buildTimestamp: process.env.BUILD_TIMESTAMP || process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || null,
    appVersion: "12.3.2",
    workerVersion: workerVersion || "12.3.2",
    environment: process.env.NODE_ENV || "development",
  };
}
