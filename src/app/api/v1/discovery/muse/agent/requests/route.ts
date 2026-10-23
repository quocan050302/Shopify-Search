/**
 * External Muse Agent Gateway — Queued Requests
 *
 * GET /api/v1/discovery/muse/agent/requests?status=PENDING
 *
 * Restricted strictly to external agents authenticated via MUSE_INGESTION_TOKEN only.
 * Binds workspace server-side to prevent multi-tenant data leaks.
 * External agents have read-only access to queued work items.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";
import { listMuseResearchRequests } from "@/services/discovery/muse/museRequestService";

export async function GET(request: NextRequest) {
  const auth = verifyMuseAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "PENDING";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    // Strictly enforce server-bound workspace
    const workspaceId = auth.agent!.workspaceId;

    const runs = await listMuseResearchRequests({
      status,
      limit,
      workspaceId,
    });

    return NextResponse.json({
      success: true,
      data: runs,
      meta: {
        total: runs.length,
        workspaceId,
        timestamp: new Date().toISOString(),
        version: "v10.1",
        notice: "External agent gateway: read-only access to assigned research queue.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list assigned research requests.";
    return NextResponse.json(
      { success: false, error: { code: "AGENT_QUEUE_READ_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "External agents cannot create research requests. Requests must be created by users through SWAI.",
      },
    },
    { status: 405 }
  );
}
