/**
 * Muse External-Agent Discovery Queue Endpoints
 *
 * POST /api/v1/discovery/muse/requests
 *   Creates a persisted PENDING research request for the Muse provider (Meta/Facebook).
 *   The request is NOT executed by this app: Muse, an external agent, inspects
 *   the queue, researches the public Meta Ad Library with a real browser, and
 *   submits verified ads to /api/v1/discovery/muse/requests/:id/results.
 *
 * GET /api/v1/discovery/muse/requests?status=PENDING
 *   Lists queued Muse requests (used by Muse to pick up work, and by the UI
 *   to monitor pending research).
 *
 * Scoped authentication required: MUSE_INGESTION_TOKEN or ADMIN_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyUserOrAgentAuthorization } from "@/services/security/museAuth";
import {
  createMuseResearchRequest,
  listMuseResearchRequests,
} from "@/services/discovery/muse/museRequestService";

export async function POST(request: NextRequest) {
  const auth = verifyUserOrAgentAuthorization(request, "CLAIM");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json();
    const rawQuery = body.query || body;

    const keywords = Array.isArray(rawQuery.keywords)
      ? rawQuery.keywords
      : typeof rawQuery.keyword === "string"
      ? [rawQuery.keyword]
      : [];

    const result = await createMuseResearchRequest(
      {
        workspaceId: auth.workspaceId,
        keywords,
        market: rawQuery.market || "US",
        requestedLimit: rawQuery.requestedLimit || rawQuery.targetCount || 25,
        category: rawQuery.category,
        creativePreference: rawQuery.creativePreference,
        notes: rawQuery.notes,
      },
      { workspaceId: auth.workspaceId }
    );

    return NextResponse.json({
      success: true,
      data: {
        requestId: result.requestId,
        syncJobId: result.syncJobId,
        status: result.status,
        providerId: "muse-ad-library",
        platform: "META",
        keywords,
        targetCount: rawQuery.requestedLimit || 25,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.1",
        notice:
          "Research request queued as PENDING. It completes only when the Muse agent submits verified results — no ads are created by queuing alone.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create Muse discovery request.";
    const isValidation =
      msg.includes("required") || msg.includes("invalid") || msg.includes("limit reached");
    return NextResponse.json(
      {
        success: false,
        error: {
          code: isValidation ? "VALIDATION_FAILED" : "MUSE_REQUEST_CREATE_FAILED",
          message: msg,
        },
      },
      { status: isValidation ? 400 : 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = verifyUserOrAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "PENDING";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
    const workspaceId = searchParams.get("workspaceId") || auth.workspaceId;

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
        timestamp: new Date().toISOString(),
        version: "v10.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list Muse discovery requests.";
    return NextResponse.json(
      { success: false, error: { code: "MUSE_REQUEST_LIST_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
