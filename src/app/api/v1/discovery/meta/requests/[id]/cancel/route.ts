import { NextRequest, NextResponse } from "next/server";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";

/**
 * POST /api/v1/discovery/meta/requests/:id/cancel
 * Cancels a pending or running discovery job safely.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const cancelled = await discoveryOrchestrator.cancelDiscoveryJob(id);

    if (!cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: "CANNOT_CANCEL",
          message: `Job '${id}' could not be cancelled. It may already be completed, failed, or does not exist.`,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Job '${id}' successfully cancelled.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "CANCEL_FAILED", message: msg },
      { status: 500 }
    );
  }
}
