/**
 * SWAI KH-02 V12.4 — Gemini Credential Discovery & Authentication Client
 *
 * Discovers and validates existing Gemini API credentials strictly without:
 * - Printing API keys in logs or diagnostics
 * - Sending keys to frontend or persistence
 * - Incurring unauthorized paid operations
 */

import { GoogleGenAI } from "@google/genai";
import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";

loadLocalEnvironment();

export type GeminiAuthStatus =
  | "KEY_NOT_FOUND"
  | "KEY_PRESENT"
  | "AUTHENTICATED"
  | "PERMISSION_DENIED"
  | "QUOTA_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE";

export interface GeminiKeyDiagnostic {
  configured: boolean;
  variableName: string | null;
  keyLength: number;
  keyPrefix: string | null;
  authStatus: GeminiAuthStatus;
  authenticated: boolean;
  testedAt: string;
  errorMessage: string | null;
}

const SUPPORTED_ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

/**
 * Discovers configured Gemini API key without exposing secret value.
 */
export function getGeminiApiKey(): { key: string | null; sourceVar: string | null } {
  for (const varName of SUPPORTED_ENV_VARS) {
    const val = process.env[varName]?.trim();
    if (val && val.length > 5) {
      return { key: val, sourceVar: varName };
    }
  }
  return { key: null, sourceVar: null };
}

/**
 * Sanitizes any text string to strip out potential API keys.
 */
export function sanitizeGeminiSecrets(text: string): string {
  if (!text) return "";
  return text
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "AIza[REDACTED]")
    .replace(/key=[^&\s]+/gi, "key=REDACTED")
    .replace(/Bearer\s+[^&\s]+/gi, "Bearer REDACTED");
}

let cachedClient: GoogleGenAI | null = null;
let cachedKeyRef: string | null = null;

/**
 * Returns an authorized GoogleGenAI client singleton if valid key exists.
 */
export function getGoogleGenAIClient(customKey?: string): GoogleGenAI | null {
  const { key } = customKey ? { key: customKey } : getGeminiApiKey();
  if (!key) return null;

  if (cachedClient && cachedKeyRef === key) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({ apiKey: key });
  cachedKeyRef = key;
  return cachedClient;
}

/**
 * Validates actual API authentication via minimal models.list probe.
 */
export async function probeGeminiAuthentication(customKey?: string): Promise<GeminiKeyDiagnostic> {
  const { key, sourceVar } = customKey ? { key: customKey, sourceVar: "CUSTOM_ARG" } : getGeminiApiKey();

  if (!key) {
    return {
      configured: false,
      variableName: null,
      keyLength: 0,
      keyPrefix: null,
      authStatus: "KEY_NOT_FOUND",
      authenticated: false,
      testedAt: new Date().toISOString(),
      errorMessage: "No Gemini API key found in environment variables (checked GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY).",
    };
  }

  const prefix = key.length > 6 ? `${key.slice(0, 4)}...` : null;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    // Minimal non-mutating list operation to verify credential validity
    const modelList = await ai.models.list();
    // Test that iterator is consumable
    let probeCount = 0;
    for await (const _ of modelList) {
      probeCount++;
      if (probeCount >= 1) break;
    }

    return {
      configured: true,
      variableName: sourceVar,
      keyLength: key.length,
      keyPrefix: prefix,
      authStatus: "AUTHENTICATED",
      authenticated: true,
      testedAt: new Date().toISOString(),
      errorMessage: null,
    };
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    const sanitizedMsg = sanitizeGeminiSecrets(rawMsg);
    const status = err?.status || err?.code;

    let authStatus: GeminiAuthStatus = "PROVIDER_UNAVAILABLE";
    if (status === 401 || rawMsg.includes("API key not valid") || rawMsg.includes("UNAUTHENTICATED")) {
      authStatus = "PERMISSION_DENIED";
    } else if (status === 403 || rawMsg.includes("PERMISSION_DENIED")) {
      authStatus = "PERMISSION_DENIED";
    } else if (status === 429 || rawMsg.includes("RESOURCE_EXHAUSTED")) {
      authStatus = "QUOTA_UNAVAILABLE";
    } else if (status === 503 || status === 500) {
      authStatus = "PROVIDER_UNAVAILABLE";
    }

    return {
      configured: true,
      variableName: sourceVar,
      keyLength: key.length,
      keyPrefix: prefix,
      authStatus,
      authenticated: false,
      testedAt: new Date().toISOString(),
      errorMessage: sanitizedMsg,
    };
  }
}
