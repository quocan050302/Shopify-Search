/**
 * POST /api/v1/discovery/run
 *
 * Triggers an immediate ad discovery run.
 */

import { NextRequest, NextResponse } from "next/server";
import { DiscoveryQuerySchema } from "@/services/discovery/types";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const dryRun = Boolean(body.dryRun);

    const parsed = DiscoveryQuerySchema.safeParse(body.query || body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid discovery query parameters.",
            details: parsed.error.issues,
          },
        },
        { status: 400 }
      );
    }

    const summary = await discoveryOrchestrator.runDiscoveryJob(parsed.data, {
      dryRun,
    });

    return NextResponse.json({
      success: true,
      data: summary,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
        notice:
          summary.finalStatus === "BLOCKED_SOURCE"
            ? "Discovery source blocked: session cookie or approved provider credentials required. Zero fabricated ads inserted."
            : "Discovery run processed.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Discovery execution failed.";
    return NextResponse.json(
      { success: false, error: { code: "DISCOVERY_RUN_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
