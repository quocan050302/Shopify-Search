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

        const baseDims = diagnostic.dimensions || readiness.dimensions;
        const probeDims = latestProbe?.dimensions;
        const effectiveDimensions = {
          ...baseDims,
          ...probeDims,
          // Preserve live query fields so connection test probe NEVER wipes actual query evidence
          lastLiveQueryRecordCount:
            baseDims?.lastLiveQueryRecordCount !== null && baseDims?.lastLiveQueryRecordCount !== undefined
              ? baseDims.lastLiveQueryRecordCount
              : probeDims?.lastLiveQueryRecordCount ?? null,
          lastLiveQueryAt: baseDims?.lastLiveQueryAt || probeDims?.lastLiveQueryAt || null,
          lastSuccessfulLiveQueryAt: baseDims?.lastSuccessfulLiveQueryAt || probeDims?.lastSuccessfulLiveQueryAt || null,
          lastSuccessfulRecordCount:
            baseDims?.lastSuccessfulRecordCount !== null && baseDims?.lastSuccessfulRecordCount !== undefined
              ? baseDims.lastSuccessfulRecordCount
              : probeDims?.lastSuccessfulRecordCount ?? null,
          queryProvenance: baseDims?.queryProvenance || probeDims?.queryProvenance || "NONE",
          isLive: baseDims?.isLive ?? probeDims?.isLive ?? false,
          queryExecuted: Boolean(baseDims?.queryExecuted || probeDims?.queryExecuted),
          queryStatus: baseDims?.queryStatus || probeDims?.queryStatus,
          queryError: baseDims?.queryError || probeDims?.queryError,
        };

        const effectiveDiagnostic = latestProbe
          ? {
              ...diagnostic,
              ...latestProbe,
              lastLiveQueryRecordCount: effectiveDimensions.lastLiveQueryRecordCount,
              lastSuccessfulLiveQueryAt: effectiveDimensions.lastSuccessfulLiveQueryAt,
              queryExecuted: effectiveDimensions.queryExecuted,
              dimensions: effectiveDimensions,
            }
          : { ...diagnostic, dimensions: effectiveDimensions };

        const effectiveReadiness = latestProbe ? latestProbe.status : readiness.status;
        const effectiveReason = latestProbe?.reason || readiness.reason;

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
