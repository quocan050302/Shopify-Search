import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

/**
 * POST /api/v1/discovery/meta/requests/:id/cancel
 * Cancels a pending or running discovery job safely within the authorized workspace.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id } = await props.params;

    const run = await prisma.discoveryRun.findUnique({
      where: { id },
      select: { id: true, workspaceId: true },
    });

    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error: "NOT_FOUND",
          message: `Discovery run '${id}' not found.`,
        },
        { status: 404 }
      );
    }

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

    const cancelled = await discoveryOrchestrator.cancelDiscoveryJob(id);

    if (!cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: "CANNOT_CANCEL",
          message: `Job '${id}' could not be cancelled. It may already be completed, failed, or does not exist.`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Job '${id}' successfully cancelled.`,
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
      { success: false, error: "CANCEL_FAILED", message: msg },
      { status: 500 }
    );
  }
}
