/**
 * GET /api/v1/discovery/stats
 *
 * Retrieves discovery performance metrics and scheduler health.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDiscoveryWorkerStatus } from "@/workers/discoveryWorker";

export async function GET() {
  try {
    const [
      totalDiscoveredAds,
      totalRuns,
      completedRuns,
      blockedRuns,
      activeSchedules,
      latestAd,
    ] = await Promise.all([
      prisma.competitorAd.count({
        where: { platform: "TIKTOK" },
      }),
      prisma.discoveryRun.count(),
      prisma.discoveryRun.count({ where: { status: "COMPLETED" } }),
      prisma.discoveryRun.count({ where: { status: "BLOCKED_SOURCE" } }),
      prisma.discoverySchedule.count({ where: { enabled: true } }),
      prisma.competitorAd.findFirst({
        where: { platform: "TIKTOK" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    const workerStatus = getDiscoveryWorkerStatus();

    return NextResponse.json({
      success: true,
      data: {
        totalDiscoveredAds,
        totalRuns,
        completedRuns,
        blockedRuns,
        activeSchedules,
        activeSchedule: activeSchedules > 0,
        lastDiscoveredAt: latestAd?.createdAt || null,
        workerStatus,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load discovery statistics.";
    return NextResponse.json(
      { success: false, error: { code: "STATS_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
