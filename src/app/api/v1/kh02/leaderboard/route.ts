/**
 * GET /api/v1/kh02/leaderboard
 *
 * Restores the latest completed KH-02 evergreen leaderboard snapshot for the authorized workspace.
 * Avoids redundant network re-execution on page reloads.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getKH02Leaderboard } from "@/services/kh02/persistence/kh02PersistenceService";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const leaderboard = await getKH02Leaderboard(context.workspaceId);

    return NextResponse.json({
      success: true,
      data: leaderboard,
      meta: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
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
          code: "LEADERBOARD_FETCH_FAILED",
          message: err.message || "Failed to retrieve saved leaderboard snapshot.",
        },
      },
      { status: 500 }
    );
  }
}
