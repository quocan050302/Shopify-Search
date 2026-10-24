import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/v1/discovery/meta/requests/:id
 * Retrieves detailed status, progress, checkpoints, and counters for a specific research run.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;

    const run = await prisma.discoveryRun.findUnique({
      where: { id },
      include: {
        runAds: {
          select: {
            id: true,
            adId: true,
            ingestOutcome: true,
            libraryId: true,
            observedAt: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json(
        { success: false, error: "NOT_FOUND", message: `Discovery run '${id}' not found` },
        { status: 404 }
      );
    }

    let parsedQuery: any = {};
    try {
      parsedQuery = JSON.parse(run.queryConfigJson);
    } catch {}

    // Check SyncJob for progress if linked
    let progress = 0;
    if (run.jobId) {
      const syncJob = await prisma.syncJob.findUnique({
        where: { id: run.jobId },
        select: { progress: true, status: true },
      });
      if (syncJob) {
        progress = syncJob.progress;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: run.id,
        jobId: run.jobId,
        providerId: run.providerId,
        status: run.status,
        progress,
        keywords: parsedQuery.keywords || [],
        market: parsedQuery.market || "US",
        requestedLimit: run.requestedLimit,
        counters: {
          actualRetrieved: run.actualRetrievedCount,
          validCount: run.validCount,
          newUniqueCount: run.newUniqueCount,
          existingDuplicateCount: run.existingDuplicateCount,
          failedCount: run.failedCount,
          linkedAdsCount: run.runAds?.length || 0,
        },
        error: run.errorMessage
          ? {
              message: run.errorMessage,
              category: run.errorCategory,
            }
          : null,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        heartbeatAt: run.heartbeatAt,
        createdAt: run.createdAt,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "INTERNAL_ERROR", message: msg },
      { status: 500 }
    );
  }
}
