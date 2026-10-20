/**
 * POST /api/v1/ads/batch
 *
 * Batch Top Ads & Competitor URL Ingestion — SWAI V7.3
 *
 * Allows researchers to import multiple competitor ad URLs at once (up to 50 URLs).
 * Specifically optimized for TikTok Creative Center US Top Ads batch research.
 *
 * RULES:
 * 1. Validates each genuine TikTok source link.
 * 2. Saves only source-backed metadata (never fabricates run dates or fake metrics).
 * 3. Enforces that Creative Center Top Ads are NOT embeddable (embedUrl = null).
 * 4. Generates official TikTok player embed for organic/ad post links.
 * 5. Never claims 180 days of activity simply because a result appeared in a 180-day search window.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAdSourceUrl } from "@/services/providers/urlResolver";
import { normalizeExternalAdRecord } from "@/services/providers/registry";
import { upsertCompetitorAd } from "@/services/ads/adService";

export interface BatchImportItemResult {
  url: string;
  success: boolean;
  adId?: string;
  platform?: string;
  sourceType?: string;
  isEmbeddable?: boolean;
  externalId?: string;
  targetMarket?: string;
  headline?: string;
  error?: string;
  warning?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls, category = "Other", targetMarket = "US", advertiserName } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_URLS",
            message: "An array of advertisement URLs is required.",
          },
        },
        { status: 400 }
      );
    }

    if (urls.length > 50) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BATCH_SIZE_EXCEEDED",
            message: "Maximum batch import size is 50 URLs per request.",
          },
        },
        { status: 400 }
      );
    }

    const results: BatchImportItemResult[] = [];
    let importedCount = 0;
    let failedCount = 0;

    for (const rawUrl of urls) {
      const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!trimmed) {
        results.push({
          url: "",
          success: false,
          error: "Empty URL skipped.",
        });
        failedCount++;
        continue;
      }

      try {
        const resolution = resolveAdSourceUrl(trimmed);
        if (!resolution.isValid) {
          results.push({
            url: trimmed,
            success: false,
            error: resolution.notes || "Invalid or restricted URL.",
          });
          failedCount++;
          continue;
        }

        // Support official TikTok post embeds where valid (Requirement 7)
        // Never assume TikTok Creative Center ads are embeddable (Requirement 8)
        const embedUrl =
          resolution.platform === "TIKTOK" && resolution.isEmbeddable && resolution.embedUrl
            ? resolution.embedUrl
            : undefined;

        const mediaAvailability = embedUrl ? "READY" : "RESTRICTED";

        // Determine target market honestly (Requirement 6)
        const resolvedMarket =
          targetMarket && targetMarket.trim().length > 0
            ? targetMarket.trim().toUpperCase()
            : resolution.region === "US"
            ? "US"
            : "UNKNOWN";

        // Add warning if search window was 180 days (Requirement 12)
        let warning: string | undefined = undefined;
        if (resolution.searchWindowPeriodDays && resolution.searchWindowPeriodDays >= 30) {
          warning = `Search window was period=${resolution.searchWindowPeriodDays}d. Ad is imported with UNKNOWN runtime — never claiming ${resolution.searchWindowPeriodDays} days without continuous observation.`;
        }

        const validatedAdvertiser =
          advertiserName && advertiserName.trim().length > 0
            ? advertiserName.trim()
            : resolution.authorUsername
            ? `@${resolution.authorUsername}`
            : "UNKNOWN";

        const normalized = normalizeExternalAdRecord(resolution.platform, {
          platform: resolution.platform,
          externalAdId: resolution.externalId,
          advertiserName: validatedAdvertiser,
          headline: `Top Ad: ${resolution.externalId || "Creative"}`,
          bodyText: "",
          callToAction: "",
          landingPageUrl: "",
          originalAdUrl: resolution.canonicalUrl,
          targetMarket: resolvedMarket,
          category: category || "Other",
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          // Status is strictly UNKNOWN until verified active
          status: "UNKNOWN",
          dataConfidence: "OBSERVED",
          mediaType: "VIDEO",
          embedUrl,
          mediaAvailability,
          thumbnailUrl: undefined,
        });

        const savedAd = await upsertCompetitorAd(normalized);
        if (!savedAd) {
          throw new Error("Failed to save ad record to database.");
        }

        results.push({
          url: trimmed,
          success: true,
          adId: savedAd.id,
          platform: resolution.platform,
          sourceType: resolution.sourceType,
          isEmbeddable: Boolean(embedUrl),
          externalId: resolution.externalId,
          targetMarket: resolvedMarket,
          headline: savedAd.headline || undefined,
          warning,
        });

        importedCount++;
      } catch (itemErr: unknown) {
        const msg = itemErr instanceof Error ? itemErr.message : "Failed to ingest ad.";
        results.push({
          url: trimmed,
          success: false,
          error: msg,
        });
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: urls.length,
        importedCount,
        failedCount,
        results,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7.3",
        notice:
          "Batch import completed. Status is UNKNOWN and calendar age is not claimed from search window filters.",
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to process batch import.";
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "BATCH_IMPORT_FAILED",
          message: msg,
        },
      },
      { status: 500 }
    );
  }
}
