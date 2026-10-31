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
export const DEFAULT_AI_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface CachedAIAnalysisEntry {
  cacheKey: string;
  inputHash: string;
  evidenceHash: string;
  promptVersion: string;
  schemaVersion: string;
  candidateId: string;
  result: GeminiProductIntelligenceResult;
  actualModelId: string;
  modelUsed: string;
  analysisStatus: "VERIFIED" | "ACCEPTED_WITH_UNCERTAINTY" | "REJECTED_ENTITY";
  timestamp: string;
  cachedAt: number;
  ttlMs: number;
  expiresAt: number;
}

const analysisCache = new Map<string, CachedAIAnalysisEntry>();
const MAX_CACHE_SIZE = 500;

export function computeEvidenceHash(input: AIProductAnalysisInput): string {
  const normalizedObservations = (input.observations || []).map((o) => ({
    id: o.sourceRecordId,
    h: o.headline?.trim() || "",
    d: o.description?.trim() || "",
    url: o.landingPageUrl?.trim() || "",
    ref: o.creativeReference?.trim() || "",
  }));

  const evidencePayload = {
    obs: normalizedObservations,
    merchant: {
      url: input.merchantEvidence.canonicalUrl?.trim() || "",
      pageType: input.merchantEvidence.pageType || "",
      name: input.merchantEvidence.productName?.trim() || "",
      brand: input.merchantEvidence.brand?.trim() || "",
      desc: input.merchantEvidence.description?.trim() || "",
      refs: input.merchantEvidence.evidenceRefs || [],
    },
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(evidencePayload))
    .digest("hex");
}

/**
 * Computes deterministic SHA-256 hash of analysis input + evidence + prompt/schema version.
 * Uses canonical lookup key so reads before model selection hit writes made with actualModelId.
 */
export function computeAnalysisInputHash(
  input: AIProductAnalysisInput,
  modelId?: string
): string {
  const evidenceHash = computeEvidenceHash(input);
  const effectiveModelFilter =
    !modelId || modelId === "default" || modelId === "any" ? "canonical" : modelId;

  const payload = {
    cId: input.candidateId,
    t: input.topic.toLowerCase().trim(),
    m: input.market.toUpperCase().trim(),
    evHash: evidenceHash,
    promptVer: AI_PROMPT_VERSION,
    schemaVer: AI_SCHEMA_VERSION,
    modelFilter: effectiveModelFilter,
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Gets full cached analysis entry if valid and within TTL.
 */
export function getCachedAIAnalysisEntry(
  input: AIProductAnalysisInput,
  modelId?: string
): CachedAIAnalysisEntry | null {
  const now = Date.now();
  const specificKey =
    modelId && modelId !== "default" && modelId !== "any"
      ? computeAnalysisInputHash(input, modelId)
      : null;
  const canonicalKey = computeAnalysisInputHash(input, "canonical");

  const entry =
    (specificKey ? analysisCache.get(specificKey) : undefined) ||
    analysisCache.get(canonicalKey);

  if (!entry) return null;

  if (now > entry.expiresAt) {
    if (specificKey) analysisCache.delete(specificKey);
    analysisCache.delete(canonicalKey);
    return null;
  }

  if (
    modelId &&
    modelId !== "default" &&
    modelId !== "any" &&
    entry.actualModelId !== modelId
  ) {
    return null;
  }

  return entry;
}

/**
 * Gets cached analysis result if valid and within TTL.
 */
export function getCachedAIAnalysis(
  input: AIProductAnalysisInput,
  modelId?: string
): GeminiProductIntelligenceResult | null {
  const entry = getCachedAIAnalysisEntry(input, modelId);
  return entry ? entry.result : null;
}

/**
 * Saves verified analysis result into cache with bounded eviction and TTL.
 */
export function setCachedAIAnalysis(
  input: AIProductAnalysisInput,
  actualModelId: string,
  result: GeminiProductIntelligenceResult,
  options?: {
    ttlMs?: number;
    analysisStatus?: "VERIFIED" | "ACCEPTED_WITH_UNCERTAINTY" | "REJECTED_ENTITY";
  }
): CachedAIAnalysisEntry {
  const now = Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_AI_CACHE_TTL_MS;
  const evidenceHash = computeEvidenceHash(input);
  const canonicalKey = computeAnalysisInputHash(input, "canonical");
  const modelSpecificKey = computeAnalysisInputHash(input, actualModelId);

  if (analysisCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = analysisCache.keys().next().value;
    if (oldestKey) analysisCache.delete(oldestKey);
  }

  const entry: CachedAIAnalysisEntry = {
    cacheKey: canonicalKey,
    inputHash: canonicalKey,
    evidenceHash,
    promptVersion: AI_PROMPT_VERSION,
    schemaVersion: AI_SCHEMA_VERSION,
    candidateId: input.candidateId,
    result,
    actualModelId,
    modelUsed: actualModelId,
    analysisStatus: options?.analysisStatus || "VERIFIED",
    timestamp: new Date(now).toISOString(),
    cachedAt: now,
    ttlMs,
    expiresAt: now + ttlMs,
  };

  analysisCache.set(canonicalKey, entry);
  analysisCache.set(modelSpecificKey, entry);
  return entry;
}

/**
 * Clears cache for testing.
 */
export function clearAIAnalysisCache(): void {
  analysisCache.clear();
}
