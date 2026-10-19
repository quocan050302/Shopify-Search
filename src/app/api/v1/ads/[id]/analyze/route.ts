/**
 * POST /api/v1/ads/[id]/analyze
 *
 * V7.1: Integrated Gemini AI analysis for video ads.
 * Falls back to copy-only analysis when no Gemini key or accessible video.
 * Always reports the analysis status accurately.
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeAdCreative } from "@/services/ai/creativeAnalyzer";
import { analyzeVideoWithGemini, validateGeminiConfiguration } from "@/services/ai/geminiAdapter";
import { prisma } from "@/lib/db";
import { resolveVideoSource } from "@/services/video/videoSourceResolver";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Get ad with media assets
    const ad = await prisma.competitorAd.findUnique({
      where: { id },
      include: { mediaAssets: true },
    });

    if (!ad) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Ad not found." } },
        { status: 404 }
      );
    }

    // Check if Gemini is configured and if we have accessible video
    const geminiConfig = validateGeminiConfiguration();
    const videoSource = resolveVideoSource({
      platform: ad.platform,
      originalAdUrl: ad.originalAdUrl,
      externalAdId: ad.externalAdId,
      mediaAssets: ad.mediaAssets,
    });

    // Determine video URL for Gemini (direct video or TikTok post URL)
    let geminiVideoUrl: string | null = null;
    if (videoSource.strategy === "DIRECT_VIDEO" && videoSource.playbackUrl) {
      geminiVideoUrl = videoSource.playbackUrl;
    } else if (videoSource.strategy === "TIKTOK_OEMBED" && videoSource.sourceUrl) {
      geminiVideoUrl = videoSource.sourceUrl;
    }

    // Attempt Gemini analysis if configured and video accessible
    let geminiResult = null;
    if (geminiConfig.configured && geminiVideoUrl) {
      geminiResult = await analyzeVideoWithGemini(geminiVideoUrl, {
        headline: ad.headline,
        bodyText: ad.bodyText,
        platform: ad.platform,
        category: ad.category,
        callToAction: ad.callToAction,
      });

      // Persist Gemini analysis result
      if (geminiResult.status === "COMPLETE") {
        await prisma.creativeAnalysis.create({
          data: {
            adId: id,
            modelVersion: geminiResult.modelId,
            hookType: geminiResult.hookType || "Emotional",
            hookQualityScore: geminiResult.hookQualityScore ?? 0,
            pacingScore: geminiResult.pacingScore ?? 0,
            ctaClassification: geminiResult.ctaClassification || "UNAVAILABLE",
            sellingPoints: JSON.stringify(geminiResult.sellingAngles),
            weaknesses: JSON.stringify(geminiResult.weaknesses),
            scriptIdeas: JSON.stringify(geminiResult.adScriptConcepts),
            rawAnalysis: JSON.stringify({
              evergreenClassification: geminiResult.evergreenClassification,
              evergreenRationale: geminiResult.evergreenRationale,
              confidence: geminiResult.confidence,
              confidenceNote: geminiResult.confidenceNote,
              promptVersion: geminiResult.promptVersion,
              sourceVideoReference: geminiResult.sourceVideoReference,
              analysisTimestamp: geminiResult.analysisTimestamp,
            }),
          },
        });
      }
    }

    // Always run copy-only analysis as baseline
    const copyAnalysis = await analyzeAdCreative(id);

    const response = {
      success: true,
      data: {
        copyAnalysis,
        geminiAnalysis: geminiResult,
        analysisMode: geminiResult?.status === "COMPLETE"
          ? "GEMINI_VIDEO_ANALYSIS"
          : geminiConfig.configured && geminiVideoUrl
          ? "GEMINI_ATTEMPTED_FAILED"
          : geminiConfig.configured && !geminiVideoUrl
          ? "GEMINI_CONFIGURED_NO_VIDEO"
          : "COPY_ONLY",
        videoAccessStatus: {
          strategy: videoSource.strategy,
          restriction: videoSource.restriction,
          reason: videoSource.reason,
        },
        geminiConfigStatus: geminiConfig.status,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7.1",
        note:
          "All scores are based on observed evidence. " +
          "Copy-only analysis uses ad text only — no video frames inspected. " +
          "Gemini analysis requires GEMINI_API_KEY and accessible video.",
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ANALYSIS_FAILED",
          message: error.message || "Failed to analyze ad creative",
        },
      },
      { status: 500 }
    );
  }
}
