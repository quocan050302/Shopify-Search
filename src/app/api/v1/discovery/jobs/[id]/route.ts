/**
 * GET /api/v1/discovery/jobs/[id]
 *
 * Retrieves progress and full details for a single discovery run.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  segmentData: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await segmentData.params;

    const run = await prisma.discoveryRun.findUnique({
      where: { id },
      include: {
        schedule: { select: { id: true, name: true } },
        requestLedgers: {
          orderBy: { requestedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: `Discovery run '${id}' not found.` },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: run.id,
        scheduleId: run.scheduleId,
        scheduleName: run.schedule?.name || null,
        jobId: run.jobId,
        providerId: run.providerId,
        status: run.status,
        runMode: run.runMode,
        queryConfig: JSON.parse(run.queryConfigJson || "{}"),
        cursor: run.cursor,
        requestedLimit: run.requestedLimit,
        actualRetrievedCount: run.actualRetrievedCount,
        validCount: run.validCount,
        newUniqueCount: run.newUniqueCount,
        existingDuplicateCount: run.existingDuplicateCount,
        rejectedCount: run.rejectedCount,
        failedCount: run.failedCount,
        totalRequestCount: run.totalRequestCount,
        estimatedCostUsd: run.estimatedCostUsd,
        actualCostUsd: run.actualCostUsd,
        creditsUsed: run.creditsUsed,
        errorMessage: run.errorMessage,
        errorCategory: run.errorCategory,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        heartbeatAt: run.heartbeatAt,
        requestLedgers: run.requestLedgers,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load discovery job details.";
    return NextResponse.json(
      { success: false, error: { code: "JOB_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
