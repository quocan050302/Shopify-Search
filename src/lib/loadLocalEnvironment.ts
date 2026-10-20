/**
 * SWAI V9.2 — Local Environment Loader & Environment Validator
 *
 * Implements standard Next.js-compatible environment loading using @next/env.
 * Ensures that `.env.local`, `.env.development.local`, `.env.development`, and `.env`
 * are loaded with exact Next.js precedence rules in all CLI scripts and background workers.
 *
 * Precedence:
 * Shell process.env > .env.development.local / .env.local > .env.development > .env
 */

import { loadEnvConfig } from "@next/env";

export interface EnvironmentLoadResult {
  loadedFiles: string[];
  loadedSuccessfully: boolean;
  projectDir: string;
}

export interface EnvironmentValidationReport {
  loadedFiles: string[];
  databaseConfigured: boolean;
  freeDiscoveryMode: boolean;
  tiktokCookieConfigured: boolean;
  apifyTokenConfigured: boolean;
  enableApifyDiscovery: boolean;
  geminiKeyConfigured: boolean;
  metaTokenConfigured: boolean;
  nodeEnv: string;
}

let hasLoaded = false;
let cachedResult: EnvironmentLoadResult = {
  loadedFiles: [],
  loadedSuccessfully: false,
  projectDir: "",
};

/**
 * Loads local environment variables using Next.js canonical environment resolution.
 * Idempotent: safe to call multiple times without side effects.
 */
export function loadLocalEnvironment(customDir?: string): EnvironmentLoadResult {
  if (hasLoaded && !customDir) {
    return cachedResult;
  }

  const projectDir = customDir || process.cwd();
  const isDev = process.env.NODE_ENV !== "production";

  try {
    const res = loadEnvConfig(projectDir, isDev, {
      info: () => {},
      error: (msg: string) => console.error(`[EnvLoader Error] ${msg}`),
    });

    const loadedFiles = (res.loadedEnvFiles || []).map((f) => f.path);
    hasLoaded = true;
    cachedResult = {
      loadedFiles,
      loadedSuccessfully: true,
      projectDir,
    };
    return cachedResult;
  } catch (err) {
    console.warn(`[EnvLoader] Notice: Could not load via @next/env:`, err);
    cachedResult = {
      loadedFiles: [],
      loadedSuccessfully: false,
      projectDir,
    };
    return cachedResult;
  }
}

/**
 * Validates the discovery environment and returns a safe diagnostic report
 * without ever exposing or printing sensitive secret values.
 */
export function validateDiscoveryEnvironment(): EnvironmentValidationReport {
  // Ensure environment is loaded first
  loadLocalEnvironment();

  const tiktokCookie = process.env.TIKTOK_CC_COOKIE;
  const apifyToken = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const metaToken = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  return {
    loadedFiles: cachedResult.loadedFiles,
    databaseConfigured: Boolean(dbUrl && dbUrl.trim().length > 0),
    freeDiscoveryMode: process.env.FREE_DISCOVERY_MODE === "true" || process.env.FREE_DISCOVERY_MODE === undefined,
    tiktokCookieConfigured: Boolean(tiktokCookie && tiktokCookie.trim().length > 0),
    apifyTokenConfigured: Boolean(apifyToken && apifyToken.trim().length > 0),
    enableApifyDiscovery: process.env.ENABLE_APIFY_DISCOVERY === "true",
    geminiKeyConfigured: Boolean(geminiKey && geminiKey.trim().length > 0),
    metaTokenConfigured: Boolean(metaToken && metaToken.trim().length > 0),
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

// Automatically bootstrap environment upon import
loadLocalEnvironment();
