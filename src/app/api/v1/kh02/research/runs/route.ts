/**
 * GET /api/v1/kh02/research/runs
 *
 * Retrieves list of past research runs for the authorized workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getKH02ResearchRuns } from "@/services/kh02/persistence/kh02PersistenceService";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const runs = await getKH02ResearchRuns(context.workspaceId);

    return NextResponse.json({
      success: true,
      data: runs,
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
          code: "RUNS_FETCH_FAILED",
          message: err.message || "Failed to retrieve past research runs.",
        },
      },
      { status: 500 }
    );
  }
}
