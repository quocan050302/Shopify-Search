/**
 * GET /api/v1/kh02/research/active
 *
 * Retrieves the currently active (PENDING or RUNNING) research run for the authorized workspace,
 * allowing instant re-attachment upon browser reload without triggering duplicate research.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getKH02ActiveResearchRun } from "@/services/kh02/persistence/kh02PersistenceService";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const activeRun = await getKH02ActiveResearchRun(context.workspaceId);

    return NextResponse.json({
      success: true,
      data: activeRun,
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
          code: "ACTIVE_RUN_FETCH_FAILED",
          message: err.message || "Failed to check active research runs.",
        },
      },
      { status: 500 }
    );
  }
}
