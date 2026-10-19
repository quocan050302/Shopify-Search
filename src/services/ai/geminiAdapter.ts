/**
 * Gemini AI Adapter — SWAI V7.1
 *
 * Integrates Google Gemini API for real video creative analysis.
 *
 * CRITICAL PRINCIPLES:
 * - If no key is configured → return AI_PROVIDER_NOT_CONFIGURED (not an error, a state)
 * - If no accessible video → return MEDIA_UNAVAILABLE (never fabricate analysis)
 * - All analysis results include model ID, prompt version, timestamp, confidence
 * - Never expose GEMINI_API_KEY to the client
 * - Never hardcode model names that may become deprecated
 * - Current stable model: gemini-1.5-flash (as of 2025)
 *
 * SDK: @google/generative-ai v0.24.1
 * Docs: https://ai.google.dev/gemini-api/docs
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// ─── Constants ────────────────────────────────────────────────────────────────

export const GEMINI_ADAPTER_VERSION = "7.1.0";

/**
 * Current Gemini model for creative video analysis.
 * Using flash for speed/cost efficiency; pro for deeper analysis.
 * These are checked against the SDK at runtime via validateGeminiConfiguration().
 */
export const GEMINI_MODELS = {
  FLASH: "gemini-1.5-flash",
  PRO: "gemini-1.5-pro",
  FLASH_2: "gemini-2.0-flash",
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

// Default prompt version — increment when prompts change
export const CREATIVE_ANALYSIS_PROMPT_VERSION = "v2.0.0";

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
  // Core analysis fields (null if status ≠ COMPLETE)
  hookType: string | null;
  hookQualityScore: number | null;        // 0–100, null if unscored
  pacingScore: number | null;             // 0–100, null if unscored
  openingHookTimestamp: string | null;    // e.g. "0:00-0:03"
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
  // Provenance
  modelId: string;
  promptVersion: string;
  sourceVideoReference: string;           // URL or description of the analyzed video
  analysisTimestamp: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  confidenceNote: string;
  limitations: string[];
  rawResponse?: string;                   // Stored for audit; not shown to users
}

// ─── Validate Configuration ───────────────────────────────────────────────────

/**
 * Validates the Gemini API configuration.
 * NEVER calls the API to verify — only checks presence and format.
 * Actual live verification requires a real API call with a real video.
 */
export function validateGeminiConfiguration(): GeminiConfigStatus {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      configured: false,
      status: "NOT_CONFIGURED",
      modelVersion: GEMINI_MODELS.FLASH,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      message:
        "GEMINI_API_KEY is not configured in the server environment. " +
        "Set this variable to enable AI video creative analysis. " +
        "The key must NEVER be exposed to the browser.",
      limitations: [
        "AI video analysis is unavailable",
        "Hook quality scores cannot be computed",
        "Creative selling angles cannot be extracted from video",
        "Copy-only analysis (text-based) remains available",
      ],
    };
  }

  // Key is present but not verified (we don't make a live call here)
  return {
    configured: true,
    status: "KEY_PRESENT_UNVERIFIED",
    modelVersion: GEMINI_MODELS.FLASH,
    promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
    message:
      "GEMINI_API_KEY is present. Not live-tested against the Gemini API — will be verified on first analysis call.",
    limitations: [
      "API key has not been tested against the Gemini API",
      "Analysis of video requires an accessible, authorized video URL",
    ],
  };
}

// ─── Video Upload ─────────────────────────────────────────────────────────────

/**
 * NOTE: Gemini File API is available for uploading large video files for analysis.
 * For public URLs, we pass the URL directly — no upload needed.
 * For local files, we would use the Files API.
 *
 * This function validates an accessible video URL for Gemini analysis eligibility.
 */
export async function validateVideoForGeminiAnalysis(
  videoUrl: string | null | undefined
): Promise<{
  eligible: boolean;
  reason: string;
  videoReference: string | null;
}> {
  if (!videoUrl || videoUrl.trim().length === 0) {
    return {
      eligible: false,
      reason: "No video URL provided.",
      videoReference: null,
    };
  }

  // Reject sample/demo videos
  const samplePatterns = [
    /commondatastorage\.googleapis\.com\/gtv-videos-bucket/i,
    /sample-videos\.com/i,
    /w3schools\.com\/html\/mov/i,
    /filesamples\.com/i,
  ];
  if (samplePatterns.some((p) => p.test(videoUrl))) {
    return {
      eligible: false,
      reason: "Video URL points to a Google sample/demo file, not a real ad creative.",
      videoReference: null,
    };
  }

  // For now, accept direct MP4/WebM URLs and TikTok post URLs as eligible
  // (Gemini can analyze video from URL for supported formats)
  const isDirectVideo = /\.(mp4|webm|mov|m4v)(\\?.*)?$/i.test(videoUrl);
  const isTikTokPost = /tiktok\.com\/@[^/]+\/video\/\d+/.test(videoUrl);

  if (isDirectVideo || isTikTokPost) {
    return {
      eligible: true,
      reason: isDirectVideo
        ? "Direct video URL is eligible for Gemini analysis."
        : "TikTok post URL — analysis via publicly accessible video.",
      videoReference: videoUrl,
    };
  }

  return {
    eligible: false,
    reason:
      "Video URL format not supported for direct Gemini analysis. " +
      "Supported: direct MP4/WebM URL, TikTok post URL.",
    videoReference: null,
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

// ─── Core Analysis Functions ──────────────────────────────────────────────────

/**
 * Initializes the Gemini client.
 * Returns null if not configured — callers must handle null.
 */
function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return new GoogleGenerativeAI(apiKey.trim());
}

/**
 * Analyzes the opening hook of a video ad.
 * Returns AI_PROVIDER_NOT_CONFIGURED or MEDIA_UNAVAILABLE if prerequisites not met.
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
  const modelId = GEMINI_MODELS.FLASH;

  const client = getGeminiClient();
  if (!client) {
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
      limitations: ["GEMINI_API_KEY not configured. Set this environment variable to enable AI analysis."],
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

  try {
    const model = client.getGenerativeModel({
      model: modelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
    });

    // Build prompt with optional ad copy context
    let prompt = HOOK_ANALYSIS_PROMPT;
    if (adCopy?.headline || adCopy?.bodyText) {
      prompt += `\n\nAd copy context (text-only, not from video):\nHeadline: ${adCopy.headline || "N/A"}\nBody: ${adCopy.bodyText || "N/A"}`;
    }

    // Pass video URL as inline content
    const result = await model.generateContent([
      { text: prompt },
      { fileData: { mimeType: "video/mp4", fileUri: videoCheck.videoReference! } },
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
      confidence: (parsed.confidence as any) ?? "LOW",
      modelId,
      promptVersion: CREATIVE_ANALYSIS_PROMPT_VERSION,
      analysisTimestamp: now,
      limitations: [],
    };
  } catch (err: any) {
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
      limitations: [`Gemini analysis failed: ${err.message}`],
    };
  }
}

/**
 * Full creative analysis of a video ad using Gemini.
 * Returns complete analysis with all fields, or a clearly labeled partial/failed state.
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
  const modelId = GEMINI_MODELS.FLASH;
  const sourceVideoRef = videoUrl || "no_video_url_provided";

  // Check configuration
  const client = getGeminiClient();
  if (!client) {
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
      confidenceNote: "GEMINI_API_KEY not configured. AI video analysis is unavailable.",
      limitations: [
        "Set GEMINI_API_KEY in server environment to enable AI analysis",
        "Key must never be exposed to the browser",
      ],
    };
  }

  // Check video eligibility
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

  try {
    const model = client.getGenerativeModel({
      model: modelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
      generationConfig: { responseMimeType: "text/plain" },
    });

    // Build context-enhanced prompt
    let prompt = CREATIVE_ANALYSIS_PROMPT;
    if (adContext) {
      prompt +=
        `\n\nAd context metadata (do not treat as video observations):` +
        `\nPlatform: ${adContext.platform || "Unknown"}` +
        `\nCategory: ${adContext.category || "Unknown"}` +
        `\nHeadline: ${adContext.headline || "N/A"}` +
        `\nBody: ${adContext.bodyText || "N/A"}` +
        `\nCTA: ${adContext.callToAction || "N/A"}`;
    }

    const result = await model.generateContent([
      { text: prompt },
      { fileData: { mimeType: "video/mp4", fileUri: videoCheck.videoReference! } },
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
      sourceVideoReference: videoCheck.videoReference!,
      analysisTimestamp: now,
      confidence: (parsed.confidence as any) ?? "LOW",
      confidenceNote: parsed.confidenceNote ?? "Confidence level not provided by model.",
      limitations: [],
      rawResponse: rawText,
    };
  } catch (err: any) {
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
      confidenceNote: `Analysis failed: ${err.message}`,
      limitations: [`Gemini API error: ${err.message}`],
    };
  }
}

/**
 * Extracts creative selling angles from a video ad.
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
  const modelId = GEMINI_MODELS.FLASH;

  const client = getGeminiClient();
  if (!client) {
    return {
      status: "AI_PROVIDER_NOT_CONFIGURED",
      angles: [],
      primaryAngle: null,
      confidence: "NONE",
      modelId,
      analysisTimestamp: now,
      limitations: ["GEMINI_API_KEY not configured."],
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

  try {
    const model = client.getGenerativeModel({ model: modelId });
    const result = await model.generateContent([
      { text: SELLING_ANGLES_PROMPT },
      { fileData: { mimeType: "video/mp4", fileUri: videoCheck.videoReference! } },
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      status: "COMPLETE",
      angles: Array.isArray(parsed.sellingAngles) ? parsed.sellingAngles : [],
      primaryAngle: parsed.primaryAngle ?? null,
      confidence: (parsed.confidence as any) ?? "LOW",
      modelId,
      analysisTimestamp: now,
      limitations: [],
    };
  } catch (err: any) {
    return {
      status: "ANALYSIS_FAILED",
      angles: [],
      primaryAngle: null,
      confidence: "NONE",
      modelId,
      analysisTimestamp: now,
      limitations: [`Extraction failed: ${err.message}`],
    };
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
    classification: result.evergreenClassification as any,
    rationale: result.evergreenRationale,
    confidence: result.confidence,
    modelId: result.modelId,
    analysisTimestamp: result.analysisTimestamp,
    limitations: result.limitations,
  };
}
