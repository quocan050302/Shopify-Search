/**
 * GET /api/v1/discovery/stats
 *
 * Retrieves discovery performance metrics and worker health.
 *
 * IMPORTANT: totalDiscoveredAds counts ONLY ads that were ingested via a
 * completed DiscoveryRun (i.e. have AdSourceIdentity records from auto-discovery).
 * Manual URL imports and legacy scrapes are NOT included in this count.
 *
 * Worker status (isOnline) is derived from database heartbeat records, not
 * from module-memory state, so it is correct across process restarts.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [
      autoDiscoveredAdsCount,
      totalTikTokAdsCount,
      totalRuns,
      completedRuns,
      blockedRuns,
      activeSchedules,
      latestAutoDiscoveredAd,
      latestActiveRun,
      workerHeartbeatJob,
      latestRun,
    ] = await Promise.all([
      // Only ads that originated from a Discovery run (have an AdSourceIdentity)
      prisma.adSourceIdentity.groupBy({
        by: ["adId"],
        _count: { adId: true },
      }).then((rows) => rows.length),

      // Total TikTok ads in database
      prisma.competitorAd.count({
        where: { platform: "TIKTOK" },
      }),

      prisma.discoveryRun.count(),
      prisma.discoveryRun.count({ where: { status: "COMPLETED" } }),
      prisma.discoveryRun.count({
        where: {
          status: { in: ["BLOCKED_SOURCE", "BUDGET_BLOCKED"] },
        },
      }),
      prisma.discoverySchedule.count({ where: { enabled: true } }),

      // Latest auto-discovered ad (one that has a source identity)
      prisma.adSourceIdentity
        .findFirst({
          orderBy: { firstSeenAt: "desc" },
          select: { firstSeenAt: true },
        }),

      // Active job heartbeat
      prisma.discoveryRun.findFirst({
        where: {
          status: "RUNNING",
          heartbeatAt: { gte: fiveMinutesAgo },
        },
        orderBy: { heartbeatAt: "desc" },
        select: { heartbeatAt: true, providerId: true },
      }),

      // Worker background polling loop heartbeat
      prisma.syncJob.findFirst({
        where: {
          jobType: "DISCOVERY_WORKER_HEARTBEAT",
          startedAt: { gte: fiveMinutesAgo },
          status: "RUNNING",
        },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      }),

      // Latest run for incremental stats
      prisma.discoveryRun.findFirst({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          actualRetrievedCount: true,
          newUniqueCount: true,
          existingDuplicateCount: true,
          createdAt: true,
        },
      }),
    ]);

    const workerOnline = workerHeartbeatJob !== null || latestActiveRun !== null;
    const lastHeartbeat = workerHeartbeatJob?.startedAt || latestActiveRun?.heartbeatAt || null;
    const manualImportedCount = Math.max(0, totalTikTokAdsCount - autoDiscoveredAdsCount);

    return NextResponse.json({
      success: true,
      data: {
        // Count separation (Rule 121)
        totalDiscoveredAds: autoDiscoveredAdsCount,
        totalTikTokAds: totalTikTokAdsCount,
        manualImportedTikTokAds: manualImportedCount,
        latestRunStats: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              retrievedCount: latestRun.actualRetrievedCount,
              newUniqueAds: latestRun.newUniqueCount,
              duplicates: latestRun.existingDuplicateCount,
              createdAt: latestRun.createdAt,
            }
          : null,

        totalRuns,
        completedRuns,
        blockedRuns,
        activeSchedules,
        activeSchedule: activeSchedules > 0,
        lastDiscoveredAt: latestAutoDiscoveredAd?.firstSeenAt ?? null,

        // Worker online state is cross-process via DB heartbeat — NOT module memory
        workerStatus: {
          isOnline: workerOnline,
          isRunning: workerOnline,
          lastHeartbeatAt: lastHeartbeat,
          activeJobsCount: latestActiveRun ? 1 : 0,
          notice: workerOnline
            ? "Worker process detected via database heartbeat."
            : "No active worker process found. Start with: npm run discovery:worker",
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.2",
        note:
          "totalDiscoveredAds counts only auto-discovery ingested ads (AdSourceIdentity). " +
          "manualImportedTikTokAds counts manual imports without source identity.",
      },
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to load discovery statistics.";
    return NextResponse.json(
      { success: false, error: { code: "STATS_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
