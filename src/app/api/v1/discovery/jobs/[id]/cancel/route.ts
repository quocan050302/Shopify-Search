/**
 * POST /api/v1/discovery/jobs/[id]/cancel
 *
 * Safely cancels a running discovery job.
 */

import { NextRequest, NextResponse } from "next/server";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function POST(
  request: NextRequest,
  segmentData: { params: Promise<{ id: string }> }
) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const { id } = await segmentData.params;
    const cancelled = await discoveryOrchestrator.cancelDiscoveryJob(id);

    if (!cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CANCEL_FAILED",
            message: `Could not cancel job '${id}'. It may not be running or does not exist.`,
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { jobId: id, status: "CANCELLED" },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to cancel discovery job.";
    return NextResponse.json(
      { success: false, error: { code: "CANCEL_ERROR", message: msg } },
      { status: 500 }
    );
  }
}
