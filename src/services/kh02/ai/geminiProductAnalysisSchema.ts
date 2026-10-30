/**
 * SWAI KH-02 V12.4 — Gemini Product Analysis Structured Output Schema
 *
 * Provides authoritative Zod schema for server-side validation and
 * official @google/genai Type schema for structured JSON output.
 */

import { z } from "zod";
import { Type } from "@google/genai";
import {
  CommercialEntityType,
  NicheRelevanceLevel,
  GeminiProductIntelligenceResult,
} from "./aiProductIntelligenceTypes";

export const CommercialEntityTypeSchema = z.enum([
  "PHYSICAL_PRODUCT",
  "DIGITAL_PRODUCT",
  "SERVICE",
  "INSURANCE",
  "INFORMATIONAL_CONTENT",
  "LEAD_GENERATION",
  "ADVERTISING_CAMPAIGN",
  "UNKNOWN",
]);

export const NicheRelevanceLevelSchema = z.enum([
  "HIGH",
  "MEDIUM",
  "LOW",
  "UNRELATED",
  "UNKNOWN",
]);

export const DirectlyObservedClaimSchema = z.object({
  claim: z.string().min(1),
  sourceRef: z.string().min(1),
  supportingQuote: z.string().min(1),
});

export const GeminiProductIntelligenceZodSchema = z.object({
  candidateId: z.string().min(1),
  commercialEntityType: CommercialEntityTypeSchema,
  suggestedProductName: z.string().nullable().optional().transform((v) => v || null),
  suggestedProductType: z.string().nullable().optional().transform((v) => v || null),
  nicheRelevance: NicheRelevanceLevelSchema,
  isLikelySellableProduct: z.boolean(),
  identityEvidenceRefs: z.array(z.string()).default([]),
  relevanceEvidenceRefs: z.array(z.string()).default([]),
  directlyObservedClaims: z.array(DirectlyObservedClaimSchema).default([]),
  inferredClaims: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  aiConfidence: z.number().min(0).max(1),
  needsHumanReview: z.boolean(),
});

/**
 * Official @google/genai responseSchema definition for structured JSON generation
 */
export const geminiProductIntelligenceResponseSchema = {
  type: Type.OBJECT,
  properties: {
    candidateId: { type: Type.STRING },
    commercialEntityType: {
      type: Type.STRING,
      enum: [
        "PHYSICAL_PRODUCT",
        "DIGITAL_PRODUCT",
        "SERVICE",
        "INSURANCE",
        "INFORMATIONAL_CONTENT",
        "LEAD_GENERATION",
        "ADVERTISING_CAMPAIGN",
        "UNKNOWN",
      ],
    },
    suggestedProductName: { type: Type.STRING },
    suggestedProductType: { type: Type.STRING },
    nicheRelevance: {
      type: Type.STRING,
      enum: ["HIGH", "MEDIUM", "LOW", "UNRELATED", "UNKNOWN"],
    },
    isLikelySellableProduct: { type: Type.BOOLEAN },
    identityEvidenceRefs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    relevanceEvidenceRefs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    directlyObservedClaims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claim: { type: Type.STRING },
          sourceRef: { type: Type.STRING },
          supportingQuote: { type: Type.STRING },
        },
        required: ["claim", "sourceRef", "supportingQuote"],
      },
    },
    inferredClaims: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    contradictions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    uncertainties: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    aiConfidence: { type: Type.NUMBER },
    needsHumanReview: { type: Type.BOOLEAN },
  },
  required: [
    "candidateId",
    "commercialEntityType",
    "nicheRelevance",
    "isLikelySellableProduct",
    "identityEvidenceRefs",
    "relevanceEvidenceRefs",
    "directlyObservedClaims",
    "inferredClaims",
    "contradictions",
    "uncertainties",
    "aiConfidence",
    "needsHumanReview",
  ],
};

/**
 * Parses and validates raw AI output string using Zod schema.
 */
export function validateGeminiProductAnalysisOutput(
  rawJson: string | unknown,
  expectedCandidateId?: string
): {
  success: boolean;
  data: GeminiProductIntelligenceResult | null;
  error: string | null;
} {
  try {
    let parsed: any;
    if (typeof rawJson === "string") {
      // Clean possible markdown code fences if model returned them
      const cleanJson = rawJson
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleanJson);
    } else {
      parsed = rawJson;
    }

    const validated = GeminiProductIntelligenceZodSchema.parse(parsed);

    // Verify candidate ID matches requested ID
    if (expectedCandidateId && validated.candidateId !== expectedCandidateId) {
      return {
        success: false,
        data: null,
        error: `Candidate ID mismatch: expected '${expectedCandidateId}', received '${validated.candidateId}'`,
      };
    }

    return {
      success: true,
      data: validated as GeminiProductIntelligenceResult,
      error: null,
    };
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: err?.message || String(err),
    };
  }
}
