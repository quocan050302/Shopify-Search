/**
 * POST /api/v1/discovery/muse/requests/:id/import
 *
 * User-facing same-origin endpoint for importing structured research artifacts (Mode C fallback).
 * Uses standard SWAI user/admin authentication without exposing or requiring MUSE_INGESTION_TOKEN in browser code.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/services/security/adminAuth";
import { submitMuseResearchResults } from "@/services/discovery/muse/museResultSubmissionService";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await params;
  const workspaceId = (request.headers.get("x-workspace-id") || "").trim() || "default-workspace";

  try {
    const body = await request.json();

    const summary = await submitMuseResearchResults(id, body, {
      agentId: "user-ui-artifact-import",
      workspaceId,
      scope: "SUBMIT_RESULTS",
    });

    return NextResponse.json({
      success: true,
      data: summary,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.1",
        notice: "Artifact imported through authenticated user session.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to import research artifact.";
    const isNotFound = msg.includes("not found");
    const isConflict = msg.includes("already");
    const isValidation = msg.includes("Invalid");

    return NextResponse.json(
      {
        success: false,
        error: {
          code: isNotFound
            ? "NOT_FOUND"
            : isConflict
            ? "REQUEST_ALREADY_CLOSED"
            : isValidation
            ? "VALIDATION_FAILED"
            : "MUSE_IMPORT_FAILED",
          message: msg,
        },
      },
      { status: isNotFound ? 404 : isConflict ? 409 : isValidation ? 400 : 500 }
    );
  }
}
