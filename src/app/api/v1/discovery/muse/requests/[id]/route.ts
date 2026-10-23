/**
 * GET   /api/v1/discovery/muse/requests/:id — inspect single Muse research request details.
 * PATCH /api/v1/discovery/muse/requests/:id — claim request, record RUNNING heartbeat, FAILED or CANCELLED.
 *
 * Scoped authentication required: MUSE_INGESTION_TOKEN or ADMIN_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";
import {
  getMuseResearchRequest,
  claimMuseResearchRequest,
  updateMuseRequestStatus,
} from "@/services/discovery/muse/museRequestService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyMuseAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await params;
  const run = await getMuseResearchRequest(id, auth.agent?.workspaceId);

  if (!run) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: `Muse research request '${id}' not found.` },
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: run,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyMuseAgentAuthorization(request, "CLAIM");
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await params;

  try {
    const body = await request.json();
    const action = body.action as string | undefined;
    const status = body.status as string | undefined;
    const errorMessage = typeof body.errorMessage === "string" ? body.errorMessage : undefined;

    // Handle atomic claim action
    if (action === "CLAIM" || status === "CLAIMED") {
      const claimResult = await claimMuseResearchRequest(id, auth.agent!);
      if (!claimResult.success) {
        const isNotFound = claimResult.error === "NOT_FOUND";
        const isConflict =
          claimResult.error === "ALREADY_CLAIMED" || claimResult.error === "REQUEST_ALREADY_CLOSED";

        return NextResponse.json(
          {
            success: false,
            error: {
              code: isNotFound ? "NOT_FOUND" : isConflict ? "CLAIM_CONFLICT" : "CLAIM_FAILED",
              message:
                claimResult.error === "ALREADY_CLAIMED"
                  ? `Request '${id}' is already claimed by an active agent lease.`
                  : claimResult.error === "REQUEST_ALREADY_CLOSED"
                  ? `Request '${id}' is already finished or cancelled.`
                  : claimResult.error || "Failed to claim request.",
            },
          },
          { status: isNotFound ? 404 : isConflict ? 409 : 500 }
        );
      }

      return NextResponse.json({
        success: true,
        data: claimResult.request,
        meta: {
          notice: "Request atomically claimed by agent session. Lease active for 15 minutes.",
        },
      });
    }

    // Handle status updates
    if (status !== "RUNNING" && status !== "FAILED" && status !== "CANCELLED") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message:
              "PATCH status must be RUNNING (heartbeat), FAILED, or CANCELLED, or action must be CLAIM. Result submission happens via the results endpoint.",
          },
        },
        { status: 400 }
      );
    }

    const updateResult = await updateMuseRequestStatus(
      id,
      { status, errorMessage },
      auth.agent!
    );

    if (!updateResult.success) {
      const isNotFound = updateResult.error?.includes("not found");
      const isConflict = updateResult.error?.includes("cannot");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: isNotFound ? "NOT_FOUND" : isConflict ? "STATE_TRANSITION_INVALID" : "UPDATE_FAILED",
            message: updateResult.error || "Failed to update request status.",
          },
        },
        { status: isNotFound ? 404 : isConflict ? 409 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { requestId: id, status: updateResult.status },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update Muse request.";
    return NextResponse.json(
      { success: false, error: { code: "MUSE_REQUEST_UPDATE_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
