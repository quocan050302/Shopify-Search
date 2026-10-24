/**
 * SWAI V10 — Platform-Aware Discovery Ingestion Pipeline
 *
 * Implements atomic, idempotent, cross-platform ingestion for discovered advertisement records:
 * 1. Checks stable identity hash first, avoiding cross-platform collisions (TikTok vs Meta).
 * 2. Scopes external ad ID lookups by platform to prevent ID space collisions.
 * 3. Preserves first observation timestamps and existing analysis notes upon repeat discoveries.
 * 4. Records source-backed metric observations (CTR, likes, CVR) when present.
 * 5. Uses genuine DataSource attribution: META_AD_LIBRARY (EXTERNAL_AGENT_RESEARCH) or TIKTOK_CREATIVE_CENTER.
 * 6. Records factual UNKNOWN observation state until independently verified active.
 * 7. Transaction-safe outcome counting (increments only after successful transaction commit).
 */

import { prisma } from "@/lib/db";
import { NormalizedDiscoveredAd } from "./types";
import { calculateAdLongevity } from "@/services/evergreen/longevityEngine";
import { generateStableSourceHash } from "@/services/tiktok/tiktokUrlParser";

export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface IngestionContext {
  workspaceId: string;
  jobId?: string;
  discoveryRunId?: string;
  runId?: string;
  providerId: string;
  runMode?: "MANUAL" | "SCHEDULED" | "DRY_RUN" | "SIMULATED";
  isQuarantined?: boolean;
}

export interface IngestionResultSummary {
  totalProcessed: number;
  rawCount: number;
  newUniqueInserted: number;
  newUniqueCount: number;
  existingUpdated: number;
  existingCount: number;
  rejectedCount: number;
  failedCount: number;
  adIds: string[];
  errors: Array<{ identityHash: string; error: string }>;
}

export interface MediaUpsertResult {
  action: "CREATED" | "UPDATED" | "UNCHANGED";
  mediaAssetId: string;
  thumbnailUpdated: boolean;
  videoUpdated: boolean;
}


/**
 * Resolves or creates the appropriate DataSource row for the platform.
 */
export async function getDataSourceForPlatform(
  tx: PrismaTransactionClient,
  platform: "META" | "TIKTOK",
  providerId: string
) {
  void providerId;
  const dataSourceName = platform === "META" ? "META_AD_LIBRARY" : "TIKTOK_CREATIVE_CENTER";
  let dataSource = await tx.dataSource.findFirst({
    where: { name: dataSourceName },
  });

  if (!dataSource) {
    dataSource = await tx.dataSource.create({
      data:
        platform === "META"
          ? {
              name: "META_AD_LIBRARY",
              displayName: "Meta Ad Library",
              description:
                "Public Meta Ad Library research via self-hosted MetaAdsCollector MCP server; ads verified on facebook.com/ads/library.",
              status: "AVAILABLE",
              capabilities: JSON.stringify(["AD_LIBRARY_RESEARCH", "LOCAL_MCP_DISCOVERY", "COMMERCIAL_ADS"]),
              supportedRegions: JSON.stringify(["US"]),
            }
          : {
              name: "TIKTOK_CREATIVE_CENTER",
              displayName: "TikTok Creative Center",
              description: "Official public TikTok Creative Center Top Ads intelligence portal.",
              status: "AVAILABLE",
              capabilities: JSON.stringify(["TOP_ADS_RESEARCH", "AUTO_DISCOVERY", "COMMERCIAL_RANKING"]),
              supportedRegions: JSON.stringify(["US"]),
            },
    });
  }

  return dataSource;
}

/**
 * Finds an existing ad using stable composite identity, with platform isolation.
 */
export async function findExistingAdBySourceIdentity(
  tx: PrismaTransactionClient,
  stableIdentityHash: string,
  platform: string,
  sourceExternalId?: string | null,
  creativeUrl?: string | null
) {
  // 1. Primary lookup by stable identity hash
  const existingIdentity = await tx.adSourceIdentity.findUnique({
    where: { stableIdentityHash },
    include: { ad: true },
  });

  if (existingIdentity?.ad) {
    return existingIdentity.ad;
  }

  // 1B. For META platform: check cross-provider identity hashes (Muse <-> MetaAdsCollector)
  if (platform === "META" && sourceExternalId) {
    const museHash = generateStableSourceHash("META", "muse-ad-library", sourceExternalId);
    const collectorHash = generateStableSourceHash("META", "meta-ads-collector", sourceExternalId);

    const crossProviderIdentity = await tx.adSourceIdentity.findFirst({
      where: {
        platform: "META",
        OR: [
          { stableIdentityHash: museHash },
          { stableIdentityHash: collectorHash },
          { sourceExternalId },
        ],
      },
      include: { ad: true },
    });

    if (crossProviderIdentity?.ad) {
      return crossProviderIdentity.ad;
    }
  }

  // 2. Secondary lookup by externalAdId scoped to same platform
  if (sourceExternalId) {
    const directMatch = await tx.competitorAd.findFirst({
      where: {
        externalAdId: sourceExternalId,
        platform,
      },
    });
    if (directMatch) return directMatch;

    // Check platform-prefixed format
    const prefixedMatch = await tx.competitorAd.findFirst({
      where: {
        externalAdId: `${platform}:${sourceExternalId}`,
        platform,
      },
    });
    if (prefixedMatch) return prefixedMatch;

    // Check if externalAdId contains the Library ID (e.g. meta_..._<id>)
    if (platform === "META") {
      const containsMatch = await tx.competitorAd.findFirst({
        where: {
          platform: "META",
          externalAdId: { contains: sourceExternalId },
        },
      });
      if (containsMatch) return containsMatch;
    }
  }

  // 3. Fallback lookup by exact canonical URL scoped to same platform
  if (creativeUrl) {
    const urlMatch = await tx.competitorAd.findFirst({
      where: { originalAdUrl: creativeUrl, platform },
    });
    if (urlMatch) return urlMatch;
  }

  return null;
}

/**
 * Upserts verified advertisement media asset in the database.
 * Reusable helper (Phase 4, Items 41-53).
 * Ensures thumbnailUrl updates independently of videoUrl, preserves legitimate media,
 * and maintains true mediaType and aspect ratio without overwriting with null.
 */
export async function upsertVerifiedAdMedia(
  tx: PrismaTransactionClient,
  adId: string,
  incoming: NormalizedDiscoveredAd
): Promise<MediaUpsertResult> {
  const existingMedia = await tx.adMediaAsset.findFirst({
    where: { adId },
  });

  const mediaType = incoming.mediaType || (incoming.platform === "META" ? "UNKNOWN" : "VIDEO");
  const incomingAspect = incoming.aspectRatio && incoming.aspectRatio !== "UNKNOWN" ? incoming.aspectRatio : null;

  if (!existingMedia) {
    const isReady = Boolean(incoming.thumbnailUrl || incoming.videoUrl);
    const availability = isReady ? "READY" : (incoming.mediaAvailability || "RESTRICTED");

    const created = await tx.adMediaAsset.create({
      data: {
        adId,
        mediaType,
        videoUrl: incoming.videoUrl || null,
        embedUrl: incoming.embedUrl || null,
        thumbnailUrl: incoming.thumbnailUrl || null,
        durationSeconds: incoming.durationSeconds || null,
        aspectRatio: incomingAspect || (mediaType === "IMAGE" ? "1:1" : "9:16"),
        availability,
        source: incoming.embedUrl ? "OFFICIAL_EMBED" : incoming.thumbnailUrl ? "SOURCE_ONLY" : "FALLBACK_ONLY",
      },
    });

    return {
      action: "CREATED",
      mediaAssetId: created.id,
      thumbnailUpdated: Boolean(incoming.thumbnailUrl),
      videoUpdated: Boolean(incoming.videoUrl),
    };
  }

  // Existing media row exists. Check for legitimate updates without overwriting legitimate values with null.
  const updateData: Record<string, unknown> = {};
  let thumbnailUpdated = false;
  let videoUpdated = false;

  // Rule 42 & 43: If existing thumbnailUrl is missing and incoming has a valid thumbnailUrl, update it.
  // Updating thumbnail must NOT depend on finding a new videoUrl.
  if ((!existingMedia.thumbnailUrl || existingMedia.thumbnailUrl.trim() === "") && incoming.thumbnailUrl) {
    updateData.thumbnailUrl = incoming.thumbnailUrl;
    thumbnailUpdated = true;
  }

  // Update video URL if missing in DB and present in incoming record
  if ((!existingMedia.videoUrl || existingMedia.videoUrl.trim() === "") && incoming.videoUrl) {
    updateData.videoUrl = incoming.videoUrl;
    videoUpdated = true;
  }

  // Update mediaType if previously UNKNOWN and incoming is concrete
  if (existingMedia.mediaType === "UNKNOWN" && mediaType !== "UNKNOWN") {
    updateData.mediaType = mediaType;
  }

  // Update aspect ratio if previously unknown/neutral and incoming is specific
  if (incomingAspect && (!existingMedia.aspectRatio || existingMedia.aspectRatio === "UNKNOWN")) {
    updateData.aspectRatio = incomingAspect;
  }

  // Update duration if previously null
  if (existingMedia.durationSeconds == null && incoming.durationSeconds != null) {
    updateData.durationSeconds = incoming.durationSeconds;
  }

  // Update availability to READY if legitimate media is now available
  const hasValidMedia = Boolean(
    (updateData.thumbnailUrl || existingMedia.thumbnailUrl) ||
    (updateData.videoUrl || existingMedia.videoUrl)
  );
  if (hasValidMedia && existingMedia.availability !== "READY") {
    updateData.availability = "READY";
  }

  if (Object.keys(updateData).length > 0) {
    updateData.updatedAt = new Date();
    await tx.adMediaAsset.update({
      where: { id: existingMedia.id },
      data: updateData,
    });
    return {
      action: "UPDATED",
      mediaAssetId: existingMedia.id,
      thumbnailUpdated,
      videoUpdated,
    };
  }

  return {
    action: "UNCHANGED",
    mediaAssetId: existingMedia.id,
    thumbnailUpdated: false,
    videoUpdated: false,
  };
}

/**
 * Ingests a batch of normalized discovered ads into the SWAI database atomically.
 */
export async function ingestDiscoveredAds(
  records: NormalizedDiscoveredAd[],
  context: IngestionContext
): Promise<IngestionResultSummary> {
  const summary: IngestionResultSummary = {
    totalProcessed: records.length,
    rawCount: records.length,
    newUniqueInserted: 0,
    newUniqueCount: 0,
    existingUpdated: 0,
    existingCount: 0,
    rejectedCount: 0,
    failedCount: 0,
    adIds: [],
    errors: [],
  };

  if (records.length === 0) return summary;

  // Dry run simulation mode: zero database writes
  if (context.runMode === "DRY_RUN") {
    summary.newUniqueInserted = records.length;
    summary.newUniqueCount = records.length;
    return summary;
  }

  // Process each record inside a transaction for safety
  for (const record of records) {
    const platform = record.platform === "META" ? "META" : "TIKTOK";
    const providerId = record.providerId || context.providerId || (platform === "META" ? "meta-ads-collector" : "tiktok-topads");

    const stableIdentityHash =
      record.stableIdentityHash ||
      generateStableSourceHash(
        platform,
        providerId,
        record.sourceExternalId || record.creativeUrl
      );

    try {
      const txResult = await prisma.$transaction(async (tx) => {
        // 1. Check for existing ad by stable identity hash or external ad ID
        let targetAd = await findExistingAdBySourceIdentity(
          tx,
          stableIdentityHash,
          platform,
          record.sourceExternalId,
          record.creativeUrl
        );

        let isNew = false;

        // 2. Ensure DataSource exists (platform-aware)
        const dataSource = await getDataSourceForPlatform(tx, platform, providerId);

        // 3. Upsert Advertiser
        let advertiser = await tx.advertiser.findFirst({
          where: {
            platform,
            name: record.advertiserName,
          },
        });

        if (!advertiser) {
          advertiser = await tx.advertiser.create({
            data: {
              name: record.advertiserName,
              platform,
              externalId: record.advertiserExternalId || null,
              country: record.targetMarket || "US",
              verifiedStatus: "OBSERVED",
            },
          });
        }

        const now = new Date();

        if (!targetAd) {
          isNew = true;

          // Resolve externalAdId safely without cross-platform collision
          let externalAdIdToStore: string | null = null;
          if (record.sourceExternalId) {
            const conflict = await tx.competitorAd.findUnique({
              where: { externalAdId: record.sourceExternalId },
            });
            if (conflict && conflict.platform !== platform) {
              externalAdIdToStore = `${platform}:${record.sourceExternalId}`;
            } else {
              externalAdIdToStore = record.sourceExternalId;
            }
          }

          // 4A. Create NEW CompetitorAd
          targetAd = await tx.competitorAd.create({
            data: {
              advertiserId: advertiser.id,
              dataSourceId: dataSource.id,
              externalAdId: externalAdIdToStore || undefined,
              platform,
              targetMarket: record.targetMarket,
              headline:
                record.headline ||
                (platform === "META"
                  ? `Facebook Ad: ${record.sourceExternalId || "Creative"}`
                  : `Top Ad: ${record.sourceExternalId || "Creative"}`),
              bodyText: record.bodyText || "",
              callToAction: record.callToAction || "",
              landingPageUrl: record.landingPageUrl || "",
              originalAdUrl: record.creativeUrl,
              category: record.industry || "Other",
              firstSeenAt: now,
              lastSeenAt: now,
              firstObservedAt: now,
              lastObservedAt: now,
              observationCount: 1,
              status: "UNKNOWN", // Rule 80: UNKNOWN is strictly preserved
              lifecycleStatus: "UNKNOWN",
              dataConfidence: context.isQuarantined ? "UNVERIFIED" : "OBSERVED",
              isSyntheticQuarantine: Boolean(context.isQuarantined),
              sourceReportedStartAt: record.sourceReportedStartAt || null,
              sourceReportedEndAt: record.sourceReportedEndAt || null,
            },
          });
        } else {
          isNew = false;
          // 4B. Update EXISTING CompetitorAd (Preserve firstSeenAt!)
          targetAd = await tx.competitorAd.update({
            where: { id: targetAd.id },
            data: {
              lastSeenAt: now,
              lastObservedAt: now,
              observationCount: { increment: 1 },
              ...(context.isQuarantined ? { isSyntheticQuarantine: true } : {}),
              // Update landing page and headline if previously missing
              headline: targetAd.headline ? targetAd.headline : record.headline || undefined,
              landingPageUrl: targetAd.landingPageUrl ? targetAd.landingPageUrl : record.landingPageUrl || undefined,
            },
          });
        }

        // 5. Upsert AdSourceIdentity (Composite Identity Mapping)
        await tx.adSourceIdentity.upsert({
          where: { stableIdentityHash },
          create: {
            adId: targetAd.id,
            platform,
            providerId,
            sourceExternalId: record.sourceExternalId || null,
            stableIdentityHash,
            canonicalSourceUrl: record.creativeUrl,
            confidence: record.confidenceScore,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            lastSeenAt: now,
            canonicalSourceUrl: record.creativeUrl,
          },
        });

        // 6. Upsert Media Asset (Phase 4: Reusable verified helper)
        await upsertVerifiedAdMedia(tx, targetAd.id, record);

        // 7. Add Factual Ad Observation (UNKNOWN status)
        const evidenceType = platform === "META" ? "META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION" : "API_SYNC";
        const verificationMethod =
          platform === "META" ? "META_COLLECTOR_GRAPHQL_ENDPOINT" : "DISCOVERY_INDEX_OBSERVED";

        await tx.adObservation.create({
          data: {
            adId: targetAd.id,
            observedAt: now,
            observationStatus: "UNKNOWN", // Rule 80: unverified discovery is UNKNOWN
            evidenceType,
            verificationMethod,
            evidenceReference: record.creativeUrl,
            confidence: record.confidenceScore,
            rawPayload: JSON.stringify({
              providerId,
              platform,
              sourceExternalId: record.sourceExternalId,
              reportedMetrics: record.reportedMetrics,
            }),
          },
        });

        // 8. Add Metric Observations if present
        if (record.reportedMetrics?.likes != null) {
          await tx.adMetricObservation.create({
            data: {
              adId: targetAd.id,
              metricKey: "LIKES",
              metricValue: record.reportedMetrics.likes,
              classification: "OBSERVED",
              observedAt: now,
            },
          });
        }

        if (record.reportedMetrics?.ctr != null) {
          await tx.adMetricObservation.create({
            data: {
              adId: targetAd.id,
              metricKey: "CTR",
              metricValue: record.reportedMetrics.ctr,
              classification: "OBSERVED",
              observedAt: now,
            },
          });
        }

        if (record.reportedMetrics?.cvr != null) {
          await tx.adMetricObservation.create({
            data: {
              adId: targetAd.id,
              metricKey: "CVR",
              metricValue: record.reportedMetrics.cvr,
              classification: "OBSERVED",
              observedAt: now,
            },
          });
        }

        // 9. Add Lifecycle Event
        await tx.adLifecycleEvent.create({
          data: {
            adId: targetAd.id,
            eventType: "AD_DISCOVERED",
            occurredAt: now,
            sourceTimestamp: record.sourceReportedStartAt || null,
            evidenceReference: record.creativeUrl,
            confidence: record.confidenceScore,
            notes: `Discovered by ${providerId} on ${platform} (${record.targetMarket} market).`,
          },
        });

        // 10. Compute Initial Evergreen Classification
        const longevity = calculateAdLongevity({
          adId: targetAd.id,
          platform,
          sourceReportedStartAt: record.sourceReportedStartAt,
          observations: [{ observedAt: now, observationStatus: "UNKNOWN" }],
          searchWindowPeriodDays: 30,
        });

        await tx.competitorAd.update({
          where: { id: targetAd.id },
          data: {
            longevityCategory: longevity.longevityCategory,
          },
        });

        // 11. Record DiscoveryRunAd association (Run <-> Ad Relational Tracking)
        const activeRunId = context.discoveryRunId || context.runId;
        if (activeRunId) {
          await tx.discoveryRunAd.upsert({
            where: {
              runId_adId: {
                runId: activeRunId,
                adId: targetAd.id,
              },
            },
            create: {
              runId: activeRunId,
              adId: targetAd.id,
              workspaceId: context.workspaceId || "default-workspace",
              providerId,
              libraryId: record.sourceExternalId || null,
              ingestOutcome: isNew ? "NEW" : "EXISTING",
              sourceUrl: record.creativeUrl || null,
              observedAt: now,
            },
            update: {
              observedAt: now,
              ingestOutcome: isNew ? "NEW" : "EXISTING",
            },
          });
        }

        return { adId: targetAd.id, isNew };
      });

      // Post-transaction outcome updates (transaction-safe)
      if (txResult.isNew) {
        summary.newUniqueInserted++;
        summary.newUniqueCount++;
      } else {
        summary.existingUpdated++;
        summary.existingCount++;
      }
      summary.adIds.push(txResult.adId);
    } catch (err: unknown) {
      summary.failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push({
        identityHash: stableIdentityHash,
        error: msg,
      });
      console.warn(`Failed to ingest discovered ad [${stableIdentityHash}]:`, msg);
    }
  }

  return summary;
}
