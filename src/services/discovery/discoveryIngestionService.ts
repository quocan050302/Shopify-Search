/**
 * SWAI V9 — Discovery Transactional Ingestion Pipeline
 *
 * Implements atomic, idempotent ingestion for discovered advertisement records:
 * 1. Checks stable identity hash first, avoiding cross-platform collisions.
 * 2. Preserves first observation timestamps upon repeat discoveries.
 * 3. Records source-backed metric observations (CTR, likes, CVR).
 * 4. Records lifecycle events and factual UNKNOWN observation state.
 * 5. Reuses existing Prisma transactions for atomic multi-table integrity.
 */

import { prisma } from "@/lib/db";
import { NormalizedDiscoveredAd } from "./types";
import { calculateAdLongevity } from "@/services/evergreen/longevityEngine";
import { generateStableSourceHash } from "@/services/tiktok/tiktokUrlParser";

export interface IngestionContext {
  workspaceId: string;
  jobId?: string;
  discoveryRunId?: string;
  providerId: string;
  runMode?: "MANUAL" | "SCHEDULED" | "DRY_RUN";
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
    try {
      const stableIdentityHash =
        record.stableIdentityHash ||
        generateStableSourceHash(
          record.platform || "TIKTOK",
          record.providerId || context.providerId || "tiktok-topads",
          record.sourceExternalId || record.creativeUrl
        );

      const adId = await prisma.$transaction(async (tx) => {
        // 1. Check for existing ad by stable identity hash or external ad ID
        const existingIdentity = await tx.adSourceIdentity.findUnique({
          where: { stableIdentityHash },
          include: { ad: true },
        });

        let targetAd = existingIdentity?.ad || null;

        if (!targetAd && record.sourceExternalId) {
          targetAd = await tx.competitorAd.findUnique({
            where: { externalAdId: record.sourceExternalId },
          });
        }

        if (!targetAd) {
          targetAd = await tx.competitorAd.findFirst({
            where: { originalAdUrl: record.creativeUrl },
          });
        }

        // 2. Ensure DataSource exists
        let dataSource = await tx.dataSource.findFirst({
          where: { name: "TIKTOK_CREATIVE_CENTER" },
        });

        if (!dataSource) {
          dataSource = await tx.dataSource.create({
            data: {
              name: "TIKTOK_CREATIVE_CENTER",
              displayName: "TikTok Creative Center",
              description: "Official public TikTok Creative Center Top Ads intelligence portal.",
              status: "AVAILABLE",
              capabilities: JSON.stringify(["TOP_ADS_RESEARCH", "AUTO_DISCOVERY", "COMMERCIAL_RANKING"]),
              supportedRegions: JSON.stringify(["US"]),
            },
          });
        }

        // 3. Upsert Advertiser
        let advertiser = await tx.advertiser.findFirst({
          where: {
            platform: "TIKTOK",
            name: record.advertiserName,
          },
        });

        if (!advertiser) {
          advertiser = await tx.advertiser.create({
            data: {
              name: record.advertiserName,
              platform: "TIKTOK",
              externalId: record.advertiserExternalId || null,
              country: record.targetMarket || "US",
              verifiedStatus: "OBSERVED",
            },
          });
        }

        const now = new Date();

        if (!targetAd) {
          // 4A. Create NEW CompetitorAd
          targetAd = await tx.competitorAd.create({
            data: {
              advertiserId: advertiser.id,
              dataSourceId: dataSource.id,
              externalAdId: record.sourceExternalId || undefined,
              platform: "TIKTOK",
              targetMarket: record.targetMarket,
              headline: record.headline || `Top Ad: ${record.sourceExternalId || "Creative"}`,
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
              dataConfidence: "OBSERVED",
              sourceReportedStartAt: record.sourceReportedStartAt || null,
              sourceReportedEndAt: record.sourceReportedEndAt || null,
            },
          });

          summary.newUniqueInserted++;
          summary.newUniqueCount++;
        } else {
          // 4B. Update EXISTING CompetitorAd (Preserve firstSeenAt!)
          targetAd = await tx.competitorAd.update({
            where: { id: targetAd.id },
            data: {
              lastSeenAt: now,
              lastObservedAt: now,
              observationCount: { increment: 1 },
              // Update landing page and headline if previously missing
              headline: targetAd.headline ? targetAd.headline : record.headline || undefined,
              landingPageUrl: targetAd.landingPageUrl ? targetAd.landingPageUrl : record.landingPageUrl || undefined,
            },
          });

          summary.existingUpdated++;
          summary.existingCount++;
        }

        // 5. Upsert AdSourceIdentity (Composite Identity Mapping)
        await tx.adSourceIdentity.upsert({
          where: { stableIdentityHash },
          create: {
            adId: targetAd.id,
            platform: "TIKTOK",
            providerId: record.providerId,
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

        // 6. Upsert Media Asset
        const existingMedia = await tx.adMediaAsset.findFirst({
          where: { adId: targetAd.id },
        });

        if (!existingMedia) {
          await tx.adMediaAsset.create({
            data: {
              adId: targetAd.id,
              mediaType: "VIDEO",
              videoUrl: record.videoUrl || null,
              embedUrl: record.embedUrl || null,
              thumbnailUrl: record.thumbnailUrl || null,
              durationSeconds: record.durationSeconds || null,
              aspectRatio: record.aspectRatio || "9:16",
              availability: record.mediaAvailability,
              source: record.embedUrl ? "OFFICIAL_EMBED" : "SOURCE_ONLY",
            },
          });
        } else if (record.videoUrl && !existingMedia.videoUrl) {
          await tx.adMediaAsset.update({
            where: { id: existingMedia.id },
            data: {
              videoUrl: record.videoUrl,
              thumbnailUrl: record.thumbnailUrl || existingMedia.thumbnailUrl,
              availability: "READY",
            },
          });
        }

        // 7. Add Factual Ad Observation (UNKNOWN status)
        await tx.adObservation.create({
          data: {
            adId: targetAd.id,
            observedAt: now,
            observationStatus: "UNKNOWN", // Rule 80: unverified discovery is UNKNOWN
            evidenceType: "API_SYNC",
            verificationMethod: "DISCOVERY_INDEX_OBSERVED",
            evidenceReference: record.creativeUrl,
            confidence: record.confidenceScore,
            rawPayload: JSON.stringify({
              providerId: record.providerId,
              metrics: record.reportedMetrics,
              sourceExternalId: record.sourceExternalId,
            }),
          },
        });

        // 8. Add Metric Observations
        if (record.reportedMetrics.likes != null) {
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

        if (record.reportedMetrics.ctr != null) {
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

        if (record.reportedMetrics.cvr != null) {
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
            notes: `Discovered by ${record.providerId} in ${record.targetMarket} market.`,
          },
        });

        // 10. Compute Initial Evergreen Classification
        const longevity = calculateAdLongevity({
          adId: targetAd.id,
          platform: "TIKTOK",
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

        return targetAd.id;
      });

      summary.adIds.push(adId);
    } catch (err: unknown) {
      summary.failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push({
        identityHash: record.stableIdentityHash,
        error: msg,
      });
      console.warn(`Failed to ingest discovered ad [${record.stableIdentityHash}]:`, msg);
    }
  }

  return summary;
}
