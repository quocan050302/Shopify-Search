/**
 * SWAI V11 — MetaAdsCollector Configuration Resolver
 *
 * Reads configuration from environment with secure, reproducible defaults.
 * Automatically resolves Python binary path inside the project-specific virtual environment
 * on both macOS/Linux (bin/python) and Windows (Scripts/python.exe).
 */

import path from "path";
import fs from "fs";

export interface MetaCollectorConfig {
  enabled: boolean;
  pythonBin: string;
  dataDir: string;
  defaultCountry: string;
  maxResults: number;
  maxRequests: number;
  maxSeconds: number;
  maxConcurrency: number;
  liveTestEnabled: boolean;
}

export function resolvePythonBinary(customPath?: string): string {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  const projectRoot = process.cwd();
  const venvDir = path.join(projectRoot, "services", "meta-ads-collector", ".venv");

  // Check Posix (macOS / Linux)
  const posixBin = path.join(venvDir, "bin", "python");
  if (fs.existsSync(posixBin)) {
    return posixBin;
  }

  // Check Windows
  const winBin = path.join(venvDir, "Scripts", "python.exe");
  if (fs.existsSync(winBin)) {
    return winBin;
  }

  // Fallback to system python3 / python if in PATH
  return process.platform === "win32" ? "python.exe" : "python3";
}

export function resolveDataDir(customPath?: string): string {
  if (customPath) {
    const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), customPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
  }

  const defaultDir = path.join(process.cwd(), "services", "meta-ads-collector", "data");
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

export function getMetaCollectorConfig(): MetaCollectorConfig {
  const enabled = process.env.META_COLLECTOR_ENABLED !== "false";
  const pythonBin = resolvePythonBinary(process.env.META_COLLECTOR_PYTHON_BIN);
  const dataDir = resolveDataDir(process.env.META_COLLECTOR_DATA_DIR);
  const defaultCountry = (process.env.META_COLLECTOR_COUNTRY || "US").toUpperCase();
  const maxResults = Math.min(100, Math.max(1, parseInt(process.env.META_COLLECTOR_MAX_RESULTS || "25", 10)));
  const maxRequests = Math.min(50, Math.max(1, parseInt(process.env.META_COLLECTOR_MAX_REQUESTS || "10", 10)));
  const maxSeconds = Math.min(600, Math.max(10, parseInt(process.env.META_COLLECTOR_MAX_SECONDS || "300", 10)));
  const maxConcurrency = Math.min(4, Math.max(1, parseInt(process.env.META_COLLECTOR_MAX_CONCURRENCY || "1", 10)));
  const liveTestEnabled = process.env.META_COLLECTOR_LIVE_TEST_ENABLED === "true";

  return {
    enabled,
    pythonBin,
    dataDir,
    defaultCountry,
    maxResults,
    maxRequests,
    maxSeconds,
    maxConcurrency,
    liveTestEnabled,
  };
}
