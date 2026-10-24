import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";

/**
 * POST /api/v1/discovery/meta/requests/:id/retry
 * Creates a new tracked research attempt from a previously failed or cancelled job,
 * preserving previous audit history.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;

    const originalRun = await prisma.discoveryRun.findUnique({
      where: { id },
    });

    if (!originalRun) {
      return NextResponse.json(
        { success: false, error: "NOT_FOUND", message: `Discovery run '${id}' not found` },
        { status: 404 }
      );
    }

    let query: any;
    try {
      query = JSON.parse(originalRun.queryConfigJson);
    } catch {
      return NextResponse.json(
        { success: false, error: "MALFORMED_QUERY", message: "Cannot retry job with unreadable query configuration" },
        { status: 400 }
      );
    }

    // Ensure platform is META and provider is meta-ads-collector
    query.platform = "META";
    query.providerId = "meta-ads-collector";

    const newJob = await discoveryOrchestrator.createDiscoveryJob(query, originalRun.scheduleId || undefined);

    return NextResponse.json(
      {
        success: true,
        message: `Retry job created successfully (original run: ${id})`,
        newRunId: newJob.jobId,
        syncJobId: newJob.syncJobId,
        status: newJob.status,
      },
      { status: 202 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "RETRY_FAILED", message: msg },
      { status: 500 }
    );
  }
}
