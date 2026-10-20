/**
 * GET /api/v1/discovery/jobs
 *
 * Lists historical and active discovery runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const status = searchParams.get("status") || undefined;
    const providerId = searchParams.get("providerId") || undefined;

    const where: any = {};
    if (status) where.status = status;
    if (providerId) where.providerId = providerId;

    const runs = await prisma.discoveryRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        schedule: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: runs.map((r) => ({
        id: r.id,
        scheduleId: r.scheduleId,
        scheduleName: r.schedule?.name || null,
        providerId: r.providerId,
        status: r.status,
        runMode: r.runMode,
        requestedLimit: r.requestedLimit,
        actualRetrievedCount: r.actualRetrievedCount,
        validCount: r.validCount,
        newUniqueCount: r.newUniqueCount,
        existingDuplicateCount: r.existingDuplicateCount,
        failedCount: r.failedCount,
        creditsUsed: r.creditsUsed,
        actualCostUsd: r.actualCostUsd,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        createdAt: r.createdAt,
      })),
      pagination: {
        total: runs.length,
        limit,
      },
      meta: {
        total: runs.length,
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch discovery jobs.";
    return NextResponse.json(
      { success: false, error: { code: "JOBS_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
