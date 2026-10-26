import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ jobId: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { jobId } = await props.params;

    const job = await prisma.syncJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return NextResponse.json(
        { success: false, error: "Research job not found" },
        { status: 404 }
      );
    }

    if (job.workspaceId !== context.workspaceId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized access to job" },
        { status: 403 }
      );
    }

    // GET is strictly read-only and idempotent. No mutations or crawler execution allowed.
    let parsedMetadata: any = {};
    try {
      parsedMetadata = JSON.parse(job.resultJson || "{}");
    } catch {
      // ignore
    }

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        workspaceId: job.workspaceId,
        jobType: job.jobType,
        status: job.status,
        progress: job.progress,
        startedAt: job.startedAt?.toISOString() || null,
        completedAt: job.completedAt?.toISOString() || null,
        lastHeartbeatAt: parsedMetadata.lastHeartbeatAt || null,
        leaseExpiresAt: parsedMetadata.leaseExpiresAt || null,
        snapshotId: parsedMetadata.snapshotId || null,
        errorCode: parsedMetadata.errorCode || null,
        errorMessage: job.errorMessage,
        targetUrl: parsedMetadata.targetUrl || null,
        attemptNumber: parsedMetadata.attemptNumber || 1,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.2",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Get Research Job Status Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
