import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { executeLandingPageResearchJob } from "@/services/research/landingPageInspectionService";

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

    // Optional execute=true for immediate execution in UI if worker is not running
    const { searchParams } = new URL(request.url);
    if (searchParams.get("execute") === "true" && job.status === "PENDING") {
      try {
        const result = await executeLandingPageResearchJob(job.id);
        const refreshed = await prisma.syncJob.findUnique({ where: { id: jobId } });
        return NextResponse.json({
          success: true,
          data: {
            ...refreshed,
            executionResult: result,
          },
          meta: {
            timestamp: new Date().toISOString(),
            version: "11.4.0",
          },
        });
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          error: err?.message || "Job execution failed",
          data: job,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      data: job,
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.0",
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
