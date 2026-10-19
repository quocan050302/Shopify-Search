/**
 * SWAI Unified Gemini Model Selection & Verification Service
 *
 * PHASE 2 & 3:
 * - One shared model selection service for Test Connection AND Video Analysis.
 * - Dynamic model discovery via ListModels (v1 and v1beta) with pagination.
 * - Real generateContent execution verification (never selects based on ListModels alone).
 * - Fallback among genuinely available models (gemini-3.8-flash -> gemini-3.7-flash -> gemini-3.5-flash etc.).
 * - Accurate error classifications:
 *     INVALID_API_KEY | MODEL_NOT_AVAILABLE | PERMISSION_DENIED |
 *     QUOTA_EXCEEDED | RATE_LIMITED | API_VERSION_UNSUPPORTED |
 *     NETWORK_ERROR | GENERATION_FAILED
 * - Security: Header-based authentication (x-goog-api-key) — no credentials in URL query strings.
 * - Redaction of secrets from all logs and error messages.
 */

import fs from "fs";
import path from "path";

// ─── Error Classification ─────────────────────────────────────────────────────

export type GeminiErrorCode =
  | "INVALID_API_KEY"
  | "MODEL_NOT_AVAILABLE"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "API_VERSION_UNSUPPORTED"
  | "NETWORK_ERROR"
  | "GENERATION_FAILED"
  | "NO_MODELS_FOUND";

export interface ClassifiedGeminiError {
  code: GeminiErrorCode;
  message: string;
  statusCode?: number;
  rawDetails?: string;
}

/**
 * Redacts raw API keys from text, error messages, and log strings.
 * Never allows raw credentials to leak into responses or logs.
 */
export function redactSecrets(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/AQ\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_API_KEY]")
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/key=[^&\s"']+/gi, "key=[REDACTED]")
    .replace(/x-goog-api-key:\s*[^\s"']+/gi, "x-goog-api-key: [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export function classifyGeminiError(err: unknown, statusCode?: number): ClassifiedGeminiError {
  const errObj = (err && typeof err === "object") ? (err as Record<string, unknown>) : null;
  const status =
    statusCode ||
    (typeof errObj?.status === "number"
      ? errObj.status
      : typeof errObj?.statusCode === "number"
      ? errObj.statusCode
      : 0);
  const rawMsg =
    typeof errObj?.message === "string"
      ? errObj.message
      : typeof err === "string"
      ? err
      : "";
  const msg = redactSecrets(rawMsg);

  // 1. Invalid API Key
  if (
    status === 400 &&
    (msg.includes("API_KEY_INVALID") ||
      msg.includes("API key not valid") ||
      msg.includes("API_KEY_NOT_VALID") ||
      msg.includes("INVALID_ARGUMENT") && msg.includes("key"))
  ) {
    return {
      code: "INVALID_API_KEY",
      statusCode: 400,
      message: "The provided Gemini API key is invalid or not recognized by Google AI Studio.",
      rawDetails: msg,
    };
  }

  if (status === 401 || msg.includes("UNAUTHENTICATED")) {
    return {
      code: "INVALID_API_KEY",
      statusCode: 401,
      message: "Authentication failed. Ensure your Gemini API key is correct and not expired.",
      rawDetails: msg,
    };
  }

  // 2. Permission Denied
  if (status === 403 || msg.includes("PERMISSION_DENIED")) {
    return {
      code: "PERMISSION_DENIED",
      statusCode: 403,
      message: "Permission denied for this Gemini API key. Ensure the Generative Language API is enabled in your Google Cloud Project.",
      rawDetails: msg,
    };
  }

  // 3. Quota Exceeded
  if (status === 429 && (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Quota exceeded") || msg.includes("quota"))) {
    return {
      code: "QUOTA_EXCEEDED",
      statusCode: 429,
      message: "Gemini API quota exceeded. Check your usage limits in Google AI Studio / Google Cloud Console.",
      rawDetails: msg,
    };
  }

  // 4. Rate Limited / Temporary Demand Spikes (e.g. 503 high demand)
  if (status === 429 || status === 503 || msg.includes("high demand") || msg.includes("spikes in demand")) {
    return {
      code: "RATE_LIMITED",
      statusCode: status || 503,
      message: "This model is currently experiencing high demand. Spikes are temporary; automatic fallback will switch to an available model.",
      rawDetails: msg,
    };
  }

  // 5. Model Not Available / Discontinued / 404
  if (
    status === 404 ||
    msg.includes("is not found for API version") ||
    msg.includes("is no longer available to new users") ||
    msg.includes("not supported for generateContent")
  ) {
    return {
      code: "MODEL_NOT_AVAILABLE",
      statusCode: 404,
      message: "The requested model is not available or has been discontinued for this account.",
      rawDetails: msg,
    };
  }

  // 6. Network Error / Abort
  if (msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("timeout") || msg.includes("abort")) {
    return {
      code: "NETWORK_ERROR",
      statusCode: 0,
      message: "Network error reaching Google Generative AI servers. Check server internet connectivity.",
      rawDetails: msg,
    };
  }

  // 7. Unsupported API Version
  if (msg.includes("API version") && msg.includes("unsupported")) {
    return {
      code: "API_VERSION_UNSUPPORTED",
      statusCode: status || 400,
      message: "The requested Gemini API version is unsupported for this endpoint.",
      rawDetails: msg,
    };
  }

  return {
    code: "GENERATION_FAILED",
    statusCode: status || 500,
    message: msg.length > 0 ? msg : "Gemini API request failed.",
    rawDetails: msg,
  };
}

// ─── Model Types ──────────────────────────────────────────────────────────────

export interface DiscoveredModel {
  name: string; // e.g. "gemini-3.5-flash"
  rawName: string; // e.g. "models/gemini-3.5-flash"
  displayName?: string;
  description?: string;
  supportedGenerationMethods: string[];
  apiVersion: "v1" | "v1beta";
}

export interface ModelDiscoveryResult {
  success: boolean;
  models: DiscoveredModel[];
  generateContentModels: string[];
  workingApiVersion: "v1" | "v1beta" | null;
  error?: ClassifiedGeminiError;
}

export interface VerificationResult {
  success: boolean;
  modelId: string;
  apiVersion: "v1" | "v1beta";
  latencyMs: number;
  responsePreview?: string;
  error?: ClassifiedGeminiError;
}

export interface UnifiedModelSelectionResult {
  success: boolean;
  selectedModel: string;
  workingApiVersion: "v1" | "v1beta";
  availableModels: string[];
  discoveryCount: number;
  testedCandidates: Array<{
    model: string;
    success: boolean;
    error?: string;
    statusCode?: number;
  }>;
  textGenerationVerified: boolean;
  latencyMs: number;
  error?: ClassifiedGeminiError;
}

// ─── Preferred Candidates ──────────────────────────────────────────────────────

/**
 * Candidates evaluated in priority order.
 * gemini-3.8-flash is preferred as requested, but if experiencing 503 high demand
 * or unavailable, automatically falls back to 3.7 -> 3.6 -> 3.5-flash.
 */
export const PREFERRED_FLASH_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
] as const;

// ─── Header-Authenticated Fetch Helper ────────────────────────────────────────

/**
 * Executes a secure fetch to the Gemini REST API using HTTP headers (x-goog-api-key)
 * rather than URL query parameters to prevent keys from leaking into query strings or logs.
 */
async function secureGeminiFetch(
  url: string,
  apiKey: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  // Use official header for API key authentication
  headers.set("x-goog-api-key", apiKey.trim());
  headers.set("Accept", "application/json");

  return fetch(url, {
    ...options,
    headers,
  });
}

// ─── Model Discovery ──────────────────────────────────────────────────────────

/**
 * Discovers available Gemini models for a given API key.
 *
 * Supports documented pagination (nextPageToken).
 * Tests both v1 and v1beta API versions.
 * Checks supportedGenerationMethods for 'generateContent'.
 */
export async function discoverAvailableGeminiModels(
  apiKey: string,
  options: { maxPages?: number; timeoutMs?: number } = {}
): Promise<ModelDiscoveryResult> {
  const maxPages = options.maxPages || 3;
  const timeoutMs = options.timeoutMs || 8000;

  const versions: Array<"v1" | "v1beta"> = ["v1", "v1beta"];
  let lastError: ClassifiedGeminiError | undefined;

  for (const apiVersion of versions) {
    try {
      let pageToken: string | null = null;
      let pageCount = 0;
      const discovered: DiscoveredModel[] = [];

      do {
        pageCount++;
        let url = `https://generativelanguage.googleapis.com/${apiVersion}/models?pageSize=100`;
        if (pageToken) {
          url += `&pageToken=${encodeURIComponent(pageToken)}`;
        }

        const res = await secureGeminiFetch(url, apiKey, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          let errJson: Record<string, unknown> | null = null;
          try {
            errJson = JSON.parse(errText);
          } catch {
            // raw text
          }
          const rawErr = (errJson?.error as Record<string, unknown>)?.message || errText || `HTTP ${res.status}`;
          lastError = classifyGeminiError(rawErr, res.status);
          break; // Try next version if this one failed
        }

        const data = await res.json();
        if (Array.isArray(data.models)) {
          for (const m of data.models) {
            const rawName = String(m.name || "");
            const name = rawName.replace(/^models\//, "");
            const supported = Array.isArray(m.supportedGenerationMethods)
              ? m.supportedGenerationMethods
              : [];
            discovered.push({
              name,
              rawName,
              displayName: m.displayName,
              description: m.description,
              supportedGenerationMethods: supported,
              apiVersion,
            });
          }
        }

        pageToken = data.nextPageToken || null;
      } while (pageToken && pageCount < maxPages);

      if (discovered.length > 0) {
        const generateContentModels = discovered
          .filter((m) => m.supportedGenerationMethods.includes("generateContent"))
          .map((m) => m.name);

        return {
          success: true,
          models: discovered,
          generateContentModels,
          workingApiVersion: apiVersion,
        };
      }
    } catch (err: unknown) {
      lastError = classifyGeminiError(err);
    }
  }

  return {
    success: false,
    models: [],
    generateContentModels: [],
    workingApiVersion: null,
    error: lastError || {
      code: "NO_MODELS_FOUND",
      message: "No models found or unable to connect to Gemini API.",
    },
  };
}

// ─── Text Generation Verification ─────────────────────────────────────────────

/**
 * Executes a live generateContent request to verify model viability.
 * Uses x-goog-api-key header authentication.
 */
export async function verifyGeminiTextGeneration(
  apiKey: string,
  modelId: string,
  apiVersion: "v1" | "v1beta" = "v1",
  options: { timeoutMs?: number } = {}
): Promise<VerificationResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs || 8000;
  const bareModel = modelId.replace(/^models\//, "");

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(bareModel)}:generateContent`;

  try {
    const res = await secureGeminiFetch(url, apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Respond with OK." }] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startTime;
    const bodyText = await res.text().catch(() => "");

    if (res.ok) {
      let preview = "OK";
      try {
        const json = JSON.parse(bodyText);
        preview =
          json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "OK";
      } catch {
        // fallback
      }
      return {
        success: true,
        modelId: bareModel,
        apiVersion,
        latencyMs,
        responsePreview: preview.slice(0, 60),
      };
    }

    let errJson: Record<string, unknown> | null = null;
    try {
      errJson = JSON.parse(bodyText);
    } catch {
      // not json
    }
    const rawMsg = (errJson?.error as Record<string, unknown>)?.message || bodyText || `HTTP ${res.status}`;
    const classified = classifyGeminiError(rawMsg, res.status);

    return {
      success: false,
      modelId: bareModel,
      apiVersion,
      latencyMs,
      error: classified,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      modelId: bareModel,
      apiVersion,
      latencyMs,
      error: classifyGeminiError(err),
    };
  }
}

// ─── Unified Model Selection Pipeline ─────────────────────────────────────────

/**
 * Unified model selection service shared across Test Connection and Video Analysis.
 *
 * Algorithm:
 * 1. Discover all available models via discoverAvailableGeminiModels().
 * 2. If user configured GEMINI_PREFERRED_MODEL, test that candidate first.
 * 3. Evaluate preferred models in priority order (gemini-3.8-flash -> gemini-3.7-flash -> gemini-3.5-flash...).
 * 4. Verify actual generateContent execution. Never select a model solely because it appears in ListModels.
 * 5. Handle fallback seamlessly if a model is 503 (high demand) or 404 (deprecated).
 * 6. Cache the verified model ID for subsequent video analysis calls.
 */
export async function resolveAndVerifyActiveModel(
  apiKey: string,
  configuredPreferredModel?: string
): Promise<UnifiedModelSelectionResult> {
  const startTime = Date.now();

  // 1. Discover models
  const discovery = await discoverAvailableGeminiModels(apiKey);
  if (!discovery.success || discovery.generateContentModels.length === 0) {
    return {
      success: false,
      selectedModel: "gemini-3.5-flash",
      workingApiVersion: "v1",
      availableModels: [],
      discoveryCount: 0,
      testedCandidates: [],
      textGenerationVerified: false,
      latencyMs: Date.now() - startTime,
      error: discovery.error || {
        code: "NO_MODELS_FOUND",
        message: "No models supporting generateContent found for this key.",
      },
    };
  }

  const available = discovery.generateContentModels;
  const apiVersion = discovery.workingApiVersion || "v1";

  // 2. Build candidate queue
  const candidatesToTest: string[] = [];

  // Preferred model from config/env
  const preferred = (configuredPreferredModel || process.env.GEMINI_PREFERRED_MODEL || "").trim();
  if (preferred && available.includes(preferred)) {
    candidatesToTest.push(preferred);
  }

  // Add default preferred list
  for (const m of PREFERRED_FLASH_MODELS) {
    if (available.includes(m) && !candidatesToTest.includes(m)) {
      candidatesToTest.push(m);
    }
  }

  // Add any other flash models discovered
  for (const m of available) {
    if (m.includes("flash") && !candidatesToTest.includes(m)) {
      candidatesToTest.push(m);
    }
  }

  // Add remaining models
  for (const m of available) {
    if (!candidatesToTest.includes(m)) {
      candidatesToTest.push(m);
    }
  }

  const testedCandidates: Array<{
    model: string;
    success: boolean;
    error?: string;
    statusCode?: number;
  }> = [];

  let verifiedModel: string | null = null;
  let lastCandidateError: ClassifiedGeminiError | undefined;

  // 3. Test candidates until one succeeds
  for (const candidate of candidatesToTest) {
    const testRes = await verifyGeminiTextGeneration(apiKey, candidate, apiVersion, {
      timeoutMs: 6000,
    });

    testedCandidates.push({
      model: candidate,
      success: testRes.success,
      error: testRes.error?.message,
      statusCode: testRes.error?.statusCode,
    });

    if (testRes.success) {
      verifiedModel = candidate;
      break;
    } else {
      lastCandidateError = testRes.error;
    }
  }

  const latencyMs = Date.now() - startTime;

  if (verifiedModel) {
    // Store verified model in persistent cache
    cacheVerifiedModel(verifiedModel, apiVersion);

    return {
      success: true,
      selectedModel: verifiedModel,
      workingApiVersion: apiVersion,
      availableModels: available,
      discoveryCount: discovery.models.length,
      testedCandidates,
      textGenerationVerified: true,
      latencyMs,
    };
  }

  return {
    success: false,
    selectedModel: candidatesToTest[0] || "gemini-3.5-flash",
    workingApiVersion: apiVersion,
    availableModels: available,
    discoveryCount: discovery.models.length,
    testedCandidates,
    textGenerationVerified: false,
    latencyMs,
    error: lastCandidateError || {
      code: "GENERATION_FAILED",
      message: "All tested candidate models failed to generate content.",
    },
  };
}

// ─── Cache Management ─────────────────────────────────────────────────────────

const CACHE_FILE = path.join(process.cwd(), ".connection-status.json");

/**
 * Stores the successfully verified model ID in server cache.
 */
export function cacheVerifiedModel(modelId: string, apiVersion: "v1" | "v1beta"): void {
  try {
    let existing: Record<string, Record<string, Record<string, unknown>>> = {};
    if (fs.existsSync(CACHE_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      } catch {
        existing = {};
      }
    }
    if (!existing.gemini) existing.gemini = {};
    if (!existing.gemini.details) existing.gemini.details = {};

    existing.gemini.details.verifiedModel = modelId;
    existing.gemini.details.apiVersion = apiVersion;
    existing.gemini.details.verifiedAt = new Date().toISOString();

    fs.writeFileSync(CACHE_FILE, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    console.error("[GeminiModelService] Failed to cache verified model:", redactSecrets(String(err)));
  }
}

/**
 * Retrieves the currently active, verified model ID.
 * Returns the cached verified model, or checks GEMINI_PREFERRED_MODEL, or defaults to "gemini-3.5-flash".
 */
export function getActiveVerifiedModel(): {
  modelId: string;
  apiVersion: "v1" | "v1beta";
} {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      const cached = parsed?.gemini?.details?.verifiedModel;
      const apiVer = parsed?.gemini?.details?.apiVersion;
      if (cached && typeof cached === "string") {
        return {
          modelId: cached,
          apiVersion: apiVer === "v1beta" ? "v1beta" : "v1",
        };
      }
    }
  } catch {
    // fallback
  }

  const envPreferred = process.env.GEMINI_PREFERRED_MODEL;
  if (envPreferred && envPreferred.trim().length > 0) {
    return { modelId: envPreferred.trim(), apiVersion: "v1" };
  }

  // Default to gemini-3.5-flash which is verified stable and working
  return { modelId: "gemini-3.5-flash", apiVersion: "v1" };
}
