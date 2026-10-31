import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

/**
 * GET /api/v1/discovery/meta/requests/:id
 * Retrieves detailed status, progress, checkpoints, and counters for a specific research run
 * within the authorized workspace.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
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

    // Tenant isolation assertion: must match caller's active authorized workspace
    if (run.workspaceId !== context.workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: "FORBIDDEN",
          message: `Access denied: Discovery run '${id}' belongs to another workspace.`,
        },
        { status: 403 }
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
        workspaceId: run.workspaceId,
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
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "INTERNAL_ERROR", message: msg },
      { status: 500 }
    );
  }
}
