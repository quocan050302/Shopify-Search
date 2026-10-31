/**
 * SWAI KH-02 V12.4 — Dynamic Gemini Model Discovery Service
 *
 * Implements official Gemini model discovery and capability filtering:
 * - Queries ai.models.list() via @google/genai
 * - Filters for generateContent support and text/structured-output capability
 * - Excludes embeddings-only, tts-only, music-only, or robotics models
 * - Automatically ranks available models by capability, speed, and reliability
 * - Maintains bounded-TTL cache with invalidation hooks
 */

import { GoogleGenAI } from "@google/genai";
import { getGoogleGenAIClient } from "./geminiClient";
import {
  GeminiModelDescriptor,
  GeminiModelCapability,
} from "./aiProductIntelligenceTypes";

interface ModelCatalogCache {
  discoveredModels: GeminiModelDescriptor[];
  eligibleModels: GeminiModelDescriptor[];
  cachedAt: number;
  ttlMs: number;
}

let cachedCatalog: ModelCatalogCache | null = null;
const DEFAULT_CATALOG_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Known non-chat / specialized model patterns to exclude from product analysis
 */
const EXCLUDED_NAME_PATTERNS = [
  "-tts",
  "preview-tts",
  "lyria",
  "robotics",
  "computer-use",
  "transcribe",
  "embed",
  "embedding",
  "imagen",
  "-image",
  "nano-banana",
  "veo",
  "deep-research", // requires custom interaction toolchain
];

/**
 * Model priority weightings based on demonstrated performance and structured output reliability.
 * Higher score = higher ranking.
 */
const MODEL_PREFERENCE_WEIGHTS: Record<string, number> = {
  "gemini-3.5-flash-lite": 115,
  "gemini-flash-lite-latest": 110,
  "gemini-3.1-flash-lite": 105,
  "gemini-3.7-flash": 100,
  "gemini-3.6-flash": 95,
  "gemini-3.8-flash": 90,
  "gemini-flash-latest": 85,
  "gemini-3.5-flash": 75,
  "gemma-4-26b-a4b-it": 65,
  "gemma-4-31b-it": 60,
  "gemini-3.1-pro-preview": 55,
  "gemini-pro-latest": 50,
  "gemini-3-flash-preview": 45,
};

/**
 * Normalizes raw SDK model name (e.g. "models/gemini-3.7-flash") to clean model ID ("gemini-3.7-flash").
 */
export function normalizeModelId(rawName: string): string {
  return rawName.replace(/^models\//, "").trim();
}

/**
 * Evaluates whether a discovered model is eligible for structured product intelligence analysis.
 */
export function evaluateModelEligibility(rawModel: any): {
  eligible: boolean;
  capabilities: GeminiModelCapability;
  priorityScore: number;
  reason?: string;
} {
  const modelId = normalizeModelId(rawModel.name || "");
  const supportedActions: string[] = rawModel.supportedActions || [];

  const supportsGenerateContent = supportedActions.includes("generateContent");
  const isExcludedPattern = EXCLUDED_NAME_PATTERNS.some((pat) => modelId.toLowerCase().includes(pat));

  // Determine capabilities
  const inputTokenLimit = rawModel.inputTokenLimit || 32768;
  const outputTokenLimit = rawModel.outputTokenLimit || 8192;
  const supportsStructuredOutput = supportsGenerateContent && !isExcludedPattern;
  const supportsVision = !modelId.includes("gemma"); // Gemma text models don't process images
  const supportsVideo = supportsVision && (modelId.includes("flash") || modelId.includes("pro"));

  // Check known discontinued models
  const isDiscontinued =
    modelId === "gemini-2.5-flash" ||
    modelId === "gemini-2.5-pro" ||
    modelId === "gemini-2.5-flash-lite";

  let eligible = supportsGenerateContent && !isExcludedPattern && !isDiscontinued;
  let reason: string | undefined;

  if (!supportsGenerateContent) {
    reason = "Does not support generateContent action";
  } else if (isExcludedPattern) {
    reason = "Specialized model modality (audio/robotics/research) unsuitable for product extraction";
  } else if (isDiscontinued) {
    reason = "Model retired/discontinued by Google in favor of newer Gemini versions";
  }

  // Cost tier classification
  let estimatedCostTier: "FREE" | "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (modelId.includes("pro")) estimatedCostTier = "HIGH";
  else if (modelId.includes("flash-lite") || modelId.includes("gemma")) estimatedCostTier = "FREE";
  else if (modelId.includes("flash")) estimatedCostTier = "LOW";

  const capabilities: GeminiModelCapability = {
    supportsGenerateContent,
    supportsStructuredOutput,
    supportsVision,
    supportsVideo,
    inputTokenLimit,
    outputTokenLimit,
    isAvailableToAccount: eligible,
    isDeprecatedOrRemoved: isDiscontinued,
    estimatedCostTier,
  };

  // Compute ranking score: preference weight + input context bonus
  let priorityScore = MODEL_PREFERENCE_WEIGHTS[modelId] || 30;
  if (isExcludedPattern || isDiscontinued || !supportsGenerateContent) {
    priorityScore = -1;
  }

  return { eligible, capabilities, priorityScore, reason };
}

/**
 * Discovers and ranks all Gemini models available to the current API key.
 */
export async function discoverGeminiModels(options?: {
  client?: GoogleGenAI;
  forceRefresh?: boolean;
}): Promise<{
  discovered: GeminiModelDescriptor[];
  eligible: GeminiModelDescriptor[];
  primaryModel: GeminiModelDescriptor | null;
  fallbackChain: GeminiModelDescriptor[];
}> {
  const now = Date.now();
  if (!options?.forceRefresh && cachedCatalog && now - cachedCatalog.cachedAt < cachedCatalog.ttlMs) {
    const eligible = cachedCatalog.eligibleModels;
    return {
      discovered: cachedCatalog.discoveredModels,
      eligible,
      primaryModel: eligible[0] || null,
      fallbackChain: eligible.slice(1),
    };
  }

  const ai = options?.client || getGoogleGenAIClient();
  if (!ai) {
    return {
      discovered: [],
      eligible: [],
      primaryModel: null,
      fallbackChain: [],
    };
  }

  const discovered: GeminiModelDescriptor[] = [];
  const eligible: GeminiModelDescriptor[] = [];

  try {
    const listResult = await ai.models.list();
    for await (const rawModel of listResult) {
      const modelId = normalizeModelId(rawModel.name || "");
      const { eligible: isEligible, capabilities, priorityScore, reason } = evaluateModelEligibility(rawModel);

      const descriptor: GeminiModelDescriptor = {
        modelId,
        rawName: rawModel.name || modelId,
        displayName: rawModel.displayName || modelId,
        description: rawModel.description || "",
        version: rawModel.version || "1.0",
        capabilities,
        priorityScore,
        status: isEligible ? "ELIGIBLE" : "INELIGIBLE",
      };

      discovered.push(descriptor);
      if (isEligible) {
        eligible.push(descriptor);
      }
    }
  } catch (err: any) {
    // If listing fails, return empty gracefully so router can use fallback or report blocker
    return {
      discovered: [],
      eligible: [],
      primaryModel: null,
      fallbackChain: [],
    };
  }

  // Sort eligible models descending by priority score
  eligible.sort((a, b) => b.priorityScore - a.priorityScore);

  // Cache catalog
  cachedCatalog = {
    discoveredModels: discovered,
    eligibleModels: eligible,
    cachedAt: now,
    ttlMs: DEFAULT_CATALOG_TTL_MS,
  };

  const primaryModel = eligible[0] || null;
  const fallbackChain = eligible.slice(1);

  return {
    discovered,
    eligible,
    primaryModel,
    fallbackChain,
  };
}

/**
 * Invalidates and refreshes the model discovery catalog.
 */
export async function refreshGeminiModelCatalog(client?: GoogleGenAI) {
  cachedCatalog = null;
  return discoverGeminiModels({ client, forceRefresh: true });
}

/**
 * Marks a specific model as overloaded or exhausted in the local catalog.
 */
export function markModelStatus(modelId: string, status: "OVERLOADED" | "EXHAUSTED" | "UNAVAILABLE") {
  if (!cachedCatalog) return;
  const found = cachedCatalog.eligibleModels.find((m) => m.modelId === modelId);
  if (found) {
    found.status = status;
  }
}
