/**
 * GET /api/v1/kh02/providers/status
 *
 * Returns live capability declarations and readiness status for all KH-02 intelligence sources.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listKH02SourceCapabilities,
  checkKH02ProviderReadiness,
} from "@/services/kh02/providers/sourceRegistry";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const capabilities = listKH02SourceCapabilities();

    const statuses = await Promise.all(
      capabilities.map(async (cap) => {
        const readiness = await checkKH02ProviderReadiness(cap.source);
        return {
          ...cap,
          readiness: readiness.status,
          isReady: readiness.ready,
          readinessReason: readiness.reason,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: statuses,
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
      { success: false, error: { code: "STATUS_CHECK_FAILED", message: err.message } },
      { status: 500 }
    );
  }
}
