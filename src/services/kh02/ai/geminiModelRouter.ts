/**
 * SWAI KH-02 V12.4 — Gemini AI Model Router with Retry & Automatic Downgrade
 *
 * Implements resilient multi-model routing:
 * - 1 initial attempt + maximum 3 retries per model on transient errors (503, 429 RPM, 500, 502, 504)
 * - Exponential backoff with jitter and Retry-After awareness
 * - Non-retryable error termination (401, 403, 400 schema error, project quota exhaustion)
 * - Automatic compatible model downgrade upon retry exhaustion
 * - Circuit breaker protection for repeatedly failing models
 * - Full telemetry tracking of models attempted, latency, and fallback counts
 */

import { GoogleGenAI } from "@google/genai";
import { getGoogleGenAIClient, sanitizeGeminiSecrets } from "./geminiClient";
import {
  discoverGeminiModels,
  markModelStatus,
} from "./geminiModelDiscoveryService";
import {
  GeminiModelDescriptor,
  GeminiRouterOptions,
  GeminiRetryTelemetry,
  GeminiModelExecutionSummary,
  GeminiAttemptRecord,
} from "./aiProductIntelligenceTypes";

export type GeminiErrorCategory =
  | "TRANSIENT_OVERLOAD" // 503, high demand
  | "TRANSIENT_RATE_LIMIT" // 429 RPM
  | "DAILY_QUOTA_EXHAUSTED" // 429 daily limit
  | "TRANSIENT_SERVER_ERROR" // 500, 502, 504
  | "AUTHENTICATION_ERROR" // 401
  | "PERMISSION_ERROR" // 403
  | "MODEL_NOT_FOUND" // 404
  | "INVALID_REQUEST" // 400
  | "SAFETY_BLOCKED"
  | "UNKNOWN_ERROR";

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  statusCode: number;
  retryable: boolean;
  retryAfterMs?: number;
  message: string;
}

// Circuit breaker map: modelId -> timestamp of failure
const circuitBreakerState = new Map<string, { failureCount: number; cooldownUntil: number }>();
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000; // 1 minute

/**
 * Classifies an error caught from the Gemini SDK into an actionable category.
 */
export function classifyGeminiError(err: any): ClassifiedGeminiError {
  const msg = err?.message || String(err);
  const status = Number(err?.status || err?.code || 0);

  // Check for HTTP 503 or "high demand"
  if (status === 503 || msg.includes("experiencing high demand") || msg.includes("UNAVAILABLE")) {
    return {
      category: "TRANSIENT_OVERLOAD",
      statusCode: 503,
      retryable: true,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 429
  if (status === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate-limits")) {
    // Check if daily quota vs per-minute limit
    const isDaily =
      msg.includes("per day limit exceeded") ||
      msg.includes("GenerateRequestsPerDay") ||
      msg.includes("daily limit");

    // Inspect possible RetryInfo delay
    let retryAfterMs: number | undefined;
    const retryDelayStr = err?.details?.[0]?.retryDelay;
    if (retryDelayStr && typeof retryDelayStr === "string") {
      const match = retryDelayStr.match(/(\d+)/);
      if (match) {
        retryAfterMs = parseInt(match[1], 10) * 1000;
      }
    }

    return {
      category: isDaily ? "DAILY_QUOTA_EXHAUSTED" : "TRANSIENT_RATE_LIMIT",
      statusCode: 429,
      retryable: !isDaily,
      retryAfterMs,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 404 model not found / retired
  if (status === 404 || msg.includes("not found") || msg.includes("is no longer available")) {
    return {
      category: "MODEL_NOT_FOUND",
      statusCode: 404,
      retryable: false, // Model not found shouldn't be retried on SAME model
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 401 unauthorized
  if (status === 401 || msg.includes("API key not valid") || msg.includes("UNAUTHENTICATED")) {
    return {
      category: "AUTHENTICATION_ERROR",
      statusCode: 401,
      retryable: false,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 403 forbidden
  if (status === 403 || msg.includes("PERMISSION_DENIED")) {
    return {
      category: "PERMISSION_ERROR",
      statusCode: 403,
      retryable: false,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 400 bad request / schema error
  if (status === 400 || msg.includes("INVALID_ARGUMENT")) {
    return {
      category: "INVALID_REQUEST",
      statusCode: 400,
      retryable: false,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for 500, 502, 504
  if (status === 500 || status === 502 || status === 504 || msg.includes("DEADLINE_EXCEEDED") || msg.includes("timeout")) {
    return {
      category: "TRANSIENT_SERVER_ERROR",
      statusCode: status || 500,
      retryable: true,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  return {
    category: "UNKNOWN_ERROR",
    statusCode: status || 500,
    retryable: false,
    message: sanitizeGeminiSecrets(msg),
  };
}

/**
 * Calculates exponential backoff delay with jitter.
 */
export function calculateRetryDelay(
  retryCount: number, // 1, 2, 3
  baseDelayMs: number = 1000,
  maxDelayMs: number = 8000,
  suggestedRetryAfterMs?: number
): number {
  if (suggestedRetryAfterMs && suggestedRetryAfterMs > 0 && suggestedRetryAfterMs <= maxDelayMs) {
    return suggestedRetryAfterMs;
  }
  // Formula: baseDelay * 2^(retryCount - 1) + jitter (0..500ms)
  const exponential = baseDelayMs * Math.pow(2, retryCount - 1);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(exponential + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RouterExecutionResult<T> {
  success: boolean;
  result: T | null;
  modelUsed: string | null;
  telemetry: GeminiRetryTelemetry;
  error: string | null;
}

/**
 * Executes a Gemini task with automatic retry (1 initial + 3 retries) and model downgrade.
 */
export async function executeGeminiTaskWithRetry<T>(
  taskFn: (client: GoogleGenAI, modelId: string) => Promise<T>,
  options: GeminiRouterOptions = {}
): Promise<RouterExecutionResult<T>> {
  const maxRetriesPerModel = options.maxRetriesPerModel ?? 3;
  const maxFallbackModels = options.maxFallbackModels ?? 2;
  const baseDelayMs = options.retryBaseDelayMs ?? 1000;
  const maxDelayMs = options.maxRetryDelayMs ?? 8000;

  const client = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : getGoogleGenAIClient();
  if (!client) {
    return {
      success: false,
      result: null,
      modelUsed: null,
      telemetry: {
        totalAttempts: 0,
        modelsAttempted: [],
        successfulModelId: null,
        fallbackCount: 0,
        executionHistory: [],
        circuitBreakerTriggered: false,
        totalDurationMs: 0,
      },
      error: "No authorized Gemini client available. Configure GEMINI_API_KEY in .env.local",
    };
  }

  // Discover models if not explicitly forced
  let modelChain: GeminiModelDescriptor[] = options.forcedModelList || [];
  if (modelChain.length === 0) {
    const discovery = await discoverGeminiModels({ client });
    if (discovery.primaryModel) {
      modelChain = [discovery.primaryModel, ...discovery.fallbackChain];
    }
  }

  // Filter out models currently in circuit breaker cooldown unless forced
  const now = Date.now();
  const eligibleChain = modelChain.filter((m) => {
    const cb = circuitBreakerState.get(m.modelId);
    if (cb && cb.cooldownUntil > now) {
      return false;
    }
    return true;
  });

  const activeChain = eligibleChain.length > 0 ? eligibleChain : modelChain;
  // Bounded models to attempt: 1 primary + maxFallbackModels
  const modelsToAttempt = activeChain.slice(0, 1 + maxFallbackModels);

  const executionHistory: GeminiModelExecutionSummary[] = [];
  const modelsAttempted: string[] = [];
  let totalAttempts = 0;
  let fallbackCount = 0;
  let circuitBreakerTriggered = false;
  const overallStart = Date.now();

  for (let modelIdx = 0; modelIdx < modelsToAttempt.length; modelIdx++) {
    const model = modelsToAttempt[modelIdx];
    const modelId = model.modelId;
    modelsAttempted.push(modelId);

    if (modelIdx > 0) {
      fallbackCount++;
    }

    const modelAttempts: GeminiAttemptRecord[] = [];
    let modelSuccess = false;
    let modelResult: T | null = null;
    let lastError: ClassifiedGeminiError | null = null;

    // 1 initial attempt (attemptNumber = 1) + up to maxRetriesPerModel (attemptNumber = 2..1+maxRetries)
    const maxAttemptsForThisModel = 1 + maxRetriesPerModel;

    for (let attemptNumber = 1; attemptNumber <= maxAttemptsForThisModel; attemptNumber++) {
      totalAttempts++;
      const attemptStart = Date.now();

      try {
        const res = await taskFn(client, modelId);
        const durationMs = Date.now() - attemptStart;

        modelAttempts.push({
          attemptNumber,
          modelId,
          statusCode: 200,
          durationMs,
          timestamp: new Date().toISOString(),
        });

        // Reset circuit breaker for successful model
        circuitBreakerState.delete(modelId);

        executionHistory.push({
          modelId,
          attemptsCount: modelAttempts.length,
          retriesExhausted: false,
          successful: true,
          attempts: modelAttempts,
        });

        return {
          success: true,
          result: res,
          modelUsed: modelId,
          telemetry: {
            totalAttempts,
            modelsAttempted,
            successfulModelId: modelId,
            fallbackCount,
            executionHistory,
            circuitBreakerTriggered,
            totalDurationMs: Date.now() - overallStart,
          },
          error: null,
        };
      } catch (err: any) {
        const durationMs = Date.now() - attemptStart;
        const classified = classifyGeminiError(err);
        lastError = classified;

        modelAttempts.push({
          attemptNumber,
          modelId,
          statusCode: classified.statusCode,
          errorClassification: classified.category,
          errorMessage: classified.message,
          durationMs,
          timestamp: new Date().toISOString(),
        });

        // Fatal authentication error: stop immediately, do not fallback
        if (classified.category === "AUTHENTICATION_ERROR") {
          executionHistory.push({
            modelId,
            attemptsCount: modelAttempts.length,
            retriesExhausted: true,
            successful: false,
            attempts: modelAttempts,
          });

          return {
            success: false,
            result: null,
            modelUsed: null,
            telemetry: {
              totalAttempts,
              modelsAttempted,
              successfulModelId: null,
              fallbackCount,
              executionHistory,
              circuitBreakerTriggered,
              totalDurationMs: Date.now() - overallStart,
            },
            error: `Authentication failed (HTTP 401). Check Gemini API key.`,
          };
        }

        // Fatal daily quota exhausted for project: stop immediately
        if (classified.category === "DAILY_QUOTA_EXHAUSTED") {
          executionHistory.push({
            modelId,
            attemptsCount: modelAttempts.length,
            retriesExhausted: true,
            successful: false,
            attempts: modelAttempts,
          });

          return {
            success: false,
            result: null,
            modelUsed: null,
            telemetry: {
              totalAttempts,
              modelsAttempted,
              successfulModelId: null,
              fallbackCount,
              executionHistory,
              circuitBreakerTriggered,
              totalDurationMs: Date.now() - overallStart,
            },
            error: `Gemini daily project quota exhausted. Metered operations paused.`,
          };
        }

        // If error is 404 (model removed/not found) or 400 (invalid request) or non-retryable:
        // Do not retry on the SAME model; break out of retry loop to trigger fallback to next model
        if (!classified.retryable || classified.category === "MODEL_NOT_FOUND") {
          markModelStatus(modelId, "UNAVAILABLE");
          break; // break retry loop, move to next model in fallbackChain
        }

        // If retryable and remaining retries exist on this model:
        if (attemptNumber < maxAttemptsForThisModel) {
          const retryCount = attemptNumber; // retry 1, 2, 3
          const delay = calculateRetryDelay(retryCount, baseDelayMs, maxDelayMs, classified.retryAfterMs);
          modelAttempts[modelAttempts.length - 1].delayMs = delay;
          await sleep(delay);
        }
      }
    }

    // Model exhausted its retries
    markModelStatus(modelId, "OVERLOADED");

    // Update circuit breaker
    const existingCb = circuitBreakerState.get(modelId) || { failureCount: 0, cooldownUntil: 0 };
    existingCb.failureCount++;
    if (existingCb.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      existingCb.cooldownUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      circuitBreakerTriggered = true;
    }
    circuitBreakerState.set(modelId, existingCb);

    executionHistory.push({
      modelId,
      attemptsCount: modelAttempts.length,
      retriesExhausted: true,
      successful: false,
      attempts: modelAttempts,
    });
  }

  return {
    success: false,
    result: null,
    modelUsed: null,
    telemetry: {
      totalAttempts,
      modelsAttempted,
      successfulModelId: null,
      fallbackCount,
      executionHistory,
      circuitBreakerTriggered,
      totalDurationMs: Date.now() - overallStart,
    },
    error: `All eligible Gemini models failed or exhausted retry budgets (${modelsAttempted.join(" -> ")}).`,
  };
}

/**
 * Resets local circuit breaker state for testing.
 */
export function resetCircuitBreakerState(): void {
  circuitBreakerState.clear();
}
