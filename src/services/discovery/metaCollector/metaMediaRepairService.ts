/**
 * SWAI V11.2 — Meta Creative Thumbnail Repair Service
 *
 * Scans existing database advertisements for missing creative media (null thumbnails),
 * matches them against stored upstream MetaAdsCollector detailed records, and updates
 * legitimate media without duplicating records, incrementing "New Ads", or creating fake URLs.
 */

import path from "path";
import fs from "fs";
import { createClient as createLibsqlClient } from "@libsql/client";
import { prisma } from "@/lib/db";
import { upsertVerifiedAdMedia } from "@/services/discovery/discoveryIngestionService";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import { NormalizedDiscoveredAd } from "@/services/discovery/types";
import { createMetaCollectorClient } from "./metaCollectorMcpClient";

export interface MediaRepairOptions {
  platform?: "META";
  limit?: number; // Bounded, default 5
  onlyVerified?: boolean;
  dryRun?: boolean; // Default true for safety
  allowNetworkEnrich?: boolean; // Default false
  targetAdIds?: string[];
  targetExternalAdIds?: string[];
}

export interface MediaRepairCandidate {
  adId: string;
  externalAdId: string;
  headline: string | null;
  currentThumbnailUrl: string | null;
  currentVideoUrl: string | null;
  currentMediaType: string | null;
  recoveredThumbnailUrl?: string | null;
  recoveredVideoUrl?: string | null;
  recoveredMediaType?: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  recoveredAspectRatio?: string | null;
  source: "MCP_STORED_DETAILED" | "NETWORK_INSPECT" | "NONE";
  status: "READY" | "RESTRICTED" | "EXPIRED" | "UNAVAILABLE";
  error?: string;
}

export interface MediaRepairSummary {
  adsScanned: number;
  missingMediaCount: number;
  foundRealThumbnailUrlCount: number;
  repairedSuccessfullyCount: number;
  expiredOrRestrictedCount: number;
  stillUnavailableCount: number;
  failedCount: number;
  dryRun: boolean;
  candidates: MediaRepairCandidate[];
}

/**
 * Finds ads currently missing thumbnails in the SWAI database (Phase 5, Item 55).
 */
export async function findAdsMissingMedia(
  options: {
    platform?: "META";
    limit?: number;
    onlyVerified?: boolean;
    targetAdIds?: string[];
    targetExternalAdIds?: string[];
  } = {}
): Promise<MediaRepairCandidate[]> {
  const platform = options.platform || "META";
  const limit = Math.min(100, Math.max(1, options.limit || 50));

  const where: any = {
    platform,
    isSyntheticQuarantine: false,
    AND: [
      { NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } } },
      { NOT: { externalAdId: { startsWith: "meta_demo_" } } },
    ],
  };

  if (options.onlyVerified) {
    where.dataConfidence = "VERIFIED";
  }

  if (options.targetAdIds && options.targetAdIds.length > 0) {
    where.id = { in: options.targetAdIds };
  }

  if (options.targetExternalAdIds && options.targetExternalAdIds.length > 0) {
    where.externalAdId = { in: options.targetExternalAdIds };
  }

  const ads = await prisma.competitorAd.findMany({
    where,
    include: {
      mediaAssets: true,
    },
    take: limit * 2, // Take larger batch to filter for missing media
    orderBy: { createdAt: "desc" },
  });

  const candidates: MediaRepairCandidate[] = [];

  for (const ad of ads) {
    if (!ad.externalAdId) continue;

    const primaryMedia = ad.mediaAssets[0];
    const hasThumb = primaryMedia?.thumbnailUrl && primaryMedia.thumbnailUrl.trim().length > 0;

    // Check if thumbnail is missing or unusable
    if (!hasThumb) {
      candidates.push({
        adId: ad.id,
        externalAdId: ad.externalAdId,
        headline: ad.headline,
        currentThumbnailUrl: primaryMedia?.thumbnailUrl || null,
        currentVideoUrl: primaryMedia?.videoUrl || null,
        currentMediaType: primaryMedia?.mediaType || null,
        source: "NONE",
        status: "UNAVAILABLE",
      });

      if (candidates.length >= limit) {
        break;
      }
    }
  }

  return candidates;
}

/**
 * Executes media repair on candidates:
 * 1. Reads local MCP state.sqlite3 first (zero network overhead).
 * 2. Matches by exact Meta Library ID.
 * 3. Recovers genuine source-backed creative URLs.
 * 4. In dry-run mode, previews changes.
 * 5. In commit mode, updates AdMediaAsset atomically without creating new ads or incrementing counters.
 */
export async function repairMissingThumbnails(
  options: MediaRepairOptions = {}
): Promise<MediaRepairSummary> {
  const dryRun = options.dryRun !== false; // Default true!
  const limit = Math.min(50, Math.max(1, options.limit || 5)); // Safe bounded default (Phase 5, Item 63)
  const allowNetworkEnrich = Boolean(options.allowNetworkEnrich);

  const candidates = await findAdsMissingMedia({
    platform: options.platform || "META",
    limit,
    onlyVerified: options.onlyVerified,
    targetAdIds: options.targetAdIds,
    targetExternalAdIds: options.targetExternalAdIds,
  });

  const summary: MediaRepairSummary = {
    adsScanned: candidates.length,
    missingMediaCount: candidates.length,
    foundRealThumbnailUrlCount: 0,
    repairedSuccessfullyCount: 0,
    expiredOrRestrictedCount: 0,
    stillUnavailableCount: 0,
    failedCount: 0,
    dryRun,
    candidates: [],
  };

  if (candidates.length === 0) {
    return summary;
  }

  // 1. Open local MCP SQLite state database
  const mcpDbPath = path.resolve(process.cwd(), "services", "meta-ads-collector", "data", "state.sqlite3");
  let libsqlClient: ReturnType<typeof createLibsqlClient> | null = null;
  if (fs.existsSync(mcpDbPath)) {
    try {
      libsqlClient = createLibsqlClient({ url: `file:${mcpDbPath}` });
    } catch (dbErr) {
      console.warn("[MediaRepair] Could not open MCP state.sqlite3 directly:", dbErr);
    }
  }

  // Process one media candidate at a time (Phase 5, Item 64)
  for (const candidate of candidates) {
    try {
      let recoveredAd: NormalizedDiscoveredAd | null = null;

      // Step A: Check local MCP state.sqlite3
      if (libsqlClient) {
        try {
          const res = await libsqlClient.execute({
            sql: "SELECT record FROM ads WHERE ad_id = ? LIMIT 1",
            args: [candidate.externalAdId],
          });
          if (res.rows.length > 0 && typeof res.rows[0].record === "string") {
            const parsed = JSON.parse(res.rows[0].record);
            recoveredAd = normalizeMetaCollectorAd(parsed, {
              queryMarket: "US",
            });
            candidate.source = "MCP_STORED_DETAILED";
          }
        } catch (readErr: unknown) {
          console.warn(`[MediaRepair] Failed reading stored record for ${candidate.externalAdId}:`, readErr);
        }
      }

      // Step B: Optional bounded network inspection if missing in local state and permitted
      if (!recoveredAd && allowNetworkEnrich) {
        try {
          const mcpClient = await createMetaCollectorClient();
          try {
            // Find recent job id if available
            const jobsRes = await libsqlClient?.execute("SELECT id FROM jobs ORDER BY created DESC LIMIT 1");
            const jobId = (jobsRes?.rows[0]?.id as string) || "repair_job";
            const inspected = await mcpClient.inspectAds(jobId, [candidate.externalAdId], {
              enrich: true,
              downloadMedia: false,
            });
            if (inspected.length > 0 && inspected[0].ad) {
              recoveredAd = normalizeMetaCollectorAd(inspected[0].ad, {
                queryMarket: "US",
              });
              candidate.source = "NETWORK_INSPECT";
            }
          } finally {
            await mcpClient.close().catch(() => {});
          }
        } catch (netErr: unknown) {
          candidate.error = (netErr as Error).message;
        }
      }

      // Step C: Evaluate recovered media
      if (recoveredAd && recoveredAd.thumbnailUrl) {
        candidate.recoveredThumbnailUrl = recoveredAd.thumbnailUrl;
        candidate.recoveredVideoUrl = recoveredAd.videoUrl || null;
        candidate.recoveredMediaType = recoveredAd.mediaType;
        candidate.recoveredAspectRatio = recoveredAd.aspectRatio;
        candidate.status = "READY";
        summary.foundRealThumbnailUrlCount++;

        // Step D: Commit update if not dry-run
        if (!dryRun) {
          await prisma.$transaction(async (tx) => {
            await upsertVerifiedAdMedia(tx, candidate.adId, recoveredAd);
          });
          summary.repairedSuccessfullyCount++;
        }
      } else if (recoveredAd) {
        // Record was found, but media is genuinely absent or restricted at source
        candidate.status = "RESTRICTED";
        summary.expiredOrRestrictedCount++;
      } else {
        // Not found in stored records and no network recovery
        candidate.status = "UNAVAILABLE";
        summary.stillUnavailableCount++;
      }

      summary.candidates.push(candidate);
    } catch (candErr: unknown) {
      summary.failedCount++;
      candidate.error = (candErr as Error).message;
      summary.candidates.push(candidate);
    }
  }

  return summary;
}
