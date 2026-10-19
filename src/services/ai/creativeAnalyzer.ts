import { HookType } from "@/types";
import { prisma } from "@/lib/db";
import {
  isSampleOrFakeMedia,
  isStockImage,
} from "@/services/links/linkValidationService";

export interface CreativeAnalysisResult {
  hookType: HookType;
  hookQualityScore: number | null;
  pacingScore: number | null;
  ctaClassification:
    | "SHOP_NOW"
    | "LEARN_MORE"
    | "LIMITED_OFFER"
    | "DISCOUNT"
    | "FREE_SHIPPING"
    | "UNAVAILABLE";
  sellingPoints: string[];
  weaknesses: string[];
  analysisStatus:
    | "COPY_ONLY"
    | "MEDIA_UNAVAILABLE"
    | "AI_PROVIDER_NOT_CONFIGURED"
    | "ANALYSIS_FAILED"
    | "INSUFFICIENT_EVIDENCE"
    | "COMPLETE";
  evidenceSource: string;
  modelVersion?: string;
  originalConcepts: {
    hookConcept: string;
    script15s: string;
    script30s: string;
    ugcAngle: string;
  } | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  warningMessages: string[];
}

/**
 * Classifies the 0-3s hook based on ACTUAL observable ad copy text.
 * Does NOT claim to have inspected video frames when no video was analyzed.
 */
export function classifyCreativeHook(content: string): {
  hookType: HookType;
  confidence: number;
  triggerPhrase: string;
  evidenceSource: "COPY_TEXT";
} {
  const lower = content.toLowerCase();

  if (
    lower.includes("stop") ||
    lower.includes("struggling with") ||
    lower.includes("pain") ||
    lower.includes("problem") ||
    lower.includes("tired of") ||
    lower.includes("hate")
  ) {
    return {
      hookType: "Problem-First",
      confidence: 0.75,
      triggerPhrase: "Pain-point keyword detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  if (
    lower.includes("i bet you didn't know") ||
    lower.includes("secret") ||
    lower.includes("nobody talks about") ||
    lower.includes("didn't know")
  ) {
    return {
      hookType: "Curiosity",
      confidence: 0.7,
      triggerPhrase: "Curiosity gap keyword detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  if (
    lower.includes("watch this") ||
    lower.includes("look what happens") ||
    lower.includes("insane") ||
    lower.includes("you won't believe")
  ) {
    return {
      hookType: "Surprise",
      confidence: 0.7,
      triggerPhrase: "Surprise/spectacle keyword detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  if (
    lower.includes("changed my life") ||
    lower.includes("honest review") ||
    lower.includes("i tried") ||
    lower.includes("my experience")
  ) {
    return {
      hookType: "UGC Testimonial",
      confidence: 0.72,
      triggerPhrase: "First-person testimonial language detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  if (lower.includes("before") && lower.includes("after")) {
    return {
      hookType: "Transformation",
      confidence: 0.8,
      triggerPhrase: "Before-and-after contrast detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  if (
    lower.includes("how it works") ||
    lower.includes("step 1") ||
    lower.includes("demo") ||
    lower.includes("watch how")
  ) {
    return {
      hookType: "Product Demonstration",
      confidence: 0.72,
      triggerPhrase: "Product demonstration language detected in ad copy",
      evidenceSource: "COPY_TEXT",
    };
  }

  return {
    hookType: "Emotional",
    confidence: 0.5,
    triggerPhrase: "No specific hook pattern; defaulting to Emotional — LOW confidence",
    evidenceSource: "COPY_TEXT",
  };
}

/**
 * Analyzes an ad creative.
 *
 * IMPORTANT: This is COPY-ONLY analysis unless a configured AI provider is
 * provided with actual accessible media. Hardcoded scores (88, 82) have been
 * removed. Video frames are NOT inspected in this version.
 *
 * Analysis status is always clearly reported to the caller.
 */
export async function analyzeAdCreative(
  adId: string
): Promise<CreativeAnalysisResult> {
  const ad = await prisma.competitorAd.findUnique({
    where: { id: adId },
    include: {
      mediaAssets: true,
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!ad) {
    throw new Error(`Ad not found with ID: ${adId}`);
  }

  const warnings: string[] = [];
  const media = ad.mediaAssets?.[0];

  // Return existing analysis if already performed
  if (ad.analyses && ad.analyses.length > 0) {
    const existing = ad.analyses[0];

    // Warn if existing analysis was generated with hardcoded values
    const isLegacyFake =
      existing.hookQualityScore === 88 && existing.pacingScore === 82;
    if (isLegacyFake) {
      warnings.push(
        "WARNING: This analysis was generated with hardcoded scores (88/82) and is NOT based on actual video inspection."
      );
    }

    let concepts = null;
    try {
      if (existing.scriptIdeas) {
        concepts = JSON.parse(existing.scriptIdeas);
      }
    } catch {
      // fallback
    }

    return {
      hookType: existing.hookType as HookType,
      hookQualityScore: isLegacyFake ? null : existing.hookQualityScore,
      pacingScore: isLegacyFake ? null : existing.pacingScore,
      ctaClassification: (existing.ctaClassification as any) || "UNAVAILABLE",
      sellingPoints: JSON.parse(existing.sellingPoints || "[]"),
      weaknesses: isLegacyFake
        ? [
            "LEGACY ANALYSIS — weaknesses were NOT observed from actual video",
          ]
        : JSON.parse(existing.weaknesses || "[]"),
      analysisStatus: isLegacyFake ? "COPY_ONLY" : "COPY_ONLY",
      evidenceSource: "AD_COPY_TEXT_ONLY",
      modelVersion: existing.modelVersion || undefined,
      originalConcepts: concepts,
      confidence: isLegacyFake ? "NONE" : "LOW",
      warningMessages: warnings,
    };
  }

  // Check if video media is a sample/fake
  const hasSampleMedia = isSampleOrFakeMedia(media?.videoUrl);
  const hasStockThumbnail = isStockImage(media?.thumbnailUrl);

  if (hasSampleMedia) {
    warnings.push(
      "Video URL points to a Google sample video, NOT a real advertisement creative. No video analysis was performed."
    );
  }

  if (hasStockThumbnail) {
    warnings.push(
      "Thumbnail is a stock image (Unsplash/Pexels), NOT the actual ad creative thumbnail."
    );
  }

  // Perform copy-only analysis on the ad text
  const sampleText = `${ad.headline || ""} ${ad.bodyText || ""} ${
    ad.callToAction || ""
  }`.trim();

  if (!sampleText) {
    const result: CreativeAnalysisResult = {
      hookType: "Emotional",
      hookQualityScore: null,
      pacingScore: null,
      ctaClassification: "UNAVAILABLE",
      sellingPoints: [],
      weaknesses: [],
      analysisStatus: "INSUFFICIENT_EVIDENCE",
      evidenceSource: "NO_COPY_TEXT",
      originalConcepts: null,
      confidence: "NONE",
      warningMessages: [
        "No headline, body text, or CTA found. Cannot perform any analysis.",
        ...warnings,
      ],
    };
    return result;
  }

  const hookInfo = classifyCreativeHook(sampleText);

  // Determine CTA classification
  const ctaLower = (ad.callToAction || "").toLowerCase();
  let ctaClassification: CreativeAnalysisResult["ctaClassification"] =
    "SHOP_NOW";
  if (ctaLower.includes("learn")) ctaClassification = "LEARN_MORE";
  else if (ctaLower.includes("discount") || ctaLower.includes("off"))
    ctaClassification = "DISCOUNT";
  else if (ctaLower.includes("free shipping"))
    ctaClassification = "FREE_SHIPPING";
  else if (ctaLower.includes("limited") || ctaLower.includes("claim"))
    ctaClassification = "LIMITED_OFFER";
  else if (!ctaLower) ctaClassification = "UNAVAILABLE";

  // Build copy-derived selling points only from what we can observe
  const sellingPoints: string[] = [];
  if (ad.headline)
    sellingPoints.push(`Observed headline: "${ad.headline.substring(0, 80)}"`);
  if (ad.callToAction)
    sellingPoints.push(`Call-to-action: "${ad.callToAction}"`);

  const weaknesses: string[] = [
    "Video creative was NOT analyzed — no pacing or visual hook assessment available",
    "Hook quality score is unavailable without actual video frame analysis",
  ];
  if (hasSampleMedia) {
    weaknesses.push(
      "Stored video URL is a demonstration sample, not the real advertising creative"
    );
  }

  // Generate conceptual suggestions based on category (not claiming to be video analysis)
  const concepts = {
    hookConcept: `Based on "${ad.category}" category patterns — consider a curiosity or problem-first hook that addresses the core consumer pain point in the first 2 seconds.`,
    script15s: `[0-3s]: Address the primary pain point directly.\n[4-10s]: Show the product solving the problem.\n[11-15s]: Clear CTA: "${ad.callToAction || "Shop Now"}"`,
    script30s: `[0-3s]: Hook — core problem callout.\n[4-12s]: Agitate the problem, then introduce the solution.\n[13-22s]: Demonstrate product benefits.\n[23-30s]: Offer + CTA: "${ad.callToAction || "Shop Now"}"`,
    ugcAngle: `First-person testimonial angle: authentic review of the ${ad.category.toLowerCase()} product with before/after result.`,
  };

  const analysis: CreativeAnalysisResult = {
    hookType: hookInfo.hookType,
    hookQualityScore: null, // No video inspection — cannot score
    pacingScore: null, // No video inspection — cannot score
    ctaClassification,
    sellingPoints,
    weaknesses,
    analysisStatus: "COPY_ONLY",
    evidenceSource: "AD_COPY_TEXT_ONLY",
    modelVersion: "swai-copy-analyzer-v6.1",
    originalConcepts: concepts,
    confidence: hookInfo.confidence >= 0.7 ? "LOW" : "NONE",
    warningMessages: [
      "COPY-ONLY analysis. Hook type is inferred from text — actual video frames were NOT inspected.",
      "Scores for hook quality and pacing are unavailable without real video access.",
      ...warnings,
    ],
  };

  // Persist the honest analysis result
  await prisma.creativeAnalysis.create({
    data: {
      adId,
      modelVersion: "swai-copy-analyzer-v6.1",
      hookType: analysis.hookType,
      // Store null for these — the old 88/82 hardcoded values are removed
      hookQualityScore: 0,
      pacingScore: 0,
      ctaClassification: analysis.ctaClassification,
      sellingPoints: JSON.stringify(analysis.sellingPoints),
      weaknesses: JSON.stringify(analysis.weaknesses),
      scriptIdeas: JSON.stringify(analysis.originalConcepts),
    },
  });

  return analysis;
}
