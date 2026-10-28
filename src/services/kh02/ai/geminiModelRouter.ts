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
  GeminiRunBudgetTracker,
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
  | "DEADLINE_EXCEEDED" // per-attempt, per-candidate, or stage deadline
  | "CANCELED" // AbortSignal cancellation
  | "GLOBAL_BUDGET_EXHAUSTED" // Run-level call/token budget limit
  | "SAFETY_BLOCKED"
  | "UNKNOWN_ERROR";

export function createGeminiRunBudgetTracker(
  options: number | { maxGlobalRequests?: number; maxGlobalTokens?: number } = {}
): GeminiRunBudgetTracker {
  const opts = typeof options === "number" ? { maxGlobalRequests: options } : options;
  const maxGlobalRequests = opts.maxGlobalRequests ?? 30;
  const maxGlobalTokens = opts.maxGlobalTokens ?? 120_000;
  const tracker: GeminiRunBudgetTracker = {
    maxGlobalRequests,
    maxGlobalTokens,
    requestsStarted: 0,
    requestsCompleted: 0,
    requestsFailed: 0,
    retriesExecuted: 0,
    fallbackTransitions: 0,
    tokensConsumed: 0,
    tokensReportedCount: 0,
    canStartRequest() {
      if (this.requestsStarted >= this.maxGlobalRequests) return false;
      if (this.tokensReportedCount > 0 && this.tokensConsumed >= this.maxGlobalTokens) return false;
      return true;
    },
    recordRequestStart() {
      if (!this.canStartRequest()) return false;
      this.requestsStarted++;
      return true;
    },
    recordRequestEnd(success: boolean, tokensUsed?: number | null) {
      if (success) {
        this.requestsCompleted++;
      } else {
        this.requestsFailed++;
      }
      if (typeof tokensUsed === "number" && tokensUsed > 0) {
        this.tokensConsumed += tokensUsed;
        this.tokensReportedCount++;
      }
    },
    recordRetry() {
      this.retriesExecuted++;
    },
    recordFallback() {
      this.fallbackTransitions++;
    },
    getRemainingRequests() {
      return Math.max(0, this.maxGlobalRequests - this.requestsStarted);
    },
  };
  return tracker;
}

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

  // Check for explicit cancellation
  if (err?.name === "AbortError" || err?.category === "CANCELED" || msg.includes("CANCELED:")) {
    return {
      category: "CANCELED",
      statusCode: 499,
      retryable: false,
      message: sanitizeGeminiSecrets(msg),
    };
  }

  // Check for explicit deadline exceeded
  if (err?.category === "DEADLINE_EXCEEDED" || msg.includes("ATTEMPT_DEADLINE_EXCEEDED") || msg.includes("CANDIDATE_DEADLINE_EXCEEDED")) {
    return {
      category: "DEADLINE_EXCEEDED",
      statusCode: 504,
      retryable: true,
      message: sanitizeGeminiSecrets(msg),
    };
  }

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

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    const err: any = new Error("CANCELED: Operation aborted before backoff sleep.");
    err.category = "CANCELED";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err: any = new Error("CANCELED: Operation aborted during retry backoff wait.");
      err.category = "CANCELED";
      reject(err);
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function executeAttemptWithDeadlineAndSignal<T>(
  promiseFactory: (attemptSignal: AbortSignal) => Promise<T>,
  attemptTimeoutMs: number,
  parentSignal?: AbortSignal
): Promise<T> {
  if (parentSignal?.aborted) {
    const err: any = new Error("CANCELED: Operation aborted before attempt execution.");
    err.category = "CANCELED";
    return Promise.reject(err);
  }

  const attemptController = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    };

    const onParentAbort = () => {
      if (settled) return;
      settled = true;
      attemptController.abort(new Error("CANCELED"));
      cleanup();
      const err: any = new Error("CANCELED: Operation aborted during active Gemini request.");
      err.category = "CANCELED";
      reject(err);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      attemptController.abort(new Error("ATTEMPT_DEADLINE_EXCEEDED"));
      cleanup();
      const err: any = new Error(`ATTEMPT_DEADLINE_EXCEEDED: Gemini attempt timed out after ${attemptTimeoutMs}ms.`);
      err.status = 504;
      err.category = "DEADLINE_EXCEEDED";
      reject(err);
    }, Math.max(1, attemptTimeoutMs));

    if (parentSignal) {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    promiseFactory(attemptController.signal)
      .then((val) => {
        if (settled) return; // Late response after timeout/cancel cannot mutate state
        settled = true;
        cleanup();
        resolve(val);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
  });
}

export interface RouterExecutionResult<T> {
  success: boolean;
  result: T | null;
  modelUsed: string | null;
  telemetry: GeminiRetryTelemetry;
  error: string | null;
}

/**
 * Executes a Gemini task with automatic retry (1 initial + 3 retries), bounded deadlines,
 * global run budget enforcement, AbortSignal propagation, and automatic model downgrade.
 */
export async function executeGeminiTaskWithRetry<T>(
  taskFn: (client: GoogleGenAI, modelId: string, signal?: AbortSignal) => Promise<T>,
  options: GeminiRouterOptions = {}
): Promise<RouterExecutionResult<T>> {
  const maxRetriesPerModel = options.maxRetriesPerModel ?? 3;
  const maxFallbackModels = options.maxFallbackModels ?? 2;
  const baseDelayMs = options.retryBaseDelayMs ?? 1000;
  const maxDelayMs = options.maxRetryDelayMs ?? 8000;
  const candidateTimeoutMs = options.timeoutMs ?? 25000;
  const perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? Math.min(12000, candidateTimeoutMs);
  const overallStart = Date.now();

  const candidateDeadlineAt = overallStart + candidateTimeoutMs;
  const effectiveDeadlineAt = Math.min(
    candidateDeadlineAt,
    options.stageDeadlineAt ?? Infinity,
    options.jobDeadlineAt ?? Infinity
  );

  if (options.signal?.aborted) {
    return {
      success: false,
      result: null,
      modelUsed: null,
      telemetry: {
        totalAttempts: 0,
        retriesExecuted: 0,
        requestsStarted: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
        modelsAttempted: [],
        successfulModelId: null,
        fallbackCount: 0,
        executionHistory: [],
        circuitBreakerTriggered: false,
        canceled: true,
        totalDurationMs: 0,
      },
      error: "CANCELED: Operation aborted via signal before starting Gemini router.",
    };
  }

  if (Date.now() >= effectiveDeadlineAt) {
    return {
      success: false,
      result: null,
      modelUsed: null,
      telemetry: {
        totalAttempts: 0,
        retriesExecuted: 0,
        requestsStarted: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
        modelsAttempted: [],
        successfulModelId: null,
        fallbackCount: 0,
        executionHistory: [],
        circuitBreakerTriggered: false,
        deadlineExceeded: true,
        totalDurationMs: 0,
      },
      error: "DEADLINE_EXCEEDED: Research AI stage or job deadline reached before starting request.",
    };
  }

  if (options.budgetTracker && !options.budgetTracker.canStartRequest()) {
    return {
      success: false,
      result: null,
      modelUsed: null,
      telemetry: {
        totalAttempts: 0,
        retriesExecuted: 0,
        requestsStarted: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
        modelsAttempted: [],
        successfulModelId: null,
        fallbackCount: 0,
        executionHistory: [],
        circuitBreakerTriggered: false,
        budgetExhausted: true,
        totalDurationMs: 0,
      },
      error: "GLOBAL_BUDGET_EXHAUSTED: Research run AI request/token budget reached.",
    };
  }

  const client = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : getGoogleGenAIClient();
  if (!client) {
    return {
      success: false,
      result: null,
      modelUsed: null,
      telemetry: {
        totalAttempts: 0,
        retriesExecuted: 0,
        requestsStarted: 0,
        requestsCompleted: 0,
        requestsFailed: 0,
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

  // Filter out models currently in circuit breaker cooldown unless all are in cooldown
  const now = Date.now();
  let circuitBreakerTriggered = false;
  const eligibleChain = modelChain.filter((m) => {
    const cb = circuitBreakerState.get(m.modelId);
    if (cb && cb.cooldownUntil > now) {
      circuitBreakerTriggered = true;
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
  let retriesExecuted = 0;
  let requestsStarted = 0;
  let requestsCompleted = 0;
  let requestsFailed = 0;
  let fallbackCount = 0;
  let canceled = false;
  let deadlineExceeded = false;
  let budgetExhausted = false;

  for (let modelIdx = 0; modelIdx < modelsToAttempt.length; modelIdx++) {
    if (options.signal?.aborted) {
      canceled = true;
      break;
    }
    if (Date.now() >= effectiveDeadlineAt) {
      deadlineExceeded = true;
      break;
    }
    if (options.budgetTracker && !options.budgetTracker.canStartRequest()) {
      budgetExhausted = true;
      break;
    }

    const model = modelsToAttempt[modelIdx];
    const modelId = model.modelId;
    modelsAttempted.push(modelId);

    if (modelIdx > 0) {
      fallbackCount++;
      options.budgetTracker?.recordFallback();
    }

    const modelAttempts: GeminiAttemptRecord[] = [];
    // 1 initial attempt (attemptNumber = 1) + up to maxRetriesPerModel (attemptNumber = 2..1+maxRetries)
    const maxAttemptsForThisModel = 1 + maxRetriesPerModel;

    for (let attemptNumber = 1; attemptNumber <= maxAttemptsForThisModel; attemptNumber++) {
      if (options.signal?.aborted) {
        canceled = true;
        break;
      }
      const remainingDeadlineMs = effectiveDeadlineAt - Date.now();
      if (remainingDeadlineMs <= 0) {
        deadlineExceeded = true;
        break;
      }
      if (options.budgetTracker && !options.budgetTracker.recordRequestStart()) {
        budgetExhausted = true;
        break;
      }

      totalAttempts++;
      requestsStarted++;
      if (attemptNumber > 1) {
        retriesExecuted++;
        options.budgetTracker?.recordRetry();
      }
      const attemptStart = Date.now();
      const thisAttemptBudgetMs = Math.min(perAttemptTimeoutMs, remainingDeadlineMs);

      try {
        const res = await executeAttemptWithDeadlineAndSignal(
          (attemptSignal) => taskFn(client, modelId, attemptSignal),
          thisAttemptBudgetMs,
          options.signal
        );
        const durationMs = Date.now() - attemptStart;
        requestsCompleted++;
        options.budgetTracker?.recordRequestEnd(true);

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
            retriesExecuted,
            requestsStarted,
            requestsCompleted,
            requestsFailed,
            modelsAttempted,
            successfulModelId: modelId,
            fallbackCount,
            executionHistory,
            circuitBreakerTriggered,
            canceled: false,
            deadlineExceeded: false,
            budgetExhausted: false,
            totalDurationMs: Date.now() - overallStart,
          },
          error: null,
        };
      } catch (err: any) {
        const durationMs = Date.now() - attemptStart;
        requestsFailed++;
        options.budgetTracker?.recordRequestEnd(false);
        const classified = classifyGeminiError(err);

        modelAttempts.push({
          attemptNumber,
          modelId,
          statusCode: classified.statusCode,
          errorClassification: classified.category,
          errorMessage: classified.message,
          durationMs,
          timestamp: new Date().toISOString(),
        });

        // Cancellation: stop immediately, do not retry or fallback
        if (classified.category === "CANCELED" || options.signal?.aborted) {
          canceled = true;
          executionHistory.push({
            modelId,
            attemptsCount: modelAttempts.length,
            retriesExhausted: false,
            successful: false,
            attempts: modelAttempts,
          });
          return {
            success: false,
            result: null,
            modelUsed: null,
            telemetry: {
              totalAttempts,
              retriesExecuted,
              requestsStarted,
              requestsCompleted,
              requestsFailed,
              modelsAttempted,
              successfulModelId: null,
              fallbackCount,
              executionHistory,
              circuitBreakerTriggered,
              canceled: true,
              deadlineExceeded,
              budgetExhausted,
              totalDurationMs: Date.now() - overallStart,
            },
            error: `CANCELED: ${classified.message}`,
          };
        }

        // Fatal authentication or permission error: stop immediately, do not fallback
        if (
          classified.category === "AUTHENTICATION_ERROR" ||
          classified.category === "PERMISSION_ERROR"
        ) {
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
              retriesExecuted,
              requestsStarted,
              requestsCompleted,
              requestsFailed,
              modelsAttempted,
              successfulModelId: null,
              fallbackCount,
              executionHistory,
              circuitBreakerTriggered,
              totalDurationMs: Date.now() - overallStart,
            },
            error:
              classified.category === "AUTHENTICATION_ERROR"
                ? `Authentication failed (HTTP 401). Check Gemini API key.`
                : `Permission denied (HTTP 403). Check Gemini API key permissions.`,
          };
        }

        // Fatal daily quota exhausted for project: stop immediately, do not bypass account quota via fallback
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
              retriesExecuted,
              requestsStarted,
              requestsCompleted,
              requestsFailed,
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

        // Check if overall candidate/stage/job deadline is already reached
        const remainingAfterAttemptMs = effectiveDeadlineAt - Date.now();
        if (remainingAfterAttemptMs <= 0) {
          deadlineExceeded = true;
          break;
        }

        // If retryable and remaining retries exist on this model:
        if (attemptNumber < maxAttemptsForThisModel) {
          const retryCount = attemptNumber; // retry 1, 2, 3
          // If provider specified Retry-After that exceeds remaining deadline budget, do not wait!
          if (
            classified.retryAfterMs &&
            classified.retryAfterMs > remainingAfterAttemptMs
          ) {
            deadlineExceeded = true;
            modelAttempts[modelAttempts.length - 1].errorMessage = `${classified.message} (Retry-After ${classified.retryAfterMs}ms exceeds remaining deadline ${remainingAfterAttemptMs}ms)`;
            break;
          }

          const delay = calculateRetryDelay(
            retryCount,
            baseDelayMs,
            maxDelayMs,
            classified.retryAfterMs
          );
          if (delay >= remainingAfterAttemptMs) {
            deadlineExceeded = true;
            break;
          }

          modelAttempts[modelAttempts.length - 1].delayMs = delay;
          try {
            await abortableSleep(delay, options.signal);
          } catch (sleepErr: any) {
            canceled = true;
            break;
          }
        }
      }
    }

    if (canceled) {
      executionHistory.push({
        modelId,
        attemptsCount: modelAttempts.length,
        retriesExhausted: false,
        successful: false,
        attempts: modelAttempts,
      });
      break;
    }

    // Model exhausted its retries or timed out
    markModelStatus(modelId, "OVERLOADED");

    // Update circuit breaker
    const existingCb = circuitBreakerState.get(modelId) || { failureCount: 0, cooldownUntil: 0 };
    existingCb.failureCount += modelAttempts.length;
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

  const terminalReason = canceled
    ? "CANCELED: Gemini router execution was canceled via AbortSignal."
    : deadlineExceeded
    ? `DEADLINE_EXCEEDED: Gemini execution exceeded bounded deadline (${candidateTimeoutMs}ms).`
    : budgetExhausted
    ? "GLOBAL_BUDGET_EXHAUSTED: Research run AI call budget exhausted."
    : `All eligible Gemini models failed or exhausted retry budgets (${modelsAttempted.join(" -> ")}).`;

  return {
    success: false,
    result: null,
    modelUsed: null,
    telemetry: {
      totalAttempts,
      retriesExecuted,
      requestsStarted,
      requestsCompleted,
      requestsFailed,
      modelsAttempted,
      successfulModelId: null,
      fallbackCount,
      executionHistory,
      circuitBreakerTriggered,
      canceled,
      deadlineExceeded,
      budgetExhausted,
      totalDurationMs: Date.now() - overallStart,
    },
    error: terminalReason,
  };
}

/**
 * Inspects whether a model is currently in circuit-breaker cooldown.
 */
export function isModelCircuitBroken(modelId: string): boolean {
  const cb = circuitBreakerState.get(modelId);
  if (!cb) return false;
  if (cb.cooldownUntil > Date.now()) return true;
  return false;
}

/**
 * Resets local circuit breaker state for testing.
 */
export function resetCircuitBreakerState(): void {
  circuitBreakerState.clear();
}
