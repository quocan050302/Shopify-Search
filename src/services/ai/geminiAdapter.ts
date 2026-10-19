/**
 * Gemini AI Adapter — SWAI V7.2
 *
 * Integrates Google Gemini API for real video creative analysis.
 *
 * CRITICAL PRINCIPLES:
 * - If no key is configured -> return AI_PROVIDER_NOT_CONFIGURED (not an error, a state).
 * - If no accessible video or invalid container -> return MEDIA_UNAVAILABLE (never fabricate analysis).
 * - Implements documented Gemini Files API upload and polling before calling generateContent.
 * - Dynamic unified model selection shared with Test Connection (no obsolete hardcoded models).
 * - All analysis results include actual model ID used, prompt version, timestamp, confidence, and source attribution.
 * - Never expose GEMINI_API_KEY to the client or in log output.
 * - Uses x-goog-api-key header authentication and cleans up uploaded files after analysis.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { getActiveVerifiedModel, redactSecrets } from "./geminiModelService";
import {
  validateVideoForGeminiAnalysis,
  uploadVideoToGeminiFiles,
} from "./geminiFilesService";

// Re-export video validator for consumers
export { validateVideoForGeminiAnalysis };

// ─── Constants ────────────────────────────────────────────────────────────────

export const GEMINI_ADAPTER_VERSION = "7.2.0";

/**
 * Backwards-compatible model aliases.
 * The active model is resolved dynamically via getActiveVerifiedModel().
 */
export const GEMINI_MODELS = {
  FLASH: "gemini-3.5-flash",
  FLASH_LITE: "gemini-3.5-flash-lite",
  FLASH_STABLE: "gemini-3.5-flash",
  PRO: "gemini-2.5-pro",
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS] | string;

export const CREATIVE_ANALYSIS_PROMPT_VERSION = "v2.2.0";

// ─── Configuration Types ──────────────────────────────────────────────────────

export interface GeminiConfigStatus {
  configured: boolean;
  status: "READY" | "NOT_CONFIGURED" | "KEY_PRESENT_UNVERIFIED" | "CONFIGURATION_ERROR";
  modelVersion: string;
  promptVersion: string;
  message: string;
  limitations: string[];
}

// ─── Analysis Types ───────────────────────────────────────────────────────────

export type GeminiAnalysisStatus =
  | "COMPLETE"
  | "AI_PROVIDER_NOT_CONFIGURED"
  | "MEDIA_UNAVAILABLE"
  | "ANALYSIS_FAILED"
  | "PARTIAL_ANALYSIS";

export interface GeminiCreativeAnalysisResult {
  status: GeminiAnalysisStatus;
  hookType: string | null;
  hookQualityScore: number | null; // 0–100, null if unscored
  pacingScore: number | null; // 0–100, null if unscored
  openingHookTimestamp: string | null; // e.g. "0:00-0:03"
  openingHookDescription: string | null;
  ctaClassification: string | null;
  sellingAngles: string[];
  evergreenClassification: string | null; // EVERGREEN | TREND_DRIVEN | INSUFFICIENT_EVIDENCE
  evergreenRationale: string | null;
  weaknesses: string[];
  adScriptConcepts: {
    hookConcept: string;
    script15s: string;
    script30s: string;
    ugcAngle: string;
  } | null;
  modelId: string;
  promptVersion: string;
  sourceVideoReference: string;
  analysisTimestamp: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidenceNote: string;
  limitations: string[];
  rawResponse?: string;
}

// ─── Validate Configuration ───────────────────────────────────────────────────

export function validateGeminiConfiguration(): GeminiConfigStatus {
  const apiKey = process.env.GEMINI_API_KEY;
  const activeModel = getActiveVerifiedModel().modelId;

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      configured: false,
      status: "NOT_CONFIGURED",
      modelVersion: activeModel,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      message:
        "GEMINI_API_KEY is not configured in server environment. Set this variable to enable AI video analysis.",
      limitations: [
        "AI video analysis is unavailable",
        "Hook quality scores cannot be computed",
        "Creative selling angles cannot be extracted from video",
        "Copy-only analysis (text-based) remains available",
      ],
    };
  }

  return {
    configured: true,
    status: "KEY_PRESENT_UNVERIFIED",
    modelVersion: activeModel,
    promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
    message: "GEMINI_API_KEY is present but not live-tested against the Gemini API — unverified until first analysis.",
    limitations: [
      "Analysis requires an authorized MP4/WebM upload or direct video URL",
      "TikTok web page URLs require uploading the raw media file via Media Upload",
    ],
  };
}

// ─── Prompt Templates ─────────────────────────────────────────────────────────

const HOOK_ANALYSIS_PROMPT = `
You are an expert ecommerce video ad creative analyst.

Analyze the opening 3 seconds (hook) of this video advertisement.

Respond in this exact JSON format (all fields required):
{
  "hookType": "<Problem-First|Curiosity|Surprise|Product Demonstration|UGC Testimonial|Transformation|Emotional>",
  "hookQualityScore": <integer 0-100, where 100 is an exceptionally strong hook>,
  "hookTimestamp": "<e.g. 0:00-0:03>",
  "hookDescription": "<one concise sentence describing exactly what happens in the first 3 seconds>",
  "hookStrengths": ["<specific strength>", ...],
  "hookWeaknesses": ["<specific weakness>", ...],
  "confidence": "<HIGH|MEDIUM|LOW>"
}

RULES:
- Base ALL analysis on what you actually observe in the video, not assumptions.
- If you cannot clearly see or hear the hook due to quality issues, set confidence to LOW and explain in hookDescription.
- hookQualityScore must be based on observed evidence, not guesswork.
- Do not invent details not present in the video.
`.trim();

const CREATIVE_ANALYSIS_PROMPT = `
You are an expert ecommerce video ad creative analyst for Shopify product research.

Analyze this full video advertisement and respond ONLY in this exact JSON format:
{
  "hookType": "<Problem-First|Curiosity|Surprise|Product Demonstration|UGC Testimonial|Transformation|Emotional>",
  "hookQualityScore": <integer 0-100>,
  "hookTimestamp": "<e.g. 0:00-0:03>",
  "pacingScore": <integer 0-100 — how well the video maintains viewer attention>,
  "ctaClassification": "<SHOP_NOW|LEARN_MORE|LIMITED_OFFER|DISCOUNT|FREE_SHIPPING|NONE_OBSERVED>",
  "sellingAngles": ["<specific selling angle observed>", ...],
  "evergreenClassification": "<EVERGREEN|TREND_DRIVEN|INSUFFICIENT_EVIDENCE>",
  "evergreenRationale": "<one sentence explaining why this creative is or is not evergreen>",
  "weaknesses": ["<specific observable weakness>", ...],
  "adScriptConcepts": {
    "hookConcept": "<original hook concept inspired by this analysis>",
    "script15s": "<brief 15-second script outline>",
    "script30s": "<brief 30-second script outline>",
    "ugcAngle": "<UGC angle suggestion>"
  },
  "confidence": "<HIGH|MEDIUM|LOW>",
  "confidenceNote": "<brief explanation of confidence level and any limitations>"
}

RULES:
- Base ALL findings on what you actually observe in the video.
- If a field cannot be determined from the actual video, set it to null and explain in confidenceNote.
- Do not invent details, metrics, or selling points not present in the video.
- evergreenClassification must be based on observed creative approach, not product assumptions.
- This analysis is for research only. Do not claim to know ROAS, revenue, or sales data.
`.trim();

const SELLING_ANGLES_PROMPT = `
You are analyzing a video advertisement for ecommerce product research.

List the specific selling angles (unique value propositions) this video communicates to viewers.

Respond ONLY in this JSON format:
{
  "sellingAngles": [
    {
      "angle": "<specific angle>",
      "timestamp": "<when it appears, e.g. 0:05-0:12>",
      "deliveryMethod": "<visual|voiceover|text_overlay|demonstration|testimonial>"
    }
  ],
  "primaryAngle": "<the single strongest angle in this video>",
  "confidence": "<HIGH|MEDIUM|LOW>"
}

Base ALL output on what you actually observe. Do not invent angles not present in the video.
`.trim();

// ─── Client Initializer ───────────────────────────────────────────────────────

function getGeminiClient(apiKey?: string): GoogleGenerativeAI | null {
  const key = (apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

// ─── Core Analysis Functions ──────────────────────────────────────────────────

/**
 * Analyzes the opening hook of a video ad using Gemini Files API.
 */
export async function analyzeOpeningHook(
  videoUrl: string | null | undefined,
  adCopy?: { headline?: string; bodyText?: string }
): Promise<{
  status: GeminiAnalysisStatus;
  hookType: string | null;
  hookQualityScore: number | null;
  hookTimestamp: string | null;
  hookDescription: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  modelId: string;
  promptVersion: string;
  analysisTimestamp: string;
  limitations: string[];
}> {
  const now = new Date().toISOString();
  const apiKey = process.env.GEMINI_API_KEY || "";
  const { modelId } = getActiveVerifiedModel();

  if (!apiKey) {
    return {
      status: "AI_PROVIDER_NOT_CONFIGURED",
      hookType: null,
      hookQualityScore: null,
      hookTimestamp: null,
      hookDescription: null,
      confidence: "NONE",
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      analysisTimestamp: now,
      limitations: ["GEMINI_API_KEY is not configured in server environment."],
    };
  }

  const videoCheck = await validateVideoForGeminiAnalysis(videoUrl);
  if (!videoCheck.eligible) {
    return {
      status: "MEDIA_UNAVAILABLE",
      hookType: null,
      hookQualityScore: null,
      hookTimestamp: null,
      hookDescription: null,
      confidence: "NONE",
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      analysisTimestamp: now,
      limitations: [videoCheck.reason],
    };
  }

  let preparedFile = null;
  try {
    // Upload video via Files API
    preparedFile = await uploadVideoToGeminiFiles(apiKey, videoCheck);

    const client = getGeminiClient(apiKey)!;
    const model = client.getGenerativeModel({
      model: modelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    let prompt = HOOK_ANALYSIS_PROMPT;
    if (adCopy?.headline || adCopy?.bodyText) {
      prompt += `\n\nAd copy context:\nHeadline: ${adCopy.headline || "N/A"}\nBody: ${adCopy.bodyText || "N/A"}`;
    }

    const result = await model.generateContent([
      { text: prompt },
      { fileData: { mimeType: preparedFile.mimeType, fileUri: preparedFile.fileUri } },
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Gemini response did not contain valid JSON.");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      status: "COMPLETE",
      hookType: parsed.hookType ?? null,
      hookQualityScore: typeof parsed.hookQualityScore === "number" ? parsed.hookQualityScore : null,
      hookTimestamp: parsed.hookTimestamp ?? null,
      hookDescription: parsed.hookDescription ?? null,
      confidence: (parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW" ? parsed.confidence : "LOW"),
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      analysisTimestamp: now,
      limitations: [],
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "ANALYSIS_FAILED",
      hookType: null,
      hookQualityScore: null,
      hookTimestamp: null,
      hookDescription: null,
      confidence: "NONE",
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      analysisTimestamp: now,
      limitations: [`Hook analysis failed: ${redactSecrets(errMsg)}`],
    };
  } finally {
    if (preparedFile) {
      await preparedFile.cleanup().catch(() => {});
    }
  }
}

/**
 * Full creative analysis of a video ad using Gemini Files API.
 */
export async function analyzeVideoWithGemini(
  videoUrl: string | null | undefined,
  adContext?: {
    headline?: string | null;
    bodyText?: string | null;
    platform?: string;
    category?: string;
    callToAction?: string | null;
  }
): Promise<GeminiCreativeAnalysisResult> {
  const now = new Date().toISOString();
  const apiKey = process.env.GEMINI_API_KEY || "";
  const { modelId } = getActiveVerifiedModel();
  const sourceVideoRef = videoUrl || "no_video_reference";

  if (!apiKey) {
    return {
      status: "AI_PROVIDER_NOT_CONFIGURED",
      hookType: null,
      hookQualityScore: null,
      pacingScore: null,
      openingHookTimestamp: null,
      openingHookDescription: null,
      ctaClassification: null,
      sellingAngles: [],
      evergreenClassification: null,
      evergreenRationale: null,
      weaknesses: [],
      adScriptConcepts: null,
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      sourceVideoReference: sourceVideoRef,
      analysisTimestamp: now,
      confidence: "NONE",
      confidenceNote: "GEMINI_API_KEY is not configured.",
      limitations: ["Set GEMINI_API_KEY in server environment to enable AI analysis"],
    };
  }

  const videoCheck = await validateVideoForGeminiAnalysis(videoUrl);
  if (!videoCheck.eligible) {
    return {
      status: "MEDIA_UNAVAILABLE",
      hookType: null,
      hookQualityScore: null,
      pacingScore: null,
      openingHookTimestamp: null,
      openingHookDescription: null,
      ctaClassification: null,
      sellingAngles: [],
      evergreenClassification: null,
      evergreenRationale: null,
      weaknesses: [],
      adScriptConcepts: null,
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      sourceVideoReference: sourceVideoRef,
      analysisTimestamp: now,
      confidence: "NONE",
      confidenceNote: videoCheck.reason,
      limitations: [videoCheck.reason],
    };
  }

  let preparedFile = null;
  try {
    preparedFile = await uploadVideoToGeminiFiles(apiKey, videoCheck);

    const client = getGeminiClient(apiKey)!;
    const model = client.getGenerativeModel({
      model: modelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
      generationConfig: { responseMimeType: "text/plain" },
    });

    let prompt = CREATIVE_ANALYSIS_PROMPT;
    if (adContext) {
      prompt +=
        `\n\nAd context metadata (for context only):` +
        `\nPlatform: ${adContext.platform || "Unknown"}` +
        `\nCategory: ${adContext.category || "Unknown"}` +
        `\nHeadline: ${adContext.headline || "N/A"}` +
        `\nBody: ${adContext.bodyText || "N/A"}` +
        `\nCTA: ${adContext.callToAction || "N/A"}`;
    }

    const result = await model.generateContent([
      { text: prompt },
      { fileData: { mimeType: preparedFile.mimeType, fileUri: preparedFile.fileUri } },
    ]);

    const rawText = result.response.text();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Gemini response did not contain parseable JSON.");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      status: "COMPLETE",
      hookType: parsed.hookType ?? null,
      hookQualityScore: typeof parsed.hookQualityScore === "number" ? parsed.hookQualityScore : null,
      pacingScore: typeof parsed.pacingScore === "number" ? parsed.pacingScore : null,
      openingHookTimestamp: parsed.hookTimestamp ?? null,
      openingHookDescription: parsed.hookDescription ?? null,
      ctaClassification: parsed.ctaClassification ?? null,
      sellingAngles: Array.isArray(parsed.sellingAngles) ? parsed.sellingAngles : [],
      evergreenClassification: parsed.evergreenClassification ?? null,
      evergreenRationale: parsed.evergreenRationale ?? null,
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      adScriptConcepts: parsed.adScriptConcepts ?? null,
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      sourceVideoReference: sourceVideoRef,
      analysisTimestamp: now,
      confidence: (parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW" ? parsed.confidence : "LOW"),
      confidenceNote: parsed.confidenceNote ?? "Confidence based on observed creative elements.",
      limitations: [],
      rawResponse: rawText,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "ANALYSIS_FAILED",
      hookType: null,
      hookQualityScore: null,
      pacingScore: null,
      openingHookTimestamp: null,
      openingHookDescription: null,
      ctaClassification: null,
      sellingAngles: [],
      evergreenClassification: null,
      evergreenRationale: null,
      weaknesses: [],
      adScriptConcepts: null,
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      sourceVideoReference: sourceVideoRef,
      analysisTimestamp: now,
      confidence: "NONE",
      confidenceNote: `Gemini video analysis failed: ${redactSecrets(errMsg)}`,
      limitations: [`Gemini API error: ${redactSecrets(errMsg)}`],
    };
  } finally {
    if (preparedFile) {
      await preparedFile.cleanup().catch(() => {});
    }
  }
}

/**
 * Extracts creative selling angles from video using Files API.
 */
export async function extractCreativeSellingAngles(
  videoUrl: string | null | undefined
): Promise<{
  status: GeminiAnalysisStatus;
  angles: Array<{ angle: string; timestamp?: string; deliveryMethod?: string }>;
  primaryAngle: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  modelId: string;
  analysisTimestamp: string;
  limitations: string[];
}> {
  const now = new Date().toISOString();
  const apiKey = process.env.GEMINI_API_KEY || "";
  const { modelId } = getActiveVerifiedModel();

  if (!apiKey) {
    return {
      status: "AI_PROVIDER_NOT_CONFIGURED",
      angles: [],
      primaryAngle: null,
      confidence: "NONE",
      modelId,
      analysisTimestamp: now,
      limitations: ["GEMINI_API_KEY is not configured."],
    };
  }

  const videoCheck = await validateVideoForGeminiAnalysis(videoUrl);
  if (!videoCheck.eligible) {
    return {
      status: "MEDIA_UNAVAILABLE",
      angles: [],
      primaryAngle: null,
      confidence: "NONE",
      modelId,
      analysisTimestamp: now,
      limitations: [videoCheck.reason],
    };
  }

  let preparedFile = null;
  try {
    preparedFile = await uploadVideoToGeminiFiles(apiKey, videoCheck);

    const client = getGeminiClient(apiKey)!;
    const model = client.getGenerativeModel({ model: modelId });

    const result = await model.generateContent([
      { text: SELLING_ANGLES_PROMPT },
      { fileData: { mimeType: preparedFile.mimeType, fileUri: preparedFile.fileUri } },
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      status: "COMPLETE",
      angles: Array.isArray(parsed.sellingAngles) ? parsed.sellingAngles : [],
      primaryAngle: parsed.primaryAngle ?? null,
      confidence: (parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW" ? parsed.confidence : "LOW"),
      modelId,
      analysisTimestamp: now,
      limitations: [],
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "ANALYSIS_FAILED",
      angles: [],
      primaryAngle: null,
      confidence: "NONE",
      modelId,
      analysisTimestamp: now,
      limitations: [`Angle extraction failed: ${redactSecrets(errMsg)}`],
    };
  } finally {
    if (preparedFile) {
      await preparedFile.cleanup().catch(() => {});
    }
  }
}

/**
 * Classifies whether a video creative is likely evergreen or trend-driven.
 */
export async function classifyEvergreenCreative(
  videoUrl: string | null | undefined
): Promise<{
  status: GeminiAnalysisStatus;
  classification: "EVERGREEN" | "TREND_DRIVEN" | "INSUFFICIENT_EVIDENCE" | null;
  rationale: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  modelId: string;
  analysisTimestamp: string;
  limitations: string[];
}> {
  const result = await analyzeVideoWithGemini(videoUrl);

  return {
    status: result.status,
    classification: (result.evergreenClassification as "EVERGREEN" | "TREND_DRIVEN" | "INSUFFICIENT_EVIDENCE") || null,
    rationale: result.evergreenRationale,
    confidence: result.confidence,
    modelId: result.modelId,
    analysisTimestamp: result.analysisTimestamp,
    limitations: result.limitations,
  };
}
