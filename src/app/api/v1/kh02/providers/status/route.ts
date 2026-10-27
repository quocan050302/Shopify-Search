/**
 * GET /api/v1/kh02/providers/status
 *
 * Returns live capability declarations and readiness status for all KH-02 intelligence sources.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listKH02SourceCapabilities,
  checkKH02ProviderReadiness,
  diagnoseKH02Source,
  getLatestProbe,
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
        const latestProbe = getLatestProbe(cap.source);
        const [readiness, diagnostic] = await Promise.all([
          checkKH02ProviderReadiness(cap.source, context.workspaceId),
          diagnoseKH02Source(cap.source, { workspaceId: context.workspaceId }),
        ]);

        const effectiveDiagnostic = latestProbe ? { ...diagnostic, ...latestProbe } : diagnostic;
        const effectiveReadiness = latestProbe ? latestProbe.status : readiness.status;
        const effectiveReason = latestProbe?.reason || readiness.reason;
        const effectiveDimensions = latestProbe?.dimensions || readiness.dimensions;

        return {
          ...cap,
          readiness: effectiveReadiness,
          diagnosticStatus: latestProbe?.status || readiness.diagnosticStatus,
          isReady: latestProbe
            ? (latestProbe.status === "CONNECTED" || latestProbe.status === "SOURCE_ACCESS_VERIFIED" || latestProbe.status === "LIVE_DATA_VERIFIED")
            : readiness.ready,
          readinessReason: effectiveReason,
          dimensions: effectiveDimensions,
          diagnostic: effectiveDiagnostic,
          latestProbe: latestProbe || null,
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
