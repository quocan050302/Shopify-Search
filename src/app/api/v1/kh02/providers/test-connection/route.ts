/**
 * POST /api/v1/kh02/providers/test-connection
 *
 * Runs authenticated connectivity diagnostics on an allowlisted intelligence source
 * without initiating paid operations (zero-cost safe diagnostics).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  testKH02SourceConnection,
  listKH02SourceCapabilities,
} from "@/services/kh02/providers/sourceRegistry";
import { IntelligenceSource } from "@/services/kh02/types";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

const ALLOWED_SOURCES = new Set<string>([
  "META_ADS",
  "TIKTOK_ADS",
  "GOOGLE_ADS",
  "DEMAND_HISTORY",
]);

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is treated as test all sources
    }

    if (body.all === true || (!body.source && !body.provider)) {
      const allCapabilities = listKH02SourceCapabilities();
      const settled = await Promise.allSettled(
        allCapabilities.map((cap) =>
          testKH02SourceConnection(cap.source as IntelligenceSource, {
            workspaceId: context.workspaceId,
            timeoutMs: 6000,
          })
        )
      );

      const results = settled.map((s, idx) => {
        if (s.status === "fulfilled") return s.value;
        const cap = allCapabilities[idx];
        return {
          source: cap.source,
          adapterInstalled: true,
          configured: false,
          transportConnected: false,
          authenticated: false,
          discoverySupported: false,
          queryExecuted: false,
          recordsReturned: 0,
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastProbeAt: new Date().toISOString(),
          authStatus: "AUTHENTICATION_FAILED" as const,
          transportStatus: "TRANSPORT_FAILED" as const,
          capabilityStatus: "UNSUPPORTED" as const,
          provenanceVerified: false,
          lastCheckedAt: new Date().toISOString(),
          status: "FAILED",
          reason: (s as PromiseRejectedResult).reason?.message || "Connection probe failed",
          missingRequirements: ["CONNECTION_FAILED"],
        };
      });

      return NextResponse.json({
        success: true,
        data: results,
        meta: {
          workspaceId: context.workspaceId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const requestedSource = String(body.source || body.provider).toUpperCase();
    if (requestedSource === "TIKTOK_ORGANIC") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SOURCE_DISABLED",
            message: "TikTok Organic is permanently disabled in KH-02.",
          },
        },
        { status: 400 }
      );
    }
    if (!ALLOWED_SOURCES.has(requestedSource)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_SOURCE",
            message: `Unsupported intelligence source for connection test: '${requestedSource}'. Allowed: ${Array.from(ALLOWED_SOURCES).join(", ")}`,
          },
        },
        { status: 400 }
      );
    }

    const result = await testKH02SourceConnection(requestedSource as IntelligenceSource, {
      workspaceId: context.workspaceId,
    });

    return NextResponse.json({
      success: true,
      data: result,
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
          code: "CONNECTION_TEST_FAILED",
          message: err.message || "Failed to execute connection test.",
        },
      },
      { status: 500 }
    );
  }
}
