/**
 * SWAI KH-02 V12.4 — AI Analysis Cache
 *
 * Implements bounded in-memory caching for candidate AI analyses based on:
 * - Candidate ID
 * - Input source observations digest
 * - Merchant metadata digest
 * - Prompt & Schema version
 * - Model ID
 */

import crypto from "crypto";
import {
  AIProductAnalysisInput,
  GeminiProductIntelligenceResult,
} from "./aiProductIntelligenceTypes";

export const AI_PROMPT_VERSION = "v12.4.1";
export const AI_SCHEMA_VERSION = "v12.4.1";

export interface CachedAIAnalysisEntry {
  cacheKey: string;
  candidateId: string;
  result: GeminiProductIntelligenceResult;
  modelUsed: string;
  cachedAt: number;
}

const analysisCache = new Map<string, CachedAIAnalysisEntry>();
const MAX_CACHE_SIZE = 500;

/**
 * Computes deterministic SHA-256 hash of analysis input + prompt version.
 */
export function computeAnalysisInputHash(
  input: AIProductAnalysisInput,
  modelId: string
): string {
  const normalizedObservations = input.observations.map((o) => ({
    id: o.sourceRecordId,
    h: o.headline?.trim() || "",
    d: o.description?.trim() || "",
    url: o.landingPageUrl?.trim() || "",
  }));

  const payload = {
    cId: input.candidateId,
    t: input.topic.toLowerCase().trim(),
    m: input.market.toUpperCase().trim(),
    obs: normalizedObservations,
    merchant: {
      url: input.merchantEvidence.canonicalUrl?.trim() || "",
      name: input.merchantEvidence.productName?.trim() || "",
      brand: input.merchantEvidence.brand?.trim() || "",
    },
    promptVer: AI_PROMPT_VERSION,
    schemaVer: AI_SCHEMA_VERSION,
    modelId,
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Gets cached analysis if valid.
 */
export function getCachedAIAnalysis(
  input: AIProductAnalysisInput,
  modelId: string
): GeminiProductIntelligenceResult | null {
  const key = computeAnalysisInputHash(input, modelId);
  const entry = analysisCache.get(key);
  if (!entry) return null;
  return entry.result;
}

/**
 * Saves analysis result into cache with bounded eviction.
 */
export function setCachedAIAnalysis(
  input: AIProductAnalysisInput,
  modelId: string,
  result: GeminiProductIntelligenceResult
): void {
  const key = computeAnalysisInputHash(input, modelId);
  if (analysisCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = analysisCache.keys().next().value;
    if (oldestKey) analysisCache.delete(oldestKey);
  }
  analysisCache.set(key, {
    cacheKey: key,
    candidateId: input.candidateId,
    result,
    modelUsed: modelId,
    cachedAt: Date.now(),
  });
}

/**
 * Clears cache for testing.
 */
export function clearAIAnalysisCache(): void {
  analysisCache.clear();
}
