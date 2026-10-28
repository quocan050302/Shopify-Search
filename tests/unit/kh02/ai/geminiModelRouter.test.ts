import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyGeminiError,
  calculateRetryDelay,
  executeGeminiTaskWithRetry,
  resetCircuitBreakerState,
} from "@/services/kh02/ai/geminiModelRouter";
import { GeminiModelDescriptor } from "@/services/kh02/ai/aiProductIntelligenceTypes";

describe("SWAI KH-02 V12.4 — Gemini Model Router & Error Classification", () => {
  beforeEach(() => {
    resetCircuitBreakerState();
  });

  it("classifies 503 high demand as TRANSIENT_OVERLOAD and retryable", () => {
    const err = {
      status: 503,
      message: "This model is currently experiencing high demand. Spikes in demand are usually temporary.",
    };
    const c = classifyGeminiError(err);
    expect(c.category).toBe("TRANSIENT_OVERLOAD");
    expect(c.retryable).toBe(true);
    expect(c.statusCode).toBe(503);
  });

  it("classifies 429 rate limit as TRANSIENT_RATE_LIMIT and extracts retryDelay", () => {
    const err = {
      status: 429,
      message: "Resource exhausted: rate-limits exceeded.",
      details: [{ retryDelay: "5s" }],
    };
    const c = classifyGeminiError(err);
    expect(c.category).toBe("TRANSIENT_RATE_LIMIT");
    expect(c.retryable).toBe(true);
    expect(c.retryAfterMs).toBe(5000);
  });

  it("classifies 429 daily quota as DAILY_QUOTA_EXHAUSTED and non-retryable", () => {
    const err = {
      status: 429,
      message: "Generate content requests per day limit exceeded on Free Tier.",
    };
    const c = classifyGeminiError(err);
    expect(c.category).toBe("DAILY_QUOTA_EXHAUSTED");
    expect(c.retryable).toBe(false);
  });

  it("classifies 401 as AUTHENTICATION_ERROR and non-retryable", () => {
    const err = {
      status: 401,
      message: "API key not valid. Please pass a valid API key.",
    };
    const c = classifyGeminiError(err);
    expect(c.category).toBe("AUTHENTICATION_ERROR");
    expect(c.retryable).toBe(false);
  });

  it("classifies 404 model not found as MODEL_NOT_FOUND and non-retryable on same model", () => {
    const err = {
      status: 404,
      message: "This model models/gemini-2.5-flash is no longer available to new users.",
    };
    const c = classifyGeminiError(err);
    expect(c.category).toBe("MODEL_NOT_FOUND");
    expect(c.retryable).toBe(false);
  });

  it("calculates exponential retry delay with jitter and cap", () => {
    const d1 = calculateRetryDelay(1, 1000, 8000);
    expect(d1).toBeGreaterThanOrEqual(1000);
    expect(d1).toBeLessThanOrEqual(1500);

    const d2 = calculateRetryDelay(2, 1000, 8000);
    expect(d2).toBeGreaterThanOrEqual(2000);
    expect(d2).toBeLessThanOrEqual(2500);

    const d3 = calculateRetryDelay(3, 1000, 8000);
    expect(d3).toBeGreaterThanOrEqual(4000);
    expect(d3).toBeLessThanOrEqual(4500);

    // Honors Retry-After if valid
    const dCustom = calculateRetryDelay(1, 1000, 8000, 3500);
    expect(dCustom).toBe(3500);
  });

  it("succeeds on attempt 1 with zero retries when model is healthy", async () => {
    const forcedModels: GeminiModelDescriptor[] = [
      {
        modelId: "gemini-3.7-flash",
        rawName: "models/gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 100,
        status: "ELIGIBLE",
      },
    ];

    let calls = 0;
    const task = async (_client: any, modelId: string) => {
      calls++;
      return `Result from ${modelId}`;
    };

    const res = await executeGeminiTaskWithRetry(task, {
      forcedModelList: forcedModels,
      apiKey: "dummy-test-key",
      retryBaseDelayMs: 10,
    });

    expect(res.success).toBe(true);
    expect(res.modelUsed).toBe("gemini-3.7-flash");
    expect(calls).toBe(1);
    expect(res.telemetry.totalAttempts).toBe(1);
    expect(res.telemetry.fallbackCount).toBe(0);
    expect(res.telemetry.executionHistory[0].attemptsCount).toBe(1);
  });

  it("retries up to 3 times on 503 before succeeding on same model", async () => {
    const forcedModels: GeminiModelDescriptor[] = [
      {
        modelId: "gemini-3.7-flash",
        rawName: "models/gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 100,
        status: "ELIGIBLE",
      },
    ];

    let attempts = 0;
    const task = async (_client: any, modelId: string) => {
      attempts++;
      if (attempts < 3) {
        const err: any = new Error("This model is currently experiencing high demand.");
        err.status = 503;
        throw err;
      }
      return `Success from ${modelId}`;
    };

    const res = await executeGeminiTaskWithRetry(task, {
      forcedModelList: forcedModels,
      apiKey: "dummy-test-key",
      retryBaseDelayMs: 10,
      maxRetriesPerModel: 3,
    });

    expect(res.success).toBe(true);
    expect(attempts).toBe(3); // Attempt 1 (503), Retry 1 (503), Retry 2 (Success)
    expect(res.telemetry.totalAttempts).toBe(3);
    expect(res.telemetry.fallbackCount).toBe(0);
  });

  it("exhausts 1 initial + 3 retries (4 total) on primary model, then downgrades to fallback model and succeeds", async () => {
    const forcedModels: GeminiModelDescriptor[] = [
      {
        modelId: "primary-model",
        rawName: "models/primary-model",
        displayName: "Primary Model",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 100,
        status: "ELIGIBLE",
      },
      {
        modelId: "fallback-model",
        rawName: "models/fallback-model",
        displayName: "Fallback Model",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 80,
        status: "ELIGIBLE",
      },
    ];

    const modelCallCounts: Record<string, number> = {
      "primary-model": 0,
      "fallback-model": 0,
    };

    const task = async (_client: any, modelId: string) => {
      modelCallCounts[modelId]++;
      if (modelId === "primary-model") {
        const err: any = new Error("High demand overload");
        err.status = 503;
        throw err;
      }
      return `Success from ${modelId}`;
    };

    const res = await executeGeminiTaskWithRetry(task, {
      forcedModelList: forcedModels,
      apiKey: "dummy-test-key",
      retryBaseDelayMs: 5,
      maxRetriesPerModel: 3,
    });

    expect(res.success).toBe(true);
    expect(res.modelUsed).toBe("fallback-model");
    expect(modelCallCounts["primary-model"]).toBe(4); // 1 initial + 3 retries
    expect(modelCallCounts["fallback-model"]).toBe(1); // 1 attempt succeeded
    expect(res.telemetry.totalAttempts).toBe(5);
    expect(res.telemetry.fallbackCount).toBe(1);
    expect(res.telemetry.modelsAttempted).toEqual(["primary-model", "fallback-model"]);
  });

  it("stops immediately on 401 without retrying or falling back", async () => {
    const forcedModels: GeminiModelDescriptor[] = [
      {
        modelId: "model-a",
        rawName: "models/model-a",
        displayName: "Model A",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 100,
        status: "ELIGIBLE",
      },
      {
        modelId: "model-b",
        rawName: "models/model-b",
        displayName: "Model B",
        description: "",
        version: "1.0",
        capabilities: {} as any,
        priorityScore: 80,
        status: "ELIGIBLE",
      },
    ];

    let calls = 0;
    const task = async () => {
      calls++;
      const err: any = new Error("API key not valid.");
      err.status = 401;
      throw err;
    };

    const res = await executeGeminiTaskWithRetry(task, {
      forcedModelList: forcedModels,
      apiKey: "dummy-invalid-key",
      retryBaseDelayMs: 5,
    });

    expect(res.success).toBe(false);
    expect(calls).toBe(1); // No retries
    expect(res.telemetry.modelsAttempted).toEqual(["model-a"]);
    expect(res.error).toContain("Authentication failed");
  });
});
