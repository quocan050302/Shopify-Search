/**
 * GET /api/v1/kh02/research/runs/[runId]
 *
 * Retrieves an exact research run and its ranking snapshot by ID for the authorized workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getKH02ResearchRunById } from "@/services/kh02/persistence/kh02PersistenceService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ runId: string }> }
) {
  try {
    const params = await props.params;
    const context = await resolveAuthorizedResearchContext(request);
    const run = await getKH02ResearchRunById(params.runId, context.workspaceId);

    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RUN_NOT_FOUND",
            message: `Research run '${params.runId}' not found in authorized workspace.`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: run,
      meta: {
        workspaceId: context.workspaceId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RUN_FETCH_FAILED",
          message: err.message || "Failed to retrieve research run.",
        },
      },
      { status: 500 }
    );
  }
}
