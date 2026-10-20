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
      totalRuns,
      completedRuns,
      blockedRuns,
      activeSchedules,
      latestAutoDiscoveredAd,
      latestActiveRun,
    ] = await Promise.all([
      // Only ads that originated from a Discovery run (have an AdSourceIdentity)
      prisma.adSourceIdentity.groupBy({
        by: ["adId"],
        _count: { adId: true },
      }).then((rows) => rows.length),

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

      // Cross-process heartbeat: a RUNNING job that updated its heartbeat within 5 min
      // means the worker process is alive.
      prisma.discoveryRun.findFirst({
        where: {
          status: "RUNNING",
          heartbeatAt: { gte: fiveMinutesAgo },
        },
        orderBy: { heartbeatAt: "desc" },
        select: { heartbeatAt: true, providerId: true },
      }),
    ]);

    const workerOnline = latestActiveRun !== null;

    return NextResponse.json({
      success: true,
      data: {
        // Count only ads ingested via auto-discovery, not manual imports
        totalDiscoveredAds: autoDiscoveredAdsCount,
        totalRuns,
        completedRuns,
        blockedRuns,
        activeSchedules,
        activeSchedule: activeSchedules > 0,
        lastDiscoveredAt: latestAutoDiscoveredAd?.firstSeenAt ?? null,

        // Worker online state is cross-process via DB heartbeat — NOT module memory
        workerStatus: {
          isOnline: workerOnline,
          isRunning: workerOnline, // alias for backwards compat with existing UI reads
          lastHeartbeatAt: latestActiveRun?.heartbeatAt ?? null,
          activeJobsCount: workerOnline ? 1 : 0,
          notice: workerOnline
            ? "Worker process detected via heartbeat."
            : "No active worker process found. Start with: npm run discovery:worker",
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.1",
        note:
          "totalDiscoveredAds includes only auto-discovery ingested ads (AdSourceIdentity). " +
          "workerStatus.isOnline is derived from DB heartbeat, not module-memory state.",
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
